/**
 * PlayerManager - Player list and metadata
 *
 * Manages:
 * - Player list management
 * - Player metadata
 * - Player join/leave events
 * - Player slot assignments
 */

class PlayerManager {
  /**
   * @param {SlotManager} slotManager - Slot manager instance
   */
  constructor(slotManager) {
    this.slotManager = slotManager;
    this.players = new Map(); // playerId -> playerInfo
  }

  /**
   * Add a player to the session.
   * @param {string} playerId - Player ID
   * @param {Object} playerInfo - Player information
   * @returns {boolean} True if player was added
   */
  addPlayer(playerId, playerInfo) {
    if (!playerId || !playerInfo) {
      return false;
    }

    this.players.set(playerId, {
      ...playerInfo,
      playerId: playerId,
      joinedAt: Date.now(),
    });

    // Auto-assign slot if not specified
    if (this.slotManager && playerInfo.player_slot !== undefined) {
      this.slotManager.assignSlot(playerId, playerInfo.player_slot);
    }

    return true;
  }

  /**
   * Remove a player from the session.
   * @param {string} playerId - Player ID
   */
  removePlayer(playerId) {
    if (this.slotManager) {
      this.slotManager.releaseSlot(playerId);
    }
    this.players.delete(playerId);
  }

  /**
   * Get player information.
   * @param {string} playerId - Player ID
   * @returns {Object|null} Player info or null
   */
  getPlayer(playerId) {
    return this.players.get(playerId) || null;
  }

  /**
   * Get all players.
   * @returns {Map<string, Object>} Map of playerId -> playerInfo
   */
  getAllPlayers() {
    return new Map(this.players);
  }

  /**
   * Get players as an object (for backward compatibility).
   * @returns {Object} Object mapping playerId -> playerInfo
   */
  getPlayersObject() {
    const obj = {};
    this.players.forEach((info, playerId) => {
      obj[playerId] = info;
    });
    return obj;
  }

  /**
   * Update player information.
   * @param {string} playerId - Player ID
   * @param {Object} updates - Partial player info to update
   */
  updatePlayer(playerId, updates) {
    const player = this.players.get(playerId);
    if (player) {
      this.players.set(playerId, {
        ...player,
        ...updates,
      });

      // Update slot if changed
      if (updates.player_slot !== undefined && this.slotManager) {
        this.slotManager.releaseSlot(playerId);
        this.slotManager.assignSlot(playerId, updates.player_slot);
      }
    }
  }

  /**
   * Get player count.
   * @returns {number}
   */
  getPlayerCount() {
    return this.players.size;
  }

  /**
   * Check if player exists.
   * @param {string} playerId - Player ID
   * @returns {boolean}
   */
  hasPlayer(playerId) {
    return this.players.has(playerId);
  }

  /**
   * Clear all players.
   */
  clear() {
    if (this.slotManager) {
      this.players.forEach((info, playerId) => {
        this.slotManager.releaseSlot(playerId);
      });
    }
    this.players.clear();
  }
}

window.PlayerManager = PlayerManager;
