/**
 * lib/integrity-bypass.js — Signature / Tampering / Anti-Kill Bypass
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Defeats APK signature verification, hash/CRC checks, and app-termination.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: RASP_auditor module 09
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('integrity', 'Signature/Tampering/Anti-Kill');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.integrity === false) return;

    var ORIGINAL_INSTALLER = _CFG.originalInstaller || 'com.android.vending';

    var _cachedSig     = null;
    var _cachedSigHash = null;
    var _cachedSigStr  = null;

    // 1. PackageManager.getPackageInfo — cache original signatures
    (function hookGetPackageInfo() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var PackageManager = Java.use('android.app.ApplicationPackageManager');
                var GET_SIGNATURES           = 64;
                var GET_SIGNING_CERTIFICATES = 134217728;

                PackageManager.getPackageInfo.overload('java.lang.String', 'int').implementation = function (pkg, flags) {
                    var pi = this.getPackageInfo(pkg, flags);
                    if ((flags & GET_SIGNATURES) !== 0 || (flags & GET_SIGNING_CERTIFICATES) !== 0) {
                        if (pi && pi.signatures && pi.signatures.value && !_cachedSig) {
                            _cachedSig = pi.signatures.value;
                            if (_cachedSig && _cachedSig.length > 0) {
                                _cachedSigHash = _cachedSig[0].hashCode();
                                _cachedSigStr  = _cachedSig[0].toCharsString();
                            }
                        }
                    }
                    return pi;
                };
                _log.ok('integrity: PackageManager.getPackageInfo() signature caching active');
            } catch (e) { _log.debug('integrity: getPackageInfo hook — ' + e); }
        });
    })();

    // 2. Signature.hashCode() / toCharsString() — return cached original
    (function hookSignature() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var Signature = Java.use('android.content.pm.Signature');
                Signature.hashCode.implementation = function () {
                    if (_cachedSigHash !== null) return _cachedSigHash;
                    return this.hashCode();
                };
                Signature.toCharsString.implementation = function () {
                    if (_cachedSigStr !== null) return _cachedSigStr;
                    return this.toCharsString();
                };
                _log.ok('integrity: Signature hooks active');
            } catch (e) { _log.debug('integrity: Signature hook — ' + e); }
        });
    })();

    // 3. MessageDigest.digest() — cache first result per algorithm
    (function hookMessageDigest() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var MessageDigest = Java.use('java.security.MessageDigest');
                var _cache = {};
                MessageDigest.digest.overload().implementation = function () {
                    var algo   = this.getAlgorithm();
                    var result = this.digest();
                    if (!_cache[algo]) _cache[algo] = result;
                    return _cache[algo];
                };
                _log.ok('integrity: MessageDigest.digest() caching active');
            } catch (e) { _log.debug('integrity: MessageDigest hook — ' + e); }
        });
    })();

    // 4. CRC32.getValue() — cache first checksum
    (function hookCRC32() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var CRC32 = Java.use('java.util.zip.CRC32');
                var _crc_cache = null;
                CRC32.getValue.implementation = function () {
                    var val = this.getValue();
                    if (_crc_cache === null) _crc_cache = val;
                    return _crc_cache;
                };
                _log.ok('integrity: CRC32.getValue() caching active');
            } catch (e) { _log.debug('integrity: CRC32 hook — ' + e); }
        });
    })();

    // 5. getInstallerPackageName() → Play Store
    (function hookInstaller() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var PM = Java.use('android.app.ApplicationPackageManager');
                PM.getInstallerPackageName.implementation = function (_pkg) {
                    return ORIGINAL_INSTALLER;
                };
                _log.ok('integrity: getInstallerPackageName() → ' + ORIGINAL_INSTALLER);
            } catch (e) { _log.debug('integrity: getInstallerPackageName hook — ' + e); }

            try {
                var PM2 = Java.use('android.app.ApplicationPackageManager');
                PM2.getInstallSourceInfo.implementation = function (pkg) {
                    var info = this.getInstallSourceInfo(pkg);
                    try {
                        var InstallSourceInfo = Java.use('android.content.pm.InstallSourceInfo');
                        return InstallSourceInfo.$new(
                            ORIGINAL_INSTALLER, null, ORIGINAL_INSTALLER, null
                        );
                    } catch (_) { return info; }
                };
                _log.ok('integrity: getInstallSourceInfo() → Play Store');
            } catch (e) { _log.debug('integrity: getInstallSourceInfo hook — ' + e); }
        });
    })();

    // 6. Anti-termination: block app shutdown triggered by integrity checks
    (function hookAntiTermination() {
        if (!Java.available) return;
        Java.perform(function () {
            var antiTermMethods = [
                { cls: 'java.lang.System',            method: 'exit',                    args: ['int'] },
                { cls: 'android.os.Process',          method: 'killProcess',             args: ['int'] },
                { cls: 'java.lang.Runtime',           method: 'exit',                    args: ['int'] },
                { cls: 'android.app.Activity',        method: 'finish',                  args: [] },
                { cls: 'android.app.ActivityManager', method: 'killBackgroundProcesses', args: ['java.lang.String'] }
            ];

            antiTermMethods.forEach(function (entry) {
                try {
                    var cls    = Java.use(entry.cls);
                    var method = entry.args.length > 0
                        ? cls[entry.method].overload.apply(cls[entry.method], entry.args)
                        : cls[entry.method];
                    method.implementation = function () {
                        _log.info('integrity: blocked ' + entry.cls + '.' + entry.method + '()');
                    };
                } catch (e) { _log.debug('integrity: anti-termination ' + entry.method + ' — ' + e); }
            });
            _log.ok('integrity: anti-termination hooks active');
        });
    })();

    // 7. Native libcrypto hash monitoring
    (function monitorNativeHashes() {
        try {
            var sha256FinalPtr = Module.findExportByName('libcrypto.so', 'SHA256_Final');
            if (!sha256FinalPtr) return;
            Interceptor.attach(sha256FinalPtr, {
                onLeave: function () { _log.debug('integrity: SHA256_Final called'); }
            });
        } catch (e) { _log.debug('integrity: native hash monitor — ' + e); }
    })();

    _log.ok('integrity-bypass.js loaded');
})();
