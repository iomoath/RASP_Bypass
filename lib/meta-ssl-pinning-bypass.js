/**
 * lib/meta-ssl-pinning-bypass.js — Meta Apps SSL Bypass
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Defeats SSL pinning in Meta apps (Facebook, Instagram, Messenger, WhatsApp)
 * via proxygen mangled name hooks and BoringSSL native hooks.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: iomoath/meta-apps-ssl-pinning/fb_ssl_hooks_v2.js
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('metaSsl', 'Meta Apps SSL Bypass');

    var _hookCount = 0;
    var _failCount = 0;

    var _metaEnabled = (typeof BYPASS_BUS !== 'undefined') ? BYPASS_BUS.enabled.metaSsl :
                       (_CFG.modules ? _CFG.modules.metaSsl : 'auto');
    if (_metaEnabled === false) return;

    // Package → native lib mapping
    var META_LIB_MAP = {
        'com.instagram.android'    : 'libscrollmerged.so',
        'com.facebook.pages.app'   : 'libstartup.so',
        'com.facebook.orca'        : 'libcoldstart.so',
        'com.facebook.katana'      : 'libcoldstart.so',
        'com.whatsapp'             : 'libwhatsapp.so'
    };

    var META_PROXYGEN_SYMS = [
        '_ZN8proxygen15SSLVerification17verifyWithMetricsEb',
        'verifyWithMetrics',
        '_ZN8proxygen10httpclient11PinningData15getKeySHA256SetEv'
    ];

    function waitForModule(name, timeoutMs) {
        if (typeof BYPASS_UTILS !== 'undefined' && BYPASS_UTILS.waitForModule) {
            return BYPASS_UTILS.waitForModule(name, timeoutMs);
        }
        return new Promise(function (resolve, reject) {
            var deadline = Date.now() + (timeoutMs || 15000);
            function attempt() {
                var mod = Process.findModuleByName(name);
                if (mod) { resolve(mod); return; }
                if (Date.now() >= deadline) { reject(new Error('Timeout: ' + name)); return; }
                setTimeout(attempt, 300);
            }
            attempt();
        });
    }

    function hookProxygenInLib(libName) {
        META_PROXYGEN_SYMS.forEach(function (sym) {
            try {
                var addr = Module.findExportByName(libName, sym);
                if (!addr) {
                    // Try enumerating exports with partial match
                    var exports_ = Module.enumerateExportsSync(libName);
                    for (var i = 0; i < exports_.length; i++) {
                        if (exports_[i].name.indexOf('verifyWithMetrics') !== -1 ||
                            exports_[i].name.indexOf('getKeySHA256Set') !== -1) {
                            addr = exports_[i].address;
                            break;
                        }
                    }
                }
                if (!addr) return;
                Interceptor.attach(addr, {
                    onLeave: function (retval) { retval.replace(ptr(1)); }
                });
                _hookCount++;
                _log.ok('metaSsl: proxygen hook ' + sym + ' in ' + libName);
            } catch (e) { _log.debug('metaSsl: proxygen sym ' + sym + ' in ' + libName + ' — ' + e); }
        });

        // BoringSSL hooks inside the Meta lib
        var boringSslFns = [
            'SSL_CTX_set_cert_verify_callback',
            'SSL_set_custom_verify',
            'SSL_CTX_set_custom_verify',
            'SSL_get_verify_result'
        ];
        boringSslFns.forEach(function (sym) {
            try {
                var addr = Module.findExportByName(libName, sym);
                if (!addr) return;
                if (sym === 'SSL_get_verify_result') {
                    Interceptor.attach(addr, { onLeave: function (rv) { rv.replace(ptr(0)); } });
                } else {
                    Interceptor.attach(addr, {
                        onEnter: function (args) {
                            if (args.length >= 2) args[1] = ptr(0);
                        }
                    });
                }
                _hookCount++;
                _log.ok('metaSsl: BoringSSL hook ' + sym + ' in ' + libName);
            } catch (e) { _log.debug('metaSsl: BoringSSL ' + sym + ' in ' + libName + ' — ' + e); }
        });
    }

    // Auto-detect Meta app package
    function detectMetaPackage() {
        var pkg = '';
        if (Java.available) {
            Java.perform(function () {
                try {
                    var AT = Java.use('android.app.ActivityThread');
                    pkg = AT.currentPackageName();
                } catch (_) {}
            });
        }
        return pkg;
    }

    (function main() {
        // If auto mode and not a Meta app, skip
        if (_metaEnabled === 'auto') {
            var pkg = detectMetaPackage();
            var isMetaApp = false;
            Object.keys(META_LIB_MAP).forEach(function (k) {
                if (pkg.indexOf(k) !== -1) isMetaApp = true;
            });
            if (!isMetaApp) {
                _log.debug('metaSsl: not a Meta app (' + pkg + ') — skipping');
                return;
            }
        }

        // Hook all known Meta libs
        var allLibs = [];
        Object.keys(META_LIB_MAP).forEach(function (k) {
            var lib = META_LIB_MAP[k];
            if (allLibs.indexOf(lib) === -1) allLibs.push(lib);
        });
        allLibs.push('libssl.so');

        allLibs.forEach(function (lib) {
            var mod = Process.findModuleByName(lib);
            if (mod) {
                hookProxygenInLib(lib);
            } else {
                waitForModule(lib, 15000).then(function () {
                    hookProxygenInLib(lib);
                }).catch(function () {
                    _log.debug('metaSsl: ' + lib + ' not found');
                });
            }
        });
    })();

    console.log('[*] meta-ssl-pinning-bypass: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('meta-ssl-pinning-bypass.js loaded');
})();
