/**
 * profiles/meta.js — Meta Apps Profile (Facebook / Instagram / Messenger / WhatsApp)
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Pre-tuned for Meta applications with proxygen SSL pinning.
 * References meta-apps-ssl-pinning / fb_ssl_hooks_v2 techniques.
 *
 * Usage:
 *   frida -U -f com.facebook.katana -l profiles/meta.js
 *   frida -U -f com.instagram.android -l profiles/meta.js
 */

'use strict';

var BYPASS_CONFIG = {
    proxy: {
        host: '127.0.0.1',
        port: 8080,
        type: 'HTTP'
    },
    ca: {
        inject   : true,
        certPath : '/data/local/tmp/burp.crt',
        certBase64: null,
        asSystem : false
    },
    modules: {
        stealth      : true,
        root         : false,
        frida        : true,
        debugger     : false,
        hookDetect   : true,
        ssl          : true,
        flutter      : false,   // Meta apps don't use Flutter
        caInject     : true,
        proxy        : true,
        integrity    : false,
        environment  : false,
        attestation  : false
    },
    silent           : true,
    debug            : false,
    originalSignature: null,
    originalInstaller: 'com.android.vending'
};

// ── Meta-specific: proxygen + HTTP/3 bypass ──────────────────────────────
(function metaSpecific() {
    // Auto-detect Meta app package and matching native library
    var META_PACKAGE_LIBS = {
        'com.facebook.katana'    : ['libcoldstart.so', 'libstartup.so'],
        'com.instagram.android'  : ['libscrollmerged.so', 'libstartup.so'],
        'com.facebook.orca'      : ['libcoldstart.so'],
        'com.whatsapp'           : ['libwhatsapp.so']
    };

    function detectMetaAppLibs() {
        var pkg = '';
        try {
            Java.perform(function () {
                try {
                    var AT  = Java.use('android.app.ActivityThread');
                    var ctx = AT.currentApplication().getApplicationContext();
                    pkg = ctx.getPackageName();
                } catch (_) {}
            });
        } catch (_) {}

        var libs = META_PACKAGE_LIBS[pkg] || [];
        if (libs.length === 0) {
            // Fallback: check all known Meta libs
            Object.keys(META_PACKAGE_LIBS).forEach(function (p) {
                META_PACKAGE_LIBS[p].forEach(function (l) {
                    if (Process.findModuleByName(l)) libs.push(l);
                });
            });
        }
        return libs;
    }

    function hookBoringSSLVerifyCallbacks(lib) {
        var symbols = ['verifyWithMetrics', 'SSL_CTX_set_custom_verify', 'SSL_set_custom_verify'];
        symbols.forEach(function (sym) {
            try {
                var addr = Module.findExportByName(lib, sym);
                if (!addr) return;
                Interceptor.attach(addr, {
                    onLeave: function (retval) {
                        if (retval && !retval.isNull()) retval.replace(ptr(0));
                    }
                });
                console.log('\x1b[32m[+]\x1b[0m meta: hooked ' + sym + ' in ' + lib);
            } catch (_) {}
        });
    }

    function disableHTTP3(lib) {
        // Disable QUIC/HTTP3 to force HTTP/1.1 or HTTP/2 through proxy
        var quicSymbols = ['quic_disable', 'http3_enable', 'enable_quic'];
        quicSymbols.forEach(function (sym) {
            try {
                var addr = Module.findExportByName(lib, sym);
                if (!addr) return;
                Interceptor.replace(addr, new NativeCallback(function () { return 0; }, 'int', []));
            } catch (_) {}
        });
    }

    function waitForMetaLib(libName, callback) {
        return new Promise(function (resolve) {
            var deadline = Date.now() + 15000;
            function attempt() {
                var mod = Process.findModuleByName(libName);
                if (mod) { callback(libName); resolve(mod); return; }
                if (Date.now() >= deadline) return;
                setTimeout(attempt, 500);
            }
            attempt();
        });
    }

    setTimeout(function () {
        var libs = detectMetaAppLibs();
        if (libs.length === 0) {
            libs = ['libcoldstart.so', 'libstartup.so', 'libscrollmerged.so'];
        }

        libs.forEach(function (lib) {
            var mod = Process.findModuleByName(lib);
            if (mod) {
                hookBoringSSLVerifyCallbacks(lib);
                disableHTTP3(lib);
            } else {
                waitForMetaLib(lib, function (l) {
                    hookBoringSSLVerifyCallbacks(l);
                    disableHTTP3(l);
                });
            }
        });
    }, 500);
})();

// Load orchestrator
try { require('../config.js'); } catch (e) {
    var mods = [
        '../lib/utils.js',
        '../lib/00_stealth.js',
        '../lib/02_frida_bypass.js',
        '../lib/04_hook_detection.js',
        '../lib/05_ssl_bypass.js',
        '../lib/07_ssl_ca_inject.js',
        '../lib/08_proxy_override.js'
    ];
    mods.forEach(function (m) { try { require(m); } catch (_) {} });
}
