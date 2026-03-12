/**
 * lib/05_ssl_bypass.js — Universal SSL Unpinning (20+ libraries)
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Comprehensive certificate pinning defeat for all major Android SSL/TLS stacks.
 * Based on httptoolkit/frida-interception-and-unpinning patterns.
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
        BYPASS_BUS.registerModule('05_ssl_bypass', 'Universal SSL Unpinning');
    }

    // ── Permissive TrustManager factory ──────────────────────────────────────
    function getCustomX509TrustManager() {
        var TrustManagerCls  = Java.use('javax.net.ssl.X509TrustManager');
        var trustManager = Java.registerClass({
            name: 'com.bypass.CustomTrustManager',
            implements: [TrustManagerCls],
            methods: {
                checkClientTrusted: function (_chain, _authType) {},
                checkServerTrusted: function (_chain, _authType) {},
                getAcceptedIssuers: function () { return []; }
            }
        });
        return trustManager.$new();
    }

    function getCustomTrustManagerFactory() {
        try {
            var TrustManagerFactory = Java.use('javax.net.ssl.TrustManagerFactory');
            var tmf  = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
            tmf.init(null);
            return tmf;
        } catch (_) { return null; }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Core Java SSL bypass hooks
    // ─────────────────────────────────────────────────────────────────────────
    var PINNING_FIXES = [
        // 1. javax X509TrustManager
        {
            className : 'javax.net.ssl.X509TrustManager',
            method    : 'checkServerTrusted',
            types     : ['[Ljava.security.cert.X509Certificate;', 'java.lang.String'],
            impl      : function () {}
        },
        // 2. SSLContext.init with permissive TrustManager
        {
            className : 'javax.net.ssl.SSLContext',
            method    : 'init',
            types     : ['[Ljavax.net.ssl.KeyManager;', '[Ljavax.net.ssl.TrustManager;', 'java.security.SecureRandom'],
            impl      : function (km, tms, sr) {
                try {
                    var custom = getCustomX509TrustManager();
                    this.init(km, [custom], sr);
                } catch (_) { this.init(km, tms, sr); }
            }
        },
        // 3. HttpsURLConnection hostname verifier + SSLSocketFactory
        {
            className : 'javax.net.ssl.HttpsURLConnection',
            method    : 'setSSLSocketFactory',
            types     : ['javax.net.ssl.SSLSocketFactory'],
            impl      : function (sf) {}
        },
        {
            className : 'javax.net.ssl.HttpsURLConnection',
            method    : 'setHostnameVerifier',
            types     : ['javax.net.ssl.HostnameVerifier'],
            impl      : function (hv) {}
        },
        // 4. OkHttp3 CertificatePinner.check (both overloads)
        {
            className : 'okhttp3.CertificatePinner',
            method    : 'check',
            types     : ['java.lang.String', 'java.util.List'],
            impl      : function () {}
        },
        {
            className : 'okhttp3.CertificatePinner',
            method    : 'check',
            types     : ['java.lang.String', '[Ljava.security.cert.Certificate;'],
            impl      : function () {}
        },
        {
            className : 'okhttp3.CertificatePinner',
            method    : 'check$okhttp',
            types     : ['java.lang.String', 'java.util.List'],
            impl      : function () {}
        },
        // 5. Android built-in OkHttp
        {
            className : 'com.android.okhttp.CertificatePinner',
            method    : 'check',
            types     : ['java.lang.String', '[Ljava.security.cert.Certificate;'],
            impl      : function () {}
        },
        // 6. Conscrypt
        {
            className : 'com.android.org.conscrypt.TrustManagerImpl',
            method    : 'verifyChain',
            impl      : function (chain, _ocspData, _tlsSctData, _hostname, _clientAuth, _session) {
                return chain;
            }
        },
        {
            className : 'com.android.org.conscrypt.CertPinManager',
            method    : 'isChainValid',
            impl      : function () { return true; }
        },
        // 7. Trustkit
        {
            className : 'com.datatheorem.android.trustkit.pinning.PinningTrustManager',
            method    : 'checkServerTrusted',
            impl      : function () {}
        },
        // 8. CertPathValidator
        {
            className : 'java.security.cert.CertPathValidator',
            method    : 'validate',
            impl      : function () { return null; }
        },
        // 9. NetworkSecurityPolicy
        {
            className : 'android.security.net.config.NetworkSecurityTrustManager',
            method    : 'checkServerTrusted',
            impl      : function () {}
        },
        {
            className : 'android.security.net.config.NetworkSecurityPolicy',
            method    : 'isCleartextTrafficPermitted',
            impl      : function () { return true; }
        },
        {
            className : 'android.security.net.config.NetworkSecurityPolicy',
            method    : 'isCleartextTrafficPermitted',
            types     : ['java.lang.String'],
            impl      : function () { return true; }
        },
        // 10. PhoneGap / Cordova SSL plugin
        {
            className : 'nl.xservices.plugins.sslCertificateChecker',
            method    : 'execute',
            impl      : function () { return true; }
        },
        // 11. IBM WorkLight
        {
            className : 'com.worklight.wlclient.api.WLClient',
            method    : 'pinTrustedCertificatePublicKey',
            impl      : function () {}
        },
        // 12. CWAC-Netsecurity
        {
            className : 'com.commonsware.cwac.netsecurity.CertPinManager',
            method    : 'isChainValid',
            impl      : function () { return true; }
        },
        // 13. Appmattus Certificate Transparency
        {
            className : 'com.appmattus.certificatetransparency.CTInterceptorBuilder',
            method    : 'build',
            impl      : function () { return null; }
        },
        // 14. Appcelerator
        {
            className : 'ti.modules.titanium.network.TiHTTPClient',
            method    : 'setCustomSSLContext',
            impl      : function () {}
        },
        // 15. WebView onReceivedSslError
        {
            className : 'android.webkit.WebViewClient',
            method    : 'onReceivedSslError',
            types     : ['android.webkit.WebView', 'android.webkit.SslErrorHandler', 'android.net.http.SslError'],
            impl      : function (_wv, handler, _err) { handler.proceed(); }
        }
    ];

    // ─────────────────────────────────────────────────────────────────────────
    // Apply all PINNING_FIXES
    // ─────────────────────────────────────────────────────────────────────────
    (function applyPinningFixes() {
        if (!Java.available) return;
        Java.perform(function () {
            PINNING_FIXES.forEach(function (fix) {
                try {
                    var cls    = Java.use(fix.className);
                    var method = fix.types
                        ? cls[fix.method].overload.apply(cls[fix.method], fix.types)
                        : cls[fix.method];
                    method.implementation = fix.impl;
                    _log.ok('ssl: hooked ' + fix.className + '.' + fix.method);
                } catch (e) {
                    _log.debug('ssl: skip ' + fix.className + '.' + fix.method + ' — ' + e.message);
                }
            });
        });
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // BoringSSL native hooks
    // ─────────────────────────────────────────────────────────────────────────
    (function hookBoringSSL() {
        var boringSslFunctions = [
            'SSL_CTX_set_custom_verify',
            'SSL_set_custom_verify',
            'SSL_CTX_set_cert_verify_callback',
            'SSL_get_verify_result'
        ];
        boringSslFunctions.forEach(function (sym) {
            try {
                var addr = Module.findExportByName(null, sym);
                if (!addr) return;
                if (sym === 'SSL_get_verify_result') {
                    Interceptor.attach(addr, {
                        onLeave: function (retval) { retval.replace(ptr(0)); } // X509_V_OK
                    });
                } else {
                    Interceptor.attach(addr, {
                        onEnter: function (args) {
                            // Replace callback with null-safe no-op
                            if (args.length >= 3) args[2] = ptr(0);
                        }
                    });
                }
                _log.ok('ssl: BoringSSL native hook — ' + sym);
            } catch (e) { _log.debug('ssl: BoringSSL ' + sym + ' — ' + e); }
        });
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // Auto-fallback: hook SSLPeerUnverifiedException + CertificateException
    // constructors to auto-patch unknown pinning at runtime
    // Based on httptoolkit/frida-interception-and-unpinning fallback pattern
    // ─────────────────────────────────────────────────────────────────────────
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
                    _log.hit('ssl-fallback: auto-patched ' + key);
                } catch (_) {}
            }

            // Hook SSLPeerUnverifiedException constructor
            try {
                var SSLPeerUnverified = Java.use('javax.net.ssl.SSLPeerUnverifiedException');
                SSLPeerUnverified.$init.overload('java.lang.String').implementation = function (msg) {
                    var trace = Java.use('java.lang.Thread').currentThread().getStackTrace();
                    for (var i = 2; i < Math.min(trace.length, 10); i++) {
                        var cls    = trace[i].getClassName();
                        var method = trace[i].getMethodName();
                        if (isOkHttpCheckMethod(cls, method)) {
                            tryPatchMethod(cls, method);
                        }
                    }
                    return this.$init(msg);
                };
                _log.ok('ssl-fallback: SSLPeerUnverifiedException auto-patcher active');
            } catch (e) { _log.debug('ssl-fallback: SSLPeerUnverifiedException hook — ' + e); }

            // Hook CertificateException constructor
            try {
                var CertException = Java.use('java.security.cert.CertificateException');
                CertException.$init.overload('java.lang.String').implementation = function (msg) {
                    var trace = Java.use('java.lang.Thread').currentThread().getStackTrace();
                    for (var i = 2; i < Math.min(trace.length, 10); i++) {
                        var cls    = trace[i].getClassName();
                        var method = trace[i].getMethodName();
                        if (isX509TrustManager(cls)) {
                            tryPatchMethod(cls, method);
                        }
                    }
                    return this.$init(msg);
                };
                _log.ok('ssl-fallback: CertificateException auto-patcher active');
            } catch (e) { _log.debug('ssl-fallback: CertificateException hook — ' + e); }
        });
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // Meta apps: proxygen pinning
    // ─────────────────────────────────────────────────────────────────────────
    (function hookMetaProxygen() {
        var metaLibs = ['libcoldstart.so', 'libstartup.so', 'libscrollmerged.so'];
        metaLibs.forEach(function (lib) {
            try {
                var addr = Module.findExportByName(lib, 'verifyWithMetrics');
                if (!addr) return;
                Interceptor.attach(addr, {
                    onLeave: function (retval) { retval.replace(ptr(0)); }
                });
                _log.ok('ssl: Meta proxygen hook in ' + lib);
            } catch (_) {}
        });
    })();

    _log.ok('05_ssl_bypass.js — universal SSL unpinning installed');
})();
