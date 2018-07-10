import isString from 'lodash-es/isString';
import isDate from 'lodash-es/isDate';

import { Observable } from 'rxjs/Observable';
import { Subscription } from 'rxjs/Subscription';
import { Subscriber } from 'rxjs/Subscriber';
import { Subject } from 'rxjs/Subject';
import { BehaviorSubject } from 'rxjs/BehaviorSubject';
import { AjaxResponse } from 'rxjs/observable/dom/AjaxObservable';
import 'rxjs/add/observable/dom/ajax';
import 'rxjs/add/observable/empty';
import 'rxjs/add/observable/of';
import 'rxjs/add/operator/catch';
import 'rxjs/add/operator/delay';
import 'rxjs/add/operator/do';
import 'rxjs/add/operator/filter';
import 'rxjs/add/operator/map';
import 'rxjs/add/operator/mergeMap';
import 'rxjs/add/operator/repeat';
import 'rxjs/add/operator/retryWhen';
import 'rxjs/add/operator/share';
import 'rxjs/add/operator/take';

import { Logger } from 'onix-core';
import { IStream, IStreamMessage, MessageType, ConnectionStatus } from "onix-app";
import { dateToUTCString } from 'onix-core';
import { IPushStreamSettings } from './IPushStreamSettings';

const errorExpiredToken = new Error("expired token");
const errorConversationEnded = new Error("conversation ended");
const errorFailedToConnect = new Error("failed to connect");

const extend = (...args: any[]) => {
    var object = args[0] || {};
    for (var i = 0; i < args.length; i++) {
        var settings = args[i];
        for (var attr in settings) {
            if (!settings.hasOwnProperty || settings.hasOwnProperty(attr)) {
                object[attr] = settings[attr];
            }
        }
    }

    return object;
};

export interface IRequestHeaders {
    "If-None-Match"?: string,
    "If-Modified-Since"?: string
}

const objectToUrlParams = (settings): string => {
    let params = [];
    if (typeof(settings) === 'object') {
        for (var attr in settings) {
            if (!settings.hasOwnProperty || settings.hasOwnProperty(attr)) {
                params.push(attr + '=' + encodeURI(settings[attr]));
            }
        }
    }

    return params.join("&");
};

const addParamsToUrl = (url: string, params) => {
    return url + ((url.indexOf('?') < 0) ? '?' : '&') + objectToUrlParams(params);
};

const getTime = () => {
    return (new Date()).getTime();
};

const currentTimestampParam = () => {
    return { "_" : getTime() };
};

const normalizePort = (useSSL: boolean, port: number | string) => {
    port = Number(port || (useSSL ? 443 : 80));
    return ((!useSSL && port === 80) || (useSSL && port === 443)) ? "" : port;
};

const getBacktrack = (options) => {
    return (options.backtrack) ? ".b" + Number(options.backtrack) : "";
};

const getChannelsPath = (channels, withBacktrack: boolean) => {
    var path = '';
    for (var channelName in channels) {
      if (!channels.hasOwnProperty || channels.hasOwnProperty(channelName)) {
        path += "/" + channelName + (withBacktrack ? getBacktrack(channels[channelName]) : "");
      }
    }

    return path;
};

const isCrossDomainUrl = (url: string) => {
    if (!url) {
      return false;
    }

    var parser = document.createElement('a');
    parser.href = url;

    var srcPort = normalizePort(window.location.protocol === "https:", window.location.port);
    var dstPort = normalizePort(parser.protocol === "https:", parser.port);

    return (window.location.protocol !== parser.protocol) || (window.location.hostname !== parser.hostname) || (srcPort !== dstPort);
};

const escapeText = (text: string) => {
    return (text) ? encodeURI(text) : '';
};

const unescapeText = (text: string) => {
    return (text) ? decodeURI(text) : '';
};

class ObserverHelper {
    public static create(callback: Function) {
        return {
            next(e) {
                callback(e);
            }
        };
    }
}

export enum TransportType {
    None,
    WebSocket,
    EventSource,
    LongPolling,
    Straming
}

export var PushStreamManager: PushStream[] = [];

export class PushStream implements IStream {
    private id: number;
    private useSSL: boolean;
    private host: string;
    private port: number;

    public timeout: number;
    private pinginterval: number;
    private reconnectInterval: number;
    private autoReconnect: boolean;

    private lastEventId: string;
    private messagesPublishedAfter: number|Date;
    public messagesControlByArgument: boolean;
    private tagArgument: string;
    private timeArgument: string;
    private eventIdArgument: string;
    private useJSONP: boolean;

    private _etag;
    private _lastModified;
    private _lastEventId;

    private urlPrefixPublisher: string;
    private urlPrefixStream: string;
    private urlPrefixEventsource: string;
    private urlPrefixLongpolling: string;
    private urlPrefixWebsocket: string;

    private jsonIdKey: string
    private jsonChannelKey: string
    private jsonTextKey: string
    private jsonTagKey: string
    private jsonTimeKey: string
    private jsonEventIdKey: string

    private channelsByArgument: boolean;
    private channelsArgument: string;

    private channels: {
        [channelName: string]: Subject<IStreamMessage>;
    } = {};

    private channelCount: {
        [channelName: string]: number;
    } = {};
    
    private totalCount = 0;
    
    private modes: string[];

    private _crossDomain: boolean;

    private connectAttemps = 0;

    public connectionStatus$: BehaviorSubject<ConnectionStatus> = null;

    public transports: TransportType[] = [];

    public activity$: Observable<IStreamMessage> = null;

    private listenerSubscription: Subscription = null;

    private wrapperSubscription: Subscription;

    public extraParams?: () => any;

    constructor(settings: IPushStreamSettings) {
        settings = settings || {};

        this.connectionStatus$ = new BehaviorSubject(ConnectionStatus.Uninitialized);

        this.id = PushStreamManager.push(this) - 1;

        this.useSSL = settings.useSSL || false;
        this.host = settings.host || window.location.hostname;
        this.port = Number(settings.port || (this.useSSL ? 443 : 80));

        this.pinginterval = settings.pinginterval || 5 * 1000;
        this.timeout = settings.timeout || 15000;
        this.reconnectInterval = settings.reconnectInterval || 3000;
        this.autoReconnect = (settings.autoReconnect !== false);

        this.lastEventId = settings.lastEventId || null;
        this.messagesPublishedAfter = settings.messagesPublishedAfter;
        this.messagesControlByArgument = settings.messagesControlByArgument || false;
        this.tagArgument   = settings.tagArgument  || 'tag';
        this.timeArgument  = settings.timeArgument || 'time';
        this.eventIdArgument  = settings.eventIdArgument || 'eventid';
        this.useJSONP      = settings.useJSONP     || false;

        this._etag = 0;
        this._lastModified = null;
        this._lastEventId = null;

        this.urlPrefixPublisher   = settings.urlPrefixPublisher   || '/pub';
        this.urlPrefixStream      = settings.urlPrefixStream      || '/sub';
        this.urlPrefixEventsource = settings.urlPrefixEventsource || '/ev';
        this.urlPrefixLongpolling = settings.urlPrefixLongpolling || '/lp';
        this.urlPrefixWebsocket   = settings.urlPrefixWebsocket   || '/ws';

        this.jsonIdKey      = settings.jsonIdKey      || 'id';
        this.jsonChannelKey = settings.jsonChannelKey || 'channel';
        this.jsonTextKey    = settings.jsonTextKey    || 'text';
        this.jsonTagKey     = settings.jsonTagKey     || 'tag';
        this.jsonTimeKey    = settings.jsonTimeKey    || 'time';
        this.jsonEventIdKey = settings.jsonEventIdKey || 'eventid';

        this.modes = (settings.modes || 'eventsource|websocket|stream|longpolling').split('|');

        this.extraParams = settings.extraParams || function() { return {}; };

        this.channelsByArgument   = settings.channelsByArgument   || false;
        this.channelsArgument     = settings.channelsArgument     || 'channels';

        this._crossDomain = isCrossDomainUrl(this.getPublisherUrl());

        for (var i = 0; i < this.modes.length; i++) {
            switch (this.modes[i]) {
                case "websocket":
                    this.transports.push(TransportType.WebSocket);
                    break;
                case "eventsource": 
                    this.transports.push(TransportType.EventSource);
                    break;
                case "longpolling": 
                    this.transports.push(TransportType.LongPolling);
                    break;
                case "stream": 
                    break;
            }
        }
    }

    public subscribe(name: string, message: (value: IStreamMessage) => void, error?: (error: any) => void, complete?: () => void) {
        if (escapeText(name) !== name) {
            throw new Error("Invalid channel name! Channel has to be a set of [a-zA-Z0-9]");
        }

        Logger.info("subscribe to channel", name);

        let channel = this.channels[name];
        if (typeof channel === "undefined") {
            channel = new Subject<IStreamMessage>();            
            this.channels[name] = channel;
            this.channelCount[name] = 0;
            this.totalCount++;

            const status = this.connectionStatus$.getValue();
            if ((status === ConnectionStatus.Online) || (status === ConnectionStatus.Connecting)) {
                this.listen()
            } else {
                this.connect();
            }
        }
        
        this.channelCount[name]++;
        return channel.subscribe(message, error, complete);
    }

    public removeChannel(channel: string) {
        if (this.channels[channel]) {
            Logger.info("unsubscribe from channel", channel);
            this.channels[channel].complete();
            delete this.channels[channel];
            this.totalCount--;
            if (this.totalCount === 0) {
                this.disconnect();
            } else {
                const status = this.connectionStatus$.getValue();
                if ((status === ConnectionStatus.Online) || (status === ConnectionStatus.Connecting)) {
                    this.listen();
                }
            }
        }
    }

    public removeAll() {
        Logger.info("unsubscribe from all channels");
        
        const state = this.connectionStatus$.getValue();
        if (state !== ConnectionStatus.Offline) {
            this.disconnect();
        }

        for (var channelName in this.channels) {
            this.removeChannel(channelName);
        }
    }

    public connect() {
        Logger.debug("entering connect");
        if (!this.host) { 
            throw new Error("PushStream host not specified") 
        }
        
        if (isNaN(this.port)) { 
            throw new Error("PushStream port not specified"); 
        }
        
        if (this.totalCount === 0) { 
            throw new Error("No channels specified"); 
        }
        
        if (this.transports.length === 0) { 
            throw new Error("No transport available support for this browser"); 
        }

        if (this._lastEventId === null) {
            this._lastEventId = this.lastEventId;
        }

        if (this._lastModified === null) {
            var date = this.messagesPublishedAfter;
            if (!isDate(date)) {
                var messagesPublishedAfter = Number(this.messagesPublishedAfter);
                if (messagesPublishedAfter > 0) {
                    date = new Date();
                    date.setTime(date.getTime() - (messagesPublishedAfter * 1000));
                } else if (messagesPublishedAfter < 0) {
                    date = new Date(0);
                }
            }

            if (isDate(date)) {
                this._lastModified = dateToUTCString(date);
            }
        }

        this.listen();

        Logger.debug("leaving connect");
    }

    private listen = () => {
        if (this.listenerSubscription !== null) {
            this.listenerSubscription.unsubscribe();
            this.listenerSubscription = null;
        }
        
        if (this.activity$ === null) {
            this.activity$ = this.getActivity$();
        }

        if (this.activity$ !== null && this.listenerSubscription === null ) {
            this.listenerSubscription = this.activity$.subscribe(
                message => {
                    if ((typeof message !== "undefined") && (message !== null)) {
                        this.doOnMessage(message);
                    }
                }, 
                error => {
                    Logger.info("Connection error", error);
                    this.shiftCurrentTransport();
                    this.activity$ = null;
                    if (this.autoReconnect) {
                        Logger.info("Try reconnect");
                        if (this.connectAttemps++ < (this.transports.length * 4)) {
                            setTimeout(() => {
                                this.listen();
                            }, this.reconnectInterval)
                        } else {
                            Logger.error("Unable connect to server");
                        }
                    }
                }, 
                () => {
                    Logger.debug("listener complete");
                }
            );
        }
    }

    private publishToChannel(message: IStreamMessage) {
        if (this.channels[message.channel]) {
            this.channels[message.channel].next(message);
        }
    }

    private doOnMessage = (message: IStreamMessage) => {
        if (message.tag) { 
            this._etag = message.tag; 
        }
        
        if (message.time) { 
            this._lastModified = message.time; 
        }
        
        if (message.eventid) { 
            this._lastEventId = message.eventid; 
        }
        
        if (message.id === -2) {
            message.type = MessageType.ChannelDeleted;
            this.publishToChannel(message);
        } else if (message.id > 0) {
            if (message.text === "ping") {
                message.type = MessageType.Ping;
            }

            this.publishToChannel(message);
        }
    };


    private getActivity$(): Observable<IStreamMessage> {
        const transport = this.transports[0];
        switch (transport) {
            case TransportType.WebSocket:
                return this.activityWebSocket$();
            case TransportType.EventSource: 
                return this.activityEventSource$();
            case TransportType.LongPolling: 
                return this.activityLongPooling$();
        }
    }

    private shiftCurrentTransport() {
        this.transports.push(this.transports.shift());
    }


    private disconnect() {
        Logger.debug("entering disconnect");
        //this.disconnectInternal();
        //this.setState(ConnectionStatus.Offline);
        Logger.debug("leaving disconnect");
    }

    public getControlParams() {
        var data = {};
        data[this.tagArgument] = "";
        data[this.timeArgument] = "";
        data[this.eventIdArgument] = "";
        if (this.messagesControlByArgument) {
            data[this.tagArgument] = Number(this._etag);
            if (this._lastModified) {
                data[this.timeArgument] = this._lastModified;
            } else if (this._lastEventId) {
                data[this.eventIdArgument] = this._lastEventId;
            }
        }

        return data;
    }

    public isCrossDomain(): boolean {
        let useJSONP = this._crossDomain || this.useJSONP;        
        if (useJSONP) {
            this.messagesControlByArgument = true;
        }

        return useJSONP;
    }

    private useControlArguments() {
        return this.messagesControlByArgument && ((this._lastModified !== null) || (this._lastEventId !== null));
    }

    public getUrlParams() {
        return extend({}, this.extraParams(), currentTimestampParam(), this.getControlParams());
    }

    private getPublisherUrl = () => {
        var port = normalizePort(this.useSSL, this.port);
        var url = (this.useSSL) ? "https://" : "http://";
        url += this.host;
        url += (port ? (":" + port) : "");
        url += this.urlPrefixPublisher;
        url += "?id=" + getChannelsPath(this.channels, false).substr(1);

        return url;
    };

    public getSubscriberUrl(type: TransportType) {
        let extraParams = this.getUrlParams();
        let withBacktrack = !this.useControlArguments();
        let prefix = "";
        let websocket = false;

        switch (type) {
            case TransportType.WebSocket:
                prefix = this.urlPrefixWebsocket;
                websocket = true;
                break;
            case TransportType.EventSource:
                prefix = this.urlPrefixEventsource;
                break;
            case TransportType.LongPolling:
                prefix = this.urlPrefixLongpolling;
                break;
            case TransportType.Straming:
                prefix = this.urlPrefixStream; 
        }

        let useSSL = this.useSSL;
        let port = normalizePort(useSSL, this.port);
        let url = (websocket) ? ((useSSL) ? "wss://" : "ws://") : ((useSSL) ? "https://" : "http://");
        url += this.host;
        url += (port ? (":" + port) : "");
        url += prefix;

        let channels = getChannelsPath(this.channels, withBacktrack);
        if (this.channelsByArgument) {
            let channelParam = {};
            channelParam[this.channelsArgument] = channels.substring(1);
            extraParams = extend({}, extraParams, channelParam);
        } else {
            url += channels;
        }

        url = addParamsToUrl(url, extraParams);

        return url;
    }

    public getRequestHeaders(): IRequestHeaders {
        return (!this.messagesControlByArgument) ?
            { 
                "If-None-Match": this._etag,
                "If-Modified-Since": this._lastModified
            } : {};
    }

    public sendMessage(message: string, successCallback: () => void, errorCallback: () => void) {
        if (!message) {
            return;
        }

        if (!isString(message)) {
            message = JSON.stringify(message);
        }

        message = escapeText(message);
        
        Observable.ajax({
            method: "POST",
            url: this.getPublisherUrl(),
            body: message,
            crossDomain: this.isCrossDomain()
        })
        .subscribe(
            function (data) {
                if (successCallback) { 
                    successCallback(); 
                }
            },
            function (err) {
                if (errorCallback) { 
                    errorCallback(); 
                }
            }
        );
    }

    private observableMessage(message: IStreamMessage) {
        if (message) {
            if (message.tag) { 
                this._etag = message.tag; 
            }
            
            if (message.time) { 
                this._lastModified = message.time; 
            }
            
            if (message.eventid) { 
                this._lastEventId = message.eventid; 
            }

            message.text = (isString(message.text)) ? unescapeText(message.text) : message.text;
            
            if (message.id === -2) {
                message.type = MessageType.ChannelDeleted;
            } else if (message.id > 0) {
                if (message.text === "ping") {
                    message.type = MessageType.Ping;
                }
            }
        }
        
        return Observable.of(message);
    }

    private startConversation() {
        Logger.debug("startConversation");
        return Observable.of(true);
    }

    private reconnectToConversation() {
        Logger.debug("reconnectToConversation");
        return Observable.of(true);
    }

    private checkConnection(once = false) {
        let obs = this.connectionStatus$
        .flatMap(connectionStatus => {
            if (connectionStatus === ConnectionStatus.Uninitialized) {
                this.connectionStatus$.next(ConnectionStatus.Connecting);
                return this.startConversation()
                    .do(conversation => {
                        this.connectionStatus$.next(ConnectionStatus.Online);
                    }, error => {
                        this.connectionStatus$.next(ConnectionStatus.FailedToConnect);
                    })
                    .map(_ => connectionStatus);
            } else {
                return Observable.of(connectionStatus);
            }
        })
        .filter(connectionStatus => connectionStatus != ConnectionStatus.Uninitialized && connectionStatus != ConnectionStatus.Connecting)
        .flatMap(connectionStatus => {
            switch (connectionStatus) {
                case ConnectionStatus.Offline:
                    return Observable.throw(errorConversationEnded);

                case ConnectionStatus.FailedToConnect:
                    return Observable.throw(errorFailedToConnect);

                default:
                    return Observable.of(null);
            }
        })

        return once ? obs.take(1) : obs;
    }

    private activityLongPooling$(): Observable<IStreamMessage> {
        return this.checkConnection()
            .flatMap(_ => 
                this.transportLongPolling<IStreamMessage>()
                .repeat()
                .retryWhen(error$ => error$
                    .mergeMap(error => {
                        if ((error.status === 0) || (error.status === 304)) {
                            return Observable.of(error);
                        } else {
                            this.connectionStatus$.next(ConnectionStatus.Offline);
                            return Observable.throw(error);
                        }
                    })
                    .delay(1)
                )
            )
            .flatMap(message => this.observableMessage(message))
            .catch(error => {
                return Observable.of(null);
            });
    }

    private transportLongPolling<T>() {
        return Observable.create((subscriber: Subscriber<T>) => {
            let params = {
                crossDomain: this.isCrossDomain(),
                url: this.getSubscriberUrl(TransportType.LongPolling),
                headers: this.getRequestHeaders()
            };

            Observable.ajax({
                method: "GET",
                url: params.url,
                timeout: this.timeout * 2,
                crossDomain: params.crossDomain,
                headers: {
                    ...params.headers,
                    "Accept": "application/json"
                },
            })
            .do((ajaxResponse: AjaxResponse) => {
                if (!this.messagesControlByArgument) {
                    this._etag = ajaxResponse.xhr.getResponseHeader('Etag');
                    this._lastModified = ajaxResponse.xhr.getResponseHeader('Last-Modified');
                }
            })
            .subscribe(
                ajaxResponse => {
                    if (ajaxResponse.response) {
                        subscriber.next(ajaxResponse.response)
                    }
                }, 
                error => {
                    subscriber.error(error);
                },

                () => {
                    subscriber.complete();
                }
            )
        }) as Observable<T>;        
    }

    private activityWebSocket$(): Observable<IStreamMessage> {
        return this.checkConnection()
            .flatMap(_ =>
                this.transportWebSocket<IStreamMessage>()
                    // .retryWhen(error$ => error$.mergeMap(error => this.reconnectToConversation()))
            )
            .flatMap(message => this.observableMessage(message))
    }

    private transportWebSocket<T>() {
        return Observable.create((subscriber: Subscriber<T>) => {
            const url = this.getSubscriberUrl(TransportType.WebSocket);
            Logger.debug("creating WebSocket", url);
            const wsCtor = (window['WebSocket']) ? window['WebSocket'] : window['MozWebSocket'];
            if (!wsCtor) { 
                throw new Error("WebSocket not supported"); 
            }

            let wsHasOpen = false;
            const ws = new wsCtor(url);
            let sub: Subscription;

            ws.onopen = open => {
                wsHasOpen = true;
                Logger.debug("WebSocket open", open);
                // Chrome is pretty bad at noticing when a WebSocket connection is broken.
                // If we periodically ping the server with empty messages, it helps Chrome 
                // realize when connection breaks, and close the socket. We then throw an
                // error, and that give us the opportunity to attempt to reconnect.
                // sub = Observable.interval(this.pinginterval).subscribe(_ => ws.send("ping"));
            }

            ws.onclose = close => {
                Logger.debug("WebSocket close", close);
                if (sub) {
                    sub.unsubscribe();
                }

                subscriber.error(close);
            }

            ws.onmessage = message => message.data && subscriber.next(JSON.parse(message.data));

            // This is the 'unsubscribe' method, which is called when this observable is disposed.
            // When the WebSocket closes itself, we throw an error, and this function is eventually called.
            // When the observable is closed first (e.g. when tearing down a WebChat instance) then 
            // we need to manually close the WebSocket.
            return () => {
                Logger.debug("WebSocket close");
                if (ws.readyState === 0 || ws.readyState === 1) ws.close();
            }            
        }) as Observable<T>;
    }

    private activityEventSource$(): Observable<IStreamMessage> {
        return this.checkConnection()
            .flatMap(_ =>
                this.transportEventSource<IStreamMessage>().share()
                    // .retryWhen(error$ => error$.mergeMap(error => this.reconnectToConversation()))
            )
            .flatMap(message => this.observableMessage(message));
    }

    private transportEventSource<T>() {
        return Observable.create((subscriber: Subscriber<T>) => {
            const url = this.getSubscriberUrl(TransportType.EventSource);
            Logger.debug("creating EventSource", url);
            const wsCtor = window['EventSource'];
            if (!wsCtor) { 
                throw new Error("EventSource not supported"); 
            }

            let esHasOpen = false;
            const es = new wsCtor(url);

            es.onopen = open => {
                esHasOpen = true;
                Logger.debug("EventSource open", open);
            }

            es.onerror = error => {
                if (esHasOpen && (es.readyState === 0)) {
                    Logger.debug("EventSource reconnect");
                } else {
                    Logger.debug("EventSource error", error);
                    subscriber.error(error);    
                }
            }

            es.onmessage = message => message.data && subscriber.next(JSON.parse(message.data));

            // This is the 'unsubscribe' method, which is called when this observable is disposed.
            // When the WebSocket closes itself, we throw an error, and this function is eventually called.
            // When the observable is closed first (e.g. when tearing down a WebChat instance) then 
            // we need to manually close the WebSocket.
            return () => {
                Logger.debug("EventSource close");
                if (es.readyState === 0 || es.readyState === 1) es.close();
            }            
        }) as Observable<T>;
    }
}

  