# RASP Bypass Toolkit — Development Checklist

## Project Status: ✅ COMPLETE

---

## Core Infrastructure

- [x] `lib/utils.js` — Shared utilities (BYPASS_UTILS global)
  - [x] `safeReadStr(ptr)` — null-safe UTF8/CString reader
  - [x] `findExport(module, symbol)` — safe Module.findExportByName
  - [x] `findAppId()` — ActivityThread packageName extraction
  - [x] `hookJava(class, method, impl, overloads)` — safe Java hook wrapper
  - [x] `hookNative(module, symbol, callbacks)` — safe Interceptor.attach
  - [x] `replaceNative(module, symbol, ret, args, impl)` — safe Interceptor.replace
  - [x] `classExists(className)` — try Java.use boolean
  - [x] `waitForModule(name, timeout)` — Promise-based module wait
  - [x] `rateLimit(key, fn, threshold)` — rate-limited logging
  - [x] `log.ok/hit/fail/info/debug` — ANSI-colored logging

- [x] `config.js` — Orchestrator
  - [x] `BYPASS_CONFIG` operator configuration object
  - [x] `BYPASS_BUS` shared communication bus
  - [x] `registerModule(id, name)` — module self-registration
  - [x] `bypassStatus()` / `bypassReport()` REPL helpers
  - [x] `rpc.exports` for programmatic access
  - [x] Auto-detection of Flutter apps

---

## Bypass Modules

- [x] `lib/00_stealth.js` — Anti-Detection Foundation
  - [x] `/proc/self/maps` openat+read filtering
  - [x] Thread name masking via prctl PR_SET_NAME
  - [x] Port 27042 connect() ECONNREFUSED block
  - [x] D-Bus recvfrom() filtering
  - [x] access() Frida file hiding
  - [x] dlopen() Frida .so filtering
  - [x] inotify_add_watch suppression
  - [x] Java File.exists() Frida path filter
  - [x] ActivityManager.getRunningAppProcesses() filtering

- [x] `lib/01_root_bypass.js` — Root/Magisk/KernelSU
  - [x] Java File.exists() + canExecute() for 32+ su paths
  - [x] Runtime.exec() su command blocking
  - [x] RootBeer library hooks (isRooted, detectRootManagementApps, etc.)
  - [x] Build.TAGS → release-keys
  - [x] SystemProperties ro.build.tags/ro.debuggable/ro.secure
  - [x] PackageManager: hide su management apps
  - [x] Native access()/stat() ENOENT for root paths
  - [x] __system_property_get native spoofing
  - [x] BufferedReader.readLine() build.prop filter

- [x] `lib/02_frida_bypass.js` — Frida Detection Bypass
  - [x] /proc/self/maps string matching defeat
  - [x] dlopen()/dl_iterate_phdr artifact filtering
  - [x] Class.forName() re.frida.* block
  - [x] process_vm_readv monitoring
  - [x] connect() port 27042 block
  - [x] cmdline openat filtering
  - [x] pthread thread name hiding
  - [x] inotify_add_watch suppression

- [x] `lib/03_debugger_bypass.js` — Debugger/ptrace
  - [x] ptrace(PTRACE_TRACEME) → 0
  - [x] /proc/self/status TracerPid → 0
  - [x] prctl PR_SET_DUMPABLE → 1
  - [x] sigaction SIGTRAP monitoring
  - [x] Debug.isDebuggerConnected() → false
  - [x] VMDebug.isDebuggingEnabled() → false
  - [x] getppid() → 1 (init)

- [x] `lib/04_hook_detection.js` — Hook Detection Countermeasures
  - [x] Thread.getStackTrace() Frida frame removal
  - [x] Throwable.getStackTrace() Frida frame removal
  - [x] dladdr() GOT/PLT spoofing
  - [x] RASP Log.e() telemetry suppression
  - [x] System.exit() no-op from RASP paths
  - [x] Process.killProcess() no-op from RASP paths
  - [x] Runtime.exit() no-op from RASP paths
  - [x] Activity.finish() no-op from RASP paths

- [x] `lib/05_ssl_bypass.js` — Universal SSL Unpinning
  - [x] javax.net.ssl.X509TrustManager.checkServerTrusted
  - [x] SSLContext.init() with permissive TrustManager
  - [x] HttpsURLConnection setSSLSocketFactory/setHostnameVerifier
  - [x] OkHttp3 CertificatePinner.check (all overloads + check$okhttp)
  - [x] Android built-in OkHttp CertificatePinner
  - [x] Conscrypt TrustManagerImpl.verifyChain + CertPinManager
  - [x] Trustkit PinningTrustManager.checkServerTrusted
  - [x] CWAC-Netsecurity CertPinManager
  - [x] NetworkSecurityTrustManager + NetworkSecurityPolicy
  - [x] PhoneGap/Cordova sslCertificateChecker
  - [x] IBM WorkLight pinTrustedCertificatePublicKey
  - [x] CertPathValidator.validate()
  - [x] WebView onReceivedSslError → proceed
  - [x] BoringSSL SSL_CTX_set_custom_verify (native)
  - [x] BoringSSL SSL_set_custom_verify (native)
  - [x] BoringSSL SSL_get_verify_result → X509_V_OK
  - [x] Auto-fallback SSLPeerUnverifiedException patcher
  - [x] Auto-fallback CertificateException patcher
  - [x] Meta proxygen verifyWithMetrics (native)

- [x] `lib/06_ssl_flutter.js` — Flutter/BoringSSL
  - [x] Export-based: ssl_verify_peer_cert + SSL_CTX_set_custom_verify
  - [x] ARM64 byte pattern scanning (4 patterns)
  - [x] ARM Thumb byte patterns
  - [x] x64 byte patterns
  - [x] x86 byte pattern
  - [x] Interceptor.replace with NativeCallback → 0
  - [x] waitForModule retry loop (20 retries × 500ms)
  - [x] Android bypass mode (r-x range scan)

- [x] `lib/07_ssl_ca_inject.js` — System CA Injection
  - [x] Load cert from file or base64
  - [x] buildX509CertificateFromBytes() parser
  - [x] KeyStore.getInstance("AndroidCAStore") injection
  - [x] TrustManagerFactory wrapping
  - [x] SSLContext.setDefault() replacement
  - [x] WebView onReceivedSslError → proceed
  - [x] SSL_CTX_load_verify_locations monitoring
  - [x] opendir cacerts spoofing

- [x] `lib/08_proxy_override.js` — Proxy Force Override
  - [x] System.getProperty http.proxyHost/Port override
  - [x] ProxySelector.select() always returns our proxy
  - [x] Proxy.NO_PROXY field replacement
  - [x] OkHttpClient.Builder.build() proxy injection
  - [x] Settings.Global http_proxy spoofing
  - [x] NetworkSecurityPolicy.isCleartextTrafficPermitted → true

- [x] `lib/09_integrity_bypass.js` — Integrity/Tampering
  - [x] PackageManager.getPackageInfo signature caching
  - [x] Signature.hashCode() / toCharsString() return cached
  - [x] MessageDigest.digest() first-run caching
  - [x] CRC32.getValue() first-run caching
  - [x] getInstallerPackageName() → Play Store
  - [x] getInstallSourceInfo() (Android 11+)
  - [x] System.exit() / Process.killProcess() / Runtime.exit() / Activity.finish() no-op
  - [x] ActivityManager.killBackgroundProcesses() no-op
  - [x] SHA256_Final monitoring

- [x] `lib/10_env_bypass.js` — Environment Detection
  - [x] Build.* field spoofing (Pixel 5 values)
  - [x] Build.VERSION spoofing
  - [x] TelephonyManager IMEI/IMSI spoofing
  - [x] Emulator file access() blocking (/dev/qemu_pipe etc.)
  - [x] VPN NetworkInterface filtering (tun/ppp/tap)
  - [x] NetworkCapabilities TRANSPORT_VPN hidden
  - [x] Developer mode Settings.Secure/Global spoofing
  - [x] Accessibility service hiding
  - [x] FLAG_SECURE bypass
  - [x] getifaddrs() monitoring

- [x] `lib/11_attestation.js` — Attestation Spoofing
  - [x] __system_property_get 50+ boot properties
  - [x] Java SystemProperties.get() / getBoolean()
  - [x] Build.TAGS/TYPE spoofing
  - [x] SafetyNet.attest() interception
  - [x] Play Integrity requestIntegrityToken() interception
  - [x] DroidGuard dlopen monitoring
  - [x] /proc/cmdline boot state filtering
  - [x] Samsung KNOX property spoofing
  - [x] Xiaomi/Huawei properties

---

## Unified Loader

- [x] `bypass.js` — Single-file all-in-one loader
  - [x] Embeds all module code inline
  - [x] Default BYPASS_CONFIG
  - [x] BYPASS_BUS inline
  - [x] All 12 modules concatenated
  - [x] Auto-detection (Flutter)
  - [x] bypassStatus() / bypassReport() REPL helpers
  - [x] rpc.exports for Python/automation

---

## Profiles

- [x] `profiles/banking.js` — Banking (max stealth, all modules)
- [x] `profiles/flutter.js` — Flutter (flutter forced, ssl, stealth)
- [x] `profiles/meta.js` — Meta apps (proxygen, HTTP/3 disable, auto-detect)

---

## Documentation

- [x] `README.md` — Comprehensive documentation
  - [x] Badges
  - [x] Quick Start (3 commands)
  - [x] Architecture diagram
  - [x] Module descriptions table
  - [x] Usage examples
  - [x] Configuration reference
  - [x] Supported pinning libraries (23 entries)
  - [x] Supported RASP SDKs table
  - [x] Acknowledgments
  - [x] Disclaimer + License

- [x] `CHECKLIST.md` — This file

---

## Design Compliance

- [x] JavaScript only (var preferred for compat)
- [x] No external dependencies
- [x] Standalone detection: `var _STANDALONE = (typeof BYPASS_BUS === 'undefined')`
- [x] IIFE wrapping for namespace isolation
- [x] try/catch around all hook installations
- [x] `Java.available` guard around all `Java.perform()` blocks
- [x] `safeReadStr()` for all native string reads
- [x] Silent by default (zero output in production)
- [x] Dual-mode modules (standalone + orchestrated)
- [x] Auto-detection (Flutter, Meta apps)
- [x] Stealth-first design
