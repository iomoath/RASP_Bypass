/**
 * lib/android-ssl-pinning-bypass-fallback.js — Auto-Fallback SSL Patcher
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Runtime auto-detection and patching of unknown SSL pinning implementations.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: httptoolkit/android-certificate-unpinning-fallback.js (credit Tim Perry, AGPL-3.0)
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('sslFallback', 'Auto-Fallback SSL Patcher');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.sslFallback === false) return;

    var _hookCount = 0;
    var _failCount = 0;

    // Self-contained helpers — needed when running standalone without android-ssl-pinning-bypass.js
    var _buildX509CertificateFromBytes = (typeof buildX509CertificateFromBytes !== 'undefined')
        ? buildX509CertificateFromBytes
        : function(certBytes) {
            var ByteArrayInputStream = Java.use('java.io.ByteArrayInputStream');
            var CertFactory = Java.use('java.security.cert.CertificateFactory');
            var certFactory = CertFactory.getInstance('X.509');
            return certFactory.generateCertificate(ByteArrayInputStream.$new(certBytes));
        };

    var _getCustomX509TrustManager = (typeof getCustomX509TrustManager !== 'undefined')
        ? getCustomX509TrustManager
        : function() {
            var TrustManagerCls = Java.use('javax.net.ssl.X509TrustManager');
            var trustManager = Java.registerClass({
                name: 'com.bypass.FallbackTrustManager',
                implements: [TrustManagerCls],
                methods: {
                    checkClientTrusted: function (_chain, _authType) {},
                    checkServerTrusted: function (_chain, _authType) {},
                    getAcceptedIssuers: function () { return []; }
                }
            });
            return trustManager.$new();
        };

    (function buildUnhandledErrorPatcher() {
        if (!Java.available) return;
        Java.perform(function () {
            var _patched = {};

            function isOkHttpCheckMethod(cls, method) {
                return method.indexOf('check') !== -1 ||
                       method.indexOf('verify') !== -1 ||
                       cls.indexOf('CertificatePinner') !== -1 ||
                       cls.indexOf('PinningTrustManager') !== -1;
            }

            function isX509TrustManager(cls) {
                try {
                    var c = Java.use(cls);
                    return c['checkServerTrusted'] !== undefined;
                } catch (_) { return false; }
            }

            function tryPatchMethod(className, methodName) {
                var key = className + '#' + methodName;
                if (_patched[key]) return;
                try {
                    var cls    = Java.use(className);
                    var method = cls[methodName];
                    if (!method) return;
                    method.implementation = function () {};
                    _patched[key] = true;
                    _log.info('sslFallback: auto-patched ' + key);
                } catch (_) {}
            }

            // Hook SSLPeerUnverifiedException constructor → auto-patch caller
            try {
                var SSLPeerUnverified = Java.use('javax.net.ssl.SSLPeerUnverifiedException');
                SSLPeerUnverified.$init.overload('java.lang.String').implementation = function (msg) {
                    var trace = Java.use('java.lang.Thread').currentThread().getStackTrace();
                    for (var i = 2; i < Math.min(trace.length, 12); i++) {
                        var cls    = trace[i].getClassName();
                        var method = trace[i].getMethodName();
                        if (isOkHttpCheckMethod(cls, method)) tryPatchMethod(cls, method);
                    }
                    return this.$init(msg);
                };
                _hookCount++;
                _log.ok('sslFallback: SSLPeerUnverifiedException auto-patcher active');
            } catch (e) { _failCount++; _log.debug('sslFallback: SSLPeerUnverifiedException hook — ' + e); }

            // Hook CertificateException constructor → auto-patch X509TrustManager
            try {
                var CertException = Java.use('java.security.cert.CertificateException');
                CertException.$init.overload('java.lang.String').implementation = function (msg) {
                    var trace = Java.use('java.lang.Thread').currentThread().getStackTrace();
                    for (var i = 2; i < Math.min(trace.length, 12); i++) {
                        var cls    = trace[i].getClassName();
                        var method = trace[i].getMethodName();
                        if (isX509TrustManager(cls)) tryPatchMethod(cls, method);
                    }
                    return this.$init(msg);
                };
                _hookCount++;
                _log.ok('sslFallback: CertificateException auto-patcher active');
            } catch (e) { _failCount++; _log.debug('sslFallback: CertificateException hook — ' + e); }

            // Auto-detect OkHttp check methods via RuntimeException scanning
            try {
                var RuntimeException = Java.use('java.lang.RuntimeException');
                RuntimeException.$init.overload('java.lang.String').implementation = function (msg) {
                    if (msg && (msg.indexOf('Certificate pinning failure') !== -1 ||
                                msg.indexOf('pin verification failed') !== -1)) {
                        var trace = Java.use('java.lang.Thread').currentThread().getStackTrace();
                        for (var i = 2; i < Math.min(trace.length, 12); i++) {
                            var cls    = trace[i].getClassName();
                            var method = trace[i].getMethodName();
                            if (isOkHttpCheckMethod(cls, method)) tryPatchMethod(cls, method);
                        }
                    }
                    return this.$init(msg);
                };
                _hookCount++;
                _log.ok('sslFallback: RuntimeException SSL failure scanner active');
            } catch (e) { _failCount++; _log.debug('sslFallback: RuntimeException hook — ' + e); }

            // Auto-detect X509TrustManager implementations via classloader scanning
            try {
                Java.enumerateLoadedClasses({
                    onMatch: function (name) {
                        if (name.indexOf('TrustManager') !== -1 ||
                            name.indexOf('CertPinner') !== -1 ||
                            name.indexOf('CertificatePinner') !== -1) {
                            try {
                                var cls = Java.use(name);
                                if (cls.checkServerTrusted) {
                                    tryPatchMethod(name, 'checkServerTrusted');
                                }
                            } catch (_) {}
                        }
                    },
                    onComplete: function () {
                        _hookCount++;
                        _log.ok('sslFallback: class enumeration scan complete');
                    }
                });
            } catch (e) { _log.debug('sslFallback: class enumeration — ' + e); }
        });
    })();

    console.log('[*] android-ssl-pinning-bypass-fallback: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('android-ssl-pinning-bypass-fallback.js loaded');
})();
