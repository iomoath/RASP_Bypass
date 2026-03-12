/**
 * lib/stealth-frida-hiding.js — Frida OS-Level Hiding
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Frida invisibility layer. Must be the FIRST module loaded.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: RASP_auditor module 03 + meta-apps-ssl-pinning/setup_anti_frida_bypass.js
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('stealthFrida', 'Frida OS-Level Hiding');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.stealthFrida === false) return;

    var FRIDA_STRINGS = [
        'frida', 'gum-js-loop', 'gmain', 'gdbus',
        'frida-agent', 'frida-gadget', 'frida-server',
        'linjector', 're.frida', '/tmp/frida-',
        'frida-helper', 'frida-node'
    ];

    var FRIDA_PORTS = [27042, 27043];

    // 1. /proc/self/maps — openat + read filtering
    (function hookMapsFiltering() {
        try {
            var openatPtr = Module.findExportByName(null, 'openat');
            if (!openatPtr) return;
            var _openFdMap = {};

            Interceptor.attach(openatPtr, {
                onEnter: function (args) {
                    var path = safeReadStr(args[1]);
                    this._isMaps = (path.indexOf('/proc/self/maps') !== -1 ||
                                    (path.indexOf('/proc/') !== -1 && path.indexOf('/maps') !== -1));
                },
                onLeave: function (retval) {
                    if (this._isMaps && retval.toInt32() > 0) {
                        _openFdMap[retval.toInt32()] = true;
                    }
                }
            });

            var readPtr = Module.findExportByName(null, 'read');
            if (!readPtr) return;

            Interceptor.attach(readPtr, {
                onEnter: function (args) {
                    this._fd  = args[0].toInt32();
                    this._buf = args[1];
                    this._len = args[2].toInt32();
                },
                onLeave: function (retval) {
                    var n = retval.toInt32();
                    if (n <= 0 || !_openFdMap[this._fd]) return;
                    try {
                        var content  = this._buf.readUtf8String(n);
                        var lines    = content.split('\n');
                        var filtered = lines.filter(function (l) {
                            for (var i = 0; i < FRIDA_STRINGS.length; i++) {
                                if (l.indexOf(FRIDA_STRINGS[i]) !== -1) return false;
                            }
                            return true;
                        });
                        if (filtered.length !== lines.length) {
                            var newContent = filtered.join('\n');
                            this._buf.writeUtf8String(newContent);
                            retval.replace(ptr(newContent.length));
                        }
                    } catch (_) {}
                }
            });
            _log.ok('stealthFrida: /proc/self/maps filtering active');
        } catch (e) { _log.debug('stealthFrida: maps hook failed — ' + e); }
    })();

    // 2. pthread/prctl — suppress Frida thread names
    (function hookThreadNames() {
        try {
            var prctl = Module.findExportByName(null, 'prctl');
            if (!prctl) return;
            var PR_SET_NAME = 15;
            Interceptor.attach(prctl, {
                onEnter: function (args) {
                    if (args[0].toInt32() !== PR_SET_NAME) return;
                    var name = safeReadStr(args[1]);
                    for (var i = 0; i < FRIDA_STRINGS.length; i++) {
                        if (name.indexOf(FRIDA_STRINGS[i]) !== -1) {
                            args[1].writeUtf8String('kworker/' + Math.floor(Math.random() * 99));
                            break;
                        }
                    }
                }
            });
            _log.ok('stealthFrida: thread name masking active');
        } catch (e) { _log.debug('stealthFrida: prctl hook failed — ' + e); }
    })();

    // 3. connect() — block port 27042 probes
    (function hookConnectPort() {
        try {
            var connectPtr = Module.findExportByName(null, 'connect');
            if (!connectPtr) return;
            var ECONNREFUSED = 111;
            Interceptor.attach(connectPtr, {
                onEnter: function (args) {
                    try {
                        var sa   = args[1];
                        var port = (sa.add(2).readU8() << 8) | sa.add(3).readU8();
                        if (FRIDA_PORTS.indexOf(port) !== -1) this._block = true;
                    } catch (_) {}
                },
                onLeave: function (retval) {
                    if (this._block) retval.replace(ptr(-ECONNREFUSED));
                }
            });
            _log.ok('stealthFrida: port 27042/27043 connect() block active');
        } catch (e) { _log.debug('stealthFrida: connect hook failed — ' + e); }
    })();

    // 4. recvfrom() — D-Bus AUTH response filtering
    (function hookRecvFrom() {
        try {
            var recvPtr = Module.findExportByName(null, 'recvfrom');
            if (!recvPtr) return;
            Interceptor.attach(recvPtr, {
                onLeave: function (retval) {
                    var n = retval.toInt32();
                    if (n < 4) return;
                    try {
                        var buf = this.context.x1 || this.context.rsi;
                        if (!buf) return;
                        var s = buf.readUtf8String(Math.min(n, 64));
                        if (s && (s.indexOf('AUTH') !== -1 || s.indexOf('DBUS') !== -1 ||
                                  s.indexOf('frida') !== -1)) {
                            buf.writeUtf8String('\x00');
                            retval.replace(ptr(0));
                        }
                    } catch (_) {}
                }
            });
            _log.ok('stealthFrida: D-Bus recvfrom filtering active');
        } catch (e) { _log.debug('stealthFrida: recvfrom hook failed — ' + e); }
    })();

    // 5. access() — hide Frida files
    (function hookAccess() {
        try {
            var accessPtr = Module.findExportByName(null, 'access');
            if (!accessPtr) return;
            var ENOENT = -2;
            Interceptor.attach(accessPtr, {
                onEnter: function (args) {
                    var path = safeReadStr(args[0]);
                    for (var i = 0; i < FRIDA_STRINGS.length; i++) {
                        if (path.indexOf(FRIDA_STRINGS[i]) !== -1) { this._block = true; break; }
                    }
                },
                onLeave: function (retval) {
                    if (this._block) retval.replace(ptr(ENOENT));
                }
            });
            _log.ok('stealthFrida: access() Frida file hiding active');
        } catch (e) { _log.debug('stealthFrida: access hook failed — ' + e); }
    })();

    // 6. dlopen() — filter Frida .so modules
    (function hookDlopen() {
        try {
            var dlopenPtr = Module.findExportByName(null, 'dlopen');
            if (!dlopenPtr) return;
            Interceptor.attach(dlopenPtr, {
                onEnter: function (args) {
                    var path = safeReadStr(args[0]);
                    for (var i = 0; i < FRIDA_STRINGS.length; i++) {
                        if (path.indexOf(FRIDA_STRINGS[i]) !== -1) {
                            args[0].writeUtf8String('/dev/null');
                            break;
                        }
                    }
                }
            });
            _log.ok('stealthFrida: dlopen() Frida .so filter active');
        } catch (e) { _log.debug('stealthFrida: dlopen hook failed — ' + e); }
    })();

    // 7. inotify_add_watch — block watches on /proc/self/maps
    (function hookInotify() {
        try {
            var inotifyPtr = Module.findExportByName(null, 'inotify_add_watch');
            if (!inotifyPtr) return;
            Interceptor.attach(inotifyPtr, {
                onEnter: function (args) {
                    var path = safeReadStr(args[1]);
                    if (path.indexOf('/proc/self/maps') !== -1 ||
                        path.indexOf('/proc/self/mem')  !== -1) {
                        args[1].writeUtf8String('/dev/null');
                    }
                }
            });
            _log.ok('stealthFrida: inotify_add_watch filtering active');
        } catch (e) { _log.debug('stealthFrida: inotify hook failed — ' + e); }
    })();

    // 8. Java-layer: File.exists() — hide Frida paths
    (function hookJavaFileExists() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var File = Java.use('java.io.File');
                File.exists.implementation = function () {
                    var path = this.getAbsolutePath();
                    for (var i = 0; i < FRIDA_STRINGS.length; i++) {
                        if (path.indexOf(FRIDA_STRINGS[i]) !== -1) return false;
                    }
                    return this.exists.call(this);
                };
                _log.ok('stealthFrida: Java File.exists() Frida path filter active');
            } catch (e) { _log.debug('stealthFrida: Java File.exists hook failed — ' + e); }
        });
    })();

    // 9. ActivityManager.getRunningAppProcesses() — clear Frida processes
    (function hookRunningProcesses() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var AM = Java.use('android.app.ActivityManager');
                AM.getRunningAppProcesses.implementation = function () {
                    var list = this.getRunningAppProcesses();
                    if (!list) return list;
                    var filtered = Java.use('java.util.ArrayList').$new();
                    for (var i = 0; i < list.size(); i++) {
                        var proc = list.get(i);
                        var name = proc.processName ? proc.processName.value : '';
                        var isHidden = false;
                        for (var j = 0; j < FRIDA_STRINGS.length; j++) {
                            if (name.indexOf(FRIDA_STRINGS[j]) !== -1) { isHidden = true; break; }
                        }
                        if (!isHidden) filtered.add(proc);
                    }
                    return filtered;
                };
                _log.ok('stealthFrida: ActivityManager process list filtering active');
            } catch (e) { _log.debug('stealthFrida: ActivityManager hook failed — ' + e); }
        });
    })();

    _log.ok('stealth-frida-hiding.js loaded');
})();
