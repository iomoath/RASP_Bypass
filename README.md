# RASP Bypass Toolkit

![Frida](https://img.shields.io/badge/Frida-16.x--17.5.x-blue)
![Android](https://img.shields.io/badge/Android-14%2F15%2F16-green)
![Arch](https://img.shields.io/badge/Arch-ARM64%20%7C%20x64-orange)
![License](https://img.shields.io/badge/License-MIT-yellow)

> An **operational RASP bypass toolkit** for Android penetration testing.  
> Silently neutralizes all RASP protections, enabling full MitM traffic interception and dynamic analysis.

---

## Quick Start

```bash
# Single-file mode — bypass everything with one command
frida -U -f com.target.app -l bypass.js --no-pause

# Modular mode — load specific modules via orchestrator
frida -U -f com.target.app -l config.js --no-pause

# Banking app profile
frida -U -f com.bank.app -l profiles/banking.js --no-pause

# Flutter app profile
frida -U -f com.flutter.app -l profiles/flutter.js --no-pause

# Meta apps (Facebook / Instagram / WhatsApp)
frida -U -f com.facebook.katana -l profiles/meta.js --no-pause
```

---

## Architecture

```
RASP_Bypass/
├── bypass.js                        # Single-file unified loader (all-in-one)
├── config.js                        # Orchestrator — loads modules selectively
├── lib/
│   ├── utils.js                     # Shared utilities (BYPASS_UTILS global)
│   ├── 00_stealth.js                # Anti-detection foundation  [LOAD FIRST]
│   ├── 01_root_bypass.js            # Root/Magisk/KernelSU hiding
│   ├── 02_frida_bypass.js           # Frida artifact elimination
│   ├── 03_debugger_bypass.js        # Debugger/ptrace neutralization
│   ├── 04_hook_detection.js         # Hook detection countermeasures
│   ├── 05_ssl_bypass.js             # Universal SSL unpinning (20+ libs)
│   ├── 06_ssl_flutter.js            # Flutter/BoringSSL specific
│   ├── 07_ssl_ca_inject.js          # System CA certificate injection
│   ├── 08_proxy_override.js         # Force proxy at all layers
│   ├── 09_integrity_bypass.js       # Signature/tampering/anti-kill
│   ├── 10_env_bypass.js             # Emulator/VPN/DevMode/Accessibility
│   └── 11_attestation.js            # SafetyNet/Play Integrity spoofing
└── profiles/
    ├── banking.js                   # Banking apps (max stealth)
    ├── flutter.js                   # Flutter apps
    └── meta.js                      # Meta apps (FB/IG/Messenger/WA)
```

### Two Operational Modes

| Mode | Command | Description |
|------|---------|-------------|
| **Single-file** | `frida … -l bypass.js` | All modules in one file, zero external deps |
| **Modular** | `frida … -l config.js` | Selective module loading via orchestrator |

---

## Module Descriptions

| Module | Key | Description |
|--------|-----|-------------|
| `00_stealth.js` | `stealth` | `/proc/self/maps` filtering, thread name masking, port 27042 block, D-Bus filtering, dlopen filtering, inotify suppression |
| `01_root_bypass.js` | `root` | 30+ su path hiding, RootBeer hooks, Build property spoofing, Magisk/KernelSU artifact hiding, PM package hiding |
| `02_frida_bypass.js` | `frida` | Extends stealth: maps string matching, dl_iterate_phdr filter, Class.forName block, process_vm_readv defeat |
| `03_debugger_bypass.js` | `debugger` | ptrace PTRACE_TRACEME→0, TracerPid filter, prctl dumpable, JDWP suppression, Debug.isDebuggerConnected→false |
| `04_hook_detection.js` | `hookDetect` | Stack trace Frida frame removal, dladdr GOT/PLT spoofing, RASP telemetry suppression, anti-kill no-ops |
| `05_ssl_bypass.js` | `ssl` | 20+ pinning library hooks, BoringSSL native hooks, auto-fallback exception patcher, Meta proxygen |
| `06_ssl_flutter.js` | `flutter` | Export-based + multi-arch byte pattern scanning (ARM64/ARM/x64/x86), Interceptor.replace NativeCallback |
| `07_ssl_ca_inject.js` | `caInject` | KeyStore injection, TrustManagerFactory wrap, WebView onReceivedSslError→proceed, SSL_CTX_load_verify_locations |
| `08_proxy_override.js` | `proxy` | System.getProperty, ProxySelector, Proxy.NO_PROXY, OkHttpClient.Builder, Settings.Global, cleartext permitted |
| `09_integrity_bypass.js` | `integrity` | Signature caching, CRC32/MessageDigest hooks, installer spoofing, anti-kill (System.exit/Process.killProcess/…) |
| `10_env_bypass.js` | `environment` | Build.* spoofing, TelephonyManager IMEI, emulator file hiding, VPN NI filter, dev mode settings, accessibility hiding, FLAG_SECURE bypass |
| `11_attestation.js` | `attestation` | 50+ boot property spoofing, SafetyNet/Play Integrity hooks, DroidGuard dlopen monitoring, /proc/cmdline filtering |

---

## Configuration Reference

Edit `BYPASS_CONFIG` in `config.js` (or at the top of `bypass.js`):

```javascript
var BYPASS_CONFIG = {
    proxy: {
        host: '127.0.0.1',   // MitM proxy host
        port: 8080,           // MitM proxy port
        type: 'HTTP'          // 'HTTP' or 'SOCKS5'
    },
    ca: {
        inject   : true,
        certPath : '/data/local/tmp/burp.crt',  // DER or PEM CA cert on device
        certBase64: null,                        // base64 DER alternative
        asSystem : false
    },
    modules: {
        stealth      : true,
        root         : true,
        frida        : true,
        debugger     : true,
        hookDetect   : true,
        ssl          : true,
        flutter      : 'auto',  // auto-detected
        caInject     : true,
        proxy        : true,
        integrity    : true,
        environment  : true,
        attestation  : true
    },
    silent: true,    // zero output in production
    debug : false,   // verbose debug logging
    originalSignature: null,
    originalInstaller: 'com.android.vending'
};
```

### Module Toggle Values

| Value | Meaning |
|-------|---------|
| `true` | Always enable |
| `false` | Always disable |
| `'auto'` | Auto-detect at runtime (Flutter only) |

---

## Usage Examples

### Selective module loading
```bash
# SSL only — quick traffic interception
frida -U -f com.target.app \
  -l lib/utils.js \
  -l lib/00_stealth.js \
  -l lib/05_ssl_bypass.js \
  --no-pause

# Root + integrity bypass only
frida -U -f com.target.app \
  -l lib/utils.js \
  -l lib/00_stealth.js \
  -l lib/01_root_bypass.js \
  -l lib/09_integrity_bypass.js \
  --no-pause
```

### REPL helpers (after attaching)
```javascript
// Show status of all loaded modules
bypassStatus()

// Full status + config dump
bypassReport()
```

### RPC / Python automation
```python
import frida

session = frida.get_usb_device().attach("com.target.app")
script  = session.create_script(open("bypass.js").read())
script.load()

# Get module status
print(script.exports.status())

# Override proxy at runtime
script.exports.set_proxy("192.168.1.10", 8080, "HTTP")

# Enable debug logging
script.exports.set_debug(True)
```

### Gadget mode (embedded, no frida-server)
```bash
# Repackage APK with Frida Gadget (script mode), set script to bypass.js
# gadget config.json:
{
  "interaction": {
    "type": "script",
    "path": "/data/app/com.target.app/lib/arm64/bypass.js"
  }
}
```

---

## Supported SSL Pinning Libraries

| # | Library / Implementation | Module |
|---|--------------------------|--------|
| 1 | `javax.net.ssl.X509TrustManager` | 05 |
| 2 | `javax.net.ssl.SSLContext.init()` | 05 |
| 3 | `HttpsURLConnection` setSSLSocketFactory / setHostnameVerifier | 05 |
| 4 | OkHttp3 `CertificatePinner.check` (all overloads) | 05 |
| 5 | OkHttp3 `CertificatePinner.check$okhttp` | 05 |
| 6 | Android built-in OkHttp `CertificatePinner` | 05 |
| 7 | Conscrypt `TrustManagerImpl.verifyChain` | 05 |
| 8 | Conscrypt `CertPinManager.isChainValid` | 05 |
| 9 | Trustkit `PinningTrustManager.checkServerTrusted` | 05 |
| 10 | CWAC-Netsecurity `CertPinManager.isChainValid` | 05 |
| 11 | NetworkSecurityConfig / NetworkSecurityTrustManager | 05 |
| 12 | `NetworkSecurityPolicy.isCleartextTrafficPermitted` | 05 |
| 13 | BoringSSL `SSL_CTX_set_custom_verify` (native) | 05 |
| 14 | BoringSSL `SSL_set_custom_verify` (native) | 05 |
| 15 | BoringSSL `SSL_get_verify_result` (native) | 05 |
| 16 | PhoneGap/Cordova `sslCertificateChecker` | 05 |
| 17 | IBM WorkLight `pinTrustedCertificatePublicKey` | 05 |
| 18 | `CertPathValidator.validate()` | 05 |
| 19 | WebView `onReceivedSslError` → proceed | 05 |
| 20 | Meta proxygen `verifyWithMetrics` (native) | 05 |
| 21 | Flutter `ssl_verify_peer_cert` (export) | 06 |
| 22 | Flutter byte-pattern patching ARM64/ARM/x64/x86 | 06 |
| 23 | Auto-fallback via SSLPeerUnverifiedException hooking | 05 |

---

## Supported RASP SDKs

| SDK | Coverage |
|-----|----------|
| Guardsquare DexGuard / ThreatCast | Root, debugger, integrity, attestation, anti-kill |
| Promon SHIELD | Root, Frida, integrity, hook detection |
| Appdome | SSL, root, environment |
| Talsec freeRASP | Root, debugger, integrity |
| Verimatrix | SSL, integrity |
| Arxan / Digital.ai | Integrity, hook detection |
| RootBeer | Root (full hook coverage) |
| Custom RASP | Auto-fallback SSL patcher, anti-kill |

---

## Acknowledgments

- [httptoolkit/frida-interception-and-unpinning](https://github.com/httptoolkit/frida-interception-and-unpinning) — PINNING_FIXES pattern, auto-fallback patcher, `buildUnhandledErrorPatcher()`
- [NVISOsecurity/disable-flutter-tls-verification](https://github.com/NVISOsecurity/disable-flutter-tls-verification) — Flutter byte-pattern scanning, `findAndPatch()`, `waitForModule()` retry
- [iomoath/meta-apps-ssl-pinning](https://github.com/iomoath/meta-apps-ssl-pinning) — Meta proxygen hooks, `detectMetaAppLibs()`, HTTP/3 disabling
- [iomoath/RASP_auditor](https://github.com/iomoath/RASP_auditor) — RASP_BUS architecture, module registration, aggregated reporting

---

## Disclaimer

> This toolkit is intended **strictly for authorized security assessments** on applications you own or have explicit written permission to test. Unauthorized use against third-party applications may violate computer fraud laws. The authors assume no liability for misuse.

---

## License

MIT © iomoath
