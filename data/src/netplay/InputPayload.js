/**
 * InputPayload - Canonical wire format for netplay inputs
 *
 * Flat, efficient format for input transmission over data channels.
 * Maps directly to emulator.simulateInput() parameters.
 */

// Canonical wire format constants
const INPUT_MESSAGE_TYPE = "i";

// InputPayload class for type safety and utilities
class InputPayload {
  /**
   * Create a new input payload.
   * @param {number} frame - Target frame (already delayed)
   * @param {number} slot - Player slot
   * @param {number} playerIndex - Player index
   * @param {number} inputIndex - Input index
   * @param {number} value - Input value
   */
  constructor(frame, slot, playerIndex, inputIndex, value) {
    this.t = INPUT_MESSAGE_TYPE; // type: "i" for input
    this.f = frame;              // target frame (already delayed)
    this.s = slot;               // player slot
    this.p = playerIndex;        // player index
    this.k = inputIndex;         // input index/key
    this.v = value;              // input value
    console.log("[InputPayload] Created with:", { frame, slot, playerIndex, inputIndex, value }, "result:", this);
  }

  /**
   * Serialize to JSON string for network transmission.
   * @returns {string}
   */
  serialize() {
    console.log("[InputPayload] Serializing object:", this);
    console.log("[InputPayload] Properties:", {
      t: this.t,
      f: this.f,
      s: this.s,
      p: this.p,
      k: this.k,
      v: this.v
    });
    const jsonString = JSON.stringify(this);
    console.log("[InputPayload] Serialized:", jsonString, "length:", jsonString.length);
    return jsonString;
  }

  /**
   * Deserialize from JSON string or object.
   * @param {string|object} input - JSON string or parsed object
   * @returns {InputPayload|null}
   */
  static deserialize(input) {
    try {
      let data;
      if (typeof input === 'string') {
        data = JSON.parse(input);
      } else if (typeof input === 'object' && input !== null) {
        data = input;
      } else {
        console.warn("[InputPayload] Invalid input type for deserialization:", typeof input);
        return null;
      }

      if (data.t === INPUT_MESSAGE_TYPE &&
          typeof data.f === 'number' &&
          typeof data.s === 'number' &&
          typeof data.p === 'number' &&
          typeof data.k === 'number' &&
          typeof data.v === 'number') {
        const payload = new InputPayload(data.f, data.s, data.p, data.k, data.v);
        return payload;
      } else {
        console.warn("[InputPayload] Invalid data structure:", data);
      }
    } catch (error) {
      console.warn("[InputPayload] Failed to deserialize:", error);
    }
    return null;
  }

  /**
   * Get the connected input array for InputSync.receiveInput().
   * @returns {Array<number>} [playerIndex, inputIndex, value]
   */
  getConnectedInput() {
    return [this.p, this.k, this.v];
  }

  /**
   * Get frame number.
   * @returns {number}
   */
  getFrame() {
    return this.f;
  }

  /**
   * Get slot number.
   * @returns {number}
   */
  getSlot() {
    return this.s;
  }
}

// Expose globally for concatenated builds
window.InputPayload = InputPayload;

// Export for ES modules if needed
if (typeof module !== 'undefined' && module.exports) {
  module.exports = InputPayload;
}