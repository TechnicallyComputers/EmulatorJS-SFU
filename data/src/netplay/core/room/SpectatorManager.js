/**
 * SpectatorManager - Spectator management and chat
 *
 * Manages:
 * - Spectator connections and permissions
 * - Spectator video/audio stream delivery
 * - Chat integration for spectators (room-level chat)
 * - Spectator mode toggle (host-controlled)
 * - Spectator prompt when player join fails validation
 */

class SpectatorManager {
  /**
   * @param {Object} config - Configuration
   * @param {Object} socketTransport - SocketTransport instance (optional, for chat)
   */
  constructor(config = {}, socketTransport = null) {
    this.config = config;
    this.socket = socketTransport;
    this.spectators = new Map(); // spectatorId -> spectatorInfo
    this.allowsSpectators = true; // Default enabled, host can toggle
    this.chatMessages = []; // Chat history (room-level)
    this.maxChatHistory = config.maxChatHistory || 100; // Limit chat history size
  }

  /**
   * Set spectator mode enabled/disabled (host-controlled).
   * @param {boolean} enabled - True to allow spectators
   */
  setAllowsSpectators(enabled) {
    this.allowsSpectators = enabled;

    // If disabling, notify spectators (via socket if available)
    if (!enabled && this.socket && this.socket.isConnected()) {
      // TODO: Emit socket event to notify spectators
      // this.socket.emit("spectators-disabled");
    }
  }

  /**
   * Check if spectators are allowed.
   * @returns {boolean}
   */
  allowsSpectatorsMode() {
    return this.allowsSpectators;
  }

  /**
   * Add a spectator.
   * @param {string} spectatorId - Spectator ID
   * @param {Object} spectatorInfo - Spectator information
   * @returns {boolean} True if spectator was added (false if spectators disabled)
   */
  addSpectator(spectatorId, spectatorInfo) {
    if (!this.allowsSpectators) {
      return false;
    }

    this.spectators.set(spectatorId, {
      ...spectatorInfo,
      spectatorId: spectatorId,
      joinedAt: Date.now(),
    });

    return true;
  }

  /**
   * Remove a spectator.
   * @param {string} spectatorId - Spectator ID
   */
  removeSpectator(spectatorId) {
    this.spectators.delete(spectatorId);
  }

  /**
   * Get all spectators.
   * @returns {Map<string, Object>} Spectator map
   */
  getSpectators() {
    return new Map(this.spectators);
  }

  /**
   * Get spectator count.
   * @returns {number}
   */
  getSpectatorCount() {
    return this.spectators.size;
  }

  /**
   * Check if user is a spectator.
   * @param {string} userId - User ID
   * @returns {boolean}
   */
  isSpectator(userId) {
    return this.spectators.has(userId);
  }

  /**
   * Send chat message (players and spectators).
   * @param {string} senderId - Sender player/spectator ID
   * @param {string} message - Chat message
   * @param {string} senderName - Sender display name (optional)
   */
  sendChatMessage(senderId, message, senderName = null) {
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return;
    }

    const chatEntry = {
      senderId,
      senderName: senderName || senderId,
      message: message.trim(),
      timestamp: Date.now(),
    };

    this.chatMessages.push(chatEntry);

    // Limit chat history size
    if (this.chatMessages.length > this.maxChatHistory) {
      this.chatMessages.shift();
    }

    // Send chat message via socket if available
    if (this.socket && this.socket.isConnected()) {
      this.socket.emit("chat-message", chatEntry);
    }
  }

  /**
   * Get chat history.
   * @param {number} limit - Maximum number of messages to return (optional)
   * @returns {Array} Chat messages
   */
  getChatHistory(limit = null) {
    if (limit && limit > 0) {
      return this.chatMessages.slice(-limit);
    }
    return [...this.chatMessages];
  }

  /**
   * Clear chat history.
   */
  clearChat() {
    this.chatMessages = [];
  }

  /**
   * Setup socket event listeners for chat.
   */
  setupChatListeners() {
    if (!this.socket) {
      return;
    }

    // Listen for incoming chat messages
    this.socket.on("chat-message", (chatEntry) => {
      // Add to local chat history
      this.chatMessages.push({
        ...chatEntry,
        timestamp: chatEntry.timestamp || Date.now(),
      });

      // Limit chat history size
      if (this.chatMessages.length > this.maxChatHistory) {
        this.chatMessages.shift();
      }
    });
  }

  /**
   * Remove socket event listeners for chat.
   */
  removeChatListeners() {
    if (!this.socket) {
      return;
    }

    this.socket.off("chat-message");
  }

  /**
   * Clear all spectators and chat.
   */
  clear() {
    this.spectators.clear();
    this.clearChat();
  }
}

window.SpectatorManager = SpectatorManager;
