import isFunction = require('lodash/isFunction');

// A few vars used in non-awesome browsers.
let last_hash = null;
let saved_hash = null;
let cache_bust = 1;
let listenerLoop: number = 0;

// A var used in awesome browsers.
let rm_callback = null;

const _postMessage = 'postMessage';
const _addEventListener = 'addEventListener';
const _removeEventListener = 'removeEventListener';
const _attachEvent = 'attachEvent';
const _detachEvent = 'attachEvent';

let p_receiveMessage;

const has_postMessage = window[_postMessage];

export const onixPostMessage = function(message, target_url: string, target?: Window) {
    if (!target_url) { 
        return; 
    }

    message = typeof message === 'string' ? message : JSON.stringify(message);

    // Default to parent if unspecified.
    target = target || parent;

    if (has_postMessage) {
        // The browser supports window.postMessage, so call it with a targetOrigin
        // set appropriately, based on the target_url parameter.
        var url = target_url.replace(/([^:]+:\/\/[^\/]+).*/, '$1');
        target[_postMessage](message, url);
    } else if (target_url) {
        // The browser does not support window.postMessage, so set the location
        // of the target to target_url#message. A bit ugly, but it works! A cache
        // bust parameter is added to ensure that repeat messages trigger the
        // callback.
        target.location.hash = '#' + (+new Date) + (cache_bust++) + '&' + message;
    }
};

export const onixReceiveMessage = p_receiveMessage = function(callback, source_origin, delay) {
    if (has_postMessage) {
        // Since the browser supports window.postMessage, the callback will be
        // bound to the actual event associated with window.postMessage.

        if (callback) {
            // Unbind an existing callback if it exists.
            rm_callback && p_receiveMessage();

            // Bind the callback. A reference to the callback is stored for ease of unbinding.
            rm_callback = function(e) {
                if ((typeof source_origin === 'string' && e.origin !== source_origin)
                    || (isFunction(source_origin) && source_origin(e.origin) === false)) {
                    return false;
                }
                callback(e);
            };
        }

        if (window[_addEventListener]) {
            let methodName = callback ? _addEventListener : _removeEventListener; 
            window[methodName]('message', rm_callback, false);
        } else {
            let methodName = callback ? _attachEvent : _detachEvent;
            window[methodName]('onmessage', rm_callback);
        }
    } else {
        // Since the browser sucks, a polling loop will be started, and the
        // callback will be called whenever the location.hash changes.
        listenerLoop && clearInterval(listenerLoop);
        listenerLoop = null;
        saved_hash = document.location.hash;

        if (callback) {
            saved_hash = document.location.hash;
            delay = typeof source_origin === 'number' ? source_origin : typeof delay === 'number' ? delay : 100;
            listenerLoop = setInterval(function() {
                var hash = document.location.hash, re = /^#?\d+&/;
                if (hash !== last_hash && re.test(hash)) {
                    last_hash = hash;
                    callback({ data: hash.replace(re, '') });
                    clearInterval(listenerLoop);
                    document.location.hash = saved_hash;
                }
            }, delay);
        }
    }
};