/**
 * lib/native-connect-hook.js — Native connect() Redirect
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Hooks libc connect() to redirect TCP traffic through a proxy.
 * Supports IPv4 (AF_INET) and IPv6 (AF_INET6) sockets.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: httptoolkit/native-connect-hook.js (credit Tim Perry, AGPL-3.0)
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('nativeConnect', 'Native connect() Redirect');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.nativeConnect === false) return;

    var _hookCount = 0;
    var _failCount = 0;

    var _PROXY_HOST = (_CFG && _CFG.proxy && _CFG.proxy.host) || (typeof PROXY_HOST !== 'undefined' ? PROXY_HOST : '127.0.0.1');
    var _PROXY_PORT = (_CFG && _CFG.proxy && _CFG.proxy.port) || (typeof PROXY_PORT !== 'undefined' ? PROXY_PORT : 8080);
    var _socks5    = (typeof PROXY_SUPPORTS_SOCKS5 !== 'undefined') ? PROXY_SUPPORTS_SOCKS5 :
                     (_CFG.PROXY_SUPPORTS_SOCKS5 || false);
    var _ignoredPorts = (typeof IGNORED_NON_HTTP_PORTS !== 'undefined') ? IGNORED_NON_HTTP_PORTS :
                        (_CFG.IGNORED_NON_HTTP_PORTS || []);

    var AF_INET  = 2;
    var AF_INET6 = 10;
    var SOCK_STREAM = 1; // TCP

    // Convert IPv4 address bytes to integer array
    function parseSockaddrIn(sa) {
        try {
            var family = sa.readU16();
            if (family !== AF_INET) return null;
            var port = ((sa.add(2).readU8() << 8) | sa.add(3).readU8());
            return { family: AF_INET, port: port };
        } catch (_) { return null; }
    }

    function parseSockaddrIn6(sa) {
        try {
            var family = sa.readU16();
            if (family !== AF_INET6) return null;
            var port = ((sa.add(2).readU8() << 8) | sa.add(3).readU8());
            return { family: AF_INET6, port: port };
        } catch (_) { return null; }
    }

    function isIgnoredPort(port) {
        if (_ignoredPorts.indexOf(port) !== -1) return true;
        // Always ignore DNS
        if (port === 53) return true;
        return false;
    }

    function rewriteSockaddrToProxy(sa, addrLen) {
        try {
            // Parse proxy host IP to bytes
            var parts = _PROXY_HOST.split('.');
            if (parts.length !== 4) return false; // IPv6 proxy not supported in simple mode
            // Rewrite as AF_INET sockaddr pointing to proxy
            sa.writeU16(AF_INET); // sa_family = AF_INET
            sa.add(2).writeU8((_PROXY_PORT >> 8) & 0xFF);
            sa.add(3).writeU8(_PROXY_PORT & 0xFF);
            sa.add(4).writeU8(parseInt(parts[0]));
            sa.add(5).writeU8(parseInt(parts[1]));
            sa.add(6).writeU8(parseInt(parts[2]));
            sa.add(7).writeU8(parseInt(parts[3]));
            return true;
        } catch (_) { return false; }
    }

    (function hookConnect() {
        try {
            var connectPtr = Module.findExportByName('libc.so', 'connect') ||
                             Module.findExportByName(null, 'connect');
            if (!connectPtr) return;

            Interceptor.attach(connectPtr, {
                onEnter: function (args) {
                    this._sa      = args[1];
                    this._addrLen = args[2].toInt32();
                    this._redirect = false;

                    try {
                        var sa = this._sa;
                        if (!sa || sa.isNull()) return;

                        var addr4 = parseSockaddrIn(sa);
                        var addr6  = addr4 ? null : parseSockaddrIn6(sa);
                        var parsed = addr4 || addr6;

                        if (!parsed) return;
                        if (isIgnoredPort(parsed.port)) return;

                        // Only redirect HTTP/HTTPS and common app ports
                        var httpPorts = [80, 443, 8080, 8443, 8000, 8888, 3000, 4000, 5000];
                        var shouldRedirect = httpPorts.indexOf(parsed.port) !== -1;

                        if (shouldRedirect) {
                            if (rewriteSockaddrToProxy(sa, this._addrLen)) {
                                this._redirect = true;
                                _log.debug('nativeConnect: redirected port ' + parsed.port + ' → proxy ' + _PROXY_HOST + ':' + _PROXY_PORT);
                            }
                        }
                    } catch (_) {}
                }
            });
            _hookCount++;
            _log.ok('nativeConnect: connect() proxy redirect active → ' + _PROXY_HOST + ':' + _PROXY_PORT);
        } catch (e) { _failCount++; _log.debug('nativeConnect: connect hook — ' + e); }
    })();

    console.log('[*] native-connect-hook: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('native-connect-hook.js loaded');
})();
