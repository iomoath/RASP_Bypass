/**
 * lib/syscall-bypass.js — ARM64 Syscall-Level Bypass
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Intercepts syscalls at the libc level to filter /proc/self/maps
 * and /proc/self/status content, defeating kernel-level Frida detection.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: iomoath/meta-apps-ssl-pinning/syscall10.js
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('syscall', 'ARM64 Syscall-Level Bypass');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.syscall === false) return;

    var _hookCount = 0;
    var _failCount = 0;

    if (Process.arch !== 'arm64') {
        _log.info('syscall-bypass: skipped — ARM64 only (current arch: ' + Process.arch + ')');
        if (!_STANDALONE && typeof BYPASS_BUS !== 'undefined') {
            BYPASS_BUS.emit && BYPASS_BUS.emit('syscall', { ok: false, reason: 'unsupported-arch' });
        }
        console.log('[*] syscall-bypass: 0 hooks installed, 0 failed');
        return;
    }

    // ARM64 syscall numbers
    var SYS_openat = 56;
    var SYS_read   = 63;
    var SYS_close  = 57;

    var FRIDA_STRINGS = [
        'frida', 'gum-js-loop', 'gmain', 'gdbus',
        'frida-agent', 'frida-gadget', 'frida-server',
        'linjector', 're.frida', '/tmp/frida-'
    ];

    // Track sensitive FDs
    var _mapsFds   = {};  // fd → 'maps'
    var _statusFds = {}; // fd → 'status'

    // 1. Hook openat via libc to track FDs for /proc/self/maps and /proc/self/status
    (function hookOpenat() {
        try {
            var openatPtr = Module.findExportByName('libc.so', 'openat') ||
                            Module.findExportByName(null, 'openat');
            if (!openatPtr) return;

            Interceptor.attach(openatPtr, {
                onEnter: function (args) {
                    var path = safeReadStr(args[1]);
                    this._isMaps   = (path.indexOf('/proc/self/maps') !== -1 ||
                                     (path.indexOf('/proc/') !== -1 && path.indexOf('/maps') !== -1));
                    this._isStatus = (path.indexOf('/proc/self/status') !== -1 ||
                                     (path.indexOf('/proc/') !== -1 && path.indexOf('/status') !== -1));
                },
                onLeave: function (retval) {
                    var fd = retval.toInt32();
                    if (fd <= 0) return;
                    if (this._isMaps)   _mapsFds[fd]   = true;
                    if (this._isStatus) _statusFds[fd] = true;
                }
            });
            _hookCount++;
            _log.ok('syscall: openat() FD tracking active');
        } catch (e) { _failCount++; _log.debug('syscall: openat hook — ' + e); }
    })();

    // 2. Hook read() to filter content of tracked FDs
    (function hookRead() {
        try {
            var readPtr = Module.findExportByName('libc.so', 'read') ||
                          Module.findExportByName(null, 'read');
            if (!readPtr) return;

            Interceptor.attach(readPtr, {
                onEnter: function (args) {
                    this._fd  = args[0].toInt32();
                    this._buf = args[1];
                    this._sz  = args[2].toInt32();
                },
                onLeave: function (retval) {
                    var n = retval.toInt32();
                    if (n <= 0) return;

                    if (_mapsFds[this._fd]) {
                        // Filter Frida-related lines from maps
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
                                _log.debug('syscall: filtered ' + (lines.length - filtered.length) + ' Frida lines from maps');
                            }
                        } catch (_) {}
                    }

                    if (_statusFds[this._fd]) {
                        // Filter TracerPid from status
                        try {
                            var s     = this._buf.readUtf8String(n);
                            var clean = s.replace(/TracerPid:\s*\d+/g, 'TracerPid:\t0');
                            if (clean !== s) {
                                this._buf.writeUtf8String(clean);
                                retval.replace(ptr(clean.length));
                                _log.debug('syscall: filtered TracerPid from status');
                            }
                        } catch (_) {}
                    }
                }
            });
            _hookCount++;
            _log.ok('syscall: read() content filtering active');
        } catch (e) { _failCount++; _log.debug('syscall: read hook — ' + e); }
    })();

    // 3. Hook close() to clean up tracked FDs
    (function hookClose() {
        try {
            var closePtr = Module.findExportByName('libc.so', 'close') ||
                           Module.findExportByName(null, 'close');
            if (!closePtr) return;
            Interceptor.attach(closePtr, {
                onEnter: function (args) {
                    var fd = args[0].toInt32();
                    delete _mapsFds[fd];
                    delete _statusFds[fd];
                }
            });
            _hookCount++;
        } catch (e) { _failCount++; _log.debug('syscall: close hook — ' + e); }
    })();

    console.log('[*] syscall-bypass: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('syscall-bypass.js loaded');
})();
