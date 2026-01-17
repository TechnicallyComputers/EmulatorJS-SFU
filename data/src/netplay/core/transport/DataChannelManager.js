/**
 * DataChannelManager - Input data channel handling
 *
 * Manages data channels for input synchronization:
 * - Binary input data channels
 * - Ordered vs unordered modes
 * - Retry logic for lost inputs
 * - Multiple transport modes (SFU relay, P2P)
 */

class DataChannelManager {
  /**
   * @param {Object} config - Configuration
   * @param {string} config.mode - Input mode: "orderedRelay", "unorderedRelay", "unorderedP2P", "orderedP2P"
   */
  constructor(config = {}) {
    this.config = config;
    this.mode = config.mode || "orderedRelay";
    
    // SFU data producer (for relay modes)
    this.dataProducer = null;
    
    // P2P data channels
    this.p2pChannels = new Map(); // socketId -> {ordered, unordered}
    
    // Input send callback
    this.onInputCallback = null;
  }

  /**
   * Set SFU data producer (for relay modes).
   * @param {Object} dataProducer - mediasoup DataProducer
   */
  setDataProducer(dataProducer) {
    this.dataProducer = dataProducer;
    
    if (dataProducer && typeof dataProducer.on === "function") {
      // Listen for messages from SFU data producer
      dataProducer.on("message", (message) => {
        this.handleIncomingMessage(message);
      });
    }
  }

  /**
   * Add P2P data channel.
   * @param {string} socketId - Peer socket ID
   * @param {Object} channelData - {ordered, unordered} RTCDataChannel objects
   */
  addP2PChannel(socketId, channelData) {
    const { ordered, unordered } = channelData || {};
    
    if (ordered) {
      ordered.onmessage = (event) => {
        this.handleIncomingMessage(event.data, socketId);
      };
    }
    
    if (unordered) {
      unordered.onmessage = (event) => {
        this.handleIncomingMessage(event.data, socketId);
      };
    }
    
    this.p2pChannels.set(socketId, {
      ordered: ordered,
      unordered: unordered,
    });
  }

  /**
   * Remove P2P data channel.
   * @param {string} socketId - Peer socket ID
   */
  removeP2PChannel(socketId) {
    this.p2pChannels.delete(socketId);
  }

  /**
   * Send input data over appropriate channel.
   * @param {number} playerIndex - Player index
   * @param {number} inputIndex - Input index
   * @param {number} value - Input value
   * @returns {boolean} True if sent successfully
   */
  sendInput(playerIndex, inputIndex, value) {
    const payload = JSON.stringify({
      player: playerIndex,
      index: inputIndex,
      value: value,
    });

    try {
      // Relay modes: use SFU data producer
      if (this.mode === "orderedRelay" || this.mode === "unorderedRelay") {
        if (this.dataProducer && !this.dataProducer.closed && typeof this.dataProducer.send === "function") {
          this.dataProducer.send(payload);
          return true;
        }
        return false;
      }

      // Unordered P2P: try unordered channels first
      if (this.mode === "unorderedP2P") {
        let sent = false;
        this.p2pChannels.forEach((channels, socketId) => {
          if (channels.unordered && channels.unordered.readyState === "open") {
            channels.unordered.send(payload);
            sent = true;
          }
        });
        if (sent) return true;
      }

      // Ordered P2P: fallback or primary mode
      let sent = false;
      this.p2pChannels.forEach((channels, socketId) => {
        if (channels.ordered && channels.ordered.readyState === "open") {
          channels.ordered.send(payload);
          sent = true;
        }
      });
      return sent;
    } catch (error) {
      console.error("[DataChannelManager] Failed to send input:", error);
      return false;
    }
  }

  /**
   * Handle incoming message from data channel.
   * @private
   * @param {string|ArrayBuffer} message - Message data
   * @param {string|null} fromSocketId - Source socket ID (for P2P)
   */
  handleIncomingMessage(message, fromSocketId = null) {
    try {
      let data;
      if (typeof message === "string") {
        data = JSON.parse(message);
      } else if (message instanceof ArrayBuffer) {
        const text = new TextDecoder().decode(message);
        data = JSON.parse(text);
      } else {
        console.warn("[DataChannelManager] Unknown message type:", typeof message);
        return;
      }

      // Parse input data
      if (data.player !== undefined && data.index !== undefined && data.value !== undefined) {
        if (this.onInputCallback) {
          this.onInputCallback(data.player, data.index, data.value, fromSocketId);
        }
      }
    } catch (error) {
      console.error("[DataChannelManager] Failed to parse incoming message:", error);
    }
  }

  /**
   * Register callback for received inputs.
   * @param {Function} callback - Callback(playerIndex, inputIndex, value, fromSocketId)
   */
  onInput(callback) {
    this.onInputCallback = callback;
  }

  /**
   * Check if data channels are ready.
   * @returns {boolean}
   */
  isReady() {
    if (this.mode === "orderedRelay" || this.mode === "unorderedRelay") {
      return this.dataProducer && !this.dataProducer.closed;
    }

    // P2P modes: check if at least one channel is open
    for (const channels of this.p2pChannels.values()) {
      if (channels.ordered?.readyState === "open" || channels.unordered?.readyState === "open") {
        return true;
      }
    }

    return false;
  }

  /**
   * Cleanup all data channels.
   */
  cleanup() {
    this.dataProducer = null;
    this.p2pChannels.clear();
    this.onInputCallback = null;
  }
}

window.DataChannelManager = DataChannelManager;
