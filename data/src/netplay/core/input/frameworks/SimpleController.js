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
  constructor(emulatorAdapter) {
    this.maxInputs = 30;
    this.maxPlayers = 4;
    this.emulator = emulatorAdapter;

    // Input storage: frame -> array of input data
    this.inputsData = {};
    this.currentFrame = null;
    this.frameDelay = 20; // Default frame delay for input synchronization
  }

  /**
   * Validate input message for simple controller.
   * @param {Object} input - Input message
   * @returns {boolean} True if valid
   */
  validateInput(input) {
    if (typeof input.playerIndex !== "number" ||
        input.playerIndex < 0 || input.playerIndex >= this.maxPlayers) {
      return false;
    }
    if (typeof input.inputIndex !== "number" ||
        input.inputIndex < 0 || input.inputIndex >= this.maxInputs) {
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
   * Queue local input for processing.
   * @param {number} playerIndex
   * @param {number} inputIndex
   * @param {number} value
   * @returns {boolean}
   */
  queueLocalInput(playerIndex, inputIndex, value) {
    if (!this.validateInput({ playerIndex, inputIndex, value })) {
      console.warn("[SimpleController] Invalid local input:", { playerIndex, inputIndex, value });
      return false;
    }

    // Store input for current frame
    const currentFrame = this.currentFrame !== null && this.currentFrame !== undefined ? this.currentFrame : 0;

    if (!this.inputsData[currentFrame]) {
      this.inputsData[currentFrame] = [];
    }

    this.inputsData[currentFrame].push({
      frame: currentFrame,
      connected_input: [playerIndex, inputIndex, value],
      fromRemote: false
    });

    console.log("[SimpleController] Queued local input:", {
      frame: currentFrame,
      playerIndex,
      inputIndex,
      value
    });

    return true;
  }

  /**
   * Handle remote input from network.
   * @param {InputPayload} payload
   * @param {string} fromSocketId
   * @returns {boolean}
   */
  handleRemoteInput(payload, fromSocketId = null) {
    const connectedInput = payload.getConnectedInput();

    if (!this.validateInput({
      playerIndex: connectedInput[0],
      inputIndex: connectedInput[1],
      value: connectedInput[2]
    })) {
      console.warn("[SimpleController] Invalid remote input:", connectedInput);
      return false;
    }

    // Apply remote input immediately (delay-sync mode)
    const [playerIndex, inputIndex, value] = connectedInput;

    console.log("[SimpleController] Applying remote input immediately:", {
      playerIndex,
      inputIndex,
      value,
      fromSocketId
    });

    if (this.emulator && typeof this.emulator.simulateInput === 'function') {
      this.emulator.simulateInput(playerIndex, inputIndex, value);
    } else {
      console.warn("[SimpleController] No emulator available to apply remote input");
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

    console.log(`[SimpleController] Applying ${inputsForFrame.length} inputs for frame ${frame}`);

    // Apply each input to the emulator
    inputsForFrame.forEach((inputData, index) => {
      const [playerIndex, inputIndex, value] = inputData.connected_input;

      console.log(`[SimpleController] Frame ${frame} - Applying input ${index + 1}/${inputsForFrame.length}:`,
        `player ${playerIndex}, input ${inputIndex}, value ${value}, remote: ${inputData.fromRemote}`);

      // Apply input to emulator (remote inputs are already applied immediately)
      if (this.emulator && typeof this.emulator.simulateInput === 'function') {
        this.emulator.simulateInput(playerIndex, inputIndex, value);
      }

      processedInputs.push({
        frame: frame,
        connected_input: [playerIndex, inputIndex, value],
        fromRemote: inputData.fromRemote
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
  sendInput(playerIndex, inputIndex, value, sendCallback) {
    if (!this.validateInput({ playerIndex, inputIndex, value })) {
      return false;
    }

    const targetFrame = this.currentFrame + this.frameDelay;

    if (sendCallback) {
      const inputData = {
        frame: targetFrame,
        connected_input: [playerIndex, inputIndex, value]
      };
      console.log("[SimpleController] Sending input to network:", inputData);
      sendCallback(targetFrame, inputData);
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
}

window.SimpleController = SimpleController;
