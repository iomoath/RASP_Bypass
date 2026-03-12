/**
 * profiles/banking.js — Banking App Profile
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Maximum stealth configuration for banking / fintech apps.
 * All modules enabled, attestation spoofing on, silent mode.
 *
 * Usage:
 *   frida -U -f com.bank.app -l profiles/banking.js
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
        root         : true,
        frida        : true,
        debugger     : true,
        hookDetect   : true,
        ssl          : true,
        flutter      : 'auto',
        caInject     : true,
        proxy        : true,
        integrity    : true,
        environment  : true,
        attestation  : true
    },
    silent           : true,
    debug            : false,
    originalSignature: null,
    originalInstaller: 'com.android.vending'
};

// Load orchestrator
try { require('../config.js'); } catch (e) {
    // Fallback: inline all modules
    var mods = [
        '../lib/utils.js',
        '../lib/00_stealth.js',
        '../lib/01_root_bypass.js',
        '../lib/02_frida_bypass.js',
        '../lib/03_debugger_bypass.js',
        '../lib/04_hook_detection.js',
        '../lib/05_ssl_bypass.js',
        '../lib/06_ssl_flutter.js',
        '../lib/07_ssl_ca_inject.js',
        '../lib/08_proxy_override.js',
        '../lib/09_integrity_bypass.js',
        '../lib/10_env_bypass.js',
        '../lib/11_attestation.js'
    ];
    mods.forEach(function (m) { try { require(m); } catch (_) {} });
}
