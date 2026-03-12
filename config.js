/**
 * config.js — Orchestrator + Configuration
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Usage (modular mode):
 *   frida -U -f com.target.app -l config.js --no-pause
 *
 * Usage (with profile):
 *   frida -U -f com.bank.app -l config.js -l profiles/banking.js --no-pause
 */

'use strict';

// BYPASS_CONFIG — operator configuration
var BYPASS_CONFIG = {
    proxy: { host: '127.0.0.1', port: 8080, type: 'HTTP' },
    CERT_PEM: '-----BEGIN CERTIFICATE-----\n[YOUR CA CERT HERE]\n-----END CERTIFICATE-----',
    modules: {
        stealthFrida  : true,
        stealthHook   : true,
        root          : true,
        frida         : true,
        debugger      : true,
        emulator      : true,
        vpn           : true,
        devMode       : true,
        accessibility : true,
        screenCapture : true,
        appCloning    : true,
        sslPinning    : true,
        sslFallback   : true,
        certInjection : true,
        nativeTls     : true,
        flutter       : 'auto',
        metaSsl       : 'auto',
        proxyOverride : true,
        nativeConnect : true,
        integrity     : true,
        attestation   : true,
        http3Disable  : true,
        syscall       : true,
        antiFrida     : true
    },
    silent: true,
    debug : false,
    originalSignature : null,
    originalInstaller : 'com.android.vending',
    BLOCK_HTTP3          : true,
    PROXY_SUPPORTS_SOCKS5: false,
    IGNORED_NON_HTTP_PORTS: []
};

// Global compat exports (httptoolkit-style standalone module compat)
var CERT_PEM              = BYPASS_CONFIG.CERT_PEM;
var PROXY_HOST            = BYPASS_CONFIG.proxy.host;
var PROXY_PORT            = BYPASS_CONFIG.proxy.port;
var DEBUG_MODE            = BYPASS_CONFIG.debug;
var PROXY_SUPPORTS_SOCKS5 = BYPASS_CONFIG.PROXY_SUPPORTS_SOCKS5;
var IGNORED_NON_HTTP_PORTS = BYPASS_CONFIG.IGNORED_NON_HTTP_PORTS;

// BYPASS_BUS — shared communication bus
var BYPASS_BUS = (function () {
    var _modules = {};
    var _enabled = {};

    var _log = {
        ok   : function (m) { if (!BYPASS_CONFIG.silent) console.log('\x1b[32m[+]\x1b[0m ' + m); },
        hit  : function (m) { if (!BYPASS_CONFIG.silent) console.log('\x1b[33m[*]\x1b[0m ' + m); },
        fail : function (m) { if (!BYPASS_CONFIG.silent) console.log('\x1b[31m[-]\x1b[0m ' + m); },
        info : function (m) { if (!BYPASS_CONFIG.silent) console.log('\x1b[36m[i]\x1b[0m ' + m); },
        debug: function (m) { if (!BYPASS_CONFIG.silent && BYPASS_CONFIG.debug) console.log('\x1b[90m[D]\x1b[0m ' + m); }
    };

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

// Module loader
(function loadModules() {
    var cfg = BYPASS_CONFIG.modules;
    var MODULE_MAP = [
        { key: 'stealthFrida',  file: 'lib/stealth-frida-hiding.js'               },
        { key: 'stealthHook',   file: 'lib/stealth-hook-detection.js'             },
        { key: 'root',          file: 'lib/root-detection-bypass.js'              },
        { key: 'frida',         file: 'lib/frida-detection-bypass.js'             },
        { key: 'debugger',      file: 'lib/debugger-detection-bypass.js'          },
        { key: 'emulator',      file: 'lib/emulator-detection-bypass.js'          },
        { key: 'vpn',           file: 'lib/vpn-detection-bypass.js'               },
        { key: 'devMode',       file: 'lib/developer-mode-bypass.js'              },
        { key: 'accessibility', file: 'lib/accessibility-bypass.js'               },
        { key: 'screenCapture', file: 'lib/screen-capture-bypass.js'              },
        { key: 'appCloning',    file: 'lib/app-cloning-bypass.js'                 },
        { key: 'sslPinning',    file: 'lib/android-ssl-pinning-bypass.js'         },
        { key: 'sslFallback',   file: 'lib/android-ssl-pinning-bypass-fallback.js'},
        { key: 'certInjection', file: 'lib/android-system-certificate-injection.js'},
        { key: 'nativeTls',     file: 'lib/native-tls-hook.js'                   },
        { key: 'flutter',       file: 'lib/disable-flutter-tls.js'               },
        { key: 'metaSsl',       file: 'lib/meta-ssl-pinning-bypass.js'            },
        { key: 'proxyOverride', file: 'lib/android-proxy-override.js'            },
        { key: 'nativeConnect', file: 'lib/native-connect-hook.js'               },
        { key: 'integrity',     file: 'lib/integrity-bypass.js'                  },
        { key: 'attestation',   file: 'lib/attestation-bypass.js'                },
        { key: 'http3Disable',  file: 'lib/http3-disable.js'                     },
        { key: 'syscall',       file: 'lib/syscall-bypass.js'                    },
        { key: 'antiFrida',     file: 'lib/anti-frida-bypass.js'                 }
    ];

    if (cfg.flutter === 'auto') {
        cfg.flutter = !!Process.findModuleByName('libflutter.so');
        if (!cfg.flutter) setTimeout(function () { cfg.flutter = !!Process.findModuleByName('libflutter.so'); }, 2000);
    }

    try { require('lib/utils.js'); } catch (_) {}

    MODULE_MAP.forEach(function (mod) {
        var enabled = cfg[mod.key];
        if (enabled === false) { BYPASS_BUS.log.debug('skip: ' + mod.key); return; }
        try { require(mod.file); } catch (e) { BYPASS_BUS.log.debug('load error: ' + mod.file + ' — ' + e); }
    });

    BYPASS_BUS.log.ok('config.js — all modules loaded');
})();

// REPL helpers
function bypassStatus() { BYPASS_BUS.status(); }
function bypassReport() { BYPASS_BUS.status(); console.log('Config:', JSON.stringify(BYPASS_CONFIG, null, 2)); }

// RPC exports
rpc.exports = {
    status: function () {
        var result = {};
        Object.keys(BYPASS_CONFIG.modules).forEach(function (k) { result[k] = BYPASS_CONFIG.modules[k]; });
        return result;
    },
    setProxy: function (host, port, type) {
        BYPASS_CONFIG.proxy.host = host || '127.0.0.1';
        BYPASS_CONFIG.proxy.port = port || 8080;
        BYPASS_CONFIG.proxy.type = type || 'HTTP';
        PROXY_HOST = BYPASS_CONFIG.proxy.host;
        PROXY_PORT = BYPASS_CONFIG.proxy.port;
        return 'proxy set to ' + BYPASS_CONFIG.proxy.type + ' ' + PROXY_HOST + ':' + PROXY_PORT;
    },
    setSilent: function (val) { BYPASS_CONFIG.silent = !!val; return 'silent=' + BYPASS_CONFIG.silent; },
    setDebug:  function (val) { BYPASS_CONFIG.debug  = !!val; DEBUG_MODE = BYPASS_CONFIG.debug; return 'debug=' + BYPASS_CONFIG.debug; },
    enableModule:  function (key) { BYPASS_CONFIG.modules[key] = true;  BYPASS_BUS.enabled[key] = true;  return key + ' enabled'; },
    disableModule: function (key) { BYPASS_CONFIG.modules[key] = false; BYPASS_BUS.enabled[key] = false; return key + ' disabled'; }
};
