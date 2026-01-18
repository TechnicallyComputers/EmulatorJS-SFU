/**
 * Emulator Interface Definition
 *
 * This interface defines the contract that emulator adapters must implement
 * to work with the netplay core module. All methods use primitive types where
 * possible for maximum portability across languages (JS -> C++/Java/Kotlin).
 *
 * @interface IEmulator
 */

/**
 * Simulate input in the emulator core.
 * All parameters are primitive numbers for portability.
 *
 * @param {number} playerIndex - Player index (0-3 for standard, 0-7 for complex controllers)
 * @param {number} inputIndex - Input index (0-29 for simple, variable for complex)
 * @param {number} value - Input value (0/1 for buttons, -32767 to 32767 for analog)
 */
function simulateInput(playerIndex, inputIndex, value) {}

/**
 * Get the current frame number from the emulator.
 * @returns {number} Current frame number
 */
function getCurrentFrame() {}

/**
 * Set the current frame number in the emulator.
 * @param {number} frame - Frame number to set
 */
function setCurrentFrame(frame) {}

/**
 * Subscribe to frame change events.
 * @param {function(number): void} callback - Called when frame changes
 * @returns {function(): void} Unsubscribe function
 */
function onFrame(callback) {}

/**
 * Capture video stream from emulator.
 * Returns standard Web API MediaStream (native adapters will bridge).
 *
 * @param {number} fps - Target frames per second
 * @returns {Promise<MediaStream | null>} Video stream or null on failure
 */
async function captureVideoStream(fps) {}

/**
 * Capture audio stream from emulator.
 * Returns standard Web API MediaStream (native adapters will bridge).
 *
 * @returns {Promise<MediaStream | null>} Audio stream or null on failure
 */
async function captureAudioStream() {}

/**
 * Pause emulation.
 */
function pause() {}

/**
 * Resume emulation.
 */
function resume() {}

/**
 * Check if emulation is paused.
 * @returns {boolean} True if paused
 */
function isPaused() {}

/**
 * Subscribe to pause state changes.
 * @param {function(boolean): void} callback - Called when pause state changes
 * @returns {function(): void} Unsubscribe function
 */
function onPauseChange(callback) {}

/**
 * Get emulator information for metadata validation.
 * @returns {{core: string, version: string}} Emulator core and version
 */
function getEmulatorInfo() {}

/**
 * Get ROM information for hash validation.
 * @returns {{hash: string, size: number, name: string} | null} ROM info or null if no ROM loaded
 */
function getROMInfo() {}

/**
 * Get the input framework type used by this emulator.
 * @returns {"simple" | "complex"} Framework type
 */
function getInputFramework() {}

/**
 * Get the controller type identifier.
 * @returns {string} Controller type ("standard", "switch", "ps3", "wii", "xbox", etc.)
 */
function getControllerType() {}

/**
 * Display a message to the user (optional - can be no-op in native emulators).
 * @param {string} message - Message to display
 * @param {number} durationMs - Duration in milliseconds
 */
function displayMessage(message, durationMs) {}

/**
 * Show an overlay (optional - can be no-op in native emulators).
 * @param {string} type - Overlay type identifier
 * @param {*} data - Overlay data (any type)
 */
function showOverlay(type, data) {}

/**
 * Hide an overlay (optional - can be no-op in native emulators).
 * @param {string} type - Overlay type identifier
 */
function hideOverlay(type) {}

/**
 * IEmulator Interface Documentation
 *
 * This interface is designed for portability:
 * - All numeric types are primitive numbers
 * - Media streams use standard Web APIs (MediaStream)
 * - Complex objects only for metadata (emulator info, ROM info)
 * - UI methods are optional (can be no-op)
 *
 * For future C++/Java/Kotlin ports:
 * - Numbers map to int/float in target language
 * - MediaStream becomes platform-specific stream interface
 * - Callbacks use language-native patterns (function pointers, interfaces, closures)
 */
window.IEmulator = {
  simulateInput,
  getCurrentFrame,
  setCurrentFrame,
  onFrame,
  captureVideoStream,
  captureAudioStream,
  pause,
  resume,
  isPaused,
  onPauseChange,
  getEmulatorInfo,
  getROMInfo,
  getInputFramework,
  getControllerType,
  displayMessage,
  showOverlay,
  hideOverlay,
};
