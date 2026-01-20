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
   */
  constructor(emulatorAdapter, config, sessionState, sendInputCallback) {
    console.log('[InputSync] Constructor called with:', {
      hasEmulatorAdapter: !!emulatorAdapter,
      config: config,
      hasSessionState: !!sessionState,
      hasSendInputCallback: !!sendInputCallback
    });

    this.emulator = emulatorAdapter;
    this.config = config || {};
    this.sessionState = sessionState;
    this.sendInputCallback = sendInputCallback;

    // Input storage: frame -> array of input data
    this.inputsData = {};
    this.initFrame = 0;
    this.currentFrame = null; // Null until frames are initialized

    // Input queue and slot management
    this.inputQueue = new InputQueue(config);
    this.slotManager = new SlotManager(config);

    // Controller framework (simple for EmulatorJS)
    const framework = emulatorAdapter.getInputFramework();
    if (framework === "simple") {
      this.controller = new SimpleController();
    } else {
      // Complex controller framework (for future native emulators)
      throw new Error("Complex controller framework not yet implemented");
    }

    // Frame delay for input synchronization (host sends inputs with +20 frame offset)
    this.frameDelay = this.config.frameDelay || 20;
  }

  /**
   * Get current frame number.
   * @returns {number}
   */
  getCurrentFrame() {
    return this.currentFrame;
  }

  /**
   * Set current frame number.
   * @param {number} frame - Frame number
   */
  setCurrentFrame(frame) {
    this.currentFrame = frame;
  }

  /**
   * Initialize frame tracking (called when game starts).
   * @param {number} initFrame - Initial frame number from emulator
   */
  initializeFrames(initFrame) {
    this.initFrame = initFrame;
    this.currentFrame = 0;
    this.inputsData = {};
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
    // Validate input
    if (!this.controller.validateInput({ playerIndex, inputIndex, value })) {
      console.warn("[InputSync] Invalid input:", { playerIndex, inputIndex, value });
      return false;
    }

    // Apply slot enforcement for clients
    const actualPlayerIndex = this.getEffectivePlayerIndex(playerIndex);

    // Handle frame timing: use current frame if available, otherwise use 0
    // This allows inputs before game starts (menus, etc.)
    const frame = (this.currentFrame !== null && this.currentFrame !== undefined) ? this.currentFrame : 0;
    const isHost = this.sessionState?.isHostRole() || false;

    console.log("[InputSync] sendInput called:", {
      requestedPlayerIndex: playerIndex,
      actualPlayerIndex: actualPlayerIndex,
      inputIndex,
      value,
      frame,
      isHost,
      slot: actualPlayerIndex
    });

    if (isHost) {
      // Host: Store input in queue and apply immediately
      if (!this.inputsData[frame]) {
        this.inputsData[frame] = [];
      }
      this.inputsData[frame].push({
        frame: frame,
        connected_input: [actualPlayerIndex, inputIndex, value],
      });

      // Queue input for processing in processFrameInputs() - host does NOT send immediately
      // This prevents double-sending and ensures proper frame alignment
      console.log("[InputSync] Host queued input for frame processing:", {
        frame,
        connected_input: [actualPlayerIndex, inputIndex, value]
      });
    } else {
      // Client (delay-sync mode): DO NOT apply input locally
      // Clients only send inputs to host - all simulation is done by host
      console.log("[InputSync] Client queuing input for network send (not applying locally):", {
        frame: frame + this.frameDelay,
        connected_input: [actualPlayerIndex, inputIndex, value]
      });

      // Send input with frame delay
      if (this.sendInputCallback) {
        const inputData = {
          frame: frame + this.frameDelay,
          connected_input: [actualPlayerIndex, inputIndex, value],
        };
        console.log("[InputSync] Client sending input via callback:", inputData);
        this.sendInputCallback(frame + this.frameDelay, inputData);
      } else {
        console.warn("[InputSync] sendInputCallback not available, input not sent");
      }
    }

    return true;
  }
  
  /**
   * Receive input from network (called when input arrives over network).
   * @param {number} frame - Target frame number
   * @param {Array<number>} connectedInput - [playerIndex, inputIndex, value]
   * @param {string} fromPlayerId - Source player ID (for logging)
   * @returns {boolean} True if input was queued successfully
   */
  receiveInput(frame, connectedInput, fromPlayerId = null) {
    if (!connectedInput || connectedInput.length !== 3 || connectedInput[0] < 0) {
      return false;
    }

    const [playerIndex, inputIndex, value] = connectedInput;

    // Validate input
    if (!this.controller.validateInput({ playerIndex, inputIndex, value })) {
      console.warn("[InputSync] Invalid received input:", { playerIndex, inputIndex, value });
      return false;
    }

    const inFrame = parseInt(frame, 10);

    // Store input in queue
    if (!this.inputsData[inFrame]) {
      this.inputsData[inFrame] = [];
    }
    this.inputsData[inFrame].push({
      frame: inFrame,
      connected_input: connectedInput,
      fromPlayerId: fromPlayerId,
    });

    // Send frame acknowledgment (for Socket.IO mode)
    // Note: Data channel mode doesn't need explicit acks

    return true;
  }

  /**
   * Process inputs for current frame (called each frame on host).
   * Applies all inputs queued for the current frame and sends them to clients.
   * @returns {Array} Array of input data to send to clients
   */
  processFrameInputs() {
    const frame = this.currentFrame;
    const isHost = this.sessionState?.isHostRole() || false;

    console.log(`[InputSync] processFrameInputs called for frame ${frame}, isHost: ${isHost}`);

    if (!isHost || !this.inputsData[frame]) {
      if (!this.inputsData[frame]) {
        console.log(`[InputSync] No inputs queued for frame ${frame}`);
      }
      return [];
    }

    const toSend = [];
    const inputsForFrame = this.inputsData[frame];

    console.log(`[InputSync] Processing ${inputsForFrame.length} inputs for frame ${frame}`);

    // Process each input for this frame
    inputsForFrame.forEach((inputData, index) => {
      const [playerIndex, inputIndex, value] = inputData.connected_input;

      console.log(`[InputSync] Applying input ${index + 1}/${inputsForFrame.length}: player ${playerIndex}, input ${inputIndex}, value ${value}`);

      // Apply input (replay for host, including remote inputs)
      // Note: Host applies both local and remote inputs here
      this.emulator.simulateInput(playerIndex, inputIndex, value);

      // Prepare input for sending to clients (with frame delay)
      const sendData = {
        frame: frame + this.frameDelay,
        connected_input: [playerIndex, inputIndex, value],
      };
      toSend.push(sendData);
    });

    // Clear processed inputs
    delete this.inputsData[frame];

    // Memory cleanup: remove old frames to prevent unbounded memory growth
    const maxAge = 120; // Keep 120 frames of history
    const cutoffFrame = frame - maxAge;
    for (const oldFrame of Object.keys(this.inputsData)) {
      if (parseInt(oldFrame, 10) < cutoffFrame) {
        delete this.inputsData[oldFrame];
      }
    }

    // Send inputs to clients (if callback is set)
    if (toSend.length > 0 && this.sendInputCallback) {
      // For Socket.IO mode, send as "sync-control" array
      // For data channel mode, inputs are sent individually in sendInput()
      // This callback handles Socket.IO mode
      this.sendInputCallback(frame, toSend);
    }

    return toSend;
  }

  /**
   * Get effective player index (applies slot enforcement for clients).
   * @param {number} requestedPlayerIndex - Requested player index
   * @returns {number} Effective player index (0-3)
   */
  getEffectivePlayerIndex(requestedPlayerIndex) {
    let playerIndex = parseInt(requestedPlayerIndex, 10);
    if (isNaN(playerIndex)) playerIndex = 0;
    if (playerIndex < 0) playerIndex = 0;
    if (playerIndex > 3) playerIndex = 3;

    // Client slot enforcement: use the lobby-selected slot
    const isHost = this.sessionState?.isHostRole() || false;
    if (!isHost) {
      // Check global slot preference first (updated when user changes slot in UI)
      const globalPreferredSlot = typeof window.EJS_NETPLAY_PREFERRED_SLOT === "number" 
        ? window.EJS_NETPLAY_PREFERRED_SLOT 
        : null;
      
      const preferredSlot = globalPreferredSlot !== null ? globalPreferredSlot :
                           this.config.preferredSlot || 
                           this.sessionState?.localSlot || 
                           0;
      const slot = parseInt(preferredSlot, 10);
      if (!isNaN(slot) && slot >= 0 && slot <= 3) {
        if (playerIndex !== slot) {
          console.log("[InputSync] Slot enforcement: requested playerIndex", playerIndex, "-> enforced slot", slot);
        }
        playerIndex = slot;
      }
    }

    return playerIndex;
  }

  /**
   * Reset input sync state.
   */
  reset() {
    this.inputsData = {};
    this.currentFrame = 0;
    this.initFrame = 0;
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
