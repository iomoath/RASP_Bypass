/**
 * lib/anti-frida-bypass.js — Syscall-Level Frida Hiding
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Complementary to stealth-frida-hiding.js at SVC#0/raw syscall level.
 * Intercepts openat, read, readlinkat to rewrite proc filesystem content.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: iomoath/meta-apps-ssl-pinning/setup_anti_frida_bypass.js
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('antiFrida', 'Syscall-Level Frida Hiding');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.antiFrida === false) return;

    var _hookCount = 0;
    var _failCount = 0;

    if (Process.arch !== 'arm64') {
        _log.info('anti-frida-bypass: skipped — ARM64 only (current arch: ' + Process.arch + ')');
        if (!_STANDALONE && typeof BYPASS_BUS !== 'undefined') {
            BYPASS_BUS.emit && BYPASS_BUS.emit('antiFrida', { ok: false, reason: 'unsupported-arch' });
        }
        console.log('[*] anti-frida-bypass: 0 hooks installed, 0 failed');
        return;
    }

    var FRIDA_MARKERS = [
        'frida', 'gum-js-loop', 'gmain', 'gdbus',
        'frida-agent', 'frida-gadget', 'frida-server',
        'linjector', 're.frida', '/tmp/frida-',
        'frida-helper', 'frida-node', 'gum-event-sink'
    ];

    // FD tracking maps
    var _mapsFds    = {};
    var _statusFds  = {};
    var _cmdlineFds = {};
    var _taskFds    = {};

    function isFridaLine(line) {
        for (var i = 0; i < FRIDA_MARKERS.length; i++) {
            if (line.indexOf(FRIDA_MARKERS[i]) !== -1) return true;
        }
        return false;
    }

    // 1. openat — track all sensitive /proc FDs
    (function hookOpenat() {
        try {
            var openatPtr = Module.findExportByName(null, 'openat');
            if (!openatPtr) return;

            Interceptor.attach(openatPtr, {
                onEnter: function (args) {
                    var path = safeReadStr(args[1]);
                    this._isMaps    = (path.indexOf('/proc/self/maps') !== -1 ||
                                      (path.indexOf('/proc/') !== -1 && path.indexOf('/maps') !== -1));
                    this._isStatus  = (path.indexOf('/proc/self/status') !== -1 ||
                                      (path.indexOf('/task/') !== -1 && path.indexOf('/status') !== -1));
                    this._isCmdline = (path.indexOf('/cmdline') !== -1);
                    this._isTask    = (path.indexOf('/proc/self/task') !== -1);
                },
                onLeave: function (retval) {
                    var fd = retval.toInt32();
                    if (fd <= 0) return;
                    if (this._isMaps)    _mapsFds[fd]    = true;
                    if (this._isStatus)  _statusFds[fd]  = true;
                    if (this._isCmdline) _cmdlineFds[fd] = true;
                    if (this._isTask)    _taskFds[fd]    = true;
                }
            });
            _hookCount++;
            _log.ok('antiFrida: openat() FD tracking active');
        } catch (e) { _failCount++; _log.debug('antiFrida: openat hook — ' + e); }
    })();

    // 2. read — filter content of all tracked FDs
    (function hookRead() {
        try {
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
                    if (n <= 0) return;

                    if (_mapsFds[this._fd]) {
                        try {
                            var content  = this._buf.readUtf8String(n);
                            var lines    = content.split('\n');
                            var filtered = lines.filter(function (l) { return !isFridaLine(l); });
                            if (filtered.length !== lines.length) {
                                var out = filtered.join('\n');
                                this._buf.writeUtf8String(out);
                                retval.replace(ptr(out.length));
                            }
                        } catch (_) {}
                    }

                    if (_statusFds[this._fd]) {
                        try {
                            var s     = this._buf.readUtf8String(n);
                            var clean = s.replace(/TracerPid:\s*\d+/g, 'TracerPid:\t0');
                            if (clean !== s) {
                                this._buf.writeUtf8String(clean);
                                retval.replace(ptr(clean.length));
                            }
                        } catch (_) {}
                    }

                    if (_cmdlineFds[this._fd]) {
                        try {
                            var cmdContent = this._buf.readUtf8String(n);
                            if (isFridaLine(cmdContent)) {
                                this._buf.writeUtf8String('zygote64');
                                retval.replace(ptr(9));
                            }
                        } catch (_) {}
                    }
                }
            });
            _hookCount++;
            _log.ok('antiFrida: read() content filtering active');
        } catch (e) { _failCount++; _log.debug('antiFrida: read hook — ' + e); }
    })();

    // 3. readlinkat — intercept /proc/self/exe and fd symlinks
    (function hookReadlinkat() {
        try {
            var readlinkatPtr = Module.findExportByName(null, 'readlinkat');
            if (!readlinkatPtr) return;

            Interceptor.attach(readlinkatPtr, {
                onEnter: function (args) {
                    var path = safeReadStr(args[1]);
                    this._path = path;
                    this._buf  = args[2];
                    this._bufsz = args[3] ? args[3].toInt32() : 0;
                },
                onLeave: function (retval) {
                    var n = retval.toInt32();
                    if (n <= 0 || !this._buf) return;
                    try {
                        var target = this._buf.readUtf8String(n);
                        if (isFridaLine(target)) {
                            var replacement = '/system/bin/app_process64';
                            this._buf.writeUtf8String(replacement);
                            retval.replace(ptr(replacement.length));
                        }
                    } catch (_) {}
                }
            });
            _hookCount++;
            _log.ok('antiFrida: readlinkat() Frida symlink masking active');
        } catch (e) { _failCount++; _log.debug('antiFrida: readlinkat hook — ' + e); }
    })();

    // 4. close — cleanup tracked FDs
    (function hookClose() {
        try {
            var closePtr = Module.findExportByName(null, 'close');
            if (!closePtr) return;
            Interceptor.attach(closePtr, {
                onEnter: function (args) {
                    var fd = args[0].toInt32();
                    delete _mapsFds[fd];
                    delete _statusFds[fd];
                    delete _cmdlineFds[fd];
                    delete _taskFds[fd];
                }
            });
            _hookCount++;
        } catch (e) { _failCount++; _log.debug('antiFrida: close hook — ' + e); }
    })();

    // 5. Thread name hiding via prctl
    (function hookPrctlThreadName() {
        try {
            var prctlPtr = Module.findExportByName(null, 'prctl');
            if (!prctlPtr) return;
            var PR_SET_NAME = 15;
            Interceptor.attach(prctlPtr, {
                onEnter: function (args) {
                    if (args[0].toInt32() !== PR_SET_NAME) return;
                    var name = safeReadStr(args[1]);
                    if (isFridaLine(name)) {
                        args[1].writeUtf8String('pool-' + Math.floor(Math.random() * 99));
                    }
                }
            });
            _hookCount++;
            _log.ok('antiFrida: prctl thread name masking active');
        } catch (e) { _failCount++; _log.debug('antiFrida: prctl hook — ' + e); }
    })();

    console.log('[*] anti-frida-bypass: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('anti-frida-bypass.js loaded');
})();
