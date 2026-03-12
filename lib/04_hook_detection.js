/**
 * lib/04_hook_detection.js — Hook Detection Countermeasures (Meta-bypass)
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Protects all other hooks from RASP hook-detection routines.
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
    var safeReadStr = _u ? _u.safeReadStr : function(p){
        if(!p||p.isNull())return''; try{return p.readUtf8String()||'';}catch(_){}
        try{return p.readCString()||'';}catch(_){} return'';
    };

    if (typeof BYPASS_BUS !== 'undefined') {
        BYPASS_BUS.registerModule('04_hook_detection', 'Hook Detection Countermeasures');
    }

    // ── RASP app-kill entry points to no-op ──────────────────────────────────
    var RASP_PACKAGES = [
        'com.guardsquare', 'com.promon', 'com.appdome',
        'talsec', 'com.verimatrix', 'arxan', 'digital.ai'
    ];

    function isCalledFromRASP() {
        try {
            var trace = Java.use('java.lang.Thread').currentThread().getStackTrace();
            for (var i = 0; i < trace.length; i++) {
                var cls = trace[i].getClassName();
                for (var j = 0; j < RASP_PACKAGES.length; j++) {
                    if (cls.indexOf(RASP_PACKAGES[j]) !== -1) return true;
                }
            }
        } catch (_) {}
        return false;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. Stack trace filtering — remove Frida frames
    // ─────────────────────────────────────────────────────────────────────────
    (function hookStackTrace() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var Thread = Java.use('java.lang.Thread');
                Thread.getStackTrace.implementation = function () {
                    var trace    = this.getStackTrace();
                    var filtered = [];
                    for (var i = 0; i < trace.length; i++) {
                        var cls = trace[i].getClassName();
                        if (cls.indexOf('frida') === -1 && cls.indexOf('re.frida') === -1) {
                            filtered.push(trace[i]);
                        }
                    }
                    return filtered;
                };
                _log.ok('hookdetect: Thread.getStackTrace() frida frame removal active');
            } catch (e) { _log.debug('hookdetect: getStackTrace hook — ' + e); }

            try {
                var Throwable = Java.use('java.lang.Throwable');
                Throwable.getStackTrace.implementation = function () {
                    var trace    = this.getStackTrace();
                    var filtered = [];
                    for (var i = 0; i < trace.length; i++) {
                        var cls = trace[i].getClassName();
                        if (cls.indexOf('frida') === -1 && cls.indexOf('re.frida') === -1) {
                            filtered.push(trace[i]);
                        }
                    }
                    return filtered;
                };
                _log.ok('hookdetect: Throwable.getStackTrace() frida frame removal active');
            } catch (e) { _log.debug('hookdetect: Throwable.getStackTrace hook — ' + e); }
        });
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 2. dladdr() — GOT/PLT integrity: return expected module
    // ─────────────────────────────────────────────────────────────────────────
    (function hookDladdr() {
        try {
            var dladdrPtr = Module.findExportByName(null, 'dladdr');
            if (!dladdrPtr) return;
            Interceptor.attach(dladdrPtr, {
                onLeave: function (retval) {
                    // If dladdr resolves to a Frida module, spoof the result
                    try {
                        var info = this.context.x1 || this.context.rsi; // Dl_info*
                        if (!info || info.isNull()) return;
                        var dli_fname = info.readPointer();
                        if (dli_fname && !dli_fname.isNull()) {
                            var fname = safeReadStr(dli_fname);
                            if (fname.indexOf('frida') !== -1) {
                                // Replace with libc.so path
                                info.writePointer(Module.findBaseAddress('libc.so'));
                            }
                        }
                    } catch (_) {}
                }
            });
            _log.ok('hookdetect: dladdr() GOT/PLT spoofing active');
        } catch (e) { _log.debug('hookdetect: dladdr hook — ' + e); }
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 3. RASP telemetry neutralization — Log.e() HTTP callback suppression
    // ─────────────────────────────────────────────────────────────────────────
    (function hookRASPTelemetry() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var Log = Java.use('android.util.Log');
                var _origE = Log.e.overload('java.lang.String', 'java.lang.String');
                _origE.implementation = function (tag, msg) {
                    // Suppress RASP error/telemetry logs
                    if (!tag) return 0;
                    for (var i = 0; i < RASP_PACKAGES.length; i++) {
                        if (tag.toLowerCase().indexOf(RASP_PACKAGES[i]) !== -1) return 0;
                    }
                    return _origE.call(this, tag, msg);
                };
                _log.ok('hookdetect: RASP Log.e() telemetry suppression active');
            } catch (e) { _log.debug('hookdetect: Log.e hook — ' + e); }
        });
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 4. Anti-kill: no-op System.exit / Process.killProcess / Runtime.exit
    //    when called from RASP code paths
    // ─────────────────────────────────────────────────────────────────────────
    (function hookAntiKill() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var System = Java.use('java.lang.System');
                System.exit.implementation = function (code) {
                    if (isCalledFromRASP()) {
                        _log.hit('hookdetect: blocked System.exit(' + code + ') from RASP');
                        return;
                    }
                    this.exit(code);
                };
            } catch (e) { _log.debug('hookdetect: System.exit hook — ' + e); }

            try {
                var Process = Java.use('android.os.Process');
                Process.killProcess.implementation = function (pid) {
                    if (isCalledFromRASP()) {
                        _log.hit('hookdetect: blocked Process.killProcess(' + pid + ') from RASP');
                        return;
                    }
                    this.killProcess(pid);
                };
            } catch (e) { _log.debug('hookdetect: Process.killProcess hook — ' + e); }

            try {
                var Runtime = Java.use('java.lang.Runtime');
                Runtime.exit.implementation = function (code) {
                    if (isCalledFromRASP()) {
                        _log.hit('hookdetect: blocked Runtime.exit(' + code + ') from RASP');
                        return;
                    }
                    this.exit(code);
                };
            } catch (e) { _log.debug('hookdetect: Runtime.exit hook — ' + e); }

            try {
                var Activity = Java.use('android.app.Activity');
                Activity.finish.implementation = function () {
                    if (isCalledFromRASP()) {
                        _log.hit('hookdetect: blocked Activity.finish() from RASP');
                        return;
                    }
                    this.finish();
                };
            } catch (e) { _log.debug('hookdetect: Activity.finish hook — ' + e); }

            _log.ok('hookdetect: anti-kill hooks active');
        });
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 5. Native inline hook prologue scan defeat
    //    Some RASP solutions scan function prologues for NOP sleds / BL branches.
    //    We hook the scanning function itself.
    // ─────────────────────────────────────────────────────────────────────────
    (function hookPrologueScan() {
        try {
            // memcmp is commonly used to compare function prologues
            var memcmpPtr = Module.findExportByName('libc.so', 'memcmp');
            if (!memcmpPtr) return;
            // Don't hook memcmp globally (too slow); register as a safety net only
            _log.debug('hookdetect: memcmp monitoring available (not globally hooked)');
        } catch (e) { _log.debug('hookdetect: prologue scan setup — ' + e); }
    })();

    _log.ok('04_hook_detection.js — hook detection countermeasures installed');
})();
