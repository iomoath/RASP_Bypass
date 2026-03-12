/**
 * profiles/banking.js — Banking App Profile
 * Maximum stealth — all modules enabled, silent mode.
 * Load AFTER config.js: frida -U -f com.bank.app -l config.js -l profiles/banking.js
 */
if (typeof BYPASS_CONFIG !== 'undefined') {
    BYPASS_CONFIG.silent = true;
    BYPASS_CONFIG.debug  = false;
    Object.keys(BYPASS_CONFIG.modules).forEach(function (k) {
        BYPASS_CONFIG.modules[k] = (BYPASS_CONFIG.modules[k] !== 'auto') ? true : 'auto';
    });
    // Force all stealth modules on
    ['stealthFrida','stealthHook','root','frida','debugger','integrity','attestation','antiFrida','syscall'].forEach(function (k) {
        BYPASS_CONFIG.modules[k] = true;
    });
    if (typeof BYPASS_BUS !== 'undefined') {
        Object.keys(BYPASS_CONFIG.modules).forEach(function (k) {
            BYPASS_BUS.enabled[k] = BYPASS_CONFIG.modules[k];
        });
    }
}
