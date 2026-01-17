/**
 * EmulatorJSAdapter - Thin adapter layer for EmulatorJS
 * 
 * Translates EmulatorJS-specific operations to IEmulator interface.
 * This allows the netplay core to work with EmulatorJS without
 * tight coupling to EmulatorJS internals.
 * 
 * TODO: Implement in Phase 2+
 */


// #region agent log
try {
  fetch("http://127.0.0.1:7242/ingest/22e800bc-6bc6-4492-ae2b-c74b05fdebc4",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({location:"EmulatorJSAdapter.js:11",message:"EmulatorJSAdapter.js script executing",data:{},timestamp:Date.now(),sessionId:"debug-session",runId:"run1",hypothesisId:"C"})}).catch((e)=>{console.error("Fetch error:",e)});
} catch(e) {
  console.error("Error in EmulatorJSAdapter.js instrumentation:", e);
}
// #endregion
console.log("[EmulatorJSAdapter] Script loaded and executing");

class EmulatorJSAdapter {
  /**
   * @param {EmulatorJS} emulatorInstance - EmulatorJS instance
   */
  constructor(emulatorInstance) {
    this.emulator = emulatorInstance;
    this._frameCallbacks = new Set();
    this._pauseCallbacks = new Set();
  }

  /**
   * Simulate input in EmulatorJS.
   * @param {number} playerIndex - Player index (0-3)
   * @param {number} inputIndex - Input index (0-29)
   * @param {number} value - Input value
   */
  simulateInput(playerIndex, inputIndex, value) {
    if (this.emulator.gameManager?.functions?.simulateInput) {
      this.emulator.gameManager.functions.simulateInput(
        playerIndex,
        inputIndex,
        value
      );
    } else if (this.emulator.netplay?._ejsRawSimulateInputFn) {
      this.emulator.netplay._ejsRawSimulateInputFn(
        playerIndex,
        inputIndex,
        value
      );
    } else {
      console.warn("[EmulatorJSAdapter] simulateInput not available");
    }
  }

  /**
   * Get current frame from EmulatorJS.
   * @returns {number}
   */
  getCurrentFrame() {
    return this.emulator.netplay?.currentFrame || 0;
  }

  /**
   * Set current frame in EmulatorJS.
   * @param {number} frame - Frame number
   */
  setCurrentFrame(frame) {
    if (this.emulator.netplay) {
      this.emulator.netplay.currentFrame = frame;
    }
  }

  /**
   * Subscribe to frame changes (stub for now).
   * @param {function(number): void} callback - Frame callback
   * @returns {function(): void} Unsubscribe function
   */
  onFrame(callback) {
    // TODO: Implement frame callback subscription in Phase 2
    this._frameCallbacks.add(callback);
    return () => {
      this._frameCallbacks.delete(callback);
    };
  }

  /**
   * Capture video stream from EmulatorJS canvas.
   * @param {number} fps - Target FPS
   * @returns {Promise<MediaStream | null>}
   */
  async captureVideoStream(fps) {
    if (!this.emulator.canvas) {
      return null;
    }
    
    if (typeof this.emulator.collectScreenRecordingMediaTracks === "function") {
      return this.emulator.collectScreenRecordingMediaTracks(
        this.emulator.canvas,
        fps
      );
    }
    
    return null;
  }

  /**
   * Capture audio stream from EmulatorJS (stub for now).
   * @returns {Promise<MediaStream | null>}
   */
  async captureAudioStream() {
    // TODO: Implement audio capture in Phase 3
    return null;
  }

  /**
   * Pause EmulatorJS emulation.
   */
  pause() {
    if (typeof this.emulator.pause === "function") {
      this.emulator.pause();
    }
  }

  /**
   * Resume EmulatorJS emulation.
   */
  resume() {
    if (typeof this.emulator.resume === "function") {
      this.emulator.resume();
    }
  }

  /**
   * Check if EmulatorJS is paused.
   * @returns {boolean}
   */
  isPaused() {
    return this.emulator.paused || false;
  }

  /**
   * Subscribe to pause state changes (stub for now).
   * @param {function(boolean): void} callback - Pause callback
   * @returns {function(): void} Unsubscribe function
   */
  onPauseChange(callback) {
    // TODO: Implement pause callback subscription in Phase 2
    this._pauseCallbacks.add(callback);
    return () => {
      this._pauseCallbacks.delete(callback);
    };
  }

  /**
   * Get EmulatorJS emulator information.
   * @returns {{core: string, version: string}}
   */
  getEmulatorInfo() {
    return {
      core: this.emulator.config?.core || "unknown",
      version: this.emulator.ejs_version || "unknown",
    };
  }

  /**
   * Get ROM information from EmulatorJS.
   * @returns {{hash: string, size: number, name: string} | null}
   */
  getROMInfo() {
    // Try to get ROM info from config
    if (this.emulator.config && this.emulator.config.gameUrl) {
      const gameUrl = this.emulator.config.gameUrl;
      const gameName = this.emulator.config.gameName || this.emulator.ejs_gameName || "Unknown";
      
      // For now, return basic info (hash would need to be computed from ROM data)
      // This is a placeholder - actual hash computation would require ROM file access
      return {
        hash: null, // TODO: Compute hash from ROM data if available
        size: 0,    // TODO: Get actual ROM size
        name: gameName,
      };
    }
    
    return null;
  }

  /**
   * Get input framework type for EmulatorJS.
   * @returns {"simple" | "complex"}
   */
  getInputFramework() {
    // EmulatorJS uses simple controllers (30 inputs)
    return "simple";
  }

  /**
   * Get controller type for EmulatorJS.
   * @returns {string}
   */
  getControllerType() {
    // EmulatorJS uses standard controllers
    return "standard";
  }

  /**
   * Display message in EmulatorJS.
   * @param {string} message - Message text
   * @param {number} durationMs - Duration in milliseconds
   */
  displayMessage(message, durationMs) {
    if (typeof this.emulator.displayMessage === "function") {
      this.emulator.displayMessage(message, durationMs);
    }
  }

  /**
   * Show overlay in EmulatorJS (stub for now).
   * @param {string} type - Overlay type
   * @param {*} data - Overlay data
   */
  showOverlay(type, data) {
    // TODO: Implement overlay system in Phase 4
    if (type === "host-paused" && typeof this.emulator.netplayShowHostPausedOverlay === "function") {
      this.emulator.netplayShowHostPausedOverlay();
    }
  }

  /**
   * Hide overlay in EmulatorJS (stub for now).
   * @param {string} type - Overlay type
   */
  hideOverlay(type) {
    // TODO: Implement overlay system in Phase 4
    if (type === "host-paused" && typeof this.emulator.netplayHideHostPausedOverlay === "function") {
      this.emulator.netplayHideHostPausedOverlay();
    }
  }
}


// Also expose as global for non-module environments (after minification)
// Direct assignment - browser environment always has window
// #region agent log
try {
  fetch('http://127.0.0.1:7242/ingest/22e800bc-6bc6-4492-ae2b-c74b05fdebc4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'EmulatorJSAdapter.js:233',message:'BEFORE assignment - class exists check',data:{classExists:typeof EmulatorJSAdapter!=='undefined',classType:typeof EmulatorJSAdapter},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch((e)=>{console.error('Fetch error:',e)});
} catch(e) {
  console.error('Error before assignment:', e);
}
// #endregion
window.EmulatorJSAdapter = EmulatorJSAdapter;
// #region agent log
try {
  fetch('http://127.0.0.1:7242/ingest/22e800bc-6bc6-4492-ae2b-c74b05fdebc4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'EmulatorJSAdapter.js:236',message:'AFTER assignment - verification',data:{assigned:typeof window.EmulatorJSAdapter!=='undefined',assignedType:typeof window.EmulatorJSAdapter},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch((e)=>{console.error('Fetch error:',e)});
} catch(e) {
  console.error('Error after assignment:', e);
}
// #endregion
