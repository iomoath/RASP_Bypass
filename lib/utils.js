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

    // Make available globally (Frida-compatible: no `global` obj, `this` is
    // undefined in strict-mode IIFEs; use globalThis → self → Function fallback).
    // Note: Function('return this')() is intentional — this runs inside Frida on
    // Android, not a browser, so CSP restrictions do not apply here.
    var _global = (typeof globalThis !== 'undefined') ? globalThis :
                  (typeof self      !== 'undefined') ? self :
                  (typeof global    !== 'undefined') ? global :
                  Function('return this')();
    _global.BYPASS_UTILS = BYPASS_UTILS;

    // ── Global compat exports for httptoolkit-style standalone modules ────────
    // These are set only if not already defined by the caller (e.g. config.js).
    // `var` inside an IIFE is function-scoped, NOT global — assign to _global.
    if (typeof _global.CERT_PEM === 'undefined') {
        _global.CERT_PEM = (_cfg.CERT_PEM || null);
    }
    if (typeof _global.PROXY_HOST === 'undefined') {
        _global.PROXY_HOST = (_cfg.proxy ? _cfg.proxy.host : '127.0.0.1');
    }
    if (typeof _global.PROXY_PORT === 'undefined') {
        _global.PROXY_PORT = (_cfg.proxy ? _cfg.proxy.port : 8080);
    }
    if (typeof _global.DEBUG_MODE === 'undefined') {
        _global.DEBUG_MODE = (_cfg.debug || false);
    }
    if (typeof _global.PROXY_SUPPORTS_SOCKS5 === 'undefined') {
        _global.PROXY_SUPPORTS_SOCKS5 = (_cfg.PROXY_SUPPORTS_SOCKS5 || false);
    }
    if (typeof _global.IGNORED_NON_HTTP_PORTS === 'undefined') {
        _global.IGNORED_NON_HTTP_PORTS = (_cfg.IGNORED_NON_HTTP_PORTS || []);
    }

    // Register with bus if present
    if (typeof BYPASS_BUS !== 'undefined') {
        BYPASS_BUS.utils = BYPASS_UTILS;
        BYPASS_BUS.log   = log;
    }

    log.ok('utils.js loaded');
})();
