/**
 * NetplayEngine - Main orchestrator for netplay functionality
 *
 * Coordinates all netplay subsystems:
 * - Transport layer (SFU, Socket.IO, Data Channels)
 * - Input synchronization
 * - Room management
 * - Session state
 * - Configuration
 *
 * Note: This file uses direct class references instead of ES6 imports
 * to work with concatenated/minified builds. All dependencies must be
 * loaded before this file in the build order.
 */

// Dependencies are expected to be in global scope after concatenation:
// SocketTransport, SFUTransport, DataChannelManager, InputSync,
// SessionState, FrameCounter, ConfigManager, RoomManager, PlayerManager,
// MetadataValidator, GameModeManager, UsernameManager, SpectatorManager, SlotManager

// #region agent log
try {
  fetch('http://127.0.0.1:7242/ingest/22e800bc-6bc6-4492-ae2b-c74b05fdebc4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'NetplayEngine.js:21',message:'NetplayEngine.js script executing',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch((e)=>{console.error('Fetch error:',e)});
} catch(e) {
  console.error('Error in NetplayEngine.js instrumentation:', e);
}
// #endregion
console.log('[NetplayEngine] Script loaded and executing');

class NetplayEngine {
  /**
   * @param {IEmulator} emulatorAdapter - Emulator adapter implementing IEmulator interface
   * @param {Object} config - Netplay configuration
   */
  constructor(emulatorAdapter, config = {}) {
    this.emulator = emulatorAdapter;
    this.config = config || {};

    // Subsystems (initialized in initialize())
    this.configManager = null;
    this.sessionState = null;
    this.frameCounter = null;
    this.socketTransport = null;
    this.sfuTransport = null;
    this.dataChannelManager = null;
    this.gameModeManager = null;
    this.metadataValidator = null;
    this.usernameManager = null;
    this.slotManager = null;
    this.playerManager = null;
    this.spectatorManager = null;
    this.roomManager = null;
    this.inputSync = null;

    // Initialization state
    this._initialized = false;
  }

  /**
   * Initialize the netplay engine and all subsystems.
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this._initialized) {
      console.warn("[NetplayEngine] Already initialized");
      return;
    }

    try {
      // Check if dependencies are available (they should be after concatenation)
      if (typeof ConfigManager === "undefined") {
        throw new Error("ConfigManager not available - modules may not be loaded correctly");
      }

      // 1. Configuration Manager
      this.configManager = new ConfigManager(this.emulator, this.config);

      // 2. Session State
      this.sessionState = new SessionState();

      // 3. Frame Counter
      this.frameCounter = new FrameCounter(this.emulator);

      // 4. Game Mode Manager
      this.gameModeManager = new GameModeManager();

      // 5. Metadata Validator
      this.metadataValidator = new MetadataValidator(this.gameModeManager);

      // 6. Username Manager
      this.usernameManager = new UsernameManager();

      // 7. Slot Manager
      this.slotManager = new SlotManager(this.configManager?.loadConfig() || {});

      // 8. Player Manager
      this.playerManager = new PlayerManager(this.slotManager);

      // 9. Socket Transport
      const socketCallbacks = {
        onConnect: (socketId) => {
          if (this.config.callbacks?.onSocketConnect) {
            this.config.callbacks.onSocketConnect(socketId);
          }
        },
        onConnectError: (error) => {
          if (this.config.callbacks?.onSocketError) {
            this.config.callbacks.onSocketError(error);
          }
        },
        onDisconnect: (reason) => {
          if (this.config.callbacks?.onSocketDisconnect) {
            this.config.callbacks.onSocketDisconnect(reason);
          }
        },
        onSocketReady: (callback) => {
          // Callback when socket is ready (for join room flow)
          if (this.socketTransport && this.socketTransport.isConnected()) {
            callback();
          } else {
            // Wait for connection
            const checkReady = () => {
              if (this.socketTransport && this.socketTransport.isConnected()) {
                callback();
              } else {
                setTimeout(checkReady, 100);
              }
            };
            checkReady();
          }
        },
      };
      this.socketTransport = new SocketTransport(
        {
          ...this.configManager?.loadConfig(),
          callbacks: socketCallbacks,
        },
        this.socketTransport // Pass existing socket if reinitializing
      );

      // 10. SFU Transport
      this.sfuTransport = new SFUTransport(
        this.configManager?.loadConfig() || {},
        this.socketTransport
      );

      // 11. Data Channel Manager
      const inputMode =
        this.configManager?.getSetting("inputMode") ||
        this.config.inputMode ||
        "orderedRelay";
      this.dataChannelManager = new DataChannelManager({
        mode: inputMode,
      });

      // 12. Spectator Manager
      this.spectatorManager = new SpectatorManager(
        this.configManager?.loadConfig() || {},
        this.socketTransport
      );

      // 13. Room Manager
      const roomCallbacks = {
        onUsersUpdated: (users) => {
          // Update player manager
          if (this.playerManager) {
            Object.entries(users || {}).forEach(([playerId, playerData]) => {
              this.playerManager.addPlayer(playerId, playerData);
            });
          }

          if (this.config.callbacks?.onUsersUpdated) {
            this.config.callbacks.onUsersUpdated(users);
          }
        },
        onRoomClosed: (data) => {
          if (this.config.callbacks?.onRoomClosed) {
            this.config.callbacks.onRoomClosed(data);
          }
        },
      };
      this.roomManager = new RoomManager(
        this.socketTransport,
        this.configManager?.loadConfig() || {},
        this.sessionState
      );
      this.roomManager.config.callbacks = roomCallbacks;
      this.roomManager.setupEventListeners();

      // 14. Input Sync (needs callback for sending inputs)
      const sendInputCallback = (frame, inputData) => {
        // Send input via data channel or socket
        if (this.dataChannelManager && this.dataChannelManager.isReady()) {
          // Use data channel (for SFU relay modes)
          if (Array.isArray(inputData)) {
            // Multiple inputs to send
            inputData.forEach((data) => {
              if (data.connected_input && data.connected_input.length === 3) {
                const [playerIndex, inputIndex, value] = data.connected_input;
                this.dataChannelManager.sendInput(playerIndex, inputIndex, value);
              }
            });
          } else if (inputData.connected_input && inputData.connected_input.length === 3) {
            // Single input
            const [playerIndex, inputIndex, value] = inputData.connected_input;
            this.dataChannelManager.sendInput(playerIndex, inputIndex, value);
          }
        } else if (this.socketTransport && this.socketTransport.isConnected()) {
          // Fallback to Socket.IO "sync-control" message
          if (Array.isArray(inputData)) {
            this.socketTransport.sendDataMessage({
              "sync-control": inputData,
            });
          } else {
            this.socketTransport.sendDataMessage({
              "sync-control": [inputData],
            });
          }
        }
      };

      this.inputSync = new InputSync(
        this.emulator,
        this.configManager?.loadConfig() || {},
        this.sessionState,
        sendInputCallback
      );

      // Setup data channel input receiver
      if (this.dataChannelManager) {
        this.dataChannelManager.onInput((playerIndex, inputIndex, value, fromSocketId) => {
          // Receive input from data channel
          const frame = this.frameCounter?.getCurrentFrame() || 0;
          this.inputSync.receiveInput(frame, [playerIndex, inputIndex, value], fromSocketId);
        });
      }

      // Setup socket data message handler for inputs
      if (this.socketTransport) {
        this.socketTransport.on("data-message", (data) => {
          this.handleDataMessage(data);
        });
      }

      // Setup spectator chat listeners
      if (this.spectatorManager) {
        this.spectatorManager.setupChatListeners();
      }

      this._initialized = true;
      console.log("[NetplayEngine] Initialized with all subsystems");
    } catch (error) {
      console.error("[NetplayEngine] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Handle incoming data message from Socket.IO.
   * @private
   * @param {Object} data - Data message
   */
  handleDataMessage(data) {
    // Handle sync-control inputs
    if (data["sync-control"]) {
      data["sync-control"].forEach((value) => {
        const inFrame = parseInt(value.frame, 10);
        if (!value.connected_input || value.connected_input[0] < 0) return;

        // Receive input via InputSync
        this.inputSync.receiveInput(
          inFrame,
          value.connected_input,
          value.fromPlayerId || null
        );

        // Send frame acknowledgment
        if (this.socketTransport) {
          this.socketTransport.sendFrameAck(inFrame);
        }

        // If host, apply input immediately (InputSync will handle this via processFrameInputs)
        // Note: Actual input application happens in processFrameInputs() called from emulator frame loop
      });
    }

    // Handle frame data (for frame reconstruction)
    if (data.frameData && this.config.callbacks?.onFrameData) {
      this.config.callbacks.onFrameData(data.frameData);
    }
  }

  /**
   * Process inputs for current frame (called each frame from emulator loop).
   * @returns {Array} Array of inputs to send to clients
   */
  processFrameInputs() {
    if (!this.inputSync || !this.sessionState?.isHostRole()) {
      return [];
    }

    // Update frame counter
    if (this.emulator && this.frameCounter) {
      const emulatorFrame = this.emulator.getCurrentFrame();
      this.frameCounter.setCurrentFrame(emulatorFrame);
      this.inputSync.updateCurrentFrame(emulatorFrame);
    }

    // Process inputs for current frame
    return this.inputSync.processFrameInputs();
  }

  /**
   * Get current session state object (for backward compatibility).
   * @returns {Object} State object compatible with this.netplay
   */
  getStateObject() {
    if (!this._initialized) {
      return {
        initialized: false,
      };
    }

    return {
      initialized: this._initialized,
      currentFrame: this.frameCounter?.getCurrentFrame() || 0,
      inputsData: this.inputSync?.inputsData || {},
      owner: this.sessionState?.isHostRole() || false,
      players: this.playerManager?.getPlayersObject() || {},
      socket: this.socketTransport?.socket || null,
      url: this.config.netplayUrl || null,
      // Add other backward-compatible properties as needed
    };
  }

  /**
   * Check if engine is initialized.
   * @returns {boolean}
   */
  isInitialized() {
    return this._initialized;
  }

  /**
   * Shutdown and cleanup all subsystems.
   * @returns {Promise<void>}
   */
  async shutdown() {
    if (!this._initialized) return;

    try {
      // Cleanup in reverse order
      if (this.spectatorManager) {
        this.spectatorManager.removeChatListeners();
        this.spectatorManager.clear();
      }

      if (this.inputSync) {
        this.inputSync.cleanup();
      }

      if (this.dataChannelManager) {
        this.dataChannelManager.cleanup();
      }

      if (this.sfuTransport) {
        await this.sfuTransport.cleanup();
      }

      if (this.socketTransport) {
        await this.socketTransport.disconnect();
      }

      if (this.roomManager) {
        // Room manager cleanup if needed
      }

      if (this.playerManager) {
        this.playerManager.clear();
      }

      if (this.sessionState) {
        this.sessionState.reset();
      }
    } catch (error) {
      console.error("[NetplayEngine] Shutdown error:", error);
    }

    this._initialized = false;
    console.log("[NetplayEngine] Shutdown complete");
  }
}

// Expose as global for concatenated/minified builds
// Direct assignment - browser environment always has window
// #region agent log
try {
  fetch('http://127.0.0.1:7242/ingest/22e800bc-6bc6-4492-ae2b-c74b05fdebc4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'NetplayEngine.js:387',message:'BEFORE assignment - class exists check',data:{classExists:typeof NetplayEngine!=='undefined',classType:typeof NetplayEngine,windowExists:typeof window!=='undefined'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch((e)=>{console.error('Fetch error:',e)});
} catch(e) {
  console.error('Error before assignment:', e);
}
// #endregion
window.NetplayEngine = NetplayEngine;
// #region agent log
try {
  fetch('http://127.0.0.1:7242/ingest/22e800bc-6bc6-4492-ae2b-c74b05fdebc4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'NetplayEngine.js:390',message:'AFTER assignment - verification',data:{assigned:typeof window.NetplayEngine!=='undefined',assignedType:typeof window.NetplayEngine},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch((e)=>{console.error('Fetch error:',e)});
} catch(e) {
  console.error('Error after assignment:', e);
}
// #endregion
// #region agent log
fetch('http://127.0.0.1:7242/ingest/22e800bc-6bc6-4492-ae2b-c74b05fdebc4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'NetplayEngine.js:389',message:'window.NetplayEngine assigned',data:{assigned:typeof window.NetplayEngine!=='undefined'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
// #endregion

// Also support CommonJS for Node.js environments (if needed)
if (typeof exports !== "undefined" && typeof module !== "undefined") {
  module.exports = NetplayEngine;
}
