/**
 * bypass.js — Unified Single-File RASP Bypass Loader
 * RASP Bypass Toolkit — https://github.com/iomoath/RASP_Bypass
 *
 * Self-contained. No external file dependencies.
 * Includes all modules inline, auto-detects target app characteristics.
 *
 * Usage:
 *   frida -U -f com.target.app -l bypass.js
 *   frida -U -f com.target.app -l bypass.js --no-pause
 *
 * To customise before loading, set BYPASS_CONFIG overrides at the top of this
 * file then re-run. All module code is concatenated below.
 */

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION — edit to taste before loading
// ═══════════════════════════════════════════════════════════════════════════
var BYPASS_CONFIG = (typeof BYPASS_CONFIG === 'undefined') ? {
    proxy: {
        host: '127.0.0.1',
        port: 8080,
        type: 'HTTP'
    },
    ca: {
        inject   : true,
        certPath : '/data/local/tmp/burp.crt',
        certBase64: null,
        asSystem : false
    },
    modules: {
        stealth      : true,
        root         : true,
        frida        : true,
        debugger     : true,
        hookDetect   : true,
        ssl          : true,
        flutter      : 'auto',
        caInject     : true,
        proxy        : true,
        integrity    : true,
        environment  : true,
        attestation  : true
    },
    silent           : true,
    debug            : false,
    originalSignature: null,
    originalInstaller: 'com.android.vending'
} : BYPASS_CONFIG;

// ═══════════════════════════════════════════════════════════════════════════
// BYPASS_BUS — shared communication bus
// ═══════════════════════════════════════════════════════════════════════════
var BYPASS_BUS = (typeof BYPASS_BUS === 'undefined') ? (function () {
    var _modules = {};
    var _enabled = {};
    Object.keys(BYPASS_CONFIG.modules).forEach(function (k) { _enabled[k] = BYPASS_CONFIG.modules[k]; });

    var _log = {
        ok   : function (m) { if (!BYPASS_CONFIG.silent) console.log('\x1b[32m[+]\x1b[0m ' + m); },
        hit  : function (m) { if (!BYPASS_CONFIG.silent) console.log('\x1b[33m[*]\x1b[0m ' + m); },
        fail : function (m) { if (!BYPASS_CONFIG.silent) console.log('\x1b[31m[-]\x1b[0m ' + m); },
        info : function (m) { if (!BYPASS_CONFIG.silent) console.log('\x1b[36m[i]\x1b[0m ' + m); },
        debug: function (m) { if (!BYPASS_CONFIG.silent && BYPASS_CONFIG.debug) console.log('\x1b[90m[d]\x1b[0m ' + m); }
    };

    return {
        enabled: _enabled, log: _log, utils: null,
        registerModule: function (id, name) {
            _modules[id] = { name: name, loaded: true };
            _log.ok('BUS: [' + id + '] ' + name);
        },
        status: function () {
            console.log('\n\x1b[36m══ RASP Bypass Status ══\x1b[0m');
            Object.keys(_modules).forEach(function (id) {
                console.log('  \x1b[32m✓\x1b[0m [' + id + '] ' + _modules[id].name);
            });
            console.log('  Total: ' + Object.keys(_modules).length + ' modules\n');
        }
    };
})() : BYPASS_BUS;

// ═══════════════════════════════════════════════════════════════════════════
// ── lib/utils.js ────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
(function () {
    var _cfg = BYPASS_CONFIG;
    var C = { reset:'\x1b[0m', green:'\x1b[32m', yellow:'\x1b[33m', red:'\x1b[31m', cyan:'\x1b[36m', grey:'\x1b[90m' };
    var _rl = {};

    function rateLimit(key, fn, threshold) {
        _rl[key] = (_rl[key] || 0) + 1;
        if (_rl[key] <= (threshold||10) || _rl[key] % (threshold||10) === 0) fn();
    }

    var log = {
        ok   : function (m) { if (!_cfg.silent) console.log(C.green  + '[+] ' + C.reset + m); },
        hit  : function (m) { if (!_cfg.silent) console.log(C.yellow + '[*] ' + C.reset + m); },
        fail : function (m) { if (!_cfg.silent) console.log(C.red    + '[-] ' + C.reset + m); },
        info : function (m) { if (!_cfg.silent) console.log(C.cyan   + '[i] ' + C.reset + m); },
        debug: function (m) { if (!_cfg.silent && _cfg.debug) console.log(C.grey + '[d] ' + C.reset + m); }
    };

    function safeReadStr(ptr) {
        if (!ptr || ptr.isNull()) return '';
        try { return ptr.readUtf8String() || ''; } catch (_) {}
        try { return ptr.readCString()    || ''; } catch (_) {}
        return '';
    }
    function findExport(mod, sym) {
        try { return Module.findExportByName(mod, sym); } catch (_) { return null; }
    }
    function findAppId() {
        var pkg = '';
        try { Java.perform(function () { try { var AT = Java.use('android.app.ActivityThread'); pkg = AT.currentApplication().getApplicationContext().getPackageName(); } catch (_) {} }); } catch (_) {}
        return pkg;
    }
    function hookJava(cls, meth, impl, types) {
        try {
            Java.perform(function () {
                var c = Java.use(cls);
                var m = types ? c[meth].overload.apply(c[meth], types) : c[meth];
                m.implementation = impl;
            });
            return true;
        } catch (e) { log.debug('hookJava ' + cls + '.' + meth + ': ' + e); return false; }
    }
    function hookNative(mod, sym, cbs) {
        try {
            var addr = findExport(mod, sym);
            if (!addr) return null;
            return Interceptor.attach(addr, cbs);
        } catch (e) { log.debug('hookNative ' + sym + ': ' + e); return null; }
    }
    function replaceNative(mod, sym, ret, args, impl) {
        try {
            var addr = findExport(mod, sym);
            if (!addr) return false;
            Interceptor.replace(addr, new NativeCallback(impl, ret, args));
            return true;
        } catch (e) { log.debug('replaceNative ' + sym + ': ' + e); return false; }
    }
    function classExists(cls) {
        var found = false;
        try { Java.perform(function () { try { Java.use(cls); found = true; } catch (_) {} }); } catch (_) {}
        return found;
    }
    function waitForModule(name, ms) {
        return new Promise(function (res, rej) {
            var d = Date.now() + (ms || 10000);
            function a() {
                var m = Process.findModuleByName(name);
                if (m) { res(m); return; }
                if (Date.now() >= d) { rej(new Error('Timeout: ' + name)); return; }
                setTimeout(a, 200);
            }
            a();
        });
    }

    var BYPASS_UTILS = { safeReadStr:safeReadStr, findExport:findExport, findAppId:findAppId,
        hookJava:hookJava, hookNative:hookNative, replaceNative:replaceNative,
        classExists:classExists, waitForModule:waitForModule, rateLimit:rateLimit, log:log };

    if (typeof global !== 'undefined') global.BYPASS_UTILS = BYPASS_UTILS;
    else this.BYPASS_UTILS = BYPASS_UTILS;
    BYPASS_BUS.utils = BYPASS_UTILS;
    BYPASS_BUS.log   = log;
})();

// ═══════════════════════════════════════════════════════════════════════════
// ── lib/00_stealth.js ───────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
(function () {
    if (BYPASS_CONFIG.modules.stealth === false) return;
    BYPASS_BUS.registerModule('00_stealth', 'Anti-Detection Foundation');

    var _u = BYPASS_UTILS;
    var _log = _u.log;
    var safeReadStr = _u.safeReadStr;

    var FRIDA_STRINGS = ['frida','gum-js-loop','gmain','gdbus','frida-agent','frida-gadget','frida-server','linjector','re.frida','/tmp/frida-','frida-helper','frida-node'];
    var FRIDA_PORTS   = [27042, 27043];

    // /proc/self/maps filtering
    try {
        var openatPtr = Module.findExportByName(null,'openat');
        var readPtr   = Module.findExportByName(null,'read');
        if (openatPtr && readPtr) {
            var _fdMapStealth = {};
            Interceptor.attach(openatPtr, {
                onEnter: function(a){ var p=safeReadStr(a[1]); this._m=(p.indexOf('/proc/self/maps')!==-1||(p.indexOf('/proc/')!==-1&&p.indexOf('/maps')!==-1)); },
                onLeave: function(r){ if(this._m&&r.toInt32()>0) _fdMapStealth[r.toInt32()]=true; }
            });
            Interceptor.attach(readPtr, {
                onEnter: function(a){ this._fd=a[0].toInt32(); this._buf=a[1]; },
                onLeave: function(r){ var n=r.toInt32(); if(n<=0||!_fdMapStealth[this._fd]) return;
                    try { var s=this._buf.readUtf8String(n); var lines=s.split('\n');
                        var f=lines.filter(function(l){ for(var i=0;i<FRIDA_STRINGS.length;i++) if(l.indexOf(FRIDA_STRINGS[i])!==-1) return false; return true; });
                        if(f.length!==lines.length){ var o=f.join('\n'); this._buf.writeUtf8String(o); r.replace(ptr(o.length)); } } catch(_){} }
            });
            _log.ok('stealth: maps filter active');
        }
    } catch(_){}

    // prctl thread name masking
    try {
        var prctlPtr=Module.findExportByName(null,'prctl');
        if(prctlPtr) Interceptor.attach(prctlPtr,{
            onEnter:function(a){ if(a[0].toInt32()!==15) return; var n=safeReadStr(a[1]);
                for(var i=0;i<FRIDA_STRINGS.length;i++) if(n.indexOf(FRIDA_STRINGS[i])!==-1){ a[1].writeUtf8String('kworker/0:'+Math.floor(Math.random()*9)); break; } }
        });
    } catch(_){}

    // connect() port 27042 block
    try {
        var connPtr=Module.findExportByName(null,'connect');
        if(connPtr) Interceptor.attach(connPtr,{
            onEnter:function(a){ try{ var sa=a[1]; var p=(sa.add(2).readU8()<<8)|sa.add(3).readU8(); if(FRIDA_PORTS.indexOf(p)!==-1) this._b=true; }catch(_){} },
            onLeave:function(r){ if(this._b) r.replace(ptr(-111)); }
        });
    } catch(_){}

    // access() Frida file hiding
    try {
        var accessPtr=Module.findExportByName(null,'access');
        if(accessPtr) Interceptor.attach(accessPtr,{
            onEnter:function(a){ var p=safeReadStr(a[0]); for(var i=0;i<FRIDA_STRINGS.length;i++) if(p.indexOf(FRIDA_STRINGS[i])!==-1){ this._b=true; break; } },
            onLeave:function(r){ if(this._b) r.replace(ptr(-2)); }
        });
    } catch(_){}

    // dlopen() filter
    try {
        var dlopenPtr=Module.findExportByName(null,'dlopen');
        if(dlopenPtr) Interceptor.attach(dlopenPtr,{
            onEnter:function(a){ var p=safeReadStr(a[0]); for(var i=0;i<FRIDA_STRINGS.length;i++) if(p.indexOf(FRIDA_STRINGS[i])!==-1){ a[0].writeUtf8String('/dev/null'); break; } }
        });
    } catch(_){}

    // inotify_add_watch suppression
    try {
        var inoPtr=Module.findExportByName(null,'inotify_add_watch');
        if(inoPtr) Interceptor.attach(inoPtr,{
            onEnter:function(a){ var p=safeReadStr(a[1]); if(p.indexOf('/proc/self/maps')!==-1||p.indexOf('/proc/self/mem')!==-1) a[1].writeUtf8String('/dev/null'); }
        });
    } catch(_){}

    // Java File.exists()
    if(Java.available) Java.perform(function(){
        try{
            var File=Java.use('java.io.File');
            File.exists.implementation=function(){ var p=this.getAbsolutePath(); for(var i=0;i<FRIDA_STRINGS.length;i++) if(p.indexOf(FRIDA_STRINGS[i])!==-1) return false; return this.exists.call(this); };
        }catch(_){}
    });

    _log.ok('00_stealth.js loaded');
})();

// ═══════════════════════════════════════════════════════════════════════════
// ── lib/01_root_bypass.js ───────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
(function () {
    if (BYPASS_CONFIG.modules.root === false) return;
    BYPASS_BUS.registerModule('01_root_bypass', 'Root/Magisk/KernelSU Bypass');

    var _log = BYPASS_UTILS.log;
    var safeReadStr = BYPASS_UTILS.safeReadStr;

    var ROOT_PATHS = ['/su','/su/bin/su','/system/bin/su','/system/xbin/su','/sbin/su','/system/su','/data/adb/magisk','/data/adb/ksu','/sbin/ksud','/sbin/.magisk','/data/adb/modules'];
    var SU_MGMT   = ['com.topjohnwu.magisk','eu.chainfire.supersu','com.koushikdutta.superuser','me.weishu.kernelsu'];

    function isSuCmd(cmd){ return cmd&&(cmd==='su'||/[\/\s]su(\s|$)/.test(cmd)||cmd==='which su'); }
    function isRoot(p){ if(!p) return false; for(var i=0;i<ROOT_PATHS.length;i++) if(p===ROOT_PATHS[i]||p.indexOf('magisk')!==-1) return true; return false; }

    if(Java.available) Java.perform(function(){
        try{
            var File=Java.use('java.io.File');
            var _origE=File.exists; var _origCE=File.canExecute;
            File.exists.implementation=function(){ return isRoot(this.getAbsolutePath())?false:this.exists.call(this); };
            File.canExecute.implementation=function(){ return isRoot(this.getAbsolutePath())?false:this.canExecute.call(this); };
        }catch(_){}

        try{
            var RT=Java.use('java.lang.Runtime');
            var IOE=Java.use('java.io.IOException');
            RT.exec.overload('java.lang.String').implementation=function(cmd){ if(isSuCmd(cmd)) throw IOE.$new('Permission denied'); return this.exec(cmd); };
        }catch(_){}

        try{
            var Build=Java.use('android.os.Build');
            Build.TAGS.value='release-keys';
        }catch(_){}

        try{
            var SP=Java.use('android.os.SystemProperties');
            SP.get.overload('java.lang.String').implementation=function(k){
                if(k==='ro.build.tags') return 'release-keys';
                if(k==='ro.debuggable') return '0';
                if(k==='ro.secure') return '1';
                return this.get(k);
            };
        }catch(_){}

        try{
            var PM=Java.use('android.app.ApplicationPackageManager');
            PM.getInstalledPackages.overload('int').implementation=function(f){
                var list=this.getInstalledPackages(f);
                var out=Java.use('java.util.ArrayList').$new();
                for(var i=0;i<list.size();i++){ var pkg=list.get(i).packageName.value; if(SU_MGMT.indexOf(pkg)===-1) out.add(list.get(i)); }
                return out;
            };
        }catch(_){}
    });

    // Native __system_property_get
    try{
        var spg=Module.findExportByName('libc.so','__system_property_get')||Module.findExportByName(null,'__system_property_get');
        if(spg) Interceptor.attach(spg,{
            onEnter:function(a){ this._k=safeReadStr(a[0]); this._v=a[1]; },
            onLeave:function(){ var o={'ro.build.tags':'release-keys','ro.debuggable':'0','ro.secure':'1'}; if(o[this._k]!==undefined) this._v.writeUtf8String(o[this._k]); }
        });
    }catch(_){}

    _log.ok('01_root_bypass.js loaded');
})();

// ═══════════════════════════════════════════════════════════════════════════
// ── lib/02_frida_bypass.js (condensed) ──────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
(function () {
    if (BYPASS_CONFIG.modules.frida === false) return;
    BYPASS_BUS.registerModule('02_frida_bypass', 'Frida Detection Bypass');
    // Core hooks already applied by 00_stealth; this module adds Java-layer
    if(Java.available) Java.perform(function(){
        try{
            var Class=Java.use('java.lang.Class');
            Class.forName.overload('java.lang.String').implementation=function(n){
                if(n.indexOf('re.frida')!==-1||n.indexOf('frida')!==-1){ var CNF=Java.use('java.lang.ClassNotFoundException'); throw CNF.$new(n); }
                return this.forName(n);
            };
        }catch(_){}
    });
    BYPASS_UTILS.log.ok('02_frida_bypass.js loaded');
})();

// ═══════════════════════════════════════════════════════════════════════════
// ── lib/03_debugger_bypass.js (condensed) ───────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
(function () {
    if (BYPASS_CONFIG.modules.debugger === false) return;
    BYPASS_BUS.registerModule('03_debugger_bypass', 'Debugger/ptrace Bypass');

    var safeReadStr = BYPASS_UTILS.safeReadStr;

    // ptrace PTRACE_TRACEME → 0
    try{
        var ptracePtr=Module.findExportByName(null,'ptrace');
        if(ptracePtr) Interceptor.attach(ptracePtr,{
            onEnter:function(a){ this._r=a[0].toInt32(); },
            onLeave:function(r){ if(this._r===0) r.replace(ptr(0)); }
        });
    }catch(_){}

    // /proc/self/status TracerPid filtering
    try{
        var oaPtr=Module.findExportByName(null,'openat');
        var rPtr=Module.findExportByName(null,'read');
        if(oaPtr&&rPtr){
            var _fdSt={};
            Interceptor.attach(oaPtr,{
                onEnter:function(a){ var p=safeReadStr(a[1]); this._s=(p.indexOf('/proc/self/status')!==-1||(p.indexOf('/proc/')!==-1&&p.indexOf('/status')!==-1)); },
                onLeave:function(r){ if(this._s&&r.toInt32()>0) _fdSt[r.toInt32()]=true; }
            });
            Interceptor.attach(rPtr,{
                onEnter:function(a){ this._fd=a[0].toInt32(); this._buf=a[1]; },
                onLeave:function(r){ var n=r.toInt32(); if(n<=0||!_fdSt[this._fd]) return;
                    try{ var s=this._buf.readUtf8String(n); var c=s.replace(/TracerPid:\s*\d+/g,'TracerPid:\t0');
                        if(c!==s){ this._buf.writeUtf8String(c); r.replace(ptr(c.length)); } }catch(_){} }
            });
        }
    }catch(_){}

    // Java: Debug.isDebuggerConnected() → false
    if(Java.available) Java.perform(function(){
        try{ var D=Java.use('android.os.Debug'); D.isDebuggerConnected.implementation=function(){ return false; }; }catch(_){}
        try{ var VD=Java.use('dalvik.system.VMDebug'); if(VD.isDebuggingEnabled) VD.isDebuggingEnabled.implementation=function(){ return false; }; }catch(_){}
    });

    BYPASS_UTILS.log.ok('03_debugger_bypass.js loaded');
})();

// ═══════════════════════════════════════════════════════════════════════════
// ── lib/04_hook_detection.js (condensed) ────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
(function () {
    if (BYPASS_CONFIG.modules.hookDetect === false) return;
    BYPASS_BUS.registerModule('04_hook_detection', 'Hook Detection Countermeasures');

    var RASP_PKGS = ['com.guardsquare','com.promon','com.appdome','talsec','com.verimatrix','arxan'];

    function isCalledFromRASP(){
        try{
            var trace=Java.use('java.lang.Thread').currentThread().getStackTrace();
            for(var i=0;i<trace.length;i++){ var cls=trace[i].getClassName(); for(var j=0;j<RASP_PKGS.length;j++) if(cls.indexOf(RASP_PKGS[j])!==-1) return true; }
        }catch(_){}
        return false;
    }

    if(Java.available) Java.perform(function(){
        // Stack trace filtering
        try{
            var T=Java.use('java.lang.Thread');
            T.getStackTrace.implementation=function(){ var t=this.getStackTrace(); var f=[]; for(var i=0;i<t.length;i++) if(t[i].getClassName().indexOf('frida')===-1) f.push(t[i]); return f; };
        }catch(_){}

        // Anti-kill
        try{ var S=Java.use('java.lang.System'); S.exit.implementation=function(c){ if(isCalledFromRASP()) return; this.exit(c); }; }catch(_){}
        try{ var P=Java.use('android.os.Process'); P.killProcess.implementation=function(p){ if(isCalledFromRASP()) return; this.killProcess(p); }; }catch(_){}
        try{ var RT=Java.use('java.lang.Runtime'); RT.exit.implementation=function(c){ if(isCalledFromRASP()) return; this.exit(c); }; }catch(_){}
        try{ var A=Java.use('android.app.Activity'); A.finish.implementation=function(){ if(isCalledFromRASP()) return; this.finish(); }; }catch(_){}
    });

    BYPASS_UTILS.log.ok('04_hook_detection.js loaded');
})();

// ═══════════════════════════════════════════════════════════════════════════
// ── lib/05_ssl_bypass.js ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
(function () {
    if (BYPASS_CONFIG.modules.ssl === false) return;
    BYPASS_BUS.registerModule('05_ssl_bypass', 'Universal SSL Unpinning');

    var _log = BYPASS_UTILS.log;

    var PINNING_FIXES = [
        {c:'javax.net.ssl.X509TrustManager',m:'checkServerTrusted',t:['[Ljava.security.cert.X509Certificate;','java.lang.String'],i:function(){}},
        {c:'okhttp3.CertificatePinner',m:'check',t:['java.lang.String','java.util.List'],i:function(){}},
        {c:'okhttp3.CertificatePinner',m:'check',t:['java.lang.String','[Ljava.security.cert.Certificate;'],i:function(){}},
        {c:'okhttp3.CertificatePinner',m:'check$okhttp',t:['java.lang.String','java.util.List'],i:function(){}},
        {c:'com.android.okhttp.CertificatePinner',m:'check',t:['java.lang.String','[Ljava.security.cert.Certificate;'],i:function(){}},
        {c:'com.android.org.conscrypt.TrustManagerImpl',m:'verifyChain',i:function(chain){ return chain; }},
        {c:'com.android.org.conscrypt.CertPinManager',m:'isChainValid',i:function(){ return true; }},
        {c:'com.datatheorem.android.trustkit.pinning.PinningTrustManager',m:'checkServerTrusted',i:function(){}},
        {c:'android.security.net.config.NetworkSecurityTrustManager',m:'checkServerTrusted',i:function(){}},
        {c:'android.security.net.config.NetworkSecurityPolicy',m:'isCleartextTrafficPermitted',i:function(){ return true; }},
        {c:'android.security.net.config.NetworkSecurityPolicy',m:'isCleartextTrafficPermitted',t:['java.lang.String'],i:function(){ return true; }},
        {c:'javax.net.ssl.HttpsURLConnection',m:'setSSLSocketFactory',t:['javax.net.ssl.SSLSocketFactory'],i:function(){}},
        {c:'javax.net.ssl.HttpsURLConnection',m:'setHostnameVerifier',t:['javax.net.ssl.HostnameVerifier'],i:function(){}},
        {c:'android.webkit.WebViewClient',m:'onReceivedSslError',t:['android.webkit.WebView','android.webkit.SslErrorHandler','android.net.http.SslError'],i:function(_w,h){ h.proceed(); }}
    ];

    if(Java.available) Java.perform(function(){
        PINNING_FIXES.forEach(function(fix){
            try{
                var cls=Java.use(fix.c);
                var meth=fix.t ? cls[fix.m].overload.apply(cls[fix.m],fix.t) : cls[fix.m];
                meth.implementation=fix.i;
                _log.ok('ssl: '+fix.c+'.'+fix.m);
            }catch(e){ _log.debug('ssl: skip '+fix.c+'.'+fix.m+' — '+e.message); }
        });

        // Auto-fallback: hook SSLPeerUnverifiedException + CertificateException
        var _patched={};
        function tryPatch(cn,mn){
            var key=cn+'#'+mn; if(_patched[key]) return;
            try{ var c=Java.use(cn); c[mn].implementation=function(){}; _patched[key]=true; _log.hit('ssl-fb: '+key); }catch(_){}
        }
        try{
            var SSLEx=Java.use('javax.net.ssl.SSLPeerUnverifiedException');
            SSLEx.$init.overload('java.lang.String').implementation=function(msg){
                var t=Java.use('java.lang.Thread').currentThread().getStackTrace();
                for(var i=2;i<Math.min(t.length,10);i++){
                    var cn=t[i].getClassName(); var mn=t[i].getMethodName();
                    if(mn.indexOf('check')!==-1||mn.indexOf('verify')!==-1||cn.indexOf('CertificatePinner')!==-1) tryPatch(cn,mn);
                }
                return this.$init(msg);
            };
        }catch(_){}
    });

    // BoringSSL native
    ['SSL_CTX_set_custom_verify','SSL_set_custom_verify','SSL_get_verify_result'].forEach(function(sym){
        try{
            var addr=Module.findExportByName(null,sym);
            if(!addr) return;
            if(sym==='SSL_get_verify_result'){ Interceptor.attach(addr,{onLeave:function(r){ r.replace(ptr(0)); }}); }
            else{ Interceptor.attach(addr,{onEnter:function(a){ if(a.length>=3) a[2]=ptr(0); }}); }
            _log.ok('ssl: BoringSSL '+sym);
        }catch(_){}
    });

    // Meta proxygen
    ['libcoldstart.so','libstartup.so','libscrollmerged.so'].forEach(function(lib){
        try{ var a=Module.findExportByName(lib,'verifyWithMetrics'); if(!a) return; Interceptor.attach(a,{onLeave:function(r){r.replace(ptr(0));}}); _log.ok('ssl: Meta '+lib); }catch(_){}
    });

    _log.ok('05_ssl_bypass.js loaded');
})();

// ═══════════════════════════════════════════════════════════════════════════
// ── lib/06_ssl_flutter.js (condensed) ───────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
(function () {
    var flutterEnabled = BYPASS_CONFIG.modules.flutter;
    if (flutterEnabled === false) return;

    // Auto-detect
    if (flutterEnabled === 'auto') {
        flutterEnabled = !!Process.findModuleByName('libflutter.so');
        if (!flutterEnabled) {
            setTimeout(function () {
                if (Process.findModuleByName('libflutter.so')) {
                    BYPASS_BUS.registerModule('06_ssl_flutter', 'Flutter/BoringSSL Bypass');
                    patchFlutter(Process.findModuleByName('libflutter.so'));
                }
            }, 2000);
            return;
        }
    }

    BYPASS_BUS.registerModule('06_ssl_flutter', 'Flutter/BoringSSL Bypass');

    var ARCH = Process.arch;
    var PATTERNS = {
        arm64:['60 0? 00 54 ?? ?? ?? ?? ?? ?? 00 94','20 0? 00 54 ?? ?? ?? ?? ?? ?? 00 94'],
        arm  :['2D E9 ?? ?? 98 40'],
        x64  :['74 ?? 48 8? ?? 48 8? ?? E8 ?? ?? ?? ??'],
        ia32 :['74 ?? 8B ?? 89 ?? E8 ?? ?? ?? ??']
    };

    function patchFlutter(mod) {
        var patched = 0;
        ['ssl_verify_peer_cert','SSL_CTX_set_custom_verify'].forEach(function(sym){
            try{
                var addr=Module.findExportByName(mod ? mod.name : null, sym);
                if(!addr) return;
                Interceptor.replace(addr, new NativeCallback(function(){ return 0; },'int',['pointer']));
                patched++;
                BYPASS_UTILS.log.ok('flutter: '+sym+' patched');
            }catch(_){}
        });
        if(patched>0) return;

        var ps = PATTERNS[ARCH] || [];
        if(mod){
            ps.forEach(function(p){ try{ Memory.scanSync(mod.base,mod.size,p).forEach(function(m){
                try{ Interceptor.replace(m.address, new NativeCallback(function(){ return 0; },'int',['pointer'])); patched++; }catch(_){} }); }catch(_){} });
        }
        BYPASS_UTILS.log.ok('flutter: patched '+patched+' via patterns');
    }

    var mod = Process.findModuleByName('libflutter.so');
    if (mod) { patchFlutter(mod); }
    else {
        var retries = 0;
        function retry() {
            retries++;
            var m = Process.findModuleByName('libflutter.so');
            if (m) { patchFlutter(m); return; }
            if (retries < 20) setTimeout(retry, 500);
            else patchFlutter(null);
        }
        setTimeout(retry, 500);
    }

    BYPASS_UTILS.log.ok('06_ssl_flutter.js loaded');
})();

// ═══════════════════════════════════════════════════════════════════════════
// ── lib/07_ssl_ca_inject.js (condensed) ─────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
(function () {
    if (BYPASS_CONFIG.modules.caInject === false || !BYPASS_CONFIG.ca.inject) return;
    BYPASS_BUS.registerModule('07_ssl_ca_inject', 'System CA Certificate Injection');

    var _log = BYPASS_UTILS.log;
    var CA_PATH = BYPASS_CONFIG.ca.certPath || '/data/local/tmp/burp.crt';

    if(Java.available) Java.perform(function(){
        try{
            var WebViewClient=Java.use('android.webkit.WebViewClient');
            WebViewClient.onReceivedSslError.implementation=function(_w,h){ h.proceed(); };
            _log.ok('ca_inject: WebView SSL errors suppressed');
        }catch(_){}

        try{
            var FileIS=Java.use('java.io.FileInputStream');
            var BAOS=Java.use('java.io.ByteArrayOutputStream');
            var CF=Java.use('java.security.cert.CertificateFactory');
            var BAIS=Java.use('java.io.ByteArrayInputStream');
            var KS=Java.use('java.security.KeyStore');
            var TMF=Java.use('javax.net.ssl.TrustManagerFactory');
            var SSLCtx=Java.use('javax.net.ssl.SSLContext');

            try{
                var fis=FileIS.$new(CA_PATH);
                var baos=BAOS.$new();
                var buf=Java.array('byte',new Array(4096).fill(0));
                var n;
                while((n=fis.read(buf))!==-1) baos.write(buf,0,n);
                fis.close();

                var cf=CF.getInstance('X.509');
                var cert=cf.generateCertificate(BAIS.$new(baos.toByteArray()));

                var ks=KS.getInstance('AndroidCAStore');
                ks.load(null,null);
                ks.setCertificateEntry('bypass_ca_'+Date.now(),cert);

                var tmf=TMF.getInstance(TMF.getDefaultAlgorithm());
                tmf.init(ks);
                var ctx=SSLCtx.getInstance('TLS');
                ctx.init(null,tmf.getTrustManagers(),null);
                SSLCtx.setDefault(ctx);
                _log.ok('ca_inject: CA injected from '+CA_PATH);
            }catch(e){ _log.debug('ca_inject: file CA injection — '+e); }
        }catch(_){}
    });

    _log.ok('07_ssl_ca_inject.js loaded');
})();

// ═══════════════════════════════════════════════════════════════════════════
// ── lib/08_proxy_override.js (condensed) ────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
(function () {
    if (BYPASS_CONFIG.modules.proxy === false) return;
    BYPASS_BUS.registerModule('08_proxy_override', 'Proxy Force Override');

    var _log = BYPASS_UTILS.log;
    var PH = BYPASS_CONFIG.proxy.host || '127.0.0.1';
    var PP = BYPASS_CONFIG.proxy.port || 8080;
    var PT = BYPASS_CONFIG.proxy.type || 'HTTP';

    if(Java.available) Java.perform(function(){
        try{
            var Sys=Java.use('java.lang.System');
            Sys.getProperty.overload('java.lang.String').implementation=function(k){
                if(k==='http.proxyHost'||k==='https.proxyHost') return PH;
                if(k==='http.proxyPort'||k==='https.proxyPort') return String(PP);
                return this.getProperty(k);
            };
            _log.ok('proxy: System.getProperty() override active');
        }catch(_){}

        try{
            var PS=Java.use('java.net.ProxySelector');
            var ISA=Java.use('java.net.InetSocketAddress');
            var Proxy=Java.use('java.net.Proxy');
            var ProxyType=Java.use('java.net.Proxy$Type');
            var AL=Java.use('java.util.ArrayList');
            var pt=PT==='SOCKS5'?ProxyType.SOCKS.value:ProxyType.HTTP.value;
            var sa=ISA.$new(PH,PP);
            var px=Proxy.$new(pt,sa);
            PS.select.implementation=function(_u){ var l=AL.$new(); l.add(px); return l; };
            _log.ok('proxy: ProxySelector override active');
        }catch(_){}

        try{
            var NSP=Java.use('android.security.net.config.NetworkSecurityPolicy');
            NSP.isCleartextTrafficPermitted.overload().implementation=function(){ return true; };
            NSP.isCleartextTrafficPermitted.overload('java.lang.String').implementation=function(){ return true; };
        }catch(_){}
    });

    _log.ok('08_proxy_override.js loaded');
})();

// ═══════════════════════════════════════════════════════════════════════════
// ── lib/09_integrity_bypass.js (condensed) ──────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
(function () {
    if (BYPASS_CONFIG.modules.integrity === false) return;
    BYPASS_BUS.registerModule('09_integrity_bypass', 'Integrity/Tampering Bypass');

    var _log = BYPASS_UTILS.log;
    var ORIG_INSTALLER = BYPASS_CONFIG.originalInstaller || 'com.android.vending';

    if(Java.available) Java.perform(function(){
        // Installer spoofing
        try{
            var PM=Java.use('android.app.ApplicationPackageManager');
            PM.getInstallerPackageName.implementation=function(){ return ORIG_INSTALLER; };
            _log.ok('integrity: installer → '+ORIG_INSTALLER);
        }catch(_){}

        // Anti-kill
        var antiKill=[
            {c:'java.lang.System',m:'exit',a:['int']},
            {c:'android.os.Process',m:'killProcess',a:['int']},
            {c:'java.lang.Runtime',m:'exit',a:['int']},
            {c:'android.app.Activity',m:'finish',a:[]}
        ];
        antiKill.forEach(function(e){
            try{
                var cls=Java.use(e.c);
                var meth=e.a.length>0?cls[e.m].overload.apply(cls[e.m],e.a):cls[e.m];
                meth.implementation=function(){ _log.hit('integrity: blocked '+e.c+'.'+e.m+'()'); };
            }catch(_){}
        });
        _log.ok('integrity: anti-kill hooks active');
    });

    _log.ok('09_integrity_bypass.js loaded');
})();

// ═══════════════════════════════════════════════════════════════════════════
// ── lib/10_env_bypass.js (condensed) ────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
(function () {
    if (BYPASS_CONFIG.modules.environment === false) return;
    BYPASS_BUS.registerModule('10_env_bypass', 'Environment Detection Bypass');

    var _log = BYPASS_UTILS.log;
    var REAL = { HARDWARE:'qcom', PRODUCT:'redfin', MODEL:'Pixel 5', BRAND:'google', DEVICE:'redfin', BOARD:'redfin', FINGERPRINT:'google/redfin/redfin:14/UP1A.231005.007/10754064:user/release-keys', MANUFACTURER:'Google', TAGS:'release-keys', TYPE:'user' };
    var DEV_SETTINGS = { 'adb_enabled':'0', 'development_settings_enabled':'0', 'mock_location':'0' };

    if(Java.available) Java.perform(function(){
        // Build fields
        try{ var B=Java.use('android.os.Build'); Object.keys(REAL).forEach(function(f){ try{ B[f].value=REAL[f]; }catch(_){} }); }catch(_){}

        // Developer mode
        ['android.provider.Settings$Secure','android.provider.Settings$Global'].forEach(function(cls){
            try{
                var S=Java.use(cls);
                S.getInt.overload('android.content.ContentResolver','java.lang.String').implementation=function(cr,n){ if(DEV_SETTINGS[n]!==undefined) return parseInt(DEV_SETTINGS[n]); return this.getInt(cr,n); };
                S.getInt.overload('android.content.ContentResolver','java.lang.String','int').implementation=function(cr,n,d){ if(DEV_SETTINGS[n]!==undefined) return parseInt(DEV_SETTINGS[n]); return this.getInt(cr,n,d); };
            }catch(_){}
        });

        // Accessibility hiding
        try{
            var AM=Java.use('android.view.accessibility.AccessibilityManager');
            AM.getEnabledAccessibilityServiceList.implementation=function(){ return Java.use('java.util.ArrayList').$new(); };
            AM.isEnabled.implementation=function(){ return false; };
        }catch(_){}

        // FLAG_SECURE bypass
        try{
            var W=Java.use('android.view.Window');
            W.setFlags.implementation=function(f,m){ return this.setFlags(f&~8192,m&~8192); };
        }catch(_){}

        // VPN: NetworkCapabilities
        try{
            var NC=Java.use('android.net.NetworkCapabilities');
            NC.hasTransport.implementation=function(t){ if(t===4) return false; return this.hasTransport(t); };
        }catch(_){}

        _log.ok('10_env_bypass.js loaded');
    });
})();

// ═══════════════════════════════════════════════════════════════════════════
// ── lib/11_attestation.js (condensed) ───────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
(function () {
    if (BYPASS_CONFIG.modules.attestation === false) return;
    BYPASS_BUS.registerModule('11_attestation', 'SafetyNet/Play Integrity Spoofing');

    var _log = BYPASS_UTILS.log;
    var safeReadStr = BYPASS_UTILS.safeReadStr;

    var BOOT_PROPS = { 'ro.boot.verifiedbootstate':'green','ro.boot.flash.locked':'1','ro.debuggable':'0','ro.secure':'1','ro.build.type':'user','ro.build.tags':'release-keys','ro.adb.secure':'1' };

    // __system_property_get
    try{
        var spg=Module.findExportByName('libc.so','__system_property_get')||Module.findExportByName(null,'__system_property_get');
        if(spg) Interceptor.attach(spg,{
            onEnter:function(a){ this._k=safeReadStr(a[0]); this._v=a[1]; },
            onLeave:function(){ if(BOOT_PROPS[this._k]!==undefined) try{ this._v.writeUtf8String(String(BOOT_PROPS[this._k])); }catch(_){} }
        });
    }catch(_){}

    if(Java.available) Java.perform(function(){
        // SystemProperties
        try{
            var SP=Java.use('android.os.SystemProperties');
            SP.get.overload('java.lang.String').implementation=function(k){ if(BOOT_PROPS[k]!==undefined) return String(BOOT_PROPS[k]); return this.get(k); };
            SP.get.overload('java.lang.String','java.lang.String').implementation=function(k,d){ if(BOOT_PROPS[k]!==undefined) return String(BOOT_PROPS[k]); return this.get(k,d); };
        }catch(_){}

        try{ var B=Java.use('android.os.Build'); B.TAGS.value='release-keys'; B.TYPE.value='user'; }catch(_){}
    });

    _log.ok('11_attestation.js loaded');
})();

// ═══════════════════════════════════════════════════════════════════════════
// REPL helpers
// ═══════════════════════════════════════════════════════════════════════════
function bypassStatus() { BYPASS_BUS.status(); }
function bypassReport() { BYPASS_BUS.status(); console.log('Config:', JSON.stringify(BYPASS_CONFIG, null, 2)); }

rpc.exports = {
    status: function () { return BYPASS_CONFIG.modules; },
    setProxy: function (h,p,t) { BYPASS_CONFIG.proxy.host=h||'127.0.0.1'; BYPASS_CONFIG.proxy.port=p||8080; BYPASS_CONFIG.proxy.type=t||'HTTP'; return 'set'; },
    setSilent: function (v) { BYPASS_CONFIG.silent=!!v; return 'silent='+BYPASS_CONFIG.silent; },
    setDebug:  function (v) { BYPASS_CONFIG.debug=!!v;  return 'debug='+BYPASS_CONFIG.debug; }
};

// ── Final banner ─────────────────────────────────────────────────────────
(function () {
    if (!BYPASS_CONFIG.silent) {
        console.log('\n\x1b[36m╔══════════════════════════════════════╗\x1b[0m');
        console.log('\x1b[36m║   RASP Bypass Toolkit  — loaded       ║\x1b[0m');
        console.log('\x1b[36m║   github.com/iomoath/RASP_Bypass      ║\x1b[0m');
        console.log('\x1b[36m╚══════════════════════════════════════╝\x1b[0m\n');
    }
    BYPASS_BUS.status();
})();
