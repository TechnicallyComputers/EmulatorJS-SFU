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
  constructor() {
    this.maxInputs = 30;
    this.maxPlayers = 4;
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
