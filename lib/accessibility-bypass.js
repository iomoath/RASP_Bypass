/**
 * lib/accessibility-bypass.js — Accessibility Service Hiding
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Hides enabled accessibility services from detection.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: RASP_auditor module 14
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('accessibility', 'Accessibility Service Hiding');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.accessibility === false) return;

    var _hookCount = 0;
    var _failCount = 0;

    // 1. AccessibilityManager hooks
    (function hookAccessibilityManager() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var AM = Java.use('android.view.accessibility.AccessibilityManager');

                AM.isEnabled.implementation = function () { return false; };

                AM.getEnabledAccessibilityServiceList.implementation = function (feedbackType) {
                    return Java.use('java.util.ArrayList').$new();
                };

                _hookCount++;
                _log.ok('accessibility: AccessibilityManager.isEnabled() → false');
                _log.ok('accessibility: getEnabledAccessibilityServiceList() → empty');
            } catch (e) { _failCount++; _log.debug('accessibility: AccessibilityManager hook — ' + e); }
        });
    })();

    // 2. Settings.Secure — enabled_accessibility_services → empty
    (function hookAccessibilitySettings() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var Settings = Java.use('android.provider.Settings$Secure');
                var _origGetString = Settings.getString.overload('android.content.ContentResolver', 'java.lang.String');
                _origGetString.implementation = function (cr, name) {
                    if (name === 'enabled_accessibility_services' ||
                        name === 'accessibility_enabled') {
                        return '';
                    }
                    return _origGetString.call(this, cr, name);
                };

                Settings.getInt.overload('android.content.ContentResolver', 'java.lang.String').implementation = function (cr, name) {
                    if (name === 'accessibility_enabled') return 0;
                    return this.getInt(cr, name);
                };
                Settings.getInt.overload('android.content.ContentResolver', 'java.lang.String', 'int').implementation = function (cr, name, def) {
                    if (name === 'accessibility_enabled') return 0;
                    return this.getInt(cr, name, def);
                };

                _hookCount++;
                _log.ok('accessibility: Settings.Secure accessibility hiding active');
            } catch (e) { _failCount++; _log.debug('accessibility: Settings.Secure hook — ' + e); }
        });
    })();

    console.log('[*] accessibility-bypass: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('accessibility-bypass.js loaded');
})();
