/**
 * profiles/flutter.js — Flutter App Profile
 * Flutter + SSL focus.
 * Load AFTER config.js: frida -U -f com.flutter.app -l config.js -l profiles/flutter.js
 */
if (typeof BYPASS_CONFIG !== 'undefined') {
    BYPASS_CONFIG.modules.flutter       = true;
    BYPASS_CONFIG.modules.sslPinning    = true;
    BYPASS_CONFIG.modules.sslFallback   = true;
    BYPASS_CONFIG.modules.nativeTls     = true;
    BYPASS_CONFIG.modules.stealthFrida  = true;
    BYPASS_CONFIG.modules.certInjection = true;
    BYPASS_CONFIG.modules.proxyOverride = true;
    BYPASS_CONFIG.modules.nativeConnect = true;
    if (typeof BYPASS_BUS !== 'undefined') {
        Object.keys(BYPASS_CONFIG.modules).forEach(function (k) {
            BYPASS_BUS.enabled[k] = BYPASS_CONFIG.modules[k];
        });
    }
}
