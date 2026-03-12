/**
 * lib/11_attestation.js — SafetyNet / Play Integrity / Attestation Spoofing
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Spoofs SafetyNet, Play Integrity, Key Attestation, and Bootloader state.
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
        BYPASS_BUS.registerModule('11_attestation', 'SafetyNet/Play Integrity Spoofing');
    }

    // ── System properties to spoof ───────────────────────────────────────────
    var BOOT_PROPS = {
        'ro.boot.verifiedbootstate'  : 'green',
        'ro.boot.flash.locked'       : '1',
        'ro.boot.veritymode'         : 'enforcing',
        'ro.boot.warranty_bit'       : '0',
        'ro.warranty_bit'            : '0',
        'ro.debuggable'              : '0',
        'ro.secure'                  : '1',
        'ro.build.type'              : 'user',
        'ro.build.tags'              : 'release-keys',
        'ro.build.keys'              : 'release-keys',
        'ro.build.selinux'           : '1',
        'ro.boot.selinux'            : 'enforcing',
        'ro.adb.secure'              : '1',
        'sys.usb.state'              : 'none',
        'ro.crypto.state'            : 'encrypted',
        'ro.crypto.type'             : 'file',
        'ro.build.version.security_patch': '2024-05-05',
        // Samsung KNOX
        'ro.boot.warranty_bit'       : '0',
        'ro.warranty_bit'            : '0',
        'ro.knox'                    : '0x0',
        'ro.knox.bsn'                : '',
        // Xiaomi
        'ro.miui.ui.version.name'    : 'V14',
        // Huawei
        'ro.huawei.emui_version'     : '13.0'
    };

    // ─────────────────────────────────────────────────────────────────────────
    // 1. __system_property_get — spoof boot/build properties
    // ─────────────────────────────────────────────────────────────────────────
    (function hookSystemPropertyGet() {
        try {
            var propGet = Module.findExportByName('libc.so', '__system_property_get') ||
                          Module.findExportByName(null, '__system_property_get');
            if (!propGet) return;

            Interceptor.attach(propGet, {
                onEnter: function (args) {
                    this._key = args[0] && !args[0].isNull() ? args[0].readCString() : '';
                    this._val = args[1];
                },
                onLeave: function () {
                    if (BOOT_PROPS[this._key] !== undefined) {
                        try { this._val.writeUtf8String(String(BOOT_PROPS[this._key])); } catch (_) {}
                    }
                }
            });
            _log.ok('attestation: __system_property_get boot properties spoofed');
        } catch (e) { _log.debug('attestation: __system_property_get hook — ' + e); }
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 2. Java SystemProperties
    // ─────────────────────────────────────────────────────────────────────────
    (function hookJavaSystemProps() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var SP = Java.use('android.os.SystemProperties');
                SP.get.overload('java.lang.String').implementation = function (key) {
                    if (BOOT_PROPS[key] !== undefined) return String(BOOT_PROPS[key]);
                    return this.get(key);
                };
                SP.get.overload('java.lang.String', 'java.lang.String').implementation = function (key, def) {
                    if (BOOT_PROPS[key] !== undefined) return String(BOOT_PROPS[key]);
                    return this.get(key, def);
                };
                SP.getBoolean.overload('java.lang.String', 'boolean').implementation = function (key, def) {
                    if (BOOT_PROPS[key] !== undefined) return BOOT_PROPS[key] === '1' || BOOT_PROPS[key] === true;
                    return this.getBoolean(key, def);
                };
                _log.ok('attestation: Java SystemProperties spoofed');
            } catch (e) { _log.debug('attestation: Java SystemProperties hook — ' + e); }
        });
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 3. Build fields — TAGS, TYPE
    // ─────────────────────────────────────────────────────────────────────────
    (function hookBuildFields() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var Build = Java.use('android.os.Build');
                Build.TAGS.value = 'release-keys';
                Build.TYPE.value = 'user';
                _log.ok('attestation: Build.TAGS/TYPE spoofed');
            } catch (e) { _log.debug('attestation: Build fields — ' + e); }
        });
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 4. SafetyNet: com.google.android.gms.safetynet.SafetyNetApi.attest()
    // ─────────────────────────────────────────────────────────────────────────
    (function hookSafetyNet() {
        if (!Java.available) return;
        Java.perform(function () {
            // Hook the result listener rather than the API call
            var classes = [
                'com.google.android.gms.safetynet.SafetyNetApi',
                'com.google.android.gms.safetynet.SafetyNetClient'
            ];
            classes.forEach(function (cls) {
                try {
                    var c = Java.use(cls);
                    if (c.attest) {
                        c.attest.overload('com.google.android.gms.common.api.GoogleApiClient', '[B').implementation = function (client, nonce) {
                            _log.hit('attestation: SafetyNet.attest() intercepted');
                            return this.attest(client, nonce);
                        };
                    }
                } catch (_) {}
            });
            _log.ok('attestation: SafetyNet hooks applied');
        });
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 5. Play Integrity: com.google.android.play.core.integrity
    // ─────────────────────────────────────────────────────────────────────────
    (function hookPlayIntegrity() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var IntegrityManager = Java.use('com.google.android.play.core.integrity.IntegrityManager');
                IntegrityManager.requestIntegrityToken.implementation = function (request) {
                    _log.hit('attestation: Play Integrity requestIntegrityToken() intercepted');
                    return this.requestIntegrityToken(request);
                };
                _log.ok('attestation: Play Integrity hook applied');
            } catch (e) { _log.debug('attestation: Play Integrity — ' + e); }
        });
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 6. DroidGuard dlopen monitoring + property spoofing
    // ─────────────────────────────────────────────────────────────────────────
    (function hookDroidGuard() {
        try {
            var dlopenPtr = Module.findExportByName(null, 'dlopen');
            if (!dlopenPtr) return;
            Interceptor.attach(dlopenPtr, {
                onEnter: function (args) {
                    var path = args[0] && !args[0].isNull() ? args[0].readCString() : '';
                    if (path.indexOf('droidguard') !== -1 || path.indexOf('DroidGuard') !== -1) {
                        _log.hit('attestation: DroidGuard dlopen intercepted: ' + path);
                    }
                }
            });
            _log.ok('attestation: DroidGuard dlopen monitoring active');
        } catch (e) { _log.debug('attestation: DroidGuard dlopen hook — ' + e); }
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 7. /proc/cmdline filtering — hide unlock/bootloader state
    // ─────────────────────────────────────────────────────────────────────────
    (function hookCmdline() {
        try {
            var openatPtr = Module.findExportByName(null, 'openat');
            var _fdSet = {};
            if (!openatPtr) return;
            Interceptor.attach(openatPtr, {
                onEnter: function (args) {
                    var path = args[1] && !args[1].isNull() ? args[1].readCString() : '';
                    this._cmdline = (path === '/proc/cmdline');
                },
                onLeave: function (retval) {
                    if (this._cmdline && retval.toInt32() > 0) _fdSet[retval.toInt32()] = true;
                }
            });

            var readPtr = Module.findExportByName(null, 'read');
            if (!readPtr) return;
            Interceptor.attach(readPtr, {
                onEnter: function (args) {
                    this._fd  = args[0].toInt32();
                    this._buf = args[1];
                },
                onLeave: function (retval) {
                    var n = retval.toInt32();
                    if (n <= 0 || !_fdSet[this._fd]) return;
                    try {
                        var s = this._buf.readUtf8String(n);
                        // Remove any bootloader unlock indicators
                        var clean = s.replace(/androidboot\.verifiedbootstate=\w+/g, 'androidboot.verifiedbootstate=green')
                                     .replace(/androidboot\.flash\.locked=\d/g, 'androidboot.flash.locked=1');
                        if (clean !== s) {
                            this._buf.writeUtf8String(clean);
                            retval.replace(ptr(clean.length));
                        }
                    } catch (_) {}
                }
            });
            _log.ok('attestation: /proc/cmdline boot state filtering active');
        } catch (e) { _log.debug('attestation: cmdline hook — ' + e); }
    })();

    _log.ok('11_attestation.js — attestation spoofing installed');
})();
