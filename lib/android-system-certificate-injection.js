/**
 * lib/android-system-certificate-injection.js — System CA Certificate Injection
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Injects a custom CA certificate into the Android trust store at runtime
 * so all SSL validation trusts the injected CA (e.g., Burp/mitmproxy cert).
 * Works standalone OR via config.js orchestrator.
 *
 * Source: httptoolkit/android-system-certificate-injection.js (credit Tim Perry, AGPL-3.0)
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('certInjection', 'System CA Certificate Injection');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.certInjection === false) return;

    var _hookCount = 0;
    var _failCount = 0;

    var _certPem  = (typeof CERT_PEM !== 'undefined') ? CERT_PEM : (_CFG.CERT_PEM || null);
    var CA_CERT_PATH = (_CFG.ca && _CFG.ca.certPath) || '/data/local/tmp/burp.crt';

    function loadCertBytes() {
        if (_certPem) {
            try {
                var Base64 = Java.use('android.util.Base64');
                var stripped = _certPem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
                return Base64.decode(stripped, 0);
            } catch (e) { _failCount++; _log.debug('certInjection: PEM decode failed — ' + e); }
        }
        try {
            var FileInputStream    = Java.use('java.io.FileInputStream');
            var ByteArrayOutStream = Java.use('java.io.ByteArrayOutputStream');
            var fis  = FileInputStream.$new(CA_CERT_PATH);
            var baos = ByteArrayOutStream.$new();
            var buf  = Java.array('byte', new Array(4096).fill(0));
            var n;
            while ((n = fis.read(buf)) !== -1) baos.write(buf, 0, n);
            fis.close();
            return baos.toByteArray();
        } catch (e) { _failCount++; _log.debug('certInjection: file read failed — ' + e); }
        return null;
    }

    function buildX509Cert(derBytes) {
        try {
            var CertFactory = Java.use('java.security.cert.CertificateFactory');
            var BAI = Java.use('java.io.ByteArrayInputStream');
            var cf  = CertFactory.getInstance('X.509');
            return cf.generateCertificate(BAI.$new(derBytes));
        } catch (e) { _failCount++; _log.debug('certInjection: cert parse — ' + e); return null; }
    }

    // TrustedCertificateIndex class name variants across Android versions
    var TCI_CLASS_NAMES = [
        'com.android.org.conscrypt.TrustedCertificateIndex',
        'org.conscrypt.TrustedCertificateIndex',
        'com.android.org.bouncycastle.jce.provider.CertStoreIndexedList'
    ];

    function hookTrustedCertificateIndex(cert) {
        TCI_CLASS_NAMES.forEach(function (clsName) {
            try {
                var TCI = Java.use(clsName);

                // Hook $init — inject cert after construction
                if (TCI.$init) {
                    TCI.$init.implementation = function () {
                        this.$init();
                        try { this.index(cert); } catch (_) {}
                    };
                    _hookCount++;
                    _log.ok('certInjection: TrustedCertificateIndex.$init hooked (' + clsName + ')');
                }

                // Hook reset — re-inject after reset
                if (TCI.reset) {
                    TCI.reset.implementation = function () {
                        this.reset();
                        try { this.index(cert); } catch (_) {}
                    };
                    _hookCount++;
                    _log.ok('certInjection: TrustedCertificateIndex.reset hooked (' + clsName + ')');
                }
            } catch (_) {}
        });
    }

    (function injectCA() {
        if (!Java.available) return;
        Java.perform(function () {
            var certBytes = loadCertBytes();
            if (!certBytes) {
                _log.info('certInjection: no certificate available — using trust-all fallback');
            }

            var cert = certBytes ? buildX509Cert(certBytes) : null;

            // 1. KeyStore injection
            try {
                var KeyStore    = Java.use('java.security.KeyStore');
                var TrustMgrFac = Java.use('javax.net.ssl.TrustManagerFactory');
                var SSLContext  = Java.use('javax.net.ssl.SSLContext');

                var ks = KeyStore.getInstance('AndroidCAStore');
                ks.load(null, null);
                if (cert) ks.setCertificateEntry('bypass_ca_' + Date.now(), cert);

                var tmf = TrustMgrFac.getInstance(TrustMgrFac.getDefaultAlgorithm());
                tmf.init(ks);

                var ctx = SSLContext.getInstance('TLS');
                ctx.init(null, tmf.getTrustManagers(), null);
                SSLContext.setDefault(ctx);
                _hookCount++;
                _log.ok('certInjection: CA injected into AndroidCAStore + SSLContext');
            } catch (e) { _failCount++; _log.debug('certInjection: KeyStore injection — ' + e); }

            // 2. TrustedCertificateIndex hooks
            if (cert) hookTrustedCertificateIndex(cert);

            // 3. TrustManagerFactory.init wrapper
            try {
                var TrustManagerFactory = Java.use('javax.net.ssl.TrustManagerFactory');
                var KeyStoreCls         = Java.use('java.security.KeyStore');

                TrustManagerFactory.init.overload('java.security.KeyStore').implementation = function (ks_arg) {
                    try {
                        if (!ks_arg || ks_arg.isNull()) {
                            var newKs = KeyStoreCls.getInstance('AndroidCAStore');
                            newKs.load(null, null);
                            if (cert) newKs.setCertificateEntry('bypass_ca', cert);
                            return this.init(newKs);
                        }
                        if (cert) ks_arg.setCertificateEntry('bypass_ca', cert);
                        return this.init(ks_arg);
                    } catch (_) { return this.init(ks_arg); }
                };
                _hookCount++;
                _log.ok('certInjection: TrustManagerFactory.init() wrapped');
            } catch (e) { _failCount++; _log.debug('certInjection: TrustManagerFactory wrap — ' + e); }

            // 4. WebView — proceed through SSL errors
            try {
                var WebViewClient = Java.use('android.webkit.WebViewClient');
                WebViewClient.onReceivedSslError.implementation = function (_wv, handler, _err) {
                    handler.proceed();
                };
                _hookCount++;
                _log.ok('certInjection: WebView onReceivedSslError → proceed()');
            } catch (e) { _failCount++; _log.debug('certInjection: WebView hook — ' + e); }
        });
    })();

    console.log('[*] android-system-certificate-injection: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('android-system-certificate-injection.js loaded');
})();
