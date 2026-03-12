/**
 * lib/emulator-detection-bypass.js — Emulator Detection Bypass
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Defeats emulator detection via Build.* spoofing, TelephonyManager,
 * file access blocking, and __system_property_get.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: RASP_auditor module 08
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('emulator', 'Emulator Detection Bypass');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.emulator === false) return;

    var REAL_DEVICE = {
        HARDWARE   : 'qcom',
        PRODUCT    : 'redfin',
        MODEL      : 'Pixel 5',
        BRAND      : 'google',
        DEVICE     : 'redfin',
        BOARD      : 'redfin',
        FINGERPRINT: 'google/redfin/redfin:14/UP1A.231005.007/10754064:user/release-keys',
        MANUFACTURER: 'Google',
        BOOTLOADER : 'c2f2-0.4-10754064',
        RADIO      : 'g7250-00219-230616-B-10210219',
        TAGS       : 'release-keys',
        TYPE       : 'user'
    };

    var EMULATOR_INDICATORS = [
        '/dev/qemu_pipe', '/dev/qemu_trace', '/sys/qemu_trace',
        '/proc/tty/drivers',
        'goldfish', 'ranchu', 'sdk_gphone', 'vbox', 'genymotion',
        '/dev/socket/genyd', '/dev/socket/baseband_genyd'
    ];

    var EMULATOR_PROPS = {
        'ro.kernel.qemu'          : '0',
        'ro.hardware'             : 'qcom',
        'ro.product.device'       : 'redfin',
        'ro.product.model'        : 'Pixel 5',
        'ro.product.manufacturer' : 'Google',
        'ro.product.brand'        : 'google'
    };

    // 1. Build.* field spoofing
    (function hookBuildFields() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var Build = Java.use('android.os.Build');
                Object.keys(REAL_DEVICE).forEach(function (field) {
                    try { Build[field].value = REAL_DEVICE[field]; } catch (_) {}
                });
                _log.ok('emulator: Build.* spoofed to real device values');
            } catch (e) { _log.debug('emulator: Build spoof — ' + e); }

            try {
                var BuildVersion = Java.use('android.os.Build$VERSION');
                BuildVersion.RELEASE.value    = '14';
                BuildVersion.SDK_INT.value    = 34;
                BuildVersion.CODENAME.value   = 'REL';
                BuildVersion.INCREMENTAL.value = '10754064';
                _log.ok('emulator: Build.VERSION spoofed');
            } catch (e) { _log.debug('emulator: Build.VERSION — ' + e); }
        });
    })();

    // 2. TelephonyManager IMEI/IMSI spoofing
    (function hookTelephony() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var TM = Java.use('android.telephony.TelephonyManager');
                var FAKE_IMEI = '358240051111110';
                var FAKE_IMSI = '310260000000000';

                ['getDeviceId', 'getImei', 'getMeid'].forEach(function (m) {
                    try { TM[m].overload().implementation = function () { return FAKE_IMEI; }; } catch (_) {}
                    try { TM[m].overload('int').implementation = function () { return FAKE_IMEI; }; } catch (_) {}
                });

                try { TM.getSubscriberId.overload().implementation = function () { return FAKE_IMSI; }; } catch (_) {}
                try { TM.getNetworkOperatorName.implementation = function () { return 'Android'; }; } catch (_) {}
                try { TM.getSimOperatorName.implementation = function () { return 'Android'; }; } catch (_) {}
                try { TM.getPhoneType.overload().implementation = function () { return 1; }; } catch (_) {}
                try { TM.getSimState.overload().implementation = function () { return 5; }; } catch (_) {}

                _log.ok('emulator: TelephonyManager spoofed');
            } catch (e) { _log.debug('emulator: TelephonyManager hook — ' + e); }
        });
    })();

    // 3. Native access() — block emulator file indicators
    (function hookEmulatorFiles() {
        try {
            var accessPtr = Module.findExportByName(null, 'access');
            if (!accessPtr) return;
            Interceptor.attach(accessPtr, {
                onEnter: function (args) {
                    var path = args[0] && !args[0].isNull() ? args[0].readCString() : '';
                    for (var i = 0; i < EMULATOR_INDICATORS.length; i++) {
                        if (path.indexOf(EMULATOR_INDICATORS[i]) !== -1) { this._block = true; break; }
                    }
                },
                onLeave: function (retval) {
                    if (this._block) retval.replace(ptr(-2)); // ENOENT
                }
            });
            _log.ok('emulator: emulator file access() blocking active');
        } catch (e) { _log.debug('emulator: emulator access hook — ' + e); }
    })();

    // 4. __system_property_get — spoof emulator properties
    (function hookSystemPropertyGet() {
        try {
            var propGet = Module.findExportByName('libc.so', '__system_property_get') ||
                          Module.findExportByName(null, '__system_property_get');
            if (!propGet) return;
            Interceptor.attach(propGet, {
                onEnter: function (args) {
                    this._key = safeReadStr(args[0]);
                    this._val = args[1];
                },
                onLeave: function () {
                    if (EMULATOR_PROPS[this._key] !== undefined) {
                        try { this._val.writeUtf8String(EMULATOR_PROPS[this._key]); } catch (_) {}
                    }
                }
            });
            _log.ok('emulator: __system_property_get emulator property spoofing active');
        } catch (e) { _log.debug('emulator: __system_property_get hook — ' + e); }
    })();

    _log.ok('emulator-detection-bypass.js loaded');
})();
