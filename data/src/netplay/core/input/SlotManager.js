/**
 * SlotManager - Player slot assignment
 *
 * Manages:
 * - Player slot assignment (0-3 for standard, 0-7 for complex)
 * - Exclusive slot mode (one player per slot)
 * - Co-op mode (multiple players → same slot)
 * - Spectator "pass controller" requests
 * - Slot reservation system
 */

class SlotManager {
  /**
   * @param {Object} config - Configuration
   * @param {boolean} config.exclusiveSlots - True for exclusive slots (default: true)
   * @param {number} config.maxSlots - Maximum number of slots (default: 4)
   */
  constructor(config = {}) {
    this.config = config;
    this.exclusiveSlots = config.exclusiveSlots !== false; // Default: true
    this.maxSlots = config.maxSlots || 4;

    // Slot assignments: slotIndex -> playerId[]
    this.slots = new Map();

    // Player slot mappings: playerId -> slotIndex
    this.playerSlots = new Map();

    // Pending pass controller requests: requestId -> {fromPlayerId, toPlayerId, slotIndex}
    this.pendingRequests = new Map();
  }

  /**
   * Assign a slot to a player.
   * @param {string} playerId - Player ID
   * @param {number|null} preferredSlot - Preferred slot index (0-3), or null for auto-assign
   * @returns {number|null} Assigned slot index, or null if assignment failed
   */
  assignSlot(playerId, preferredSlot = null) {
    if (!playerId) {
      return null;
    }

    // Check if player already has a slot
    if (this.playerSlots.has(playerId)) {
      const existingSlot = this.playerSlots.get(playerId);
      // If requesting same slot, allow it
      if (preferredSlot === null || preferredSlot === existingSlot) {
        return existingSlot;
      }
      // Otherwise, release existing slot first
      this.releaseSlot(playerId);
    }

    let targetSlot = preferredSlot;

    // Auto-assign slot if not specified
    if (targetSlot === null) {
      targetSlot = this.findAvailableSlot();
      if (targetSlot === null) {
        return null; // No available slots
      }
    }

    // Validate slot index
    if (targetSlot < 0 || targetSlot >= this.maxSlots) {
      return null;
    }

    // Check if slot is available (exclusive mode) or if co-op is allowed
    if (this.exclusiveSlots) {
      const existingPlayers = this.slots.get(targetSlot) || [];
      if (existingPlayers.length > 0) {
        return null; // Slot occupied in exclusive mode
      }
    }

    // Assign slot
    if (!this.slots.has(targetSlot)) {
      this.slots.set(targetSlot, []);
    }
    this.slots.get(targetSlot).push(playerId);
    this.playerSlots.set(playerId, targetSlot);

    return targetSlot;
  }

  /**
   * Release a player's slot.
   * @param {string} playerId - Player ID
   */
  releaseSlot(playerId) {
    if (!this.playerSlots.has(playerId)) {
      return;
    }

    const slotIndex = this.playerSlots.get(playerId);
    const playersInSlot = this.slots.get(slotIndex) || [];

    // Remove player from slot
    const index = playersInSlot.indexOf(playerId);
    if (index !== -1) {
      playersInSlot.splice(index, 1);
    }

    if (playersInSlot.length === 0) {
      this.slots.delete(slotIndex);
    }

    this.playerSlots.delete(playerId);
  }

  /**
   * Get slot index for a player.
   * @param {string} playerId - Player ID
   * @returns {number|null} Slot index, or null if player has no slot
   */
  getSlotForPlayer(playerId) {
    return this.playerSlots.get(playerId) ?? null;
  }

  /**
   * Get all players in a slot.
   * @param {number} slotIndex - Slot index (0-3)
   * @returns {Array<string>} Array of player IDs
   */
  getPlayersInSlot(slotIndex) {
    return this.slots.get(slotIndex) || [];
  }

  /**
   * Find an available slot (for auto-assignment).
   * @returns {number|null} Available slot index, or null if no slots available
   */
  findAvailableSlot() {
    for (let i = 0; i < this.maxSlots; i++) {
      const playersInSlot = this.slots.get(i) || [];
      if (playersInSlot.length === 0 || !this.exclusiveSlots) {
        return i;
      }
    }
    return null; // No available slots
  }

  /**
   * Request to pass controller (spectator → player).
   * @param {string} fromPlayerId - Spectator requesting controller
   * @param {string} toPlayerId - Player currently holding controller
   * @param {number} slotIndex - Slot index to swap
   * @returns {string} Request ID
   */
  requestPassController(fromPlayerId, toPlayerId, slotIndex) {
    const requestId = `pass-${Date.now()}-${Math.random()}`;
    this.pendingRequests.set(requestId, {
      fromPlayerId,
      toPlayerId,
      slotIndex,
      timestamp: Date.now(),
    });
    return requestId;
  }

  /**
   * Accept pass controller request (swap slots).
   * @param {string} requestId - Request ID
   * @returns {boolean} True if swap was successful
   */
  acceptPassController(requestId) {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      return false;
    }

    const { fromPlayerId, toPlayerId, slotIndex } = request;

    // Get current slot for the player holding the controller
    const currentSlot = this.getSlotForPlayer(toPlayerId);

    // Release current slot
    if (currentSlot !== null) {
      this.releaseSlot(toPlayerId);
    }

    // Assign slot to spectator
    this.assignSlot(fromPlayerId, slotIndex);

    // Optionally assign spectator's old slot (or any available slot) to player
    if (currentSlot !== null) {
      this.assignSlot(toPlayerId, currentSlot);
    }

    // Remove request
    this.pendingRequests.delete(requestId);

    return true;
  }

  /**
   * Reject pass controller request.
   * @param {string} requestId - Request ID
   */
  rejectPassController(requestId) {
    this.pendingRequests.delete(requestId);
  }

  /**
   * Get all pending pass controller requests.
   * @returns {Map<string, Object>} Map of request ID → request data
   */
  getPendingRequests() {
    return new Map(this.pendingRequests);
  }

  /**
   * Clear all slot assignments.
   */
  clear() {
    this.slots.clear();
    this.playerSlots.clear();
    this.pendingRequests.clear();
  }
}

window.SlotManager = SlotManager;
