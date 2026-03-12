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
# Standalone module usage
frida -U -f com.target.app -l lib/android-ssl-pinning-bypass.js --no-pause

# Modular with specific modules
frida -U -f com.target.app \
  -l lib/utils.js \
  -l lib/stealth-frida-hiding.js \
  -l lib/android-ssl-pinning-bypass.js \
  --no-pause

# All-in-one unified loader
frida -U -f com.target.app -l bypass.js --no-pause

# With config orchestrator
frida -U -f com.target.app -l config.js --no-pause

# Profile usage
frida -U -f com.bank.app -l config.js -l profiles/banking.js --no-pause
frida -U -f com.instagram.android -l config.js -l profiles/meta.js --no-pause
frida -U -f com.flutter.app -l config.js -l profiles/flutter.js --no-pause
```

---

## Architecture

```
RASP_Bypass/
├── README.md
├── CHECKLIST.md
├── config.js
├── bypass.js
├── lib/
│   ├── utils.js
│   ├── stealth-frida-hiding.js
│   ├── stealth-hook-detection.js
│   ├── root-detection-bypass.js
│   ├── frida-detection-bypass.js
│   ├── debugger-detection-bypass.js
│   ├── emulator-detection-bypass.js
│   ├── vpn-detection-bypass.js
│   ├── developer-mode-bypass.js
│   ├── accessibility-bypass.js
│   ├── screen-capture-bypass.js
│   ├── app-cloning-bypass.js
│   ├── android-ssl-pinning-bypass.js
│   ├── android-ssl-pinning-bypass-fallback.js
│   ├── android-system-certificate-injection.js
│   ├── native-tls-hook.js
│   ├── disable-flutter-tls.js
│   ├── meta-ssl-pinning-bypass.js
│   ├── android-proxy-override.js
│   ├── native-connect-hook.js
│   ├── integrity-bypass.js
│   ├── attestation-bypass.js
│   ├── http3-disable.js
│   ├── syscall-bypass.js
│   └── anti-frida-bypass.js
└── profiles/
    ├── banking.js
    ├── flutter.js
    └── meta.js
```

### Two Operational Modes

| Mode | Command | Description |
|------|---------|-------------|
| **Single-file** | `frida … -l bypass.js` | All modules in one file, zero external deps |
| **Modular** | `frida … -l config.js` | Selective module loading via orchestrator |

---

## Module Reference

| Module File | ID | Description | Source |
|---|---|---|---|
| `stealth-frida-hiding.js` | `stealthFrida` | Frida OS-Level Hiding | RASP_auditor m03 |
| `stealth-hook-detection.js` | `stealthHook` | Hook Detection Countermeasures | RASP_auditor m10 |
| `root-detection-bypass.js` | `root` | Root/Magisk/KernelSU Hiding | httptoolkit + m02 |
| `frida-detection-bypass.js` | `frida` | App-Level Frida Detection Defeat | RASP_auditor m03 |
| `debugger-detection-bypass.js` | `debugger` | Debugger/ptrace Neutralization | RASP_auditor m04 |
| `emulator-detection-bypass.js` | `emulator` | Emulator Detection Bypass | RASP_auditor m08 |
| `vpn-detection-bypass.js` | `vpn` | VPN Detection Bypass | RASP_auditor m11 |
| `developer-mode-bypass.js` | `devMode` | Developer Mode Hiding | RASP_auditor m05 |
| `accessibility-bypass.js` | `accessibility` | Accessibility Service Hiding | RASP_auditor m14 |
| `screen-capture-bypass.js` | `screenCapture` | Screen Capture / FLAG_SECURE Bypass | RASP_auditor m16 |
| `app-cloning-bypass.js` | `appCloning` | App Cloning Detection Bypass | RASP_auditor m17 |
| `android-ssl-pinning-bypass.js` | `sslPinning` | Java SSL Unpinning (20+ libs) | httptoolkit (Tim Perry, AGPL-3.0) |
| `android-ssl-pinning-bypass-fallback.js` | `sslFallback` | Auto-Fallback SSL Patcher | httptoolkit (Tim Perry, AGPL-3.0) |
| `android-system-certificate-injection.js` | `certInjection` | System CA Certificate Injection | httptoolkit (Tim Perry, AGPL-3.0) |
| `native-tls-hook.js` | `nativeTls` | Native BoringSSL/OpenSSL Hooks | httptoolkit (Tim Perry, AGPL-3.0) |
| `disable-flutter-tls.js` | `flutter` | Flutter/Dart TLS Bypass | NVISOsecurity |
| `meta-ssl-pinning-bypass.js` | `metaSsl` | Meta Apps SSL Bypass | iomoath/meta-apps-ssl-pinning |
| `android-proxy-override.js` | `proxyOverride` | Java Proxy Force Override | httptoolkit (Tim Perry, AGPL-3.0) |
| `native-connect-hook.js` | `nativeConnect` | Native connect() Redirect | httptoolkit (Tim Perry, AGPL-3.0) |
| `integrity-bypass.js` | `integrity` | Signature/Tampering/Anti-Kill | RASP_auditor m09 |
| `attestation-bypass.js` | `attestation` | SafetyNet/Play Integrity Spoofing | RASP_auditor m18,24 |
| `http3-disable.js` | `http3Disable` | HTTP/3 QUIC Blocking | iomoath/meta-apps-ssl-pinning |
| `syscall-bypass.js` | `syscall` | ARM64 Syscall-Level Bypass | iomoath/meta-apps-ssl-pinning |
| `anti-frida-bypass.js` | `antiFrida` | Syscall-Level Frida Hiding | iomoath/meta-apps-ssl-pinning |

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
