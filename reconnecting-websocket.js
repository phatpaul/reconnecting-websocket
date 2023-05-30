// MIT License:
//
// Copyright (c) 2010-2012, Joe Walnes
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

/**
 * This behaves like a WebSocket in every way, except if it fails to connect,
 * or it gets disconnected, it will repeatedly poll until it successfully connects
 * again.
 *
 * It is API compatible, so when you have:
 *   ws = new WebSocket('ws://....');
 * you can replace with:
 *   ws = new ReconnectingWebSocket('ws://....');
 *
 * The event stream will typically look like:
 *  onconnecting
 *  onopen
 *  onmessage
 *  onmessage
 *  onclose // lost connection
 *  onconnecting
 *  onopen  // sometime later...
 *  onmessage
 *  onmessage
 *  etc...
 *
 * It is API compatible with the standard WebSocket API, apart from the following members:
 *
 * - `bufferedAmount`
 * - `extensions`
 * - `binaryType`
 *
 * Latest version: https://github.com/phatpaul/reconnecting-websocket/
 * - Joe Walnes
 * - Modified by Paul Abbott and others to ES6 module and added types.
 *
 * Syntax
 * ======
 * const socket = new ReconnectingWebSocket(url, protocols, options);
 *
 * Parameters
 * ==========
 * url - The url you are connecting to, or a function to provide the function.
 * protocols - Optional string or array of protocols.
 * options - See below
 *
 * Options
 * =======
 * Options can either be passed upon instantiation or set after instantiation:
 *
 * const socket = new ReconnectingWebSocket(url, null, { debug: true, reconnectInterval: 4000 });
 *
 * or
 *
 * const socket = new ReconnectingWebSocket(url);
 * socket.debug = true;
 * socket.reconnectInterval = 4000;
 *
 *
 * @fileoverview
 */

const TAG = 'ReconnectingWebSocket';

/**
 * @param {WebSocket} ws 
 */
function logClose(ws) {
    let readState = "";
    if (ws) {
        switch (ws.readyState) {
            case ws.CLOSED:
                readState = "CLOSED";
                break;
            case ws.CLOSING:
                readState = "CLOSING";
                break;
            case ws.CONNECTING:
                readState = "CONNECTING";
                break;
            case ws.OPEN:
                readState = "OPEN";
            default:
        }
    }
    console.log(TAG, "ws.onclose() readyState: " + readState);
}

/** 
 * @typedef {Object} Options
 * @property {boolean=} debug Whether this instance should log debug messages. Accepts true or false. Default: false.
 * @property {boolean=} automaticOpen Whether or not the websocket should attempt to connect immediately upon instantiation. The socket can be manually opened or closed at any time using ws.open() and ws.close().
 * @property {number=} reconnectInterval The number of milliseconds to delay before attempting to reconnect. Accepts integer. Default: 1000.
 * @property {number=} maxReconnectInterval The maximum number of milliseconds to delay a reconnection attempt. Accepts integer. Default: 30000.
 * @property {number=} reconnectDecay The rate of increase of the reconnect delay. Allows reconnect attempts to back off when problems persist. Accepts integer or float. Default: 1.5.
 * @property {number=} timeoutInterval The maximum time in milliseconds to wait for a connection to succeed before closing and retrying. Accepts integer. Default: 2000.
 * @property {?number=} maxReconnectAttempts The maximum number of reconnection attempts to make. Unlimited if null.
 * @property {BinaryType=} binaryType The binary type, possible values 'blob' or 'arraybuffer', default 'blob'.
*/

/**
 * Constructor.
 * @constructor
 * @param {string | function():string} url The URL as resolved by the constructor. This is always an absolute URL. Read only.
 * @param {(string|!Array<string>)=} protocols Optional list of the name of the sub-protocol
 * @param {Options=} options Optional settings with options.
 */
function ReconnectingWebSocket(url, protocols, options = {}) {
    /**
     * Helper Function
     * @param {*} option 
     * @param {*} defaultVal 
     */
    function getOption(option, defaultVal) {
        return (typeof option !== 'undefined') ? (option) : (defaultVal);
    }

    // Default settings:

    /** @type {boolean} Whether this instance should log debug messages. */
    this.debug = getOption(options.debug, false);

    /** @type {boolean} Whether or not the websocket should attempt to connect immediately upon instantiation. */
    this.automaticOpen = getOption(options.automaticOpen, true);

    /** @type {number} The number of milliseconds to delay before attempting to reconnect. */
    this.reconnectInterval = getOption(options.reconnectInterval, 1000);

    /** @type {number} The maximum number of milliseconds to delay a reconnection attempt. */
    this.maxReconnectInterval = getOption(options.maxReconnectInterval, 30000);

    /** @type {number} The rate of increase of the reconnect delay. Allows reconnect attempts to back off when problems persist. */
    this.reconnectDecay = getOption(options.reconnectDecay, 1.5);

    /** @type {number} The maximum time in milliseconds to wait for a connection to succeed before closing and retrying. */
    this.timeoutInterval = getOption(options.timeoutInterval, 5000);

    /** @type {?number} The maximum number of reconnection attempts to make. Unlimited if null. */
    this.maxReconnectAttempts = getOption(options.maxReconnectAttempts, null);

    /**@type {BinaryType} The binary type, possible values 'blob' or 'arraybuffer', default 'blob'.  */
    this.binaryType = getOption(options.binaryType, 'blob');


    // These should be treated as read-only properties:

    /** @type {function():string} The URL as resolved by the constructor, or a function to return the current url. This is always an absolute URL. Read only. */
    this.getUrl = (typeof (url) === 'function') ? (url) : (function () { return url; });

    /** @type {number} The number of attempted reconnects since starting, or the last successful connection. Read only. */
    this.reconnectAttempts = 0;

    /**
     * @type {number} The current state of the connection.
     * Can be one of: WebSocket.CONNECTING, WebSocket.OPEN, WebSocket.CLOSING, WebSocket.CLOSED
     * Read only.
     */
    this.readyState = WebSocket.CONNECTING;

    /**
     * @type {?string} A string indicating the name of the sub-protocol the server selected; this will be one of
     * the strings specified in the protocols parameter when creating the WebSocket object. Read only.
     */
    this.protocol = null;

    // Private state variables:

    const self = this;
    /** @type {?WebSocket} */
    let ws = null;
    let forcedClose = false;
    let timedOut = false;
    /** @type {number=} */
    let timeout;
    const eventTarget = document.createElement('div');

    // Wire up "on*" properties as event handlers:

    eventTarget.addEventListener('open', function (e) { self.onopen(e); });
    eventTarget.addEventListener('close', function (/**@type {CloseEvent}*/ e) { self.onclose(e); });
    eventTarget.addEventListener('connecting', function (e) { self.onconnecting(e); });
    eventTarget.addEventListener('message', function (/**@type {MessageEvent}*/ e) { self.onmessage(e); });
    eventTarget.addEventListener('error', function (e) { self.onerror(e); });

    // Expose the API required by EventTarget:

    this.addEventListener = eventTarget.addEventListener.bind(eventTarget);
    this.removeEventListener = eventTarget.removeEventListener.bind(eventTarget);
    this.dispatchEvent = eventTarget.dispatchEvent.bind(eventTarget);

    /**
     * This function generates an event that is compatible with standard
     * compliant browsers and IE9 - IE11
     *
     * This will prevent the error:
     * Object doesn't support this action
     *
     * http://stackoverflow.com/questions/19345392/why-arent-my-parameters-getting-passed-through-to-a-dispatched-event/19345563#19345563
     * @param {string} s The name that the event should use
     * @param {Object=} args an optional object that the event will use
     */
    function generateCustomEvent(s, args) {
        //let evt = document.createEvent("CustomEvent");
        //evt.initCustomEvent(s, false, false, args);
        const evt = new CustomEvent(s, { detail: args });
        return evt;
    };

    /**
     * @param {boolean} reconnectAttempt 
     */
    this.open = function (reconnectAttempt) {
        clearTimeout(timeout);
        forcedClose = false;
        // if previous websocket not closed, don't open another one yet.  Close it and let the close event open it again.
        if (!!ws && ws.readyState !== WebSocket.CLOSED) {
            ws.close();
            return;
        }
        ws = new WebSocket(self.getUrl(), protocols || []);
        ws.binaryType = self.binaryType;

        if (reconnectAttempt) {
            if (self.maxReconnectAttempts && self.reconnectAttempts > self.maxReconnectAttempts) {
                return;
            }
        } else {
            eventTarget.dispatchEvent(generateCustomEvent('connecting'));
            this.reconnectAttempts = 0;
        }

        if (self.debug || ReconnectingWebSocket.debugAll) {
            console.debug(TAG, 'attempt-connect', self.getUrl());
        }

        timeout = setTimeout(function () {
            if (self.debug || ReconnectingWebSocket.debugAll) {
                console.debug(TAG, 'connection-timeout', self.getUrl());
            }
            timedOut = true;
            if (!!ws && ws.readyState !== WebSocket.CLOSED) {
                ws.close();
            }
            timedOut = false;
        }, self.timeoutInterval);

        ws.onopen = function () {
            clearTimeout(timeout);
            // troubleshooting, double-check status
            if (!ws || ws.readyState != ws.OPEN) throw "state not open!";
            if (self.debug || ReconnectingWebSocket.debugAll) {
                console.debug(TAG, 'onopen', self.getUrl());
            }
            self.protocol = ws.protocol;
            self.readyState = WebSocket.OPEN;
            self.reconnectAttempts = 0;
            const e = generateCustomEvent('open', { isReconnect: reconnectAttempt });
            reconnectAttempt = false;
            eventTarget.dispatchEvent(e);
        };

        ws.onclose = function (event) {
            logClose(ws);
            clearTimeout(timeout);
            // troubleshooting, double-check status
            if (!ws || ws.readyState != ws.CLOSED) throw "state not closed!";
            ws = null;
            if (forcedClose) {
                self.readyState = WebSocket.CLOSED;
                eventTarget.dispatchEvent(new CloseEvent('close', { code: event.code, reason: event.reason, wasClean: event.wasClean }));
            } else {
                self.readyState = WebSocket.CONNECTING;
                const e = generateCustomEvent('connecting', { code: event.code, reason: event.reason, wasClean: event.wasClean });
                eventTarget.dispatchEvent(e);
                if (!reconnectAttempt && !timedOut) {
                    if (self.debug || ReconnectingWebSocket.debugAll) {
                        console.debug(TAG, 'onclose', self.getUrl());
                    }
                    eventTarget.dispatchEvent(new CloseEvent('close', { code: event.code, reason: event.reason, wasClean: event.wasClean }));
                }

                let timeoutNumber = self.reconnectInterval * Math.pow(self.reconnectDecay, self.reconnectAttempts);
                setTimeout(function () {

                    if (!forcedClose) {
                        self.reconnectAttempts++;
                        self.open(true);
                    }
                }, timeoutNumber > self.maxReconnectInterval ? self.maxReconnectInterval : timeoutNumber);
            }
        };
        ws.onmessage = function (event) {
            if (self.debug || ReconnectingWebSocket.debugAll) {
                console.debug(TAG, 'onmessage', self.getUrl(), event.data);
            }
            eventTarget.dispatchEvent(new MessageEvent('message', { data: event.data }));
        };
        ws.onerror = function (event) {
            if (self.debug || ReconnectingWebSocket.debugAll) {
                console.debug(TAG, 'onerror', self.getUrl(), event);
            }
            eventTarget.dispatchEvent(new Event('error'));
        };
    }

    // Whether or not to create a websocket upon instantiation
    if (this.automaticOpen == true) {
        this.open(false);
    }

    /**
     * Transmits data to the server over the WebSocket connection.
     *
     * @param {string} data a text string, ArrayBuffer or Blob to send to the server.
     */
    this.send = function (data) {
        if (ws) {
            if (self.debug || ReconnectingWebSocket.debugAll) {
                console.debug(TAG, 'send', self.getUrl(), data);
            }
            return ws.send(data);
        } else {
            throw 'INVALID_STATE_ERR : Pausing to reconnect websocket';
        }
    };

    /**
     * Closes the WebSocket connection or connection attempt, if any.
     * If the connection is already CLOSED, this method does nothing.
     * @param {number=} code
     * @param {string=} reason
     */
    this.close = function (code, reason) {
        // Default CLOSE_NORMAL code
        if (typeof code == 'undefined') {
            code = 1000;
        }
        forcedClose = true;
        if (ws) {
            ws.close(code, reason);
        }
    };

    /**
     * Additional public API method to refresh the connection if still open (close, re-open).
     * For example, if the app suspects bad data / missed heart beats, it can try to refresh.
     */
    this.refresh = function () {
        if (!!ws && ws.readyState !== WebSocket.CLOSED) {
            ws.close();
        }
    };
}

/**
 * An event listener to be called when the WebSocket connection's readyState changes to OPEN;
 * this indicates that the connection is ready to send and receive data.
 * @param {Event} event
 */
ReconnectingWebSocket.prototype.onopen = function (event) { };
/** An event listener to be called when the WebSocket connection's readyState changes to CLOSED. 
 * @param {CloseEvent} event  */
ReconnectingWebSocket.prototype.onclose = function (event) { };
/** An event listener to be called when a connection begins being attempted.  
 * @param {Event} event  */
ReconnectingWebSocket.prototype.onconnecting = function (event) { };
/** An event listener to be called when a message is received from the server.  
 * @param {MessageEvent} event  */
ReconnectingWebSocket.prototype.onmessage = function (event) { };
/** An event listener to be called when an error occurs. 
 * @param {Event} event  */
ReconnectingWebSocket.prototype.onerror = function (event) { };

/**
 * Whether all instances of ReconnectingWebSocket should log debug messages.
 * Setting this to true is the equivalent of setting all instances of ReconnectingWebSocket.debug to true.
 */
ReconnectingWebSocket.debugAll = false;

ReconnectingWebSocket.CONNECTING = WebSocket.CONNECTING;
ReconnectingWebSocket.OPEN = WebSocket.OPEN;
ReconnectingWebSocket.CLOSING = WebSocket.CLOSING;
ReconnectingWebSocket.CLOSED = WebSocket.CLOSED;

export default ReconnectingWebSocket;
