/**
 * lib/app-cloning-bypass.js — App Cloning Detection Bypass
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Defeats clone-app and dual-space detection mechanisms.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: RASP_auditor module 17
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('appCloning', 'App Cloning Detection Bypass');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.appCloning === false) return;

    // Known clone/dual-space package name patterns
    var CLONE_PKG_PATTERNS = [
        '.clone', '.dual', '.parallel', '.secondspace',
        'com.parallel.space', 'com.lbe.parallel', 'com.lenovo.safecenter',
        'com.huawei.clone', 'io.va', 'com.sand.airdroid'
    ];

    function isClonePackage(pkg) {
        if (!pkg) return false;
        for (var i = 0; i < CLONE_PKG_PATTERNS.length; i++) {
            if (pkg.indexOf(CLONE_PKG_PATTERNS[i]) !== -1) return true;
        }
        return false;
    }

    // 1. UserManager.isUserAGoat() → false
    (function hookIsUserAGoat() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var UserManager = Java.use('android.os.UserManager');
                UserManager.isUserAGoat.implementation = function () { return false; };
                _log.ok('appCloning: UserManager.isUserAGoat() → false');
            } catch (e) { _log.debug('appCloning: isUserAGoat hook — ' + e); }
        });
    })();

    // 2. UserManager.getUserProfiles() — filter clone profiles
    (function hookGetUserProfiles() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var UserManager = Java.use('android.os.UserManager');
                UserManager.getUserProfiles.implementation = function () {
                    var profiles = this.getUserProfiles();
                    if (!profiles) return profiles;
                    // Return only primary user (first profile)
                    var ArrayList = Java.use('java.util.ArrayList');
                    var filtered  = ArrayList.$new();
                    if (profiles.size() > 0) filtered.add(profiles.get(0));
                    return filtered;
                };
                _log.ok('appCloning: UserManager.getUserProfiles() filtered to primary user');
            } catch (e) { _log.debug('appCloning: getUserProfiles hook — ' + e); }
        });
    })();

    // 3. ActivityManager path normalization — remove /data/user/N prefix differences
    (function hookActivityManagerPaths() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var ActivityManager = Java.use('android.app.ActivityManager');
                ActivityManager.getRunningAppProcesses.implementation = function () {
                    var list = this.getRunningAppProcesses();
                    if (!list) return list;
                    var ArrayList = Java.use('java.util.ArrayList');
                    var filtered  = ArrayList.$new();
                    for (var i = 0; i < list.size(); i++) {
                        var proc    = list.get(i);
                        var pkgName = proc.processName ? proc.processName.value : '';
                        if (!isClonePackage(pkgName)) filtered.add(proc);
                    }
                    return filtered;
                };
                _log.ok('appCloning: ActivityManager process list clone filtering active');
            } catch (e) { _log.debug('appCloning: ActivityManager hook — ' + e); }
        });
    })();

    // 4. PackageManager — hide clone app packages
    (function hookPackageManagerClones() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var PM = Java.use('android.app.ApplicationPackageManager');
                PM.getInstalledPackages.overload('int').implementation = function (flags) {
                    var list     = this.getInstalledPackages(flags);
                    var filtered = Java.use('java.util.ArrayList').$new();
                    for (var i = 0; i < list.size(); i++) {
                        var pkg = list.get(i).packageName.value;
                        if (!isClonePackage(pkg)) filtered.add(list.get(i));
                    }
                    return filtered;
                };
                _log.ok('appCloning: PackageManager clone app hiding active');
            } catch (e) { _log.debug('appCloning: PackageManager hook — ' + e); }
        });
    })();

    // 5. File path normalization — /data/user/N → /data/data
    (function hookFilePathNormalization() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var File = Java.use('java.io.File');
                File.getCanonicalPath.implementation = function () {
                    var path = this.getCanonicalPath();
                    if (path) {
                        // Normalize /data/user/0/com.pkg → /data/data/com.pkg
                        path = path.replace(/\/data\/user\/\d+\//, '/data/data/');
                    }
                    return path;
                };
                _log.ok('appCloning: File path normalization active');
            } catch (e) { _log.debug('appCloning: File.getCanonicalPath hook — ' + e); }
        });
    })();

    _log.ok('app-cloning-bypass.js loaded');
})();
