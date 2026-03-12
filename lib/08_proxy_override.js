/**
 * lib/08_proxy_override.js — Proxy Force Override
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Forces ALL app traffic through a configured proxy at every layer.
 * Works standalone OR via config.js orchestrator.
 */

(function () {
    'use strict';

    var _STANDALONE = (typeof BYPASS_BUS === 'undefined');
    var _u   = (typeof BYPASS_UTILS !== 'undefined') ? BYPASS_UTILS : null;
    var _log = _u ? _u.log : {
        ok: function(m){console.log('[+] '+m);},
        hit: function(m){console.log('[*] '+m);},
        fail: function(m){console.log('[-] '+m);},
        info: function(m){console.log('[i] '+m);},
        debug: function(m){}
    };

    if (typeof BYPASS_BUS !== 'undefined') {
        BYPASS_BUS.registerModule('08_proxy_override', 'Proxy Force Override');
    }

    // ── Proxy configuration ──────────────────────────────────────────────────
    var _cfg = (typeof BYPASS_CONFIG !== 'undefined') ? BYPASS_CONFIG : {};
    var PROXY_HOST = (_cfg.proxy && _cfg.proxy.host) || '127.0.0.1';
    var PROXY_PORT = (_cfg.proxy && _cfg.proxy.port) || 8080;
    var PROXY_TYPE = (_cfg.proxy && _cfg.proxy.type) || 'HTTP'; // HTTP or SOCKS5

    _log.info('proxy: target ' + PROXY_TYPE + ' ' + PROXY_HOST + ':' + PROXY_PORT);

    // ─────────────────────────────────────────────────────────────────────────
    // 1. System.getProperty — force proxy properties
    // ─────────────────────────────────────────────────────────────────────────
    (function hookSystemProperties() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var System = Java.use('java.lang.System');
                System.getProperty.overload('java.lang.String').implementation = function (key) {
                    if (key === 'http.proxyHost'  || key === 'https.proxyHost')  return PROXY_HOST;
                    if (key === 'http.proxyPort'  || key === 'https.proxyPort')  return String(PROXY_PORT);
                    if (key === 'socksProxyHost'  && PROXY_TYPE === 'SOCKS5')    return PROXY_HOST;
                    if (key === 'socksProxyPort'  && PROXY_TYPE === 'SOCKS5')    return String(PROXY_PORT);
                    return this.getProperty(key);
                };
                System.getProperty.overload('java.lang.String', 'java.lang.String').implementation = function (key, def) {
                    if (key === 'http.proxyHost'  || key === 'https.proxyHost')  return PROXY_HOST;
                    if (key === 'http.proxyPort'  || key === 'https.proxyPort')  return String(PROXY_PORT);
                    return this.getProperty(key, def);
                };
                _log.ok('proxy: System.getProperty() proxy override active');
            } catch (e) { _log.debug('proxy: System.getProperty hook — ' + e); }
        });
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 2. ProxySelector.getDefault() — return proxy for all URIs
    // ─────────────────────────────────────────────────────────────────────────
    (function hookProxySelector() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var ProxySelector = Java.use('java.net.ProxySelector');
                var InetSocketAddr = Java.use('java.net.InetSocketAddress');
                var Proxy = Java.use('java.net.Proxy');
                var ProxyType = Java.use('java.net.Proxy$Type');
                var ArrayList = Java.use('java.util.ArrayList');

                var proxyType = PROXY_TYPE === 'SOCKS5' ? ProxyType.SOCKS.value : ProxyType.HTTP.value;
                var sockAddr   = InetSocketAddr.$new(PROXY_HOST, PROXY_PORT);
                var proxy      = Proxy.$new(proxyType, sockAddr);

                ProxySelector.select.implementation = function (_uri) {
                    var list = ArrayList.$new();
                    list.add(proxy);
                    return list;
                };
                _log.ok('proxy: ProxySelector.select() override active');
            } catch (e) { _log.debug('proxy: ProxySelector hook — ' + e); }
        });
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 3. Proxy.NO_PROXY — replace with our proxy
    // ─────────────────────────────────────────────────────────────────────────
    (function hookNoProxy() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var InetSocketAddr = Java.use('java.net.InetSocketAddress');
                var Proxy          = Java.use('java.net.Proxy');
                var ProxyType      = Java.use('java.net.Proxy$Type');

                var proxyType = PROXY_TYPE === 'SOCKS5' ? ProxyType.SOCKS.value : ProxyType.HTTP.value;
                var sockAddr  = InetSocketAddr.$new(PROXY_HOST, PROXY_PORT);
                Proxy.NO_PROXY.value = Proxy.$new(proxyType, sockAddr);

                _log.ok('proxy: Proxy.NO_PROXY replaced with configured proxy');
            } catch (e) { _log.debug('proxy: Proxy.NO_PROXY hook — ' + e); }
        });
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 4. OkHttpClient.Builder.proxy() — force proxy on all OkHttp instances
    // ─────────────────────────────────────────────────────────────────────────
    (function hookOkHttpProxy() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var OkHttpBuilder  = Java.use('okhttp3.OkHttpClient$Builder');
                var InetSocketAddr = Java.use('java.net.InetSocketAddress');
                var Proxy          = Java.use('java.net.Proxy');
                var ProxyType      = Java.use('java.net.Proxy$Type');

                var proxyType = PROXY_TYPE === 'SOCKS5' ? ProxyType.SOCKS.value : ProxyType.HTTP.value;
                var sockAddr  = InetSocketAddr.$new(PROXY_HOST, PROXY_PORT);
                var ourProxy  = Proxy.$new(proxyType, sockAddr);

                OkHttpBuilder.build.implementation = function () {
                    this.proxy(ourProxy);
                    return this.build();
                };
                _log.ok('proxy: OkHttpClient.Builder.build() proxy injection active');
            } catch (e) { _log.debug('proxy: OkHttpClient.Builder hook — ' + e); }
        });
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 5. Settings.Global http_proxy spoofing
    // ─────────────────────────────────────────────────────────────────────────
    (function hookSettings() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var Settings = Java.use('android.provider.Settings$Global');
                var proxyVal = PROXY_HOST + ':' + PROXY_PORT;

                Settings.getString.overload('android.content.ContentResolver', 'java.lang.String').implementation = function (cr, name) {
                    if (name === 'http_proxy' || name === 'global_http_proxy_host') {
                        return proxyVal;
                    }
                    return this.getString(cr, name);
                };
                _log.ok('proxy: Settings.Global http_proxy spoofing active');
            } catch (e) { _log.debug('proxy: Settings.Global hook — ' + e); }
        });
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 6. NetworkSecurityPolicy.isCleartextTrafficPermitted() → true
    // ─────────────────────────────────────────────────────────────────────────
    (function hookCleartext() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var NSP = Java.use('android.security.net.config.NetworkSecurityPolicy');
                NSP.isCleartextTrafficPermitted.overload().implementation = function () { return true; };
                NSP.isCleartextTrafficPermitted.overload('java.lang.String').implementation = function () { return true; };
                _log.ok('proxy: cleartext traffic permitted');
            } catch (e) { _log.debug('proxy: NSP hook — ' + e); }
        });
    })();

    _log.ok('08_proxy_override.js — proxy force override installed');
})();
