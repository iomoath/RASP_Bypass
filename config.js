/**
 * config.js — Orchestrator + Configuration
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Usage (modular mode):
 *   frida -U -f com.target.app -l config.js
 *
 * All lib/*.js modules are loaded according to the BYPASS_CONFIG.modules map.
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// BYPASS_CONFIG — operator configuration
// ═══════════════════════════════════════════════════════════════════════════
var BYPASS_CONFIG = {

    // ── Proxy settings ───────────────────────────────────────────────────────
    proxy: {
        host: '127.0.0.1',
        port: 8080,
        type: 'HTTP'           // 'HTTP' or 'SOCKS5'
    },

    // ── CA certificate injection ─────────────────────────────────────────────
    ca: {
        inject   : true,
        certPath : '/data/local/tmp/burp.crt',  // PEM or DER on device
        certBase64: null,                        // base64 DER (alternative to certPath)
        asSystem : false
    },

    // ── Module enable map ────────────────────────────────────────────────────
    // true = always enable | false = always disable | 'auto' = detect and decide
    modules: {
        stealth      : true,
        root         : true,
        frida        : true,
        debugger     : true,
        hookDetect   : true,
        ssl          : true,
        flutter      : 'auto',   // auto-detected via libflutter.so presence
        caInject     : true,
        proxy        : true,
        integrity    : true,
        environment  : true,
        attestation  : true
    },

    // ── Logging ──────────────────────────────────────────────────────────────
    silent: true,     // suppress all console output in production
    debug : false,    // enable verbose debug logging

    // ── Integrity bypass ─────────────────────────────────────────────────────
    originalSignature : null,                    // hex APK signature (auto-captured if null)
    originalInstaller : 'com.android.vending'   // expected installer package
};

// ═══════════════════════════════════════════════════════════════════════════
// BYPASS_BUS — shared communication bus
// ═══════════════════════════════════════════════════════════════════════════
var BYPASS_BUS = (function () {
    var _modules  = {};
    var _enabled  = {};
    var _utils    = null;

    // Logging — respects silent/debug flags
    var _log = {
        ok   : function (m) { if (!BYPASS_CONFIG.silent) console.log('\x1b[32m[+]\x1b[0m ' + m); },
        hit  : function (m) { if (!BYPASS_CONFIG.silent) console.log('\x1b[33m[*]\x1b[0m ' + m); },
        fail : function (m) { if (!BYPASS_CONFIG.silent) console.log('\x1b[31m[-]\x1b[0m ' + m); },
        info : function (m) { if (!BYPASS_CONFIG.silent) console.log('\x1b[36m[i]\x1b[0m ' + m); },
        debug: function (m) { if (!BYPASS_CONFIG.silent && BYPASS_CONFIG.debug) console.log('\x1b[90m[d]\x1b[0m ' + m); }
    };

    // Mirror enabled map from config
    Object.keys(BYPASS_CONFIG.modules).forEach(function (k) {
        _enabled[k] = BYPASS_CONFIG.modules[k];
    });

    return {
        enabled: _enabled,
        log    : _log,

        registerModule: function (id, name) {
            _modules[id] = { name: name, loaded: true, ts: Date.now() };
            _log.ok('BUS: registered [' + id + '] ' + name);
        },

        get utils() { return _utils; },
        set utils(u) { _utils = u; },

        status: function () {
            console.log('\n\x1b[36m══ RASP Bypass — Module Status ══\x1b[0m');
            Object.keys(_modules).forEach(function (id) {
                var m = _modules[id];
                console.log('  \x1b[32m✓\x1b[0m [' + id + '] ' + m.name);
            });
            console.log('  Total: ' + Object.keys(_modules).length + ' modules active\n');
        }
    };
})();

// ═══════════════════════════════════════════════════════════════════════════
// Module loader
// ═══════════════════════════════════════════════════════════════════════════
(function loadModules() {
    var cfg = BYPASS_CONFIG.modules;

    var MODULE_MAP = [
        { key: 'stealth',     file: 'lib/00_stealth.js'         },
        { key: 'root',        file: 'lib/01_root_bypass.js'     },
        { key: 'frida',       file: 'lib/02_frida_bypass.js'    },
        { key: 'debugger',    file: 'lib/03_debugger_bypass.js' },
        { key: 'hookDetect',  file: 'lib/04_hook_detection.js'  },
        { key: 'ssl',         file: 'lib/05_ssl_bypass.js'      },
        { key: 'flutter',     file: 'lib/06_ssl_flutter.js'     },
        { key: 'caInject',    file: 'lib/07_ssl_ca_inject.js'   },
        { key: 'proxy',       file: 'lib/08_proxy_override.js'  },
        { key: 'integrity',   file: 'lib/09_integrity_bypass.js'},
        { key: 'environment', file: 'lib/10_env_bypass.js'      },
        { key: 'attestation', file: 'lib/11_attestation.js'     }
    ];

    // Auto-detect Flutter
    if (cfg.flutter === 'auto') {
        cfg.flutter = !!Process.findModuleByName('libflutter.so');
        if (!cfg.flutter) {
            // Schedule a check after app starts
            setTimeout(function () {
                cfg.flutter = !!Process.findModuleByName('libflutter.so');
            }, 2000);
        }
    }

    // Load utils first
    try { require('lib/utils.js'); } catch (_) {}

    MODULE_MAP.forEach(function (mod) {
        var enabled = cfg[mod.key];
        if (enabled === false) {
            BYPASS_BUS.log.debug('skip: ' + mod.key);
            return;
        }
        try {
            require(mod.file);
        } catch (e) {
            BYPASS_BUS.log.debug('load error: ' + mod.file + ' — ' + e);
        }
    });

    BYPASS_BUS.log.ok('config.js — all modules loaded');
})();

// ═══════════════════════════════════════════════════════════════════════════
// REPL helpers (accessible via Frida REPL: bypassStatus(), bypassReport())
// ═══════════════════════════════════════════════════════════════════════════
function bypassStatus() {
    BYPASS_BUS.status();
}

function bypassReport() {
    BYPASS_BUS.status();
    console.log('Config:', JSON.stringify(BYPASS_CONFIG, null, 2));
}

// ═══════════════════════════════════════════════════════════════════════════
// RPC exports for programmatic access
// ═══════════════════════════════════════════════════════════════════════════
rpc.exports = {
    status: function () {
        var result = {};
        Object.keys(BYPASS_CONFIG.modules).forEach(function (k) {
            result[k] = BYPASS_CONFIG.modules[k];
        });
        return result;
    },
    setProxy: function (host, port, type) {
        BYPASS_CONFIG.proxy.host = host || '127.0.0.1';
        BYPASS_CONFIG.proxy.port = port || 8080;
        BYPASS_CONFIG.proxy.type = type || 'HTTP';
        return 'proxy set to ' + BYPASS_CONFIG.proxy.type + ' ' + BYPASS_CONFIG.proxy.host + ':' + BYPASS_CONFIG.proxy.port;
    },
    setSilent: function (val) {
        BYPASS_CONFIG.silent = !!val;
        return 'silent=' + BYPASS_CONFIG.silent;
    },
    setDebug: function (val) {
        BYPASS_CONFIG.debug = !!val;
        return 'debug=' + BYPASS_CONFIG.debug;
    },
    enableModule: function (key) {
        BYPASS_CONFIG.modules[key]   = true;
        BYPASS_BUS.enabled[key]      = true;
        return key + ' enabled';
    },
    disableModule: function (key) {
        BYPASS_CONFIG.modules[key]   = false;
        BYPASS_BUS.enabled[key]      = false;
        return key + ' disabled';
    }
};
