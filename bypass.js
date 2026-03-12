/**
 * bypass.js — Unified Single-File RASP Bypass Loader
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Completely standalone — no require() calls needed.
 * Contains all 24 modules inline.
 *
 * Usage:
 *   frida -U -f com.target.app -l bypass.js --no-pause
 *
 * To customize, set BYPASS_CONFIG before any hooks run by prepending:
 *   // Edit configuration at the top of this file
 */

'use strict';

// ── BYPASS_CONFIG ─────────────────────────────────────────────────────────
var BYPASS_CONFIG = {
    proxy: { host: '127.0.0.1', port: 8080, type: 'HTTP' },
    CERT_PEM: '-----BEGIN CERTIFICATE-----\n[YOUR CA CERT HERE]\n-----END CERTIFICATE-----',
    modules: {
        stealthFrida  : true, stealthHook   : true, root          : true,
        frida         : true, debugger      : true, emulator      : true,
        vpn           : true, devMode       : true, accessibility : true,
        screenCapture : true, appCloning    : true, sslPinning    : true,
        sslFallback   : true, certInjection : true, nativeTls     : true,
        flutter       : 'auto', metaSsl     : 'auto', proxyOverride : true,
        nativeConnect : true, integrity     : true, attestation   : true,
        http3Disable  : true, syscall       : true, antiFrida     : true
    },
    silent: true, debug: false,
    originalSignature: null, originalInstaller: 'com.android.vending',
    BLOCK_HTTP3: true, PROXY_SUPPORTS_SOCKS5: false, IGNORED_NON_HTTP_PORTS: []
};

// Global compat exports
var CERT_PEM              = BYPASS_CONFIG.CERT_PEM;
var PROXY_HOST            = BYPASS_CONFIG.proxy.host;
var PROXY_PORT            = BYPASS_CONFIG.proxy.port;
var DEBUG_MODE            = BYPASS_CONFIG.debug;
var PROXY_SUPPORTS_SOCKS5 = BYPASS_CONFIG.PROXY_SUPPORTS_SOCKS5;
var IGNORED_NON_HTTP_PORTS = BYPASS_CONFIG.IGNORED_NON_HTTP_PORTS;

// Validate CERT_PEM is configured
if (BYPASS_CONFIG.CERT_PEM && (
    BYPASS_CONFIG.CERT_PEM.indexOf('[YOUR CA CERT HERE]') !== -1 ||
    BYPASS_CONFIG.CERT_PEM.indexOf('[YOUR CA CERTIFICATE') !== -1 ||
    BYPASS_CONFIG.CERT_PEM.indexOf('PUT YOUR') !== -1 ||
    BYPASS_CONFIG.CERT_PEM.trim() === '' ||
    BYPASS_CONFIG.CERT_PEM.trim() === '-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----'
)) {
    console.log('\n\x1b[31m[!!!] WARNING: CERT_PEM is not configured!\x1b[0m');
    console.log('[!!!] SSL pinning bypass modules will NOT work without a valid CA certificate.');
    console.log('[!!!] Set BYPASS_CONFIG.CERT_PEM in bypass.js to your proxy CA certificate (PEM format).\n');
}

// ── BYPASS_BUS ────────────────────────────────────────────────────────────
var BYPASS_BUS = (function () {
    var _modules = {};
    var _enabled = {};
    var _log = {
        ok   : function (m) { if (!BYPASS_CONFIG.silent) console.log('\x1b[32m[+]\x1b[0m ' + m); },
        hit  : function (m) { if (!BYPASS_CONFIG.silent) console.log('\x1b[33m[*]\x1b[0m ' + m); },
        fail : function (m) { if (!BYPASS_CONFIG.silent) console.log('\x1b[31m[-]\x1b[0m ' + m); },
        info : function (m) { if (!BYPASS_CONFIG.silent) console.log('\x1b[36m[i]\x1b[0m ' + m); },
        debug: function (m) { if (!BYPASS_CONFIG.silent && BYPASS_CONFIG.debug) console.log('\x1b[90m[D]\x1b[0m ' + m); }
    };
    Object.keys(BYPASS_CONFIG.modules).forEach(function (k) { _enabled[k] = BYPASS_CONFIG.modules[k]; });
    return {
        enabled: _enabled, log: _log,
        registerModule: function (id, name) {
            _modules[id] = { name: name, loaded: true, ts: Date.now() };
            _log.ok('[' + id + '] ' + name);
        },
        status: function () {
            console.log('\x1b[36m══ RASP Bypass Status ══\x1b[0m');
            Object.keys(_modules).forEach(function (id) { console.log('  \x1b[32m✓\x1b[0m ' + _modules[id].name); });
            console.log('  Total: ' + Object.keys(_modules).length + ' modules\n');
        }
    };
})();

// Auto-detect Flutter
if (BYPASS_CONFIG.modules.flutter === 'auto') {
    BYPASS_CONFIG.modules.flutter = !!Process.findModuleByName('libflutter.so');
    BYPASS_BUS.enabled.flutter    = BYPASS_CONFIG.modules.flutter;
}

// ─────────────────────────────────────────────────────────────────────────
// Inlined modules (in load order)
// ─────────────────────────────────────────────────────────────────────────

// ═══ lib/utils.js ═══
/**
 * lib/utils.js — Shared Utilities
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Provides BYPASS_UTILS global with safe hooks, helpers, and logging.
 * Loaded first by config.js; also works standalone.
 */

(function () {
    'use strict';

    // ── Config resolution ────────────────────────────────────────────────────
    var _cfg = (typeof BYPASS_CONFIG !== 'undefined') ? BYPASS_CONFIG : {
        silent: true,
        debug: false
    };

    // ── ANSI colours ─────────────────────────────────────────────────────────
    var C = {
        reset : '\x1b[0m',
        green : '\x1b[32m',
        yellow: '\x1b[33m',
        red   : '\x1b[31m',
        cyan  : '\x1b[36m',
        grey  : '\x1b[90m'
    };

    // ── Rate-limit store ─────────────────────────────────────────────────────
    var _rlCounters = {};

    /**
     * rateLimit — call fn on first `threshold` invocations, then every `threshold`-th.
     * @param {string} key
     * @param {Function} fn
     * @param {number} threshold
     */
    function rateLimit(key, fn, threshold) {
        _rlCounters[key] = (_rlCounters[key] || 0) + 1;
        if (_rlCounters[key] <= (threshold || 10) ||
            _rlCounters[key] % (threshold || 10) === 0) {
            fn();
        }
    }

    // ── Logging ──────────────────────────────────────────────────────────────
    var log = {
        ok: function (msg) {
            if (!_cfg.silent) console.log(C.green  + '[+] ' + C.reset + msg);
        },
        hit: function (msg) {
            if (!_cfg.silent) console.log(C.yellow + '[*] ' + C.reset + msg);
        },
        fail: function (msg) {
            if (!_cfg.silent) console.log(C.red    + '[-] ' + C.reset + msg);
        },
        info: function (msg) {
            if (!_cfg.silent) console.log(C.cyan   + '[i] ' + C.reset + msg);
        },
        debug: function (msg) {
            if (!_cfg.silent && _cfg.debug) console.log(C.grey + '[d] ' + C.reset + msg);
        }
    };

    // ── safeReadStr ──────────────────────────────────────────────────────────
    /**
     * Safely read a C string from a native pointer.
     * Falls back to readCString, then returns empty string on failure.
     * @param {NativePointer} ptr
     * @returns {string}
     */
    function safeReadStr(ptr) {
        if (!ptr || ptr.isNull()) return '';
        try { return ptr.readUtf8String() || ''; } catch (_) {}
        try { return ptr.readCString()    || ''; } catch (_) {}
        return '';
    }

    // ── findExport ───────────────────────────────────────────────────────────
    /**
     * Safe Module.findExportByName wrapper.
     * @param {string|null} moduleName  null = search all modules
     * @param {string}      symbolName
     * @returns {NativePointer|null}
     */
    function findExport(moduleName, symbolName) {
        try {
            return Module.findExportByName(moduleName, symbolName);
        } catch (e) {
            log.debug('findExport ' + symbolName + ': ' + e);
            return null;
        }
    }

    // ── findAppId ────────────────────────────────────────────────────────────
    /**
     * Extract application package name via ActivityThread.
     * @returns {string}
     */
    function findAppId() {
        var pkg = '';
        try {
            Java.perform(function () {
                try {
                    var ActivityThread = Java.use('android.app.ActivityThread');
                    var ctx = ActivityThread.currentApplication().getApplicationContext();
                    pkg = ctx.getPackageName();
                } catch (_) {}
            });
        } catch (_) {}
        return pkg;
    }

    // ── hookJava ─────────────────────────────────────────────────────────────
    /**
     * Safe Java method hook.
     * @param {string}   className
     * @param {string}   methodName
     * @param {object}   impl        — { onEnter, onLeave } or replacement function
     * @param {string[]} [overloadTypes]
     * @returns {boolean}
     */
    function hookJava(className, methodName, impl, overloadTypes) {
        try {
            Java.perform(function () {
                var cls = Java.use(className);
                var method = overloadTypes
                    ? cls[methodName].overload.apply(cls[methodName], overloadTypes)
                    : cls[methodName];

                if (typeof impl === 'function') {
                    method.implementation = impl;
                } else {
                    if (impl.onEnter || impl.onLeave) {
                        // Wrap as implementation capturing both entry and exit
                        var _orig = method.implementation;
                        method.implementation = function () {
                            var args = Array.prototype.slice.call(arguments);
                            if (impl.onEnter) impl.onEnter.apply(this, [args]);
                            var ret = this[methodName].apply(this, args);
                            if (impl.onLeave) impl.onLeave.apply(this, [ret]);
                            return ret;
                        };
                    }
                }
            });
            return true;
        } catch (e) {
            log.debug('hookJava ' + className + '.' + methodName + ': ' + e);
            return false;
        }
    }

    // ── hookNative ───────────────────────────────────────────────────────────
    /**
     * Safe native function hook via Interceptor.attach.
     * @param {string|null} moduleName
     * @param {string}      symbolName
     * @param {object}      callbacks  — { onEnter, onLeave }
     * @returns {InvocationListener|null}
     */
    function hookNative(moduleName, symbolName, callbacks) {
        try {
            var addr = findExport(moduleName, symbolName);
            if (!addr) { log.debug('hookNative: symbol not found — ' + symbolName); return null; }
            return Interceptor.attach(addr, callbacks);
        } catch (e) {
            log.debug('hookNative ' + symbolName + ': ' + e);
            return null;
        }
    }

    // ── replaceNative ────────────────────────────────────────────────────────
    /**
     * Safe native function replacement via Interceptor.replace.
     * @param {string|null} moduleName
     * @param {string}      symbolName
     * @param {string}      retType
     * @param {string[]}    argTypes
     * @param {Function}    impl
     * @returns {boolean}
     */
    function replaceNative(moduleName, symbolName, retType, argTypes, impl) {
        try {
            var addr = findExport(moduleName, symbolName);
            if (!addr) { log.debug('replaceNative: symbol not found — ' + symbolName); return false; }
            Interceptor.replace(addr, new NativeCallback(impl, retType, argTypes));
            return true;
        } catch (e) {
            log.debug('replaceNative ' + symbolName + ': ' + e);
            return false;
        }
    }

    // ── classExists ──────────────────────────────────────────────────────────
    /**
     * Check whether a Java class can be resolved.
     * @param {string} className
     * @returns {boolean}
     */
    function classExists(className) {
        var found = false;
        try {
            Java.perform(function () {
                try { Java.use(className); found = true; } catch (_) {}
            });
        } catch (_) {}
        return found;
    }

    // ── waitForModule ─────────────────────────────────────────────────────────
    /**
     * Promise-based wait for a native module to be loaded.
     * @param {string} moduleName
     * @param {number} [timeoutMs=10000]
     * @returns {Promise<Module>}
     */
    function waitForModule(moduleName, timeoutMs) {
        var timeout = timeoutMs || 10000;
        return new Promise(function (resolve, reject) {
            var deadline = Date.now() + timeout;
            function attempt() {
                var mod = Process.findModuleByName(moduleName);
                if (mod) { resolve(mod); return; }
                if (Date.now() >= deadline) { reject(new Error('Timeout waiting for ' + moduleName)); return; }
                setTimeout(attempt, 200);
            }
            attempt();
        });
    }

    // ── Export as global ─────────────────────────────────────────────────────
    var BYPASS_UTILS = {
        safeReadStr   : safeReadStr,
        findExport    : findExport,
        findAppId     : findAppId,
        hookJava      : hookJava,
        hookNative    : hookNative,
        replaceNative : replaceNative,
        classExists   : classExists,
        waitForModule : waitForModule,
        rateLimit     : rateLimit,
        log           : log
    };

    // Make available globally
    if (typeof global !== 'undefined') {
        global.BYPASS_UTILS = BYPASS_UTILS;
    } else {
        this.BYPASS_UTILS = BYPASS_UTILS;
    }

    // ── Global compat exports for httptoolkit-style standalone modules ────────
    // These are set only if not already defined by the caller (e.g. config.js)
    if (typeof CERT_PEM === 'undefined') {
        var CERT_PEM = (_cfg.CERT_PEM || null);
    }
    if (typeof PROXY_HOST === 'undefined') {
        var PROXY_HOST = (_cfg.proxy ? _cfg.proxy.host : '127.0.0.1');
    }
    if (typeof PROXY_PORT === 'undefined') {
        var PROXY_PORT = (_cfg.proxy ? _cfg.proxy.port : 8080);
    }
    if (typeof DEBUG_MODE === 'undefined') {
        var DEBUG_MODE = (_cfg.debug || false);
    }
    if (typeof PROXY_SUPPORTS_SOCKS5 === 'undefined') {
        var PROXY_SUPPORTS_SOCKS5 = (_cfg.PROXY_SUPPORTS_SOCKS5 || false);
    }
    if (typeof IGNORED_NON_HTTP_PORTS === 'undefined') {
        var IGNORED_NON_HTTP_PORTS = (_cfg.IGNORED_NON_HTTP_PORTS || []);
    }

    // Register with bus if present
    if (typeof BYPASS_BUS !== 'undefined') {
        BYPASS_BUS.utils = BYPASS_UTILS;
        BYPASS_BUS.log   = log;
    }

    log.ok('utils.js loaded');
})();

// ═══ lib/stealth-frida-hiding.js ═══
try {
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

    var _hookCount = 0;
    var _failCount = 0;

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
            _hookCount++;
            _log.ok('stealthFrida: /proc/self/maps filtering active');
        } catch (e) { _failCount++; _log.debug('stealthFrida: maps hook failed — ' + e); }
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
            _hookCount++;
            _log.ok('stealthFrida: thread name masking active');
        } catch (e) { _failCount++; _log.debug('stealthFrida: prctl hook failed — ' + e); }
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
            _hookCount++;
            _log.ok('stealthFrida: port 27042/27043 connect() block active');
        } catch (e) { _failCount++; _log.debug('stealthFrida: connect hook failed — ' + e); }
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
            _hookCount++;
            _log.ok('stealthFrida: D-Bus recvfrom filtering active');
        } catch (e) { _failCount++; _log.debug('stealthFrida: recvfrom hook failed — ' + e); }
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
            _hookCount++;
            _log.ok('stealthFrida: access() Frida file hiding active');
        } catch (e) { _failCount++; _log.debug('stealthFrida: access hook failed — ' + e); }
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
            _hookCount++;
            _log.ok('stealthFrida: dlopen() Frida .so filter active');
        } catch (e) { _failCount++; _log.debug('stealthFrida: dlopen hook failed — ' + e); }
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
            _hookCount++;
            _log.ok('stealthFrida: inotify_add_watch filtering active');
        } catch (e) { _failCount++; _log.debug('stealthFrida: inotify hook failed — ' + e); }
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
                _hookCount++;
                _log.ok('stealthFrida: Java File.exists() Frida path filter active');
            } catch (e) { _failCount++; _log.debug('stealthFrida: Java File.exists hook failed — ' + e); }
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
                _hookCount++;
                _log.ok('stealthFrida: ActivityManager process list filtering active');
            } catch (e) { _failCount++; _log.debug('stealthFrida: ActivityManager hook failed — ' + e); }
        });
    })();

    console.log('[*] stealth-frida-hiding: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('stealth-frida-hiding.js loaded');
})();
} catch (e) { console.log('[!!!] Module "stealth-frida-hiding" failed to load: ' + e.message); }

// ═══ lib/stealth-hook-detection.js ═══
try {
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
} catch (e) { console.log('[!!!] Module "stealth-hook-detection" failed to load: ' + e.message); }

// ═══ lib/root-detection-bypass.js ═══
try {
/**
 * lib/root-detection-bypass.js — Root / Magisk / KernelSU Detection Bypass
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Hides all root indicators at both Java and native layers.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: httptoolkit/android-disable-root-detection.js + RASP_auditor module 02
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('root', 'Root/Magisk/KernelSU Hiding');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.root === false) return;

    var _hookCount = 0;
    var _failCount = 0;

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
        'com.amphoras.hidemyroot', 'com.android.vending.billing.InAppBillingService.COIN',
        'com.kingroot.kinguser', 'com.kingo.root', 'com.smedialink.oneclickroot',
        'com.zhiqupk.root.global', 'com.alephzain.framaroot',
        'me.weishu.kernelsu'
    ];

    function isSuCmd(cmd) {
        if (!cmd) return false;
        return cmd === 'su' || /[\/\s]su(\s|$)/.test(cmd) ||
               cmd.indexOf(' su') !== -1 || cmd === 'which su';
    }

    function isRootPath(p) {
        if (!p) return false;
        for (var i = 0; i < ROOT_PATHS.length; i++) {
            if (p === ROOT_PATHS[i] || p.indexOf('magisk') !== -1) return true;
        }
        return false;
    }

    // 1. Java — File.exists() + File.canExecute()
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
                _hookCount++;
                _log.ok('root: Java File hooks active');
            } catch (e) { _failCount++; _log.debug('root: Java File hook failed — ' + e); }
        });
    })();

    // 2. Java — Runtime.exec() — block su commands
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
                _hookCount++;
                _log.ok('root: Runtime.exec() su blocking active');
            } catch (e) { _failCount++; _log.debug('root: Runtime.exec hook failed — ' + e); }
        });
    })();

    // 3. RootBeer library hooks
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
                        if (c[m]) { try { c[m].implementation = function () { return false; }; } catch (_) {} }
                    });
                } catch (_) {}
            });
            _hookCount++;
            _log.ok('root: RootBeer hooks applied');
        });
    })();

    // 4. Build properties
    (function hookBuildProps() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var Build = Java.use('android.os.Build');
                Build.TAGS.value = 'release-keys';
                _log.ok('root: Build.TAGS set to release-keys');
            } catch (e) { _failCount++; _log.debug('root: Build.TAGS hook failed — ' + e); }

            try {
                var SystemProperties = Java.use('android.os.SystemProperties');
                SystemProperties.get.overload('java.lang.String').implementation = function (key) {
                    if (key === 'ro.build.tags') return 'release-keys';
                    if (key === 'ro.debuggable')  return '0';
                    if (key === 'ro.secure')       return '1';
                    return this.get(key);
                };
                SystemProperties.get.overload('java.lang.String', 'java.lang.String').implementation = function (key, def) {
                    if (key === 'ro.build.tags') return 'release-keys';
                    if (key === 'ro.debuggable')  return '0';
                    if (key === 'ro.secure')       return '1';
                    return this.get(key, def);
                };
                _hookCount++;
                _log.ok('root: SystemProperties spoofing active');
            } catch (e) { _failCount++; _log.debug('root: SystemProperties hook failed — ' + e); }
        });
    })();

    // 5. Package manager — hide root management apps
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
                _hookCount++;
                _log.ok('root: PackageManager hiding root apps active');
            } catch (e) { _failCount++; _log.debug('root: PackageManager hook failed — ' + e); }
        });
    })();

    // 6. Native: access() / stat() — ENOENT for root paths
    (function hookNativeAccess() {
        try {
            var ENOENT    = 2;
            var accessPtr = Module.findExportByName(null, 'access');
            var statPtr   = Module.findExportByName(null, '__xstat64') ||
                            Module.findExportByName(null, 'stat');
            var lstatPtr  = Module.findExportByName(null, '__lxstat64') ||
                            Module.findExportByName(null, 'lstat');

            if (accessPtr) {
                Interceptor.attach(accessPtr, {
                    onEnter: function (args) {
                        this._path  = safeReadStr(args[0]);
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
                        var pathArg = (args[0].toInt32() < 100) ? args[1] : args[0];
                        this._path  = safeReadStr(pathArg);
                        this._block = isRootPath(this._path);
                    },
                    onLeave: function (retval) {
                        if (this._block) retval.replace(ptr(-ENOENT));
                    }
                });
            });
            _hookCount++;
            _log.ok('root: native access()/stat() root path hiding active');
        } catch (e) { _failCount++; _log.debug('root: native stat/access hook failed — ' + e); }
    })();

    // 7. __system_property_get — native property spoofing
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
                    var overrides = { 'ro.build.tags': 'release-keys', 'ro.debuggable': '0', 'ro.secure': '1' };
                    if (overrides[this._key] !== undefined) {
                        this._val.writeUtf8String(overrides[this._key]);
                    }
                }
            });
            _hookCount++;
            _log.ok('root: __system_property_get spoofing active');
        } catch (e) { _failCount++; _log.debug('root: __system_property_get hook failed — ' + e); }
    })();

    // 8. BufferedReader.readLine — filter build.prop su entries
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
                _hookCount++;
                _log.ok('root: BufferedReader.readLine() filter active');
            } catch (e) { _failCount++; _log.debug('root: BufferedReader hook failed — ' + e); }
        });
    })();

    console.log('[*] root-detection-bypass: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('root-detection-bypass.js loaded');
})();
} catch (e) { console.log('[!!!] Module "root-detection-bypass" failed to load: ' + e.message); }

// ═══ lib/frida-detection-bypass.js ═══
try {
/**
 * lib/frida-detection-bypass.js — App-Level Frida Detection Defeat
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * App-level Frida detection defeat — complements stealth-frida-hiding.js.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: RASP_auditor module 03
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('frida', 'App-Level Frida Detection Defeat');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.frida === false) return;

    var _hookCount = 0;
    var _failCount = 0;

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

    // 1. open()/read() — /proc/self/maps string matching defeat
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
                        var clean = lines.filter(function(l) {
                            for (var i = 0; i < FRIDA_ARTIFACTS.length; i++) {
                                if (l.indexOf(FRIDA_ARTIFACTS[i]) !== -1) return false;
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
            _hookCount++;
            _log.ok('frida: /proc/self/maps filtering active');
        } catch (e) { _failCount++; _log.debug('frida: maps read hook failed — ' + e); }
    })();

    // 2. dlopen() — filter Frida modules from ELF enumeration
    (function hookDlopen() {
        try {
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
            _hookCount++;
            _log.ok('frida: dlopen() artifact filtering active');
        } catch (e) { _failCount++; _log.debug('frida: dlopen hook failed — ' + e); }
    })();

    // 3. Java: Class.forName() — block Frida class enumeration
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
                _hookCount++;
                _log.ok('frida: Class.forName() Frida class block active');
            } catch (e) { _failCount++; _log.debug('frida: Class.forName hook failed — ' + e); }
        });
    })();

    // 4. connect() — Port 27042/27043 blocking
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
            _hookCount++;
            _log.ok('frida: connect() port 27042/27043 block active');
        } catch (e) { _failCount++; _log.debug('frida: connect hook failed — ' + e); }
    })();

    // 5. openat() — suppress /proc/*/cmdline frida scanning
    (function hookCmdlineRead() {
        try {
            var openatPtr = Module.findExportByName(null, 'openat');
            if (!openatPtr) return;
            Interceptor.attach(openatPtr, {
                onEnter: function (args) {
                    var path = safeReadStr(args[1]);
                    if (path.indexOf('/cmdline') !== -1 && path.indexOf('frida') !== -1) {
                        args[1].writeUtf8String('/dev/null');
                    }
                }
            });
        } catch (e) { _failCount++; _log.debug('frida: cmdline openat hook — ' + e); }
    })();

    // 6. inotify_add_watch — block watches on Frida-sensitive paths
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
            _hookCount++;
            _log.ok('frida: inotify_add_watch suppression active');
        } catch (e) { _failCount++; _log.debug('frida: inotify hook — ' + e); }
    })();

    console.log('[*] frida-detection-bypass: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('frida-detection-bypass.js loaded');
})();
} catch (e) { console.log('[!!!] Module "frida-detection-bypass" failed to load: ' + e.message); }

// ═══ lib/debugger-detection-bypass.js ═══
try {
/**
 * lib/debugger-detection-bypass.js — Debugger / ptrace Detection Bypass
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Neutralizes ptrace, TracerPid, JDWP, and Java debugger checks.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: RASP_auditor module 04
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('debugger', 'Debugger/ptrace Neutralization');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.debugger === false) return;

    var _hookCount = 0;
    var _failCount = 0;

    var PTRACE_TRACEME  = 0;
    var PR_SET_DUMPABLE = 4;

    // 1. ptrace() — return 0 for PTRACE_TRACEME
    (function hookPtrace() {
        try {
            var ptracePtr = Module.findExportByName(null, 'ptrace');
            if (!ptracePtr) return;
            Interceptor.attach(ptracePtr, {
                onEnter: function (args) { this._req = args[0].toInt32(); },
                onLeave: function (retval) {
                    if (this._req === PTRACE_TRACEME) retval.replace(ptr(0));
                }
            });
            _hookCount++;
            _log.ok('debugger: ptrace(PTRACE_TRACEME) → 0');
        } catch (e) { _failCount++; _log.debug('debugger: ptrace hook failed — ' + e); }
    })();

    // 2. /proc/self/status — filter TracerPid
    (function hookStatusRead() {
        try {
            var openatPtr = Module.findExportByName(null, 'openat');
            if (!openatPtr) return;
            var _fdSet = {};

            Interceptor.attach(openatPtr, {
                onEnter: function (args) {
                    var path = safeReadStr(args[1]);
                    this._status = (path.indexOf('/proc/self/status') !== -1 ||
                                   (path.indexOf('/proc/') !== -1 && path.indexOf('/status') !== -1));
                },
                onLeave: function (retval) {
                    if (this._status && retval.toInt32() > 0) _fdSet[retval.toInt32()] = true;
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
                        var clean = s.replace(/TracerPid:\s*\d+/g, 'TracerPid:\t0');
                        if (clean !== s) {
                            this._buf.writeUtf8String(clean);
                            retval.replace(ptr(clean.length));
                        }
                    } catch (_) {}
                }
            });
            _hookCount++;
            _log.ok('debugger: /proc/self/status TracerPid → 0');
        } catch (e) { _failCount++; _log.debug('debugger: status read hook failed — ' + e); }
    })();

    // 3. prctl(PR_SET_DUMPABLE) — force dumpable = 1
    (function hookPrctl() {
        try {
            var prctlPtr = Module.findExportByName(null, 'prctl');
            if (!prctlPtr) return;
            Interceptor.attach(prctlPtr, {
                onEnter: function (args) {
                    if (args[0].toInt32() === PR_SET_DUMPABLE) args[1] = ptr(1);
                }
            });
            _hookCount++;
            _log.ok('debugger: prctl PR_SET_DUMPABLE forced to 1');
        } catch (e) { _failCount++; _log.debug('debugger: prctl hook failed — ' + e); }
    })();

    // 4. signal / sigaction — suppress SIGTRAP-based anti-debug
    (function hookSignals() {
        try {
            var SIGTRAP = 5;
            var sigactionPtr = Module.findExportByName(null, 'sigaction');
            if (!sigactionPtr) return;
            Interceptor.attach(sigactionPtr, {
                onEnter: function (args) {
                    if (args[0].toInt32() === SIGTRAP) {
                        _log.debug('debugger: sigaction(SIGTRAP) intercepted');
                    }
                }
            });
            _hookCount++;
        } catch (e) { _failCount++; _log.debug('debugger: sigaction hook failed — ' + e); }
    })();

    // 5. Java: Debug.isDebuggerConnected() → false
    (function hookJavaDebug() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var Debug = Java.use('android.os.Debug');
                Debug.isDebuggerConnected.implementation = function () { return false; };
                _hookCount++;
                _log.ok('debugger: Debug.isDebuggerConnected() → false');
            } catch (e) { _failCount++; _log.debug('debugger: Debug hook failed — ' + e); }

            try {
                var AppInfo = Java.use('android.content.pm.ApplicationInfo');
                var FLAG_DEBUGGABLE = 2;
                AppInfo.flags.value = AppInfo.flags.value & ~FLAG_DEBUGGABLE;
            } catch (_) {}
        });
    })();

    // 6. VMDebug.isDebuggingEnabled() → false
    (function suppressJDWP() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var VMDebug = Java.use('dalvik.system.VMDebug');
                if (VMDebug.isDebuggingEnabled) {
                    VMDebug.isDebuggingEnabled.implementation = function () { return false; };
                    _hookCount++;
                    _log.ok('debugger: VMDebug.isDebuggingEnabled() → false');
                }
            } catch (e) { _failCount++; _log.debug('debugger: VMDebug hook — ' + e); }
        });
    })();

    // 7. getppid() — return PID 1 to defeat parent-process checks
    (function hookGetppid() {
        try {
            var getppidPtr = Module.findExportByName(null, 'getppid');
            if (!getppidPtr) return;
            Interceptor.attach(getppidPtr, {
                onLeave: function (retval) {
                    if (retval.toInt32() > 1) retval.replace(ptr(1));
                }
            });
            _hookCount++;
            _log.ok('debugger: getppid() → 1 (init)');
        } catch (e) { _failCount++; _log.debug('debugger: getppid hook — ' + e); }
    })();

    console.log('[*] debugger-detection-bypass: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('debugger-detection-bypass.js loaded');
})();
} catch (e) { console.log('[!!!] Module "debugger-detection-bypass" failed to load: ' + e.message); }

// ═══ lib/emulator-detection-bypass.js ═══
try {
/**
 * lib/emulator-detection-bypass.js — Emulator Detection Bypass
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Defeats emulator detection via Build.* spoofing, TelephonyManager,
 * file access blocking, and __system_property_get.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: RASP_auditor module 08
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('emulator', 'Emulator Detection Bypass');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.emulator === false) return;

    var _hookCount = 0;
    var _failCount = 0;

    var REAL_DEVICE = {
        HARDWARE   : 'qcom',
        PRODUCT    : 'redfin',
        MODEL      : 'Pixel 5',
        BRAND      : 'google',
        DEVICE     : 'redfin',
        BOARD      : 'redfin',
        FINGERPRINT: 'google/redfin/redfin:14/UP1A.231005.007/10754064:user/release-keys',
        MANUFACTURER: 'Google',
        BOOTLOADER : 'c2f2-0.4-10754064',
        RADIO      : 'g7250-00219-230616-B-10210219',
        TAGS       : 'release-keys',
        TYPE       : 'user'
    };

    var EMULATOR_INDICATORS = [
        '/dev/qemu_pipe', '/dev/qemu_trace', '/sys/qemu_trace',
        '/proc/tty/drivers',
        'goldfish', 'ranchu', 'sdk_gphone', 'vbox', 'genymotion',
        '/dev/socket/genyd', '/dev/socket/baseband_genyd'
    ];

    var EMULATOR_PROPS = {
        'ro.kernel.qemu'          : '0',
        'ro.hardware'             : 'qcom',
        'ro.product.device'       : 'redfin',
        'ro.product.model'        : 'Pixel 5',
        'ro.product.manufacturer' : 'Google',
        'ro.product.brand'        : 'google'
    };

    // 1. Build.* field spoofing
    (function hookBuildFields() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var Build = Java.use('android.os.Build');
                Object.keys(REAL_DEVICE).forEach(function (field) {
                    try { Build[field].value = REAL_DEVICE[field]; } catch (_) {}
                });
                _hookCount++;
                _log.ok('emulator: Build.* spoofed to real device values');
            } catch (e) { _failCount++; _log.debug('emulator: Build spoof — ' + e); }

            try {
                var BuildVersion = Java.use('android.os.Build$VERSION');
                BuildVersion.RELEASE.value    = '14';
                BuildVersion.SDK_INT.value    = 34;
                BuildVersion.CODENAME.value   = 'REL';
                BuildVersion.INCREMENTAL.value = '10754064';
                _hookCount++;
                _log.ok('emulator: Build.VERSION spoofed');
            } catch (e) { _failCount++; _log.debug('emulator: Build.VERSION — ' + e); }
        });
    })();

    // 2. TelephonyManager IMEI/IMSI spoofing
    (function hookTelephony() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var TM = Java.use('android.telephony.TelephonyManager');
                var FAKE_IMEI = '358240051111110';
                var FAKE_IMSI = '310260000000000';

                ['getDeviceId', 'getImei', 'getMeid'].forEach(function (m) {
                    try { TM[m].overload().implementation = function () { return FAKE_IMEI; }; } catch (_) {}
                    try { TM[m].overload('int').implementation = function () { return FAKE_IMEI; }; } catch (_) {}
                });

                try { TM.getSubscriberId.overload().implementation = function () { return FAKE_IMSI; }; } catch (_) {}
                try { TM.getNetworkOperatorName.implementation = function () { return 'Android'; }; } catch (_) {}
                try { TM.getSimOperatorName.implementation = function () { return 'Android'; }; } catch (_) {}
                try { TM.getPhoneType.overload().implementation = function () { return 1; }; } catch (_) {}
                try { TM.getSimState.overload().implementation = function () { return 5; }; } catch (_) {}

                _hookCount++;
                _log.ok('emulator: TelephonyManager spoofed');
            } catch (e) { _failCount++; _log.debug('emulator: TelephonyManager hook — ' + e); }
        });
    })();

    // 3. Native access() — block emulator file indicators
    (function hookEmulatorFiles() {
        try {
            var accessPtr = Module.findExportByName(null, 'access');
            if (!accessPtr) return;
            Interceptor.attach(accessPtr, {
                onEnter: function (args) {
                    var path = args[0] && !args[0].isNull() ? args[0].readCString() : '';
                    for (var i = 0; i < EMULATOR_INDICATORS.length; i++) {
                        if (path.indexOf(EMULATOR_INDICATORS[i]) !== -1) { this._block = true; break; }
                    }
                },
                onLeave: function (retval) {
                    if (this._block) retval.replace(ptr(-2)); // ENOENT
                }
            });
            _hookCount++;
            _log.ok('emulator: emulator file access() blocking active');
        } catch (e) { _failCount++; _log.debug('emulator: emulator access hook — ' + e); }
    })();

    // 4. __system_property_get — spoof emulator properties
    (function hookSystemPropertyGet() {
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
                    if (EMULATOR_PROPS[this._key] !== undefined) {
                        try { this._val.writeUtf8String(EMULATOR_PROPS[this._key]); } catch (_) {}
                    }
                }
            });
            _hookCount++;
            _log.ok('emulator: __system_property_get emulator property spoofing active');
        } catch (e) { _failCount++; _log.debug('emulator: __system_property_get hook — ' + e); }
    })();

    console.log('[*] emulator-detection-bypass: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('emulator-detection-bypass.js loaded');
})();
} catch (e) { console.log('[!!!] Module "emulator-detection-bypass" failed to load: ' + e.message); }

// ═══ lib/vpn-detection-bypass.js ═══
try {
/**
 * lib/vpn-detection-bypass.js — VPN Detection Bypass
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Hides VPN connections at both Java and native layers.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: RASP_auditor module 11
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('vpn', 'VPN Detection Bypass');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.vpn === false) return;

    var _hookCount = 0;
    var _failCount = 0;

    var VPN_IFACE_PREFIXES = ['tun', 'ppp', 'tap'];

    // 1. NetworkInterface.getNetworkInterfaces() — filter VPN interfaces
    (function hookNetworkInterface() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var NetworkInterface = Java.use('java.net.NetworkInterface');
                NetworkInterface.getNetworkInterfaces.implementation = function () {
                    var ifaces = this.getNetworkInterfaces();
                    if (!ifaces) return ifaces;
                    var ArrayList   = Java.use('java.util.ArrayList');
                    var Collections = Java.use('java.util.Collections');
                    var filtered    = ArrayList.$new();
                    while (ifaces.hasMoreElements()) {
                        var iface = ifaces.nextElement();
                        var name  = iface.getName();
                        var hide  = false;
                        for (var i = 0; i < VPN_IFACE_PREFIXES.length; i++) {
                            if (name.indexOf(VPN_IFACE_PREFIXES[i]) !== -1) { hide = true; break; }
                        }
                        if (!hide) filtered.add(iface);
                    }
                    return Collections.enumeration(filtered);
                };
                _hookCount++;
                _log.ok('vpn: NetworkInterface VPN filtering active');
            } catch (e) { _failCount++; _log.debug('vpn: NetworkInterface hook — ' + e); }
        });
    })();

    // 2. NetworkCapabilities.hasTransport(TRANSPORT_VPN) → false
    (function hookNetworkCapabilities() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var NetworkCapabilities = Java.use('android.net.NetworkCapabilities');
                var TRANSPORT_VPN = 4;
                NetworkCapabilities.hasTransport.implementation = function (transport) {
                    if (transport === TRANSPORT_VPN) return false;
                    return this.hasTransport(transport);
                };
                _hookCount++;
                _log.ok('vpn: NetworkCapabilities TRANSPORT_VPN hidden');
            } catch (e) { _failCount++; _log.debug('vpn: NetworkCapabilities hook — ' + e); }
        });
    })();

    // 3. ConnectivityManager — hide TYPE_VPN network info
    (function hookConnectivityManager() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var CM = Java.use('android.net.ConnectivityManager');
                var TYPE_VPN = 17;
                CM.getActiveNetworkInfo.implementation = function () {
                    var info = this.getActiveNetworkInfo();
                    if (info !== null && info.getType() === TYPE_VPN) return null;
                    return info;
                };
                _hookCount++;
                _log.ok('vpn: ConnectivityManager TYPE_VPN hidden');
            } catch (e) { _failCount++; _log.debug('vpn: ConnectivityManager hook — ' + e); }
        });
    })();

    // 4. /proc/net/if_inet6 — filter VPN interface lines
    (function hookProcNetIfInet6() {
        try {
            var openatPtr = Module.findExportByName(null, 'openat');
            if (!openatPtr) return;
            var _fdSet = {};

            Interceptor.attach(openatPtr, {
                onEnter: function (args) {
                    var path = safeReadStr(args[1]);
                    this._isIfInet6 = (path.indexOf('/proc/net/if_inet6') !== -1);
                },
                onLeave: function (retval) {
                    if (this._isIfInet6 && retval.toInt32() > 0) _fdSet[retval.toInt32()] = true;
                }
            });

            var readPtr = Module.findExportByName(null, 'read');
            if (!readPtr) return;
            Interceptor.attach(readPtr, {
                onEnter: function (args) {
                    this._fd  = args[0].toInt32();
                    this._buf = args[1];
                },
                onLeave: function (retval) {
                    var n = retval.toInt32();
                    if (n <= 0 || !_fdSet[this._fd]) return;
                    try {
                        var s     = this._buf.readUtf8String(n);
                        var lines = s.split('\n');
                        var clean = lines.filter(function (l) {
                            for (var i = 0; i < VPN_IFACE_PREFIXES.length; i++) {
                                if (l.indexOf(VPN_IFACE_PREFIXES[i]) !== -1) return false;
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
            _hookCount++;
            _log.ok('vpn: /proc/net/if_inet6 VPN interface filtering active');
        } catch (e) { _failCount++; _log.debug('vpn: if_inet6 hook — ' + e); }
    })();

    // 5. System.getProperty proxy check suppression
    (function hookSystemProxyCheck() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var System = Java.use('java.lang.System');
                System.getProperty.overload('java.lang.String').implementation = function (key) {
                    if (key === 'socksProxyHost' || key === 'socksProxyPort') return null;
                    return this.getProperty(key);
                };
            } catch (e) { _log.debug('vpn: System.getProperty proxy check — ' + e); }
        });
    })();

    // 6. getifaddrs — monitor native interface enumeration
    (function hookGetifaddrs() {
        try {
            var getifaddrsPtr = Module.findExportByName('libc.so', 'getifaddrs');
            if (!getifaddrsPtr) return;
            Interceptor.attach(getifaddrsPtr, {
                onLeave: function (_retval) {
                    _log.debug('vpn: getifaddrs() called');
                }
            });
        } catch (e) { _failCount++; _log.debug('vpn: getifaddrs hook — ' + e); }
    })();

    console.log('[*] vpn-detection-bypass: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('vpn-detection-bypass.js loaded');
})();
} catch (e) { console.log('[!!!] Module "vpn-detection-bypass" failed to load: ' + e.message); }

// ═══ lib/developer-mode-bypass.js ═══
try {
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

    var _hookCount = 0;
    var _failCount = 0;

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
                    _hookCount++;
                    _log.ok('devMode: ' + cls + ' developer mode spoofing active');
                } catch (e) { _failCount++; _log.debug('devMode: Settings hook for ' + cls + ' — ' + e); }
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
            _hookCount++;
            _log.ok('devMode: ADB system property spoofing active');
        } catch (e) { _failCount++; _log.debug('devMode: ADB system props hook — ' + e); }
    })();

    console.log('[*] developer-mode-bypass: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('developer-mode-bypass.js loaded');
})();
} catch (e) { console.log('[!!!] Module "developer-mode-bypass" failed to load: ' + e.message); }

// ═══ lib/accessibility-bypass.js ═══
try {
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
} catch (e) { console.log('[!!!] Module "accessibility-bypass" failed to load: ' + e.message); }

// ═══ lib/screen-capture-bypass.js ═══
try {
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
} catch (e) { console.log('[!!!] Module "screen-capture-bypass" failed to load: ' + e.message); }

// ═══ lib/app-cloning-bypass.js ═══
try {
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

    var _hookCount = 0;
    var _failCount = 0;

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
                _hookCount++;
                _log.ok('appCloning: UserManager.isUserAGoat() → false');
            } catch (e) { _failCount++; _log.debug('appCloning: isUserAGoat hook — ' + e); }
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
                _hookCount++;
                _log.ok('appCloning: UserManager.getUserProfiles() filtered to primary user');
            } catch (e) { _failCount++; _log.debug('appCloning: getUserProfiles hook — ' + e); }
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
                _hookCount++;
                _log.ok('appCloning: ActivityManager process list clone filtering active');
            } catch (e) { _failCount++; _log.debug('appCloning: ActivityManager hook — ' + e); }
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
                _hookCount++;
                _log.ok('appCloning: PackageManager clone app hiding active');
            } catch (e) { _failCount++; _log.debug('appCloning: PackageManager hook — ' + e); }
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
                _hookCount++;
                _log.ok('appCloning: File path normalization active');
            } catch (e) { _failCount++; _log.debug('appCloning: File.getCanonicalPath hook — ' + e); }
        });
    })();

    console.log('[*] app-cloning-bypass: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('app-cloning-bypass.js loaded');
})();
} catch (e) { console.log('[!!!] Module "app-cloning-bypass" failed to load: ' + e.message); }

// ═══ lib/android-ssl-pinning-bypass.js ═══
try {
/**
 * lib/android-ssl-pinning-bypass.js — Java SSL Unpinning (20+ libraries)
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Comprehensive certificate pinning defeat for all major Android SSL/TLS stacks.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: httptoolkit/android-certificate-unpinning.js (credit Tim Perry, AGPL-3.0)
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('sslPinning', 'Java SSL Unpinning (20+ libs)');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.sslPinning === false) return;

    var _hookCount = 0;
    var _failCount = 0;

    var _certPem = (typeof CERT_PEM !== 'undefined') ? CERT_PEM : (_CFG.CERT_PEM || null);

    // Permissive TrustManager factory
    function getCustomX509TrustManager() {
        var TrustManagerCls = Java.use('javax.net.ssl.X509TrustManager');
        var trustManager = Java.registerClass({
            name: 'com.bypass.CustomTrustManager',
            implements: [TrustManagerCls],
            methods: {
                checkClientTrusted: function (_chain, _authType) {},
                checkServerTrusted: function (_chain, _authType) {},
                getAcceptedIssuers: function () { return []; }
            }
        });
        return trustManager.$new();
    }

    var PINNING_FIXES = [
        // 1. javax X509TrustManager
        {
            className : 'javax.net.ssl.X509TrustManager',
            method    : 'checkServerTrusted',
            types     : ['[Ljava.security.cert.X509Certificate;', 'java.lang.String'],
            impl      : function () {}
        },
        // 2. SSLContext.init with permissive TrustManager
        {
            className : 'javax.net.ssl.SSLContext',
            method    : 'init',
            types     : ['[Ljavax.net.ssl.KeyManager;', '[Ljavax.net.ssl.TrustManager;', 'java.security.SecureRandom'],
            impl      : function (km, tms, sr) {
                try {
                    var custom = getCustomX509TrustManager();
                    this.init(km, [custom], sr);
                } catch (_) { this.init(km, tms, sr); }
            }
        },
        // 3. HttpsURLConnection
        {
            className : 'javax.net.ssl.HttpsURLConnection',
            method    : 'setSSLSocketFactory',
            types     : ['javax.net.ssl.SSLSocketFactory'],
            impl      : function () {}
        },
        {
            className : 'javax.net.ssl.HttpsURLConnection',
            method    : 'setHostnameVerifier',
            types     : ['javax.net.ssl.HostnameVerifier'],
            impl      : function () {}
        },
        // 4. OkHttp3 CertificatePinner
        {
            className : 'okhttp3.CertificatePinner',
            method    : 'check',
            types     : ['java.lang.String', 'java.util.List'],
            impl      : function () {}
        },
        {
            className : 'okhttp3.CertificatePinner',
            method    : 'check',
            types     : ['java.lang.String', '[Ljava.security.cert.Certificate;'],
            impl      : function () {}
        },
        {
            className : 'okhttp3.CertificatePinner',
            method    : 'check$okhttp',
            types     : ['java.lang.String', 'java.util.List'],
            impl      : function () {}
        },
        // 5. Android built-in OkHttp
        {
            className : 'com.android.okhttp.CertificatePinner',
            method    : 'check',
            types     : ['java.lang.String', '[Ljava.security.cert.Certificate;'],
            impl      : function () {}
        },
        // 6. Conscrypt TrustManagerImpl
        {
            className : 'com.android.org.conscrypt.TrustManagerImpl',
            method    : 'verifyChain',
            impl      : function (chain) { return chain; }
        },
        // 7. Conscrypt CertPinManager
        {
            className : 'com.android.org.conscrypt.CertPinManager',
            method    : 'isChainValid',
            impl      : function () { return true; }
        },
        // 8. Trustkit
        {
            className : 'com.datatheorem.android.trustkit.pinning.PinningTrustManager',
            method    : 'checkServerTrusted',
            impl      : function () {}
        },
        // 9. CertPathValidator
        {
            className : 'java.security.cert.CertPathValidator',
            method    : 'validate',
            impl      : function () { return null; }
        },
        // 10. NetworkSecurityTrustManager
        {
            className : 'android.security.net.config.NetworkSecurityTrustManager',
            method    : 'checkServerTrusted',
            impl      : function () {}
        },
        // 11. NetworkSecurityPolicy cleartext
        {
            className : 'android.security.net.config.NetworkSecurityPolicy',
            method    : 'isCleartextTrafficPermitted',
            impl      : function () { return true; }
        },
        {
            className : 'android.security.net.config.NetworkSecurityPolicy',
            method    : 'isCleartextTrafficPermitted',
            types     : ['java.lang.String'],
            impl      : function () { return true; }
        },
        // 12. PhoneGap / Cordova SSL plugin
        {
            className : 'nl.xservices.plugins.sslCertificateChecker',
            method    : 'execute',
            impl      : function () { return true; }
        },
        // 13. IBM WorkLight
        {
            className : 'com.worklight.wlclient.api.WLClient',
            method    : 'pinTrustedCertificatePublicKey',
            impl      : function () {}
        },
        // 14. CWAC-Netsecurity
        {
            className : 'com.commonsware.cwac.netsecurity.CertPinManager',
            method    : 'isChainValid',
            impl      : function () { return true; }
        },
        // 15. Appmattus Certificate Transparency
        {
            className : 'com.appmattus.certificatetransparency.CTInterceptorBuilder',
            method    : 'build',
            impl      : function () { return null; }
        },
        // 16. Appcelerator
        {
            className : 'ti.modules.titanium.network.TiHTTPClient',
            method    : 'setCustomSSLContext',
            impl      : function () {}
        },
        // 17. WebView onReceivedSslError
        {
            className : 'android.webkit.WebViewClient',
            method    : 'onReceivedSslError',
            types     : ['android.webkit.WebView', 'android.webkit.SslErrorHandler', 'android.net.http.SslError'],
            impl      : function (_wv, handler, _err) { handler.proceed(); }
        },
        // 18. SSLSocket hostname verifier
        {
            className : 'javax.net.ssl.HostnameVerifier',
            method    : 'verify',
            types     : ['java.lang.String', 'javax.net.ssl.SSLSession'],
            impl      : function () { return true; }
        },
        // 19. Apache HTTP legacy
        {
            className : 'org.apache.http.conn.ssl.AbstractVerifier',
            method    : 'verify',
            types     : ['java.lang.String', '[Ljava.lang.String;', '[Ljava.lang.String;', 'boolean'],
            impl      : function () {}
        },
        // 20. Retrofit / OkHttp TrustRootIndex
        {
            className : 'okhttp3.internal.tls.RealTrustRootIndex',
            method    : 'trustRootIndex',
            impl      : function (_cert) { return null; }
        }
    ];

    (function applyPinningFixes() {
        if (!Java.available) return;
        Java.perform(function () {
            PINNING_FIXES.forEach(function (fix) {
                try {
                    var cls    = Java.use(fix.className);
                    var method = fix.types
                        ? cls[fix.method].overload.apply(cls[fix.method], fix.types)
                        : cls[fix.method];
                    method.implementation = fix.impl;
                    _hookCount++;
                    _log.ok('sslPinning: hooked ' + fix.className + '.' + fix.method);
                } catch (e) {
                    _log.debug('sslPinning: skip ' + fix.className + '.' + fix.method + ' — ' + e.message);
                }
            });

            // Conscrypt NetworkSecurityConfig — inject custom CA if CERT_PEM provided
            if (_certPem) {
                try {
                    var CertFactory = Java.use('java.security.cert.CertificateFactory');
                    var BAI         = Java.use('java.io.ByteArrayInputStream');
                    var cf  = CertFactory.getInstance('X.509');
                    var pemBytes = Java.use('android.util.Base64').decode(
                        _certPem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''),
                        0
                    );
                    var cert = cf.generateCertificate(BAI.$new(pemBytes));
                    var KeyStore = Java.use('java.security.KeyStore');
                    var ks = KeyStore.getInstance('AndroidCAStore');
                    ks.load(null, null);
                    ks.setCertificateEntry('bypass_injected_ca', cert);
                    _hookCount++;
                    _log.ok('sslPinning: custom CA injected from CERT_PEM');
                } catch (e) { _failCount++; _log.debug('sslPinning: CERT_PEM injection — ' + e); }
            }
        });
    })();

    console.log('[*] android-ssl-pinning-bypass: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('android-ssl-pinning-bypass.js loaded');
})();
} catch (e) { console.log('[!!!] Module "android-ssl-pinning-bypass" failed to load: ' + e.message); }

// ═══ lib/android-ssl-pinning-bypass-fallback.js ═══
try {
/**
 * lib/android-ssl-pinning-bypass-fallback.js — Auto-Fallback SSL Patcher
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Runtime auto-detection and patching of unknown SSL pinning implementations.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: httptoolkit/android-certificate-unpinning-fallback.js (credit Tim Perry, AGPL-3.0)
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('sslFallback', 'Auto-Fallback SSL Patcher');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.sslFallback === false) return;

    var _hookCount = 0;
    var _failCount = 0;

    // Self-contained helpers — needed when running standalone without android-ssl-pinning-bypass.js
    var _buildX509CertificateFromBytes = (typeof buildX509CertificateFromBytes !== 'undefined')
        ? buildX509CertificateFromBytes
        : function(certBytes) {
            var ByteArrayInputStream = Java.use('java.io.ByteArrayInputStream');
            var CertFactory = Java.use('java.security.cert.CertificateFactory');
            var certFactory = CertFactory.getInstance('X.509');
            return certFactory.generateCertificate(ByteArrayInputStream.$new(certBytes));
        };

    var _getCustomX509TrustManager = (typeof getCustomX509TrustManager !== 'undefined')
        ? getCustomX509TrustManager
        : function() {
            var TrustManagerCls = Java.use('javax.net.ssl.X509TrustManager');
            var trustManager = Java.registerClass({
                name: 'com.bypass.FallbackTrustManager',
                implements: [TrustManagerCls],
                methods: {
                    checkClientTrusted: function (_chain, _authType) {},
                    checkServerTrusted: function (_chain, _authType) {},
                    getAcceptedIssuers: function () { return []; }
                }
            });
            return trustManager.$new();
        };

    (function buildUnhandledErrorPatcher() {
        if (!Java.available) return;
        Java.perform(function () {
            var _patched = {};

            function isOkHttpCheckMethod(cls, method) {
                return method.indexOf('check') !== -1 ||
                       method.indexOf('verify') !== -1 ||
                       cls.indexOf('CertificatePinner') !== -1 ||
                       cls.indexOf('PinningTrustManager') !== -1;
            }

            function isX509TrustManager(cls) {
                try {
                    var c = Java.use(cls);
                    return c['checkServerTrusted'] !== undefined;
                } catch (_) { return false; }
            }

            function tryPatchMethod(className, methodName) {
                var key = className + '#' + methodName;
                if (_patched[key]) return;
                try {
                    var cls    = Java.use(className);
                    var method = cls[methodName];
                    if (!method) return;
                    method.implementation = function () {};
                    _patched[key] = true;
                    _log.info('sslFallback: auto-patched ' + key);
                } catch (_) {}
            }

            // Hook SSLPeerUnverifiedException constructor → auto-patch caller
            try {
                var SSLPeerUnverified = Java.use('javax.net.ssl.SSLPeerUnverifiedException');
                SSLPeerUnverified.$init.overload('java.lang.String').implementation = function (msg) {
                    var trace = Java.use('java.lang.Thread').currentThread().getStackTrace();
                    for (var i = 2; i < Math.min(trace.length, 12); i++) {
                        var cls    = trace[i].getClassName();
                        var method = trace[i].getMethodName();
                        if (isOkHttpCheckMethod(cls, method)) tryPatchMethod(cls, method);
                    }
                    return this.$init(msg);
                };
                _hookCount++;
                _log.ok('sslFallback: SSLPeerUnverifiedException auto-patcher active');
            } catch (e) { _failCount++; _log.debug('sslFallback: SSLPeerUnverifiedException hook — ' + e); }

            // Hook CertificateException constructor → auto-patch X509TrustManager
            try {
                var CertException = Java.use('java.security.cert.CertificateException');
                CertException.$init.overload('java.lang.String').implementation = function (msg) {
                    var trace = Java.use('java.lang.Thread').currentThread().getStackTrace();
                    for (var i = 2; i < Math.min(trace.length, 12); i++) {
                        var cls    = trace[i].getClassName();
                        var method = trace[i].getMethodName();
                        if (isX509TrustManager(cls)) tryPatchMethod(cls, method);
                    }
                    return this.$init(msg);
                };
                _hookCount++;
                _log.ok('sslFallback: CertificateException auto-patcher active');
            } catch (e) { _failCount++; _log.debug('sslFallback: CertificateException hook — ' + e); }

            // Auto-detect OkHttp check methods via RuntimeException scanning
            try {
                var RuntimeException = Java.use('java.lang.RuntimeException');
                RuntimeException.$init.overload('java.lang.String').implementation = function (msg) {
                    if (msg && (msg.indexOf('Certificate pinning failure') !== -1 ||
                                msg.indexOf('pin verification failed') !== -1)) {
                        var trace = Java.use('java.lang.Thread').currentThread().getStackTrace();
                        for (var i = 2; i < Math.min(trace.length, 12); i++) {
                            var cls    = trace[i].getClassName();
                            var method = trace[i].getMethodName();
                            if (isOkHttpCheckMethod(cls, method)) tryPatchMethod(cls, method);
                        }
                    }
                    return this.$init(msg);
                };
                _hookCount++;
                _log.ok('sslFallback: RuntimeException SSL failure scanner active');
            } catch (e) { _failCount++; _log.debug('sslFallback: RuntimeException hook — ' + e); }

            // Auto-detect X509TrustManager implementations via classloader scanning
            try {
                Java.enumerateLoadedClasses({
                    onMatch: function (name) {
                        if (name.indexOf('TrustManager') !== -1 ||
                            name.indexOf('CertPinner') !== -1 ||
                            name.indexOf('CertificatePinner') !== -1) {
                            try {
                                var cls = Java.use(name);
                                if (cls.checkServerTrusted) {
                                    tryPatchMethod(name, 'checkServerTrusted');
                                }
                            } catch (_) {}
                        }
                    },
                    onComplete: function () {
                        _hookCount++;
                        _log.ok('sslFallback: class enumeration scan complete');
                    }
                });
            } catch (e) { _log.debug('sslFallback: class enumeration — ' + e); }
        });
    })();

    console.log('[*] android-ssl-pinning-bypass-fallback: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('android-ssl-pinning-bypass-fallback.js loaded');
})();
} catch (e) { console.log('[!!!] Module "android-ssl-pinning-bypass-fallback" failed to load: ' + e.message); }

// ═══ lib/android-system-certificate-injection.js ═══
try {
/**
 * lib/android-system-certificate-injection.js — System CA Certificate Injection
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Injects a custom CA certificate into the Android trust store at runtime
 * so all SSL validation trusts the injected CA (e.g., Burp/mitmproxy cert).
 * Works standalone OR via config.js orchestrator.
 *
 * Source: httptoolkit/android-system-certificate-injection.js (credit Tim Perry, AGPL-3.0)
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('certInjection', 'System CA Certificate Injection');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.certInjection === false) return;

    var _hookCount = 0;
    var _failCount = 0;

    var _certPem  = (typeof CERT_PEM !== 'undefined') ? CERT_PEM : (_CFG.CERT_PEM || null);
    var CA_CERT_PATH = (_CFG.ca && _CFG.ca.certPath) || '/data/local/tmp/burp.crt';

    function loadCertBytes() {
        if (_certPem) {
            try {
                var Base64 = Java.use('android.util.Base64');
                var stripped = _certPem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
                return Base64.decode(stripped, 0);
            } catch (e) { _failCount++; _log.debug('certInjection: PEM decode failed — ' + e); }
        }
        try {
            var FileInputStream    = Java.use('java.io.FileInputStream');
            var ByteArrayOutStream = Java.use('java.io.ByteArrayOutputStream');
            var fis  = FileInputStream.$new(CA_CERT_PATH);
            var baos = ByteArrayOutStream.$new();
            var buf  = Java.array('byte', new Array(4096).fill(0));
            var n;
            while ((n = fis.read(buf)) !== -1) baos.write(buf, 0, n);
            fis.close();
            return baos.toByteArray();
        } catch (e) { _failCount++; _log.debug('certInjection: file read failed — ' + e); }
        return null;
    }

    function buildX509Cert(derBytes) {
        try {
            var CertFactory = Java.use('java.security.cert.CertificateFactory');
            var BAI = Java.use('java.io.ByteArrayInputStream');
            var cf  = CertFactory.getInstance('X.509');
            return cf.generateCertificate(BAI.$new(derBytes));
        } catch (e) { _failCount++; _log.debug('certInjection: cert parse — ' + e); return null; }
    }

    // TrustedCertificateIndex class name variants across Android versions
    var TCI_CLASS_NAMES = [
        'com.android.org.conscrypt.TrustedCertificateIndex',
        'org.conscrypt.TrustedCertificateIndex',
        'com.android.org.bouncycastle.jce.provider.CertStoreIndexedList'
    ];

    function hookTrustedCertificateIndex(cert) {
        TCI_CLASS_NAMES.forEach(function (clsName) {
            try {
                var TCI = Java.use(clsName);

                // Hook $init — inject cert after construction
                if (TCI.$init) {
                    TCI.$init.implementation = function () {
                        this.$init();
                        try { this.index(cert); } catch (_) {}
                    };
                    _hookCount++;
                    _log.ok('certInjection: TrustedCertificateIndex.$init hooked (' + clsName + ')');
                }

                // Hook reset — re-inject after reset
                if (TCI.reset) {
                    TCI.reset.implementation = function () {
                        this.reset();
                        try { this.index(cert); } catch (_) {}
                    };
                    _hookCount++;
                    _log.ok('certInjection: TrustedCertificateIndex.reset hooked (' + clsName + ')');
                }
            } catch (_) {}
        });
    }

    (function injectCA() {
        if (!Java.available) return;
        Java.perform(function () {
            var certBytes = loadCertBytes();
            if (!certBytes) {
                _log.info('certInjection: no certificate available — using trust-all fallback');
            }

            var cert = certBytes ? buildX509Cert(certBytes) : null;

            // 1. KeyStore injection
            try {
                var KeyStore    = Java.use('java.security.KeyStore');
                var TrustMgrFac = Java.use('javax.net.ssl.TrustManagerFactory');
                var SSLContext  = Java.use('javax.net.ssl.SSLContext');

                var ks = KeyStore.getInstance('AndroidCAStore');
                ks.load(null, null);
                if (cert) ks.setCertificateEntry('bypass_ca_' + Date.now(), cert);

                var tmf = TrustMgrFac.getInstance(TrustMgrFac.getDefaultAlgorithm());
                tmf.init(ks);

                var ctx = SSLContext.getInstance('TLS');
                ctx.init(null, tmf.getTrustManagers(), null);
                SSLContext.setDefault(ctx);
                _hookCount++;
                _log.ok('certInjection: CA injected into AndroidCAStore + SSLContext');
            } catch (e) { _failCount++; _log.debug('certInjection: KeyStore injection — ' + e); }

            // 2. TrustedCertificateIndex hooks
            if (cert) hookTrustedCertificateIndex(cert);

            // 3. TrustManagerFactory.init wrapper
            try {
                var TrustManagerFactory = Java.use('javax.net.ssl.TrustManagerFactory');
                var KeyStoreCls         = Java.use('java.security.KeyStore');

                TrustManagerFactory.init.overload('java.security.KeyStore').implementation = function (ks_arg) {
                    try {
                        if (!ks_arg || ks_arg.isNull()) {
                            var newKs = KeyStoreCls.getInstance('AndroidCAStore');
                            newKs.load(null, null);
                            if (cert) newKs.setCertificateEntry('bypass_ca', cert);
                            return this.init(newKs);
                        }
                        if (cert) ks_arg.setCertificateEntry('bypass_ca', cert);
                        return this.init(ks_arg);
                    } catch (_) { return this.init(ks_arg); }
                };
                _hookCount++;
                _log.ok('certInjection: TrustManagerFactory.init() wrapped');
            } catch (e) { _failCount++; _log.debug('certInjection: TrustManagerFactory wrap — ' + e); }

            // 4. WebView — proceed through SSL errors
            try {
                var WebViewClient = Java.use('android.webkit.WebViewClient');
                WebViewClient.onReceivedSslError.implementation = function (_wv, handler, _err) {
                    handler.proceed();
                };
                _hookCount++;
                _log.ok('certInjection: WebView onReceivedSslError → proceed()');
            } catch (e) { _failCount++; _log.debug('certInjection: WebView hook — ' + e); }
        });
    })();

    console.log('[*] android-system-certificate-injection: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('android-system-certificate-injection.js loaded');
})();
} catch (e) { console.log('[!!!] Module "android-system-certificate-injection" failed to load: ' + e.message); }

// ═══ lib/native-tls-hook.js ═══
try {
/**
 * lib/native-tls-hook.js — Native BoringSSL/OpenSSL Hooks
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Hooks BoringSSL/OpenSSL native TLS verification functions across
 * all loaded native libraries.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: httptoolkit/native-tls-hook.js (credit Tim Perry, AGPL-3.0)
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('nativeTls', 'Native BoringSSL/OpenSSL Hooks');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.nativeTls === false) return;

    var _hookCount = 0;
    var _failCount = 0;

    var TARGET_LIBS = [
        'libboringssl.dylib',
        'libsscronet.so',
        'boringssl',
        'libssl.so',
        null  // search all modules
    ];

    // NativeCallback: always return SSL_VERIFY_OK (0)
    var noop_verify_cb = new NativeCallback(function (_ssl, _out_alert) {
        return 0; // ssl_verify_ok
    }, 'int', ['pointer', 'pointer']);

    // NativeCallback for SSL_CTX_set_cert_verify_callback callback arg
    var noop_cert_verify_cb = new NativeCallback(function (_store_ctx, _arg) {
        return 1; // X509 verification success
    }, 'int', ['pointer', 'pointer']);

    function hookLib(libName) {
        // SSL_CTX_set_custom_verify
        try {
            var addr = Module.findExportByName(libName, 'SSL_CTX_set_custom_verify');
            if (addr) {
                Interceptor.attach(addr, {
                    onEnter: function (args) {
                        // Replace the callback with our no-op
                        args[2] = noop_verify_cb;
                    }
                });
                _hookCount++;
                _log.ok('nativeTls: SSL_CTX_set_custom_verify hooked (' + (libName || 'global') + ')');
            }
        } catch (e) { _log.debug('nativeTls: SSL_CTX_set_custom_verify in ' + libName + ' — ' + e); }

        // SSL_set_custom_verify
        try {
            var addr2 = Module.findExportByName(libName, 'SSL_set_custom_verify');
            if (addr2) {
                Interceptor.attach(addr2, {
                    onEnter: function (args) {
                        args[2] = noop_verify_cb;
                    }
                });
                _hookCount++;
                _log.ok('nativeTls: SSL_set_custom_verify hooked (' + (libName || 'global') + ')');
            }
        } catch (e) { _log.debug('nativeTls: SSL_set_custom_verify in ' + libName + ' — ' + e); }

        // SSL_CTX_set_cert_verify_callback
        try {
            var addr3 = Module.findExportByName(libName, 'SSL_CTX_set_cert_verify_callback');
            if (addr3) {
                Interceptor.attach(addr3, {
                    onEnter: function (args) {
                        args[1] = noop_cert_verify_cb;
                        args[2] = ptr(0);
                    }
                });
                _hookCount++;
                _log.ok('nativeTls: SSL_CTX_set_cert_verify_callback hooked (' + (libName || 'global') + ')');
            }
        } catch (e) { _log.debug('nativeTls: SSL_CTX_set_cert_verify_callback in ' + libName + ' — ' + e); }

        // SSL_get_verify_result — return X509_V_OK (0)
        try {
            var addr4 = Module.findExportByName(libName, 'SSL_get_verify_result');
            if (addr4) {
                Interceptor.attach(addr4, {
                    onLeave: function (retval) { retval.replace(ptr(0)); }
                });
                _hookCount++;
                _log.ok('nativeTls: SSL_get_verify_result hooked (' + (libName || 'global') + ')');
            }
        } catch (e) { _log.debug('nativeTls: SSL_get_verify_result in ' + libName + ' — ' + e); }
    }

    // Inline waitForModule fallback
    function waitForModule(name, timeoutMs) {
        if (typeof BYPASS_UTILS !== 'undefined' && BYPASS_UTILS.waitForModule) {
            return BYPASS_UTILS.waitForModule(name, timeoutMs);
        }
        return new Promise(function (resolve, reject) {
            var deadline = Date.now() + (timeoutMs || 10000);
            function attempt() {
                var mod = Process.findModuleByName(name);
                if (mod) { resolve(mod); return; }
                if (Date.now() >= deadline) { reject(new Error('Timeout: ' + name)); return; }
                setTimeout(attempt, 300);
            }
            attempt();
        });
    }

    // Hook all target libraries immediately
    TARGET_LIBS.forEach(function (lib) {
        hookLib(lib);
    });

    // Also hook when specific libs load later
    ['libssl.so', 'libboringssl.so', 'libsscronet.so'].forEach(function (lib) {
        if (!Process.findModuleByName(lib)) {
            waitForModule(lib, 15000).then(function () {
                hookLib(lib);
            }).catch(function () {});
        }
    });

    console.log('[*] native-tls-hook: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('native-tls-hook.js loaded');
})();
} catch (e) { console.log('[!!!] Module "native-tls-hook" failed to load: ' + e.message); }

// ═══ lib/disable-flutter-tls.js ═══
try {
/**
 * lib/disable-flutter-tls.js — Flutter / Dart TLS Bypass
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Dedicated Flutter TLS handling using NVISOsecurity byte-pattern scanning.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: NVISOsecurity/disable-flutter-tls-verification (credit NVISO)
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('flutter', 'Flutter/Dart TLS Bypass');

    var _hookCount = 0;
    var _failCount = 0;

    var _flutterEnabled = (typeof BYPASS_BUS !== 'undefined') ? BYPASS_BUS.enabled.flutter :
                          (_CFG.modules ? _CFG.modules.flutter : true);
    if (_flutterEnabled === false) return;

    var ARCH = Process.arch;

    // Patterns from NVISOsecurity/disable-flutter-tls-verification and
    // httptoolkit/android-disable-flutter-certificate-pinning.js
    // Covering Flutter v2.0.0 – v3.32.0
    var PATTERNS = {
        arm64: [
            // Original NVISO patterns
            '60 0? 00 54 ?? ?? ?? ?? ?? ?? 00 94',
            '20 0? 00 54 ?? ?? ?? ?? ?? ?? 00 94',
            'E0 03 00 AA ?? ?? ?? ?? ?? ?? 00 94',
            '00 00 00 14 ?? ?? ?? ?? ?? ?? 00 94',
            // httptoolkit extended patterns (Flutter 2.x - 3.x)
            '60 0? 00 54 ?? ?? ?? ?? ?? ?? ?? 94',
            '20 0? 00 54 ?? ?? ?? ?? ?? ?? ?? 94',
            'E0 03 00 AA ?? ?? ?? ?? ?? ?? ?? 94',
            '00 00 00 14 ?? ?? ?? ?? ?? ?? ?? 94',
            // Flutter 3.x newer build patterns
            'A0 0? 00 54 ?? ?? ?? ?? ?? ?? 00 94',
            'C0 0? 00 54 ?? ?? ?? ?? ?? ?? 00 94',
            '00 01 00 54 ?? ?? ?? ?? ?? ?? 00 94',
            '00 02 00 54 ?? ?? ?? ?? ?? ?? 00 94'
        ],
        arm: [
            '2D E9 ?? ?? 98 40',
            'F0 B5 03 ?? ?? ?? 01 25',
            'F0 B5 ?? ?? ?? ?? 01 2? 01 2?',
            // Additional arm patterns
            '10 B5 ?? ?? ?? ?? ?? ?? 00 28',
            '2D E9 F0 4F ?? ?? ?? ?? 4D F8'
        ],
        x64: [
            // Original patterns
            '74 ?? 48 8? ?? 48 8? ?? E8 ?? ?? ?? ??',
            '75 ?? 48 8? ?? ?? ?? E8 ?? ?? ?? ??',
            '0F 84 ?? ?? 00 00 E8 ?? ?? ?? ??',
            // Additional x64 patterns for emulator support
            '74 ?? 48 8B ?? 48 8B ?? FF 1? ?? ?? ?? ??',
            '0F 85 ?? ?? 00 00 48 8B ?? E8 ?? ?? ?? ??',
            '74 ?? 48 8B ?? ?? E8 ?? ?? ?? ??'
        ],
        ia32: [
            '74 ?? 8B ?? 89 ?? E8 ?? ?? ?? ??',
            '74 ?? 8B ?? E8 ?? ?? ?? ??'
        ]
    };

    var FLUTTER_MODULE   = 'libflutter.so';
    var MAX_RETRIES      = 20;
    var RETRY_INTERVAL   = 500;

    function waitForModule(name, timeoutMs) {
        if (typeof BYPASS_UTILS !== 'undefined' && BYPASS_UTILS.waitForModule) {
            return BYPASS_UTILS.waitForModule(name, timeoutMs);
        }
        return new Promise(function (resolve, reject) {
            var deadline = Date.now() + (timeoutMs || 10000);
            function attempt() {
                var mod = Process.findModuleByName(name);
                if (mod) { resolve(mod); return; }
                if (Date.now() >= deadline) { reject(new Error('Timeout: ' + name)); return; }
                setTimeout(attempt, 300);
            }
            attempt();
        });
    }

    function hook_ssl_verify_peer_cert(addr) {
        try {
            Interceptor.replace(addr, new NativeCallback(function (_ssl) {
                return 0; // SSL_VERIFY_SUCCESS
            }, 'int', ['pointer']));
            _hookCount++;
            _log.ok('flutter: ssl_verify_peer_cert replaced @ ' + addr);
            return true;
        } catch (e) {
            _log.debug('flutter: replace failed @ ' + addr + ' — ' + e);
            return false;
        }
    }

    function findAndPatch(baseAddr, size, patterns) {
        var patched = 0;
        patterns.forEach(function (pattern) {
            try {
                var matches = Memory.scanSync(baseAddr, size, pattern);
                matches.forEach(function (m) {
                    if (hook_ssl_verify_peer_cert(m.address)) patched++;
                });
            } catch (e) { _failCount++; _log.debug('flutter: scan error — ' + e); }
        });
        return patched;
    }

    function isFlutterRange(name) {
        if (!name) return false;
        return name.indexOf('flutter') !== -1 || name.indexOf('Flutter') !== -1;
    }

    function disableTLSValidation(flutterModule) {
        var patched = 0;

        // Export-based approach first
        var exportNames = ['ssl_verify_peer_cert', 'SSL_CTX_set_custom_verify'];
        exportNames.forEach(function (sym) {
            var addr = Module.findExportByName(flutterModule ? flutterModule.name : null, sym);
            if (addr && hook_ssl_verify_peer_cert(addr)) patched++;
        });

        if (patched > 0) {
            _hookCount++;
            _log.ok('flutter: patched via exports (' + patched + ')');
            return;
        }

        // Pattern scanning
        var archPatterns = PATTERNS[ARCH] || [];
        if (archPatterns.length === 0) {
            _log.fail('flutter: no patterns for arch ' + ARCH);
            return;
        }

        if (flutterModule) {
            patched = findAndPatch(flutterModule.base, flutterModule.size, archPatterns);
            if (patched > 0) _hookCount++;
            _log.ok('flutter: patched ' + patched + ' via patterns in libflutter.so');
        } else {
            Process.enumerateRanges('r-x').forEach(function (range) {
                if (isFlutterRange(range.file ? range.file.path : '')) {
                    patched += findAndPatch(range.base, range.size, archPatterns);
                }
            });
            if (patched > 0) _hookCount++;
            _log.ok('flutter: patched ' + patched + ' via r-x range scan');
        }
    }

    (function main() {
        var mod = Process.findModuleByName(FLUTTER_MODULE);
        if (mod) {
            disableTLSValidation(mod);
            return;
        }

        _log.info('flutter: libflutter.so not found yet — waiting...');
        var retries = 0;
        function retry() {
            retries++;
            var m = Process.findModuleByName(FLUTTER_MODULE);
            if (m) { disableTLSValidation(m); return; }
            if (retries < MAX_RETRIES) {
                setTimeout(retry, RETRY_INTERVAL);
            } else {
                _log.info('flutter: libflutter.so timeout — scanning all r-x ranges');
                disableTLSValidation(null);
            }
        }
        setTimeout(retry, RETRY_INTERVAL);
    })();

    console.log('[*] disable-flutter-tls: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('disable-flutter-tls.js loaded');
})();
} catch (e) { console.log('[!!!] Module "disable-flutter-tls" failed to load: ' + e.message); }

// ═══ lib/meta-ssl-pinning-bypass.js ═══
try {
/**
 * lib/meta-ssl-pinning-bypass.js — Meta Apps SSL Bypass
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Defeats SSL pinning in Meta apps (Facebook, Instagram, Messenger, WhatsApp)
 * via proxygen mangled name hooks and BoringSSL native hooks.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: iomoath/meta-apps-ssl-pinning/fb_ssl_hooks_v2.js
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('metaSsl', 'Meta Apps SSL Bypass');

    var _hookCount = 0;
    var _failCount = 0;

    var _metaEnabled = (typeof BYPASS_BUS !== 'undefined') ? BYPASS_BUS.enabled.metaSsl :
                       (_CFG.modules ? _CFG.modules.metaSsl : 'auto');
    if (_metaEnabled === false) return;

    // Package → native lib mapping
    var META_LIB_MAP = {
        'com.instagram.android'    : 'libscrollmerged.so',
        'com.facebook.pages.app'   : 'libstartup.so',
        'com.facebook.orca'        : 'libcoldstart.so',
        'com.facebook.katana'      : 'libcoldstart.so',
        'com.whatsapp'             : 'libwhatsapp.so'
    };

    var META_PROXYGEN_SYMS = [
        '_ZN8proxygen15SSLVerification17verifyWithMetricsEb',
        'verifyWithMetrics',
        '_ZN8proxygen10httpclient11PinningData15getKeySHA256SetEv'
    ];

    function waitForModule(name, timeoutMs) {
        if (typeof BYPASS_UTILS !== 'undefined' && BYPASS_UTILS.waitForModule) {
            return BYPASS_UTILS.waitForModule(name, timeoutMs);
        }
        return new Promise(function (resolve, reject) {
            var deadline = Date.now() + (timeoutMs || 15000);
            function attempt() {
                var mod = Process.findModuleByName(name);
                if (mod) { resolve(mod); return; }
                if (Date.now() >= deadline) { reject(new Error('Timeout: ' + name)); return; }
                setTimeout(attempt, 300);
            }
            attempt();
        });
    }

    function hookProxygenInLib(libName) {
        META_PROXYGEN_SYMS.forEach(function (sym) {
            try {
                var addr = Module.findExportByName(libName, sym);
                if (!addr) {
                    // Try enumerating exports with partial match
                    var exports_ = Module.enumerateExportsSync(libName);
                    for (var i = 0; i < exports_.length; i++) {
                        if (exports_[i].name.indexOf('verifyWithMetrics') !== -1 ||
                            exports_[i].name.indexOf('getKeySHA256Set') !== -1) {
                            addr = exports_[i].address;
                            break;
                        }
                    }
                }
                if (!addr) return;
                Interceptor.attach(addr, {
                    onLeave: function (retval) { retval.replace(ptr(1)); }
                });
                _hookCount++;
                _log.ok('metaSsl: proxygen hook ' + sym + ' in ' + libName);
            } catch (e) { _log.debug('metaSsl: proxygen sym ' + sym + ' in ' + libName + ' — ' + e); }
        });

        // BoringSSL hooks inside the Meta lib
        var boringSslFns = [
            'SSL_CTX_set_cert_verify_callback',
            'SSL_set_custom_verify',
            'SSL_CTX_set_custom_verify',
            'SSL_get_verify_result'
        ];
        boringSslFns.forEach(function (sym) {
            try {
                var addr = Module.findExportByName(libName, sym);
                if (!addr) return;
                if (sym === 'SSL_get_verify_result') {
                    Interceptor.attach(addr, { onLeave: function (rv) { rv.replace(ptr(0)); } });
                } else {
                    Interceptor.attach(addr, {
                        onEnter: function (args) {
                            if (args.length >= 2) args[1] = ptr(0);
                        }
                    });
                }
                _hookCount++;
                _log.ok('metaSsl: BoringSSL hook ' + sym + ' in ' + libName);
            } catch (e) { _log.debug('metaSsl: BoringSSL ' + sym + ' in ' + libName + ' — ' + e); }
        });
    }

    // Auto-detect Meta app package
    function detectMetaPackage() {
        var pkg = '';
        if (Java.available) {
            Java.perform(function () {
                try {
                    var AT = Java.use('android.app.ActivityThread');
                    pkg = AT.currentPackageName();
                } catch (_) {}
            });
        }
        return pkg;
    }

    (function main() {
        // If auto mode and not a Meta app, skip
        if (_metaEnabled === 'auto') {
            var pkg = detectMetaPackage();
            var isMetaApp = false;
            Object.keys(META_LIB_MAP).forEach(function (k) {
                if (pkg.indexOf(k) !== -1) isMetaApp = true;
            });
            if (!isMetaApp) {
                _log.debug('metaSsl: not a Meta app (' + pkg + ') — skipping');
                return;
            }
        }

        // Hook all known Meta libs
        var allLibs = [];
        Object.keys(META_LIB_MAP).forEach(function (k) {
            var lib = META_LIB_MAP[k];
            if (allLibs.indexOf(lib) === -1) allLibs.push(lib);
        });
        allLibs.push('libssl.so');

        allLibs.forEach(function (lib) {
            var mod = Process.findModuleByName(lib);
            if (mod) {
                hookProxygenInLib(lib);
            } else {
                waitForModule(lib, 15000).then(function () {
                    hookProxygenInLib(lib);
                }).catch(function () {
                    _log.debug('metaSsl: ' + lib + ' not found');
                });
            }
        });
    })();

    console.log('[*] meta-ssl-pinning-bypass: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('meta-ssl-pinning-bypass.js loaded');
})();
} catch (e) { console.log('[!!!] Module "meta-ssl-pinning-bypass" failed to load: ' + e.message); }

// ═══ lib/android-proxy-override.js ═══
try {
/**
 * lib/android-proxy-override.js — Java Proxy Force Override
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Forces ALL app traffic through a configured proxy at every Java layer.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: httptoolkit/android-proxy-override.js (credit Tim Perry, AGPL-3.0)
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('proxyOverride', 'Java Proxy Force Override');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.proxyOverride === false) return;

    var _hookCount = 0;
    var _failCount = 0;

    var _proxyHost = (typeof PROXY_HOST !== 'undefined') ? PROXY_HOST : (_CFG.proxy ? _CFG.proxy.host : '127.0.0.1');
    var _proxyPort = (typeof PROXY_PORT !== 'undefined') ? PROXY_PORT : (_CFG.proxy ? _CFG.proxy.port : 8080);
    var _proxyType = (_CFG.proxy && _CFG.proxy.type) || 'HTTP';

    _log.info('proxyOverride: target ' + _proxyType + ' ' + _proxyHost + ':' + _proxyPort);

    // 1. System.getProperty — force proxy properties
    (function hookSystemProperties() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var System = Java.use('java.lang.System');
                System.getProperty.overload('java.lang.String').implementation = function (key) {
                    if (key === 'http.proxyHost'  || key === 'https.proxyHost')  return _proxyHost;
                    if (key === 'http.proxyPort'  || key === 'https.proxyPort')  return String(_proxyPort);
                    if (key === 'socksProxyHost'  && _proxyType === 'SOCKS5')    return _proxyHost;
                    if (key === 'socksProxyPort'  && _proxyType === 'SOCKS5')    return String(_proxyPort);
                    return this.getProperty(key);
                };
                System.getProperty.overload('java.lang.String', 'java.lang.String').implementation = function (key, def) {
                    if (key === 'http.proxyHost'  || key === 'https.proxyHost')  return _proxyHost;
                    if (key === 'http.proxyPort'  || key === 'https.proxyPort')  return String(_proxyPort);
                    return this.getProperty(key, def);
                };
                _hookCount++;
                _log.ok('proxyOverride: System.getProperty() proxy override active');
            } catch (e) { _failCount++; _log.debug('proxyOverride: System.getProperty hook — ' + e); }
        });
    })();

    // 2. ProxySelector.select() — return proxy for all URIs
    (function hookProxySelector() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var ProxySelector  = Java.use('java.net.ProxySelector');
                var InetSocketAddr = Java.use('java.net.InetSocketAddress');
                var ProxyCls       = Java.use('java.net.Proxy');
                var ProxyType      = Java.use('java.net.Proxy$Type');
                var ArrayList      = Java.use('java.util.ArrayList');

                var proxyType = _proxyType === 'SOCKS5' ? ProxyType.SOCKS.value : ProxyType.HTTP.value;
                var sockAddr  = InetSocketAddr.$new(_proxyHost, _proxyPort);
                var proxy     = ProxyCls.$new(proxyType, sockAddr);

                ProxySelector.select.implementation = function (_uri) {
                    var list = ArrayList.$new();
                    list.add(proxy);
                    return list;
                };
                _hookCount++;
                _log.ok('proxyOverride: ProxySelector.select() override active');
            } catch (e) { _failCount++; _log.debug('proxyOverride: ProxySelector hook — ' + e); }
        });
    })();

    // 3. Proxy.NO_PROXY — replace with our proxy
    (function hookNoProxy() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var InetSocketAddr = Java.use('java.net.InetSocketAddress');
                var ProxyCls       = Java.use('java.net.Proxy');
                var ProxyType      = Java.use('java.net.Proxy$Type');

                var proxyType = _proxyType === 'SOCKS5' ? ProxyType.SOCKS.value : ProxyType.HTTP.value;
                var sockAddr  = InetSocketAddr.$new(_proxyHost, _proxyPort);
                ProxyCls.NO_PROXY.value = ProxyCls.$new(proxyType, sockAddr);
                _hookCount++;
                _log.ok('proxyOverride: Proxy.NO_PROXY replaced');
            } catch (e) { _failCount++; _log.debug('proxyOverride: Proxy.NO_PROXY hook — ' + e); }
        });
    })();

    // 4. OkHttpClient.Builder.build() — force proxy
    (function hookOkHttpProxy() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var OkHttpBuilder  = Java.use('okhttp3.OkHttpClient$Builder');
                var InetSocketAddr = Java.use('java.net.InetSocketAddress');
                var ProxyCls       = Java.use('java.net.Proxy');
                var ProxyType      = Java.use('java.net.Proxy$Type');

                var proxyType = _proxyType === 'SOCKS5' ? ProxyType.SOCKS.value : ProxyType.HTTP.value;
                var sockAddr  = InetSocketAddr.$new(_proxyHost, _proxyPort);
                var ourProxy  = ProxyCls.$new(proxyType, sockAddr);

                OkHttpBuilder.build.implementation = function () {
                    this.proxy(ourProxy);
                    return this.build();
                };
                _hookCount++;
                _log.ok('proxyOverride: OkHttpClient.Builder.build() proxy injection active');
            } catch (e) { _failCount++; _log.debug('proxyOverride: OkHttpClient.Builder hook — ' + e); }
        });
    })();

    // 5. Settings.Global http_proxy spoofing
    (function hookSettings() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var Settings = Java.use('android.provider.Settings$Global');
                var proxyVal = _proxyHost + ':' + _proxyPort;
                Settings.getString.overload('android.content.ContentResolver', 'java.lang.String').implementation = function (cr, name) {
                    if (name === 'http_proxy' || name === 'global_http_proxy_host') return proxyVal;
                    return this.getString(cr, name);
                };
                _hookCount++;
                _log.ok('proxyOverride: Settings.Global http_proxy spoofing active');
            } catch (e) { _failCount++; _log.debug('proxyOverride: Settings.Global hook — ' + e); }
        });
    })();

    // 6. NetworkSecurityPolicy.isCleartextTrafficPermitted() → true
    (function hookCleartext() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var NSP = Java.use('android.security.net.config.NetworkSecurityPolicy');
                NSP.isCleartextTrafficPermitted.overload().implementation = function () { return true; };
                NSP.isCleartextTrafficPermitted.overload('java.lang.String').implementation = function () { return true; };
                _hookCount++;
                _log.ok('proxyOverride: cleartext traffic permitted');
            } catch (e) { _failCount++; _log.debug('proxyOverride: NSP hook — ' + e); }
        });
    })();

    console.log('[*] android-proxy-override: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('android-proxy-override.js loaded');
})();
} catch (e) { console.log('[!!!] Module "android-proxy-override" failed to load: ' + e.message); }

// ═══ lib/native-connect-hook.js ═══
try {
/**
 * lib/native-connect-hook.js — Native connect() Redirect
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Hooks libc connect() to redirect TCP traffic through a proxy.
 * Supports IPv4 (AF_INET) and IPv6 (AF_INET6) sockets.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: httptoolkit/native-connect-hook.js (credit Tim Perry, AGPL-3.0)
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('nativeConnect', 'Native connect() Redirect');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.nativeConnect === false) return;

    var _hookCount = 0;
    var _failCount = 0;

    var _PROXY_HOST = (_CFG && _CFG.proxy && _CFG.proxy.host) || (typeof PROXY_HOST !== 'undefined' ? PROXY_HOST : '127.0.0.1');
    var _PROXY_PORT = (_CFG && _CFG.proxy && _CFG.proxy.port) || (typeof PROXY_PORT !== 'undefined' ? PROXY_PORT : 8080);
    var _socks5    = (typeof PROXY_SUPPORTS_SOCKS5 !== 'undefined') ? PROXY_SUPPORTS_SOCKS5 :
                     (_CFG.PROXY_SUPPORTS_SOCKS5 || false);
    var _ignoredPorts = (typeof IGNORED_NON_HTTP_PORTS !== 'undefined') ? IGNORED_NON_HTTP_PORTS :
                        (_CFG.IGNORED_NON_HTTP_PORTS || []);

    var AF_INET  = 2;
    var AF_INET6 = 10;
    var SOCK_STREAM = 1; // TCP

    // Convert IPv4 address bytes to integer array
    function parseSockaddrIn(sa) {
        try {
            var family = sa.readU16();
            if (family !== AF_INET) return null;
            var port = ((sa.add(2).readU8() << 8) | sa.add(3).readU8());
            return { family: AF_INET, port: port };
        } catch (_) { return null; }
    }

    function parseSockaddrIn6(sa) {
        try {
            var family = sa.readU16();
            if (family !== AF_INET6) return null;
            var port = ((sa.add(2).readU8() << 8) | sa.add(3).readU8());
            return { family: AF_INET6, port: port };
        } catch (_) { return null; }
    }

    function isIgnoredPort(port) {
        if (_ignoredPorts.indexOf(port) !== -1) return true;
        // Always ignore DNS
        if (port === 53) return true;
        return false;
    }

    function rewriteSockaddrToProxy(sa, addrLen) {
        try {
            // Parse proxy host IP to bytes
            var parts = _PROXY_HOST.split('.');
            if (parts.length !== 4) return false; // IPv6 proxy not supported in simple mode
            // Rewrite as AF_INET sockaddr pointing to proxy
            sa.writeU16(AF_INET); // sa_family = AF_INET
            sa.add(2).writeU8((_PROXY_PORT >> 8) & 0xFF);
            sa.add(3).writeU8(_PROXY_PORT & 0xFF);
            sa.add(4).writeU8(parseInt(parts[0]));
            sa.add(5).writeU8(parseInt(parts[1]));
            sa.add(6).writeU8(parseInt(parts[2]));
            sa.add(7).writeU8(parseInt(parts[3]));
            return true;
        } catch (_) { return false; }
    }

    (function hookConnect() {
        try {
            var connectPtr = Module.findExportByName('libc.so', 'connect') ||
                             Module.findExportByName(null, 'connect');
            if (!connectPtr) return;

            Interceptor.attach(connectPtr, {
                onEnter: function (args) {
                    this._sa      = args[1];
                    this._addrLen = args[2].toInt32();
                    this._redirect = false;

                    try {
                        var sa = this._sa;
                        if (!sa || sa.isNull()) return;

                        var addr4 = parseSockaddrIn(sa);
                        var addr6  = addr4 ? null : parseSockaddrIn6(sa);
                        var parsed = addr4 || addr6;

                        if (!parsed) return;
                        if (isIgnoredPort(parsed.port)) return;

                        // Only redirect HTTP/HTTPS and common app ports
                        var httpPorts = [80, 443, 8080, 8443, 8000, 8888, 3000, 4000, 5000];
                        var shouldRedirect = httpPorts.indexOf(parsed.port) !== -1;

                        if (shouldRedirect) {
                            if (rewriteSockaddrToProxy(sa, this._addrLen)) {
                                this._redirect = true;
                                _log.debug('nativeConnect: redirected port ' + parsed.port + ' → proxy ' + _PROXY_HOST + ':' + _PROXY_PORT);
                            }
                        }
                    } catch (_) {}
                }
            });
            _hookCount++;
            _log.ok('nativeConnect: connect() proxy redirect active → ' + _PROXY_HOST + ':' + _PROXY_PORT);
        } catch (e) { _failCount++; _log.debug('nativeConnect: connect hook — ' + e); }
    })();

    console.log('[*] native-connect-hook: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('native-connect-hook.js loaded');
})();
} catch (e) { console.log('[!!!] Module "native-connect-hook" failed to load: ' + e.message); }

// ═══ lib/integrity-bypass.js ═══
try {
/**
 * lib/integrity-bypass.js — Signature / Tampering / Anti-Kill Bypass
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Defeats APK signature verification, hash/CRC checks, and app-termination.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: RASP_auditor module 09
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('integrity', 'Signature/Tampering/Anti-Kill');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.integrity === false) return;

    var _hookCount = 0;
    var _failCount = 0;

    var ORIGINAL_INSTALLER = _CFG.originalInstaller || 'com.android.vending';

    var _cachedSig     = null;
    var _cachedSigHash = null;
    var _cachedSigStr  = null;

    // 1. PackageManager.getPackageInfo — cache original signatures
    (function hookGetPackageInfo() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var PackageManager = Java.use('android.app.ApplicationPackageManager');
                var GET_SIGNATURES           = 64;
                var GET_SIGNING_CERTIFICATES = 134217728;

                PackageManager.getPackageInfo.overload('java.lang.String', 'int').implementation = function (pkg, flags) {
                    var pi = this.getPackageInfo(pkg, flags);
                    if ((flags & GET_SIGNATURES) !== 0 || (flags & GET_SIGNING_CERTIFICATES) !== 0) {
                        if (pi && pi.signatures && pi.signatures.value && !_cachedSig) {
                            _cachedSig = pi.signatures.value;
                            if (_cachedSig && _cachedSig.length > 0) {
                                _cachedSigHash = _cachedSig[0].hashCode();
                                _cachedSigStr  = _cachedSig[0].toCharsString();
                            }
                        }
                    }
                    return pi;
                };
                _hookCount++;
                _log.ok('integrity: PackageManager.getPackageInfo() signature caching active');
            } catch (e) { _failCount++; _log.debug('integrity: getPackageInfo hook — ' + e); }
        });
    })();

    // 2. Signature.hashCode() / toCharsString() — return cached original
    (function hookSignature() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var Signature = Java.use('android.content.pm.Signature');
                Signature.hashCode.implementation = function () {
                    if (_cachedSigHash !== null) return _cachedSigHash;
                    return this.hashCode();
                };
                Signature.toCharsString.implementation = function () {
                    if (_cachedSigStr !== null) return _cachedSigStr;
                    return this.toCharsString();
                };
                _hookCount++;
                _log.ok('integrity: Signature hooks active');
            } catch (e) { _failCount++; _log.debug('integrity: Signature hook — ' + e); }
        });
    })();

    // 3. MessageDigest.digest() — cache first result per algorithm
    (function hookMessageDigest() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var MessageDigest = Java.use('java.security.MessageDigest');
                var _cache = {};
                MessageDigest.digest.overload().implementation = function () {
                    var algo   = this.getAlgorithm();
                    var result = this.digest();
                    if (!_cache[algo]) _cache[algo] = result;
                    return _cache[algo];
                };
                _hookCount++;
                _log.ok('integrity: MessageDigest.digest() caching active');
            } catch (e) { _failCount++; _log.debug('integrity: MessageDigest hook — ' + e); }
        });
    })();

    // 4. CRC32.getValue() — cache first checksum
    (function hookCRC32() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var CRC32 = Java.use('java.util.zip.CRC32');
                var _crc_cache = null;
                CRC32.getValue.implementation = function () {
                    var val = this.getValue();
                    if (_crc_cache === null) _crc_cache = val;
                    return _crc_cache;
                };
                _hookCount++;
                _log.ok('integrity: CRC32.getValue() caching active');
            } catch (e) { _failCount++; _log.debug('integrity: CRC32 hook — ' + e); }
        });
    })();

    // 5. getInstallerPackageName() → Play Store
    (function hookInstaller() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var PM = Java.use('android.app.ApplicationPackageManager');
                PM.getInstallerPackageName.implementation = function (_pkg) {
                    return ORIGINAL_INSTALLER;
                };
                _log.ok('integrity: getInstallerPackageName() → ' + ORIGINAL_INSTALLER);
            } catch (e) { _failCount++; _log.debug('integrity: getInstallerPackageName hook — ' + e); }

            try {
                var PM2 = Java.use('android.app.ApplicationPackageManager');
                PM2.getInstallSourceInfo.implementation = function (pkg) {
                    var info = this.getInstallSourceInfo(pkg);
                    try {
                        var InstallSourceInfo = Java.use('android.content.pm.InstallSourceInfo');
                        return InstallSourceInfo.$new(
                            ORIGINAL_INSTALLER, null, ORIGINAL_INSTALLER, null
                        );
                    } catch (_) { return info; }
                };
                _log.ok('integrity: getInstallSourceInfo() → Play Store');
            } catch (e) { _failCount++; _log.debug('integrity: getInstallSourceInfo hook — ' + e); }
        });
    })();

    // 6. Anti-termination: block app shutdown triggered by integrity checks
    (function hookAntiTermination() {
        if (!Java.available) return;
        Java.perform(function () {
            var antiTermMethods = [
                { cls: 'java.lang.System',            method: 'exit',                    args: ['int'] },
                { cls: 'android.os.Process',          method: 'killProcess',             args: ['int'] },
                { cls: 'java.lang.Runtime',           method: 'exit',                    args: ['int'] },
                { cls: 'android.app.Activity',        method: 'finish',                  args: [] },
                { cls: 'android.app.ActivityManager', method: 'killBackgroundProcesses', args: ['java.lang.String'] }
            ];

            antiTermMethods.forEach(function (entry) {
                try {
                    var cls    = Java.use(entry.cls);
                    var method = entry.args.length > 0
                        ? cls[entry.method].overload.apply(cls[entry.method], entry.args)
                        : cls[entry.method];
                    method.implementation = function () {
                        _log.info('integrity: blocked ' + entry.cls + '.' + entry.method + '()');
                    };
                } catch (e) { _failCount++; _log.debug('integrity: anti-termination ' + entry.method + ' — ' + e); }
            });
            _hookCount++;
            _log.ok('integrity: anti-termination hooks active');
        });
    })();

    // 7. Native libcrypto hash monitoring
    (function monitorNativeHashes() {
        try {
            var sha256FinalPtr = Module.findExportByName('libcrypto.so', 'SHA256_Final');
            if (!sha256FinalPtr) return;
            Interceptor.attach(sha256FinalPtr, {
                onLeave: function () { _log.debug('integrity: SHA256_Final called'); }
            });
        } catch (e) { _failCount++; _log.debug('integrity: native hash monitor — ' + e); }
    })();

    console.log('[*] integrity-bypass: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('integrity-bypass.js loaded');
})();
} catch (e) { console.log('[!!!] Module "integrity-bypass" failed to load: ' + e.message); }

// ═══ lib/attestation-bypass.js ═══
try {
/**
 * lib/attestation-bypass.js — SafetyNet / Play Integrity Spoofing
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Spoofs SafetyNet, Play Integrity, Key Attestation, and Bootloader state.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: RASP_auditor modules 18, 24
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('attestation', 'SafetyNet/Play Integrity Spoofing');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.attestation === false) return;

    var _hookCount = 0;
    var _failCount = 0;

    var BOOT_PROPS = {
        'ro.boot.verifiedbootstate'      : 'green',
        'ro.boot.flash.locked'           : '1',
        'ro.boot.veritymode'             : 'enforcing',
        'ro.boot.warranty_bit'           : '0',
        'ro.warranty_bit'                : '0',
        'ro.debuggable'                  : '0',
        'ro.secure'                      : '1',
        'ro.build.type'                  : 'user',
        'ro.build.tags'                  : 'release-keys',
        'ro.build.keys'                  : 'release-keys',
        'ro.build.selinux'               : '1',
        'ro.boot.selinux'                : 'enforcing',
        'ro.adb.secure'                  : '1',
        'sys.usb.state'                  : 'none',
        'ro.crypto.state'                : 'encrypted',
        'ro.crypto.type'                 : 'file',
        'ro.build.version.security_patch': '2024-05-05',
        'ro.knox'                        : '0x0',
        'ro.knox.bsn'                    : ''
    };

    // 1. __system_property_get — spoof boot/build properties
    (function hookSystemPropertyGet() {
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
                    if (BOOT_PROPS[this._key] !== undefined) {
                        try { this._val.writeUtf8String(String(BOOT_PROPS[this._key])); } catch (_) {}
                    }
                }
            });
            _hookCount++;
            _log.ok('attestation: __system_property_get boot properties spoofed');
        } catch (e) { _failCount++; _log.debug('attestation: __system_property_get hook — ' + e); }
    })();

    // 2. Java SystemProperties
    (function hookJavaSystemProps() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var SP = Java.use('android.os.SystemProperties');
                SP.get.overload('java.lang.String').implementation = function (key) {
                    if (BOOT_PROPS[key] !== undefined) return String(BOOT_PROPS[key]);
                    return this.get(key);
                };
                SP.get.overload('java.lang.String', 'java.lang.String').implementation = function (key, def) {
                    if (BOOT_PROPS[key] !== undefined) return String(BOOT_PROPS[key]);
                    return this.get(key, def);
                };
                SP.getBoolean.overload('java.lang.String', 'boolean').implementation = function (key, def) {
                    if (BOOT_PROPS[key] !== undefined) return BOOT_PROPS[key] === '1' || BOOT_PROPS[key] === true;
                    return this.getBoolean(key, def);
                };
                _hookCount++;
                _log.ok('attestation: Java SystemProperties spoofed');
            } catch (e) { _failCount++; _log.debug('attestation: Java SystemProperties hook — ' + e); }
        });
    })();

    // 3. Build fields
    (function hookBuildFields() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var Build = Java.use('android.os.Build');
                Build.TAGS.value = 'release-keys';
                Build.TYPE.value = 'user';
                _hookCount++;
                _log.ok('attestation: Build.TAGS/TYPE spoofed');
            } catch (e) { _failCount++; _log.debug('attestation: Build fields — ' + e); }
        });
    })();

    // 4. SafetyNet API interception
    (function hookSafetyNet() {
        if (!Java.available) return;
        Java.perform(function () {
            var classes = [
                'com.google.android.gms.safetynet.SafetyNetApi',
                'com.google.android.gms.safetynet.SafetyNetClient'
            ];
            classes.forEach(function (cls) {
                try {
                    var c = Java.use(cls);
                    if (c.attest) {
                        c.attest.overload('com.google.android.gms.common.api.GoogleApiClient', '[B').implementation = function (client, nonce) {
                            _log.info('attestation: SafetyNet.attest() intercepted');
                            return this.attest(client, nonce);
                        };
                    }
                } catch (_) {}
            });
            _hookCount++;
            _log.ok('attestation: SafetyNet hooks applied');
        });
    })();

    // 5. Play Integrity
    (function hookPlayIntegrity() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var IntegrityManager = Java.use('com.google.android.play.core.integrity.IntegrityManager');
                IntegrityManager.requestIntegrityToken.implementation = function (request) {
                    _log.info('attestation: Play Integrity requestIntegrityToken() intercepted');
                    return this.requestIntegrityToken(request);
                };
                _hookCount++;
                _log.ok('attestation: Play Integrity hook applied');
            } catch (e) { _failCount++; _log.debug('attestation: Play Integrity — ' + e); }
        });
    })();

    // 6. DroidGuard dlopen monitoring
    (function hookDroidGuard() {
        try {
            var dlopenPtr = Module.findExportByName(null, 'dlopen');
            if (!dlopenPtr) return;
            Interceptor.attach(dlopenPtr, {
                onEnter: function (args) {
                    var path = args[0] && !args[0].isNull() ? args[0].readCString() : '';
                    if (path.indexOf('droidguard') !== -1 || path.indexOf('DroidGuard') !== -1) {
                        _log.info('attestation: DroidGuard dlopen intercepted: ' + path);
                    }
                }
            });
            _hookCount++;
            _log.ok('attestation: DroidGuard dlopen monitoring active');
        } catch (e) { _failCount++; _log.debug('attestation: DroidGuard dlopen hook — ' + e); }
    })();

    // 7. /proc/cmdline filtering — hide bootloader unlock state
    (function hookCmdline() {
        try {
            var openatPtr = Module.findExportByName(null, 'openat');
            if (!openatPtr) return;
            var _fdSet = {};

            Interceptor.attach(openatPtr, {
                onEnter: function (args) {
                    var path = safeReadStr(args[1]);
                    this._cmdline = (path === '/proc/cmdline');
                },
                onLeave: function (retval) {
                    if (this._cmdline && retval.toInt32() > 0) _fdSet[retval.toInt32()] = true;
                }
            });

            var readPtr = Module.findExportByName(null, 'read');
            if (!readPtr) return;
            Interceptor.attach(readPtr, {
                onEnter: function (args) {
                    this._fd  = args[0].toInt32();
                    this._buf = args[1];
                },
                onLeave: function (retval) {
                    var n = retval.toInt32();
                    if (n <= 0 || !_fdSet[this._fd]) return;
                    try {
                        var s = this._buf.readUtf8String(n);
                        var clean = s.replace(/androidboot\.verifiedbootstate=\w+/g, 'androidboot.verifiedbootstate=green')
                                     .replace(/androidboot\.flash\.locked=\d/g, 'androidboot.flash.locked=1');
                        if (clean !== s) {
                            this._buf.writeUtf8String(clean);
                            retval.replace(ptr(clean.length));
                        }
                    } catch (_) {}
                }
            });
            _hookCount++;
            _log.ok('attestation: /proc/cmdline boot state filtering active');
        } catch (e) { _failCount++; _log.debug('attestation: cmdline hook — ' + e); }
    })();

    console.log('[*] attestation-bypass: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('attestation-bypass.js loaded');
})();
} catch (e) { console.log('[!!!] Module "attestation-bypass" failed to load: ' + e.message); }

// ═══ lib/http3-disable.js ═══
try {
/**
 * lib/http3-disable.js — HTTP/3 QUIC Blocking
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Blocks HTTP/3 (QUIC over UDP) to force HTTP/1.1 or HTTP/2 which
 * can be intercepted by standard proxies.
 * Works standalone OR via config.js orchestrator.
 *
 * Source: meta-apps-ssl-pinning/fb_ssl_hooks_v2.js disableHTTP3()
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

    if (typeof BYPASS_BUS !== 'undefined') BYPASS_BUS.registerModule('http3Disable', 'HTTP/3 QUIC Blocking');
    if (typeof BYPASS_BUS !== 'undefined' && BYPASS_BUS.enabled.http3Disable === false) return;

    var _hookCount = 0;
    var _failCount = 0;

    if (_CFG.BLOCK_HTTP3 === false) {
        _log.debug('http3Disable: BLOCK_HTTP3=false, skipping');
        return;
    }

    var AF_INET   = 2;
    var AF_INET6  = 10;
    var SOCK_DGRAM = 2;  // UDP
    var QUIC_PORT  = 443;
    var ECONNREFUSED = 111;
    var IPPROTO_QUIC = 261; // approximate; varies

    // Track UDP sockets
    var _udpSockets = {};

    // 1. socket() — track UDP socket creation
    (function hookSocket() {
        try {
            var socketPtr = Module.findExportByName('libc.so', 'socket') ||
                            Module.findExportByName(null, 'socket');
            if (!socketPtr) return;
            Interceptor.attach(socketPtr, {
                onEnter: function (args) {
                    this._family = args[0].toInt32();
                    this._type   = args[1].toInt32() & 0xF; // mask SOCK_NONBLOCK etc
                },
                onLeave: function (retval) {
                    var fd = retval.toInt32();
                    if (fd > 0 && this._type === SOCK_DGRAM &&
                       (this._family === AF_INET || this._family === AF_INET6)) {
                        _udpSockets[fd] = true;
                    }
                }
            });
            _hookCount++;
        } catch (e) { _failCount++; _log.debug('http3Disable: socket hook — ' + e); }
    })();

    // 2. connect() — block UDP connects on port 443 (QUIC)
    (function hookConnect() {
        try {
            var connectPtr = Module.findExportByName('libc.so', 'connect') ||
                             Module.findExportByName(null, 'connect');
            if (!connectPtr) return;
            Interceptor.attach(connectPtr, {
                onEnter: function (args) {
                    var fd = args[0].toInt32();
                    if (!_udpSockets[fd]) return;
                    try {
                        var sa   = args[1];
                        var port = (sa.add(2).readU8() << 8) | sa.add(3).readU8();
                        if (port === QUIC_PORT) this._blockQuic = true;
                    } catch (_) {}
                },
                onLeave: function (retval) {
                    if (this._blockQuic) {
                        retval.replace(ptr(-ECONNREFUSED));
                        _log.debug('http3Disable: blocked QUIC UDP connect on port 443');
                    }
                }
            });
            _hookCount++;
            _log.ok('http3Disable: connect() UDP/443 QUIC blocking active');
        } catch (e) { _failCount++; _log.debug('http3Disable: connect hook — ' + e); }
    })();

    // 3. sendto() — block UDP sends on port 443
    (function hookSendto() {
        try {
            var sendtoPtr = Module.findExportByName('libc.so', 'sendto') ||
                            Module.findExportByName(null, 'sendto');
            if (!sendtoPtr) return;
            Interceptor.attach(sendtoPtr, {
                onEnter: function (args) {
                    var fd = args[0].toInt32();
                    if (!_udpSockets[fd]) return;
                    try {
                        var sa = args[4]; // const struct sockaddr *dest_addr
                        if (!sa || sa.isNull()) return;
                        var port = (sa.add(2).readU8() << 8) | sa.add(3).readU8();
                        if (port === QUIC_PORT) this._blockQuic = true;
                    } catch (_) {}
                },
                onLeave: function (retval) {
                    if (this._blockQuic) retval.replace(ptr(-ECONNREFUSED));
                }
            });
            _hookCount++;
            _log.ok('http3Disable: sendto() UDP/443 QUIC blocking active');
        } catch (e) { _failCount++; _log.debug('http3Disable: sendto hook — ' + e); }
    })();

    // 4. setsockopt() — block IPPROTO_QUIC socket options
    (function hookSetsockopt() {
        try {
            var setsockoptPtr = Module.findExportByName('libc.so', 'setsockopt') ||
                                Module.findExportByName(null, 'setsockopt');
            if (!setsockoptPtr) return;
            Interceptor.attach(setsockoptPtr, {
                onEnter: function (args) {
                    var level = args[1].toInt32();
                    if (level === IPPROTO_QUIC) this._blockQuic = true;
                },
                onLeave: function (retval) {
                    if (this._blockQuic) retval.replace(ptr(-1));
                }
            });
            _hookCount++;
        } catch (e) { _failCount++; _log.debug('http3Disable: setsockopt hook — ' + e); }
    })();

    // 5. Java: OkHttpClient.Builder.protocols() — filter out HTTP/3
    (function hookOkHttpProtocols() {
        if (!Java.available) return;
        Java.perform(function () {
            try {
                var OkHttpBuilder = Java.use('okhttp3.OkHttpClient$Builder');
                var Protocol      = Java.use('okhttp3.Protocol');
                var ArrayList     = Java.use('java.util.ArrayList');

                OkHttpBuilder.protocols.implementation = function (protocols) {
                    var filtered = ArrayList.$new();
                    for (var i = 0; i < protocols.size(); i++) {
                        var p = protocols.get(i);
                        // Keep only HTTP/1.1 and HTTP/2
                        if (p.toString().indexOf('h3') === -1 &&
                            p.toString().indexOf('quic') === -1) {
                            filtered.add(p);
                        }
                    }
                    return this.protocols(filtered);
                };
                _hookCount++;
                _log.ok('http3Disable: OkHttp HTTP/3 protocol filtering active');
            } catch (e) { _failCount++; _log.debug('http3Disable: OkHttp protocols hook — ' + e); }
        });
    })();

    console.log('[*] http3-disable: ' + _hookCount + ' hooks installed, ' + _failCount + ' failed');
    _log.ok('http3-disable.js loaded');
})();
} catch (e) { console.log('[!!!] Module "http3-disable" failed to load: ' + e.message); }

// ═══ lib/syscall-bypass.js ═══
try {
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
} catch (e) { console.log('[!!!] Module "syscall-bypass" failed to load: ' + e.message); }

// ═══ lib/anti-frida-bypass.js ═══
try {
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
} catch (e) { console.log('[!!!] Module "anti-frida-bypass" failed to load: ' + e.message); }


// REPL helpers
// ─────────────────────────────────────────────────────────────────────────
function bypassStatus()  { BYPASS_BUS.status(); }
function bypassReport()  { BYPASS_BUS.status(); console.log(JSON.stringify(BYPASS_CONFIG, null, 2)); }

// RPC exports
rpc.exports = {
    status: function () {
        var r = {};
        Object.keys(BYPASS_CONFIG.modules).forEach(function (k) { r[k] = BYPASS_CONFIG.modules[k]; });
        return r;
    },
    setProxy: function (host, port, type) {
        BYPASS_CONFIG.proxy.host = host || '127.0.0.1';
        BYPASS_CONFIG.proxy.port = port || 8080;
        BYPASS_CONFIG.proxy.type = type || 'HTTP';
        PROXY_HOST = BYPASS_CONFIG.proxy.host;
        PROXY_PORT = BYPASS_CONFIG.proxy.port;
        return 'proxy → ' + PROXY_HOST + ':' + PROXY_PORT;
    },
    setSilent:     function (v) { BYPASS_CONFIG.silent = !!v; return 'silent=' + v; },
    setDebug:      function (v) { BYPASS_CONFIG.debug  = !!v; DEBUG_MODE = !!v; return 'debug=' + v; },
    enableModule:  function (k) { BYPASS_CONFIG.modules[k] = true;  BYPASS_BUS.enabled[k] = true;  return k + ' enabled'; },
    disableModule: function (k) { BYPASS_CONFIG.modules[k] = false; BYPASS_BUS.enabled[k] = false; return k + ' disabled'; }
};
