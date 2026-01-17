/**
 * FrameCounter - Frame counting logic for netplay
 * 
 * Manages frame counting and synchronization between emulator and netplay core.
 */

class FrameCounter {
  /**
   * @param {IEmulator} emulatorAdapter - Emulator adapter
   */
  constructor(emulatorAdapter) {
    this.emulator = emulatorAdapter;
    this.frameOffset = 0;
    this.frameDelay = 0;
  }

  /**
   * Get current frame (emulator frame + offset).
   * @returns {number}
   */
  getCurrentFrame() {
    const emulatorFrame = this.emulator.getCurrentFrame();
    return emulatorFrame + this.frameOffset;
  }

  /**
   * Set current frame in emulator (adjusting for offset).
   * @param {number} frame - Target frame number
   */
  setCurrentFrame(frame) {
    const targetEmulatorFrame = frame - this.frameOffset;
    this.emulator.setCurrentFrame(targetEmulatorFrame);
  }

  /**
   * Get frame offset.
   * @returns {number}
   */
  getFrameOffset() {
    return this.frameOffset;
  }

  /**
   * Set frame offset.
   * @param {number} offset - Frame offset
   */
  setFrameOffset(offset) {
    this.frameOffset = offset;
  }

  /**
   * Get frame delay.
   * @returns {number}
   */
  getFrameDelay() {
    return this.frameDelay;
  }

  /**
   * Set frame delay.
   * @param {number} delay - Frame delay
   */
  setFrameDelay(delay) {
    this.frameDelay = delay;
  }

  /**
   * Reset frame counter to initial state.
   */
  reset() {
    this.frameOffset = 0;
    this.frameDelay = 0;
  }
}

window.FrameCounter = FrameCounter;
