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

    // Ping test
    this.pingInterval = null;
    this.pingCount = 0;
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
   * @param {number} frame - Current frame number
   * @param {number} slot - Player slot number
   * @returns {boolean} True if sent successfully
   */
  sendInput(playerIndex, inputIndex, value, frame = 0, slot = 0) {
    console.log("[DataChannelManager] 🚀 sendInput called:", { playerIndex, inputIndex, value, frame, slot, mode: this.mode });

    const payload = JSON.stringify({
      type: "input",
      slot: slot,
      frame: frame,
      input: {
        player: playerIndex,
        index: inputIndex,
        value: value,
      }
    });

    console.log("[DataChannelManager] 📤 Sending input payload:", payload);

    try {
      // Relay modes: use SFU data producer
      if (this.mode === "orderedRelay" || this.mode === "unorderedRelay") {
        if (this.dataProducer && !this.dataProducer.closed && typeof this.dataProducer.send === "function") {
          this.dataProducer.send(payload);
          console.log("[DataChannelManager] ✅ Sent input via SFU data producer");
          return true;
        } else {
          console.warn("[DataChannelManager] ❌ SFU data producer not available:", {
            hasProducer: !!this.dataProducer,
            closed: this.dataProducer?.closed,
            hasSend: typeof this.dataProducer?.send === "function"
          });
          return false;
        }
      }

      // Unordered P2P: try unordered channels first
      if (this.mode === "unorderedP2P") {
        console.log("[DataChannelManager] 🔍 Checking P2P channels:", Array.from(this.p2pChannels.keys()));
        let sent = false;
        this.p2pChannels.forEach((channels, socketId) => {
          console.log(`[DataChannelManager] 📡 Checking channel for ${socketId}:`, {
            hasUnordered: !!channels.unordered,
            unorderedState: channels.unordered?.readyState,
            hasOrdered: !!channels.ordered,
            orderedState: channels.ordered?.readyState
          });
          if (channels.unordered && channels.unordered.readyState === "open") {
            channels.unordered.send(payload);
            console.log(`[DataChannelManager] ✅ Sent input via unordered P2P channel to ${socketId}`);
            sent = true;
          }
        });
        if (sent) {
          console.log("[DataChannelManager] ✅ Sent input via unordered P2P channels");
          return true;
        } else {
          console.warn("[DataChannelManager] ❌ No open unordered P2P channels available");
          return false;
        }
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
    console.log("[DataChannelManager] 🔄 handleIncomingMessage called with:", {
      messageType: typeof message,
      messageLength: message?.length || message?.byteLength,
      fromSocketId
    });

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

      console.log("[DataChannelManager] 📥 Received message:", { data, fromSocketId });

      // Handle ping messages
      if (data.type === "ping") {
        console.log("[DataChannelManager] 🏓 Received ping:", {
          count: data.count,
          timestamp: data.timestamp,
          latency: Date.now() - data.timestamp
        });
        return;
      }

      // Parse input data (new format: {type: "input", slot, frame, input: {player, index, value}})
      if (data.type === "input" && data.input) {
        const { player, index, value } = data.input;
        if (player !== undefined && index !== undefined && value !== undefined) {
          console.log("[DataChannelManager] 📨 Received input packet for slot", data.slot, "frame", data.frame, ":", { player, index, value });
          if (this.onInputCallback) {
            console.log("[DataChannelManager] 🎮 Calling input callback for received input");
            this.onInputCallback(player, index, value, fromSocketId);
            console.log("[DataChannelManager] ✅ Input callback called successfully");
          } else {
            console.warn("[DataChannelManager] No input callback set for received input");
          }
        } else {
          console.warn("[DataChannelManager] Invalid input data in received payload:", data);
        }
      } else {
        console.warn("[DataChannelManager] Unknown message type received:", data);
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
    let ready = false;

    if (this.mode === "orderedRelay" || this.mode === "unorderedRelay") {
      ready = this.dataProducer && !this.dataProducer.closed;
      console.log("[DataChannelManager] isReady check for relay mode:", {
        mode: this.mode,
        hasDataProducer: !!this.dataProducer,
        dataProducerClosed: this.dataProducer?.closed,
        ready
      });
    } else {
      // P2P modes: check if at least one channel is open
      for (const [socketId, channels] of this.p2pChannels.entries()) {
        if (channels.ordered?.readyState === "open" || channels.unordered?.readyState === "open") {
          console.log("[DataChannelManager] isReady check for P2P mode:", {
            mode: this.mode,
            socketId,
            orderedState: channels.ordered?.readyState,
            unorderedState: channels.unordered?.readyState,
            ready: true
          });
          ready = true;
          break;
        }
      }

      if (!ready) {
        console.log("[DataChannelManager] isReady check for P2P mode - no open channels:", {
          mode: this.mode,
          channelCount: this.p2pChannels.size,
          ready: false
        });
      }
    }

    return ready;
  }

  /**
   * Start ping test to verify channel connectivity.
   */
  startPingTest() {
    if (this.pingInterval) {
      console.log("[DataChannelManager] Ping test already running");
      return;
    }

    console.log("[DataChannelManager] Starting ping test every 1 second");
    this.pingInterval = setInterval(() => {
      this.pingCount++;
      const pingPayload = JSON.stringify({
        type: "ping",
        count: this.pingCount,
        timestamp: Date.now()
      });

      console.log("[DataChannelManager] 📡 Sending ping:", pingPayload);

      try {
        // Relay modes: use SFU data producer
        if (this.mode === "orderedRelay" || this.mode === "unorderedRelay") {
          if (this.dataProducer && !this.dataProducer.closed && typeof this.dataProducer.send === "function") {
            this.dataProducer.send(pingPayload);
          }
        }

        // P2P modes: send to all channels
        this.p2pChannels.forEach((channels, socketId) => {
          if (channels.unordered && channels.unordered.readyState === "open") {
            channels.unordered.send(pingPayload);
          } else if (channels.ordered && channels.ordered.readyState === "open") {
            channels.ordered.send(pingPayload);
          }
        });
      } catch (error) {
        console.error("[DataChannelManager] Failed to send ping:", error);
      }
    }, 1000);
  }

  /**
   * Stop ping test.
   */
  stopPingTest() {
    if (this.pingInterval) {
      console.log("[DataChannelManager] Stopping ping test");
      clearInterval(this.pingInterval);
      this.pingInterval = null;
      this.pingCount = 0;
    }
  }

  /**
   * Cleanup all data channels.
   */
  cleanup() {
    this.stopPingTest();
    this.dataProducer = null;
    this.p2pChannels.clear();
    this.onInputCallback = null;
  }
}

window.DataChannelManager = DataChannelManager;
