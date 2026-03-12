/**
 * lib/01_root_bypass.js — Root / Magisk / KernelSU Detection Bypass
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Hides all root indicators at both Java and native layers.
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
        BYPASS_BUS.registerModule('01_root_bypass', 'Root/Magisk/KernelSU Bypass');
    }

    // ── Known su / root binary paths ─────────────────────────────────────────
    var ROOT_PATHS = [
        '/su', '/su/bin/su', '/system/bin/su', '/system/xbin/su',
        '/sbin/su', '/system/su', '/system/bin/.ext/.su',
        '/system/usr/we-need-root/su-backup',
        '/system/xbin/mu', '/data/local/su', '/data/local/bin/su',
        '/data/local/xbin/su', '/sbin/.magisk', '/sbin/.core/mirror',
        '/sbin/.core/img', '/sbin/.core/db-0/magisk.db',
        '/data/adb/magisk', '/data/adb/magisk.img', '/data/adb/modules',
        '/cache/magisk.log', '/data/magisk.img', '/data/magisk.db',
        '/data/adb/ksu', '/data/adb/ksud', '/system/lib/libshamiko.so',
        '/data/user/0/com.topjohnwu.magisk', '/sbin/ksud',
        '/data/adb/ksu/bin/ksud', '/proc/kallsyms',
        '/magisk', '/system/app/Superuser.apk',
        '/system/etc/init.d/99SuperSUDaemon',
        '/dev/com.koushikdutta.superuser.daemon/',
        '/system/xbin/daemonsu',
        '/system/bin/failsafe/toolbox',
        '/dev/block/system'
    ];

    var SU_MGMT_PACKAGES = [
        'com.topjohnwu.magisk', 'com.noshufou.android.su',
        'eu.chainfire.supersu', 'com.koushikdutta.superuser',
        'com.thirdparty.superuser', 'com.yellowes.su',
        'com.zachspong.temprootremovejb', 'com.ramdroid.appquarantine',
        'com.devadvance.rootcloak', 'com.formyhm.hideroot',
        'com.amphoras.hidemyroot', 'com.zachspong.temprootremovejb',
        'com.android.vending.billing.InAppBillingService.COIN',
        'com.kingroot.kinguser', 'com.kingo.root', 'com.smedialink.oneclickroot',
        'com.zhiqupk.root.global', 'com.alephzain.framaroot',
        'com.czsun.rilu.mobileAssistant', 'me.weishu.kernelsu'
    ];

    function isSuCmd(cmd) {
        if (!cmd) return false;
        return cmd === 'su' || /[\/\s]su(\s|$)/.test(cmd) ||
               cmd.indexOf(' su') !== -1 || cmd === 'which su' ||
               cmd.indexOf('ps') !== -1 && cmd.indexOf('su') !== -1;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. Java — File.exists() + File.canExecute()
    // ─────────────────────────────────────────────────────────────────────────
    (function hookJavaFile() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var File = Java.use('java.io.File');
                File.exists.implementation = function () {
                    var path = this.getAbsolutePath();
                    for (var i = 0; i < ROOT_PATHS.length; i++) {
                        if (path === ROOT_PATHS[i] || path.indexOf('magisk') !== -1 ||
                            path.indexOf('/su') !== -1) return false;
                    }
                    return this.exists.call(this);
                };
                File.canExecute.implementation = function () {
                    var path = this.getAbsolutePath();
                    for (var i = 0; i < ROOT_PATHS.length; i++) {
                        if (path === ROOT_PATHS[i]) return false;
                    }
                    return this.canExecute.call(this);
                };
                _log.ok('root: Java File hooks active');
            } catch (e) { _log.debug('root: Java File hook failed — ' + e); }
        });
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 2. Java — Runtime.exec() — block su commands
    // ─────────────────────────────────────────────────────────────────────────
    (function hookRuntimeExec() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var Runtime  = Java.use('java.lang.Runtime');
                var IOExcept = Java.use('java.io.IOException');

                Runtime.exec.overload('java.lang.String').implementation = function (cmd) {
                    if (isSuCmd(cmd)) throw IOExcept.$new('Permission denied');
                    return this.exec(cmd);
                };
                Runtime.exec.overload('[Ljava.lang.String;').implementation = function (cmds) {
                    if (cmds && cmds.length > 0 && isSuCmd(cmds[0])) throw IOExcept.$new('Permission denied');
                    return this.exec(cmds);
                };
                _log.ok('root: Runtime.exec() su blocking active');
            } catch (e) { _log.debug('root: Runtime.exec hook failed — ' + e); }
        });
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 3. RootBeer library
    // ─────────────────────────────────────────────────────────────────────────
    (function hookRootBeer() {
        if (!Java.available) return;
        Java.perform(function () {
            var rootBeerClasses = [
                'com.scottyab.rootbeer.RootBeer',
                'com.scottyab.rootbeer.util.QLog'
            ];
            var methodsToFalse = [
                'isRooted', 'isRootedWithoutBusyBoxCheck', 'detectRootManagementApps',
                'detectPotentiallyDangerousApps', 'checkForBusyBoxBinary',
                'checkForSuBinary', 'checkSuExists', 'checkForRWPaths',
                'checkDangerousProps', 'checkRootAccessGivenToOtherApps',
                'detectTestKeys', 'checkForMagiskBinary', 'detectNativeSupport'
            ];
            rootBeerClasses.forEach(function (cls) {
                try {
                    var c = Java.use(cls);
                    methodsToFalse.forEach(function (m) {
                        if (c[m]) {
                            try {
                                c[m].implementation = function () { return false; };
                            } catch (_) {}
                        }
                    });
                } catch (_) {}
            });
            _log.ok('root: RootBeer hooks applied');
        });
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 4. Build properties
    // ─────────────────────────────────────────────────────────────────────────
    (function hookBuildProps() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var Build = Java.use('android.os.Build');
                Build.TAGS.value = 'release-keys';
                _log.ok('root: Build.TAGS set to release-keys');
            } catch (e) { _log.debug('root: Build.TAGS hook failed — ' + e); }

            try {
                var SystemProperties = Java.use('android.os.SystemProperties');
                SystemProperties.get.overload('java.lang.String').implementation = function (key) {
                    if (key === 'ro.build.tags')  return 'release-keys';
                    if (key === 'ro.debuggable')  return '0';
                    if (key === 'ro.secure')      return '1';
                    return this.get(key);
                };
                SystemProperties.get.overload('java.lang.String', 'java.lang.String').implementation = function (key, def) {
                    if (key === 'ro.build.tags')  return 'release-keys';
                    if (key === 'ro.debuggable')  return '0';
                    if (key === 'ro.secure')      return '1';
                    return this.get(key, def);
                };
                _log.ok('root: SystemProperties spoofing active');
            } catch (e) { _log.debug('root: SystemProperties hook failed — ' + e); }
        });
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 5. Package manager — hide root management apps
    // ─────────────────────────────────────────────────────────────────────────
    (function hookPackageManager() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var PM = Java.use('android.app.ApplicationPackageManager');

                PM.getInstalledPackages.overload('int').implementation = function (flags) {
                    var list     = this.getInstalledPackages(flags);
                    var filtered = Java.use('java.util.ArrayList').$new();
                    for (var i = 0; i < list.size(); i++) {
                        var pkg = list.get(i).packageName.value;
                        if (SU_MGMT_PACKAGES.indexOf(pkg) === -1) filtered.add(list.get(i));
                    }
                    return filtered;
                };

                PM.getPackageInfo.overload('java.lang.String', 'int').implementation = function (pkg, flags) {
                    if (SU_MGMT_PACKAGES.indexOf(pkg) !== -1) {
                        var NameNotFound = Java.use('android.content.pm.PackageManager$NameNotFoundException');
                        throw NameNotFound.$new(pkg);
                    }
                    return this.getPackageInfo(pkg, flags);
                };

                _log.ok('root: PackageManager hiding root apps active');
            } catch (e) { _log.debug('root: PackageManager hook failed — ' + e); }
        });
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 6. Native: access() / stat() — ENOENT for root paths
    // ─────────────────────────────────────────────────────────────────────────
    (function hookNativeAccess() {
        try {
            var ENOENT     = 2;
            var accessPtr  = Module.findExportByName(null, 'access');
            var statPtr    = Module.findExportByName(null, '__xstat64') ||
                             Module.findExportByName(null, 'stat');
            var lstatPtr   = Module.findExportByName(null, '__lxstat64') ||
                             Module.findExportByName(null, 'lstat');

            function isRootPath(p) {
                if (!p) return false;
                for (var i = 0; i < ROOT_PATHS.length; i++) {
                    if (p === ROOT_PATHS[i] || p.indexOf('magisk') !== -1) return true;
                }
                return false;
            }

            if (accessPtr) {
                Interceptor.attach(accessPtr, {
                    onEnter: function (args) {
                        this._path = safeReadStr(args[0]);
                        this._block = isRootPath(this._path);
                    },
                    onLeave: function (retval) {
                        if (this._block) retval.replace(ptr(-ENOENT));
                    }
                });
            }

            [statPtr, lstatPtr].forEach(function (ptr_) {
                if (!ptr_) return;
                Interceptor.attach(ptr_, {
                    onEnter: function (args) {
                        // __xstat64(ver, path, stat_buf)
                        var pathArg = (args[0].toInt32() < 100) ? args[1] : args[0];
                        this._path  = safeReadStr(pathArg);
                        this._block = isRootPath(this._path);
                    },
                    onLeave: function (retval) {
                        if (this._block) retval.replace(ptr(-ENOENT));
                    }
                });
            });

            _log.ok('root: native access()/stat() root path hiding active');
        } catch (e) { _log.debug('root: native stat/access hook failed — ' + e); }
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 7. __system_property_get — native property spoofing
    // ─────────────────────────────────────────────────────────────────────────
    (function hookNativeProps() {
        try {
            var propGet = Module.findExportByName('libc.so', '__system_property_get') ||
                          Module.findExportByName(null, '__system_property_get');
            if (!propGet) return;
            Interceptor.attach(propGet, {
                onEnter: function (args) {
                    this._key = safeReadStr(args[0]);
                    this._val = args[1];
                },
                onLeave: function () {
                    var overrides = {
                        'ro.build.tags': 'release-keys',
                        'ro.debuggable': '0',
                        'ro.secure':     '1'
                    };
                    if (overrides[this._key] !== undefined) {
                        this._val.writeUtf8String(overrides[this._key]);
                    }
                }
            });
            _log.ok('root: __system_property_get spoofing active');
        } catch (e) { _log.debug('root: __system_property_get hook failed — ' + e); }
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 8. BufferedReader.readLine — filter build.prop su entries
    // ─────────────────────────────────────────────────────────────────────────
    (function hookBufferedReader() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var BR = Java.use('java.io.BufferedReader');
                BR.readLine.overload().implementation = function () {
                    var line = this.readLine();
                    if (line !== null &&
                       (line.indexOf('ro.debuggable=1') !== -1 ||
                        line.indexOf('ro.build.tags=test-keys') !== -1 ||
                        line.indexOf('service.adb.root=1') !== -1)) {
                        return null;
                    }
                    return line;
                };
                _log.ok('root: BufferedReader.readLine() filter active');
            } catch (e) { _log.debug('root: BufferedReader hook failed — ' + e); }
        });
    })();

    _log.ok('01_root_bypass.js — root detection bypass installed');
})();
