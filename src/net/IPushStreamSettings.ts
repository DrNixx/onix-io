export interface IPushStreamSettings {
    useSSL?: boolean;
    host?: string;
    port?: number;

    timeout?: number;
    pinginterval?: number;
    reconnectInterval?: number;
    autoReconnect?: boolean;

    lastEventId?: string;
    messagesPublishedAfter?: number;
    messagesControlByArgument?: boolean;
    tagArgument?: string;
    timeArgument?: string;
    eventIdArgument?: string;
    useJSONP?: boolean;

    urlPrefixPublisher?: string;
    urlPrefixStream?: string;
    urlPrefixEventsource?: string;
    urlPrefixLongpolling?: string;
    urlPrefixWebsocket?: string;

    jsonIdKey?: string;
    jsonChannelKey?: string;
    jsonTextKey?: string;
    jsonTagKey?: string;
    jsonTimeKey?: string;
    jsonEventIdKey?: string;

    modes?: string;

    channelsByArgument?: boolean;
    channelsArgument?: string;

    extraParams?: () => any;
}