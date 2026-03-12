/**
 * lib/disable-flutter-tls.js — Flutter / Dart TLS Bypass
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Dedicated Flutter TLS handling using NVISOsecurity byte-pattern scanning.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: NVISOsecurity/disable-flutter-tls-verification (credit NVISO)
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('flutter', 'Flutter/Dart TLS Bypass');

    var _hookCount = 0;
    var _failCount = 0;

    var _flutterEnabled = (typeof BYPASS_BUS !== 'undefined') ? BYPASS_BUS.enabled.flutter :
                          (_CFG.modules ? _CFG.modules.flutter : true);
    if (_flutterEnabled === false) return;

    var ARCH = Process.arch;

    // Patterns from NVISOsecurity/disable-flutter-tls-verification and
    // httptoolkit/android-disable-flutter-certificate-pinning.js
    // Covering Flutter v2.0.0 – v3.32.0
    var PATTERNS = {
        arm64: [
            // Original NVISO patterns
            '60 0? 00 54 ?? ?? ?? ?? ?? ?? 00 94',
            '20 0? 00 54 ?? ?? ?? ?? ?? ?? 00 94',
            'E0 03 00 AA ?? ?? ?? ?? ?? ?? 00 94',
            '00 00 00 14 ?? ?? ?? ?? ?? ?? 00 94',
            // httptoolkit extended patterns (Flutter 2.x - 3.x)
            '60 0? 00 54 ?? ?? ?? ?? ?? ?? ?? 94',
            '20 0? 00 54 ?? ?? ?? ?? ?? ?? ?? 94',
            'E0 03 00 AA ?? ?? ?? ?? ?? ?? ?? 94',
            '00 00 00 14 ?? ?? ?? ?? ?? ?? ?? 94',
            // Flutter 3.x newer build patterns
            'A0 0? 00 54 ?? ?? ?? ?? ?? ?? 00 94',
            'C0 0? 00 54 ?? ?? ?? ?? ?? ?? 00 94',
            '00 01 00 54 ?? ?? ?? ?? ?? ?? 00 94',
            '00 02 00 54 ?? ?? ?? ?? ?? ?? 00 94'
        ],
        arm: [
            '2D E9 ?? ?? 98 40',
            'F0 B5 03 ?? ?? ?? 01 25',
            'F0 B5 ?? ?? ?? ?? 01 2? 01 2?',
            // Additional arm patterns
            '10 B5 ?? ?? ?? ?? ?? ?? 00 28',
            '2D E9 F0 4F ?? ?? ?? ?? 4D F8'
        ],
        x64: [
            // Original patterns
            '74 ?? 48 8? ?? 48 8? ?? E8 ?? ?? ?? ??',
            '75 ?? 48 8? ?? ?? ?? E8 ?? ?? ?? ??',
            '0F 84 ?? ?? 00 00 E8 ?? ?? ?? ??',
            // Additional x64 patterns for emulator support
            '74 ?? 48 8B ?? 48 8B ?? FF 1? ?? ?? ?? ??',
            '0F 85 ?? ?? 00 00 48 8B ?? E8 ?? ?? ?? ??',
            '74 ?? 48 8B ?? ?? E8 ?? ?? ?? ??'
        ],
        ia32: [
            '74 ?? 8B ?? 89 ?? E8 ?? ?? ?? ??',
            '74 ?? 8B ?? E8 ?? ?? ?? ??'
        ]
    };

    var FLUTTER_MODULE   = 'libflutter.so';
    var MAX_RETRIES      = 20;
    var RETRY_INTERVAL   = 500;

    function waitForModule(name, timeoutMs) {
        if (typeof BYPASS_UTILS !== 'undefined' && BYPASS_UTILS.waitForModule) {
            return BYPASS_UTILS.waitForModule(name, timeoutMs);
        }
        return new Promise(function (resolve, reject) {
            var deadline = Date.now() + (timeoutMs || 10000);
            function attempt() {
                var mod = Process.findModuleByName(name);
                if (mod) { resolve(mod); return; }
                if (Date.now() >= deadline) { reject(new Error('Timeout: ' + name)); return; }
                setTimeout(attempt, 300);
            }
            attempt();
        });
    }

    function hook_ssl_verify_peer_cert(addr) {
        try {
            Interceptor.replace(addr, new NativeCallback(function (_ssl) {
                return 0; // SSL_VERIFY_SUCCESS
            }, 'int', ['pointer']));
            _hookCount++;
            _log.ok('flutter: ssl_verify_peer_cert replaced @ ' + addr);
            return true;
        } catch (e) {
            _log.debug('flutter: replace failed @ ' + addr + ' — ' + e);
            return false;
        }
    }

    function findAndPatch(baseAddr, size, patterns) {
        var patched = 0;
        patterns.forEach(function (pattern) {
            try {
                var matches = Memory.scanSync(baseAddr, size, pattern);
                matches.forEach(function (m) {
                    if (hook_ssl_verify_peer_cert(m.address)) patched++;
                });
            } catch (e) { _failCount++; _log.debug('flutter: scan error — ' + e); }
        });
        return patched;
    }

    function isFlutterRange(name) {
        if (!name) return false;
        return name.indexOf('flutter') !== -1 || name.indexOf('Flutter') !== -1;
    }

    function disableTLSValidation(flutterModule) {
        var patched = 0;

        // Export-based approach first
        var exportNames = ['ssl_verify_peer_cert', 'SSL_CTX_set_custom_verify'];
        exportNames.forEach(function (sym) {
            var addr = Module.findExportByName(flutterModule ? flutterModule.name : null, sym);
            if (addr && hook_ssl_verify_peer_cert(addr)) patched++;
        });

        if (patched > 0) {
            _hookCount++;
            _log.ok('flutter: patched via exports (' + patched + ')');
            return;
        }

        // Pattern scanning
        var archPatterns = PATTERNS[ARCH] || [];
        if (archPatterns.length === 0) {
            _log.fail('flutter: no patterns for arch ' + ARCH);
            return;
        }

        if (flutterModule) {
            patched = findAndPatch(flutterModule.base, flutterModule.size, archPatterns);
            if (patched > 0) _hookCount++;
            _log.ok('flutter: patched ' + patched + ' via patterns in libflutter.so');
        } else {
            Process.enumerateRanges('r-x').forEach(function (range) {
                if (isFlutterRange(range.file ? range.file.path : '')) {
                    patched += findAndPatch(range.base, range.size, archPatterns);
                }
            });
            if (patched > 0) _hookCount++;
            _log.ok('flutter: patched ' + patched + ' via r-x range scan');
        }
    }

    (function main() {
        var mod = Process.findModuleByName(FLUTTER_MODULE);
        if (mod) {
            disableTLSValidation(mod);
            return;
        }

        _log.info('flutter: libflutter.so not found yet — waiting...');
        var retries = 0;
        function retry() {
            retries++;
            var m = Process.findModuleByName(FLUTTER_MODULE);
            if (m) { disableTLSValidation(m); return; }
            if (retries < MAX_RETRIES) {
                setTimeout(retry, RETRY_INTERVAL);
            } else {
                _log.info('flutter: libflutter.so timeout — scanning all r-x ranges');
                disableTLSValidation(null);
            }
        }
        setTimeout(retry, RETRY_INTERVAL);
    })();

    console.log('[*] disable-flutter-tls: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('disable-flutter-tls.js loaded');
})();
