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
// MetadataValidator, GameModeManager, UsernameManager, SpectatorManager, SlotManager, ChatComponent

// #region agent log
try {
} catch (e) {
  console.error("Error in NetplayEngine.js instrumentation:", e);
}
// #endregion

class NetplayEngine {
  // Room mode and phase enums for DELAY_SYNC implementation
  static RoomMode = {
    LIVE_STREAM: "live_stream",
    DELAY_SYNC: "delay_sync",
  };

  static RoomPhase = {
    LOBBY: "lobby",
    PREPARE: "prepare",
    RUNNING: "running",
    ENDED: "ended",
  };

  /**
   * Get display name for ROM (for UI only, never for validation)
   * @returns {string}
   */
  getRomDisplayName() {
    // Priority: embedded title > filename without extension > fallback
    if (this.config.romTitle) {
      return this.config.romTitle;
    }

    const filename = this.config.romName || this.config.romFilename;
    if (filename) {
      // Strip extension
      return filename.replace(/\.[^/.]+$/, "");
    }

    return "Unknown ROM";
  }

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
      hasOnUsersUpdated: !!config.callbacks?.onUsersUpdated,
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
    this.chatComponent = null;

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
        const cookies = document.cookie.split(";");
        for (const cookie of cookies) {
          const [name, value] = cookie.trim().split("=");
          if (name === "romm_sfu_token" || name === "sfu_token") {
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
          let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
          while (base64.length % 4) {
            base64 += "=";
          }

          // Decode base64 to binary string, then convert to proper UTF-8
          const binaryString = atob(base64);

          // Convert binary string to UTF-8 using TextDecoder if available, otherwise fallback
          if (typeof TextDecoder !== "undefined") {
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            return new TextDecoder("utf-8").decode(bytes);
          } else {
            // Fallback for older browsers: this may not handle all UTF-8 correctly
            return decodeURIComponent(escape(binaryString));
          }
        };

        try {
          const payloadStr = base64UrlDecode(token.split(".")[1]);
          const payload = JSON.parse(payloadStr);

          if (payload.sub) {
            // Use the netplay ID as player name, truncate if too long (Unicode-safe)
            playerName = Array.from(payload.sub).slice(0, 20).join("");
          }
        } catch (parseError) {
          console.error(
            "[NetplayEngine] Failed to parse JWT payload:",
            parseError,
          );
        }
      }
    } catch (e) {
      console.warn(
        "[NetplayEngine] Failed to extract player name from token:",
        e,
      );
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
        throw new Error(
          "ConfigManager not available - modules may not be loaded correctly",
        );
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
      this.slotManager = new SlotManager(
        this.configManager?.loadConfig() || {},
      );

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
        this.socketTransport, // Pass existing socket if reinitializing
      );

      // Connect the socket transport
      const sfuUrl =
        this.config.sfuUrl || this.config.netplayUrl || window.EJS_netplayUrl;
      if (!sfuUrl) {
        throw new Error("No SFU URL configured for socket connection");
      }

      // Get authentication token (same logic as listRooms)
      let token = window.EJS_netplayToken;
      if (!token) {
        // Try to get token from cookie
        const cookies = document.cookie.split(";");
        for (const cookie of cookies) {
          const [name, value] = cookie.trim().split("=");
          if (name === "romm_sfu_token" || name === "sfu_token") {
            token = decodeURIComponent(value);
            break;
          }
        }
      }

      console.log(
        "[NetplayEngine] Connecting socket to:",
        sfuUrl,
        token ? "(with auth token)" : "(no auth token)",
      );
      await this.socketTransport.connect(sfuUrl, token);

      // 10. SFU Transport
      this.sfuTransport = new SFUTransport(
        this.configManager?.loadConfig() || {},
        this.socketTransport,
      );

      // Initialize SFU transport (checks availability, loads device)
      const sfuAvailable = await this.sfuTransport.initialize();
      if (!sfuAvailable) {
        console.warn(
          "[NetplayEngine] SFU not available, continuing without WebRTC streaming",
        );
      }

      // 11. Data Channel Manager
      const inputMode =
        this.configManager?.getSetting("inputMode") ||
        this.config.inputMode ||
        "unorderedRelay";
      console.log(
        "[NetplayEngine] 🎮 Initializing DataChannelManager with mode:",
        inputMode,
      );
      this.dataChannelManager = new DataChannelManager({
        mode: inputMode,
      });

      // Connect DataChannelManager to SFUTransport
      if (this.sfuTransport) {
        this.sfuTransport.dataChannelManager = this.dataChannelManager;
        console.log(
          "[NetplayEngine] Connected DataChannelManager to SFUTransport",
        );
      } else {
        console.warn(
          "[NetplayEngine] SFUTransport not available for DataChannelManager connection",
        );
      }

      // Input callback will be set up later in netplayJoinRoom or setupLiveStreamInputSync

      // 12. Spectator Manager
      this.spectatorManager = new SpectatorManager(
        this.configManager?.loadConfig() || {},
        this.socketTransport,
      );

      // 13. Room Manager
      // Set up callbacks for room events
      this.config.callbacks = {
        onPlayerSlotUpdated: (playerId, newSlot) => {
          console.log(
            `[NetplayEngine] onPlayerSlotUpdated callback called for player ${playerId} to slot ${newSlot}`,
          );
          if (this.netplayMenu && this.netplayMenu.netplayUpdatePlayerSlot) {
            this.netplayMenu.netplayUpdatePlayerSlot(playerId, newSlot);
          }
        },
        onUsersUpdated: (users) => {
          console.log(
            "[NetplayEngine] onUsersUpdated callback called with users:",
            Object.keys(users || {}),
          );
          if (this.netplayMenu && this.netplayMenu.netplayUpdatePlayerList) {
            this.netplayMenu.netplayUpdatePlayerList({ players: users });
          }
        },
        onPlayerReadyUpdated: (playerId, ready) => {
          console.log(
            `[NetplayEngine] onPlayerReadyUpdated callback called for player ${playerId}: ${ready}`,
          );
          if (this.netplayMenu && this.netplayMenu.netplayUpdatePlayerReady) {
            this.netplayMenu.netplayUpdatePlayerReady(playerId, ready);
          }
        },
        onPrepareStart: (data) => {
          console.log("[NetplayEngine] onPrepareStart callback called:", data);
          if (this.netplayMenu && this.netplayMenu.netplayHandlePrepareStart) {
            this.netplayMenu.netplayHandlePrepareStart(data);
          }
        },
        onGameStart: (data) => {
          console.log("[NetplayEngine] onGameStart callback called:", data);
          if (this.netplayMenu && this.netplayMenu.netplayHandleGameStart) {
            this.netplayMenu.netplayHandleGameStart(data);
          }
        },
        onPlayerValidationUpdated: (
          playerId,
          validationStatus,
          validationReason,
        ) => {
          console.log(
            `[NetplayEngine] onPlayerValidationUpdated callback called for ${playerId}: ${validationStatus}`,
          );
          if (
            this.netplayMenu &&
            this.netplayMenu.netplayUpdatePlayerValidation
          ) {
            this.netplayMenu.netplayUpdatePlayerValidation(
              playerId,
              validationStatus,
              validationReason,
            );
          }
        },
        onRoomClosed: (data) => {
          console.log("[NetplayEngine] Room closed:", data);
        },
      };
      this.roomManager = new RoomManager(
        this.socketTransport,
        { ...this.config, ...(this.configManager?.loadConfig() || {}) },
        this.sessionState,
      );
      this.roomManager.config.callbacks = this.config.callbacks;
      this.roomManager.setupEventListeners();

      // Create emulator adapter for InputSync
      const EmulatorJSAdapterClass =
        typeof EmulatorJSAdapter !== "undefined"
          ? EmulatorJSAdapter
          : typeof window !== "undefined" && window.EmulatorJSAdapter
            ? window.EmulatorJSAdapter
            : null;

      const emulatorAdapter = new EmulatorJSAdapterClass(this.emulator);

      // 14. Input Sync (initialize first, then get callback)
      // Create slot change callback to keep playerTable in sync
      const onSlotChanged = (playerId, slot) => {
        console.log(
          "[NetplayEngine] Slot changed via InputSync:",
          playerId,
          "-> slot",
          slot,
        );
        // Update playerTable through NetplayMenu if available
        if (this.emulator?.netplay?.menu) {
          this.emulator.netplay.menu.updatePlayerSlot(playerId, slot);
        }
      };

      // Create slot getter function for centralized slot management
      const getPlayerSlot = () => {
        const myPlayerId = this.sessionState?.localPlayerId;
        const joinedPlayers = this.emulator?.netplay?.joinedPlayers || [];
        // joinedPlayers is an array, find the player by ID
        const myPlayer = joinedPlayers.find(
          (player) => player.id === myPlayerId,
        );
        // If player found in joinedPlayers, use their slot; otherwise fall back to localSlot
        return myPlayer
          ? (myPlayer.slot ?? 0)
          : (this.emulator?.netplay?.localSlot ?? 0);
      };

      // Create config with slot getter callback for SimpleController
      const inputSyncConfig = {
        ...(this.configManager?.loadConfig() || {}),
        getCurrentSlot: getPlayerSlot,
      };

      this.inputSync = new InputSync(
        emulatorAdapter,
        inputSyncConfig,
        this.sessionState,
        null, // Will set callback after creation
        onSlotChanged,
      );

      // Get the callback from InputSync
      const sendInputCallback = this.inputSync.createSendInputCallback(
        this.dataChannelManager,
        this.configManager,
        this.emulator,
        this.socketTransport,
        getPlayerSlot,
      );

      // Set the callback on InputSync
      this.inputSync.sendInputCallback = sendInputCallback;

      // Setup data channel input receiver
      if (this.dataChannelManager) {
        console.log(
          "[NetplayEngine] Setting up DataChannelManager input receiver",
        );
        this.dataChannelManager.onInput(({ payload, fromSocketId }) => {
          console.log(
            "[NetplayEngine] 🔄 Received input from DataChannelManager:",
            {
              frame: payload.getFrame(),
              slot: payload.getSlot(),
              player: payload.p,
              input: payload.k,
              value: payload.v,
              fromSocketId,
            },
          );

          // Delegate to input sync for processing
          if (this.inputSync) {
            this.inputSync.handleRemoteInput(payload, fromSocketId);
          }
        });
      } else {
        console.warn(
          "[NetplayEngine] DataChannelManager not available for input receiver setup",
        );
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
      if (this.emulator && typeof this.emulator.onFrame === "function") {
        this._frameUnsubscribe = this.emulator.onFrame((frame) => {
          // Process frame inputs (host only)
          if (this.sessionState?.isHostRole()) {
            this.processFrameInputs();
          }
        });
      }

      // Setup start event listener for producer setup (livestream hosts)
      if (this.emulator && typeof this.emulator.on === "function") {
        this.emulator.on("start", async () => {
          console.log(
            "[Netplay] Emulator start event received, checking if host should retry producer setup",
          );
          console.log("[Netplay] Current state:", {
            isHost: this.sessionState?.isHostRole(),
            netplayMode: this.emulator.netplay?.currentRoom?.netplay_mode,
          });

          // For livestream hosts, retry producer setup when game starts (in case initial setup failed)
          if (
            this.sessionState?.isHostRole() &&
            this.emulator.netplay?.currentRoom?.netplay_mode === 0
          ) {
            console.log(
              "[Netplay] Game started - retrying livestream producer setup",
            );

            try {
              // Check if we already have video/audio producers
              const hasVideoProducer = this.sfuTransport?.videoProducer;
              const hasAudioProducer = this.sfuTransport?.audioProducer;

              console.log("[Netplay] Current producer status:", {
                hasVideoProducer,
                hasAudioProducer,
              });

              // If we don't have video producer, try to create it now that canvas should be available
              if (!hasVideoProducer) {
                console.log("[Netplay] Retrying video producer creation...");
                try {
                  const videoTrack = await this.netplayCaptureCanvasVideo();
                  if (videoTrack) {
                    await this.sfuTransport.createVideoProducer(videoTrack);
                    console.log(
                      "[Netplay] ✅ Video producer created on game start",
                    );
                  } else {
                    console.warn("[Netplay] ⚠️ Still no video track available");
                  }
                } catch (videoError) {
                  console.error(
                    "[Netplay] ❌ Failed to create video producer on game start:",
                    videoError,
                  );
                }
              }

              // If we don't have audio producer, try to create it with retry logic
              if (!hasAudioProducer) {
                console.log("[Netplay] Retrying audio producer creation...");
                try {
                  let audioTrack = await this.netplayCaptureAudio();
                  let retryCount = 0;
                  const maxRetries = 3;

                  // Retry audio capture a few times in case emulator audio isn't ready yet
                  while (!audioTrack && retryCount < maxRetries) {
                    console.log(
                      `[Netplay] Game start audio capture attempt ${retryCount + 1}/${maxRetries} failed, retrying in 1 second...`,
                    );
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                    audioTrack = await this.netplayCaptureAudio();
                    retryCount++;
                  }

                  if (audioTrack) {
                    await this.sfuTransport.createAudioProducer(audioTrack);
                    console.log(
                      "[Netplay] ✅ Audio producer created on game start",
                    );
                  } else {
                    console.warn(
                      "[Netplay] ⚠️ Still no audio track available after retries",
                    );
                  }
                } catch (audioError) {
                  console.error(
                    "[Netplay] ❌ Failed to create audio producer on game start:",
                    audioError,
                  );
                }
              }
            } catch (error) {
              console.error(
                "[Netplay] Failed to retry producer setup after game start:",
                error,
              );
            }
          } else {
            console.log(
              "[Netplay] Not retrying producers - not a livestream host",
            );
          }
        });
      }

      // 15. Chat Component (only if enabled)
      const chatEnabled =
        typeof window.EJS_NETPLAY_CHAT_ENABLED === "boolean"
          ? window.EJS_NETPLAY_CHAT_ENABLED
          : (this.config.netplayChatEnabled ??
            this.configManager?.getSetting("netplayChatEnabled") ??
            false);

      if (chatEnabled) {
        this.chatComponent = new ChatComponent(
          this.emulator,
          this,
          this.socketTransport,
        );
        console.log("[NetplayEngine] ChatComponent initialized");

        // Set up chat message forwarding from socket transport
        if (this.socketTransport && this.chatComponent) {
          this.socketTransport.setupChatForwarding(this.chatComponent);
          console.log("[NetplayEngine] Chat message forwarding configured");
        }
      } else {
        console.log(
          "[NetplayEngine] ChatComponent disabled (netplayChatEnabled = false)",
        );
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
      const isHost = this.sessionState?.isHostRole() || false;

      data["sync-control"].forEach((value) => {
        const inFrame = parseInt(value.frame, 10);
        if (!value.connected_input || value.connected_input[0] < 0) return;

        if (isHost) {
          // Host: Queue input for frame processing
          this.inputSync.receiveInput(
            inFrame,
            value.connected_input,
            value.fromPlayerId || null,
          );
        } else {
          // Client (live stream mode): Apply input immediately
          const [playerIndex, inputIndex, inputValue] = value.connected_input;
          console.log(
            `[NetplayEngine] Client applying socket input immediately: player ${playerIndex}, input ${inputIndex}, value ${inputValue}`,
          );
          if (netplaySlot !== 8 && this.emulator.netplay.engine?.inputSync) {
            this.emulator.simulateInput(playerIndex, inputIndex, inputValue);
          }
        }

        // Send frame acknowledgment
        if (this.socketTransport) {
          this.socketTransport.sendFrameAck(inFrame);
        }
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
    console.log("[NetplayEngine] 🎯 processFrameInputs() called");

    if (!this.inputSync || !this.sessionState?.isHostRole()) {
      console.log("[NetplayEngine] ❌ Skipping processFrameInputs:", {
        hasInputSync: !!this.inputSync,
        isHost: this.sessionState?.isHostRole(),
      });
      return [];
    }

    // Update frame counter
    if (this.emulator && this.frameCounter) {
      const emulatorFrame = this.emulator.getCurrentFrame();
      console.log("[NetplayEngine] 📊 Frame counter update:", {
        emulatorFrame,
        frameCounter: this.frameCounter.getCurrentFrame(),
      });

      this.frameCounter.setCurrentFrame(emulatorFrame);
      this.inputSync.updateCurrentFrame(emulatorFrame);

      // Debug: Check if we have queued inputs for this frame
      const queuedInputs = this.inputSync.inputsData[emulatorFrame];
      console.log("[NetplayEngine] 📋 Queued inputs check:", {
        frame: emulatorFrame,
        queuedCount: queuedInputs?.length || 0,
        hasQueuedInputs: !!(queuedInputs && queuedInputs.length > 0),
      });

      if (queuedInputs && queuedInputs.length > 0) {
        console.log(
          `[NetplayEngine] 📝 Processing ${queuedInputs.length} queued inputs for frame ${emulatorFrame}`,
        );
        queuedInputs.forEach((input, idx) => {
          console.log(`[NetplayEngine] 📝 Input ${idx + 1}:`, input);
        });
      }
    } else {
      console.log("[NetplayEngine] ⚠️  Missing emulator or frameCounter:", {
        hasEmulator: !!this.emulator,
        hasFrameCounter: !!this.frameCounter,
      });
    }

    // Process inputs for current frame
    console.log("[NetplayEngine] 🔄 Calling inputSync.processFrameInputs()");
    const processedInputs = this.inputSync.processFrameInputs();
    console.log("[NetplayEngine] ✅ inputSync.processFrameInputs() returned:", {
      processedCount: processedInputs?.length || 0,
      processedInputs,
    });

    if (processedInputs && processedInputs.length > 0) {
      console.log(
        `[NetplayEngine] 🎉 Processed ${processedInputs.length} inputs for frame processing`,
      );
    } else {
      console.log("[NetplayEngine] 😔 No inputs processed this frame");
    }

    return processedInputs;
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
    return await this.roomManager.createRoom(
      roomName,
      maxPlayers,
      password,
      playerInfo,
    );
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
  async joinRoom(
    sessionId,
    roomName,
    maxPlayers,
    password = null,
    playerInfo = {},
  ) {
    if (!this.roomManager) {
      throw new Error("NetplayEngine not initialized");
    }
    return await this.roomManager.joinRoom(
      sessionId,
      roomName,
      maxPlayers,
      password,
      playerInfo,
    );
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
      const cookies = document.cookie.split(";");
      for (const cookie of cookies) {
        const [name, value] = cookie.trim().split("=");
        if (name === "romm_sfu_token" || name === "sfu_token") {
          headers["Authorization"] = `Bearer ${decodeURIComponent(value)}`;
          break;
        }
      }
    }

    const response = await fetch(url, { headers });
    console.log(
      `[NetplayEngine] Room list response status: ${response.status}`,
    );

    if (!response.ok) {
      console.warn(
        `[NetplayEngine] Room list fetch failed with status ${response.status}`,
      );
      return [];
    }

    const data = await response.json();
    console.log("[NetplayEngine] Raw server response:", data);

    // Convert server response format to expected format (same as netplayGetRoomList)
    const rooms = [];
    if (data && typeof data === "object") {
      console.log(
        "[NetplayEngine] Processing server data entries:",
        Object.keys(data),
      );
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
          console.log(
            `[NetplayEngine] Skipping room ${roomId} - missing room_name:`,
            roomInfo,
          );
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
    if (!this.sessionState?.isHostRole()) {
      throw new Error("Only host can initialize host transports");
    }

    try {
      console.log(
        "[Netplay] Initializing host transports (video, audio, data)...",
      );

      // Initialize SFU if needed
      if (!this.sfuTransport.useSFU) {
        await this.sfuTransport.initialize();
      }

      // Create single send transport for all media types (video, audio, data)
      await this.sfuTransport.createSendTransport("video"); // Creates the main send transport
      // Audio and data will reuse the same transport

      // Create receive transport for consuming data from clients
      await this.sfuTransport.createRecvTransport();

      console.log(
        "[Netplay] ✅ Host transports initialized (video, audio, data)",
      );
    } catch (error) {
      console.error("[Netplay] Failed to initialize host transports:", error);
      throw error;
    }
  }

  /**
   * Initialize SFU transports for client (create receive transport only).
   * @returns {Promise<void>}
   */
  async initializeClientTransports() {
    if (this.sessionState?.isHostRole()) {
      throw new Error("Host should use initializeHostTransports()");
    }

    try {
      console.log("[Netplay] Initializing client transports (receive only)...");

      // Initialize SFU if needed
      if (!this.sfuTransport.useSFU) {
        await this.sfuTransport.initialize();
      }

      // Create receive transport for consuming video/audio/data from host
      await this.sfuTransport.createRecvTransport();

      console.log("[Netplay] ✅ Client transports initialized (receive only)");
    } catch (error) {
      console.error("[Netplay] Failed to initialize client transports:", error);
      throw error;
    }
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
        console.error(
          "[Netplay] No netplay URL configured (window.EJS_netplayUrl or this.config.netplayUrl)",
        );
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
        const cookies = document.cookie.split(";");
        for (const cookie of cookies) {
          const [name, value] = cookie.trim().split("=");
          if (name === "romm_sfu_token" || name === "sfu_token") {
            headers["Authorization"] = `Bearer ${decodeURIComponent(value)}`;
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
        console.log(
          "[Netplay] Processing server data entries:",
          Object.keys(data),
        );
        Object.entries(data).forEach(([roomId, roomInfo]) => {
          console.log(`[Netplay] 🔍 Processing room ${roomId}:`, {
            roomInfo,
            netplay_mode: roomInfo?.netplay_mode,
            rom_name: roomInfo?.rom_name,
            rom_hash: roomInfo?.rom_hash,
            core_type: roomInfo?.core_type,
            allKeys: roomInfo ? Object.keys(roomInfo) : [],
          });
          if (roomInfo && roomInfo.room_name) {
            // Normalize netplay_mode (handle both string and number formats)
            const netplayMode =
              roomInfo.netplay_mode === "delay_sync" ||
              roomInfo.netplay_mode === 1
                ? "delay_sync"
                : "live_stream";

            const room = {
              id: roomId,
              name: roomInfo.room_name,
              current: roomInfo.current || 0,
              max: roomInfo.max || 4,
              hasPassword: roomInfo.hasPassword || false,
              netplay_mode: netplayMode, // Use normalized value
              sync_config: roomInfo.sync_config || null,
              spectator_mode: roomInfo.spectator_mode || 1,
              // Include all ROM and emulator metadata
              rom_hash: roomInfo.rom_hash || null,
              rom_name: roomInfo.rom_name || null,
              core_type: roomInfo.core_type || null,
              system: roomInfo.system || null,
              platform: roomInfo.platform || null,
              coreId: roomInfo.coreId || null,
              coreVersion: roomInfo.coreVersion || null,
              romHash: roomInfo.romHash || null,
              systemType: roomInfo.systemType || null,
            };
            console.log(`[Netplay] ✅ Added room to list with metadata:`, {
              id: room.id,
              netplay_mode: room.netplay_mode,
              rom_name: room.rom_name,
              rom_hash: room.rom_hash,
              core_type: room.core_type,
            });
            rooms.push(room);
          } else {
            console.log(
              `[Netplay] Skipping room ${roomId} - missing room_name:`,
              roomInfo,
            );
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
  async netplayCreateRoom(
    roomName,
    maxPlayers,
    password,
    allowSpectators = true,
    roomType = "live_stream",
    frameDelay = 2,
    syncMode = "timeout",
  ) {
    const playerName = this.getPlayerName();
    if (!playerName || playerName === "Player") {
      throw new Error("Player name not set");
    }

    // CRITICAL: Ensure engine reference is set (it might be null after leaving a room)
    // Since this method is called on the NetplayEngine instance, 'this' IS the engine
    if (!this.emulator.netplay.engine) {
      console.log("[Netplay] Engine reference was null, restoring it");
      this.emulator.netplay.engine = this;
    }

    // Also ensure netplay.engine is set for consistency (used by NetplayMenu)
    if (
      this.netplayMenu &&
      this.netplayMenu.netplay &&
      !this.netplayMenu.netplay.engine
    ) {
      this.netplayMenu.netplay.engine = this;
    }

    // Use NetplayEngine if available
    if (this.emulator.netplay.engine) {
      console.log("[Netplay] Creating room via NetplayEngine:", {
        roomName,
        maxPlayers,
        password,
        allowSpectators,
        roomType,
      });

      // Initialize engine if not already initialized
      if (!this.isInitialized()) {
        console.log("[Netplay] Engine not initialized, initializing now...");
        try {
          await this.initialize();
          console.log("[Netplay] Engine initialized successfully");
        } catch (initError) {
          console.error("[Netplay] Engine initialization failed:", initError);
          throw new Error(
            `NetplayEngine initialization failed: ${initError.message}`,
          );
        }
      }

      // Prepare player info for engine
      const playerInfo = {
        player_name: playerName,
        player_slot: this.emulator.netplay.localSlot || 0,
        domain: window.location.host,
        // ✅ ADD ROM METADATA
        romHash: this.emulator.config.romHash,
        romName: this.emulator.config.romName,
        romFilename: this.emulator.config.romFilename,
        core: this.emulator.config.core,
        system: this.emulator.config.system,
        platform: this.emulator.config.platform,
        coreId: this.emulator.config.coreId,
        coreVersion: this.emulator.config.coreVersion,
        systemType: this.emulator.config.systemType,
      };

      // Add structured metadata for DELAY_SYNC rooms
      if (roomType === "delay_sync") {
        const emulatorId = this.config.system || this.config.core || "unknown";
        const EMULATOR_NAMES = {
          snes9x: "SNES9x",
          snes9x_netplay: "SNES9x_Netplay",
          bsnes: "bsnes",
          mupen64plus: "Mupen64Plus",
          pcsx_rearmed: "PCSX-ReARMed",
          mednafen_psx: "Mednafen PSX",
          mednafen_snes: "Mednafen SNES",
          melonDS: "melonDS",
          citra: "Citra",
          dolphin: "Dolphin",
          ppsspp: "PPSSPP",
        };

        playerInfo.metadata = {
          rom: {
            displayName: this.getRomDisplayName(),
            hash: this.config.romHash
              ? {
                  algo: "sha256", // Assume SHA-256, could be configurable
                  value: this.config.romHash,
                }
              : null,
          },
          emulator: {
            id: emulatorId,
            displayName: EMULATOR_NAMES[emulatorId] || emulatorId,
            coreVersion: this.config.coreVersion || null,
          },
        };
      }

      // Add sync config for delay sync rooms
      if (roomType === "delay_sync") {
        playerInfo.sync_config = {
          frameDelay: frameDelay,
          syncMode: syncMode,
        };
      }

      // Add netplay_mode to playerInfo so it gets sent to server
      playerInfo.netplay_mode = roomType === "delay_sync" ? 1 : 0;
      playerInfo.room_phase =
        roomType === "delay_sync"
          ? NetplayEngine.RoomPhase.LOBBY
          : NetplayEngine.RoomPhase.RUNNING;

      try {
        const result = await this.createRoom(
          roomName,
          maxPlayers,
          password,
          playerInfo,
        );
        console.log("[Netplay] Room creation successful via engine:", result);

        this.emulator.netplay.engine.roomManager
          .updatePlayerMetadata(roomName, {
            coreId: this.emulator.config.system || null, // ✅ Emulator config
            coreVersion: this.emulator.config.coreVersion || null, // ✅ Emulator config
            romHash: this.emulator.config.romHash || null, // ✅ Emulator config
            systemType: this.emulator.config.system || null, // ✅ Emulator config
            platform: this.emulator.config.platform || null, // ✅ Emulator config
          })
          .catch((err) => {
            console.warn(
              "[NetplayEngine] Failed to update player metadata:",
              err,
            );
          });

        // Keep the room listing engine - it will be upgraded to a main engine

        // Store room info for later use
        this.emulator.netplay.currentRoomId = roomName; // RoomManager returns sessionid, but room ID is roomName
        this.emulator.netplay.currentRoom = {
          room_name: roomName,
          current: 1, // Creator is already joined
          max: maxPlayers,
          hasPassword: !!password,
          netplay_mode: roomType === "delay_sync" ? 1 : 0,
          room_phase:
            roomType === "delay_sync"
              ? NetplayEngine.RoomPhase.LOBBY
              : NetplayEngine.RoomPhase.RUNNING,
          sync_config:
            roomType === "delay_sync"
              ? {
                  frameDelay: frameDelay,
                  syncMode: syncMode,
                }
              : null,
          spectator_mode: allowSpectators ? 1 : 0,
          // Include detailed metadata for all room types
          metadata: {
            // Legacy fields for backward compatibility
            rom_hash: this.emulator.config.romHash || null,
            core_type: this.emulator.config.system || null, // ✅ Fix: use system
            system: this.emulator.config.system || null,
            platform: this.emulator.config.platform || null,
            coreId: this.emulator.config.system || null, // ✅ Fix: use system
            coreVersion: this.emulator.config.coreVersion || null,
            romHash: this.emulator.config.romHash || null,
            systemType: this.emulator.config.system || null,
            netplay_mode: roomType === "delay_sync" ? 1 : 0, // ✅ Add netplay_mode
          },
        };

        // For DELAY_SYNC, update room metadata after creation
        if (roomType === "delay_sync") {
          this.emulator.netplay.engine.roomManager
            .updateRoomMetadata(roomName, {
              // core, rom and system metadata
              rom_hash: this.emulator.config.romHash || null,
              rom_name:
                this.emulator.config.romName ||
                this.emulator.config.romFilename ||
                null,
              core_type: this.emulator.config.system || null, // Fixed
              system: this.emulator.config.system || null,
              platform: this.emulator.config.platform || null,
              coreId: this.emulator.config.system || null,
              coreVersion: this.emulator.config.coreVersion || null,
              romHash: this.emulator.config.romHash || null,
              systemType: this.emulator.config.system || null,
            })
            .catch((err) => {
              console.warn(
                "[NetplayEngine] Failed to update room metadata:",
                err,
              );
            });
        }
        // After room creation, join the room using unified join logic
        // This ensures host and guest use the same code path
        console.log(
          "[Netplay] Room created, now joining via unified join logic",
        );
        try {
          // Join the room we just created (host joins their own room)
          await this.netplayJoinRoom(
            roomName,
            !!password,
            roomType === "delay_sync" ? "delay_sync" : "live_stream",
          );
          console.log("[Netplay] Host successfully joined their own room");
        } catch (joinError) {
          console.error(
            "[Netplay] Failed to join room after creation:",
            joinError,
          );
          // Don't throw - room was created successfully, join failure is separate
          // The UI might already be switched by netplayJoinRoom
        }

        return result;
      } catch (error) {
        console.error("[Netplay] Room creation failed via engine:", error);
        throw error;
      }
    }

    // Fallback to old direct HTTP method if engine not available
    console.log(
      "[Netplay] NetplayEngine not available, falling back to direct HTTP",
    );

    // Determine netplay mode
    const netplayMode = roomType === "delay_sync" ? 1 : 0;

    // Create sync config for delay sync rooms
    let syncConfig = null;
    if (roomType === "delay_sync") {
      syncConfig = {
        frameDelay: frameDelay,
        syncMode: syncMode,
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
      spectatorMode,
    });

    // Request a write token from RomM for room creation
    console.log("[Netplay] Requesting write token for room creation...");
    let writeToken = null;
    try {
      // Try to get a write token from RomM
      const tokenResponse = await fetch("/api/sfu/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Include auth headers if available
        },
        body: JSON.stringify({ token_type: "write" }),
      });

      if (tokenResponse.ok) {
        const tokenData = await tokenResponse.json();
        writeToken = tokenData.token;
        console.log("[Netplay] Obtained write token for room creation");
      } else {
        console.warn(
          "[Netplay] Failed to get write token, falling back to existing token",
        );
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
      "Content-Type": "application/json",
    };

    // Add authentication - prefer write token, fallback to existing token
    const token = writeToken || window.EJS_netplayToken;
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    } else {
      // Try to get token from cookie
      const cookies = document.cookie.split(";");
      for (const cookie of cookies) {
        const [name, value] = cookie.trim().split("=");
        if (name === "romm_sfu_token" || name === "sfu_token") {
          headers["Authorization"] = `Bearer ${decodeURIComponent(value)}`;
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
      rom_hash: this.emulator.config.romHash || null,
      core_type: this.emulator.config.core || null,
      system: this.emulator.config.system || null,
      platform: this.emulator.config.platform || null,
      coreId: this.emulator.config.core || null,
      coreVersion: this.emulator.config.coreVersion || null,
      romHash: this.emulator.config.romHash || null,
      systemType: this.emulator.config.system || null,
    };

    console.log("[Netplay] Room creation payload:", roomData);

    const response = await fetch(createUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(roomData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[Netplay] Room creation failed with status ${response.status}:`,
        errorText,
      );
      throw new Error(`Room creation failed: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    console.log("[Netplay] Room creation successful:", result);

    // Store room info for later use
    this.emulator.netplay.currentRoomId = result.room_id || result.id;
    this.emulator.netplay.currentRoom = result.room || result;

    // Update session state with local player's slot from server response
    if (this.sessionState && result.room?.players) {
      const localPlayerId = this.sessionState.localPlayerId;
      if (localPlayerId) {
        const localPlayer = Object.values(result.room.players).find(p => p.id === localPlayerId);
        if (localPlayer && localPlayer.slot !== undefined && localPlayer.slot !== null) {
          this.sessionState.setLocalPlayerSlot(localPlayer.slot);
          console.log("[Netplay] Updated session state slot to:", localPlayer.slot);
        } else {
          console.warn("[Netplay] Local player not found in server players or slot invalid");
        }
      }
    }

    // Switch to appropriate room UI
    if (roomType === "live_stream") {
      this.netplayMenu.netplaySwitchToLiveStreamRoom(roomName, password);
    } else if (roomType === "delay_sync") {
      this.netplayMenu.netplaySwitchToDelaySyncRoom(
        roomName,
        password,
        maxPlayers,
      );
    }

    // Note: Producer setup only available with NetplayEngine
  }

  // Helper method to set up WebRTC consumer transports
  // Called for all users to consume from other users' producers
  async netplaySetupConsumers() {
    console.log("[Netplay] 🎥 netplaySetupConsumers() called");
    console.log(
      "[Netplay] Current user is host:",
      this.emulator.netplay.engine?.sessionState?.isHostRole(),
    );
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
          const existingVideoAudioProducers = await new Promise(
            (resolve, reject) => {
              this.socketTransport.emit(
                "sfu-get-producers",
                {},
                (error, producers) => {
                  if (error) {
                    console.error(
                      "[Netplay] Failed to get existing video/audio producers:",
                      error,
                    );
                    reject(error);
                    return;
                  }
                  console.log(
                    "[Netplay] Received existing video/audio producers:",
                    producers,
                  );
                  resolve(producers || []);
                },
              );
            },
          );

          // Request existing data producers
          const existingDataProducers = await new Promise((resolve, reject) => {
            this.socketTransport.emit(
              "sfu-get-data-producers",
              {},
              (error, producers) => {
                if (error) {
                  console.error(
                    "[Netplay] Failed to get existing data producers:",
                    error,
                  );
                  reject(error);
                  return;
                }
                console.log(
                  "[Netplay] Received existing data producers:",
                  producers,
                );
                resolve(producers || []);
              },
            );
          });

          // Combine all producers - use actual kinds from SFU instead of defaulting to video
          const existingProducers = [
            ...existingVideoAudioProducers.map((p) => ({
              ...p,
              source: "video-audio",
              kind: p.kind || "unknown",
            })),
            // Clients should NOT consume host's data producers - they create their own data producers instead
            // Only hosts consume data producers from clients
            // ...existingDataProducers.map(p => ({ ...p, source: 'data', kind: p.kind || 'data' }))
          ];
          console.log(
            "[Netplay] Combined existing producers:",
            existingProducers,
          );

          // Create consumers for existing producers
          // Create consumers for existing producers
          for (const producer of existingProducers) {
            try {
              console.log(
                `[Netplay] Creating consumer for existing producer:`,
                producer,
              );

              try {
                // Create consumer based on producer kind
                const producerKind = producer.kind || "unknown";
                console.log(`[Netplay] Producer kind: ${producerKind}`);

                // Skip data producers for clients - clients create their own data producers
                if (producerKind === "data") {
                  console.log(
                    `[Netplay] Skipping data producer - clients don't consume host's data producers`,
                  );
                  continue;
                }

                if (producerKind === "video") {
                  const consumer = await this.sfuTransport.createConsumer(
                    producer.id,
                    "video",
                  );
                  console.log(
                    `[Netplay] ✅ Created video consumer for existing producer:`,
                    consumer.id,
                  );
                  if (consumer.track) {
                    // Use actual consumer kind returned by SFU, not assumed producer kind
                    this.netplayMenu.netplayAttachConsumerTrack(
                      consumer.track,
                      consumer.kind,
                    );
                  }
                } else if (producerKind === "audio") {
                  const consumer = await this.sfuTransport.createConsumer(
                    producer.id,
                    "audio",
                  );
                  console.log(
                    `[Netplay] ✅ Created audio consumer for existing producer:`,
                    consumer.id,
                  );
                  if (consumer.track) {
                    // Use actual consumer kind returned by SFU, not assumed producer kind
                    this.netplayMenu.netplayAttachConsumerTrack(
                      consumer.track,
                      consumer.kind,
                    );
                  }
                } else if (producerKind === "unknown") {
                  // Unknown kind - try to create consumer and use actual kind returned by SFU
                  console.log(
                    `[Netplay] Unknown producer kind, trying to create consumer to determine actual kind`,
                  );
                  try {
                    const consumer = await this.sfuTransport.createConsumer(
                      producer.id,
                      "video",
                    ); // Try video first
                    console.log(
                      `[Netplay] ✅ Created consumer for unknown producer:`,
                      consumer.id,
                      `actual kind: ${consumer.kind}`,
                    );
                    if (consumer.track) {
                      // Use actual consumer kind returned by SFU
                      this.netplayMenu.netplayAttachConsumerTrack(
                        consumer.track,
                        consumer.kind,
                      );
                    }
                  } catch (videoError) {
                    // If video fails, try audio
                    console.log(
                      `[Netplay] Video consumer failed, trying audio for unknown producer`,
                    );
                    try {
                      const consumer = await this.sfuTransport.createConsumer(
                        producer.id,
                        "audio",
                      );
                      console.log(
                        `[Netplay] ✅ Created audio consumer for unknown producer:`,
                        consumer.id,
                      );
                      if (consumer.track) {
                        this.netplayMenu.netplayAttachConsumerTrack(
                          consumer.track,
                          consumer.kind,
                        );
                      }
                    } catch (audioError) {
                      console.warn(
                        `[Netplay] Failed to create consumer for unknown producer ${producer.id}:`,
                        audioError.message,
                      );
                    }
                  }
                }
              } catch (error) {
                console.warn(
                  `[Netplay] Failed to create consumer for existing producer ${producer.id}:`,
                  error.message,
                );
                console.log(
                  `[Netplay] Producer may no longer exist (host may have left), skipping and waiting for new producers`,
                );
              }
            } catch (error) {
              console.warn(
                `[Netplay] Failed to create consumer for existing producer ${producer.id}:`,
                error.message,
              );
            }
          }
        }
      } catch (error) {
        console.warn("[Netplay] Failed to get existing producers:", error);
      }

      // Listen for new producers from any user (for bidirectional communication)
      console.log("[Netplay] Setting up new-producer event listener");
      if (this.socketTransport) {
        console.log(
          "[Netplay] Socket is connected:",
          this.socketTransport.isConnected(),
        );
        this.socketTransport.on("new-producer", async (data) => {
          console.log("[Netplay] 📡 RECEIVED new-producer event:", data);
          console.log("[Netplay] Producer details:", {
            id: data.id,
            kind: data.kind,
            socketId: this.socketTransport?.socket?.id,
            isHost: this.sessionState?.isHostRole(),
          });

          try {
            const producerId = data.id;
            const producerKind = data.kind; // Now provided by SFU server

            if (!producerKind) {
              console.warn(
                "[Netplay] Producer kind not provided, trying video, audio, then data",
              );
              // Try video first, then audio, then data if those fail
              try {
                const consumer = await this.sfuTransport.createConsumer(
                  producerId,
                  "video",
                );
                console.log(
                  `[Netplay] ✅ Created video consumer:`,
                  consumer.id,
                );
                if (consumer.track) {
                  console.log(`[Netplay] 🎥 Video track ready, attaching...`);
                  this.netplayMenu.netplayAttachConsumerTrack(
                    consumer.track,
                    "video",
                  );
                } else {
                  console.warn(
                    `[Netplay] ⚠️ Video consumer created but no track available`,
                  );
                }
              } catch (videoError) {
                console.log(
                  `[Netplay] Video consumer failed, trying audio:`,
                  videoError.message,
                );
                try {
                  const consumer = await this.sfuTransport.createConsumer(
                    producerId,
                    "audio",
                  );
                  console.log(
                    `[Netplay] ✅ Created audio consumer:`,
                    consumer.id,
                  );
                  if (consumer.track) {
                    console.log(`[Netplay] 🎵 Audio track ready, attaching...`);
                    this.netplayMenu.netplayAttachConsumerTrack(
                      consumer.track,
                      "audio",
                    );
                  } else {
                    console.warn(
                      `[Netplay] ⚠️ Audio consumer created but no track available`,
                    );
                  }
                } catch (audioError) {
                  // Don't try data - clients don't consume host's data producers
                  console.warn(
                    "[Netplay] Failed to create video/audio consumer, skipping (not data):",
                    audioError.message,
                  );
                }
              }
              return;
            }

            // Skip data producers for clients
            if (producerKind === "data") {
              console.log(
                `[Netplay] Skipping data producer - clients don't consume host's data producers`,
              );
              return;
            }

            console.log(
              `[Netplay] Creating ${producerKind} consumer for producer ${producerId}`,
            );
            const consumer = await this.sfuTransport.createConsumer(
              producerId,
              producerKind,
            );
            console.log(
              `[Netplay] ✅ Created ${producerKind} consumer:`,
              consumer.id,
            );

            if (consumer.track) {
              console.log(
                `[Netplay] 🎵 Consumer track ready: ${producerKind}`,
                {
                  trackId: consumer.track.id,
                  kind: consumer.track.kind,
                  enabled: consumer.track.enabled,
                  muted: consumer.track.muted,
                  readyState: consumer.track.readyState,
                },
              );
              this.netplayMenu.netplayAttachConsumerTrack(
                consumer.track,
                producerKind,
              );
            } else {
              console.warn(
                `[Netplay] ⚠️ Consumer created but no track available: ${producerKind}`,
              );
            }
          } catch (error) {
            console.error(
              "[Netplay] ❌ Failed to create consumer for new producer:",
              error,
            );
            console.error("[Netplay] Error details:", {
              message: error.message,
              stack: error.stack,
              producerId: data?.id,
              producerKind: data?.kind,
            });
          }
        });

        // Note: Clients don't listen for new-data-producer events since they don't consume host's data producers
        // Only hosts listen for new-data-producer events (implemented in netplaySetupDataConsumers)

        // Also listen for users-updated to track room changes
        this.socketTransport.on("users-updated", (users) => {
          console.log(
            "[Netplay] 👥 RECEIVED users-updated from consumer socket:",
            Object.keys(users || {}),
          );
        });
      } else {
        console.warn(
          "[Netplay] No socket transport available for consumer setup",
        );
      }
      console.log(
        "[Netplay] Consumer setup complete - listening for new producers",
      );

      // Periodically check for existing producers in case they were created after initial check
      // This handles race conditions where host creates producers before client sets up listener
      const checkForProducers = async () => {
        try {
          if (!this.socketTransport || !this.socketTransport.isConnected()) {
            return false; // Signal to stop checking
          }

          const existingVideoAudioProducers = await new Promise(
            (resolve, reject) => {
              this.socketTransport.emit(
                "sfu-get-producers",
                {},
                (error, producers) => {
                  if (error) {
                    reject(error);
                    return;
                  }
                  resolve(producers || []);
                },
              );
            },
          );

          if (existingVideoAudioProducers.length > 0) {
            console.log(
              "[Netplay] 🔍 Found existing producers on retry:",
              existingVideoAudioProducers,
            );
            let createdNewConsumer = false;

            // Create consumers for any producers we haven't consumed yet
            for (const producer of existingVideoAudioProducers) {
              const producerId = producer.id;
              const producerKind = producer.kind || "unknown";

              // Check if we already have a consumer for this producer
              const existingConsumer =
                this.sfuTransport?.consumers?.get(producerId);
              if (existingConsumer) {
                console.log(
                  `[Netplay] Already have consumer for producer ${producerId}, skipping`,
                );
                continue;
              }

              if (producerKind === "data") {
                continue; // Skip data producers
              }

              try {
                console.log(
                  `[Netplay] Creating consumer for existing producer found on retry:`,
                  producer,
                );
                const consumer = await this.sfuTransport.createConsumer(
                  producerId,
                  producerKind,
                );
                console.log(
                  `[Netplay] ✅ Created ${producerKind} consumer from retry:`,
                  consumer.id,
                );
                if (consumer.track) {
                  this.netplayMenu.netplayAttachConsumerTrack(
                    consumer.track,
                    producerKind,
                  );
                }
                createdNewConsumer = true;
              } catch (error) {
                console.warn(
                  `[Netplay] Failed to create consumer for producer ${producerId} on retry:`,
                  error.message,
                );
              }
            }

            // If we didn't create any new consumers, all producers are already consumed
            if (!createdNewConsumer) {
              console.log(
                "[Netplay] All existing producers already have consumers, stopping periodic check",
              );
              return false; // Signal to stop checking
            }
          } else {
            // No producers found, can stop checking
            console.log(
              "[Netplay] No existing producers found, stopping periodic check",
            );
            return false; // Signal to stop checking
          }
        } catch (error) {
          console.debug(
            "[Netplay] Error checking for producers on retry:",
            error.message,
          );
        }
      };

      const checkForProducersInterval = setInterval(() => {
        checkForProducers()
          .then((shouldStop) => {
            if (shouldStop === false) {
              clearInterval(checkForProducersInterval);
            }
          })
          .catch((err) => {
            console.debug(
              "[Netplay] Unhandled error in producer check interval:",
              err.message,
            );
          });
      }, 2000); // Check every 2 seconds

      // Clear interval after 30 seconds (producers should be created by then)
      setTimeout(() => {
        clearInterval(checkForProducersInterval);
        console.log("[Netplay] Stopped periodic producer check");
      }, 30000);
    } catch (error) {
      console.error("[Netplay] Consumer setup failed:", error);
    }
  }

  // Helper method to join a room
  async netplayJoinRoom(roomId, hasPassword, roomNetplayMode = null) {
    // Ensure NetplayEngine is available for joining
    if (!this.emulator.netplay.engine) {
      console.log("[Netplay] Engine not available, reinitializing for room join");
      await this.netplayInitializeEngine(roomId);
    }
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
      console.log("[Netplay] Joining room via NetplayEngine:", {
        roomId,
        password,
        roomNetplayMode,
      });

      // Initialize engine if not already initialized
      if (!this.isInitialized()) {
        console.log("[Netplay] Engine not initialized, initializing now...");
        try {
          await this.initialize();
          console.log("[Netplay] Engine initialized successfully");
        } catch (initError) {
          console.error("[Netplay] Engine initialization failed:", initError);
          throw new Error(
            `NetplayEngine initialization failed: ${initError.message}`,
          );
        }
      }

      // Prepare player info for engine
      const playerInfo = {
        player_name: playerName,
        player_slot: this.emulator.netplay.localSlot || 0,
        domain: window.location.host,
        // ✅ ADD ROM METADATA FOR COMPATIBILITY VALIDATION
        romHash: this.emulator.config.romHash || null,
        romName: this.emulator.config.romName || null,
        romFilename: this.emulator.config.romFilename || null,
        core: this.emulator.config.core || null,
        system: this.emulator.config.system || null,
        platform: this.emulator.config.platform || null,
        coreId:
          this.emulator.config.coreId || this.emulator.config.system || null,
        coreVersion: this.emulator.config.coreVersion || null,
        systemType:
          this.emulator.config.systemType ||
          this.emulator.config.system ||
          null,
      };

      try {
        // Check if we're joining a room we just created (room creator is always host)
        const wasRoomCreator = this.emulator.netplay.currentRoomId === roomId;

        const result = await this.joinRoom(
          null,
          roomId,
          4,
          password,
          playerInfo,
        );
        console.log("[Netplay] Room join successful via engine:", result);

        // Update player list immediately after successful join
        if (result.users) {
          console.log("[Netplay] Updating player list immediately after join with users:", Object.keys(result.users));
          this.netplayMenu.netplayUpdatePlayerList({ players: result.users });
        }
        console.log("[Netplay] Room join successful via engine:", result);

        // CRITICAL: If we created this room, ensure we're marked as host
        // (joinRoom might have overwritten it based on server response)
        if (wasRoomCreator && this.sessionState) {
          console.log(
            "[Netplay] Room creator detected - ensuring host role is set",
          );
          this.sessionState.setHost(true);
        } 

        // Store room info
        this.emulator.netplay.currentRoomId = roomId;

        // Ensure currentRoom has netplay_mode set (use roomNetplayMode from room list if available)
        if (this.emulator.netplay.currentRoom) {
          // Set netplay_mode from roomNetplayMode parameter or result
          if (roomNetplayMode !== null && roomNetplayMode !== undefined) {
            this.emulator.netplay.currentRoom.netplay_mode =
              roomNetplayMode === "delay_sync" || roomNetplayMode === 1
                ? "delay_sync"
                : "live_stream";
          } else if (!this.emulator.netplay.currentRoom.netplay_mode) {
            // Fallback: determine from result.netplay_mode
            this.emulator.netplay.currentRoom.netplay_mode =
              result.netplay_mode === "delay_sync" || result.netplay_mode === 1
                ? "delay_sync"
                : "live_stream";
          }
          console.log(
            `[Netplay] Stored currentRoom.netplay_mode: ${this.emulator.netplay.currentRoom.netplay_mode}`,
          );
        }

        // Switch to appropriate room UI and setup based on room type
        // Use roomNetplayMode from room list, fallback to result.netplay_mode
        let roomType = "live_stream"; // default
        if (roomNetplayMode === "delay_sync" || roomNetplayMode === 1) {
          roomType = "delay_sync";
        } else if (
          result.netplay_mode === "delay_sync" ||
          result.netplay_mode === 1
        ) {
          roomType = "delay_sync";
        } else if (roomNetplayMode === "live_stream" || roomNetplayMode === 0) {
          roomType = "live_stream";
        } else if (
          result.netplay_mode === "live_stream" ||
          result.netplay_mode === 0
        ) {
          roomType = "live_stream";
        }

        console.log(
          `[Netplay] Determined room type: ${roomType} (from roomNetplayMode: ${roomNetplayMode}, result.netplay_mode: ${result.netplay_mode})`,
        );

        // Ensure correct host status for clients joining existing rooms
        if (!wasRoomCreator && this.sessionState) {
          this.sessionState.setHost(false);
          console.log("[Netplay] Explicitly set host to false for client joining existing room");
        }

        // Set currentRoomType before updating player list
        this.netplayMenu.currentRoomType = roomType === "delay_sync" ? "delaysync" : "livestream";

        // Update player list immediately after successful join
        if (result.users) {
          console.log("[Netplay] Updating player list immediately after join with users:", Object.keys(result.users));
          this.netplayMenu.netplayUpdatePlayerList({ players: result.users });
        }

        if (roomType === "live_stream") {
          this.netplayMenu.netplaySwitchToLiveStreamRoom(roomId, password);

          // LIVESTREAM ROOM: Set up WebRTC consumer transports
          // Both hosts and clients need consumers for data channels
          // Only clients need video/audio consumers from host
          // CRITICAL: Use this.sessionState (not this.emulator.netplay.engine.sessionState)
          // because 'this' IS the NetplayEngine instance
          const isHost = this.sessionState?.isHostRole();
          console.log(
            "[Netplay] After joining livestream room - isHost:",
            isHost,
            "sessionState.isHost:",
            this.sessionState?.isHost,
          );

          if (this.emulator.netplay.engine) {
            // PAUSE LOCAL EMULATOR FOR CLIENTS - they should watch the host's stream
            if (!isHost) {
              console.log("[Netplay] Pausing emulator for client (watching host stream)");
              if (typeof this.emulator.pause === "function") {
                this.emulator.pause();
              } else if (this.emulator.netplay.adapter && typeof this.emulator.netplay.adapter.pause === "function") {
                this.emulator.netplay.adapter.pause();
              } else {
                console.warn("[Netplay] Could not pause emulator - no pause method available");
              }
            } else {
              // Host: Set up video/audio producers (with continuous retry)
              console.log(
                "[Netplay] Host: Setting up video/audio producers with continuous retry",
              );
              console.log("[Netplay] Host session state:", {
                isHost: this.sessionState?.isHostRole(),
                sessionState: this.sessionState,
              });

              // Start producer setup immediately
              this.netplaySetupProducers().catch((err) => {
                console.error("[Netplay] Initial producer setup failed:", err);
              });

              // Also set up continuous retry every 5 seconds for hosts in livestream rooms
              // This ensures producers get created even if canvas isn't available initially
              this._producerRetryInterval = setInterval(() => {
                if (
                  this.sessionState?.isHostRole() &&
                  this.emulator.netplay?.currentRoom?.netplay_mode === 0
                ) {
                  // Check if we have both video and audio producers
                  const hasVideo = this.sfuTransport?.videoProducer;
                  const hasAudio = this.sfuTransport?.audioProducer;

                  if (!hasVideo || !hasAudio) {
                    console.log(
                      "[Netplay] Host retrying producer setup - missing producers:",
                      { hasVideo, hasAudio },
                    );
                    this.netplaySetupProducers().catch((err) => {
                      console.debug(
                        "[Netplay] Producer retry failed:",
                        err.message,
                      );
                    });
                  } else {
                    console.log(
                      "[Netplay] Host has all producers, stopping retry",
                    );
                    clearInterval(this._producerRetryInterval);
                    this._producerRetryInterval = null;
                  }
                } else {
                  // No longer host or not in livestream room
                  if (this._producerRetryInterval) {
                    console.log(
                      "[Netplay] Stopping producer retry - no longer host or livestream room",
                    );
                    clearInterval(this._producerRetryInterval);
                    this._producerRetryInterval = null;
                  }
                }
              }, 5000);
            }

            // Set up data producers for input
            // Host always sends input, clients send input if they have a player slot assigned
            const currentPlayerSlot = this.emulator.netplay.localSlot;
            const hasPlayerSlot =
              currentPlayerSlot !== undefined &&
              currentPlayerSlot !== null &&
              currentPlayerSlot >= 0;

            // Set up WebRTC consumers for video/audio/data (both hosts and clients need data consumers)
            console.log("[Netplay] Setting up WebRTC consumers for live stream room");
            setTimeout(() => {
              this.netplaySetupConsumers().catch((err) => {
                console.error("[Netplay] Failed to setup consumers:", err);
              });
            }, 1000);

            // Set up data producers for clients who have player slots (to send inputs to host)
            if (hasPlayerSlot) {
              console.log(
                "[Netplay] Client has player slot, setting up data producers for input",
              );
              setTimeout(() => {
                this.netplaySetupDataProducers().catch((err) => {
                  console.error(
                    "[Netplay] Failed to setup data producers:",
                    err,
                  );
                });
              }, 1500);

              // Check if P2P mode is enabled and initiate P2P connection
              // First check emulator settings, then configManager, then DataChannelManager mode
              const emulatorInputMode =
                this.emulator?.getSettingValue?.("netplayInputMode") ||
                this.emulator?.netplayInputMode;
              const configInputMode =
                this.configManager?.getSetting("netplayInputMode");
              const dataChannelMode = this.dataChannelManager?.mode;
              const inputMode =
                emulatorInputMode ||
                configInputMode ||
                dataChannelMode ||
                this.config.inputMode ||
                "unorderedRelay";

              console.log(
                `[Netplay] P2P mode check: emulator=${emulatorInputMode}, config=${configInputMode}, dataChannel=${dataChannelMode}, final=${inputMode}`,
              );

              console.log(
                `[Netplay] Client checking P2P setup: mode=${inputMode}, hasSlot=${hasPlayerSlot}`,
              );

              if (
                (inputMode === "unorderedP2P" || inputMode === "orderedP2P") &&
                hasPlayerSlot
              ) {
                console.log(
                  `[Netplay] Client input mode is ${inputMode}, initiating P2P connection to host...`,
                );
                setTimeout(() => {
                  this.netplayInitiateP2PConnection().catch((err) => {
                    console.error(
                      "[Netplay] Failed to initiate P2P connection:",
                      err,
                    );
                  });
                }, 2000);
              } else {
                console.log(
                  `[Netplay] Client not setting up P2P: mode=${inputMode}, hasSlot=${hasPlayerSlot}`,
                );
              }
            } else {
              console.log(
                "[Netplay] Client has no player slot assigned - spectator mode",
              );
            }
          }
          // Note: Video/audio consumption is handled by new-producer events
        } else if (roomType === "delay_sync") {
          this.netplayMenu.netplaySwitchToDelaySyncRoom(roomId, password, 4); // max players not returned, default to 4

          // DELAY SYNC ROOM: Set up bidirectional WebRTC communication
          if (this.emulator.netplay.engine) {
            console.log(
              "[Netplay] Setting up WebRTC transports for delay-sync bidirectional communication",
            );
            setTimeout(() => this.netplaySetupConsumers(), 1000);
            
            // Set up WebRTC consumers for video/audio/data (both hosts and clients need data consumers)
            console.log("[Netplay] Setting up WebRTC consumers for live stream room");
            setTimeout(() => {
              this.netplaySetupConsumers().catch((err) => {
                console.error("[Netplay] Failed to setup consumers:", err);
              });
            }, 1000);
          }
        }

        // Show chat component after successful room join (only if enabled)
        if (this.chatComponent) {
          console.log("[Netplay] Showing chat component after room join");
          this.chatComponent.clearMessages(); // Clear any previous messages
          this.chatComponent.show();
        }

        return result;
      } catch (error) {
        console.error("[Netplay] Room join failed via engine:", error);
        throw error;
      }
    }

    // Fallback to old direct HTTP method if engine not available
    console.log(
      "[Netplay] NetplayEngine not available, falling back to direct HTTP",
    );

    console.log("[Netplay] Joining room:", { roomId, password });

    // Request a write token from RomM for room joining
    console.log("[Netplay] Requesting write token for room joining...");
    let writeToken = null;
    try {
      const tokenResponse = await fetch("/api/sfu/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token_type: "write" }),
      });

      if (tokenResponse.ok) {
        const tokenData = await tokenResponse.json();
        writeToken = tokenData.token;
        console.log("[Netplay] Obtained write token for room joining");
      } else {
        console.warn(
          "[Netplay] Failed to get write token, falling back to existing token",
        );
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
      "Content-Type": "application/json",
    };

    // Add authentication - prefer write token, fallback to existing token
    const token = writeToken || window.EJS_netplayToken;
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    } else {
      // Try to get token from cookie
      const cookies = document.cookie.split(";");
      for (const cookie of cookies) {
        const [name, value] = cookie.trim().split("=");
        if (name === "romm_sfu_token" || name === "sfu_token") {
          headers["Authorization"] = `Bearer ${decodeURIComponent(value)}`;
          break;
        }
      }
    }

    const joinData = {
      password: password,
      player_name: this.emulator.netplay.getNetplayId(),
      domain: window.location.host,
    };

    console.log("[Netplay] Room join payload:", joinData);

    const response = await fetch(joinUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(joinData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[Netplay] Room join failed with status ${response.status}:`,
        errorText,
      );
      throw new Error(`Room join failed: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    console.log("[Netplay] Room join successful:", result);

    // Store room info
    this.emulator.netplay.currentRoomId = roomId;
    this.emulator.netplay.currentRoom = result.room || result;

    // Update session state with local player's slot from server response
    if (this.sessionState && result.room?.players) {
      const localPlayerId = this.sessionState.localPlayerId;
      if (localPlayerId) {
        const localPlayer = Object.values(result.room.players).find(p => p.id === localPlayerId);
        if (localPlayer && localPlayer.slot !== undefined && localPlayer.slot !== null) {
          this.sessionState.setLocalPlayerSlot(localPlayer.slot);
          console.log("[Netplay] Updated session state slot to:", localPlayer.slot);
        } else {
          console.warn("[Netplay] Local player not found in server players or slot invalid");
        }
      }
    }

    // Switch to appropriate room UI based on room type
    const roomType =
      result.room?.netplay_mode === 1 ? "delay_sync" : "live_stream";
    if (roomType === "live_stream") {
      this.netplayMenu.netplaySwitchToLiveStreamRoom(
        result.room?.room_name || "Unknown Room",
        password,
      );
    } else if (roomType === "delay_sync") {
      this.netplayMenu.netplaySwitchToDelaySyncRoom(
        result.room?.room_name || "Unknown Room",
        password,
        result.room?.max || 4,
      );
    }
  }

  // Initialize the netplay engine for real-time communication
  async netplayInitializeEngine(roomName) {
    console.log("[Netplay] Initializing netplay engine for room:", roomName);

    // Set up netplay simulateInput if not already done (always needed)
    if (!this.emulator.netplay.simulateInput) {
      this.emulator.netplay.simulateInput = (
        playerIndex,
        inputIndex,
        value,
      ) => {
        // In netplay, use the local player's slot from centralized playerTable
        const myPlayerId =
          this.emulator.netplay?.engine?.sessionState?.localPlayerId;
        const joinedPlayers = this.emulator.netplay?.joinedPlayers || [];
        // joinedPlayers is an array, find the player by ID
        const myPlayer = joinedPlayers.find(
          (player) => player.id === myPlayerId,
        );
        // If player found in joinedPlayers, use their slot; otherwise fall back to localSlot
        const mySlot = myPlayer
          ? (myPlayer.slot ?? 0)
          : (this.emulator.netplay?.localSlot ?? 0);

        console.log("[Netplay] Processing input via netplay.simulateInput:", {
          originalPlayerIndex: playerIndex,
          mySlot,
          inputIndex,
          value,
        });
        if (this.emulator.netplay.engine && this.inputSync) {
          console.log(
            "[Netplay] Sending input through InputSync using player table slot:",
            mySlot,
          );
          return this.inputSync.sendInput(mySlot, inputIndex, value);
        } else {
          console.warn("[Netplay] InputSync not available, input ignored");
          return false;
        }
      };
      console.log("[Netplay] Set up netplay.simulateInput");
    }

    // Check if we have an existing engine that can be upgraded
    const hasExistingEngine =
      this.emulator.netplay.engine && this.isInitialized();
    const existingIsRoomListing =
      this.emulator.netplay.engine?.config?.isRoomListing === true;
    const existingIsMain =
      this.emulator.netplay.engine?.config?.isRoomListing === false;

    console.log(
      `[Netplay] Checking existing engine: exists=${!!this.emulator.netplay.engine}, initialized=${hasExistingEngine}, isRoomListing=${existingIsRoomListing}, isMain=${existingIsMain}`,
    );

    if (existingIsMain) {
      console.log(
        "[Netplay] Main NetplayEngine already initialized, skipping setup",
      );
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
        onPlayerSlotUpdated: (playerId, newSlot) => {
          if (this.netplayMenu?.netplayUpdatePlayerSlot) {
            this.netplayMenu.netplayUpdatePlayerSlot(playerId, newSlot);
          }
        },
        onUsersUpdated: (users) => {
          this.netplayMenu.netplayUpdatePlayerList({ players: users });
        },
        onRoomClosed: (data) => {
          console.log("[Netplay] Room closed:", data);
        },
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

      if (
        !NetplayEngineClass ||
        !EmulatorJSAdapterClass ||
        !SocketTransportClass
      ) {
        console.error("[Netplay] CRITICAL: Netplay classes not found!");
        console.error(
          "[Netplay] The emulator files served by RomM do not include netplay support.",
        );
        console.error("[Netplay] You need to:");
        console.error(
          "[Netplay] 1. Build EmulatorJS with netplay: cd EmulatorJS-SFU && npm run minify",
        );
        console.error("[Netplay] 2. Copy the built files to RomM:");
        console.error(
          "[Netplay]    cp EmulatorJS-SFU/data/emulator.min.js RomM/frontend/public/assets/emulatorjs/",
        );
        console.error(
          "[Netplay]    cp EmulatorJS-SFU/data/emulator.hybrid.min.js RomM/frontend/public/assets/emulatorjs/",
        );
        console.error(
          "[Netplay]    cp EmulatorJS-SFU/data/emulator.min.css RomM/frontend/public/assets/emulatorjs/",
        );
        console.error("[Netplay] 3. Restart RomM");
        console.log(
          "[Netplay] Available globals:",
          Object.keys(typeof window !== "undefined" ? window : global),
        );
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
      if (socketBaseUrl.startsWith("http://")) {
        socketBaseUrl = socketBaseUrl.substring(7);
      } else if (socketBaseUrl.startsWith("https://")) {
        socketBaseUrl = socketBaseUrl.substring(8);
      }
      // Remove any path after the domain
      const pathIndex = socketBaseUrl.indexOf("/");
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
            setTimeout(
              () => this.netplayMenu.netplayJoinRoomViaSocket(roomName),
              100,
            );
          },
          onSocketError: (error) => {
            console.error("[Netplay] Socket error:", error);
          },
          onSocketDisconnect: (reason) => {
            console.log("[Netplay] Socket disconnected:", reason);
            if (this.netplayMenu?.cleanupRoomUI) {
              this.netplayMenu?.cleanupRoomUI();
            }
          },
          onPlayerSlotUpdated: (playerId, newSlot) => {
            if (this.netplayMenu?.netplayUpdatePlayerSlot) {
              this.netplayMenu.netplayUpdatePlayerSlot(playerId, newSlot);
            }
          },
          onUsersUpdated: (users) => {
            this.netplayMenu.netplayUpdatePlayerList({ players: users });
          },
          onRoomClosed: (data) => {
            console.log("[Netplay] Room closed:", data);
            if (this.netplayMenu?.cleanupRoomUi) {
              this.netplayMenu.cleanupRoomUI();
            }
          },
        },
      });

      // Initialize the engine (sets up all subsystems including InputSync and transport)
      console.log("[Netplay] Initializing NetplayEngine...");
      let engineInitialized = false;
      try {
        await engine.initialize();
        engineInitialized = true;
        console.log("[Netplay] NetplayEngine initialized successfully");
      } catch (error) {
        console.warn(
          "[Netplay] NetplayEngine initialization failed, using basic transport:",
          error,
        );

        // Fall back to basic transport without NetplayEngine
        this.emulator.netplay.transport = new SocketTransportClass({
          callbacks: {
            onConnect: (socketId) => {
              console.log("[Netplay] Basic socket connected:", socketId);

              // Set up event listeners for basic functionality
              this.emulator.netplay.transport.on("users-updated", (data) => {
                console.log("[Netplay] Users updated event received:", data);
                if (data.users) {
                  this.netplayMenu.netplayUpdatePlayerList({
                    players: data.users,
                  });
                }
              });

              // Join the room
              setTimeout(
                () => this.netplayMenu.netplayJoinRoomViaSocket(roomName),
                100,
              );
            },
            onConnectError: (error) => {
              console.error("[Netplay] Basic socket connection error:", error);
            },
            onDisconnect: (reason) => {
              console.log("[Netplay] Basic socket disconnected:", reason);
            },
          },
        });

        // Connect the basic transport
        await this.emulator.netplay.transport.connect(`wss://${socketBaseUrl}`);
      }

      // Store references - assign the main engine if initialized (overwrites room listing engine)
      if (engineInitialized) {
        this.emulator.netplay.engine = engine;
        this.emulator.netplay.transport = engine.socketTransport;
        this.emulator.netplay.adapter = adapter;
        console.log(
          `[Netplay] Assigned main NetplayEngine:${engine.id} (initialized: ${engineInitialized})`,
        );
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
    console.log("[Netplay] Leaving room and cleaning up completely...");

    // ========================================================================
    // PHASE 1: UI CLEANUP (do this BEFORE clearing engine so UI can access state)
    // ========================================================================
    if (this.netplayMenu) {
      console.log("[Netplay] Phase 1: Cleaning up UI state...");

      // Reset netplay menu state flag
      this.netplayMenu.isNetplay = false;

      // Reset currentRoomType to listings (critical for preventing stale UI)
      if (this.netplayMenu.currentRoomType !== undefined) {
        this.netplayMenu.currentRoomType = "listings";
      }

      // Clear player table content (but preserve DOM elements for reuse)
      if (this.emulator.netplay) {
        // Clear liveStreamPlayerTable content
        if (this.emulator.netplay.liveStreamPlayerTable) {
          this.emulator.netplay.liveStreamPlayerTable.innerHTML = "";
          // Hide the table container
          const liveTableContainer =
            this.emulator.netplay.liveStreamPlayerTable.parentElement;
          if (liveTableContainer) {
            liveTableContainer.style.display = "none";
          }
        }

        // Clear delaySyncPlayerTable content
        if (this.emulator.netplay.delaySyncPlayerTable) {
          this.emulator.netplay.delaySyncPlayerTable.innerHTML = "";
          // Hide the table container
          const delayTableContainer =
            this.emulator.netplay.delaySyncPlayerTable.parentElement;
          if (delayTableContainer) {
            delayTableContainer.style.display = "none";
          }
        }

        // Clear joined players array
        if (this.emulator.netplay.joinedPlayers) {
          this.emulator.netplay.joinedPlayers = [];
        }

        // Remove slot selector if it exists (to prevent duplication on next room creation)
        if (
          this.emulator.netplay.slotSelect &&
          this.emulator.netplay.slotSelect.parentElement
        ) {
          const slotSelectParent =
            this.emulator.netplay.slotSelect.parentElement;
          // Find and remove the label "Player Select:" that comes before the selector
          const slotLabel = Array.from(slotSelectParent.childNodes).find(
            (node) =>
              node.nodeType === Node.ELEMENT_NODE &&
              node.tagName === "STRONG" &&
              node.innerText &&
              (node.innerText.includes("Player Select") ||
                node.innerText.includes("Player Slot")),
          );
          if (slotLabel) {
            slotLabel.remove();
          }
          this.emulator.netplay.slotSelect.remove();
          this.emulator.netplay.slotSelect = null; // Clear the reference
          console.log("[Netplay] Removed slot selector during cleanup");
        }

        // Clear room name and password display
        if (this.emulator.netplay.roomNameElem) {
          this.emulator.netplay.roomNameElem.innerText = "";
          this.emulator.netplay.roomNameElem.style.display = "none";
        }
        if (this.emulator.netplay.passwordElem) {
          this.emulator.netplay.passwordElem.innerText = "";
          this.emulator.netplay.passwordElem.style.display = "none";
        }

        // Switch to listings tab (rooms tab)
        if (
          this.emulator.netplay.tabs &&
          this.emulator.netplay.tabs[0] &&
          this.emulator.netplay.tabs[1]
        ) {
          this.emulator.netplay.tabs[0].style.display = ""; // Show rooms tab
          this.emulator.netplay.tabs[1].style.display = "none"; // Hide joined tab
        }
      }

      // Reset title to listings
      if (this.netplayMenu.netplayMenu) {
        const titleElement = this.netplayMenu.netplayMenu.querySelector("h4");
        if (titleElement) {
          titleElement.innerText = "Netplay Listings";
        }
      }

      // Setup listings bottom bar (this will start room list fetching)
      if (this.netplayMenu.setupNetplayBottomBar) {
        this.netplayMenu.setupNetplayBottomBar("listings");
      }

      // Reset global EJS netplay state
      if (window.EJS) {
        window.EJS.isNetplay = false;
      }

      console.log("[Netplay] UI cleanup completed");
    }

    // ========================================================================
    // PHASE 2: NETWORK & TRANSPORT CLEANUP
    // ========================================================================
    console.log("[Netplay] Phase 2: Cleaning up network and transport...");

    // 1. Clean up intervals
    if (this._producerRetryInterval) {
      clearInterval(this._producerRetryInterval);
      this._producerRetryInterval = null;
    }
    if (this._audioRetryInterval) {
      clearInterval(this._audioRetryInterval);
      this._audioRetryInterval = null;
    }

    // 2. Leave room via RoomManager (this clears sessionState)
    if (this.emulator.netplay && this.emulator.netplay.engine) {
      try {
        await this.leaveRoom();
        console.log("[Netplay] Left room successfully");
      } catch (error) {
        console.error("[Netplay] Error leaving room:", error);
      }
    }

    // 3. Disconnect transport
    if (this.emulator.netplay && this.emulator.netplay.transport) {
      try {
        await this.emulator.netplay.transport.disconnect();
        console.log("[Netplay] Transport disconnected");
      } catch (error) {
        console.error("[Netplay] Error disconnecting transport:", error);
      }
    }

    // ========================================================================
    // PHASE 3: ENGINE & SESSION STATE CLEANUP
    // ========================================================================
    console.log("[Netplay] Phase 3: Cleaning up engine and session state...");

    if (this.emulator.netplay) {
      // Clean up SFU transport (producers, consumers, and streams) before clearing references
      if (this.sfuTransport) {
        try {
          await this.sfuTransport.cleanup();
          console.log("[Netplay] SFU transport cleaned up successfully");
        } catch (error) {
          console.error("[Netplay] Error cleaning up SFU transport:", error);
        }
      }

      // Clear engine, transport, and adapter references
      this.emulator.netplay.engine = null;
      this.emulator.netplay.transport = null;
      this.emulator.netplay.adapter = null;

      // Clear all room/session state
      this.sessionState.reset();
      this.emulator.netplay.currentRoom = null;
      this.emulator.netplay.currentRoomId = null;
      // Keep localSlot for potential reuse in future sessions
      // this.emulator.netplay.localSlot = null;

      // Note: Keep emulator.netplay.name as it's user preference, not session state
      // Note: Keep emulator.netplay.tabs, roomNameElem, passwordElem, etc. as they're UI structure
      // Note: Keep emulator.netplay.liveStreamPlayerTable and delaySyncPlayerTable DOM elements
      //   (they're cleared above, but DOM elements should persist for reuse)

      console.log("[Netplay] Cleared all engine, transport, and session state");
    }

    // ========================================================================
    // PHASE 4: GAME STATE CLEANUP
    // ========================================================================
    console.log("[Netplay] Phase 4: Cleaning up game state...");

    // Restore original simulateInput
    if (this.gameManager && this.gameManager.originalSimulateInput) {
      this.gameManager.simulateInput = this.gameManager.originalSimulateInput;
      delete this.gameManager.originalSimulateInput;
      console.log("[Netplay] Restored original simulateInput");
    }

    // Remove netplay simulateInput override to prevent stale input routing
    if (this.emulator.netplay && this.emulator.netplay.simulateInput) {
      delete this.emulator.netplay.simulateInput;
      console.log("[Netplay] Removed netplay simulateInput override");
    }

    // ========================================================================
    // PHASE 5: FINAL UI CLEANUP
    // ========================================================================
    console.log("[Netplay] Phase 5: Final UI cleanup...");

    // Restore emulator canvas visibility (was hidden for livestream clients)
    if (this.emulator && this.emulator.canvas) {
      this.emulator.canvas.style.display = "";
      console.log("[Netplay] Restored emulator canvas visibility");
    }

    // Resume emulator (was paused for livestream clients)
    if (this.emulator && this.emulator.resume) {
      this.emulator.resume();
      console.log("[Netplay] Resumed emulator playback");
    } else if (this.emulator && this.emulator.play) {
      // Fallback for video-like APIs
      this.emulator.play();
      console.log("[Netplay] Started emulator playback (fallback)");
    }

    // Remove video elements added for netplay streaming (they overlay the canvas)
    if (this.emulator && this.emulator.canvas && this.emulator.canvas.parentElement) {
      const videos = this.emulator.canvas.parentElement.querySelectorAll('video');
      videos.forEach(video => {
        if (video.srcObject) { // Only remove netplay videos (have MediaStream)
          video.remove();
          console.log("[Netplay] Removed netplay video overlay");
        }
      });
    }

    // Clear media elements references to prevent stale objects on rejoin
    if (this.netplayMenu && this.netplayMenu.netplay && this.netplayMenu.netplay.mediaElements) {
      this.netplayMenu.netplay.mediaElements = {};
      console.log("[Netplay] Cleared media elements references");
    }

    // Ensure canvas is visible and layered above other elements
    if (this.emulator && this.emulator.canvas) {
      this.emulator.canvas.style.zIndex = "100"; // Above typical UI elements
      console.log("[Netplay] Set canvas z-index for visibility");
    }

    // Hide chat component
    if (this.chatComponent) {
      this.chatComponent.hide();
    }

    // Hide menu (user can reopen it to see listings)
    if (this.netplayMenu && this.netplayMenu.hide) {
      this.netplayMenu.hide();
    }

    console.log(
      "[Netplay] Room leave and cleanup completed - ready for new session",
    );
  }

  async netplaySetupProducers() {
    console.log("[Netplay] netplaySetupProducers called", {
      hasEngine: !!this.emulator.netplay.engine,
      isHost: this.sessionState?.isHostRole(),
      netplayMode: this.emulator.netplay?.currentRoom?.netplay_mode,
    });

    if (!this.emulator.netplay.engine || !this.sessionState?.isHostRole()) {
      console.log(
        "[Netplay] Not host or engine not available, skipping producer setup",
      );
      return;
    }

    try {
      console.log("[Netplay] Setting up video/audio producers...");

      // Initialize SFU transports for host
      console.log("[Netplay] Initializing host transports...");
      try {
        await this.initializeHostTransports();
        console.log("[Netplay] ✅ Host transports initialized");
        console.log("[Netplay] SFU transport status:", {
          hasSFUTransport: !!this.sfuTransport,
          isConnected: this.sfuTransport?.isConnected?.(),
          useSFU: this.sfuTransport?.useSFU,
        });
      } catch (error) {
        console.error(
          "[Netplay] ❌ Failed to initialize host transports:",
          error,
        );
        throw error;
      }

      // Capture canvas video
      try {
        const videoTrack = await this.netplayCaptureCanvasVideo();
        if (videoTrack) {
          await this.sfuTransport.createVideoProducer(videoTrack);
          console.log("[Netplay] ✅ Video producer created");
        } else {
          console.warn(
            "[Netplay] ⚠️ No video track captured - canvas may not be ready yet",
          );
          // For hosts, if video capture fails, we'll retry when game starts
          if (
            this.sessionState?.isHostRole() &&
            this.emulator.netplay?.currentRoom?.netplay_mode === 0
          ) {
            console.log("[Netplay] Will retry video capture when game starts");
          }
        }
      } catch (error) {
        console.error("[Netplay] ❌ Failed to create video producer:", error);
        // For hosts, if video capture fails, we'll retry when game starts
        if (
          this.sessionState?.isHostRole() &&
          this.emulator.netplay?.currentRoom?.netplay_mode === 0
        ) {
          console.log(
            "[Netplay] Will retry video capture when game starts due to error:",
            error.message,
          );
        }
      }

      // Capture game audio (emulator audio) with retry logic
      try {
        console.log("[Netplay] 🔊 Setting up game audio producer...");
        let gameAudioTrack = await this.netplayCaptureAudio();
        let retryCount = 0;
        const maxRetries = 15;

        // Retry game audio capture more aggressively in case emulator audio isn't ready yet
        while (!gameAudioTrack && retryCount < maxRetries) {
          const delay = retryCount < 5 ? 2000 : 5000; // 2s for first 5, then 5s
          console.log(
            `[Netplay] Game audio capture attempt ${retryCount + 1}/${maxRetries} failed, retrying in ${delay / 1000}s...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          gameAudioTrack = await this.netplayCaptureAudio();
          retryCount++;
        }

        if (gameAudioTrack) {
          await this.sfuTransport.createAudioProducer(gameAudioTrack);
          console.log("[Netplay] ✅ Game audio producer created");
        } else {
          console.warn(
            "[Netplay] ⚠️ No game audio track captured after all retries",
          );

          // Set up continuous game audio capture retry for hosts
          if (
            this.sessionState?.isHostRole() &&
            this.emulator.netplay?.currentRoom?.netplay_mode === 0
          ) {
            console.log(
              "[Netplay] Setting up continuous game audio capture retry for host",
            );
            this._audioRetryInterval = setInterval(async () => {
              if (!this.sfuTransport?.audioProducer) {
                console.log("[Netplay] Host retrying game audio capture...");
                try {
                  const gameAudioTrack = await this.netplayCaptureAudio();
                  if (gameAudioTrack) {
                    await this.sfuTransport.createAudioProducer(gameAudioTrack);
                    console.log(
                      "[Netplay] ✅ Game audio producer created on continuous retry",
                    );
                    clearInterval(this._audioRetryInterval);
                    this._audioRetryInterval = null;
                  }
                } catch (retryError) {
                  console.debug(
                    "[Netplay] Game audio retry failed:",
                    retryError.message,
                  );
                }
              } else {
                console.log(
                  "[Netplay] Host already has game audio producer, stopping continuous retry",
                );
                clearInterval(this._audioRetryInterval);
                this._audioRetryInterval = null;
              }
            }, 10000); // Retry every 10 seconds

            // Stop after 5 minutes
            setTimeout(() => {
              if (this._audioRetryInterval) {
                console.log(
                  "[Netplay] Stopping continuous game audio retry after timeout",
                );
                clearInterval(this._audioRetryInterval);
                this._audioRetryInterval = null;
              }
            }, 300000);
          }
        }
      } catch (error) {
        console.error(
          "[Netplay] ❌ Failed to create game audio producer:",
          error,
        );
        // Game audio is optional, don't throw here
      }

      // Capture mic audio for voice chat (DISABLED - microphone inputs from players are not captured)
      const isSpectator = this.sessionState?.isSpectatorRole() || false;
      if (!isSpectator) {
        console.log("[Netplay] ℹ️ Microphone audio capture is disabled");
        // Microphone capture code removed
      } else {
        console.log(
          "[Netplay] 👁️ Spectator mode - skipping mic audio producer",
        );
      }

      // Create data producer for input relay
      console.log(
        "[Netplay] Attempting to create data producer for input relay",
      );
      try {
        const dataProducer = await this.sfuTransport.createDataProducer();
        if (dataProducer) {
          console.log("[Netplay] ✅ Data producer created successfully:", {
            id: dataProducer.id,
            hasDataChannelManager: !!this.dataChannelManager,
          });
        } else {
          console.log(
            "[Netplay] Data producer creation returned null (transport may not support data channels)",
          );
        }
      } catch (error) {
        console.warn("[Netplay] Data producer creation failed:", error.message);
        console.warn("[Netplay] Input relay will use Socket.IO fallback");
        // Continue - data producers are optional for livestream rooms
      }

      // Set up data consumers to receive inputs from clients via SFU data channels
      console.log(
        "[Netplay] Setting up data consumers to receive inputs from clients...",
      );
      try {
        await this.netplaySetupDataConsumers();
        console.log("[Netplay] ✅ Data consumers setup complete");
      } catch (error) {
        console.error("[Netplay] ❌ Failed to setup data consumers:", error);
        // Continue - input might still work via other methods
      }
      // Set up data consumers to receive inputs from clients via SFU data channels
      console.log(
        "[Netplay] Setting up data consumers to receive inputs from clients...",
      );
      await this.netplaySetupDataConsumers();

      // Set up P2P channels for host (always listen for client offers)
      if (this.sessionState?.isHostRole()) {
        console.log(
          `[Netplay] Host detected, setting up P2P data channels for client offers...`,
        );
        await this.netplaySetupP2PChannels();
        console.log(
          `[Netplay] Host P2P setup complete, checking channels:`,
          this.dataChannelManager?.p2pChannels?.size || 0,
        );
      }

      // Check input mode and set up P2P channels if needed for unorderedP2P
      const inputMode =
        this.dataChannelManager?.mode ||
        this.configManager?.getSetting("inputMode") ||
        this.config.inputMode ||
        "unorderedRelay";

      if (inputMode === "unorderedP2P" || inputMode === "orderedP2P") {
        console.log(
          `[Netplay] Input mode is ${inputMode}, setting up P2P data channels...`,
        );
        // Already called above for host, but for client it's different
        if (!this.sessionState?.isHostRole()) {
          // Client P2P setup if needed
        }
        console.log(
          `[Netplay] P2P setup complete, checking channels:`,
          this.dataChannelManager?.p2pChannels?.size || 0,
        );
      }
    } catch (error) {
      console.error("[Netplay] Failed to setup producers:", error);
    }
  }

  // Setup data producers for input synchronization (both host and clients)
  async netplaySetupDataProducers() {
    if (!this.emulator.netplay.engine) {
      console.log(
        "[Netplay] Engine not available, skipping data producer setup",
      );
      return;
    }

    // Spectators don't need to create input data producers
    const isSpectator = this.sessionState?.isSpectatorRole() || false;
    if (isSpectator) {
      console.log(
        "[Netplay] 👁️ Spectator mode - skipping input data producer setup",
      );
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
        console.log(
          "[Netplay] Creating send transport for client data producers",
        );
        await this.sfuTransport.createSendTransport("data");
      }

      // Create data producer for input synchronization
      const dataProducer = await this.sfuTransport.createDataProducer();
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

  // Setup data consumers for hosts to receive inputs from clients via SFU
  async netplaySetupDataConsumers() {
    if (!this.emulator.netplay.engine || !this.sessionState?.isHostRole()) {
      console.log(
        "[Netplay] Not host or engine not available, skipping data consumer setup",
      );
      return;
    }

    try {
      console.log(
        "[Netplay] Setting up data consumers to receive inputs from clients...",
      );

      // Ensure receive transport exists (should already exist from initializeHostTransports)
      if (!this.sfuTransport?.recvTransport) {
        console.warn(
          "[Netplay] Receive transport not available, cannot set up data consumers",
        );
        return;
      }

      // Get existing data producers from clients
      if (this.socketTransport) {
        try {
          const existingDataProducers = await new Promise((resolve, reject) => {
            this.socketTransport.emit(
              "sfu-get-data-producers",
              {},
              (error, producers) => {
                if (error) {
                  console.warn(
                    "[Netplay] Failed to get existing data producers:",
                    error,
                  );
                  resolve([]);
                  return;
                }
                console.log(
                  "[Netplay] Received existing data producers:",
                  producers,
                );
                resolve(producers || []);
              },
            );
          });

          // Create data consumers for existing data producers
          // Message handling is automatically set up by SFUTransport.createConsumer()
          for (const producer of existingDataProducers) {
            try {
              console.log(
                `[Netplay] Creating data consumer for producer ${producer.id}`,
              );
              const consumer = await this.sfuTransport.createConsumer(
                producer.id,
                "data",
              );
              console.log(`[Netplay] ✅ Created data consumer:`, consumer.id);
            } catch (error) {
              console.warn(
                `[Netplay] Failed to create data consumer for producer ${producer.id}:`,
                error.message,
              );
            }
          }
        } catch (error) {
          console.warn(
            "[Netplay] Failed to get existing data producers:",
            error,
          );
        }

        this.socketTransport.on("new-data-producer", async (data) => {
          console.log("[Netplay] 📡 RECEIVED new-data-producer event:", data);
          try {
            const producerId = data.id;

            // Check if we already have a consumer for this producer
            if (
              this.sfuTransport &&
              this.sfuTransport.consumers &&
              this.sfuTransport.consumers.has(producerId)
            ) {
              console.log(
                `[Netplay] Already have consumer for producer ${producerId}, skipping`,
              );
              return;
            }

            console.log(
              `[Netplay] Creating data consumer for new producer ${producerId}`,
            );
            const consumer = await this.sfuTransport.createConsumer(
              producerId,
              "data",
            );
            console.log(`[Netplay] ✅ Created data consumer:`, consumer.id);
            console.log(
              `[Netplay] 🎮 Data consumer ready for input synchronization`,
            );
          } catch (error) {
            // Producer may have been closed/removed - this is not fatal
            if (error.message && error.message.includes("not found")) {
              console.warn(
                `[Netplay] ⚠️ Data producer ${data.id} no longer available (may have been closed) - this is normal if the producer left quickly`,
              );
            } else {
              console.error(
                "[Netplay] ❌ Failed to handle new-data-producer event:",
                error,
              );
            }
          }
        });
      }

      console.log(
        "[Netplay] Data consumer setup complete - ready to receive inputs from clients",
      );
    } catch (error) {
      console.error("[Netplay] Failed to setup data consumers:", error);
    }
  }

  // Client-side P2P connection initiation for unorderedP2P/orderedP2P modes
  async netplayInitiateP2PConnection() {
    console.log("[Netplay] 🔗 netplayInitiateP2PConnection called");

    // Prevent duplicate P2P initiations
    if (this._p2pInitiating) {
      console.log("[Netplay] P2P initiation already in progress, skipping");
      return;
    }
    this._p2pInitiating = true;

    if (!this.socketTransport || this.sessionState?.isHostRole()) {
      console.log(
        "[Netplay] Not a client or no socket transport, skipping P2P initiation",
      );
      this._p2pInitiating = false;
      return;
    }

    console.log("[Netplay] ✅ Client starting P2P connection initiation");

    // Find the host's player ID (first player in the room, usually the one with the earliest join time)
    let hostPlayerId = null;

    // Try multiple sources for player data
    let players = null;

    // Source 1: currentRoom.players
    if (this.emulator?.netplay?.currentRoom?.players) {
      players = this.emulator.netplay.currentRoom.players;
      console.log(
        "[Netplay] Using players from currentRoom:",
        Object.keys(players),
      );
    }
    // Source 2: NetplayMenu.joinedPlayers
    else if (this.emulator?.netplayMenu?.netplay?.joinedPlayers) {
      // Convert joinedPlayers array back to object format
      players = {};
      this.emulator.netplayMenu.netplay.joinedPlayers.forEach((player) => {
        players[player.id] = player;
      });
      console.log(
        "[Netplay] Using players from NetplayMenu joinedPlayers:",
        Object.keys(players),
      );
    }

    if (players) {
      console.log(
        "[Netplay] Looking for host among players:",
        Object.keys(players),
      );

      const playerEntries = Object.entries(players);

      // First priority: Look for explicit host flags
      for (const [playerId, playerData] of playerEntries) {
        console.log(`[Netplay] Checking player ${playerId}:`, {
          slot: playerData.slot || playerData.player_slot,
          isHost: playerData.isHost || playerData.host,
          ready: playerData.ready,
        });
        if (playerData.isHost || playerData.host) {
          hostPlayerId = playerId;
          console.log("[Netplay] Found explicit host flag:", hostPlayerId);
          break;
        }
      }

      // Second priority: Look for player in slot 0 (conventional host slot)
      if (!hostPlayerId) {
        for (const [playerId, playerData] of playerEntries) {
          if ((playerData.slot || playerData.player_slot) === 0) {
            hostPlayerId = playerId;
            console.log("[Netplay] Found player in slot 0 (host):", hostPlayerId);
            break;
          }
        }
      }

      // Fallback: First player in the list (maintains existing behavior but with better logging)
      if (!hostPlayerId && playerEntries.length > 0) {
        [hostPlayerId] = playerEntries[0];
        console.log("[Netplay] Using first player as fallback host:", hostPlayerId);
        console.log(
          "[Netplay] All available players:",
          playerEntries.map(([id]) => id),
        );
      }
    } else {
      console.log("[Netplay] No player data available from any source");
    }

    if (!hostPlayerId) {
      console.error(
        "[Netplay] Could not determine host player ID for P2P connection - will retry in 2 seconds",
      );

      // Retry after a short delay in case data becomes available
      setTimeout(() => {
        console.log("[Netplay] Retrying P2P connection initiation...");
        this.netplayInitiateP2PConnection().catch((err) => {
          console.error("[Netplay] P2P connection retry failed:", err);
        });
      }, 2000);
      return;
    }

    // Send to "host" - server will resolve to room owner
    const target = "host";
    console.log(
      "[Netplay] Will send P2P offer to target:",
      target,
      "(resolved by server to room owner)",
    );

    try {
      console.log("[Netplay] Initiating P2P connection to host...");

      // Get ICE servers - prioritize SFU-provided servers, then fall back to RomM config
      let iceServers = [];

      // First, try to get ICE servers from the SFU
      console.log("[Netplay] Checking SFU transport availability:", {
        hasSfuTransport: !!this.sfuTransport,
        sfuTransportType: typeof this.sfuTransport,
        sfuTransportInitialized: this.sfuTransport?.useSFU,
      });

      if (this.sfuTransport) {
        console.log("[Netplay] Attempting to fetch ICE servers from SFU...");
        try {
          const sfuIceServers = await this.sfuTransport.getIceServers();
          console.log("[Netplay] SFU getIceServers() returned:", {
            servers: sfuIceServers,
            count: sfuIceServers?.length || 0,
            isArray: Array.isArray(sfuIceServers),
          });

          if (sfuIceServers && sfuIceServers.length > 0) {
            iceServers = [...sfuIceServers];
            console.log(
              `[Netplay] ✅ Using ${iceServers.length} ICE servers from SFU:`,
              iceServers,
            );
          } else {
            console.log(
              "[Netplay] SFU returned no ICE servers, falling back to config",
            );
          }
        } catch (error) {
          console.warn(
            "[Netplay] Failed to fetch ICE servers from SFU:",
            error,
          );
          console.warn("[Netplay] Error details:", {
            message: error.message,
            stack: error.stack,
            name: error.name,
          });
        }
      } else {
        console.log(
          "[Netplay] No SFU transport available, skipping SFU ICE server fetch",
        );
      }

      // If no SFU servers or SFU fetch failed, fall back to RomM config
      if (iceServers.length === 0) {
        const rommIceServers =
          this.configManager?.getSetting("netplayIceServers") ||
          this.configManager?.getSetting("netplayICEServers") ||
          this.config?.netplayICEServers ||
          window.EJS_netplayICEServers;

        if (
          rommIceServers &&
          Array.isArray(rommIceServers) &&
          rommIceServers.length > 0
        ) {
          iceServers = [...rommIceServers];
          console.log(
            `[Netplay] ✅ Using ${iceServers.length} ICE servers from RomM config`,
          );
        } else {
          console.log(
            "[Netplay] No RomM ICE servers configured, falling back to public servers",
          );
        }
      }

      // Final fallback to public STUN/TURN servers if nothing else is available
      if (iceServers.length === 0) {
        iceServers = [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" },
          // Public TURN servers (may have rate limits) - using UDP for better compatibility
          {
            urls: "turn:webrtc:webrtc@turn.anyfirewall.com:443",
          },
        ];
        console.log(
          "[Netplay] ⚠️ Using public STUN/TURN servers as final fallback",
        );
      }

      // Log ICE server configuration for debugging
      console.log(
        "[Netplay] 🎯 Using ICE servers for P2P:",
        JSON.stringify(iceServers, null, 2),
      );
      const stunCount = iceServers.filter(
        (s) =>
          s.urls &&
          (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) =>
            u.startsWith("stun:"),
          ),
      ).length;
      const turnCount = iceServers.filter(
        (s) =>
          s.urls &&
          (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) =>
            u.startsWith("turn:"),
          ),
      ).length;
      console.log(
        `[Netplay] 📊 ICE server summary: ${stunCount} STUN, ${turnCount} TURN servers configured`,
      );

      // Get unordered retries setting
      const unorderedRetries =
        this.configManager?.getSetting("netplayUnorderedRetries") || 0;

      // Create RTCPeerConnection for P2P data channels
      const pc = new RTCPeerConnection({
        iceServers: iceServers,
        iceTransportPolicy: "all", // Try all candidates
        bundlePolicy: "balanced",
        rtcpMuxPolicy: "require",
      });

      // Add comprehensive WebRTC monitoring
      let connectionTimeout = null;
      let iceGatheringTimeout = null;

      pc.oniceconnectionstatechange = () => {
        console.log(
          `[Netplay] P2P ICE connection state (${target}): ${pc.iceConnectionState}`,
        );
        if (
          pc.iceConnectionState === "connected" ||
          pc.iceConnectionState === "completed"
        ) {
          console.log(
            `[Netplay] ✅ P2P connection established with ${target}!`,
          );
          clearTimeout(connectionTimeout);
          clearTimeout(iceGatheringTimeout);
        } else if (
          pc.iceConnectionState === "failed" ||
          pc.iceConnectionState === "disconnected" ||
          pc.iceConnectionState === "closed"
        ) {
          console.warn(
            `[Netplay] ❌ P2P connection failed with ${target}: ${pc.iceConnectionState}`,
          );
          // Trigger cleanup on failure
          setTimeout(cleanup, 100);
        }
      };

      pc.onicegatheringstatechange = () => {
        console.log(
          `[Netplay] P2P ICE gathering state (${target}): ${pc.iceGatheringState}`,
        );
        if (pc.iceGatheringState === "complete") {
          clearTimeout(iceGatheringTimeout);
        }
      };

      // Track candidate types for diagnostics
      let candidateTypes = { host: 0, srflx: 0, relay: 0, prflx: 0 };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const candidate = event.candidate;
          candidateTypes[candidate.type] =
            (candidateTypes[candidate.type] || 0) + 1;
          console.log(
            `[Netplay] P2P ICE candidate (${target}): ${candidate.type} ${candidate.protocol}:${candidate.port} priority:${candidate.priority}`,
          );

          // Log relay candidate detection (TURN working)
          if (candidate.type === "relay") {
            console.log(
              `[Netplay] ✅ TURN server provided relay candidate for ${target} - P2P should work!`,
            );
          }

          // Send ICE candidate to host via signaling
          const clientId = this.socketTransport?.socket?.id || "client";
          this.socketTransport.emit("webrtc-signal", {
            target: target,
            sender: clientId,
            candidate: event.candidate,
            roomName: this.emulator.netplay.currentRoomId,
          });
        } else {
          const totalCandidates = Object.values(candidateTypes).reduce(
            (a, b) => a + b,
            0,
          );
          console.log(
            `[Netplay] P2P ICE candidate gathering complete (${target}) - gathered ${totalCandidates} candidates:`,
            candidateTypes,
          );

          // Warn if no relay candidates (TURN servers not working)
          if (candidateTypes.relay === 0) {
            console.warn(
              `[Netplay] ⚠️ No relay candidates detected for ${target} - TURN servers may not be working properly`,
            );
          }
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(
          `[Netplay] P2P connection state (${target}): ${pc.connectionState}`,
        );
        if (
          pc.connectionState === "connected" ||
          pc.connectionState === "completed"
        ) {
          console.log(`[Netplay] ✅ P2P connection established with ${target}`);
        } else if (
          pc.connectionState === "failed" ||
          pc.connectionState === "disconnected"
        ) {
          console.warn(
            `[Netplay] ⚠️ P2P connection ${pc.connectionState} with ${target}`,
          );
        }
      };

      // Set timeout for connection establishment (longer for local networks)
      connectionTimeout = setTimeout(() => {
        if (
          pc.connectionState !== "connected" &&
          pc.connectionState !== "completed"
        ) {
          console.error(
            `[Netplay] ❌ P2P connection timeout with ${target} - falling back to relay mode`,
          );
          cleanup();
          this.handleP2PFallback(target);
        }
      }, 30000); // 30 second timeout for local networks

      // Set timeout for ICE gathering (increased for coturn servers)
      iceGatheringTimeout = setTimeout(() => {
        if (pc.iceGatheringState !== "complete") {
          const candidateCount =
            pc.localDescription?.sdp
              ?.split("\n")
              .filter((line) => line.startsWith("a=candidate")).length || 0;
          console.warn(
            `[Netplay] ⚠️ P2P ICE gathering timeout with ${target} - gathered ${candidateCount} candidates`,
          );

          // Check if we have relay candidates (TURN servers working)
          const hasRelayCandidates =
            pc.localDescription?.sdp?.includes("typ relay") || false;

          if (!hasRelayCandidates && candidateCount < 10) {
            console.warn(
              `[Netplay] 🚨 No relay candidates detected - TURN servers may be failing. Triggering early fallback to relay mode.`,
            );
            // Clear connection timeout since we're handling fallback now
            cleanup();
            this.handleP2PFallback(target);
            return;
          }

          // Continue with connection attempt even if gathering didn't complete
          // The connection timeout will handle fallback if needed
        }
      }, 10000); // 10 second timeout for ICE gathering

      // Create data channels as offerer (client creates channels, host receives them)
      console.log(`[Netplay] Creating data channels for P2P connection`);
      const unorderedChannel = pc.createDataChannel("input-unordered", {
        ordered: false,
        maxRetransmits: unorderedRetries > 0 ? unorderedRetries : undefined,
        maxPacketLifeTime: unorderedRetries === 0 ? 3000 : undefined,
      });

      // Add channels to DataChannelManager immediately
      if (this.dataChannelManager) {
        console.log(
          `[Netplay] Adding P2P channels for host to DataChannelManager`,
        );
        this.dataChannelManager.addP2PChannel("host", {
          unordered: unorderedChannel,
        });
        console.log(
          `[Netplay] Client DataChannelManager now has ${this.dataChannelManager.p2pChannels.size} P2P connections`,
        );
      }

      // Set up channel event handlers
      unorderedChannel.onopen = () => {
        console.log(
          `[Netplay] Client unordered P2P channel opened with host - READY FOR INPUTS!`,
        );
        console.log(`[Netplay] Unordered channel state:`, {
          label: unorderedChannel.label,
          id: unorderedChannel.id,
          readyState: unorderedChannel.readyState,
          bufferedAmount: unorderedChannel.bufferedAmount,
        });
      };

      unorderedChannel.onmessage = (event) => {
        console.log(
          `[Netplay] Client received P2P message on unordered channel:`,
          event.data,
        );
      };

      unorderedChannel.onclose = () => {
        console.log(`[Netplay] Client unordered P2P channel closed with host`);
      };

      unorderedChannel.onerror = (error) => {
        console.error(`[Netplay] Client unordered P2P channel error:`, error);
      };


      // Create offer and send to host
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Send offer to host via signaling
      const clientId = this.socketTransport?.socket?.id || "client";
      console.log(
        "[Netplay] Sending WebRTC offer to host:",
        target,
        "from client:",
        clientId,
      );
      this.socketTransport.emit("webrtc-signal", {
        target: target,
        sender: clientId,
        offer: offer,
        roomName: this.emulator.netplay.currentRoomId,
      });

      // Listen for host's answer and remote ICE candidates
      const handleWebRTCSignal = async (data) => {
        try {
          console.log("[Netplay] Client received WebRTC signal:", data);
          const { answer, candidate, target, sender } = data;

          // Only process signals targeted at this client
          const clientId = this.socketTransport?.socket?.id || "client";
          if (target && target !== clientId) {
            console.log(
              `[Netplay] Ignoring WebRTC signal targeted at ${target}, we are ${clientId}`,
            );
            return;
          }

          // Note: We trust the server to only relay legitimate signals from the host
          console.log(
            `[Netplay] Processing WebRTC signal from sender: ${sender}`,
          );

          if (answer) {
            console.log(
              `[Netplay] Received answer from host, current signaling state: ${pc.signalingState}`,
            );
            console.log(
              `[Netplay] Answer SDP type: ${answer.type}, contains 'm=application': ${answer.sdp?.includes("m=application")}`,
            );
            if (pc.signalingState === "have-local-offer") {
              console.log(
                "[Netplay] Setting remote description with answer...",
              );
              await pc.setRemoteDescription(new RTCSessionDescription(answer));
              console.log(
                "[Netplay] Remote description set successfully, new signaling state:",
                pc.signalingState,
              );
            } else if (pc.signalingState === "stable") {
              console.log(
                "[Netplay] Connection already stable, ignoring duplicate answer",
              );
            } else {
              console.warn(
                `[Netplay] Cannot set remote description: wrong signaling state: ${pc.signalingState}`,
              );
            }
          }

          if (candidate) {
            console.log(
              "[Netplay] Received ICE candidate from host, adding to PC...",
            );
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          }
        } catch (error) {
          console.error("[Netplay] Error handling WebRTC signal:", error);
        }
      };

      this.socketTransport.on("webrtc-signal", handleWebRTCSignal);

      // Cleanup function for when connection succeeds or fails
      const cleanup = () => {
        console.log("[Netplay] Cleaning up P2P connection resources");
        clearTimeout(connectionTimeout);
        clearTimeout(iceGatheringTimeout);
        if (this.socketTransport && handleWebRTCSignal) {
          this.socketTransport.off("webrtc-signal", handleWebRTCSignal);
        }
        // Close peer connection if not already closed
        try {
          if (pc && pc.connectionState !== "closed") {
            pc.close();
          }
        } catch (e) {
          // Ignore cleanup errors
        }
        // Reset initiation flag
        this._p2pInitiating = false;
      };

      // Set up connection success/failure handlers to trigger cleanup
      const originalOnConnectionStateChange = pc.onconnectionstatechange;
      pc.onconnectionstatechange = () => {
        // Call original handler
        if (originalOnConnectionStateChange) {
          originalOnConnectionStateChange();
        }

        // Trigger cleanup on final states
        if (
          pc.connectionState === "connected" ||
          pc.connectionState === "completed" ||
          pc.connectionState === "failed" ||
          pc.connectionState === "disconnected" ||
          pc.connectionState === "closed"
        ) {
          // Use setTimeout to avoid calling cleanup during event handler
          setTimeout(cleanup, 100);
        }
      };

      console.log("[Netplay] P2P connection offer sent to host");
    } catch (error) {
      console.error("[Netplay] Failed to initiate P2P connection:", error);
    } finally {
      this._p2pInitiating = false;
    }
  }

  /**
   * Handle P2P connection failure by falling back to relay mode
   * @param {string} targetId - The peer ID that failed P2P connection
   */
  handleP2PFallback(targetId) {
    console.log(`[Netplay] 🔄 Handling P2P fallback for ${targetId}`);

    if (!this.dataChannelManager) {
      console.warn("[Netplay] No DataChannelManager available for fallback");
      return;
    }

    const currentMode = this.dataChannelManager.mode;
    if (currentMode === "unorderedP2P") {
      console.log(
        `[Netplay] Falling back from unorderedP2P to unorderedRelay for ${targetId}`,
      );
      this.dataChannelManager.mode = "unorderedRelay";
      // Remove failed P2P channel
      this.dataChannelManager.removeP2PChannel(targetId);
      // TODO: Notify UI of mode change when method is implemented
    } 

    // Send notification to user
    console.warn(
      `[Netplay] ⚠️ P2P connection failed with ${targetId}, switched to relay mode. Check network/firewall settings for better P2P performance.`,
    );
    console.warn(`[Netplay] 💡 P2P troubleshooting tips:`);
    console.warn(
      `[Netplay]   - Ensure both devices are on different networks or same network with proper routing`,
    );
    console.warn(
      `[Netplay]   - Check firewall settings allow UDP connections on ports 3478-65535`,
    );
    console.warn(`[Netplay]   - Try disabling VPN if active`);
    console.warn(
      `[Netplay]   - Public TURN servers have rate limits - consider private TURN server for production`,
    );
  }

  /**
   * Test P2P connectivity and log comprehensive diagnostics
   */
  async testP2PConnectivity() {
    console.log(
      "[Netplay] 🔍 Testing P2P connectivity and ICE server configuration...",
    );

    try {
      // Test all possible ICE server sources
      const iceSources = {
        configManager_netplayIceServers:
          this.configManager?.getSetting("netplayIceServers"),
        configManager_netplayICEServers:
          this.configManager?.getSetting("netplayICEServers"),
        config_netplayICEServers: this.config?.netplayICEServers,
        window_EJS_netplayICEServers: window.EJS_netplayICEServers,
      };

      console.log("[Netplay] 🔧 ICE server configuration sources:", iceSources);

      // Also test SFU ICE servers if available
      let sfuIceServers = [];
      if (this.sfuTransport) {
        console.log("[Netplay] Testing SFU ICE server availability...");
        try {
          sfuIceServers = await this.sfuTransport.getIceServers();
          console.log(
            `[Netplay] SFU provided ${sfuIceServers.length} ICE servers:`,
            sfuIceServers,
          );
        } catch (sfuError) {
          console.warn(
            "[Netplay] Failed to fetch ICE servers from SFU:",
            sfuError,
          );
        }
      } else {
        console.log(
          "[Netplay] No SFU transport available for ICE server testing",
        );
      }

      // Determine which source is being used (same logic as in P2P initiation)
      let iceServers = [];

      // First, use SFU servers if available
      if (sfuIceServers && sfuIceServers.length > 0) {
        iceServers = [...sfuIceServers];
        console.log(
          `[Netplay] Test will use ${iceServers.length} ICE servers from SFU`,
        );
      } else {
        // Fall back to RomM config
        const rommIceServers =
          iceSources.configManager_netplayIceServers ||
          iceSources.configManager_netplayICEServers ||
          iceSources.config_netplayICEServers ||
          iceSources.window_EJS_netplayICEServers;

        if (
          rommIceServers &&
          Array.isArray(rommIceServers) &&
          rommIceServers.length > 0
        ) {
          iceServers = [...rommIceServers];
          console.log(
            `[Netplay] Test will use ${iceServers.length} ICE servers from RomM config`,
          );
        } else {
          iceServers = [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
            { urls: "stun:stun2.l.google.com:19302" },
          ];
          console.log(
            "[Netplay] Test will use public STUN servers as final fallback",
          );
        }
      }

      console.log(
        `[Netplay] 🎯 Using ICE servers:`,
        JSON.stringify(iceServers, null, 2),
      );

      // Analyze ICE server configuration
      const stunServers = [];
      const turnServers = [];
      iceServers.forEach((server) => {
        if (server.urls) {
          const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
          urls.forEach((url) => {
            if (url.startsWith("stun:")) {
              stunServers.push(url);
            } else if (url.startsWith("turn:")) {
              turnServers.push({
                url,
                username: server.username,
                credential: server.credential,
              });
            }
          });
        }
      });

      console.log(
        `[Netplay] 📡 STUN servers found: ${stunServers.length}`,
        stunServers,
      );
      console.log(
        `[Netplay] 🔄 TURN servers found: ${turnServers.length}`,
        turnServers.map((t) => `${t.url} (${t.username ? "auth" : "no-auth"})`),
      );

      if (turnServers.length === 0) {
        console.warn(
          "[Netplay] ⚠️ No TURN servers configured - P2P may fail for clients behind NAT/firewalls",
        );
      }

      // Create test RTCPeerConnection
      const testPC = new RTCPeerConnection({
        iceServers,
        iceTransportPolicy: "all",
        bundlePolicy: "balanced",
        rtcpMuxPolicy: "require",
      });

      let candidateCount = 0;
      let stunCandidates = 0;
      let turnCandidates = 0;
      let hostCandidates = 0;

      testPC.onicecandidate = (event) => {
        if (event.candidate) {
          candidateCount++;
          const type = event.candidate.type;
          if (type === "srflx") stunCandidates++;
          else if (type === "relay") turnCandidates++;
          else if (type === "host") hostCandidates++;

          console.log(
            `[Netplay] 🎯 ICE candidate ${candidateCount}: ${type} ${event.candidate.protocol}:${event.candidate.port} (${event.candidate.address})`,
          );
        } else {
          console.log(
            `[Netplay] ✅ ICE gathering complete - Total candidates: ${candidateCount} (Host: ${hostCandidates}, STUN: ${stunCandidates}, TURN: ${turnCandidates})`,
          );
        }
      };

      testPC.onicegatheringstatechange = () => {
        console.log(
          `[Netplay] 🔄 ICE gathering state: ${testPC.iceGatheringState}`,
        );
        if (testPC.iceGatheringState === "complete") {
          console.log(
            `[Netplay] 📊 Final candidate summary: ${candidateCount} total (${hostCandidates} host, ${stunCandidates} STUN, ${turnCandidates} TURN)`,
          );
        }
      };

      testPC.oniceconnectionstatechange = () => {
        console.log(
          `[Netplay] 🔗 ICE connection state: ${testPC.iceConnectionState}`,
        );
      };

      // Create data channel to trigger ICE
      const testChannel = testPC.createDataChannel("test-connectivity");
      console.log(
        `[Netplay] 📺 Created test data channel: ${testChannel.readyState}`,
      );

      // Create offer to start ICE process
      console.log("[Netplay] 📤 Creating offer to trigger ICE gathering...");
      const offer = await testPC.createOffer();
      await testPC.setLocalDescription(offer);

      console.log(
        "[Netplay] ✅ P2P connectivity test initiated - monitoring ICE for 15 seconds",
      );

      // Clean up after 15 seconds
      setTimeout(() => {
        const finalState = {
          gatheringState: testPC.iceGatheringState,
          connectionState: testPC.iceConnectionState,
          candidatesFound: candidateCount,
          hostCandidates,
          stunCandidates,
          turnCandidates,
        };

        testPC.close();
        console.log(
          "[Netplay] 🧹 P2P connectivity test completed:",
          finalState,
        );

        // Provide recommendations
        if (
          turnCandidates === 0 &&
          iceServers.some(
            (s) =>
              s.urls &&
              (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) =>
                u.startsWith("turn:"),
              ),
          )
        ) {
          console.warn(
            "[Netplay] ⚠️ TURN servers configured but no relay candidates found - check TURN server credentials and connectivity",
          );
        }
        if (stunCandidates === 0 && stunServers.length > 0) {
          console.warn(
            "[Netplay] ⚠️ STUN servers configured but no server reflexive candidates found - check STUN server connectivity",
          );
        }
        if (candidateCount === hostCandidates) {
          console.warn(
            "[Netplay] ⚠️ Only host candidates found - this suggests NAT/firewall issues that may prevent P2P connectivity",
          );
        }
      }, 15000);
    } catch (error) {
      console.error("[Netplay] ❌ P2P connectivity test failed:", error);
    }
  }

  /**
   * Test ICE server configuration and STUN negotiation.
   * This method verifies that ICE servers are properly configured and accessible.
   */
  async testIceServerConfiguration() {
    console.log(
      "[Netplay] 🔍 Testing ICE server configuration and STUN negotiation...",
    );

    try {
      // Test SFU /ice endpoint directly
      console.log("[Netplay] 📡 Testing SFU /ice endpoint directly...");
      if (this.socket?.serverUrl) {
        const baseUrl = this.socket.serverUrl.replace(/\/socket\.io.*$/, "");
        const iceEndpoint = `${baseUrl}/ice`;
        const token = this.socket?.authToken;

        console.log("[Netplay] Direct /ice endpoint test:", {
          endpoint: iceEndpoint,
          hasToken: !!token,
          tokenPreview: token ? `${token.substring(0, 20)}...` : "none",
        });

        try {
          const response = await fetch(iceEndpoint, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          });

          console.log("[Netplay] /ice endpoint response:", {
            status: response.status,
            statusText: response.statusText,
            ok: response.ok,
          });

          if (response.ok) {
            const data = await response.json();
            console.log("[Netplay] /ice endpoint returned data:", data);
          } else {
            const text = await response.text();
            console.error("[Netplay] /ice endpoint error response:", text);
          }
        } catch (fetchError) {
          console.error(
            "[Netplay] Direct /ice endpoint fetch failed:",
            fetchError,
          );
        }
      } else {
        console.warn(
          "[Netplay] No socket available for direct /ice endpoint test",
        );
      }

      // Test SFU ICE server fetching
      console.log(
        "[Netplay] 📡 Testing SFU ICE server endpoint via SFUTransport...",
      );
      let sfuIceServers = [];
      if (this.sfuTransport) {
        try {
          sfuIceServers = await this.sfuTransport.getIceServers();
          console.log(
            `[Netplay] ✅ SFU returned ${sfuIceServers.length} ICE servers:`,
            sfuIceServers,
          );
        } catch (error) {
          console.error(
            "[Netplay] ❌ Failed to fetch ICE servers from SFU:",
            error,
          );
        }
      } else {
        console.warn(
          "[Netplay] ⚠️ No SFU transport available - cannot test SFU ICE servers",
        );
      }

      // Test RomM config ICE servers
      console.log("[Netplay] 🔧 Testing RomM ICE server configuration...");
      const rommIceServers =
        this.configManager?.getSetting("netplayIceServers") ||
        this.configManager?.getSetting("netplayICEServers") ||
        this.config?.netplayICEServers ||
        window.EJS_netplayICEServers;

      if (
        rommIceServers &&
        Array.isArray(rommIceServers) &&
        rommIceServers.length > 0
      ) {
        console.log(
          `[Netplay] ✅ RomM config has ${rommIceServers.length} ICE servers:`,
          rommIceServers,
        );
      } else {
        console.warn("[Netplay] ⚠️ No ICE servers configured in RomM");
      }

      // Determine final ICE server list (same logic as P2P initiation)
      let finalIceServers = [];
      if (sfuIceServers && sfuIceServers.length > 0) {
        finalIceServers = [...sfuIceServers];
        console.log(
          `[Netplay] 🎯 Will use ${finalIceServers.length} ICE servers from SFU (preferred)`,
        );
      } else if (
        rommIceServers &&
        Array.isArray(rommIceServers) &&
        rommIceServers.length > 0
      ) {
        finalIceServers = [...rommIceServers];
        console.log(
          `[Netplay] 🎯 Will use ${finalIceServers.length} ICE servers from RomM config`,
        );
      } else {
        finalIceServers = [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" },
        ];
        console.warn("[Netplay] ⚠️ Will use public STUN servers as fallback");
      }

      // Analyze ICE server types
      const stunServers = finalIceServers.filter((s) => {
        const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
        return urls.some(
          (url) => url.startsWith("stun:") || url.startsWith("stuns:"),
        );
      });

      const turnServers = finalIceServers.filter((s) => {
        const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
        return urls.some(
          (url) => url.startsWith("turn:") || url.startsWith("turns:"),
        );
      });

      console.log(`[Netplay] 📊 Final ICE server analysis:`);
      console.log(`  - STUN servers: ${stunServers.length}`);
      console.log(`  - TURN servers: ${turnServers.length}`);

      if (turnServers.length === 0) {
        console.warn(
          "[Netplay] ⚠️ No TURN servers configured - P2P may fail for clients behind NAT/firewalls",
        );
      }

      // Test STUN server reachability (basic connectivity test)
      console.log("[Netplay] 🌐 Testing STUN server reachability...");
      for (const server of stunServers.slice(0, 2)) {
        // Test first 2 STUN servers
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        for (const url of urls) {
          if (url.startsWith("stun:") || url.startsWith("stuns:")) {
            try {
              // Create a minimal RTCPeerConnection just to test STUN reachability
              const testPC = new RTCPeerConnection({
                iceServers: [{ urls: url }],
              });

              let stunReachable = false;
              testPC.onicecandidate = (event) => {
                if (event.candidate && event.candidate.type === "srflx") {
                  stunReachable = true;
                  console.log(
                    `[Netplay] ✅ STUN server ${url} is reachable (got server-reflexive candidate)`,
                  );
                  testPC.close();
                }
              };

              // Create a dummy offer to trigger ICE
              const offer = await testPC.createOffer();
              await testPC.setLocalDescription(offer);

              // Wait a bit for ICE candidates
              await new Promise((resolve) => setTimeout(resolve, 3000));
              testPC.close();

              if (!stunReachable) {
                console.warn(
                  `[Netplay] ⚠️ STUN server ${url} may not be reachable (no server-reflexive candidate received)`,
                );
              }
            } catch (error) {
              console.error(
                `[Netplay] ❌ Error testing STUN server ${url}:`,
                error,
              );
            }
            break; // Only test first URL for each server
          }
        }
      }

      console.log("[Netplay] ✅ ICE server configuration test completed");

      return {
        sfuIceServers,
        rommIceServers,
        finalIceServers,
        stunCount: stunServers.length,
        turnCount: turnServers.length,
      };
    } catch (error) {
      console.error(
        "[Netplay] ❌ ICE server configuration test failed:",
        error,
      );
      return null;
    }
  }

  // Setup P2P data channels for unorderedP2P/orderedP2P input modes
  async netplaySetupP2PChannels() {
    if (!this.emulator.netplay.engine || !this.sessionState?.isHostRole()) {
      console.log(
        "[Netplay] Not host or engine not available, skipping P2P channel setup",
      );
      return;
    }

    try {
      console.log(
        "[Netplay] Setting up P2P data channels for input synchronization...",
      );

      // Map to store RTCPeerConnection instances per sender for candidate handling
      this.p2pPCs = new Map();

      const inputMode =
        this.dataChannelManager?.mode ||
        this.configManager?.getSetting("inputMode") ||
        this.config.inputMode ||
        "unorderedRelay";

      // Always set up WebRTC signaling listener for incoming P2P offers from clients
      // The host can receive P2P inputs even if sending via relay
      if (this.socketTransport) {
        console.log(`[Netplay] Host setting up WebRTC signaling listener (inputMode: ${inputMode})`);
        // Listen for WebRTC signaling from clients to establish P2P connections
        this.socketTransport.on("webrtc-signal", async (data) => {
          try {
            const { sender, offer, answer, candidate, requestRenegotiate } =
              data;

            if (!sender) {
              console.warn("[Netplay] WebRTC signal missing sender");
              return;
            }

            // Handle offer from client (client wants to establish P2P connection)
            if (offer) {
              console.log(
                `[Netplay] Received WebRTC offer from ${sender}, creating answer...`,
              );

              // Get ICE servers from config, check both lowercase and uppercase variants
              const iceServers = this.configManager?.getSetting(
                "netplayIceServers",
              ) ||
                this.configManager?.getSetting("netplayICEServers") ||
                this.config?.netplayICEServers ||
                window.EJS_netplayICEServers || [
                  { urls: "stun:stun.l.google.com:19302" },
                  { urls: "stun:stun1.l.google.com:19302" },
                  { urls: "stun:stun2.l.google.com:19302" },
                ];

              // Log ICE server configuration for debugging
              console.log(
                "[Netplay] 🎯 Host using ICE servers for P2P:",
                JSON.stringify(iceServers, null, 2),
              );
              const stunCount = iceServers.filter(
                (s) =>
                  s.urls &&
                  (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) =>
                    u.startsWith("stun:"),
                  ),
              ).length;
              const turnCount = iceServers.filter(
                (s) =>
                  s.urls &&
                  (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) =>
                    u.startsWith("turn:"),
                  ),
              ).length;
              console.log(
                `[Netplay] 📊 Host ICE server summary: ${stunCount} STUN, ${turnCount} TURN servers configured`,
              );

              // Create RTCPeerConnection for P2P data channels
              const pc = new RTCPeerConnection({
                iceServers: iceServers,
                iceTransportPolicy: "all", // Try all candidates
                bundlePolicy: "balanced",
                rtcpMuxPolicy: "require",
              });

              // Store PC for candidate handling
              this.p2pPCs.set(sender, pc);

              // Add comprehensive WebRTC monitoring for host
              let connectionTimeout = null;
              let iceGatheringTimeout = null;

              pc.oniceconnectionstatechange = () => {
                console.log(
                  `[Netplay] Host P2P ICE connection state (${sender}): ${pc.iceConnectionState}`,
                );
                if (
                  pc.iceConnectionState === "connected" ||
                  pc.iceConnectionState === "completed"
                ) {
                  console.log(
                    `[Netplay] ✅ Host P2P connection established with ${sender}!`,
                  );
                  clearTimeout(connectionTimeout);
                  clearTimeout(iceGatheringTimeout);
                } else if (
                  pc.iceConnectionState === "failed" ||
                  pc.iceConnectionState === "disconnected" ||
                  pc.iceConnectionState === "closed"
                ) {
                  console.warn(
                    `[Netplay] ❌ Host P2P connection failed with ${sender}: ${pc.iceConnectionState}`,
                  );
                  // Clean up PC reference
                  this.p2pPCs.delete(sender);
                  // Could fall back to relay mode here
                }
              };

              pc.onicegatheringstatechange = () => {
                console.log(
                  `[Netplay] Host P2P ICE gathering state (${sender}): ${pc.iceGatheringState}`,
                );
                if (pc.iceGatheringState === "complete") {
                  clearTimeout(iceGatheringTimeout);
                }
              };

              // Track candidate types for diagnostics
              let candidateTypes = { host: 0, srflx: 0, relay: 0, prflx: 0 };

              pc.onicecandidate = (event) => {
                if (event.candidate) {
                  const candidate = event.candidate;
                  candidateTypes[candidate.type] =
                    (candidateTypes[candidate.type] || 0) + 1;
                  console.log(
                    `[Netplay] Host P2P ICE candidate (${sender}): ${candidate.type} ${candidate.protocol}:${candidate.port} priority:${candidate.priority}`,
                  );

                  // Log relay candidate detection (TURN working)
                  if (candidate.type === "relay") {
                    console.log(
                      `[Netplay] ✅ TURN server provided relay candidate for ${sender} - P2P should work!`,
                    );
                  }
                } else {
                  const totalCandidates = Object.values(candidateTypes).reduce(
                    (a, b) => a + b,
                    0,
                  );
                  console.log(
                    `[Netplay] Host P2P ICE candidate gathering complete (${sender}) - gathered ${totalCandidates} candidates:`,
                    candidateTypes,
                  );

                  // Warn if no relay candidates (TURN servers not working)
                  if (candidateTypes.relay === 0) {
                    console.warn(
                      `[Netplay] ⚠️ No relay candidates detected for ${sender} - TURN servers may not be working properly`,
                    );
                  }
                }
              };

              pc.onconnectionstatechange = () => {
                console.log(
                  `[Netplay] Host P2P connection state (${sender}): ${pc.connectionState}`,
                );
                if (
                  pc.connectionState === "connected" ||
                  pc.connectionState === "completed"
                ) {
                  console.log(
                    `[Netplay] ✅ Host P2P connection established with ${sender}`,
                  );
                } else if (
                  pc.connectionState === "failed" ||
                  pc.connectionState === "disconnected"
                ) {
                  console.warn(
                    `[Netplay] ⚠️ Host P2P connection ${pc.connectionState} with ${sender}`,
                  );
                }
              };

              // Set timeout for connection establishment (longer for local networks)
              connectionTimeout = setTimeout(() => {
                if (
                  pc.connectionState !== "connected" &&
                  pc.connectionState !== "completed"
                ) {
                  console.error(
                    `[Netplay] ❌ Host P2P connection timeout with ${sender} - falling back to relay mode`,
                  );
                  pc.close();
                  this.p2pPCs.delete(sender);
                  this.handleP2PFallback(sender);
                }
              }, 30000); // 30 second timeout for local networks

              // Set timeout for ICE gathering (increased for coturn servers)
              iceGatheringTimeout = setTimeout(() => {
                if (pc.iceGatheringState !== "complete") {
                  const candidateCount =
                    pc.localDescription?.sdp
                      ?.split("\n")
                      .filter((line) => line.startsWith("a=candidate"))
                      .length || 0;
                  console.warn(
                    `[Netplay] ⚠️ Host P2P ICE gathering timeout with ${sender} - gathered ${candidateCount} candidates`,
                  );

                  // Check if we have relay candidates (TURN servers working)
                  const hasRelayCandidates =
                    pc.localDescription?.sdp?.includes("typ relay") || false;

                  if (!hasRelayCandidates && candidateCount < 10) {
                    console.warn(
                      `[Netplay] 🚨 No relay candidates detected - TURN servers may be failing. Triggering early fallback to relay mode.`,
                    );
                    // Clear connection timeout since we're handling fallback now
                    clearTimeout(connectionTimeout);
                    pc.close();
                    this.p2pPCs.delete(sender);
                    this.handleP2PFallback(sender);
                    return;
                  }

                  // Continue with connection attempt even if gathering didn't complete
                  // The connection timeout will handle fallback if needed
                }
              }, 10000); // 10 second timeout for ICE gathering

              // Host receives data channels created by client (offerer)
              // Set up event handler to receive channels from client
              pc.ondatachannel = (event) => {
                const channel = event.channel;
                console.log(`[Netplay] Host received data channel from ${sender}: ${channel.label}, id: ${channel.id}, readyState: ${channel.readyState}`);

                // Add channel to DataChannelManager
                if (this.dataChannelManager) {
                  if (channel.label === "input-unordered") {
                    console.log(
                      `[Netplay] Adding unordered channel to DataChannelManager for ${sender}`,
                    );
                    this.dataChannelManager.addP2PChannel(sender, {
                      unordered: channel,
                      ordered: null, // Will be set when ordered channel arrives
                    });
                  } else if (channel.label === "input-ordered") {
                    console.log(
                      `[Netplay] Adding ordered channel to DataChannelManager for ${sender}`,
                    );
                    // Update existing entry with ordered channel
                    const existing =
                      this.dataChannelManager.p2pChannels.get(sender);
                    if (existing) {
                      existing.ordered = channel;
                    } else {
                      this.dataChannelManager.addP2PChannel(sender, {
                        ordered: channel,
                        unordered: null,
                      });
                    }
                  }
                  console.log(
                    `[Netplay] Host DataChannelManager now has ${this.dataChannelManager.p2pChannels.size} P2P connections`,
                  );
                }

                // Set up channel event handlers
                channel.onopen = () => {
                  console.log(
                    `[Netplay] Host ${channel.label} P2P channel opened with ${sender} - READY FOR INPUTS!`,
                  );
                  console.log(`[Netplay] Host channel state:`, {
                    label: channel.label,
                    id: channel.id,
                    readyState: channel.readyState,
                    bufferedAmount: channel.bufferedAmount,
                  });
                };

                channel.onmessage = (event) => {
                  console.log(
                    `[Netplay] Host received P2P message on ${channel.label}:`,
                    event.data,
                  );
                };

                channel.onerror = (error) => {
                  console.error(
                    `[Netplay] Host ${channel.label} P2P channel error:`,
                    error,
                  );
                };

                channel.onclose = () => {
                  console.log(
                    `[Netplay] Host ${channel.label} P2P channel closed with ${sender}`,
                  );
                  if (this.dataChannelManager) {
                    this.dataChannelManager.removeP2PChannel(sender);
                  }
                };
              };

              // Handle ICE candidates
              pc.onicecandidate = (event) => {
                if (event.candidate) {
                  console.log(
                    `[Netplay] Sending ICE candidate to client:`,
                    sender,
                  );
                  this.socketTransport.emit("webrtc-signal", {
                    target: sender,
                    candidate: event.candidate,
                    roomName: this.emulator.netplay.currentRoomId,
                  });
                }
              };

              // Set remote description and create answer
              await pc.setRemoteDescription(new RTCSessionDescription(offer));
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);

              // Send answer back to client
              console.log(`[Netplay] Sending WebRTC answer to client:`, sender);
              console.log(
                `[Netplay] Answer SDP type: ${answer.type}, contains 'm=application': ${answer.sdp?.includes("m=application")}`,
              );
              this.socketTransport.emit("webrtc-signal", {
                target: sender,
                answer: answer,
                roomName: this.emulator.netplay.currentRoomId,
              });

              // Create data channels from host to client for bidirectional communication
              const inputMode =
                this.dataChannelManager?.mode ||
                this.configManager?.getSetting("inputMode") ||
                this.config.inputMode ||
                "unorderedRelay";

              if (inputMode === "unorderedP2P" || inputMode === "orderedP2P") {
                const unorderedRetries =
                  this.configManager?.getSetting("netplayUnorderedRetries") || 0;

                // Create unordered channel for unorderedP2P and orderedP2P modes
                const unorderedChannel = pc.createDataChannel("input-unordered", {
                  ordered: false,
                  maxRetransmits: unorderedRetries > 0 ? unorderedRetries : undefined,
                  maxPacketLifeTime: unorderedRetries === 0 ? 3000 : undefined,
                });

                console.log(
                  `[Netplay] Host created unordered channel to ${sender}, id: ${unorderedChannel.id}, readyState: ${unorderedChannel.readyState}`,
                );

                // Set up channel event handlers
                unorderedChannel.onopen = () => {
                  console.log(
                    `[Netplay] Host unordered P2P channel opened to ${sender} - READY FOR INPUTS!`,
                  );
                  console.log(`[Netplay] Host unordered channel state:`, {
                    label: unorderedChannel.label,
                    id: unorderedChannel.id,
                    readyState: unorderedChannel.readyState,
                    bufferedAmount: unorderedChannel.bufferedAmount,
                  });
                };

                unorderedChannel.onmessage = (event) => {
                  console.log(
                    `[Netplay] Host received P2P message on unordered channel from ${sender}:`,
                    event.data,
                  );
                };

                unorderedChannel.onclose = () => {
                  console.log(`[Netplay] Host unordered P2P channel closed to ${sender}`);
                };

                unorderedChannel.onerror = (error) => {
                  console.error(`[Netplay] Host unordered P2P channel error to ${sender}:`, error);
                };

                // Add to DataChannelManager
                if (this.dataChannelManager) {
                  console.log(
                    `[Netplay] Adding host-created unordered channel to DataChannelManager for ${sender}`,
                  );
                  this.dataChannelManager.addP2PChannel(sender, {
                    unordered: unorderedChannel,
                  });
                  console.log(
                    `[Netplay] Host DataChannelManager now has ${this.dataChannelManager.p2pChannels.size} P2P connections`,
                  );
                }
              }

              if (inputMode === "orderedP2P") {
                // Create ordered channel for orderedP2P mode
                const orderedChannel = pc.createDataChannel("input-ordered", {
                  ordered: true,
                });

                console.log(
                  `[Netplay] Host created ordered channel to ${sender}, id: ${orderedChannel.id}, readyState: ${orderedChannel.readyState}`,
                );

                // Set up channel event handlers
                orderedChannel.onopen = () => {
                  console.log(`[Netplay] Host ordered P2P channel opened to ${sender}`);
                };

                orderedChannel.onmessage = (event) => {
                  console.log(
                    `[Netplay] Host received P2P message on ordered channel from ${sender}:`,
                    event.data,
                  );
                };

                orderedChannel.onclose = () => {
                  console.log(`[Netplay] Host ordered P2P channel closed to ${sender}`);
                };

                orderedChannel.onerror = (error) => {
                  console.error(`[Netplay] Host ordered P2P channel error to ${sender}:`, error);
                };

                // Add to DataChannelManager (update existing entry)
                if (this.dataChannelManager) {
                  const existing = this.dataChannelManager.p2pChannels.get(sender);
                  if (existing) {
                    existing.ordered = orderedChannel;
                  } else {
                    this.dataChannelManager.addP2PChannel(sender, {
                      ordered: orderedChannel,
                      unordered: null,
                    });
                  }
                }
              }

              console.log(
                `[Netplay] ✅ P2P connection established with ${sender}`,
              );
            }

            // Handle answer from client (response to our offer)
            if (answer) {
              console.log(`[Netplay] Received WebRTC answer from ${sender}`);
              // Answer handling would be done if host initiates connection
              // Currently clients initiate, so this is less common
            }

            // Handle ICE candidate
            if (candidate) {
              const pc = this.p2pPCs.get(sender);
              if (pc) {
                console.log(`[Netplay] Adding ICE candidate to PC for ${sender}`);
                pc.addIceCandidate(new RTCIceCandidate(candidate));
              } else {
                console.warn(`[Netplay] No PC found for ${sender} to add candidate`);
              }
            }
          } catch (error) {
              console.error("[Netplay] Failed to handle WebRTC signal:", error);
          }
        });

        // Optional: Skip additional P2P setup if host doesn't need to initiate P2P
        if (inputMode !== "unorderedP2P" && inputMode !== "orderedP2P") {
          console.log(
            `[Netplay] Host input mode is ${inputMode}, skipping outbound P2P setup but listening for client offers`,
          );
          return;
        }
      }
    } catch (error) {
      console.error("[Netplay] Failed to setup P2P channels:", error);
    }
  }

  // Capture video for netplay streaming
  async netplayCaptureCanvasVideo() {
    try {
      console.log("[Netplay] Attempting to capture direct video output...");

      // Method 1: Try direct emulator video output (if available)
      const ejs = window.EJS_emulator;
      if (ejs && typeof ejs.getVideoOutput === "function") {
        console.log("[Netplay] Trying direct emulator video output...");
        try {
          const videoStream = ejs.getVideoOutput();
          if (videoStream && videoStream.getVideoTracks) {
            const videoTrack = videoStream.getVideoTracks()[0];
            if (videoTrack) {
              console.log("[Netplay] Direct emulator video output captured");
              return videoTrack;
            }
          }
        } catch (error) {
          console.log("[Netplay] Direct emulator video output failed:", error.message);
        }
      }

      // Method 2: Try to find and capture from video elements (some emulators use <video> for output)
      const videoElements = document.querySelectorAll("video");
      for (const video of videoElements) {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          console.log("[Netplay] Found video element, attempting capture...");
          try {
            const stream = video.captureStream(30);
            const videoTrack = stream.getVideoTracks()[0];
            if (videoTrack) {
              console.log("[Netplay] Video element captured:", {
                width: video.videoWidth,
                height: video.videoHeight,
                frameRate: 30,
              });
              return videoTrack;
            }
          } catch (error) {
            console.log("[Netplay] Video element capture failed:", error.message);
          }
        }
      }

      // Method 3: Try canvas capture (existing method)
      console.log("[Netplay] Falling back to canvas capture...");
      const canvas = this.canvas || document.querySelector("canvas");
      console.log(
        "[Netplay] Canvas element:",
        canvas,
        "Width:",
        canvas?.width,
        "Height:",
        canvas?.height,
      );

      if (canvas) {
        const stream = canvas.captureStream(30);
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          console.log("[Netplay] Canvas video captured:", {
            width: canvas.width,
            height: canvas.height,
            frameRate: 30,
          });
          return videoTrack;
        }
      }

      // Method 4: Try display capture (screen/window/tab sharing)
      console.log("[Netplay] Falling back to display capture...");
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false
      });
      const displayVideoTrack = displayStream.getVideoTracks()[0];
      if (displayVideoTrack) {
        console.log("[Netplay] Display video captured");
        return displayVideoTrack;
      }

      console.warn("[Netplay] All video capture methods failed");
      return null;
    } catch (error) {
      console.error("[Netplay] Failed to capture video:", error);
      return null;
    }
  }

  async waitForEmulatorAudio(timeout = 5000) {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const ejs = window.EJS_emulator;
      if (ejs && typeof ejs.getAudioOutputNode === "function") {
        const node = ejs.getAudioOutputNode();
        if (node && node.context) return node;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    return null;
  }

  // Capture audio for netplay streaming
  async netplayCaptureAudio() {
    const ejs = window.EJS_emulator;

    // Try direct EmulatorJS WebAudio capture (preferred method)
    try {
      if (ejs && typeof ejs.getAudioOutputNode === "function") {
        const outputNode = ejs.getAudioOutputNode();
        if (outputNode && outputNode.context && typeof outputNode.connect === "function") {
          const audioContext = outputNode.context;

          // Resume context if suspended
          if (audioContext.state === "suspended") {
            await audioContext.resume();
          }

          // Create destination ONCE
          if (!this._netplayAudioDestination) {
            this._netplayAudioDestination = audioContext.createMediaStreamDestination();
            outputNode.connect(this._netplayAudioDestination);
            console.log("[Netplay] Emulator audio tapped for capture");
          }

          const track = this._netplayAudioDestination.stream.getAudioTracks()[0] || null;
          if (track) {
            console.log("[Netplay] ✅ Game audio captured from EmulatorJS WebAudio graph", {
              trackId: track.id,
              enabled: track.enabled,
              settings: track.getSettings(),
              audioContextState: audioContext.state,
              nodeType: outputNode.constructor.name,
            });
            return track;
          }
          console.log("[Netplay] MediaStreamDestination created but no audio track available");
        } else {
          console.log("[Netplay] EmulatorJS audio node invalid or missing connect method");
        }
      } else {
        console.log("[Netplay] EmulatorJS audio hook not available");
      }
    } catch (error) {
      console.log("[Netplay] Direct EmulatorJS WebAudio capture failed:", error.message);
    }

    // Fallback: Try display audio capture (from canvas/screen)
    try {
      console.log("[Netplay] Attempting display audio capture (fallback method)");
      if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: false,  // We only want audio, not video
        });
        if (displayStream && displayStream.getAudioTracks().length > 0) {
          const displayTrack = displayStream.getAudioTracks()[0];
          console.log("[Netplay] ✅ Display audio captured for netplay", {
            trackId: displayTrack.id,
            enabled: displayTrack.enabled,
            settings: displayTrack.getSettings(),
          });
          return displayTrack;
        }
        console.log("[Netplay] Display capture succeeded but no audio tracks");
      } else {
        console.log("[Netplay] getDisplayMedia not supported");
      }
    } catch (displayError) {
      console.log("[Netplay] Display audio capture failed:", displayError.message);
      if (displayError.name === "NotSupportedError") {
        console.log("[Netplay] Browser does not support audio capture from display/screen sharing");
      } else if (displayError.name === "NotAllowedError") {
        console.log("[Netplay] User denied permission for display audio capture");
      } else {
        console.log("[Netplay] Display audio capture cancelled or failed");
      }
    }

    console.log("[Netplay] All audio capture methods failed, returning null");
    return null;
  }

  /**
   * Capture microphone audio for voice chat.
   * @returns {Promise<MediaStreamTrack|null>} Microphone audio track or null if failed
   */
  async netplayCaptureMicAudio() {
    try {
      console.log("[Netplay] Requesting microphone access for voice chat");

      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000, // Match Opus native rate
          channelCount: 1, // Mono for voice
        },
      });

      const micTrack = micStream.getAudioTracks()[0];
      if (micTrack) {
        console.log("[Netplay] ✅ Microphone audio captured for voice chat", {
          trackId: micTrack.id,
          enabled: micTrack.enabled,
          settings: micTrack.getSettings(),
        });
        return micTrack;
      } else {
        console.warn("[Netplay] No microphone track available");
        return null;
      }
    } catch (micError) {
      console.log("[Netplay] Microphone capture failed:", micError.message);
      if (micError.name === "NotAllowedError") {
        console.log("[Netplay] User denied microphone permission");
      } else if (micError.name === "NotFoundError") {
        console.log("[Netplay] No microphone found");
      } else {
        console.log("[Netplay] Microphone capture error:", micError);
      }
      return null;
    }
  }

  /**
   * Start ping test to debug channel connectivity.
   */
  startPingTest() {
    if (this.dataChannelManager) {
      this.dataChannelManager.startPingTest();
    } else {
      console.warn(
        "[NetplayEngine] No data channel manager available for ping test",
      );
    }
  }

  /**
   * Stop ping test.
   */
  stopPingTest() {
    if (this.dataChannelManager) {
      this.dataChannelManager.stopPingTest();
    }
  }

  /**
   * Temporarily force ordered mode to test for packet loss issues.
   * @param {boolean} ordered - True to force ordered, false to use configured mode
   */
  forceOrderedMode(ordered = true) {
    if (this.dataChannelManager) {
      const originalMode = this.dataChannelManager.mode;
      const newMode = ordered ? "orderedRelay" : "unorderedRelay";
      console.log(
        `[NetplayEngine] Forcing mode from ${originalMode} to ${newMode} for testing`,
      );
      this.dataChannelManager.mode = newMode;
      return originalMode; // Return original mode so it can be restored
    }
    return null;
  }
}

// Expose as global for concatenated/minified builds
// Direct assignment - browser environment always has window
// #region agent log
try {
} catch (e) {
  console.error("Error before assignment:", e);
}
// #endregion
window.NetplayEngine = NetplayEngine;
// #region agent log
try {
} catch (e) {
  console.error("Error after assignment:", e);
}
// #endregion
// #region agent log
// #endregion
