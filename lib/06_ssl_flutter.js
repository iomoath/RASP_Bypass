/**
 * lib/06_ssl_flutter.js — Flutter / BoringSSL TLS Verification Bypass
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Dedicated Flutter handling using NVISOsecurity patterns + export-based hooks.
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
        BYPASS_BUS.registerModule('06_ssl_flutter', 'Flutter/BoringSSL Bypass');
    }

    // ── Architecture detection ───────────────────────────────────────────────
    var ARCH = Process.arch; // 'arm64', 'arm', 'x64', 'ia32'

    // ── Byte patterns per architecture (from NVISOsecurity) ─────────────────
    var PATTERNS = {
        arm64: [
            '60 0? 00 54 ?? ?? ?? ?? ?? ?? 00 94',
            '20 0? 00 54 ?? ?? ?? ?? ?? ?? 00 94',
            'E0 03 00 AA ?? ?? ?? ?? ?? ?? 00 94',
            '00 00 00 14 ?? ?? ?? ?? ?? ?? 00 94'
        ],
        arm: [
            '2D E9 ?? ?? 98 40',
            'F0 B5 03 ?? ?? ?? 01 25',
            'F0 B5 ?? ?? ?? ?? 01 2? 01 2?'
        ],
        x64: [
            '74 ?? 48 8? ?? 48 8? ?? E8 ?? ?? ?? ??',
            '75 ?? 48 8? ?? ?? ?? E8 ?? ?? ?? ??',
            '0F 84 ?? ?? 00 00 E8 ?? ?? ?? ??'
        ],
        ia32: [
            '74 ?? 8B ?? 89 ?? E8 ?? ?? ?? ??'
        ]
    };

    var FLUTTER_MODULE = 'libflutter.so';
    var MAX_RETRIES    = 20;
    var RETRY_INTERVAL = 500; // ms

    // ─────────────────────────────────────────────────────────────────────────
    // waitForModule helper
    // ─────────────────────────────────────────────────────────────────────────
    function waitForModule(name, timeoutMs) {
        return new Promise(function (resolve, reject) {
            var deadline = Date.now() + (timeoutMs || 10000);
            function attempt() {
                var mod = Process.findModuleByName(name);
                if (mod) { resolve(mod); return; }
                if (Date.now() >= deadline) { reject(new Error('Timeout: ' + name)); return; }
                setTimeout(attempt, RETRY_INTERVAL);
            }
            attempt();
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // isFlutterRange — check if memory range likely belongs to Flutter
    // ─────────────────────────────────────────────────────────────────────────
    function isFlutterRange(name) {
        if (!name) return false;
        return name.indexOf('flutter') !== -1 || name.indexOf('Flutter') !== -1;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // hook_ssl_verify_peer_cert — replace via NativeCallback returning 0
    // ─────────────────────────────────────────────────────────────────────────
    function hook_ssl_verify_peer_cert(addr) {
        try {
            Interceptor.replace(addr, new NativeCallback(function (_ssl) {
                return 0; // X509_V_OK (SSL_VERIFY_SUCCESS)
            }, 'int', ['pointer']));
            _log.ok('flutter: ssl_verify_peer_cert replaced @ ' + addr);
            return true;
        } catch (e) {
            _log.debug('flutter: replace failed @ ' + addr + ' — ' + e);
            return false;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // findAndPatch — scan memory range for byte patterns, patch each match
    // ─────────────────────────────────────────────────────────────────────────
    function findAndPatch(baseAddr, size, patterns) {
        var patched = 0;
        patterns.forEach(function (pattern) {
            try {
                var matches = Memory.scanSync(baseAddr, size, pattern);
                matches.forEach(function (m) {
                    if (hook_ssl_verify_peer_cert(m.address)) patched++;
                });
            } catch (e) {
                _log.debug('flutter: scan error — ' + e);
            }
        });
        return patched;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // disableTLSValidation — main entry, called after module loaded
    // ─────────────────────────────────────────────────────────────────────────
    function disableTLSValidation(flutterModule) {
        var patched = 0;

        // 1. Export-based approach
        var exportNames = ['ssl_verify_peer_cert', 'SSL_CTX_set_custom_verify'];
        exportNames.forEach(function (sym) {
            var addr = Module.findExportByName(flutterModule ? flutterModule.name : null, sym);
            if (addr) {
                if (hook_ssl_verify_peer_cert(addr)) patched++;
            }
        });

        if (patched > 0) {
            _log.ok('flutter: patched via exports (' + patched + ')');
            return;
        }

        // 2. Pattern scanning approach
        var archPatterns = PATTERNS[ARCH] || [];
        if (archPatterns.length === 0) {
            _log.fail('flutter: no patterns for arch ' + ARCH);
            return;
        }

        if (flutterModule) {
            patched = findAndPatch(flutterModule.base, flutterModule.size, archPatterns);
            _log.ok('flutter: patched ' + patched + ' via patterns in libflutter.so');
        } else {
            // Android bypass mode: scan all r-x ranges
            Process.enumerateRanges('r-x').forEach(function (range) {
                if (isFlutterRange(range.file ? range.file.path : '')) {
                    patched += findAndPatch(range.base, range.size, archPatterns);
                }
            });
            _log.ok('flutter: patched ' + patched + ' via r-x range scan');
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Main: try immediate hook, then wait with retry
    // ─────────────────────────────────────────────────────────────────────────
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
            if (m) {
                disableTLSValidation(m);
                return;
            }
            if (retries < MAX_RETRIES) {
                setTimeout(retry, RETRY_INTERVAL);
            } else {
                // Final fallback: scan all r-x ranges without module constraint
                _log.info('flutter: libflutter.so timeout — scanning all r-x ranges');
                disableTLSValidation(null);
            }
        }
        setTimeout(retry, RETRY_INTERVAL);
    })();

    _log.ok('06_ssl_flutter.js — Flutter TLS bypass installed');
})();
