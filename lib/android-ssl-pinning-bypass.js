/**
 * lib/android-ssl-pinning-bypass.js — Java SSL Unpinning (20+ libraries)
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Comprehensive certificate pinning defeat for all major Android SSL/TLS stacks.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: httptoolkit/android-certificate-unpinning.js (credit Tim Perry, AGPL-3.0)
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('sslPinning', 'Java SSL Unpinning (20+ libs)');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.sslPinning === false) return;

    var _hookCount = 0;
    var _failCount = 0;

    var _certPem = (typeof CERT_PEM !== 'undefined') ? CERT_PEM : (_CFG.CERT_PEM || null);

    // Permissive TrustManager factory
    function getCustomX509TrustManager() {
        var TrustManagerCls = Java.use('javax.net.ssl.X509TrustManager');
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
        // 3. HttpsURLConnection
        {
            className : 'javax.net.ssl.HttpsURLConnection',
            method    : 'setSSLSocketFactory',
            types     : ['javax.net.ssl.SSLSocketFactory'],
            impl      : function () {}
        },
        {
            className : 'javax.net.ssl.HttpsURLConnection',
            method    : 'setHostnameVerifier',
            types     : ['javax.net.ssl.HostnameVerifier'],
            impl      : function () {}
        },
        // 4. OkHttp3 CertificatePinner
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
        // 6. Conscrypt TrustManagerImpl
        {
            className : 'com.android.org.conscrypt.TrustManagerImpl',
            method    : 'verifyChain',
            impl      : function (chain) { return chain; }
        },
        // 7. Conscrypt CertPinManager
        {
            className : 'com.android.org.conscrypt.CertPinManager',
            method    : 'isChainValid',
            impl      : function () { return true; }
        },
        // 8. Trustkit
        {
            className : 'com.datatheorem.android.trustkit.pinning.PinningTrustManager',
            method    : 'checkServerTrusted',
            impl      : function () {}
        },
        // 9. CertPathValidator
        {
            className : 'java.security.cert.CertPathValidator',
            method    : 'validate',
            impl      : function () { return null; }
        },
        // 10. NetworkSecurityTrustManager
        {
            className : 'android.security.net.config.NetworkSecurityTrustManager',
            method    : 'checkServerTrusted',
            impl      : function () {}
        },
        // 11. NetworkSecurityPolicy cleartext
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
        // 12. PhoneGap / Cordova SSL plugin
        {
            className : 'nl.xservices.plugins.sslCertificateChecker',
            method    : 'execute',
            impl      : function () { return true; }
        },
        // 13. IBM WorkLight
        {
            className : 'com.worklight.wlclient.api.WLClient',
            method    : 'pinTrustedCertificatePublicKey',
            impl      : function () {}
        },
        // 14. CWAC-Netsecurity
        {
            className : 'com.commonsware.cwac.netsecurity.CertPinManager',
            method    : 'isChainValid',
            impl      : function () { return true; }
        },
        // 15. Appmattus Certificate Transparency
        {
            className : 'com.appmattus.certificatetransparency.CTInterceptorBuilder',
            method    : 'build',
            impl      : function () { return null; }
        },
        // 16. Appcelerator
        {
            className : 'ti.modules.titanium.network.TiHTTPClient',
            method    : 'setCustomSSLContext',
            impl      : function () {}
        },
        // 17. WebView onReceivedSslError
        {
            className : 'android.webkit.WebViewClient',
            method    : 'onReceivedSslError',
            types     : ['android.webkit.WebView', 'android.webkit.SslErrorHandler', 'android.net.http.SslError'],
            impl      : function (_wv, handler, _err) { handler.proceed(); }
        },
        // 18. SSLSocket hostname verifier
        {
            className : 'javax.net.ssl.HostnameVerifier',
            method    : 'verify',
            types     : ['java.lang.String', 'javax.net.ssl.SSLSession'],
            impl      : function () { return true; }
        },
        // 19. Apache HTTP legacy
        {
            className : 'org.apache.http.conn.ssl.AbstractVerifier',
            method    : 'verify',
            types     : ['java.lang.String', '[Ljava.lang.String;', '[Ljava.lang.String;', 'boolean'],
            impl      : function () {}
        },
        // 20. Retrofit / OkHttp TrustRootIndex
        {
            className : 'okhttp3.internal.tls.RealTrustRootIndex',
            method    : 'trustRootIndex',
            impl      : function (_cert) { return null; }
        }
    ];

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
                    _hookCount++;
                    _log.ok('sslPinning: hooked ' + fix.className + '.' + fix.method);
                } catch (e) {
                    _log.debug('sslPinning: skip ' + fix.className + '.' + fix.method + ' — ' + e.message);
                }
            });

            // Conscrypt NetworkSecurityConfig — inject custom CA if CERT_PEM provided
            if (_certPem) {
                try {
                    var CertFactory = Java.use('java.security.cert.CertificateFactory');
                    var BAI         = Java.use('java.io.ByteArrayInputStream');
                    var cf  = CertFactory.getInstance('X.509');
                    var pemBytes = Java.use('android.util.Base64').decode(
                        _certPem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''),
                        0
                    );
                    var cert = cf.generateCertificate(BAI.$new(pemBytes));
                    var KeyStore = Java.use('java.security.KeyStore');
                    var ks = KeyStore.getInstance('AndroidCAStore');
                    ks.load(null, null);
                    ks.setCertificateEntry('bypass_injected_ca', cert);
                    _hookCount++;
                    _log.ok('sslPinning: custom CA injected from CERT_PEM');
                } catch (e) { _failCount++; _log.debug('sslPinning: CERT_PEM injection — ' + e); }
            }
        });
    })();

    console.log('[*] android-ssl-pinning-bypass: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('android-ssl-pinning-bypass.js loaded');
})();
