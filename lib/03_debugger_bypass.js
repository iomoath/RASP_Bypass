/**
 * lib/03_debugger_bypass.js — Debugger / ptrace Detection Bypass
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Neutralizes ptrace, TracerPid, JDWP, and Java debugger checks.
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
        BYPASS_BUS.registerModule('03_debugger_bypass', 'Debugger/ptrace Bypass');
    }

    var PTRACE_TRACEME  = 0;
    var PR_SET_DUMPABLE = 4;

    // ─────────────────────────────────────────────────────────────────────────
    // 1. ptrace() — return 0 for PTRACE_TRACEME
    // ─────────────────────────────────────────────────────────────────────────
    (function hookPtrace() {
        try {
            var ptracePtr = Module.findExportByName(null, 'ptrace');
            if (!ptracePtr) return;
            Interceptor.attach(ptracePtr, {
                onEnter: function (args) {
                    this._req = args[0].toInt32();
                },
                onLeave: function (retval) {
                    if (this._req === PTRACE_TRACEME) retval.replace(ptr(0));
                }
            });
            _log.ok('debugger: ptrace(PTRACE_TRACEME) → 0');
        } catch (e) { _log.debug('debugger: ptrace hook failed — ' + e); }
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 2. /proc/self/status — filter TracerPid
    // ─────────────────────────────────────────────────────────────────────────
    (function hookStatusRead() {
        try {
            var openatPtr = Module.findExportByName(null, 'openat');
            if (!openatPtr) return;
            var _fdSet = {};

            Interceptor.attach(openatPtr, {
                onEnter: function (args) {
                    var path = safeReadStr(args[1]);
                    this._status = (path.indexOf('/proc/self/status') !== -1 ||
                                   (path.indexOf('/proc/') !== -1 && path.indexOf('/status') !== -1));
                },
                onLeave: function (retval) {
                    if (this._status && retval.toInt32() > 0) _fdSet[retval.toInt32()] = true;
                }
            });

            var readPtr = Module.findExportByName(null, 'read');
            if (!readPtr) return;
            Interceptor.attach(readPtr, {
                onEnter: function (args) {
                    this._fd  = args[0].toInt32();
                    this._buf = args[1];
                    this._sz  = args[2].toInt32();
                },
                onLeave: function (retval) {
                    var n = retval.toInt32();
                    if (n <= 0 || !_fdSet[this._fd]) return;
                    try {
                        var s     = this._buf.readUtf8String(n);
                        var clean = s.replace(/TracerPid:\s*\d+/g, 'TracerPid:\t0');
                        if (clean !== s) {
                            this._buf.writeUtf8String(clean);
                            retval.replace(ptr(clean.length));
                        }
                    } catch (_) {}
                }
            });

            _log.ok('debugger: /proc/self/status TracerPid → 0');
        } catch (e) { _log.debug('debugger: status read hook failed — ' + e); }
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 3. prctl(PR_SET_DUMPABLE) — force dumpable = 1
    // ─────────────────────────────────────────────────────────────────────────
    (function hookPrctl() {
        try {
            var prctlPtr = Module.findExportByName(null, 'prctl');
            if (!prctlPtr) return;
            Interceptor.attach(prctlPtr, {
                onEnter: function (args) {
                    if (args[0].toInt32() === PR_SET_DUMPABLE) {
                        args[1] = ptr(1);
                    }
                }
            });
            _log.ok('debugger: prctl PR_SET_DUMPABLE forced to 1');
        } catch (e) { _log.debug('debugger: prctl hook failed — ' + e); }
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 4. signal / sigaction — suppress SIGTRAP-based anti-debug
    // ─────────────────────────────────────────────────────────────────────────
    (function hookSignals() {
        try {
            var SIGTRAP = 5;
            var sigactionPtr = Module.findExportByName(null, 'sigaction');
            if (!sigactionPtr) return;
            Interceptor.attach(sigactionPtr, {
                onEnter: function (args) {
                    if (args[0].toInt32() === SIGTRAP) {
                        // Don't override — just monitor
                        _log.debug('debugger: sigaction(SIGTRAP) intercepted');
                    }
                }
            });
        } catch (e) { _log.debug('debugger: sigaction hook failed — ' + e); }
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 5. Java: Debug.isDebuggerConnected() → false
    // ─────────────────────────────────────────────────────────────────────────
    (function hookJavaDebug() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var Debug = Java.use('android.os.Debug');
                Debug.isDebuggerConnected.implementation = function () { return false; };
                _log.ok('debugger: Debug.isDebuggerConnected() → false');
            } catch (e) { _log.debug('debugger: Debug hook failed — ' + e); }

            try {
                var AppInfo = Java.use('android.content.pm.ApplicationInfo');
                var FLAG_DEBUGGABLE = 2;
                AppInfo.flags.value = AppInfo.flags.value & ~FLAG_DEBUGGABLE;
            } catch (_) {}
        });
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 6. JDWP transport: suppress ART JDWP handshake detection
    // ─────────────────────────────────────────────────────────────────────────
    (function suppressJDWP() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var VMDebug = Java.use('dalvik.system.VMDebug');
                if (VMDebug.isDebuggingEnabled) {
                    VMDebug.isDebuggingEnabled.implementation = function () { return false; };
                    _log.ok('debugger: VMDebug.isDebuggingEnabled() → false');
                }
            } catch (e) { _log.debug('debugger: VMDebug hook — ' + e); }
        });
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 7. getppid() parent-check bypass: not directly hookable via export on most
    //    Android versions; use syscall interception approach
    // ─────────────────────────────────────────────────────────────────────────
    (function hookGetppid() {
        try {
            var getppidPtr = Module.findExportByName(null, 'getppid');
            if (!getppidPtr) return;
            Interceptor.attach(getppidPtr, {
                onLeave: function (retval) {
                    // Return PID 1 (init) as parent to defeat parent-process checks
                    if (retval.toInt32() > 1) retval.replace(ptr(1));
                }
            });
            _log.ok('debugger: getppid() → 1 (init)');
        } catch (e) { _log.debug('debugger: getppid hook — ' + e); }
    })();

    _log.ok('03_debugger_bypass.js — debugger detection bypass installed');
})();
