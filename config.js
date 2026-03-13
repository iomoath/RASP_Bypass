/**
 * config.js — Orchestrator + Configuration
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Usage (modular mode — recommended):
 *   frida -U -f com.target.app \
 *     -l config.js \
 *     -l lib/utils.js \
 *     -l lib/stealth-frida-hiding.js \
 *     -l lib/root-detection-bypass.js \
 *     ... (add each lib/*.js module you need)
 *
 * Usage (with profile):
 *   frida -U -f com.bank.app -l config.js -l profiles/banking.js \
 *     -l lib/utils.js -l lib/stealth-frida-hiding.js ...
 *
 * Usage (single-file mode — easiest):
 *   frida -U -f com.target.app -l bypass.js
 *
 * NOTE: Frida does not support require(). Modules must be loaded via
 * separate -l flags or use bypass.js which has all modules inline.
 * Use run.sh to generate the full command automatically.
 */

'use strict';

// BYPASS_CONFIG — operator configuration
var BYPASS_CONFIG = {
    proxy: { host: '127.0.0.1', port: 8080, type: 'HTTP' },
    CERT_PEM: '-----BEGIN CERTIFICATE-----\n[YOUR CA CERT HERE]\n-----END CERTIFICATE-----',
    forceProxy: true,
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

// Validate CERT_PEM is configured
if (BYPASS_CONFIG.CERT_PEM && (
    BYPASS_CONFIG.CERT_PEM.indexOf('[YOUR CA CERT HERE]') !== -1 ||
    BYPASS_CONFIG.CERT_PEM.indexOf('[YOUR CA CERTIFICATE') !== -1 ||
    BYPASS_CONFIG.CERT_PEM.indexOf('PUT YOUR') !== -1 ||
    BYPASS_CONFIG.CERT_PEM.trim() === '' ||
    BYPASS_CONFIG.CERT_PEM.trim() === '-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----'
)) {
    console.log('\n\x1b[31m[!!!] WARNING: CERT_PEM is not configured!\x1b[0m');
    console.log('[!!!] SSL pinning bypass modules will NOT work without a valid CA certificate.');
    console.log('[!!!] Set BYPASS_CONFIG.CERT_PEM in config.js to your proxy CA certificate (PEM format).\n');
}

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

// Module loading — Frida does not support require().
// Load modules by passing each lib/*.js file as a separate -l flag, e.g.:
//
//   Modular mode (selective):
//     frida -U -f com.target.app \
//       -l config.js \
//       -l lib/utils.js \
//       -l lib/stealth-frida-hiding.js \
//       -l lib/root-detection-bypass.js \
//       ... (add each module you need)
//
//   Single-file mode (all modules):
//     frida -U -f com.target.app -l bypass.js
//
//   Auto-generate the full command:
//     bash run.sh com.target.app
//
if (typeof BYPASS_CONFIG !== 'undefined') {
    var _cfg = BYPASS_CONFIG.modules;
    if (_cfg.flutter === 'auto') {
        _cfg.flutter = !!Process.findModuleByName('libflutter.so');
        if (!_cfg.flutter) {
            setTimeout(function () { _cfg.flutter = !!Process.findModuleByName('libflutter.so'); }, 2000);
        }
    }
}
BYPASS_BUS.log.info('config.js loaded — add lib/*.js modules via -l flags, or use bypass.js for all-in-one mode');

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
