/**
 * lib/android-proxy-override.js — Java Proxy Force Override
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Forces ALL app traffic through a configured proxy at every Java layer.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: httptoolkit/android-proxy-override.js (credit Tim Perry, AGPL-3.0)
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('proxyOverride', 'Java Proxy Force Override');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.proxyOverride === false) return;

    if (_CFG.forceProxy === false) {
        _log.info('proxyOverride: skipped (forceProxy=false)');
        return;
    }

    var _hookCount = 0;
    var _failCount = 0;

    var _proxyHost = (typeof PROXY_HOST !== 'undefined') ? PROXY_HOST : (_CFG.proxy ? _CFG.proxy.host : '127.0.0.1');
    var _proxyPort = (typeof PROXY_PORT !== 'undefined') ? PROXY_PORT : (_CFG.proxy ? _CFG.proxy.port : 8080);
    var _proxyType = (_CFG.proxy && _CFG.proxy.type) || 'HTTP';

    _log.info('proxyOverride: target ' + _proxyType + ' ' + _proxyHost + ':' + _proxyPort);

    // 1. System.getProperty — force proxy properties
    (function hookSystemProperties() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var System = Java.use('java.lang.System');
                System.getProperty.overload('java.lang.String').implementation = function (key) {
                    if (key === 'http.proxyHost'  || key === 'https.proxyHost')  return _proxyHost;
                    if (key === 'http.proxyPort'  || key === 'https.proxyPort')  return String(_proxyPort);
                    if (key === 'socksProxyHost'  && _proxyType === 'SOCKS5')    return _proxyHost;
                    if (key === 'socksProxyPort'  && _proxyType === 'SOCKS5')    return String(_proxyPort);
                    return this.getProperty(key);
                };
                System.getProperty.overload('java.lang.String', 'java.lang.String').implementation = function (key, def) {
                    if (key === 'http.proxyHost'  || key === 'https.proxyHost')  return _proxyHost;
                    if (key === 'http.proxyPort'  || key === 'https.proxyPort')  return String(_proxyPort);
                    return this.getProperty(key, def);
                };
                _hookCount++;
                _log.ok('proxyOverride: System.getProperty() proxy override active');
            } catch (e) { _failCount++; _log.debug('proxyOverride: System.getProperty hook — ' + e); }
        });
    })();

    // 2. ProxySelector.select() — return proxy for all URIs
    (function hookProxySelector() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var ProxySelector  = Java.use('java.net.ProxySelector');
                var InetSocketAddr = Java.use('java.net.InetSocketAddress');
                var ProxyCls       = Java.use('java.net.Proxy');
                var ProxyType      = Java.use('java.net.Proxy$Type');
                var ArrayList      = Java.use('java.util.ArrayList');

                var proxyType = _proxyType === 'SOCKS5' ? ProxyType.SOCKS.value : ProxyType.HTTP.value;
                var sockAddr  = InetSocketAddr.$new(_proxyHost, _proxyPort);
                var proxy     = ProxyCls.$new(proxyType, sockAddr);

                ProxySelector.select.implementation = function (_uri) {
                    var list = ArrayList.$new();
                    list.add(proxy);
                    return list;
                };
                _hookCount++;
                _log.ok('proxyOverride: ProxySelector.select() override active');
            } catch (e) { _failCount++; _log.debug('proxyOverride: ProxySelector hook — ' + e); }
        });
    })();

    // 3. Proxy.NO_PROXY — replace with our proxy
    (function hookNoProxy() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var InetSocketAddr = Java.use('java.net.InetSocketAddress');
                var ProxyCls       = Java.use('java.net.Proxy');
                var ProxyType      = Java.use('java.net.Proxy$Type');

                var proxyType = _proxyType === 'SOCKS5' ? ProxyType.SOCKS.value : ProxyType.HTTP.value;
                var sockAddr  = InetSocketAddr.$new(_proxyHost, _proxyPort);
                ProxyCls.NO_PROXY.value = ProxyCls.$new(proxyType, sockAddr);
                _hookCount++;
                _log.ok('proxyOverride: Proxy.NO_PROXY replaced');
            } catch (e) { _failCount++; _log.debug('proxyOverride: Proxy.NO_PROXY hook — ' + e); }
        });
    })();

    // 4. OkHttpClient.Builder.build() — force proxy
    (function hookOkHttpProxy() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var OkHttpBuilder  = Java.use('okhttp3.OkHttpClient$Builder');
                var InetSocketAddr = Java.use('java.net.InetSocketAddress');
                var ProxyCls       = Java.use('java.net.Proxy');
                var ProxyType      = Java.use('java.net.Proxy$Type');

                var proxyType = _proxyType === 'SOCKS5' ? ProxyType.SOCKS.value : ProxyType.HTTP.value;
                var sockAddr  = InetSocketAddr.$new(_proxyHost, _proxyPort);
                var ourProxy  = ProxyCls.$new(proxyType, sockAddr);

                OkHttpBuilder.build.implementation = function () {
                    this.proxy(ourProxy);
                    return this.build();
                };
                _hookCount++;
                _log.ok('proxyOverride: OkHttpClient.Builder.build() proxy injection active');
            } catch (e) { _failCount++; _log.debug('proxyOverride: OkHttpClient.Builder hook — ' + e); }
        });
    })();

    // 5. Settings.Global http_proxy spoofing
    (function hookSettings() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var Settings = Java.use('android.provider.Settings$Global');
                var proxyVal = _proxyHost + ':' + _proxyPort;
                Settings.getString.overload('android.content.ContentResolver', 'java.lang.String').implementation = function (cr, name) {
                    if (name === 'http_proxy' || name === 'global_http_proxy_host') return proxyVal;
                    return this.getString(cr, name);
                };
                _hookCount++;
                _log.ok('proxyOverride: Settings.Global http_proxy spoofing active');
            } catch (e) { _failCount++; _log.debug('proxyOverride: Settings.Global hook — ' + e); }
        });
    })();

    // 6. NetworkSecurityPolicy.isCleartextTrafficPermitted() → true
    (function hookCleartext() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var NSP = Java.use('android.security.net.config.NetworkSecurityPolicy');
                NSP.isCleartextTrafficPermitted.overload().implementation = function () { return true; };
                NSP.isCleartextTrafficPermitted.overload('java.lang.String').implementation = function () { return true; };
                _hookCount++;
                _log.ok('proxyOverride: cleartext traffic permitted');
            } catch (e) { _failCount++; _log.debug('proxyOverride: NSP hook — ' + e); }
        });
    })();

    console.log('[*] android-proxy-override: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('android-proxy-override.js loaded');
})();
