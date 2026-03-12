/**
 * lib/screen-capture-bypass.js — Screen Capture Bypass
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Clears FLAG_SECURE from windows to allow screen capture / recording.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: RASP_auditor module 16
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('screenCapture', 'Screen Capture Bypass');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.screenCapture === false) return;

    var _hookCount = 0;
    var _failCount = 0;

    var FLAG_SECURE = 8192; // 0x2000

    // 1. Window.setFlags() — clear FLAG_SECURE
    (function hookWindowSetFlags() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var Window = Java.use('android.view.Window');
                Window.setFlags.implementation = function (flags, mask) {
                    flags = flags & ~FLAG_SECURE;
                    mask  = mask  & ~FLAG_SECURE;
                    return this.setFlags(flags, mask);
                };
                _hookCount++;
                _log.ok('screenCapture: Window.setFlags() FLAG_SECURE cleared');
            } catch (e) { _failCount++; _log.debug('screenCapture: Window.setFlags hook — ' + e); }

            // 2. Window.addFlags() — clear FLAG_SECURE
            try {
                var Window2 = Java.use('android.view.Window');
                Window2.addFlags.implementation = function (flags) {
                    flags = flags & ~FLAG_SECURE;
                    return this.addFlags(flags);
                };
                _hookCount++;
                _log.ok('screenCapture: Window.addFlags() FLAG_SECURE cleared');
            } catch (e) { _failCount++; _log.debug('screenCapture: Window.addFlags hook — ' + e); }
        });
    })();

    // 3. WindowManager.LayoutParams flags clearing
    (function hookLayoutParams() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var LayoutParams = Java.use('android.view.WindowManager$LayoutParams');
                LayoutParams.$init.overload('int', 'int', 'int', 'int', 'int').implementation = function (w, h, type, flags, format) {
                    flags = flags & ~FLAG_SECURE;
                    return this.$init(w, h, type, flags, format);
                };
                _hookCount++;
                _log.ok('screenCapture: WindowManager.LayoutParams FLAG_SECURE cleared');
            } catch (e) { _failCount++; _log.debug('screenCapture: LayoutParams hook — ' + e); }
        });
    })();

    // 4. SurfaceView.setSecure() → no-op
    (function hookSurfaceViewSecure() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var SurfaceView = Java.use('android.view.SurfaceView');
                if (SurfaceView.setSecure) {
                    SurfaceView.setSecure.implementation = function (isSecure) {
                        // no-op: always allow capture
                    };
                    _hookCount++;
                    _log.ok('screenCapture: SurfaceView.setSecure() → no-op');
                }
            } catch (e) { _failCount++; _log.debug('screenCapture: SurfaceView.setSecure hook — ' + e); }
        });
    })();

    console.log('[*] screen-capture-bypass: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('screen-capture-bypass.js loaded');
})();
