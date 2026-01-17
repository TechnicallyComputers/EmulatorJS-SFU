/**
 * MetadataValidator - ROM/emulator hash checking
 *
 * Validates:
 * - Emulator core/version matching
 * - ROM hash matching (based on game mode)
 * - ROM size validation
 * - Game mode-specific requirements
 */

class MetadataValidator {
  /**
   * @param {GameModeManager} gameModeManager - Game mode manager instance
   */
  constructor(gameModeManager) {
    this.gameModeManager = gameModeManager;
  }

  /**
   * Validate emulator match.
   * @param {Object} localInfo - Local emulator info {core: string, version: string}
   * @param {Object} remoteInfo - Remote emulator info {core: string, version: string}
   * @returns {boolean} True if match
   */
  validateEmulatorMatch(localInfo, remoteInfo) {
    if (!localInfo || !remoteInfo) {
      return false;
    }

    return (
      localInfo.core === remoteInfo.core &&
      localInfo.version === remoteInfo.version
    );
  }

  /**
   * Validate ROM match.
   * @param {Object} localROM - Local ROM info {hash: string, size: number, name: string}
   * @param {Object} remoteROM - Remote ROM info {hash: string, size: number, name: string}
   * @returns {boolean} True if match
   */
  validateROMMatch(localROM, remoteROM) {
    if (!localROM || !remoteROM) {
      return false;
    }

    // Check hash (primary validation)
    if (localROM.hash && remoteROM.hash) {
      if (localROM.hash !== remoteROM.hash) {
        return false;
      }
    }

    // Check size (secondary validation)
    if (localROM.size && remoteROM.size) {
      if (localROM.size !== remoteROM.size) {
        return false;
      }
    }

    // If both have hash and they match, consider it valid
    if (localROM.hash && remoteROM.hash) {
      return localROM.hash === remoteROM.hash;
    }

    // If no hash but sizes match, consider it valid (fallback)
    if (localROM.size && remoteROM.size) {
      return localROM.size === remoteROM.size;
    }

    return false;
  }

  /**
   * Validate player join requirements based on game mode.
   * @param {string} gameMode - Game mode ID
   * @param {Object} localEmulator - Local emulator info {core, version}
   * @param {Object} localROM - Local ROM info {hash, size, name}
   * @param {Object} remoteEmulator - Remote emulator info {core, version}
   * @param {Object} remoteROM - Remote ROM info {hash, size, name}
   * @returns {{valid: boolean, reason?: string, canSpectate?: boolean}} Validation result
   */
  validateJoinRequirements(
    gameMode,
    localEmulator,
    localROM,
    remoteEmulator,
    remoteROM
  ) {
    if (!this.gameModeManager) {
      return {
        valid: false,
        reason: "Game mode manager not initialized",
        canSpectate: true,
      };
    }

    // Delegate to game mode manager for mode-specific validation
    return this.gameModeManager.validateJoinRequirements(
      gameMode,
      localEmulator,
      localROM,
      remoteEmulator,
      remoteROM
    );
  }

  /**
   * Validate emulator info structure.
   * @param {Object} emulatorInfo - Emulator info to validate
   * @returns {boolean} True if valid structure
   */
  validateEmulatorInfo(emulatorInfo) {
    return (
      emulatorInfo &&
      typeof emulatorInfo.core === "string" &&
      typeof emulatorInfo.version === "string" &&
      emulatorInfo.core.length > 0 &&
      emulatorInfo.version.length > 0
    );
  }

  /**
   * Validate ROM info structure.
   * @param {Object} romInfo - ROM info to validate
   * @returns {boolean} True if valid structure
   */
  validateROMInfo(romInfo) {
    if (!romInfo) {
      return false;
    }

    // ROM info should have at least hash or size
    const hasHash = typeof romInfo.hash === "string" && romInfo.hash.length > 0;
    const hasSize = typeof romInfo.size === "number" && romInfo.size > 0;

    return hasHash || hasSize;
  }
}

window.MetadataValidator = MetadataValidator;
