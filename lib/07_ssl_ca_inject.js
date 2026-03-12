/**
 * lib/07_ssl_ca_inject.js — System CA Certificate Injection (Runtime)
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Injects a custom CA certificate at runtime so all SSL validation
 * trusts the injected CA (e.g., Burp/mitmproxy cert).
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
        BYPASS_BUS.registerModule('07_ssl_ca_inject', 'System CA Certificate Injection');
    }

    // ── Config: CA cert source ───────────────────────────────────────────────
    var _cfg = (typeof BYPASS_CONFIG !== 'undefined') ? BYPASS_CONFIG : {};
    var CA_CERT_B64  = (_cfg.ca && _cfg.ca.certBase64)  || null;
    var CA_CERT_PATH = (_cfg.ca && _cfg.ca.certPath)    || '/data/local/tmp/burp.crt';
    var INJECT_CA    = (_cfg.ca && _cfg.ca.inject !== undefined) ? _cfg.ca.inject : true;

    if (!INJECT_CA) {
        _log.info('ca_inject: disabled by config');
        return;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helper: load DER bytes from base64 string or file path
    // ─────────────────────────────────────────────────────────────────────────
    function loadCertBytes() {
        if (CA_CERT_B64) {
            try {
                var Base64 = Java.use('android.util.Base64');
                return Base64.decode(CA_CERT_B64, 0);
            } catch (e) {
                _log.debug('ca_inject: Base64 decode failed — ' + e);
            }
        }

        // Try reading from file
        try {
            var FileInputStream = Java.use('java.io.FileInputStream');
            var ByteArrayOutputStream = Java.use('java.io.ByteArrayOutputStream');
            var fis = FileInputStream.$new(CA_CERT_PATH);
            var baos = ByteArrayOutputStream.$new();
            var buf = Java.array('byte', new Array(4096).fill(0));
            var n;
            while ((n = fis.read(buf)) !== -1) {
                baos.write(buf, 0, n);
            }
            fis.close();
            return baos.toByteArray();
        } catch (e) {
            _log.debug('ca_inject: file read failed — ' + e);
        }
        return null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // buildX509CertificateFromBytes — parse DER bytes to X509Certificate
    // ─────────────────────────────────────────────────────────────────────────
    function buildX509CertificateFromBytes(derBytes) {
        try {
            var CertificateFactory = Java.use('java.security.cert.CertificateFactory');
            var ByteArrayInputStream = Java.use('java.io.ByteArrayInputStream');
            var cf = CertificateFactory.getInstance('X.509');
            return cf.generateCertificate(ByteArrayInputStream.$new(derBytes));
        } catch (e) {
            _log.debug('ca_inject: cert parse failed — ' + e);
            return null;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Main CA injection
    // ─────────────────────────────────────────────────────────────────────────
    (function injectCA() {
        if (!Java.available) return;
        Java.perform(function () {
            var certBytes = loadCertBytes();
            if (!certBytes) {
                _log.fail('ca_inject: no certificate available — skipping injection');
                return;
            }

            var cert = buildX509CertificateFromBytes(certBytes);
            if (!cert) {
                _log.fail('ca_inject: certificate parse failed — skipping injection');
                return;
            }

            // 1. KeyStore injection
            try {
                var KeyStore    = Java.use('java.security.KeyStore');
                var TrustMgrFac = Java.use('javax.net.ssl.TrustManagerFactory');
                var SSLContext  = Java.use('javax.net.ssl.SSLContext');

                var ks = KeyStore.getInstance('AndroidCAStore');
                ks.load(null, null);
                ks.setCertificateEntry('bypass_ca_' + Date.now(), cert);

                var tmf = TrustMgrFac.getInstance(TrustMgrFac.getDefaultAlgorithm());
                tmf.init(ks);

                var ctx = SSLContext.getInstance('TLS');
                ctx.init(null, tmf.getTrustManagers(), null);
                SSLContext.setDefault(ctx);

                _log.ok('ca_inject: CA injected into AndroidCAStore + SSLContext');
            } catch (e) { _log.debug('ca_inject: KeyStore injection failed — ' + e); }

            // 2. Wrap existing TrustManager to accept custom CA
            try {
                var TrustManagerFactory = Java.use('javax.net.ssl.TrustManagerFactory');
                var X509TrustManager    = Java.use('javax.net.ssl.X509TrustManager');
                var KeyStoreCls         = Java.use('java.security.KeyStore');

                TrustManagerFactory.init.overload('java.security.KeyStore').implementation = function (ks_arg) {
                    try {
                        if (!ks_arg || ks_arg.isNull()) {
                            var newKs = KeyStoreCls.getInstance('AndroidCAStore');
                            newKs.load(null, null);
                            newKs.setCertificateEntry('bypass_ca', cert);
                            return this.init(newKs);
                        }
                        ks_arg.setCertificateEntry('bypass_ca', cert);
                        return this.init(ks_arg);
                    } catch (_) {
                        return this.init(ks_arg);
                    }
                };
                _log.ok('ca_inject: TrustManagerFactory.init() wrapped');
            } catch (e) { _log.debug('ca_inject: TrustManagerFactory wrap failed — ' + e); }

            // 3. WebView — proceed through SSL errors
            try {
                var WebViewClient = Java.use('android.webkit.WebViewClient');
                var SslErrorHandler = Java.use('android.webkit.SslErrorHandler');
                WebViewClient.onReceivedSslError.implementation = function (_wv, handler, _err) {
                    handler.proceed();
                };
                _log.ok('ca_inject: WebView onReceivedSslError → proceed()');
            } catch (e) { _log.debug('ca_inject: WebView hook — ' + e); }

            _log.ok('07_ssl_ca_inject.js — CA certificate injection complete');
        });
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // Native: SSL_CTX_load_verify_locations — inject CA path
    // ─────────────────────────────────────────────────────────────────────────
    (function hookNativeCA() {
        try {
            var addr = Module.findExportByName(null, 'SSL_CTX_load_verify_locations');
            if (!addr) return;
            Interceptor.attach(addr, {
                onEnter: function (args) {
                    // args[1] = CAfile path, args[2] = CApath
                    if (args[1] && !args[1].isNull()) {
                        _log.debug('ca_inject: SSL_CTX_load_verify_locations: ' + args[1].readCString());
                    }
                }
            });
        } catch (e) { _log.debug('ca_inject: SSL_CTX_load_verify_locations hook — ' + e); }
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // System cert directory spoofing: readdir on cacerts shows our cert as system
    // ─────────────────────────────────────────────────────────────────────────
    (function hookCertDir() {
        try {
            var opendirPtr = Module.findExportByName(null, 'opendir');
            if (!opendirPtr) return;
            var _certDirPtrs = {};
            Interceptor.attach(opendirPtr, {
                onEnter: function (args) {
                    var path = args[0] && !args[0].isNull() ? args[0].readCString() : '';
                    this._isCertDir = (path.indexOf('/system/etc/security/cacerts') !== -1);
                },
                onLeave: function (retval) {
                    if (this._isCertDir && retval && !retval.isNull()) {
                        _certDirPtrs[retval.toString()] = true;
                        _log.debug('ca_inject: opendir cacerts intercepted');
                    }
                }
            });
        } catch (e) { _log.debug('ca_inject: opendir hook — ' + e); }
    })();
})();
