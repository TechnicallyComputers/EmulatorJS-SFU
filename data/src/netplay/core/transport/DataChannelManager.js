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
    
    // Event emitter for input messages
    this.eventEmitter = {
      listeners: {},
      on: function(event, callback) {
        if (!this.listeners[event]) {
          this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
      },
      emit: function(event, data) {
        if (this.listeners[event]) {
          this.listeners[event].forEach(callback => callback(data));
        }
      }
    };

    // Ping test
    this.pingInterval = null;
    this.pingCount = 0;

    // Input buffering for P2P modes until channels are ready
    this.pendingInputs = [];
    // Note: maxPendingInputs will be set dynamically by NetplayMenu when settings change
    this.maxPendingInputs = 100; // Default fallback
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
   * Check if data channels are ready for sending inputs.
   * @returns {boolean} True if ready to send inputs
   */
  /**
   * Check if data channels are ready.
   * @returns {boolean}
   */
  isReady() {
    console.log(`[DataChannelManager] isReady check for ${this.mode} mode - dataProducer: ${!!this.dataProducer}, closed: ${this.dataProducer?.closed}, p2pChannels: ${this.p2pChannels.size}`);
    if (this.mode === "orderedRelay" || this.mode === "unorderedRelay") {
      // Relay modes: check if data producer is available and not closed
      const ready = this.dataProducer && !this.dataProducer.closed;
      console.log(`[DataChannelManager] Relay mode ready: ${ready}`);
      return ready;
    } else if (this.mode === "unorderedP2P" || this.mode === "orderedP2P") {
      // P2P modes: check if there are any open P2P channels
      for (const [socketId, channels] of this.p2pChannels) {
        if (this.mode === "unorderedP2P" && channels.unordered && channels.unordered.readyState === "open") {
          console.log(`[DataChannelManager] P2P mode ready: true (unordered channel open for ${socketId})`);
          return true;
        }
        if (this.mode === "orderedP2P" && channels.ordered && channels.ordered.readyState === "open") {
          console.log(`[DataChannelManager] P2P mode ready: true (ordered channel open for ${socketId})`);
          return true;
        }
      }
      console.log(`[DataChannelManager] P2P mode ready: false (no open channels)`);
      return false;
    }
    console.log(`[DataChannelManager] Unknown mode: ${this.mode}, ready: false`);
    return false;
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

      ordered.onopen = () => {
        console.log(`[DataChannelManager] 📡 Ordered P2P channel to ${socketId} opened, flushing pending inputs`);
        this.flushPendingInputs();
      };

      ordered.onclose = () => {
        console.log(`[DataChannelManager] 📡 Ordered P2P channel to ${socketId} closed`);
      };

      ordered.onerror = (error) => {
        console.warn(`[DataChannelManager] 📡 Ordered P2P channel to ${socketId} error:`, error);
      };

      // Check current state
      console.log(`[DataChannelManager] 📡 Ordered P2P channel to ${socketId} added, current state: ${ordered.readyState}`);

      // Flush pending inputs when ordered channel opens
      if (ordered.readyState === "open") {
        console.log(`[DataChannelManager] 📡 Ordered P2P channel to ${socketId} already open, flushing pending inputs`);
        this.flushPendingInputs();
      }
    }

    if (unordered) {
      unordered.onmessage = (event) => {
        this.handleIncomingMessage(event.data, socketId);
      };

      unordered.onopen = () => {
        console.log(`[DataChannelManager] 📡 Unordered P2P channel to ${socketId} opened, flushing pending inputs`);
        this.flushPendingInputs();
      };

      unordered.onclose = () => {
        console.log(`[DataChannelManager] 📡 Unordered P2P channel to ${socketId} closed`);
      };

      unordered.onerror = (error) => {
        console.warn(`[DataChannelManager] 📡 Unordered P2P channel to ${socketId} error:`, error);
      };

      // Check current state
      console.log(`[DataChannelManager] 📡 Unordered P2P channel to ${socketId} added, current state: ${unordered.readyState}`);

      // Flush pending inputs when unordered channel opens
      if (unordered.readyState === "open") {
        console.log(`[DataChannelManager] 📡 Unordered P2P channel to ${socketId} already open, flushing pending inputs`);
        this.flushPendingInputs();
      }
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
   * @param {Object} inputData - Input data object with frame, slot, playerIndex, inputIndex, value
   * @returns {boolean} True if sent successfully
   */
  sendInput(inputData) {
    console.log("[DataChannelManager] sendInput received inputData:", inputData);

    // Handle both formats: new format with individual properties, or old format with connected_input array
    let frame, slot, playerIndex, inputIndex, value;

    if (inputData.connected_input) {
      // Old format from NetplayEngine
      [playerIndex, inputIndex, value] = inputData.connected_input;
      frame = inputData.frame;
      slot = 0; // Default slot for old format
      console.log("[DataChannelManager] Using old format - extracted:", { frame, slot, playerIndex, inputIndex, value });
    } else {
      // New format with individual properties
      ({ frame, slot, playerIndex, inputIndex, value } = inputData);
      console.log("[DataChannelManager] Using new format - destructured:", { frame, slot, playerIndex, inputIndex, value });
    }

    // Ensure all values are defined
    frame = frame || 0;
    slot = slot !== undefined ? slot : 0;
    playerIndex = playerIndex !== undefined ? playerIndex : 0;
    inputIndex = inputIndex !== undefined ? inputIndex : 0;
    value = value !== undefined ? value : 0;

    console.log("[DataChannelManager] Final values for InputPayload:", { frame, slot, playerIndex, inputIndex, value });

    console.log("[DataChannelManager] 🚀 sendInput called:", {
      frame,
      slot,
      playerIndex,
      inputIndex,
      value,
      mode: this.mode,
      p2pChannelsCount: this.p2pChannels.size,
      hasDataProducer: !!this.dataProducer,
      dataProducerClosed: this.dataProducer?.closed
    });

    // Create canonical input payload
    const payload = new InputPayload(frame, slot, playerIndex, inputIndex, value);
    const payloadString = payload.serialize();

    // Convert to ArrayBuffer to avoid SFU server JSON parsing corruption
    const payloadBuffer = new TextEncoder().encode(payloadString);

    console.log("[DataChannelManager] 📤 Sending input payload as ArrayBuffer:", payloadString, "buffer size:", payloadBuffer.byteLength);
    console.log("[DataChannelManager] 📤 ArrayBuffer contents (first 50 bytes):", new Uint8Array(payloadBuffer.slice(0, 50)));

    try {
      // Relay modes: use SFU data producer
      if (this.mode === "orderedRelay" || this.mode === "unorderedRelay") {
        if (this.dataProducer && !this.dataProducer.closed && typeof this.dataProducer.send === "function") {
          this.dataProducer.send(payloadBuffer);
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
        console.log("[DataChannelManager] 🔍 Checking P2P channels for unordered mode:", Array.from(this.p2pChannels.keys()));
        let sent = false;
        this.p2pChannels.forEach((channels, socketId) => {
          console.log(`[DataChannelManager] 📡 Checking channel for ${socketId}:`, {
            hasUnordered: !!channels.unordered,
            unorderedState: channels.unordered?.readyState,
            hasOrdered: !!channels.ordered,
            orderedState: channels.ordered?.readyState
          });
          if (channels.unordered && channels.unordered.readyState === "open") {
            channels.unordered.send(payloadBuffer);
            console.log(`[DataChannelManager] ✅ Sent input via unordered P2P channel to ${socketId}`);
            sent = true;
          }
        });
        if (sent) {
          console.log("[DataChannelManager] ✅ Sent input via unordered P2P channels");
          this.flushPendingInputs(); // Send any buffered inputs now that we have channels
          return true;
        } else {
          console.log("[DataChannelManager] 📦 No ready unordered P2P channels yet - buffering input");
          // Buffer input until P2P channels are ready
          this.bufferInput(payloadBuffer);
          return true; // Don't fall back to relay for P2P modes
        }
      }

      // Ordered P2P: fallback or primary mode
      if (this.mode === "orderedP2P") {
        console.log("[DataChannelManager] 🔍 Checking P2P channels for ordered mode:", Array.from(this.p2pChannels.keys()));
        let sent = false;
        this.p2pChannels.forEach((channels, socketId) => {
          console.log(`[DataChannelManager] 📡 Checking ordered channel for ${socketId}:`, {
            orderedState: channels.ordered?.readyState
          });
          if (channels.ordered && channels.ordered.readyState === "open") {
            channels.ordered.send(payloadBuffer);
            console.log(`[DataChannelManager] ✅ Sent input via ordered P2P channel to ${socketId}`);
            sent = true;
          }
        });
        if (sent) {
          console.log("[DataChannelManager] ✅ Sent input via ordered P2P channels");
          this.flushPendingInputs(); // Send any buffered inputs now that we have channels
          return true;
        } else {
          console.log("[DataChannelManager] 📦 No open ordered P2P channels yet - buffering input");
          // Buffer input until P2P channels are ready
          this.bufferInput(payloadBuffer);
          return true; // Don't fall back to relay for P2P modes
        }
      }

      // Fallback for any remaining cases
      console.warn("[DataChannelManager] ⚠️ No transport available for input, mode:", this.mode);
      return false;
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
      console.log("[DataChannelManager] Raw message received:", {
        type: typeof message,
        value: message,
        stringValue: String(message),
        isObject: typeof message === "object",
        constructor: message?.constructor?.name
      });

      // Try to handle the message intelligently
      if (message instanceof ArrayBuffer || (typeof message === "object" && message && message.byteLength !== undefined)) {
        // Message is an ArrayBuffer (check byteLength as fallback for instanceof issues)
        const text = new TextDecoder().decode(message);
        console.log("[DataChannelManager] Decoded ArrayBuffer text:", text, "length:", text.length);
        try {
          data = JSON.parse(text);
          console.log("[DataChannelManager] Parsed JSON data:", data);
        } catch (parseError) {
          console.warn("[DataChannelManager] Failed to parse ArrayBuffer text:", text, "error:", parseError);
          return; // Silently ignore malformed ArrayBuffer data
        }
      } else if (typeof message === "object" && message !== null) {
        // Message is already parsed (from SFU transport)
        data = message;
      } else if (typeof message === "string") {
        // Handle case where string is "[object Object]" (object.toString() result)
        if (message === "[object Object]") {
          return; // Silently ignore
        }
        // Check if it's a valid JSON string
        try {
          data = JSON.parse(message);
        } catch (parseError) {
          return; // Silently ignore malformed JSON
        }
      } else {
        console.warn("[DataChannelManager] Unknown message type:", typeof message, "value:", message);
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

      // Parse input data using canonical InputPayload format
      if (data.t === "i") {
        const payload = InputPayload.deserialize(data);
        if (payload) {
          console.log("[DataChannelManager] 📨 Received input packet:", {
            frame: payload.getFrame(),
            slot: payload.getSlot(),
            player: payload.p,
            input: payload.k,
            value: payload.v,
            fromSocketId
          });
          // Emit input event with the payload
          this.eventEmitter.emit("input", { payload, fromSocketId });
        } else {
          console.warn("[DataChannelManager] Failed to deserialize input payload:", data);
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
   * @param {Function} callback - Callback({payload, fromSocketId})
   */
  onInput(callback) {
    this.eventEmitter.on("input", callback);
  }

  /**
   * Buffer input for later sending when P2P channels become available.
   * @private
   * @param {ArrayBuffer} payload - Encoded payload buffer to buffer
   */
  bufferInput(payload) {
    this.pendingInputs.push({
      payload,
      timestamp: Date.now()
    });

    // Prevent unbounded growth
    if (this.pendingInputs.length > this.maxPendingInputs) {
      console.warn(`[DataChannelManager] ⚠️ Pending inputs buffer full (${this.maxPendingInputs}), dropping oldest. This suggests P2P channels are not opening properly.`);
      this.pendingInputs.shift();
    }

    // Warn when buffer is getting full
    if (this.pendingInputs.length > this.maxPendingInputs * 0.8) {
      console.warn(`[DataChannelManager] ⚠️ Pending inputs buffer at ${this.pendingInputs.length}/${this.maxPendingInputs} - P2P channels may not be opening`);
    }

    console.log(`[DataChannelManager] 📦 Buffered input, ${this.pendingInputs.length} pending`);
  }

  /**
   * Flush pending inputs through available P2P channels.
   */
  flushPendingInputs() {
    if (this.pendingInputs.length === 0) {
      return;
    }

    console.log(`[DataChannelManager] 🚀 Flushing ${this.pendingInputs.length} pending inputs`);

    const inputsToSend = [...this.pendingInputs];
    this.pendingInputs = []; // Clear buffer

    inputsToSend.forEach(({ payload, timestamp }) => {
      try {
        let sent = false;

        // Payload is already an ArrayBuffer

        // Try unordered channels first (for unorderedP2P mode)
        if (this.mode === "unorderedP2P") {
          this.p2pChannels.forEach((channels, socketId) => {
            if (channels.unordered && channels.unordered.readyState === "open") {
              channels.unordered.send(payload);
              console.log(`[DataChannelManager] ✅ Flushed buffered input via unordered P2P to ${socketId}`);
              sent = true;
            }
          });
        }

        // Try ordered channels (for orderedP2P mode or as fallback)
        if (!sent) {
          this.p2pChannels.forEach((channels, socketId) => {
            if (channels.ordered && channels.ordered.readyState === "open") {
              channels.ordered.send(payload);
              console.log(`[DataChannelManager] ✅ Flushed buffered input via ordered P2P to ${socketId}`);
              sent = true;
            }
          });
        }

        if (!sent) {
          console.warn("[DataChannelManager] ❌ Could not flush buffered input - no channels ready");
          // Put it back in the buffer
          this.pendingInputs.unshift({ payload, timestamp });
        }
      } catch (error) {
        console.error("[DataChannelManager] ❌ Error flushing buffered input:", error);
      }
    });
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

      // Convert ping payload to ArrayBuffer
    const pingBuffer = new TextEncoder().encode(pingPayload);

    console.log("[DataChannelManager] 📡 Sending ping:", pingPayload);

      try {
        // Relay modes: use SFU data producer
        if (this.mode === "orderedRelay" || this.mode === "unorderedRelay") {
          if (this.dataProducer && !this.dataProducer.closed && typeof this.dataProducer.send === "function") {
            this.dataProducer.send(pingBuffer);
          }
        }

        // P2P modes: send to all channels
        this.p2pChannels.forEach((channels, socketId) => {
          if (channels.unordered && channels.unordered.readyState === "open") {
            channels.unordered.send(pingBuffer);
          } else if (channels.ordered && channels.ordered.readyState === "open") {
            channels.ordered.send(pingBuffer);
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
    this.eventEmitter.listeners = {};
  }
}

window.DataChannelManager = DataChannelManager;
