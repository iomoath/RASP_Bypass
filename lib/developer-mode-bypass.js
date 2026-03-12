/**
 * lib/developer-mode-bypass.js — Developer Mode Hiding
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Hides developer mode / ADB enabled state from app checks.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: RASP_auditor module 05
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('devMode', 'Developer Mode Hiding');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.devMode === false) return;

    var DEV_SETTINGS = {
        'adb_enabled'                  : '0',
        'development_settings_enabled' : '0',
        'mock_location'                : '0',
        'install_non_market_apps'      : '0'
    };

    // Settings.Secure + Settings.Global — adb_enabled / development_settings_enabled → 0
    (function hookDeveloperModeSettings() {
        if (!Java.available) return;
        Java.perform(function () {
            ['android.provider.Settings$Secure', 'android.provider.Settings$Global'].forEach(function (cls) {
                try {
                    var Settings = Java.use(cls);

                    Settings.getInt.overload('android.content.ContentResolver', 'java.lang.String').implementation = function (cr, name) {
                        if (DEV_SETTINGS[name] !== undefined) return parseInt(DEV_SETTINGS[name]);
                        return this.getInt(cr, name);
                    };
                    Settings.getInt.overload('android.content.ContentResolver', 'java.lang.String', 'int').implementation = function (cr, name, def) {
                        if (DEV_SETTINGS[name] !== undefined) return parseInt(DEV_SETTINGS[name]);
                        return this.getInt(cr, name, def);
                    };
                    Settings.getString.overload('android.content.ContentResolver', 'java.lang.String').implementation = function (cr, name) {
                        if (DEV_SETTINGS[name] !== undefined) return DEV_SETTINGS[name];
                        return this.getString(cr, name);
                    };
                    _log.ok('devMode: ' + cls + ' developer mode spoofing active');
                } catch (e) { _log.debug('devMode: Settings hook for ' + cls + ' — ' + e); }
            });
        });
    })();

    // USB / ADB state — system property level
    (function hookAdbSystemProps() {
        try {
            var propGet = Module.findExportByName('libc.so', '__system_property_get') ||
                          Module.findExportByName(null, '__system_property_get');
            if (!propGet) return;
            var ADB_PROPS = {
                'sys.usb.config'  : 'none',
                'sys.usb.state'   : 'none',
                'ro.adb.secure'   : '1',
                'service.adb.root': '0'
            };
            Interceptor.attach(propGet, {
                onEnter: function (args) {
                    this._key = safeReadStr(args[0]);
                    this._val = args[1];
                },
                onLeave: function () {
                    if (ADB_PROPS[this._key] !== undefined) {
                        try { this._val.writeUtf8String(ADB_PROPS[this._key]); } catch (_) {}
                    }
                }
            });
            _log.ok('devMode: ADB system property spoofing active');
        } catch (e) { _log.debug('devMode: ADB system props hook — ' + e); }
    })();

    _log.ok('developer-mode-bypass.js loaded');
})();
