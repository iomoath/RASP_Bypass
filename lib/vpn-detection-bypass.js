/**
 * lib/vpn-detection-bypass.js — VPN Detection Bypass
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Hides VPN connections at both Java and native layers.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: RASP_auditor module 11
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('vpn', 'VPN Detection Bypass');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.vpn === false) return;

    var VPN_IFACE_PREFIXES = ['tun', 'ppp', 'tap'];

    // 1. NetworkInterface.getNetworkInterfaces() — filter VPN interfaces
    (function hookNetworkInterface() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var NetworkInterface = Java.use('java.net.NetworkInterface');
                NetworkInterface.getNetworkInterfaces.implementation = function () {
                    var ifaces = this.getNetworkInterfaces();
                    if (!ifaces) return ifaces;
                    var ArrayList   = Java.use('java.util.ArrayList');
                    var Collections = Java.use('java.util.Collections');
                    var filtered    = ArrayList.$new();
                    while (ifaces.hasMoreElements()) {
                        var iface = ifaces.nextElement();
                        var name  = iface.getName();
                        var hide  = false;
                        for (var i = 0; i < VPN_IFACE_PREFIXES.length; i++) {
                            if (name.indexOf(VPN_IFACE_PREFIXES[i]) !== -1) { hide = true; break; }
                        }
                        if (!hide) filtered.add(iface);
                    }
                    return Collections.enumeration(filtered);
                };
                _log.ok('vpn: NetworkInterface VPN filtering active');
            } catch (e) { _log.debug('vpn: NetworkInterface hook — ' + e); }
        });
    })();

    // 2. NetworkCapabilities.hasTransport(TRANSPORT_VPN) → false
    (function hookNetworkCapabilities() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var NetworkCapabilities = Java.use('android.net.NetworkCapabilities');
                var TRANSPORT_VPN = 4;
                NetworkCapabilities.hasTransport.implementation = function (transport) {
                    if (transport === TRANSPORT_VPN) return false;
                    return this.hasTransport(transport);
                };
                _log.ok('vpn: NetworkCapabilities TRANSPORT_VPN hidden');
            } catch (e) { _log.debug('vpn: NetworkCapabilities hook — ' + e); }
        });
    })();

    // 3. ConnectivityManager — hide TYPE_VPN network info
    (function hookConnectivityManager() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var CM = Java.use('android.net.ConnectivityManager');
                var TYPE_VPN = 17;
                CM.getActiveNetworkInfo.implementation = function () {
                    var info = this.getActiveNetworkInfo();
                    if (info !== null && info.getType() === TYPE_VPN) return null;
                    return info;
                };
                _log.ok('vpn: ConnectivityManager TYPE_VPN hidden');
            } catch (e) { _log.debug('vpn: ConnectivityManager hook — ' + e); }
        });
    })();

    // 4. /proc/net/if_inet6 — filter VPN interface lines
    (function hookProcNetIfInet6() {
        try {
            var openatPtr = Module.findExportByName(null, 'openat');
            if (!openatPtr) return;
            var _fdSet = {};

            Interceptor.attach(openatPtr, {
                onEnter: function (args) {
                    var path = safeReadStr(args[1]);
                    this._isIfInet6 = (path.indexOf('/proc/net/if_inet6') !== -1);
                },
                onLeave: function (retval) {
                    if (this._isIfInet6 && retval.toInt32() > 0) _fdSet[retval.toInt32()] = true;
                }
            });

            var readPtr = Module.findExportByName(null, 'read');
            if (!readPtr) return;
            Interceptor.attach(readPtr, {
                onEnter: function (args) {
                    this._fd  = args[0].toInt32();
                    this._buf = args[1];
                },
                onLeave: function (retval) {
                    var n = retval.toInt32();
                    if (n <= 0 || !_fdSet[this._fd]) return;
                    try {
                        var s     = this._buf.readUtf8String(n);
                        var lines = s.split('\n');
                        var clean = lines.filter(function (l) {
                            for (var i = 0; i < VPN_IFACE_PREFIXES.length; i++) {
                                if (l.indexOf(VPN_IFACE_PREFIXES[i]) !== -1) return false;
                            }
                            return true;
                        });
                        if (clean.length !== lines.length) {
                            var out = clean.join('\n');
                            this._buf.writeUtf8String(out);
                            retval.replace(ptr(out.length));
                        }
                    } catch (_) {}
                }
            });
            _log.ok('vpn: /proc/net/if_inet6 VPN interface filtering active');
        } catch (e) { _log.debug('vpn: if_inet6 hook — ' + e); }
    })();

    // 5. System.getProperty proxy check suppression
    (function hookSystemProxyCheck() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var System = Java.use('java.lang.System');
                System.getProperty.overload('java.lang.String').implementation = function (key) {
                    if (key === 'socksProxyHost' || key === 'socksProxyPort') return null;
                    return this.getProperty(key);
                };
            } catch (e) { _log.debug('vpn: System.getProperty proxy check — ' + e); }
        });
    })();

    // 6. getifaddrs — monitor native interface enumeration
    (function hookGetifaddrs() {
        try {
            var getifaddrsPtr = Module.findExportByName('libc.so', 'getifaddrs');
            if (!getifaddrsPtr) return;
            Interceptor.attach(getifaddrsPtr, {
                onLeave: function (_retval) {
                    _log.debug('vpn: getifaddrs() called');
                }
            });
        } catch (e) { _log.debug('vpn: getifaddrs hook — ' + e); }
    })();

    _log.ok('vpn-detection-bypass.js loaded');
})();
