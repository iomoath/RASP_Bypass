/**
 * profiles/flutter.js — Flutter App Profile
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Pre-tuned for Flutter applications. Flutter SSL module forced on,
 * stealth + universal SSL also enabled.
 *
 * Usage:
 *   frida -U -f com.flutter.app -l profiles/flutter.js
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
        root         : false,   // not typically needed for Flutter apps
        frida        : true,
        debugger     : false,
        hookDetect   : false,
        ssl          : true,
        flutter      : true,    // FORCED ON
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

// Load orchestrator
try { require('../config.js'); } catch (e) {
    var mods = [
        '../lib/utils.js',
        '../lib/00_stealth.js',
        '../lib/02_frida_bypass.js',
        '../lib/05_ssl_bypass.js',
        '../lib/06_ssl_flutter.js',
        '../lib/07_ssl_ca_inject.js',
        '../lib/08_proxy_override.js'
    ];
    mods.forEach(function (m) { try { require(m); } catch (_) {} });
}
