/**
 * SimpleController - Simple controller framework
 *
 * For EmulatorJS-style controllers (SNES, Genesis, etc.):
 * - Fixed 30 inputs per frame per player
 * - Player indices 0-3
 * - Input indices 0-29
 * - Values: 0/1 for buttons, -32767 to 32767 for analog
 */

class SimpleController {
  constructor(emulatorAdapter, config = {}) {
    this.maxInputs = 30;
    this.maxPlayers = 4;
    this.emulator = emulatorAdapter;
    this.config = config;

    // Input storage: frame -> array of input data
    this.inputsData = {};
    this.currentFrame = null;
    this.frameDelay = 20; // Default frame delay for input synchronization

    // Edge-trigger optimization: track last known values to avoid sending unchanged inputs
    this.lastInputValues = {}; // key: `${playerIndex}-${inputIndex}`, value: last sent value

    // Slot change callback to clear cache when slots change
    this.onSlotChanged = config?.onSlotChanged;

    // Callback to get current player slot (consistent with UI)
    this.getCurrentSlot = config?.getCurrentSlot;
  }

  /**
   * Validate input message for simple controller.
   * @param {Object} input - Input message
   * @returns {boolean} True if valid
   */
  validateInput(input) {
    if (
      typeof input.playerIndex !== "number" ||
      input.playerIndex < 0 ||
      input.playerIndex >= this.maxPlayers
    ) {
      return false;
    }
    if (
      typeof input.inputIndex !== "number" ||
      input.inputIndex < 0 ||
      input.inputIndex >= this.maxInputs
    ) {
      return false;
    }
    if (typeof input.value !== "number") {
      return false;
    }
    return true;
  }

  /**
   * Set current frame for input processing.
   * @param {number} frame
   */
  setCurrentFrame(frame) {
    this.currentFrame = frame;
  }

  /**
   * Get current frame.
   * @returns {number}
   */
  getCurrentFrame() {
    return this.currentFrame;
  }

  /**
   * Initialize frame tracking.
   * @param {number} initFrame
   */
  initializeFrames(initFrame) {
    this.currentFrame = 0;
    this.inputsData = {};
  }

  /**
   * Queue local input for processing (simple controller specific logic).
   * @param {number} playerIndex
   * @param {number} inputIndex
   * @param {number} value
   * @returns {boolean}
   */
  queueLocalInput(playerIndex, inputIndex, value) {
    // Store original playerIndex for local simulation
    // Slot enforcement will happen in the send callback

    // Edge-trigger optimization (simple controller specific)
    const inputKey = `${playerIndex}-${inputIndex}`;
    const lastValue = this.lastInputValues[inputKey];
    if (lastValue === value) {
      console.log("[SimpleController] Skipping unchanged input:", {
        playerIndex: playerIndex,
        inputIndex,
        value,
      });
      return true; // Not an error, just no change
    }
    this.lastInputValues[inputKey] = value;

    if (!this.validateInput({ playerIndex: playerIndex, inputIndex, value })) {
      console.warn("[SimpleController] Invalid local input:", {
        playerIndex: playerIndex,
        inputIndex,
        value,
      });
      return false;
    }

    // Store input for current frame
    const currentFrame =
      this.currentFrame !== null && this.currentFrame !== undefined
        ? this.currentFrame
        : 0;

    if (!this.inputsData[currentFrame]) {
      this.inputsData[currentFrame] = [];
    }

    this.inputsData[currentFrame].push({
      frame: currentFrame,
      connected_input: [playerIndex, inputIndex, value],
      fromRemote: false,
    });

    console.log("[SimpleController] Queued local input:", {
      frame: currentFrame,
      playerIndex: playerIndex,
      inputIndex,
      value,
    });

    return true;
  }

  /**
   * Apply effective player index with slot enforcement (simple controller specific).
   * @param {number} requestedPlayerIndex - Requested player index
   * @returns {number} Effective player index (0-3)
   */
  getEffectivePlayerIndex(requestedPlayerIndex) {
    let playerIndex = parseInt(requestedPlayerIndex, 10);
    if (isNaN(playerIndex)) playerIndex = 0;
    if (playerIndex < 0) playerIndex = 0;
    if (playerIndex > 3) playerIndex = 3;

    // Slot enforcement: use the lobby-selected slot for all players (host and client)
    // This ensures inputs are sent with the correct player index based on assigned slot
    const globalPreferredSlot =
      typeof window.EJS_NETPLAY_PREFERRED_SLOT === "number"
        ? window.EJS_NETPLAY_PREFERRED_SLOT
        : null;

    const preferredSlot =
      globalPreferredSlot !== null
        ? globalPreferredSlot
        : (typeof window !== "undefined" && window.EJS_netplay?.localSlot) ||
          0;
    const slot = parseInt(preferredSlot, 10);
    if (!isNaN(slot) && slot >= 0 && slot <= 3) {
      if (playerIndex !== slot) {
        console.log(
          "[SimpleController] Slot enforcement: requested playerIndex",
          playerIndex,
          "-> enforced slot",
          slot,
        );
      }
      playerIndex = slot;
    }

    return playerIndex;
  }

  /**
   * Handle remote input from network.
   * @param {InputPayload} payload
   * @param {string} fromSocketId
   * @returns {boolean}
   */
  handleRemoteInput(payload, fromSocketId = null) {
    const connectedInput = payload.getConnectedInput();

    if (
      !this.validateInput({
        playerIndex: connectedInput[0],
        inputIndex: connectedInput[1],
        value: connectedInput[2],
      })
    ) {
      console.warn("[SimpleController] Invalid remote input:", connectedInput);
      return false;
    }

    // Apply remote input immediately (delay-sync mode)
    const [playerIndex, inputIndex, value] = connectedInput;

    console.log("[SimpleController] Applying remote input immediately:", {
      playerIndex,
      inputIndex,
      value,
      fromSocketId,
    });

    if (this.emulator && typeof this.emulator.simulateInput === "function") {
      this.emulator.simulateInput(playerIndex, inputIndex, value);
    } else {
      console.warn(
        "[SimpleController] No emulator available to apply remote input",
      );
    }

    return true;
  }

  /**
   * Process all inputs for the current frame and apply to emulator.
   * @returns {Array} Array of inputs processed
   */
  processFrameInputs() {
    const frame = this.currentFrame;

    console.log(`[SimpleController] Processing inputs for frame ${frame}`);

    if (!this.inputsData[frame]) {
      console.log(`[SimpleController] No inputs queued for frame ${frame}`);
      return [];
    }

    const inputsForFrame = this.inputsData[frame];
    const processedInputs = [];

    console.log(
      `[SimpleController] Applying ${inputsForFrame.length} inputs for frame ${frame}`,
    );

    // Apply each input to the emulator
    inputsForFrame.forEach((inputData, index) => {
      const [playerIndex, inputIndex, value] = inputData.connected_input;

      console.log(
        `[SimpleController] Frame ${frame} - Applying input ${index + 1}/${inputsForFrame.length}:`,
        `player ${playerIndex}, input ${inputIndex}, value ${value}, remote: ${inputData.fromRemote}`,
      );

      // Apply input to emulator (remote inputs are already applied immediately)
      if (this.emulator && typeof this.emulator.simulateInput === "function") {
        this.emulator.simulateInput(playerIndex, inputIndex, value);
      }

      processedInputs.push({
        frame: frame,
        connected_input: [playerIndex, inputIndex, value],
        fromRemote: inputData.fromRemote,
      });
    });

    // Clean up processed inputs
    delete this.inputsData[frame];

    // Memory cleanup: remove old frames
    const maxAge = 120;
    const cutoffFrame = frame - maxAge;
    for (const oldFrame of Object.keys(this.inputsData)) {
      if (parseInt(oldFrame, 10) < cutoffFrame) {
        delete this.inputsData[oldFrame];
      }
    }

    return processedInputs;
  }

  /**
   * Send input to network (for clients in delay-sync mode).
   * @param {number} playerIndex
   * @param {number} inputIndex
   * @param {number} value
   * @param {Function} sendCallback
   * @returns {boolean}
   */
  sendInput(playerIndex, inputIndex, value, sendCallback, inputSync) {
    // Apply slot enforcement (simple controller specific)
    const effectivePlayerIndex = this.getEffectivePlayerIndex(playerIndex);

    // Edge-trigger optimization (simple controller specific)
    const inputKey = `${effectivePlayerIndex}-${inputIndex}`;
    const lastValue = this.lastInputValues[inputKey];
    if (lastValue === value) {
      console.log("[SimpleController] Skipping unchanged input:", {
        playerIndex: effectivePlayerIndex,
        inputIndex,
        value,
      });
      return true; // Not an error, just no change
    }
    this.lastInputValues[inputKey] = value;

    if (
      !this.validateInput({
        playerIndex: effectivePlayerIndex,
        inputIndex,
        value,
      })
    ) {
      return false;
    }

    console.log("[SimpleController] Sending input to network:", {
      currentFrame: this.currentFrame,
      playerIndex: effectivePlayerIndex,
      inputIndex,
      value,
    });

    if (sendCallback && inputSync) {
      // Use InputSync's serialization (maintains frame delay logic)
      const inputData = inputSync.serializeInput(
        effectivePlayerIndex,
        inputIndex,
        value,
      );
      console.log("[SimpleController] Sending input via callback:", inputData);
      sendCallback(inputData.frame, inputData);
    }

    return true;
  }

  /**
   * Create empty input state array.
   * @returns {number[]} Array of 30 zeros
   */
  createInputState() {
    return new Array(this.maxInputs).fill(0);
  }

  /**
   * Get maximum inputs per player.
   * @returns {number}
   */
  getMaxInputs() {
    return this.maxInputs;
  }

  /**
   * Get maximum players.
   * @returns {number}
   */
  getMaxPlayers() {
    return this.maxPlayers;
  }

  /**
   * Handle slot change notification (clear edge-trigger cache)
   * @param {string} playerId - Player whose slot changed
   * @param {number|null} newSlot - New slot assignment
   */
  handleSlotChange(playerId, newSlot) {
    console.log(
      "[SimpleController] Slot changed, clearing edge-trigger cache for player:",
      playerId,
    );
    // Clear the entire cache when any slot changes to ensure clean state
    this.lastInputValues = {};
  }
}

window.SimpleController = SimpleController;
