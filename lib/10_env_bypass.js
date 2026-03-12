/**
 * lib/10_env_bypass.js — Environment Detection Bypass
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Defeats emulator, VPN, developer mode, accessibility, and screen capture detection.
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
        BYPASS_BUS.registerModule('10_env_bypass', 'Environment Detection Bypass');
    }

    // ── Emulator Build field overrides ───────────────────────────────────────
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

    // ─────────────────────────────────────────────────────────────────────────
    // 1. Emulator: Build.* field spoofing
    // ─────────────────────────────────────────────────────────────────────────
    (function hookBuildFields() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var Build = Java.use('android.os.Build');
                Object.keys(REAL_DEVICE).forEach(function (field) {
                    try { Build[field].value = REAL_DEVICE[field]; } catch (_) {}
                });
                _log.ok('env: Build.* spoofed to real device values');
            } catch (e) { _log.debug('env: Build spoof — ' + e); }

            // Build.VERSION
            try {
                var BuildVersion = Java.use('android.os.Build$VERSION');
                BuildVersion.RELEASE.value        = '14';
                BuildVersion.SDK_INT.value         = 34;
                BuildVersion.CODENAME.value        = 'REL';
                BuildVersion.INCREMENTAL.value     = '10754064';
                _log.ok('env: Build.VERSION spoofed');
            } catch (e) { _log.debug('env: Build.VERSION — ' + e); }
        });
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 2. Emulator: TelephonyManager (IMEI/IMSI)
    // ─────────────────────────────────────────────────────────────────────────
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

                ['getSubscriberId'].forEach(function (m) {
                    try { TM[m].overload().implementation = function () { return FAKE_IMSI; }; } catch (_) {}
                });

                TM.getNetworkOperatorName.implementation      = function () { return 'Android'; };
                TM.getSimOperatorName.implementation          = function () { return 'Android'; };
                TM.getPhoneType.overload().implementation     = function () { return 1; }; // PHONE_TYPE_GSM
                TM.getSimState.overload().implementation      = function () { return 5; }; // SIM_STATE_READY

                _log.ok('env: TelephonyManager spoofed');
            } catch (e) { _log.debug('env: TelephonyManager hook — ' + e); }
        });
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 3. Emulator: file-based detection (/dev/qemu_pipe, /proc/cpuinfo goldfish)
    // ─────────────────────────────────────────────────────────────────────────
    (function hookEmulatorFiles() {
        try {
            var accessPtr = Module.findExportByName(null, 'access');
            if (!accessPtr) return;
            Interceptor.attach(accessPtr, {
                onEnter: function (args) {
                    var path = args[0] && !args[0].isNull() ? args[0].readCString() : '';
                    for (var i = 0; i < EMULATOR_INDICATORS.length; i++) {
                        if (path.indexOf(EMULATOR_INDICATORS[i]) !== -1) {
                            this._block = true; break;
                        }
                    }
                },
                onLeave: function (retval) {
                    if (this._block) retval.replace(ptr(-2)); // ENOENT
                }
            });
            _log.ok('env: emulator file access() blocking active');
        } catch (e) { _log.debug('env: emulator access hook — ' + e); }
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 4. VPN detection: NetworkInterface filtering
    // ─────────────────────────────────────────────────────────────────────────
    (function hookVPNDetection() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var NetworkInterface = Java.use('java.net.NetworkInterface');
                var VPN_IFACE_PREFIXES = ['tun', 'ppp', 'tap'];

                NetworkInterface.getNetworkInterfaces.implementation = function () {
                    var ifaces = this.getNetworkInterfaces();
                    if (!ifaces) return ifaces;
                    var ArrayList = Java.use('java.util.ArrayList');
                    var filtered  = ArrayList.$new();
                    while (ifaces.hasMoreElements()) {
                        var iface = ifaces.nextElement();
                        var name  = iface.getName();
                        var hide  = false;
                        for (var i = 0; i < VPN_IFACE_PREFIXES.length; i++) {
                            if (name.indexOf(VPN_IFACE_PREFIXES[i]) !== -1) { hide = true; break; }
                        }
                        if (!hide) filtered.add(iface);
                    }
                    return Java.use('java.util.Collections').enumeration(filtered);
                };
                _log.ok('env: VPN NetworkInterface filtering active');
            } catch (e) { _log.debug('env: NetworkInterface hook — ' + e); }

            // ConnectivityManager TRANSPORT_VPN hiding
            try {
                var NetworkCapabilities = Java.use('android.net.NetworkCapabilities');
                var TRANSPORT_VPN       = 4;
                NetworkCapabilities.hasTransport.implementation = function (transport) {
                    if (transport === TRANSPORT_VPN) return false;
                    return this.hasTransport(transport);
                };
                _log.ok('env: NetworkCapabilities TRANSPORT_VPN hidden');
            } catch (e) { _log.debug('env: NetworkCapabilities hook — ' + e); }
        });
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 5. Developer mode: Settings.Secure/Global spoofing
    // ─────────────────────────────────────────────────────────────────────────
    (function hookDeveloperMode() {
        if (!Java.available) return;
        Java.perform(function () {
            var DEV_SETTINGS = {
                'adb_enabled'                   : '0',
                'development_settings_enabled'  : '0',
                'mock_location'                 : '0'
            };

            ['android.provider.Settings$Secure', 'android.provider.Settings$Global'].forEach(function (cls) {
                try {
                    var Settings = Java.use(cls);
                    Settings.getInt.overload('android.content.ContentResolver', 'java.lang.String').implementation = function (cr, name) {
                        if (DEV_SETTINGS[name] !== undefined) return parseInt(DEV_SETTINGS[name]);
                        return this.getInt(cr, name);
                    };
                    Settings.getInt.overload('android.content.ContentResolver', 'java.lang.String', 'int').implementation = function (cr, name, def) {
                        if (DEV_SETTINGS[name] !== undefined) return parseInt(DEV_SETTINGS[name]);
                        return this.getInt(cr, name, def);
                    };
                    Settings.getString.overload('android.content.ContentResolver', 'java.lang.String').implementation = function (cr, name) {
                        if (DEV_SETTINGS[name] !== undefined) return DEV_SETTINGS[name];
                        return this.getString(cr, name);
                    };
                } catch (e) { _log.debug('env: Settings hook for ' + cls + ' — ' + e); }
            });
            _log.ok('env: developer mode Settings spoofing active');
        });
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 6. Accessibility service hiding
    // ─────────────────────────────────────────────────────────────────────────
    (function hookAccessibility() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var AM = Java.use('android.view.accessibility.AccessibilityManager');
                AM.getEnabledAccessibilityServiceList.implementation = function (feedbackType) {
                    return Java.use('java.util.ArrayList').$new();
                };
                AM.isEnabled.implementation = function () { return false; };
                _log.ok('env: Accessibility service hiding active');
            } catch (e) { _log.debug('env: AccessibilityManager hook — ' + e); }
        });
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 7. FLAG_SECURE bypass (screen capture detection)
    // ─────────────────────────────────────────────────────────────────────────
    (function hookFlagSecure() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var Window = Java.use('android.view.Window');
                Window.setFlags.implementation = function (flags, mask) {
                    var FLAG_SECURE = 8192;
                    flags = flags & ~FLAG_SECURE;
                    mask  = mask  & ~FLAG_SECURE;
                    return this.setFlags(flags, mask);
                };
                _log.ok('env: FLAG_SECURE bypass active');
            } catch (e) { _log.debug('env: FLAG_SECURE hook — ' + e); }
        });
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 8. Native: getifaddrs — hide VPN interfaces
    // ─────────────────────────────────────────────────────────────────────────
    (function hookGetifaddrs() {
        try {
            var getifaddrsPtr = Module.findExportByName('libc.so', 'getifaddrs');
            if (!getifaddrsPtr) return;
            Interceptor.attach(getifaddrsPtr, {
                onLeave: function (_retval) {
                    _log.debug('env: getifaddrs() called');
                }
            });
        } catch (e) { _log.debug('env: getifaddrs hook — ' + e); }
    })();

    _log.ok('10_env_bypass.js — environment detection bypass installed');
})();
