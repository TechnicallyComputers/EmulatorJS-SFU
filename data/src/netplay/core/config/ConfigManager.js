/**
 * ConfigManager - Configuration management for netplay
 * 
 * Handles:
 * - Netplay settings persistence (localStorage)
 * - Default value management
 * - Configuration validation
 */

class ConfigManager {
  /**
   * @param {IEmulator} emulatorAdapter - Emulator adapter
   * @param {Object} defaultConfig - Default configuration values
   */
  constructor(emulatorAdapter, defaultConfig = {}) {
    this.emulator = emulatorAdapter;
    this.defaults = {
      netplaySimulcastEnabled: false,
      netplayVP9SVCMode: null,
      netplayHostCodec: "auto",
      netplayClientSimulcastQuality: "medium",
      netplayRetryConnectionTimerSeconds: 5,
      netplayUnorderedRetries: 0,
      netplayInputMode: "ordered",
      netplayPreferredSlot: 0,
      ...defaultConfig,
    };
  }

  /**
   * Load configuration from localStorage/emulator settings.
   * @returns {Object} Configuration object
   */
  loadConfig() {
    // TODO: Implement settings loading in future phases
    return { ...this.defaults };
  }

  /**
   * Get a specific setting value.
   * @param {string} key - Setting key
   * @returns {*} Setting value or default
   */
  getSetting(key) {
    const config = this.loadConfig();
    return config[key] ?? this.defaults[key];
  }

  /**
   * Set a setting value (persists to localStorage).
   * @param {string} key - Setting key
   * @param {*} value - Setting value
   */
  setSetting(key, value) {
    // TODO: Implement settings persistence in future phases
    console.log(`[ConfigManager] Setting ${key} = ${value}`);
  }

  /**
   * Get all default values.
   * @returns {Object} Default configuration
   */
  getDefaults() {
    return { ...this.defaults };
  }

  /**
   * Validate configuration object.
   * @param {Object} config - Configuration to validate
   * @returns {{valid: boolean, errors: string[]}} Validation result
   */
  validateConfig(config) {
    const errors = [];
    
    // TODO: Add validation rules in future phases
    // Example: Validate netplayPreferredSlot is 0-3
    // Example: Validate retry timer is positive
    
    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

window.ConfigManager = ConfigManager;
