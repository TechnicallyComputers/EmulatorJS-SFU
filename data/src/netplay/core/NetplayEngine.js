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
} catch(e) {
  console.error('Error in NetplayEngine.js instrumentation:', e);
}
// #endregion

class NetplayEngine {
  /**
   * @param {IEmulator} emulatorAdapter - Emulator adapter implementing IEmulator interface
   * @param {Object} config - Netplay configuration
   */
  constructor(emulatorAdapter, config = {}) {
    this.emulator = emulatorAdapter;
    this.config = config || {};
    this.id = Math.random().toString(36).substr(2, 9); // Add unique ID for debugging
    console.log(`[NetplayEngine:${this.id}] Constructor called with config:`, {
      hasCallbacks: !!config.callbacks,
      callbackKeys: config.callbacks ? Object.keys(config.callbacks) : [],
      hasOnUsersUpdated: !!(config.callbacks?.onUsersUpdated)
    });

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

      // Connect the socket transport
      const sfuUrl = this.config.sfuUrl || this.config.netplayUrl;
      if (!sfuUrl) {
        throw new Error("No SFU URL configured for socket connection");
      }

      // Get authentication token (same logic as listRooms)
      let token = window.EJS_netplayToken;
      if (!token) {
        // Try to get token from cookie
        const cookies = document.cookie.split(';');
        for (const cookie of cookies) {
          const [name, value] = cookie.trim().split('=');
          if (name === 'romm_sfu_token' || name === 'sfu_token') {
            token = decodeURIComponent(value);
            break;
          }
        }
      }

      console.log("[NetplayEngine] Connecting socket to:", sfuUrl, token ? "(with auth token)" : "(no auth token)");
      await this.socketTransport.connect(sfuUrl, token);

      // 10. SFU Transport
      this.sfuTransport = new SFUTransport(
        this.configManager?.loadConfig() || {},
        this.socketTransport
      );

      // Initialize SFU transport (checks availability, loads device)
      const sfuAvailable = await this.sfuTransport.initialize();
      if (!sfuAvailable) {
        console.warn("[NetplayEngine] SFU not available, continuing without WebRTC streaming");
      }

      // 11. Data Channel Manager
      const inputMode =
        this.configManager?.getSetting("inputMode") ||
        this.config.inputMode ||
        "orderedRelay";
      this.dataChannelManager = new DataChannelManager({
        mode: inputMode,
      });

      // Connect DataChannelManager to SFUTransport
      if (this.sfuTransport) {
        this.sfuTransport.setDataChannelManager(this.dataChannelManager);
      }

      // Set up input callback for DataChannelManager
      if (this.dataChannelManager && this.inputSync) {
        this.dataChannelManager.onInput((playerIndex, inputIndex, value, fromSocketId) => {
          // Receive input via InputSync (use current frame from frame counter)
          const currentFrame = this.frameCounter?.getCurrentFrame() || 0;
          this.inputSync.receiveInput(currentFrame, [playerIndex, inputIndex, value], fromSocketId);
        });
      }

      // 12. Spectator Manager
      this.spectatorManager = new SpectatorManager(
        this.configManager?.loadConfig() || {},
        this.socketTransport
      );

      // 13. Room Manager
      const roomCallbacks = {
        onUsersUpdated: (users) => {
          console.log(`[NetplayEngine:${this.id}] roomCallbacks.onUsersUpdated called with users:`, Object.keys(users || {}));

          // Update player manager
          if (this.playerManager) {
            Object.entries(users || {}).forEach(([playerId, playerData]) => {
              this.playerManager.addPlayer(playerId, playerData);
            });
          }

          if (this.config.callbacks?.onUsersUpdated) {
            console.log(`[NetplayEngine:${this.id}] Calling config.callbacks.onUsersUpdated with users:`, Object.keys(users || {}));
            this.config.callbacks.onUsersUpdated(users);
          } else {
            console.warn(`[NetplayEngine:${this.id}] config.callbacks.onUsersUpdated not available`);
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

      // Setup frame callback for input processing
      if (this.emulator && typeof this.emulator.onFrame === 'function') {
        this._frameUnsubscribe = this.emulator.onFrame((frame) => {
          // Process frame inputs (host only)
          if (this.sessionState?.isHostRole()) {
            this.processFrameInputs();
          }
        });
        console.log("[NetplayEngine] Frame callback set up for input processing");
      } else {
        console.warn("[NetplayEngine] Frame callback not available - input processing may not work");
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
   * Create a new room (host only).
   * @param {string} roomName - Room name
   * @param {number} maxPlayers - Maximum players
   * @param {string|null} password - Optional password
   * @param {Object} playerInfo - Player information
   * @returns {Promise<Object>} Room creation result
   */
  async createRoom(roomName, maxPlayers, password = null, playerInfo = {}) {
    if (!this.roomManager) {
      throw new Error("NetplayEngine not initialized");
    }
    return await this.roomManager.createRoom(roomName, maxPlayers, password, playerInfo);
  }

  /**
   * Join an existing room.
   * @param {string} sessionId - Session/room ID
   * @param {string} roomName - Room name
   * @param {number} maxPlayers - Maximum players
   * @param {string|null} password - Optional password
   * @param {Object} playerInfo - Player information
   * @returns {Promise<Object>} Join result
   */
  async joinRoom(sessionId, roomName, maxPlayers, password = null, playerInfo = {}) {
    if (!this.roomManager) {
      throw new Error("NetplayEngine not initialized");
    }
    return await this.roomManager.joinRoom(sessionId, roomName, maxPlayers, password, playerInfo);
  }

  /**
   * Leave the current room.
   * @param {string|null} reason - Optional leave reason
   * @returns {Promise<void>}
   */
  async leaveRoom(reason = null) {
    if (!this.roomManager) {
      throw new Error("NetplayEngine not initialized");
    }
    return await this.roomManager.leaveRoom(reason);
  }

  /**
   * List available rooms.
   * @returns {Promise<Array>} Array of room objects
   */
  async listRooms() {
    // Use HTTP request to SFU /list endpoint (same as old netplayGetRoomList)
    const sfuUrl = this.config.netplayUrl || window.EJS_netplayUrl;
    if (!sfuUrl) {
      throw new Error("No SFU URL configured");
    }

    console.log("[NetplayEngine] Fetching room list from:", sfuUrl);

    // Build URL with authentication token
    const token = window.EJS_netplayToken;
    let url = `${sfuUrl}/list?domain=${window.location.host}&game_id=${this.config.gameId || ""}`;
    if (token) {
      url += `&token=${encodeURIComponent(token)}`;
    }

    const headers = {};
    if (!token) {
      // If no token in global var, try to get it from cookie
      const cookies = document.cookie.split(';');
      for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'romm_sfu_token' || name === 'sfu_token') {
          headers['Authorization'] = `Bearer ${decodeURIComponent(value)}`;
          break;
        }
      }
    }

    const response = await fetch(url, { headers });
    console.log(`[NetplayEngine] Room list response status: ${response.status}`);

    if (!response.ok) {
      console.warn(`[NetplayEngine] Room list fetch failed with status ${response.status}`);
      return [];
    }

    const data = await response.json();
    console.log("[NetplayEngine] Raw server response:", data);

    // Convert server response format to expected format (same as netplayGetRoomList)
    const rooms = [];
    if (data && typeof data === "object") {
      console.log("[NetplayEngine] Processing server data entries:", Object.keys(data));
      Object.entries(data).forEach(([roomId, roomInfo]) => {
        console.log(`[NetplayEngine] Processing room ${roomId}:`, roomInfo);
        if (roomInfo && roomInfo.room_name) {
          const room = {
            id: roomId,
            name: roomInfo.room_name,
            current: roomInfo.current || 0,
            max: roomInfo.max || 4,
            hasPassword: roomInfo.hasPassword || false,
            netplay_mode: roomInfo.netplay_mode || 0,
            sync_config: roomInfo.sync_config || null,
            spectator_mode: roomInfo.spectator_mode || 1,
            rom_hash: roomInfo.rom_hash || null,
            core_type: roomInfo.core_type || null,
          };
          console.log(`[NetplayEngine] Added room to list:`, room);
          rooms.push(room);
        } else {
          console.log(`[NetplayEngine] Skipping room ${roomId} - missing room_name:`, roomInfo);
        }
      });
    } else {
      console.log("[NetplayEngine] Server data is not an object:", data);
    }

    console.log("[NetplayEngine] Final parsed rooms array:", rooms);
    return rooms;
  }

  /**
   * Initialize SFU transports for host (create send transport).
   * @returns {Promise<void>}
   */
  async initializeHostTransports() {
    if (!this.sfuTransport) {
      throw new Error("NetplayEngine not initialized");
    }

    await this.sfuTransport.createTransports(true); // isHost = true
  }

  /**
   * Initialize SFU transports for client (create recv transport).
   * @returns {Promise<void>}
   */
  async initializeClientTransports() {
    if (!this.sfuTransport) {
      throw new Error("NetplayEngine not initialized");
    }

    await this.sfuTransport.createTransports(false); // isHost = false
  }

  /**
   * Initialize SFU send transport for data producers (needed by all clients).
   * @returns {Promise<void>}
   */
  async initializeSendTransport() {
    if (!this.sfuTransport) {
      throw new Error("NetplayEngine not initialized");
    }

    await this.sfuTransport.createSendTransport();
  }

  /**
   * Create video producer (host only).
   * @param {MediaStreamTrack} videoTrack - Video track from canvas/screen capture
   * @returns {Promise<Object>} Video producer
   */
  async createVideoProducer(videoTrack) {
    if (!this.sfuTransport) {
      throw new Error("NetplayEngine not initialized");
    }

    if (!this.sessionState?.isHostRole()) {
      throw new Error("Only host can create video producer");
    }

    return await this.sfuTransport.createVideoProducer(videoTrack);
  }

  /**
   * Create audio producer (host only).
   * @param {MediaStreamTrack} audioTrack - Audio track
   * @returns {Promise<Object>} Audio producer
   */
  async createAudioProducer(audioTrack) {
    if (!this.sfuTransport) {
      throw new Error("NetplayEngine not initialized");
    }

    if (!this.sessionState?.isHostRole()) {
      throw new Error("Only host can create audio producer");
    }

    return await this.sfuTransport.createAudioProducer(audioTrack);
  }

  /**
   * Create data producer for input relay.
   * @returns {Promise<Object>} Data producer
   */
  async createDataProducer() {
    if (!this.sfuTransport) {
      throw new Error("NetplayEngine not initialized");
    }

    return await this.sfuTransport.createDataProducer();
  }

  /**
   * Create consumer for remote media (client only).
   * @param {string} producerId - Producer ID to consume
   * @param {string} kind - "video" or "audio"
   * @returns {Promise<Object>} Consumer
   */
  async createConsumer(producerId, kind) {
    if (!this.sfuTransport) {
      throw new Error("NetplayEngine not initialized");
    }

    if (this.sessionState?.isHostRole()) {
      throw new Error("Host should not create consumers");
    }

    return await this.sfuTransport.createConsumer(producerId, kind);
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

      // Cleanup frame callback
      if (this._frameUnsubscribe) {
        this._frameUnsubscribe();
        this._frameUnsubscribe = null;
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
} catch(e) {
  console.error('Error before assignment:', e);
}
// #endregion
window.NetplayEngine = NetplayEngine;
// #region agent log
try {
} catch(e) {
  console.error('Error after assignment:', e);
}
// #endregion
// #region agent log
// #endregion

// Also support CommonJS for Node.js environments (if needed)
if (typeof exports !== "undefined" && typeof module !== "undefined") {
  module.exports = NetplayEngine;
}
