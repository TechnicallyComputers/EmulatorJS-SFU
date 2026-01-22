/**
 * InputSync - Frame-based input synchronization
 *
 * Handles:
 * - Frame-based input synchronization
 * - Input ordering (ordered vs unordered modes)
 * - Retry logic for lost inputs
 * - Slot assignment (exclusive vs co-op mode)
 * - Rollback netcode support (for Sync/Rollback mode)
 */

// Dependencies are expected in global scope after concatenation:
// InputQueue, SlotManager, SimpleController

class InputSync {
  /**
   * @param {IEmulator} emulatorAdapter - Emulator adapter
   * @param {Object} config - Configuration
   * @param {Object} sessionState - Session state manager
   * @param {Function} sendInputCallback - Callback to send input over network (frame, inputData)
   * @param {Function} onSlotChanged - Callback when slot assignments change (playerId, slot)
   */
  constructor(emulatorAdapter, config, sessionState, sendInputCallback, onSlotChanged) {
    console.log('[InputSync] Constructor called with:', {
      hasEmulatorAdapter: !!emulatorAdapter,
      config: config,
      hasSessionState: !!sessionState,
      hasSendInputCallback: !!sendInputCallback,
      hasOnSlotChanged: !!onSlotChanged
    });

    this.emulator = emulatorAdapter;
    this.config = config || {};
    this.sessionState = sessionState;
    this.sendInputCallback = sendInputCallback;

    // Input queue and slot management
    this.inputQueue = new InputQueue(config);

    // Create combined slot change callback
    const combinedOnSlotChanged = (playerId, slot) => {
      // Notify controller of slot change
      if (this.controller && typeof this.controller.handleSlotChange === 'function') {
        this.controller.handleSlotChange(playerId, slot);
      }
      // Call main slot change callback
      if (onSlotChanged) {
        onSlotChanged(playerId, slot);
      }
    };

    this.slotManager = new SlotManager({
      ...config,
      onSlotChanged: combinedOnSlotChanged
    });

    // Controller framework (simple for EmulatorJS)
    const framework = emulatorAdapter.getInputFramework();
    if (framework === "simple") {
      this.controller = new SimpleController(emulatorAdapter, config);
    } else {
      // Complex controller framework (for future native emulators)
      throw new Error("Complex controller framework not yet implemented");
    }

    // Set InputPayload class if available (will be set by loader)
    if (typeof InputPayload !== 'undefined') {
      this.setInputPayloadClass(InputPayload);
    }

    // Frame delay is now handled by the controller
    this.frameDelay = this.controller.frameDelay;


    // Input serialization/deserialization
    this.InputPayload = null; // Will be set when available
  }

  /**
   * Get current frame number.
   * @returns {number}
   */
  getCurrentFrame() {
    return this.controller.getCurrentFrame();
  }

  /**
   * Set current frame number.
   * @param {number} frame - Frame number
   */
  setCurrentFrame(frame) {
    this.controller.setCurrentFrame(frame);
  }

  /**
   * Initialize frame tracking (called when game starts).
   * @param {number} initFrame - Initial frame number from emulator
   */
  initializeFrames(initFrame) {
    this.controller.initializeFrames(initFrame);
  }

  /**
   * Update current frame from emulator (called each frame).
   * @param {number} emulatorFrame - Current frame from emulator
   */
  updateCurrentFrame(emulatorFrame) {
    this.currentFrame = parseInt(emulatorFrame, 10) - (this.initFrame || 0);
  }

  /**
   * Send input (from local player).
   * @param {number} playerIndex - Player index (0-3)
   * @param {number} inputIndex - Input index (0-29 for simple controllers)
   * @param {number} value - Input value (0/1 for buttons, -32767 to 32767 for analog)
   * @returns {boolean} True if input was sent/queued successfully
   */
  sendInput(playerIndex, inputIndex, value) {
    const isHost = this.sessionState?.isHostRole() || false;

    console.log("[InputSync] sendInput called:", {
      playerIndex,
      inputIndex,
      value,
      isHost
    });

    if (isHost) {
      // Host: Queue local input for processing
      return this.controller.queueLocalInput(playerIndex, inputIndex, value);
    } else {
      // Client: Send input to network
      return this.controller.sendInput(playerIndex, inputIndex, value, this.sendInputCallback, this);
    }
  }

  /**
   * Set the InputPayload class for serialization
   * @param {Function} InputPayloadClass - The InputPayload constructor
   */
  setInputPayloadClass(InputPayloadClass) {
    this.InputPayload = InputPayloadClass;
  }

  /**
   * Serialize input data for network transmission
   * @param {number} playerIndex
   * @param {number} inputIndex
   * @param {number} value
   * @returns {string} Serialized input data
   */
  serializeInput(playerIndex, inputIndex, value) {
    if (!this.InputPayload) {
      console.warn("[InputSync] InputPayload class not set, cannot serialize");
      return null;
    }

    const targetFrame = this.controller.getCurrentFrame() + this.frameDelay;
    const payload = new this.InputPayload(targetFrame, 0, playerIndex, inputIndex, value);
    return payload.serialize();
  }

  /**
   * Deserialize input data from network
   * @param {string|Object} data - Serialized input data
   * @returns {Object|null} Deserialized input payload
   */
  deserializeInput(data) {
    if (!this.InputPayload) {
      console.warn("[InputSync] InputPayload class not set, cannot deserialize");
      return null;
    }

    return this.InputPayload.deserialize(data);
  }

  /**
   * Handle remote input data (deserialize if needed and apply)
   * @param {string|Object|InputPayload} inputData - Serialized input data from network or InputPayload object
   * @param {string} fromSocketId - Source socket ID
   * @returns {boolean}
   */
  handleRemoteInput(inputData, fromSocketId = null) {
    let payload;

    // Check if inputData is already an InputPayload object
    if (inputData && typeof inputData.getFrame === 'function' && inputData.t === 'i') {
      // Already deserialized InputPayload object
      payload = inputData;
      console.log("[InputSync] Received pre-deserialized InputPayload:", payload);
    } else {
      // Need to deserialize
      payload = this.deserializeInput(inputData);
      if (!payload) {
        console.warn("[InputSync] Failed to deserialize remote input:", inputData);
        return false;
      }
    }

    console.log("[InputSync] Processing remote input:",
      `frame:${payload.getFrame()}, player:${payload.p}, input:${payload.k}, value:${payload.v}`);

    return this.controller.handleRemoteInput(payload, fromSocketId);
  }

  /**
   * Create a callback function for sending inputs over the network
   * This replaces the NetplayEngine's sendInputCallback logic
   * @param {Object} dataChannelManager - Reference to DataChannelManager
   * @param {Object} configManager - Reference to ConfigManager
   * @param {Object} emulator - Reference to emulator for slot info
   * @param {Object} socketTransport - Reference to SocketTransport for fallback
   * @param {Function} getPlayerSlot - Function to get current player's slot from playerTable
   * @returns {Function} Callback function for sending inputs
   */
  createSendInputCallback(dataChannelManager, configManager, emulator, socketTransport, getPlayerSlot) {
    return (frame, inputData) => {
      console.log("[InputSync] Send callback called:", { frame, inputData });

      if (!dataChannelManager) {
        console.warn("[InputSync] No DataChannelManager available");
        return;
      }

      // Use centralized slot getter if provided, otherwise fallback to old method
      const slot = getPlayerSlot ? getPlayerSlot() : (emulator?.netplay?.localSlot || 0);
      let allSent = true;

      if (Array.isArray(inputData)) {
        // Multiple inputs to send
        inputData.forEach((data) => {
          if (data.connected_input && data.connected_input.length === 3) {
            let [playerIndex, inputIndex, value] = data.connected_input;
            // Apply slot enforcement for network transmission
            playerIndex = this.controller.getEffectivePlayerIndex(playerIndex);
            const inputPayload = {
              frame: data.frame || frame || 0,
              slot: slot,
              playerIndex: playerIndex,
              inputIndex: inputIndex,
              value: value
            };
            const sent = dataChannelManager.sendInput(inputPayload);
            if (!sent) allSent = false;
          }
        });
      } else if (inputData.connected_input && inputData.connected_input.length === 3) {
        // Single input
        let [playerIndex, inputIndex, value] = inputData.connected_input;
        // Apply slot enforcement for network transmission
        playerIndex = this.controller.getEffectivePlayerIndex(playerIndex);
        const inputPayload = {
          frame: frame || inputData.frame || 0,
          slot: slot,
          playerIndex: playerIndex,
          inputIndex: inputIndex,
          value: value
        };
        console.log("[InputSync] Calling dataChannelManager.sendInput with:", inputPayload);
        const sent = dataChannelManager.sendInput(inputPayload);
        if (!sent) allSent = false;
      }

      // Handle P2P mode buffering
      if (dataChannelManager.mode === "unorderedP2P" || dataChannelManager.mode === "orderedP2P") {
        // In P2P modes, inputs are buffered if channels aren't ready
        // No fallback to Socket.IO for P2P modes
        return;
      }

      // For relay modes, fall back to Socket.IO if DataChannelManager failed
      if (!allSent && socketTransport && socketTransport.isConnected()) {
        console.log("[InputSync] Falling back to Socket.IO for input transmission");
        // Fallback to Socket.IO "sync-control" message
        if (Array.isArray(inputData)) {
          socketTransport.sendDataMessage({
            "sync-control": inputData,
          });
        } else {
          socketTransport.sendDataMessage({
            "sync-control": [inputData],
          });
        }
      }
    };
  }

  /**
   * Receive input from network (called when input arrives over network).
   * @param {number} frame - Target frame number
   * @param {Array<number>} connectedInput - [playerIndex, inputIndex, value]
   * @param {string} fromPlayerId - Source player ID (for logging)
   * @returns {boolean} True if input was queued successfully
   */
  receiveInput(frame, connectedInput, fromPlayerId = null) {
    // For backward compatibility, convert old format to new format
    // Create a mock InputPayload for the controller
    const mockPayload = {
      getFrame: () => frame,
      getConnectedInput: () => connectedInput
    };

    return this.controller.handleRemoteInput(mockPayload, fromPlayerId);
  }

  /**
   * Process inputs for current frame (called each frame on host).
   * Applies all inputs queued for the current frame and sends them to clients.
   * @returns {Array} Array of input data to send to clients
   */
  processFrameInputs() {
    const isHost = this.sessionState?.isHostRole() || false;

    if (!isHost) {
      return [];
    }

    // Delegate to controller
    const processedInputs = this.controller.processFrameInputs();

    // Send processed inputs to clients (for sync-control messages)
    // Note: In data channel mode, individual inputs are sent in sendInput(), not batched here
    if (processedInputs.length > 0 && this.sendInputCallback) {
      console.log("[InputSync] Host sending processed inputs to clients:", processedInputs);
      this.sendInputCallback(this.controller.getCurrentFrame(), processedInputs);
    }

    return processedInputs;
  }

  /**
   * Serialize input for network transmission (controller-agnostic).
   * @param {number} playerIndex
   * @param {number} inputIndex
   * @param {number} value
   * @returns {Object} Serialized input data
   */
  serializeInput(playerIndex, inputIndex, value) {
    const targetFrame = this.currentFrame + this.frameDelay;
    return {
      frame: targetFrame,
      connected_input: [playerIndex, inputIndex, value]
    };
  }

  /**
   * Reset input sync state.
   */
  reset() {
    this.controller.initializeFrames(0);
    this.inputQueue.clear();
  }

  /**
   * Cleanup resources.
   */
  cleanup() {
    this.reset();
    this.inputQueue = null;
    this.slotManager = null;
    this.controller = null;
  }
}

// Expose as global for concatenated builds
window.InputSync = InputSync;
