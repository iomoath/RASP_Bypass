/**
 * lib/stealth-hook-detection.js — Hook Detection Countermeasures
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Protects all other hooks from RASP hook-detection routines.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: RASP_auditor module 10
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('stealthHook', 'Hook Detection Countermeasures');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.stealthHook === false) return;

    var _hookCount = 0;
    var _failCount = 0;

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

    // 1. Stack trace filtering — remove Frida frames
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
                _hookCount++;
                _log.ok('stealthHook: Thread.getStackTrace() frida frame removal active');
            } catch (e) { _failCount++; _log.debug('stealthHook: getStackTrace hook — ' + e); }

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
                _hookCount++;
                _log.ok('stealthHook: Throwable.getStackTrace() frida frame removal active');
            } catch (e) { _failCount++; _log.debug('stealthHook: Throwable.getStackTrace hook — ' + e); }
        });
    })();

    // 2. dladdr() — GOT/PLT integrity: return expected module
    (function hookDladdr() {
        try {
            var dladdrPtr = Module.findExportByName(null, 'dladdr');
            if (!dladdrPtr) return;
            Interceptor.attach(dladdrPtr, {
                onLeave: function (retval) {
                    try {
                        var info = this.context.x1 || this.context.rsi;
                        if (!info || info.isNull()) return;
                        var dli_fname = info.readPointer();
                        if (dli_fname && !dli_fname.isNull()) {
                            var fname = safeReadStr(dli_fname);
                            if (fname.indexOf('frida') !== -1) {
                                info.writePointer(Module.findBaseAddress('libc.so'));
                            }
                        }
                    } catch (_) {}
                }
            });
            _hookCount++;
            _log.ok('stealthHook: dladdr() GOT/PLT spoofing active');
        } catch (e) { _failCount++; _log.debug('stealthHook: dladdr hook — ' + e); }
    })();

    // 3. RASP telemetry neutralization
    (function hookRASPTelemetry() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var Log  = Java.use('android.util.Log');
                var _origE = Log.e.overload('java.lang.String', 'java.lang.String');
                _origE.implementation = function (tag, msg) {
                    if (!tag) return 0;
                    for (var i = 0; i < RASP_PACKAGES.length; i++) {
                        if (tag.toLowerCase().indexOf(RASP_PACKAGES[i]) !== -1) return 0;
                    }
                    return _origE.call(this, tag, msg);
                };
                _hookCount++;
                _log.ok('stealthHook: RASP Log.e() telemetry suppression active');
            } catch (e) { _failCount++; _log.debug('stealthHook: Log.e hook — ' + e); }
        });
    })();

    // 4. Anti-termination hooks: block RASP from forcing app shutdown
    (function hookAntiTermination() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var System = Java.use('java.lang.System');
                System.exit.implementation = function (code) {
                    if (isCalledFromRASP()) {
                        _log.info('stealthHook: blocked System.exit(' + code + ') from RASP');
                        return;
                    }
                    this.exit(code);
                };
                _hookCount++;
            } catch (e) { _failCount++; _log.debug('stealthHook: System.exit hook — ' + e); }

            try {
                var AndroidProcess = Java.use('android.os.Process');
                // Block RASP-triggered process termination
                AndroidProcess.killProcess.implementation = function (pid) {
                    if (isCalledFromRASP()) {
                        _log.info('stealthHook: blocked Process.killProcess(' + pid + ') from RASP');
                        return;
                    }
                    this.killProcess(pid);
                };
                _hookCount++;
            } catch (e) { _failCount++; _log.debug('stealthHook: Process.killProcess hook — ' + e); }

            try {
                var Runtime = Java.use('java.lang.Runtime');
                Runtime.exit.implementation = function (code) {
                    if (isCalledFromRASP()) {
                        _log.info('stealthHook: blocked Runtime.exit(' + code + ') from RASP');
                        return;
                    }
                    this.exit(code);
                };
                _hookCount++;
            } catch (e) { _failCount++; _log.debug('stealthHook: Runtime.exit hook — ' + e); }

            try {
                var Activity = Java.use('android.app.Activity');
                Activity.finish.implementation = function () {
                    if (isCalledFromRASP()) {
                        _log.info('stealthHook: blocked Activity.finish() from RASP');
                        return;
                    }
                    this.finish();
                };
                _hookCount++;
            } catch (e) { _failCount++; _log.debug('stealthHook: Activity.finish hook — ' + e); }

            _log.ok('stealthHook: anti-termination hooks active');
        });
    })();

    console.log('[*] stealth-hook-detection: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('stealth-hook-detection.js loaded');
})();
