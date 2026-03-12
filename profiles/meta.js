/**
 * profiles/meta.js — Meta Apps Profile (Facebook, Instagram, Messenger, WhatsApp)
 * Load AFTER config.js: frida -U -f com.instagram.android -l config.js -l profiles/meta.js
 */
if (typeof BYPASS_CONFIG !== 'undefined') {
    BYPASS_CONFIG.modules.metaSsl       = true;
    BYPASS_CONFIG.modules.sslPinning    = true;
    BYPASS_CONFIG.modules.sslFallback   = true;
    BYPASS_CONFIG.modules.nativeTls     = true;
    BYPASS_CONFIG.modules.proxyOverride = true;
    BYPASS_CONFIG.modules.nativeConnect = true;
    BYPASS_CONFIG.modules.http3Disable  = true;
    BYPASS_CONFIG.modules.stealthFrida  = true;
    BYPASS_CONFIG.modules.antiFrida     = true;
    BYPASS_CONFIG.modules.syscall       = true;
    if (typeof BYPASS_BUS !== 'undefined') {
        Object.keys(BYPASS_CONFIG.modules).forEach(function (k) {
            BYPASS_BUS.enabled[k] = BYPASS_CONFIG.modules[k];
        });
    }
}
