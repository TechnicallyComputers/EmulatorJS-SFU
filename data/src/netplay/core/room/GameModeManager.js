/**
 * GameModeManager - Game mode rules and validation
 *
 * Manages:
 * - Game mode definitions
 * - Mode-specific validation rules
 * - Enforces mode rules on room join (for players)
 * - Handles spectator mode prompts
 */

class GameModeManager {
  constructor() {
    this.modes = new Map();
    this._registerDefaultModes();
  }

  /**
   * Register default game modes.
   * @private
   */
  _registerDefaultModes() {
    // Live Stream - Host streams, players send inputs
    this.registerMode({
      modeId: "live-stream",
      name: "Live Stream",
      requiresEmulatorMatch: true, // Enforce emulator matching for players
      requiresROMMatch: false, // Not ROM matching (inputs must match emulator)
      allowsPassController: true, // Spectators can request controller
      hostStreamsOnly: true, // Only host streams video/audio
      maxPlayers: 4,
      supportsRollback: false,
      description: "Host streams video, players send inputs to host",
    });

    // Stream Party - All users stream video/audio
    this.registerMode({
      modeId: "stream-party",
      name: "Stream Party",
      requiresEmulatorMatch: false, // No enforcement for players
      requiresROMMatch: false, // No enforcement
      allowsPassController: true, // Spectators can request controller
      hostStreamsOnly: false, // All users stream
      maxPlayers: 4,
      supportsRollback: false,
      description: "All users stream video/audio, casual social mode",
    });

    // Sync/Rollback - Rollback netcode for action games
    this.registerMode({
      modeId: "sync-rollback",
      name: "Sync/Rollback",
      requiresEmulatorMatch: true, // Enforce emulator matching
      requiresROMMatch: true, // Enforce ROM matching (deterministic state sync)
      allowsPassController: false, // Competitive mode, no pass controller
      hostStreamsOnly: true, // Host streams
      maxPlayers: 4,
      supportsRollback: true, // Supports rollback netcode
      description: "Rollback netcode for competitive play, requires exact ROM match",
    });

    // Link Cable Room - Special for Game Boy emulation
    this.registerMode({
      modeId: "link-cable",
      name: "Link Cable Room",
      requiresEmulatorMatch: true, // Enforce emulator matching
      requiresROMMatch: true, // Enforce ROM matching for link cable compatibility
      allowsPassController: false, // No pass controller for link cable
      hostStreamsOnly: true, // Host streams
      maxPlayers: 2, // Link cable typically 2 players
      supportsRollback: false, // Link cable uses different sync mechanism
      description: "Optimized for Game Boy link cable emulation",
    });
  }

  /**
   * Register a game mode.
   * @param {Object} mode - Game mode definition
   */
  registerMode(mode) {
    // Validate mode structure
    if (!mode.modeId || !mode.name) {
      throw new Error("Game mode must have modeId and name");
    }

    this.modes.set(mode.modeId, {
      ...mode,
      // Ensure all fields have defaults
      requiresEmulatorMatch: mode.requiresEmulatorMatch ?? false,
      requiresROMMatch: mode.requiresROMMatch ?? false,
      allowsPassController: mode.allowsPassController ?? false,
      hostStreamsOnly: mode.hostStreamsOnly ?? true,
      maxPlayers: mode.maxPlayers ?? 4,
      supportsRollback: mode.supportsRollback ?? false,
    });
  }

  /**
   * Get a game mode by ID.
   * @param {string} modeId - Mode ID
   * @returns {Object|null} Mode definition or null
   */
  getMode(modeId) {
    return this.modes.get(modeId) ?? null;
  }

  /**
   * Get all registered modes.
   * @returns {Map<string, Object>} Mode map
   */
  getAllModes() {
    return new Map(this.modes);
  }

  /**
   * Get all mode IDs.
   * @returns {Array<string>} Array of mode IDs
   */
  getModeIds() {
    return Array.from(this.modes.keys());
  }

  /**
   * Validate player join requirements for a game mode.
   * @param {string} modeId - Game mode ID
   * @param {Object} localEmulator - Local emulator info {core, version}
   * @param {Object} localROM - Local ROM info {hash, size, name}
   * @param {Object} remoteEmulator - Remote emulator info {core, version}
   * @param {Object} remoteROM - Remote ROM info {hash, size, name}
   * @returns {{valid: boolean, reason?: string, canSpectate?: boolean}} Validation result
   */
  validateJoinRequirements(
    modeId,
    localEmulator,
    localROM,
    remoteEmulator,
    remoteROM
  ) {
    const mode = this.getMode(modeId);
    if (!mode) {
      return {
        valid: false,
        reason: `Unknown game mode: ${modeId}`,
        canSpectate: true, // Can spectate even if mode is unknown
      };
    }

    // Note: Spectators always allowed (can spectate regardless of validation)
    // This validation is only for players

    // Check emulator match requirement
    if (mode.requiresEmulatorMatch) {
      if (!localEmulator || !remoteEmulator) {
        return {
          valid: false,
          reason: "Emulator information missing",
          canSpectate: true,
        };
      }
      if (
        localEmulator.core !== remoteEmulator.core ||
        localEmulator.version !== remoteEmulator.version
      ) {
        return {
          valid: false,
          reason: `Emulator mismatch: local=${localEmulator.core}@${localEmulator.version}, remote=${remoteEmulator.core}@${remoteEmulator.version}`,
          canSpectate: true, // Can spectate even with emulator mismatch
        };
      }
    }

    // Check ROM match requirement
    if (mode.requiresROMMatch) {
      if (!localROM || !remoteROM) {
        return {
          valid: false,
          reason: "ROM information missing",
          canSpectate: true,
        };
      }
      if (
        localROM.hash !== remoteROM.hash ||
        localROM.size !== remoteROM.size
      ) {
        return {
          valid: false,
          reason: `ROM mismatch: local hash=${localROM.hash?.substring(0, 8)}..., remote hash=${remoteROM.hash?.substring(0, 8)}...`,
          canSpectate: true, // Can spectate even with ROM mismatch
        };
      }
    }

    // All requirements met
    return {
      valid: true,
      canSpectate: true, // Can always spectate
    };
  }

  /**
   * Check if mode supports spectators (all modes support spectators by default).
   * @param {string} modeId - Mode ID
   * @returns {boolean} Always true (all modes support spectators)
   */
  supportsSpectators(modeId) {
    // All game modes support spectators
    return true;
  }

  /**
   * Check if mode allows pass controller requests.
   * @param {string} modeId - Mode ID
   * @returns {boolean}
   */
  allowsPassController(modeId) {
    const mode = this.getMode(modeId);
    return mode ? mode.allowsPassController : false;
  }
}

window.GameModeManager = GameModeManager;
