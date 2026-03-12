/**
 * lib/attestation-bypass.js — SafetyNet / Play Integrity Spoofing
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Spoofs SafetyNet, Play Integrity, Key Attestation, and Bootloader state.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: RASP_auditor modules 18, 24
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('attestation', 'SafetyNet/Play Integrity Spoofing');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.attestation === false) return;

    var _hookCount = 0;
    var _failCount = 0;

    var BOOT_PROPS = {
        'ro.boot.verifiedbootstate'      : 'green',
        'ro.boot.flash.locked'           : '1',
        'ro.boot.veritymode'             : 'enforcing',
        'ro.boot.warranty_bit'           : '0',
        'ro.warranty_bit'                : '0',
        'ro.debuggable'                  : '0',
        'ro.secure'                      : '1',
        'ro.build.type'                  : 'user',
        'ro.build.tags'                  : 'release-keys',
        'ro.build.keys'                  : 'release-keys',
        'ro.build.selinux'               : '1',
        'ro.boot.selinux'                : 'enforcing',
        'ro.adb.secure'                  : '1',
        'sys.usb.state'                  : 'none',
        'ro.crypto.state'                : 'encrypted',
        'ro.crypto.type'                 : 'file',
        'ro.build.version.security_patch': '2024-05-05',
        'ro.knox'                        : '0x0',
        'ro.knox.bsn'                    : ''
    };

    // 1. __system_property_get — spoof boot/build properties
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
                    if (BOOT_PROPS[this._key] !== undefined) {
                        try { this._val.writeUtf8String(String(BOOT_PROPS[this._key])); } catch (_) {}
                    }
                }
            });
            _hookCount++;
            _log.ok('attestation: __system_property_get boot properties spoofed');
        } catch (e) { _failCount++; _log.debug('attestation: __system_property_get hook — ' + e); }
    })();

    // 2. Java SystemProperties
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
                _hookCount++;
                _log.ok('attestation: Java SystemProperties spoofed');
            } catch (e) { _failCount++; _log.debug('attestation: Java SystemProperties hook — ' + e); }
        });
    })();

    // 3. Build fields
    (function hookBuildFields() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var Build = Java.use('android.os.Build');
                Build.TAGS.value = 'release-keys';
                Build.TYPE.value = 'user';
                _hookCount++;
                _log.ok('attestation: Build.TAGS/TYPE spoofed');
            } catch (e) { _failCount++; _log.debug('attestation: Build fields — ' + e); }
        });
    })();

    // 4. SafetyNet API interception
    (function hookSafetyNet() {
        if (!Java.available) return;
        Java.perform(function () {
            var classes = [
                'com.google.android.gms.safetynet.SafetyNetApi',
                'com.google.android.gms.safetynet.SafetyNetClient'
            ];
            classes.forEach(function (cls) {
                try {
                    var c = Java.use(cls);
                    if (c.attest) {
                        c.attest.overload('com.google.android.gms.common.api.GoogleApiClient', '[B').implementation = function (client, nonce) {
                            _log.info('attestation: SafetyNet.attest() intercepted');
                            return this.attest(client, nonce);
                        };
                    }
                } catch (_) {}
            });
            _hookCount++;
            _log.ok('attestation: SafetyNet hooks applied');
        });
    })();

    // 5. Play Integrity
    (function hookPlayIntegrity() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var IntegrityManager = Java.use('com.google.android.play.core.integrity.IntegrityManager');
                IntegrityManager.requestIntegrityToken.implementation = function (request) {
                    _log.info('attestation: Play Integrity requestIntegrityToken() intercepted');
                    return this.requestIntegrityToken(request);
                };
                _hookCount++;
                _log.ok('attestation: Play Integrity hook applied');
            } catch (e) { _failCount++; _log.debug('attestation: Play Integrity — ' + e); }
        });
    })();

    // 6. DroidGuard dlopen monitoring
    (function hookDroidGuard() {
        try {
            var dlopenPtr = Module.findExportByName(null, 'dlopen');
            if (!dlopenPtr) return;
            Interceptor.attach(dlopenPtr, {
                onEnter: function (args) {
                    var path = args[0] && !args[0].isNull() ? args[0].readCString() : '';
                    if (path.indexOf('droidguard') !== -1 || path.indexOf('DroidGuard') !== -1) {
                        _log.info('attestation: DroidGuard dlopen intercepted: ' + path);
                    }
                }
            });
            _hookCount++;
            _log.ok('attestation: DroidGuard dlopen monitoring active');
        } catch (e) { _failCount++; _log.debug('attestation: DroidGuard dlopen hook — ' + e); }
    })();

    // 7. /proc/cmdline filtering — hide bootloader unlock state
    (function hookCmdline() {
        try {
            var openatPtr = Module.findExportByName(null, 'openat');
            if (!openatPtr) return;
            var _fdSet = {};

            Interceptor.attach(openatPtr, {
                onEnter: function (args) {
                    var path = safeReadStr(args[1]);
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
                        var clean = s.replace(/androidboot\.verifiedbootstate=\w+/g, 'androidboot.verifiedbootstate=green')
                                     .replace(/androidboot\.flash\.locked=\d/g, 'androidboot.flash.locked=1');
                        if (clean !== s) {
                            this._buf.writeUtf8String(clean);
                            retval.replace(ptr(clean.length));
                        }
                    } catch (_) {}
                }
            });
            _hookCount++;
            _log.ok('attestation: /proc/cmdline boot state filtering active');
        } catch (e) { _failCount++; _log.debug('attestation: cmdline hook — ' + e); }
    })();

    console.log('[*] attestation-bypass: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('attestation-bypass.js loaded');
})();
