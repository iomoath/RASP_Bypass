/**
 * lib/http3-disable.js — HTTP/3 QUIC Blocking
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Blocks HTTP/3 (QUIC over UDP) to force HTTP/1.1 or HTTP/2 which
 * can be intercepted by standard proxies.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: meta-apps-ssl-pinning/fb_ssl_hooks_v2.js disableHTTP3()
 */

(function () {
    'use strict';

    var _STANDALONE = (typeof BYPASS_BUS === 'undefined');
    var _CFG = (typeof BYPASS_CONFIG !== 'undefined') ? BYPASS_CONFIG : {};
    var _DBG = _CFG.debug || false;
    var _SILENT = (_CFG.silent !== undefined) ? _CFG.silent : false;

    var _log = (typeof BYPASS_UTILS !== 'undefined') ? BYPASS_UTILS.log : {
        ok:    function(m) { if (!_SILENT) console.log('[+] ' + m); },
        info:  function(m) { if (!_SILENT) console.log('[*] ' + m); },
        debug: function(m) { if (_DBG) console.log('[D] ' + m); },
        fail:  function(m) { console.log('[-] ' + m); }
    };
    var safeReadStr = (typeof BYPASS_UTILS !== 'undefined') ? BYPASS_UTILS.safeReadStr : function(p) {
        if(!p||p.isNull())return''; try{return p.readUtf8String()||'';}catch(_){} try{return p.readCString()||'';}catch(_){} return'';
    };

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('http3Disable', 'HTTP/3 QUIC Blocking');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.http3Disable === false) return;

    var _hookCount = 0;
    var _failCount = 0;

    if (_CFG.BLOCK_HTTP3 === false) {
        _log.debug('http3Disable: BLOCK_HTTP3=false, skipping');
        return;
    }

    var AF_INET   = 2;
    var AF_INET6  = 10;
    var SOCK_DGRAM = 2;  // UDP
    var QUIC_PORT  = 443;
    var ECONNREFUSED = 111;
    var IPPROTO_QUIC = 261; // approximate; varies

    // Track UDP sockets
    var _udpSockets = {};

    // 1. socket() — track UDP socket creation
    (function hookSocket() {
        try {
            var socketPtr = Module.findExportByName('libc.so', 'socket') ||
                            Module.findExportByName(null, 'socket');
            if (!socketPtr) return;
            Interceptor.attach(socketPtr, {
                onEnter: function (args) {
                    this._family = args[0].toInt32();
                    this._type   = args[1].toInt32() & 0xF; // mask SOCK_NONBLOCK etc
                },
                onLeave: function (retval) {
                    var fd = retval.toInt32();
                    if (fd > 0 && this._type === SOCK_DGRAM &&
                       (this._family === AF_INET || this._family === AF_INET6)) {
                        _udpSockets[fd] = true;
                    }
                }
            });
            _hookCount++;
        } catch (e) { _failCount++; _log.debug('http3Disable: socket hook — ' + e); }
    })();

    // 2. connect() — block UDP connects on port 443 (QUIC)
    (function hookConnect() {
        try {
            var connectPtr = Module.findExportByName('libc.so', 'connect') ||
                             Module.findExportByName(null, 'connect');
            if (!connectPtr) return;
            Interceptor.attach(connectPtr, {
                onEnter: function (args) {
                    var fd = args[0].toInt32();
                    if (!_udpSockets[fd]) return;
                    try {
                        var sa   = args[1];
                        var port = (sa.add(2).readU8() << 8) | sa.add(3).readU8();
                        if (port === QUIC_PORT) this._blockQuic = true;
                    } catch (_) {}
                },
                onLeave: function (retval) {
                    if (this._blockQuic) {
                        retval.replace(ptr(-ECONNREFUSED));
                        _log.debug('http3Disable: blocked QUIC UDP connect on port 443');
                    }
                }
            });
            _hookCount++;
            _log.ok('http3Disable: connect() UDP/443 QUIC blocking active');
        } catch (e) { _failCount++; _log.debug('http3Disable: connect hook — ' + e); }
    })();

    // 3. sendto() — block UDP sends on port 443
    (function hookSendto() {
        try {
            var sendtoPtr = Module.findExportByName('libc.so', 'sendto') ||
                            Module.findExportByName(null, 'sendto');
            if (!sendtoPtr) return;
            Interceptor.attach(sendtoPtr, {
                onEnter: function (args) {
                    var fd = args[0].toInt32();
                    if (!_udpSockets[fd]) return;
                    try {
                        var sa = args[4]; // const struct sockaddr *dest_addr
                        if (!sa || sa.isNull()) return;
                        var port = (sa.add(2).readU8() << 8) | sa.add(3).readU8();
                        if (port === QUIC_PORT) this._blockQuic = true;
                    } catch (_) {}
                },
                onLeave: function (retval) {
                    if (this._blockQuic) retval.replace(ptr(-ECONNREFUSED));
                }
            });
            _hookCount++;
            _log.ok('http3Disable: sendto() UDP/443 QUIC blocking active');
        } catch (e) { _failCount++; _log.debug('http3Disable: sendto hook — ' + e); }
    })();

    // 4. setsockopt() — block IPPROTO_QUIC socket options
    (function hookSetsockopt() {
        try {
            var setsockoptPtr = Module.findExportByName('libc.so', 'setsockopt') ||
                                Module.findExportByName(null, 'setsockopt');
            if (!setsockoptPtr) return;
            Interceptor.attach(setsockoptPtr, {
                onEnter: function (args) {
                    var level = args[1].toInt32();
                    if (level === IPPROTO_QUIC) this._blockQuic = true;
                },
                onLeave: function (retval) {
                    if (this._blockQuic) retval.replace(ptr(-1));
                }
            });
            _hookCount++;
        } catch (e) { _failCount++; _log.debug('http3Disable: setsockopt hook — ' + e); }
    })();

    // 5. Java: OkHttpClient.Builder.protocols() — filter out HTTP/3
    (function hookOkHttpProtocols() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var OkHttpBuilder = Java.use('okhttp3.OkHttpClient$Builder');
                var Protocol      = Java.use('okhttp3.Protocol');
                var ArrayList     = Java.use('java.util.ArrayList');

                OkHttpBuilder.protocols.implementation = function (protocols) {
                    var filtered = ArrayList.$new();
                    for (var i = 0; i < protocols.size(); i++) {
                        var p = protocols.get(i);
                        // Keep only HTTP/1.1 and HTTP/2
                        if (p.toString().indexOf('h3') === -1 &&
                            p.toString().indexOf('quic') === -1) {
                            filtered.add(p);
                        }
                    }
                    return this.protocols(filtered);
                };
                _hookCount++;
                _log.ok('http3Disable: OkHttp HTTP/3 protocol filtering active');
            } catch (e) { _failCount++; _log.debug('http3Disable: OkHttp protocols hook — ' + e); }
        });
    })();

    console.log('[*] http3-disable: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('http3-disable.js loaded');
})();
