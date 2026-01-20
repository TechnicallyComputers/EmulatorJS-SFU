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
  constructor(emulatorAdapter, netplayMenu, config = {}) {
    this.emulator = emulatorAdapter;
    this.netplayMenu = netplayMenu;
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

  // Helper method to get player name from token/cookies (same logic as NetplayMenu)
getPlayerName() {
  let playerName = "Player"; // Default fallback
  
  try {
    // Get token from window.EJS_netplayToken or token cookie
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

    if (token) {
      // Decode JWT payload to get netplay ID from 'sub' field
      // JWT uses base64url encoding, not standard base64, so we need to convert
      const base64UrlDecode = (str) => {
        // Convert base64url to base64 by replacing chars and adding padding
        let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) {
          base64 += '=';
        }
        
        // Decode base64 to binary string, then convert to proper UTF-8
        const binaryString = atob(base64);
        
        // Convert binary string to UTF-8 using TextDecoder if available, otherwise fallback
        if (typeof TextDecoder !== 'undefined') {
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          return new TextDecoder('utf-8').decode(bytes);
        } else {
          // Fallback for older browsers: this may not handle all UTF-8 correctly
          return decodeURIComponent(escape(binaryString));
        }
      };
      
      try {
        const payloadStr = base64UrlDecode(token.split('.')[1]);
        const payload = JSON.parse(payloadStr);
        
        if (payload.sub) {
          // Use the netplay ID as player name, truncate if too long (Unicode-safe)
          playerName = Array.from(payload.sub).slice(0, 20).join('');
        }
      } catch (parseError) {
        console.error("[NetplayEngine] Failed to parse JWT payload:", parseError);
      }
    }
  } catch (e) {
    console.warn("[NetplayEngine] Failed to extract player name from token:", e);
  }

  return playerName;
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
      const sfuUrl = this.config.sfuUrl || this.config.netplayUrl || window.EJS_netplayUrl;
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
      // Set up callbacks for room events
      this.config.callbacks = {
        onUsersUpdated: (users) => {
          console.log("[NetplayEngine] onUsersUpdated callback called with users:", Object.keys(users || {}));
          if (this.netplayMenu && this.netplayMenu.netplayUpdatePlayerList) {
            this.netplayMenu.netplayUpdatePlayerList({ players: users });
          }
        },
        onRoomClosed: (data) => {
          console.log("[NetplayEngine] Room closed:", data);
        }
      };
      this.roomManager = new RoomManager(
        this.socketTransport,
        this.configManager?.loadConfig() || {},
        this.sessionState
      );
      this.roomManager.config.callbacks = this.config.callbacks;
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

      // Create emulator adapter for InputSync
      const EmulatorJSAdapterClass =
        typeof EmulatorJSAdapter !== "undefined"
          ? EmulatorJSAdapter
          : typeof window !== "undefined" && window.EmulatorJSAdapter
          ? window.EmulatorJSAdapter
          : null;

      const emulatorAdapter = new EmulatorJSAdapterClass(this.emulator);

      this.inputSync = new InputSync(
        emulatorAdapter,
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
      throw new Error("NetplayEngine not initialized - no roomManager");
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

  async netplayGetRoomList() {
    try {
      console.log("[Netplay] Attempting to fetch room list...");

      // Build URL with authentication token
      const token = window.EJS_netplayToken;
      const baseUrl = window.EJS_netplayUrl || this.config.netplayUrl;

      if (!baseUrl) {
        console.error("[Netplay] No netplay URL configured (window.EJS_netplayUrl or this.config.netplayUrl)");
        return [];
      }

      let url = `${baseUrl}/list?domain=${window.location.host}&game_id=${this.config.gameId || ""}`;
      if (token) {
        url += `&token=${encodeURIComponent(token)}`;
      }

      console.log("[Netplay] Fetching room list from:", url);

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
      console.log(`[Netplay] Room list response status: ${response.status}`);

      if (!response.ok) {
        console.warn(`Room list fetch failed with status ${response.status}`);
        return [];
      }

      const data = await response.json();
      console.log("[Netplay] Raw server response:", data);

      // Convert server response format to expected format
      const rooms = [];
      if (data && typeof data === "object") {
        console.log("[Netplay] Processing server data entries:", Object.keys(data));
        Object.entries(data).forEach(([roomId, roomInfo]) => {
          console.log(`[Netplay] Processing room ${roomId}:`, roomInfo);
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
            console.log(`[Netplay] Added room to list:`, room);
            rooms.push(room);
          } else {
            console.log(`[Netplay] Skipping room ${roomId} - missing room_name:`, roomInfo);
          }
        });
      } else {
        console.log("[Netplay] Server data is not an object:", data);
      }

      console.log("[Netplay] Final parsed rooms array:", rooms);
      return rooms;
    } catch (error) {
      console.error("[Netplay] Failed to get room list:", error);
      return [];
    }
  }
  // Helper method to create a room
  async netplayCreateRoom(roomName, maxPlayers, password, allowSpectators = true, roomType = "live_stream", frameDelay = 2, syncMode = "timeout") {
    const playerName = this.getPlayerName();
    if (!playerName || playerName === "Player") {
      throw new Error("Player name not set");
    }

    // Use NetplayEngine if available
    if (this.emulator.netplay.engine) {
      console.log("[Netplay] Creating room via NetplayEngine:", {
        roomName,
        maxPlayers,
        password,
        allowSpectators,
        roomType
      });

      // Initialize engine if not already initialized
      if (!this.isInitialized()) {
        console.log("[Netplay] Engine not initialized, initializing now...");
        try {
          await this.initialize();
          console.log("[Netplay] Engine initialized successfully");
        } catch (initError) {
          console.error("[Netplay] Engine initialization failed:", initError);
          throw new Error(`NetplayEngine initialization failed: ${initError.message}`);
        }
      }

      // Prepare player info for engine
      const playerInfo = {
        player_name: this.emulator.netplay.getNetplayId(),
        player_slot: this.emulator.netplay.localSlot || 0,
        domain: window.location.host,
        game_id: this.config.gameId || "",
        rom_hash: this.config.romHash || this.config.romName || null,
        core_type: this.config.system || this.config.core || null,
        netplay_mode: roomType === "delay_sync" ? 1 : 0,
        allow_spectators: allowSpectators,
        spectator_mode: allowSpectators ? 1 : 0,
      };

      // Add sync config for delay sync rooms
      if (roomType === "delay_sync") {
        playerInfo.sync_config = {
          frameDelay: frameDelay,
          syncMode: syncMode
        };
      }

      try {
        const result = await this.createRoom(roomName, maxPlayers, password, playerInfo);
        console.log("[Netplay] Room creation successful via engine:", result);

        // Keep the room listing engine - it will be upgraded to a main engine

        // Store room info for later use
        this.emulator.netplay.currentRoomId = roomName; // RoomManager returns sessionid, but room ID is roomName
        this.emulator.netplay.currentRoom = {
          room_name: roomName,
          current: 1, // Creator is already joined
          max: maxPlayers,
          hasPassword: !!password,
          netplay_mode: roomType === "delay_sync" ? 1 : 0,
          sync_config: roomType === "delay_sync" ? {
            frameDelay: frameDelay,
            syncMode: syncMode
          } : null,
          spectator_mode: allowSpectators ? 1 : 0,
          rom_hash: this.config.romHash || this.config.romName || null,
          core_type: this.config.system || this.config.core || null
        };

        // Switch to appropriate room UI and setup based on room type
        if (roomType === "live_stream") {
          this.netplayMenu.netplaySwitchToLiveStreamRoom(roomName, password);
          


          // LIVESTREAM ROOM: Set up WebRTC producer transports for host
          // Only hosts need to create producers for video/audio streaming
          console.log("[Netplay] Setting up WebRTC producer transports for livestream host");
          setTimeout(() => this.netplaySetupProducers(), 1000);
        } else if (roomType === "delay_sync") {
          this.netplayMenu.netplaySwitchToDelaySyncRoom(roomName, password, maxPlayers);

          // DELAY SYNC ROOM: Different setup needed for input synchronization
          // TODO: Add delay sync specific setup (state synchronization, etc.)
          // No WebRTC producers needed for delay sync - uses different sync mechanism
        }

        return result;
      } catch (error) {
        console.error("[Netplay] Room creation failed via engine:", error);
        throw error;
      }
    }

    // Fallback to old direct HTTP method if engine not available
    console.log("[Netplay] NetplayEngine not available, falling back to direct HTTP");

    // Determine netplay mode
    const netplayMode = roomType === "delay_sync" ? 1 : 0;

    // Create sync config for delay sync rooms
    let syncConfig = null;
    if (roomType === "delay_sync") {
      syncConfig = {
        frameDelay: frameDelay,
        syncMode: syncMode
      };
    }

    // Determine spectator mode (1 = allow spectators, 0 = no spectators)
    const spectatorMode = allowSpectators ? 1 : 0;

    console.log("[Netplay] Creating room:", {
      roomName,
      maxPlayers,
      password,
      allowSpectators,
      roomType,
      netplayMode,
      syncConfig,
      spectatorMode
    });

    // Request a write token from RomM for room creation
    console.log("[Netplay] Requesting write token for room creation...");
    let writeToken = null;
    try {
      // Try to get a write token from RomM
      const tokenResponse = await fetch('/api/sfu/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Include auth headers if available
        },
        body: JSON.stringify({ token_type: 'write' })
      });

      if (tokenResponse.ok) {
        const tokenData = await tokenResponse.json();
        writeToken = tokenData.token;
        console.log("[Netplay] Obtained write token for room creation");
      } else {
        console.warn("[Netplay] Failed to get write token, falling back to existing token");
      }
    } catch (error) {
      console.warn("[Netplay] Error requesting write token:", error);
    }

    // Send room creation request to SFU server
    const baseUrl = window.EJS_netplayUrl || this.config.netplayUrl;
    if (!baseUrl) {
      throw new Error("No netplay URL configured");
    }

    const createUrl = `${baseUrl}/create`;
    console.log("[Netplay] Sending room creation request to:", createUrl);

    const headers = {
      'Content-Type': 'application/json'
    };

    // Add authentication - prefer write token, fallback to existing token
    const token = writeToken || window.EJS_netplayToken;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    } else {
      // Try to get token from cookie
      const cookies = document.cookie.split(';');
      for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'romm_sfu_token' || name === 'sfu_token') {
          headers['Authorization'] = `Bearer ${decodeURIComponent(value)}`;
          break;
        }
      }
    }

    const roomData = {
      room_name: roomName,
      max_players: maxPlayers,
      password: password,
      allow_spectators: allowSpectators,
      netplay_mode: netplayMode,
      sync_config: syncConfig,
      spectator_mode: spectatorMode,
      domain: window.location.host,
      game_id: this.config.gameId || "",
      rom_hash: this.config.romHash || this.config.romName || null,
      core_type: this.config.system || this.config.core || null
    };

    console.log("[Netplay] Room creation payload:", roomData);

    const response = await fetch(createUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(roomData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Netplay] Room creation failed with status ${response.status}:`, errorText);
      throw new Error(`Room creation failed: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    console.log("[Netplay] Room creation successful:", result);

    // Store room info for later use
    this.emulator.netplay.currentRoomId = result.room_id || result.id;
    this.emulator.netplay.currentRoom = result.room || result;

    // Switch to appropriate room UI
    if (roomType === "live_stream") {
      this.netplayMenu.netplaySwitchToLiveStreamRoom(roomName, password);
    } else if (roomType === "delay_sync") {
      this.netplayMenu.netplaySwitchToDelaySyncRoom(roomName, password, maxPlayers);
    }
  
    // Note: Producer setup only available with NetplayEngine
  }


    // Helper method to set up WebRTC consumer transports
  // Called for all users to consume from other users' producers
  async netplaySetupConsumers() {
    console.log("[Netplay] 🎥 netplaySetupConsumers() called");
    console.log("[Netplay] Current user is host:", this.emulator.netplay.engine?.sessionState?.isHostRole());
    console.log("[Netplay] Engine available:", !!this.emulator.netplay.engine);

    if (!this.emulator.netplay.engine) {
      console.warn("[Netplay] No engine available for consumer setup");
      return;
    }

    try {
      console.log("[Netplay] Setting up consumer transports...");

      // Ensure receive transport exists (both hosts and clients need this for bidirectional communication)
      const isHost = this.sessionState?.isHostRole();
      if (isHost) {
        // Hosts should already have receive transport from initializeHostTransports()
        // But make sure it's available
        await this.initializeHostTransports();
        console.log("[Netplay] ✅ Host receive transport ensured");
      } else {
        // Clients get receive transport
        await this.initializeClientTransports();
        console.log("[Netplay] ✅ Client receive transport created");
      }

      // First, get existing producers in the room
      console.log("[Netplay] Requesting existing producers...");
      try {
        if (this.socketTransport) {
          // Request existing video/audio producers
          const existingVideoAudioProducers = await new Promise((resolve, reject) => {
            this.socketTransport.emit("sfu-get-producers", {}, (error, producers) => {
              if (error) {
                console.error("[Netplay] Failed to get existing video/audio producers:", error);
                reject(error);
                return;
              }
              console.log("[Netplay] Received existing video/audio producers:", producers);
              resolve(producers || []);
            });
          });

          // Request existing data producers
          const existingDataProducers = await new Promise((resolve, reject) => {
            this.socketTransport.emit("sfu-get-data-producers", {}, (error, producers) => {
              if (error) {
                console.error("[Netplay] Failed to get existing data producers:", error);
                reject(error);
                return;
              }
              console.log("[Netplay] Received existing data producers:", producers);
              resolve(producers || []);
            });
          });

          // Combine all producers
          const existingProducers = [
            ...existingVideoAudioProducers.map(p => ({ ...p, source: 'video-audio', kind: p.kind || 'video' })),
            ...existingDataProducers.map(p => ({ ...p, source: 'data', kind: p.kind || 'data' }))
          ];
          console.log("[Netplay] Combined existing producers:", existingProducers);

          // Create consumers for existing producers
          for (const producer of existingProducers) {
            try {
              console.log(`[Netplay] Creating consumer for existing producer:`, producer);

              // Create consumer based on producer kind
              const producerKind = producer.kind || 'unknown';
              console.log(`[Netplay] Producer kind: ${producerKind}`);

              if (producerKind === 'data') {
                const consumer = await this.createConsumer(producer.id, 'data');
                console.log(`[Netplay] ✅ Created data consumer for existing producer:`, consumer.id);
                // Data consumers don't have tracks, they handle messages directly
              } else if (producerKind === 'video') {
                const consumer = await this.createConsumer(producer.id, 'video');
                console.log(`[Netplay] ✅ Created video consumer for existing producer:`, consumer.id);
                if (consumer.track) {
                  this.netplayMenu.netplayAttachConsumerTrack(consumer.track, 'video');
                }
              } else if (producerKind === 'audio') {
                const consumer = await this.createConsumer(producer.id, 'audio');
                console.log(`[Netplay] ✅ Created audio consumer for existing producer:`, consumer.id);
                if (consumer.track) {
                  this.netplayMenu.netplayAttachConsumerTrack(consumer.track, 'audio');
                }
              } else {
                // Unknown kind, try fallback
                console.warn(`[Netplay] Unknown producer kind ${producerKind}, skipping consumer creation`);
              }
            } catch (error) {
              console.warn(`[Netplay] Failed to create consumer for existing producer ${producer.id}:`, error.message);
            }
          }
        }
      } catch (error) {
        console.warn("[Netplay] Failed to get existing producers:", error);
      }

      // Listen for new producers from any user (for bidirectional communication)
      console.log("[Netplay] Setting up new-producer event listener");
      if (this.socketTransport) {
        console.log("[Netplay] Socket is connected:", this.socketTransport.isConnected());

        this.socketTransport.on("new-producer", async (data) => {
          console.log("[Netplay] 📡 RECEIVED new-producer event:", data);
          try {
            const producerId = data.id;
            const producerKind = data.kind; // Now provided by SFU server

            if (!producerKind) {
              console.warn("[Netplay] Producer kind not provided, trying video, audio, then data");
              // Try video first, then audio, then data if those fail
              try {
                const consumer = await this.createConsumer(producerId, 'video');
                console.log(`[Netplay] ✅ Created video consumer:`, consumer.id);
                if (consumer.track) {
                  this.netplayMenu.netplayAttachConsumerTrack(consumer.track, 'video');
                }
              } catch (videoError) {
                try {
                  const consumer = await this.createConsumer(producerId, 'audio');
                  console.log(`[Netplay] ✅ Created audio consumer:`, consumer.id);
                  if (consumer.track) {
                    this.netplayMenu.netplayAttachConsumerTrack(consumer.track, 'audio');
                  }
                } catch (audioError) {
                  try {
                    const consumer = await this.createConsumer(producerId, 'data');
                    console.log(`[Netplay] ✅ Created data consumer:`, consumer.id);
                    // Data consumers don't have tracks, they handle messages directly
                  } catch (dataError) {
                    console.error("[Netplay] ❌ Failed to create consumer for new producer:", dataError);
                  }
                }
              }
              return;
            }

            console.log(`[Netplay] Creating ${producerKind} consumer for producer ${producerId}`);
            const consumer = await this.createConsumer(producerId, producerKind);
            console.log(`[Netplay] ✅ Created ${producerKind} consumer:`, consumer.id);

            if (producerKind === 'data') {
              console.log(`[Netplay] 🎮 Data consumer ready for input synchronization`);
              // Data consumers don't have tracks, they handle messages directly
              // The DataChannelManager should be set up to receive input data
            } else if (consumer.track) {
              console.log(`[Netplay] 🎵 Consumer track ready: ${producerKind}`, consumer.track);
              this.netplayMenu.netplayAttachConsumerTrack(consumer.track, producerKind);
            } else {
              console.warn(`[Netplay] ⚠️ Consumer created but no track available: ${producerKind}`);
            }
          } catch (error) {
            console.error("[Netplay] ❌ Failed to create consumer for new producer:", error);
          }
        });

        // Listen for new data producers (separate event from SFU)
        this.socketTransport.on("new-data-producer", async (data) => {
          console.log("[Netplay] 📡 RECEIVED new-data-producer event:", data);
          try {
            const producerId = data.id;

            console.log(`[Netplay] Creating data consumer for producer ${producerId}`);
            const consumer = await this.createConsumer(producerId, 'data');
            console.log(`[Netplay] ✅ Created data consumer:`, consumer.id);
            // Data consumers don't have tracks, they handle messages directly
            console.log(`[Netplay] 🎮 Data consumer ready for input synchronization`);
          } catch (error) {
            console.error("[Netplay] ❌ Failed to handle new-data-producer event:", error);
          }
        });

        // Also listen for users-updated to track room changes
        this.socketTransport.on("users-updated", (users) => {
          console.log("[Netplay] 👥 RECEIVED users-updated from consumer socket:", Object.keys(users || {}));
        });
      } else {
        console.warn("[Netplay] No socket transport available for consumer setup");
      }

      console.log("[Netplay] Consumer setup complete - listening for new producers");
    } catch (error) {
      console.error("[Netplay] Consumer setup failed:", error);
    }
  }

  // Helper method to join a room
  async netplayJoinRoom(roomId, hasPassword) {
    const playerName = this.getPlayerName();
    if (!playerName || playerName === "Player") {
      throw new Error("Player name not set");
    }
  
    let password = null;
    if (hasPassword) {
      password = prompt("Enter room password:");
      if (!password) return; // User cancelled
    }
  
    // Use NetplayEngine if available
    if (this.emulator.netplay.engine) {
      console.log("[Netplay] Joining room via NetplayEngine:", { roomId, password });
  
      // Initialize engine if not already initialized
      if (!this.isInitialized()) {
        console.log("[Netplay] Engine not initialized, initializing now...");
        try {
          await this.initialize();
          console.log("[Netplay] Engine initialized successfully");
        } catch (initError) {
          console.error("[Netplay] Engine initialization failed:", initError);
          throw new Error(`NetplayEngine initialization failed: ${initError.message}`);
        }
      }
  
      // Prepare player info for engine
      const playerInfo = {
        player_name: playerName,
        player_slot: this.emulator.netplay.localSlot || 0,
        domain: window.location.host
      };
  
      try {
        const result = await this.joinRoom(null, roomId, 4, password, playerInfo);
        console.log("[Netplay] Room join successful via engine:", result);
  
        // Store room info
        this.emulator.netplay.currentRoomId = roomId;
        this.emulator.netplay.currentRoom = result;
  
        // Immediately update player list with users from join result
        if (result && result.users) {
          console.log("[Netplay] Updating player list immediately after join with users:", Object.keys(result.users));
          this.netplayMenu.netplayUpdatePlayerList({ players: result.users });
        }

        // Switch to appropriate room UI and setup based on room type
        const roomType = result.netplay_mode === 1 ? "delay_sync" : "live_stream";
        if (roomType === "live_stream") {
          this.netplayMenu.netplaySwitchToLiveStreamRoom(roomId, password);

          // LIVESTREAM ROOM: Set up WebRTC consumer transports
          // Both hosts and clients need consumers for data channels
          // Only clients need video/audio consumers from host
          const isHost = this.emulator.netplay.engine?.sessionState?.isHostRole();
          console.log("[Netplay] After joining livestream room - isHost:", isHost);

          if (this.emulator.netplay.engine) {
            console.log("[Netplay] Setting up WebRTC consumer transports for data channels");
            setTimeout(() => this.netplaySetupConsumers(), 1000);

            // Set up data producers for input (both host and clients for bidirectional communication)
            console.log("[Netplay] Setting up data producers for input");
            setTimeout(() => this.netplaySetupDataProducers(), 1500);
          }
          // Note: Video/audio consumption is handled by new-producer events
        } else if (roomType === "delay_sync") {
          this.netplayMenu.netplaySwitchToDelaySyncRoom(roomId, password, 4); // max players not returned, default to 4

          // DELAY SYNC ROOM: Set up bidirectional WebRTC communication
          if (this.emulator.netplay.engine) {
            console.log("[Netplay] Setting up WebRTC transports for delay-sync bidirectional communication");
            setTimeout(() => this.netplaySetupConsumers(), 1000);

            // Set up data producers for input (everyone needs to send inputs)
            console.log("[Netplay] Setting up data producers for input");
            setTimeout(() => this.netplaySetupDataProducers(), 1500);
          }
        }

        return result;
      } catch (error) {
        console.error("[Netplay] Room join failed via engine:", error);
        throw error;
      }
    }

    // Fallback to old direct HTTP method if engine not available
    console.log("[Netplay] NetplayEngine not available, falling back to direct HTTP");

    console.log("[Netplay] Joining room:", { roomId, password });

    // Request a write token from RomM for room joining
    console.log("[Netplay] Requesting write token for room joining...");
    let writeToken = null;
    try {
      const tokenResponse = await fetch('/api/sfu/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token_type: 'write' })
      });

      if (tokenResponse.ok) {
        const tokenData = await tokenResponse.json();
        writeToken = tokenData.token;
        console.log("[Netplay] Obtained write token for room joining");
      } else {
        console.warn("[Netplay] Failed to get write token, falling back to existing token");
      }
    } catch (error) {
      console.warn("[Netplay] Error requesting write token:", error);
    }

    // Send room join request to SFU server
    const baseUrl = window.EJS_netplayUrl || this.config.netplayUrl;
    if (!baseUrl) {
      throw new Error("No netplay URL configured");
    }

    const joinUrl = `${baseUrl}/join/${roomId}`;
    console.log("[Netplay] Sending room join request to:", joinUrl);

    const headers = {
      'Content-Type': 'application/json'
    };

    // Add authentication - prefer write token, fallback to existing token
    const token = writeToken || window.EJS_netplayToken;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    } else {
      // Try to get token from cookie
      const cookies = document.cookie.split(';');
      for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'romm_sfu_token' || name === 'sfu_token') {
          headers['Authorization'] = `Bearer ${decodeURIComponent(value)}`;
          break;
        }
      }
    }

    const joinData = {
      password: password,
      player_name: this.emulator.netplay.getNetplayId(),
      domain: window.location.host
    };

    console.log("[Netplay] Room join payload:", joinData);

    const response = await fetch(joinUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(joinData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Netplay] Room join failed with status ${response.status}:`, errorText);
      throw new Error(`Room join failed: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    console.log("[Netplay] Room join successful:", result);

    // Store room info
    this.emulator.netplay.currentRoomId = roomId;
    this.emulator.netplay.currentRoom = result.room || result;

    // Switch to appropriate room UI based on room type
    const roomType = result.room?.netplay_mode === 1 ? "delay_sync" : "live_stream";
    if (roomType === "live_stream") {
      this.netplayMenu.netplaySwitchToLiveStreamRoom(result.room?.room_name || "Unknown Room", password);
    } else if (roomType === "delay_sync") {
      this.netplayMenu.netplaySwitchToDelaySyncRoom(result.room?.room_name || "Unknown Room", password, result.room?.max || 4);
    }
  }

  // Initialize the netplay engine for real-time communication
  async netplayInitializeEngine(roomName) {
    console.log("[Netplay] Initializing netplay engine for room:", roomName);

    // Set up netplay simulateInput if not already done (always needed)
    if (!this.emulator.netplay.simulateInput) {
      this.emulator.netplay.simulateInput = (playerIndex, inputIndex, value) => {
        console.log("[Netplay] Processing input via netplay.simulateInput:", { playerIndex, inputIndex, value });
        if (this.emulator.netplay.engine && this.inputSync) {
          console.log("[Netplay] Sending input through InputSync");
          return this.inputSync.sendInput(playerIndex, inputIndex, value);
        } else {
          console.warn("[Netplay] InputSync not available, input ignored");
          return false;
        }
      };
      console.log("[Netplay] Set up netplay.simulateInput");
    }

    // Check if we have an existing engine that can be upgraded
    const hasExistingEngine = this.emulator.netplay.engine && this.isInitialized();
    const existingIsRoomListing = this.emulator.netplay.engine?.config?.isRoomListing === true;
    const existingIsMain = this.emulator.netplay.engine?.config?.isRoomListing === false;

    console.log(`[Netplay] Checking existing engine: exists=${!!this.emulator.netplay.engine}, initialized=${hasExistingEngine}, isRoomListing=${existingIsRoomListing}, isMain=${existingIsMain}`);

    if (existingIsMain) {
      console.log("[Netplay] Main NetplayEngine already initialized, skipping setup");
      return;
    }

    // If we have a room listing engine, upgrade it to a main engine
    if (hasExistingEngine && existingIsRoomListing) {
      console.log("[Netplay] Upgrading room listing engine to main engine");
      // Update the engine's config to main engine settings
      this.config.isRoomListing = false;
      this.config.callbacks = {
        onSocketConnect: (socketId) => {
          console.log("[Netplay] Socket connected:", socketId);
        },
        onSocketError: (error) => {
          console.error("[Netplay] Socket error:", error);
        },
        onSocketDisconnect: (reason) => {
          console.log("[Netplay] Socket disconnected:", reason);
        },
        onUsersUpdated: (users) => {
          this.netplayMenu.netplayUpdatePlayerList({ players: users });
        },
        onRoomClosed: (data) => {
          console.log("[Netplay] Room closed:", data);
        }
      };

      // Update the RoomManager's config as well
      if (this.roomManager) {
        this.roomManager.config.isRoomListing = false;
        this.roomManager.config.callbacks = this.config.callbacks;
      }

      // Re-setup event listeners with the new config
      if (this.roomManager) {
        this.roomManager.setupEventListeners();
      }
      return;
    }

    try {
      // Netplay modules should already be loaded globally

      // Get netplay classes
      const NetplayEngineClass =
        typeof NetplayEngine !== "undefined"
          ? NetplayEngine
          : typeof window !== "undefined" && window.NetplayEngine
          ? window.NetplayEngine
          : null;

      const EmulatorJSAdapterClass =
        typeof EmulatorJSAdapter !== "undefined"
          ? EmulatorJSAdapter
          : typeof window !== "undefined" && window.EmulatorJSAdapter
          ? window.EmulatorJSAdapter
          : null;

      const SocketTransportClass =
        typeof SocketTransport !== "undefined"
          ? SocketTransport
          : typeof window !== "undefined" && window.SocketTransport
          ? window.SocketTransport
          : null;

      if (!NetplayEngineClass || !EmulatorJSAdapterClass || !SocketTransportClass) {
        console.error("[Netplay] CRITICAL: Netplay classes not found!");
        console.error("[Netplay] The emulator files served by RomM do not include netplay support.");
        console.error("[Netplay] You need to:");
        console.error("[Netplay] 1. Build EmulatorJS with netplay: cd EmulatorJS-SFU && npm run minify");
        console.error("[Netplay] 2. Copy the built files to RomM:");
        console.error("[Netplay]    cp EmulatorJS-SFU/data/emulator.min.js RomM/frontend/public/assets/emulatorjs/");
        console.error("[Netplay]    cp EmulatorJS-SFU/data/emulator.hybrid.min.js RomM/frontend/public/assets/emulatorjs/");
        console.error("[Netplay]    cp EmulatorJS-SFU/data/emulator.min.css RomM/frontend/public/assets/emulatorjs/");
        console.error("[Netplay] 3. Restart RomM");
        console.log("[Netplay] Available globals:",
          Object.keys(typeof window !== "undefined" ? window : global));
        return;
      }

      // Create socket transport
      const socketUrl = this.config.netplayUrl || window.EJS_netplayUrl;
      if (!socketUrl) {
        console.error("[Netplay] No socket URL available for netplay engine");
        return;
      }

      // Extract base URL for WebSocket connection (remove protocol and path)
      let socketBaseUrl = socketUrl;
      if (socketBaseUrl.startsWith('http://')) {
        socketBaseUrl = socketBaseUrl.substring(7);
      } else if (socketBaseUrl.startsWith('https://')) {
        socketBaseUrl = socketBaseUrl.substring(8);
      }
      // Remove any path after the domain
      const pathIndex = socketBaseUrl.indexOf('/');
      if (pathIndex > 0) {
        socketBaseUrl = socketBaseUrl.substring(0, pathIndex);
      }

      // Create emulator adapter
      const adapter = new EmulatorJSAdapterClass(this);

      // Create netplay engine (let it create its own transport)
      const engine = new NetplayEngineClass(adapter, {
        sfuUrl: socketUrl, // Pass the SFU URL so the engine can create the transport
        roomName,
        playerIndex: this.emulator.netplay.localSlot || 0,
        isRoomListing: false, // This is the main netplay engine
        callbacks: {
          onSocketConnect: (socketId) => {
            console.log("[Netplay] Socket connected:", socketId);

            // Event listeners are now handled by NetplayEngine's callback system
            // The onUsersUpdated callback in the engine config will handle player table updates

            // Now join the room via Socket.IO
            setTimeout(() => this.netplayMenu.netplayJoinRoomViaSocket(roomName), 100);
          },
          onSocketError: (error) => {
            console.error("[Netplay] Socket error:", error);
          },
          onSocketDisconnect: (reason) => {
            console.log("[Netplay] Socket disconnected:", reason);
          },
          onUsersUpdated: (users) => {
            this.netplayMenu.netplayUpdatePlayerList({ players: users });
          },
          onRoomClosed: (data) => {
            console.log("[Netplay] Room closed:", data);
          }
        }
      });

      // Initialize the engine (sets up all subsystems including InputSync and transport)
      console.log("[Netplay] Initializing NetplayEngine...");
      let engineInitialized = false;
      try {
        await engine.initialize();
        engineInitialized = true;
        console.log("[Netplay] NetplayEngine initialized successfully");
      } catch (error) {
        console.warn("[Netplay] NetplayEngine initialization failed, using basic transport:", error);

        // Fall back to basic transport without NetplayEngine
        this.emulator.netplay.transport = new SocketTransportClass({
          callbacks: {
            onConnect: (socketId) => {
              console.log("[Netplay] Basic socket connected:", socketId);

              // Set up event listeners for basic functionality
              this.emulator.netplay.transport.on("users-updated", (data) => {
                console.log("[Netplay] Users updated event received:", data);
                if (data.users) {
                  this.netplayMenu.netplayUpdatePlayerList({ players: data.users });
                }
              });

              // Join the room
              setTimeout(() => this.netplayMenu.netplayJoinRoomViaSocket(roomName), 100);
            },
            onConnectError: (error) => {
              console.error("[Netplay] Basic socket connection error:", error);
            },
            onDisconnect: (reason) => {
              console.log("[Netplay] Basic socket disconnected:", reason);
            }
          }
        });

        // Connect the basic transport
        await this.emulator.netplay.transport.connect(`wss://${socketBaseUrl}`);
      }

      // Store references - assign the main engine if initialized (overwrites room listing engine)
      if (engineInitialized) {
        this.emulator.netplay.engine = engine;
        this.emulator.netplay.transport = engine.socketTransport;
        this.emulator.netplay.adapter = adapter;
        console.log(`[Netplay] Assigned main NetplayEngine:${engine.id} (initialized: ${engineInitialized})`);
        // NetplayEngine handles its own transport connection
      } else {
        // Connect the basic transport (fallback case)
        console.log("[Netplay] Connecting basic SocketTransport...");
        await this.emulator.netplay.transport.connect(`wss://${socketBaseUrl}`);
      }

      // The socket connection will be established by the NetplayEngine
      // Room joining happens in the onSocketConnect callback

      console.log("[Netplay] Netplay engine initialized successfully");

    } catch (error) {
      console.error("[Netplay] Failed to initialize netplay engine:", error);
    }
  }

  // Leave room
  async netplayLeaveRoom() {
    console.log("[Netplay] Leaving room...");

    // Clean up netplay engine
    if (this.emulator.netplay.engine) {
      try {
        await this.leaveRoom();
        console.log("[Netplay] Netplay engine left room");
      } catch (error) {
        console.error("[Netplay] Error leaving netplay engine:", error);
      }
    }

    if (this.emulator.netplay.transport) {
      try {
        await this.emulator.netplay.transport.disconnect();
        console.log("[Netplay] Socket transport disconnected");
      } catch (error) {
        console.error("[Netplay] Error disconnecting transport:", error);
      }
    }

    // Restore original gameManager.simulateInput
    if (this.gameManager && this.gameManager.originalSimulateInput) {
      console.log("[Netplay] Restoring original gameManager.simulateInput");
      this.gameManager.simulateInput = this.gameManager.originalSimulateInput;
      delete this.gameManager.originalSimulateInput;
    }

    // Handle UI cleanup via netplayMenu reference
    if (this.netplayMenu) {

      // Clean up room-specific UI elements
      if (this.netplayMenu.cleanupRoomUI) {
        this.netplayMenu.cleanupRoomUI();
      }
      // Reset netplay state
      this.netplayMenu.isNetplay = false;

      // Restore normal bottom bar buttons
      if (this.netplayMenu.restoreNormalBottomBar) {
        this.netplayMenu.restoreNormalBottomBar();
      }

      // Hide menu
      if (this.netplayMenu.hide) {
        this.netplayMenu.hide();
      }

      // Reset to lobby view
      if (this.netplayMenu.netplay && this.netplayMenu.netplay.tabs && 
          this.netplayMenu.netplay.tabs[0] && this.netplayMenu.netplay.tabs[1]) {
        this.netplayMenu.netplay.tabs[0].style.display = "";
        this.netplayMenu.netplay.tabs[1].style.display = "none";
      }

      // Reset title
      if (this.netplayMenu.netplayMenu) {
        const titleElement = this.netplayMenu.netplayMenu.querySelector("h4");
        if (titleElement) {
          titleElement.innerText = "Netplay Listings";
        }
      }

      // Clear room state
      if (this.emulator.netplay) {
        this.emulator.netplay.currentRoomId = null;
        this.emulator.netplay.currentRoom = null;
        this.emulator.netplay.joinedPlayers = [];
        this.emulator.netplay.takenSlots = new Set();
      }
    }
  }

  // Setup WebRTC video/audio producers for LIVESTREAM hosts only
  // Called only for livestream rooms where user is the host
  async netplaySetupProducers() {
    if (!this.emulator.netplay.engine || !this.sessionState?.isHostRole()) {
      console.log("[Netplay] Not host or engine not available, skipping producer setup");
      return;
    }

    try {
      console.log("[Netplay] Setting up video/audio producers...");

      // Initialize SFU transports for host
      await this.initializeHostTransports();

      // Capture canvas video
      const videoTrack = await this.netplayCaptureCanvasVideo();
      if (videoTrack) {
        await this.createVideoProducer(videoTrack);
        console.log("[Netplay] Video producer created");
      }

      // Capture audio (if available)
      const audioTrack = await this.netplayCaptureAudio();
      if (audioTrack) {
        await this.createAudioProducer(audioTrack);
        console.log("[Netplay] Audio producer created");
      }

      // Create data producer for input relay (only needed for certain room types)
      // For livestream rooms, data producers are not needed since focus is on media streaming
      // Data producers are used for real-time input synchronization in delay sync rooms
      try {
        const dataProducer = await this.createDataProducer();
        if (dataProducer) {
          console.log("[Netplay] Data producer created");
        } else {
          console.log("[Netplay] Data producer not supported (optional for this room type)");
        }
      } catch (error) {
        console.warn("[Netplay] Data producer creation failed (may not be needed for this room type):", error.message);
        // Continue - data producers are optional for livestream rooms
      }

    } catch (error) {
      console.error("[Netplay] Failed to setup producers:", error);
    }
  }

  // Setup data producers for input synchronization (both host and clients)
  async netplaySetupDataProducers() {
    if (!this.emulator.netplay.engine) {
      console.log("[Netplay] Engine not available, skipping data producer setup");
      return;
    }

    try {
      console.log("[Netplay] Setting up data producers for input...");

      // Initialize transports if not already done
      const isHost = this.sessionState?.isHostRole();

      // Everyone needs receive transport for consumers
      if (isHost) {
        await this.initializeHostTransports(); // Creates send + recv for host
      } else {
        await this.initializeClientTransports(); // Creates recv for client
        // Clients also need send transport for data producers
        await this.initializeSendTransport();
      }

      // Create data producer for input synchronization
      const dataProducer = await this.createDataProducer();
      if (dataProducer) {
        console.log("[Netplay] Data producer created for input");

        // Set up input forwarding via data channel
        this.netplayMenu.netplaySetupInputForwarding(dataProducer);
      } else {
        console.log("[Netplay] Data producer not supported");
      }

    } catch (error) {
      console.error("[Netplay] Failed to setup data producers:", error);
    }
  }


  // Capture canvas as video track for netplay streaming
  async netplayCaptureCanvasVideo() {
    try {
      // Get the canvas element
      const canvas = this.canvas || document.querySelector('canvas');
      if (!canvas) {
        console.warn("[Netplay] No canvas found for video capture");
        return null;
      }

      // Create a video stream from canvas
      const stream = canvas.captureStream(30); // 30 FPS
      const videoTrack = stream.getVideoTracks()[0];

      if (videoTrack) {
        console.log("[Netplay] Canvas video captured:", {
          width: canvas.width,
          height: canvas.height,
          frameRate: 30
        });
        return videoTrack;
      } else {
        console.warn("[Netplay] No video track available from canvas");
        return null;
      }
    } catch (error) {
      console.error("[Netplay] Failed to capture canvas video:", error);
      return null;
    }
  }

  // Capture audio for netplay streaming
  async netplayCaptureAudio() {
    try {
      // Try to capture system audio (may not be available in all browsers)
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: false,
        audio: true
      });

      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        console.log("[Netplay] Audio captured from display");
        return audioTrack;
      }
    } catch (error) {
      console.log("[Netplay] Display audio capture not available, using emulator audio if possible");
    }

    // Fallback: try to create a silent audio track or use emulator audio
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const destination = audioContext.createMediaStreamDestination();

      oscillator.connect(destination);
      oscillator.start();

      const audioTrack = destination.stream.getAudioTracks()[0];
      if (audioTrack) {
        // Stop the oscillator immediately - we just needed it to create the track
        oscillator.stop();
        console.log("[Netplay] Created silent audio track");
        return audioTrack;
      }
    } catch (error) {
      console.warn("[Netplay] Could not create audio track:", error);
    }

    return null;
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

