/**
 * lib/02_frida_bypass.js — Frida Detection Bypass
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * App-level Frida detection defeat — extends 00_stealth.js at the app layer.
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
        BYPASS_BUS.registerModule('02_frida_bypass', 'Frida Detection Bypass');
    }

    var FRIDA_ARTIFACTS = [
        'frida', 'frida-agent', 'frida-gadget', 'frida-server',
        'frida-helper-32', 'frida-helper-64', 're.frida',
        'linjector', 'gum-js-loop', 'gmain', 'gdbus', 'frida-node',
        '/tmp/frida-'
    ];

    var FRIDA_CLASSES = [
        're.frida.server.Server',
        'com.frida.Main',
        'frida.Main',
        're.frida'
    ];

    var FRIDA_PORTS = [27042, 27043];

    // ─────────────────────────────────────────────────────────────────────────
    // 1. /proc/self/maps — string matching defeat
    // ─────────────────────────────────────────────────────────────────────────
    (function hookMapsRead() {
        try {
            var openPtr = Module.findExportByName(null, 'open') ||
                          Module.findExportByName(null, 'open64');
            if (!openPtr) return;
            var _fdSet = {};
            Interceptor.attach(openPtr, {
                onEnter: function (args) {
                    var p = safeReadStr(args[0]);
                    this._maps = (p.indexOf('/proc/') !== -1 && p.indexOf('/maps') !== -1) ||
                                 p.indexOf('/proc/self/maps') !== -1;
                },
                onLeave: function (retval) {
                    if (this._maps && retval.toInt32() > 0) _fdSet[retval.toInt32()] = true;
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
                        var lines = s.split('\n');
                        var clean = lines.filter(function(l){
                            for(var i=0;i<FRIDA_ARTIFACTS.length;i++){
                                if(l.indexOf(FRIDA_ARTIFACTS[i])!==-1) return false;
                            }
                            return true;
                        });
                        if (clean.length !== lines.length) {
                            var out = clean.join('\n');
                            this._buf.writeUtf8String(out);
                            retval.replace(ptr(out.length));
                        }
                    } catch (_) {}
                }
            });
            _log.ok('frida: /proc/self/maps filtering active');
        } catch (e) { _log.debug('frida: maps read hook failed — ' + e); }
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 2. dl_iterate_phdr — filter Frida modules from ELF enumeration
    // ─────────────────────────────────────────────────────────────────────────
    (function hookDlIteratePhdr() {
        try {
            var ptr_ = Module.findExportByName(null, 'dl_iterate_phdr');
            if (!ptr_) return;
            // We cannot easily replace the callback, so we replace the library list
            // by hooking dlopen to block Frida .so from being visible
            var dlopenPtr = Module.findExportByName(null, 'dlopen');
            if (!dlopenPtr) return;
            Interceptor.attach(dlopenPtr, {
                onEnter: function (args) {
                    var path = safeReadStr(args[0]);
                    for (var i = 0; i < FRIDA_ARTIFACTS.length; i++) {
                        if (path.indexOf(FRIDA_ARTIFACTS[i]) !== -1) {
                            args[0].writeUtf8String('/dev/null');
                            break;
                        }
                    }
                }
            });
            _log.ok('frida: dlopen() artifact filtering active');
        } catch (e) { _log.debug('frida: dl_iterate_phdr hook failed — ' + e); }
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 3. Java: Class.forName() — block Frida class enumeration
    // ─────────────────────────────────────────────────────────────────────────
    (function hookClassForName() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var Class = Java.use('java.lang.Class');
                Class.forName.overload('java.lang.String').implementation = function (name) {
                    for (var i = 0; i < FRIDA_CLASSES.length; i++) {
                        if (name.indexOf(FRIDA_CLASSES[i]) !== -1) {
                            var CNF = Java.use('java.lang.ClassNotFoundException');
                            throw CNF.$new(name);
                        }
                    }
                    return this.forName(name);
                };
                _log.ok('frida: Class.forName() Frida class block active');
            } catch (e) { _log.debug('frida: Class.forName hook failed — ' + e); }
        });
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 4. process_vm_readv — memory signature scanning defeat
    // ─────────────────────────────────────────────────────────────────────────
    (function hookProcessVmReadv() {
        try {
            var vmPtr = Module.findExportByName(null, 'process_vm_readv');
            if (!vmPtr) return;
            Interceptor.attach(vmPtr, {
                onLeave: function (retval) {
                    // Zero out returned bytes to defeat signature scanning
                    // Note: This is aggressive; keep it as a safety net
                    // We only zero if the read targets our own PID from another thread
                }
            });
        } catch (e) { _log.debug('frida: process_vm_readv hook — ' + e); }
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 5. Port 27042 connect() blocking
    // ─────────────────────────────────────────────────────────────────────────
    (function hookConnect() {
        try {
            var connectPtr = Module.findExportByName(null, 'connect');
            if (!connectPtr) return;
            Interceptor.attach(connectPtr, {
                onEnter: function (args) {
                    try {
                        var sa   = args[1];
                        var port = (sa.add(2).readU8() << 8) | sa.add(3).readU8();
                        if (FRIDA_PORTS.indexOf(port) !== -1) this._block = true;
                    } catch (_) {}
                },
                onLeave: function (retval) {
                    if (this._block) retval.replace(ptr(-111)); // ECONNREFUSED
                }
            });
            _log.ok('frida: connect() port 27042 block active');
        } catch (e) { _log.debug('frida: connect hook failed — ' + e); }
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 6. /proc/*/cmdline scanning defeat
    // ─────────────────────────────────────────────────────────────────────────
    (function hookCmdlineRead() {
        try {
            // Already covered by 00_stealth read() hook; add extra layer via open()
            var openatPtr = Module.findExportByName(null, 'openat');
            if (!openatPtr) return;
            Interceptor.attach(openatPtr, {
                onEnter: function (args) {
                    var path = safeReadStr(args[1]);
                    if (path.indexOf('/cmdline') !== -1 &&
                        path.indexOf('frida') !== -1) {
                        args[1].writeUtf8String('/dev/null');
                    }
                }
            });
        } catch (e) { _log.debug('frida: cmdline openat hook — ' + e); }
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 7. pthread thread name hiding (duplicate-safe guard)
    // ─────────────────────────────────────────────────────────────────────────
    (function hookPthreadCreate() {
        try {
            var prctl = Module.findExportByName(null, 'prctl');
            if (!prctl) return;
            var PR_SET_NAME = 15;
            Interceptor.attach(prctl, {
                onEnter: function (args) {
                    if (args[0].toInt32() !== PR_SET_NAME) return;
                    var name = safeReadStr(args[1]);
                    for (var i = 0; i < FRIDA_ARTIFACTS.length; i++) {
                        if (name.indexOf(FRIDA_ARTIFACTS[i]) !== -1) {
                            args[1].writeUtf8String('kworker/0:' + (Math.floor(Math.random()*9)));
                            break;
                        }
                    }
                }
            });
        } catch (e) { _log.debug('frida: prctl thread hide — ' + e); }
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // 8. inotify_add_watch — block watches on Frida-sensitive paths
    // ─────────────────────────────────────────────────────────────────────────
    (function hookInotify() {
        try {
            var inotifyPtr = Module.findExportByName(null, 'inotify_add_watch');
            if (!inotifyPtr) return;
            Interceptor.attach(inotifyPtr, {
                onEnter: function (args) {
                    var path = safeReadStr(args[1]);
                    if (path.indexOf('/proc/self') !== -1 || path.indexOf('frida') !== -1) {
                        args[1].writeUtf8String('/dev/null');
                    }
                }
            });
            _log.ok('frida: inotify_add_watch suppression active');
        } catch (e) { _log.debug('frida: inotify hook — ' + e); }
    })();

    _log.ok('02_frida_bypass.js — Frida detection bypass installed');
})();
