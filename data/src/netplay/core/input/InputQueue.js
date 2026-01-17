/**
 * InputQueue - Input buffering and retry logic
 *
 * Manages input queue for:
 * - Input buffering
 * - Retry logic for lost inputs
 * - Unordered retry handling
 */

class InputQueue {
  /**
   * @param {Object} config - Configuration
   * @param {number} config.unorderedRetries - Number of unordered retries (default: 0)
   */
  constructor(config = {}) {
    this.config = config;
    this.unorderedRetries = config.unorderedRetries || 0;
    this.queue = [];
    this.retryQueue = [];
  }

  /**
   * Enqueue input for sending.
   * @param {Object} input - Input data {frame, connected_input, ...}
   */
  enqueue(input) {
    this.queue.push({
      ...input,
      retryCount: 0,
      timestamp: Date.now(),
    });
  }

  /**
   * Dequeue inputs for a specific frame.
   * @param {number} frame - Target frame number
   * @returns {Array} Array of input data for the frame
   */
  dequeue(frame) {
    const inputs = this.queue.filter((item) => item.frame === frame);
    this.queue = this.queue.filter((item) => item.frame !== frame);
    return inputs;
  }

  /**
   * Get inputs for a specific frame without removing them.
   * @param {number} frame - Target frame number
   * @returns {Array} Array of input data for the frame
   */
  peek(frame) {
    return this.queue.filter((item) => item.frame === frame);
  }

  /**
   * Mark input as acknowledged (for retry logic).
   * @param {number} frame - Acknowledged frame number
   */
  acknowledge(frame) {
    // Remove acknowledged inputs from queue
    this.queue = this.queue.filter((item) => item.frame !== frame);
  }

  /**
   * Get inputs that need retry (for unordered mode).
   * @param {number} currentFrame - Current frame number
   * @param {number} maxAge - Maximum frame age for retry
   * @returns {Array} Array of inputs that should be retried
   */
  getRetryInputs(currentFrame, maxAge = 3) {
    if (this.unorderedRetries <= 0) {
      return [];
    }

    const retryInputs = [];
    this.queue.forEach((item) => {
      if (
        item.frame < currentFrame &&
        currentFrame - item.frame <= maxAge &&
        item.retryCount < this.unorderedRetries
      ) {
        item.retryCount++;
        retryInputs.push(item);
      }
    });

    return retryInputs;
  }

  /**
   * Clear all queued inputs.
   */
  clear() {
    this.queue = [];
    this.retryQueue = [];
  }

  /**
   * Get queue size.
   * @returns {number} Number of queued inputs
   */
  size() {
    return this.queue.length;
  }
}

window.InputQueue = InputQueue;
