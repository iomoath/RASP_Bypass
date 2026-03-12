/**
 * lib/native-tls-hook.js — Native BoringSSL/OpenSSL Hooks
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Hooks BoringSSL/OpenSSL native TLS verification functions across
 * all loaded native libraries.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: httptoolkit/native-tls-hook.js (credit Tim Perry, AGPL-3.0)
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('nativeTls', 'Native BoringSSL/OpenSSL Hooks');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.nativeTls === false) return;

    var TARGET_LIBS = [
        'libboringssl.dylib',
        'libsscronet.so',
        'boringssl',
        'libssl.so',
        null  // search all modules
    ];

    // NativeCallback: always return SSL_VERIFY_OK (0)
    var noop_verify_cb = new NativeCallback(function (_ssl, _out_alert) {
        return 0; // ssl_verify_ok
    }, 'int', ['pointer', 'pointer']);

    // NativeCallback for SSL_CTX_set_cert_verify_callback callback arg
    var noop_cert_verify_cb = new NativeCallback(function (_store_ctx, _arg) {
        return 1; // X509 verification success
    }, 'int', ['pointer', 'pointer']);

    function hookLib(libName) {
        // SSL_CTX_set_custom_verify
        try {
            var addr = Module.findExportByName(libName, 'SSL_CTX_set_custom_verify');
            if (addr) {
                Interceptor.attach(addr, {
                    onEnter: function (args) {
                        // Replace the callback with our no-op
                        args[2] = noop_verify_cb;
                    }
                });
                _log.ok('nativeTls: SSL_CTX_set_custom_verify hooked (' + (libName || 'global') + ')');
            }
        } catch (e) { _log.debug('nativeTls: SSL_CTX_set_custom_verify in ' + libName + ' — ' + e); }

        // SSL_set_custom_verify
        try {
            var addr2 = Module.findExportByName(libName, 'SSL_set_custom_verify');
            if (addr2) {
                Interceptor.attach(addr2, {
                    onEnter: function (args) {
                        args[2] = noop_verify_cb;
                    }
                });
                _log.ok('nativeTls: SSL_set_custom_verify hooked (' + (libName || 'global') + ')');
            }
        } catch (e) { _log.debug('nativeTls: SSL_set_custom_verify in ' + libName + ' — ' + e); }

        // SSL_CTX_set_cert_verify_callback
        try {
            var addr3 = Module.findExportByName(libName, 'SSL_CTX_set_cert_verify_callback');
            if (addr3) {
                Interceptor.attach(addr3, {
                    onEnter: function (args) {
                        args[1] = noop_cert_verify_cb;
                        args[2] = ptr(0);
                    }
                });
                _log.ok('nativeTls: SSL_CTX_set_cert_verify_callback hooked (' + (libName || 'global') + ')');
            }
        } catch (e) { _log.debug('nativeTls: SSL_CTX_set_cert_verify_callback in ' + libName + ' — ' + e); }

        // SSL_get_verify_result — return X509_V_OK (0)
        try {
            var addr4 = Module.findExportByName(libName, 'SSL_get_verify_result');
            if (addr4) {
                Interceptor.attach(addr4, {
                    onLeave: function (retval) { retval.replace(ptr(0)); }
                });
                _log.ok('nativeTls: SSL_get_verify_result hooked (' + (libName || 'global') + ')');
            }
        } catch (e) { _log.debug('nativeTls: SSL_get_verify_result in ' + libName + ' — ' + e); }
    }

    // Inline waitForModule fallback
    function waitForModule(name, timeoutMs) {
        if (typeof BYPASS_UTILS !== 'undefined' && BYPASS_UTILS.waitForModule) {
            return BYPASS_UTILS.waitForModule(name, timeoutMs);
        }
        return new Promise(function (resolve, reject) {
            var deadline = Date.now() + (timeoutMs || 10000);
            function attempt() {
                var mod = Process.findModuleByName(name);
                if (mod) { resolve(mod); return; }
                if (Date.now() >= deadline) { reject(new Error('Timeout: ' + name)); return; }
                setTimeout(attempt, 300);
            }
            attempt();
        });
    }

    // Hook all target libraries immediately
    TARGET_LIBS.forEach(function (lib) {
        hookLib(lib);
    });

    // Also hook when specific libs load later
    ['libssl.so', 'libboringssl.so', 'libsscronet.so'].forEach(function (lib) {
        if (!Process.findModuleByName(lib)) {
            waitForModule(lib, 15000).then(function () {
                hookLib(lib);
            }).catch(function () {});
        }
    });

    _log.ok('native-tls-hook.js loaded');
})();
