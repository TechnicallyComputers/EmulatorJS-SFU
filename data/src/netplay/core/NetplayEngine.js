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
    LIVE_STREAM: 'live_stream',
    DELAY_SYNC: 'delay_sync'
  };

  static RoomPhase = {
    LOBBY: 'lobby',
    PREPARE: 'prepare',
    RUNNING: 'running',
    ENDED: 'ended'
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
      return filename.replace(/\.[^/.]+$/, '');
    }

    return 'Unknown ROM';
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
        "orderedRelay";
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
        onPlayerValidationUpdated: (playerId, validationStatus, validationReason) => {
          console.log(`[NetplayEngine] onPlayerValidationUpdated callback called for ${playerId}: ${validationStatus}`);
          if (this.netplayMenu && this.netplayMenu.netplayUpdatePlayerValidation) {
            this.netplayMenu.netplayUpdatePlayerValidation(playerId, validationStatus, validationReason);
          }
        },
        onRoomClosed: (data) => {
          console.log("[NetplayEngine] Room closed:", data);
        },
      };
      this.roomManager = new RoomManager(
        this.socketTransport,
        this.configManager?.loadConfig() || {},
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
          try {
            this.emulator.simulateInput(playerIndex, inputIndex, inputValue);
            console.log(
              `[NetplayEngine] ✅ Socket input applied successfully to emulator`,
            );
          } catch (error) {
            console.error(
              `[NetplayEngine] ❌ Failed to apply socket input to emulator:`,
              error,
            );
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
        player_name: this.emulator.netplay.getNetplayId(),
        player_slot: this.emulator.netplay.localSlot || 0,
        domain: window.location.host,
        game_id: this.config.gameId || "",
        netplay_mode: roomType === "delay_sync" ? NetplayEngine.RoomMode.DELAY_SYNC : NetplayEngine.RoomMode.LIVE_STREAM,
        room_phase: roomType === "delay_sync" ? NetplayEngine.RoomPhase.LOBBY : NetplayEngine.RoomPhase.RUNNING,
        allow_spectators: allowSpectators,
        spectator_mode: allowSpectators ? 1 : 0,
      };

      // Add structured metadata for DELAY_SYNC rooms
      if (roomType === "delay_sync") {
        const emulatorId = this.config.system || this.config.core || "unknown";
        const EMULATOR_NAMES = {
          snes9x: 'SNES9x',
          bsnes: 'bsnes',
          mupen64plus: 'Mupen64Plus',
          pcsx_rearmed: 'PCSX-ReARMed',
          mednafen_psx: 'Mednafen PSX',
          mednafen_snes: 'Mednafen SNES',
          melonDS: 'melonDS',
          citra: 'Citra',
          dolphin: 'Dolphin',
          ppsspp: 'PPSSPP'
        };

        playerInfo.metadata = {
          rom: {
            displayName: this.getRomDisplayName(),
            hash: this.config.romHash ? {
              algo: 'sha256', // Assume SHA-256, could be configurable
              value: this.config.romHash
            } : null
          },
          emulator: {
            id: emulatorId,
            displayName: EMULATOR_NAMES[emulatorId] || emulatorId,
            coreVersion: this.config.coreVersion || null
          }
        };
      }

      // Add sync config for delay sync rooms
      if (roomType === "delay_sync") {
        playerInfo.sync_config = {
          frameDelay: frameDelay,
          syncMode: syncMode,
        };
      }

      try {
        const result = await this.createRoom(
          roomName,
          maxPlayers,
          password,
          playerInfo,
        );
        console.log("[Netplay] Room creation successful via engine:", result);

        // Keep the room listing engine - it will be upgraded to a main engine

        // Store room info for later use
        this.emulator.netplay.currentRoomId = roomName; // RoomManager returns sessionid, but room ID is roomName
        this.emulator.netplay.currentRoom = {
          room_name: roomName,
          current: 1, // Creator is already joined
          max: maxPlayers,
          hasPassword: !!password,
          netplay_mode: roomType === "delay_sync" ? NetplayEngine.RoomMode.DELAY_SYNC : NetplayEngine.RoomMode.LIVE_STREAM,
          room_phase: roomType === "delay_sync" ? NetplayEngine.RoomPhase.LOBBY : NetplayEngine.RoomPhase.RUNNING,
          sync_config:
            roomType === "delay_sync"
              ? {
                  frameDelay: frameDelay,
                  syncMode: syncMode,
                }
              : null,
          spectator_mode: allowSpectators ? 1 : 0,
          // Include new structured metadata for DELAY_SYNC
          ...(roomType === "delay_sync" ? {
            metadata: playerInfo.metadata
          } : {
            rom_hash: this.config.romHash || this.config.romName || null,
            core_type: this.config.system || this.config.core || null,
          }),
        };

        // For DELAY_SYNC, update room metadata after creation
        if (roomType === "delay_sync") {
          this.emulator.netplay.engine.roomManager.updateRoomMetadata(roomName, {
            rom_hash: this.config.romHash || this.config.romName || null,
            core_type: this.config.system || this.config.core || null,
          }).catch(err => {
            console.warn("[NetplayEngine] Failed to update room metadata:", err);
          });
        }

        // Switch to appropriate room UI and setup based on room type
        if (roomType === "live_stream") {
          this.netplayMenu.netplaySwitchToLiveStreamRoom(roomName, password);

          // LIVESTREAM ROOM: Set up WebRTC producer transports for host
          // Only hosts need to create producers for video/audio streaming
          console.log(
            "[Netplay] Livestream room created - setting up producers immediately",
          );
          setTimeout(() => this.netplaySetupProducers(), 1000);
        } else if (roomType === "delay_sync") {
          this.netplayMenu.netplaySwitchToDelaySyncRoom(
            roomName,
            password,
            maxPlayers,
          );

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
      rom_hash: this.config.romHash || this.config.romName || null,
      core_type: this.config.system || this.config.core || null,
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
      console.log("[Netplay] Joining room via NetplayEngine:", {
        roomId,
        password,
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
      };

      try {
        const result = await this.joinRoom(
          null,
          roomId,
          4,
          password,
          playerInfo,
        );
        console.log("[Netplay] Room join successful via engine:", result);

        // Store room info
        this.emulator.netplay.currentRoomId = roomId;
        this.emulator.netplay.currentRoom = result;

        // Immediately update player list with users from join result
        if (result && result.users) {
          console.log(
            "[Netplay] Updating player list immediately after join with users:",
            Object.keys(result.users),
          );
          this.netplayMenu.netplayUpdatePlayerList({ players: result.users });
        }

        // Switch to appropriate room UI and setup based on room type
        const roomType =
          result.netplay_mode === 1 ? "delay_sync" : "live_stream";
        if (roomType === "live_stream") {
          this.netplayMenu.netplaySwitchToLiveStreamRoom(roomId, password);

          // LIVESTREAM ROOM: Set up WebRTC consumer transports
          // Both hosts and clients need consumers for data channels
          // Only clients need video/audio consumers from host
          const isHost =
            this.emulator.netplay.engine?.sessionState?.isHostRole();
          console.log(
            "[Netplay] After joining livestream room - isHost:",
            isHost,
          );

          if (this.emulator.netplay.engine) {
            // PAUSE LOCAL EMULATOR FOR CLIENTS - they should watch the host's stream
            if (!isHost) {
              console.log(
                "[Netplay] Pausing local emulator for client - watching host stream",
              );
              try {
                if (
                  this.emulator.netplay.adapter &&
                  typeof this.emulator.netplay.adapter.pause === "function"
                ) {
                  this.emulator.netplay.adapter.pause();
                } else if (typeof this.emulator.pause === "function") {
                  this.emulator.pause();
                } else {
                  console.warn(
                    "[Netplay] Could not pause emulator - pause method not available",
                  );
                }
              } catch (error) {
                console.error("[Netplay] Failed to pause emulator:", error);
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

            console.log(
              "[Netplay] Setting up WebRTC consumer transports for data channels",
            );
            setTimeout(() => this.netplaySetupConsumers(), 1000);

            // Set up data producers for input
            // Host always sends input, clients send input if they have a player slot assigned
            const currentPlayerSlot = this.emulator.netplay.localSlot;
            const hasPlayerSlot =
              currentPlayerSlot !== undefined &&
              currentPlayerSlot !== null &&
              currentPlayerSlot >= 0;

            // Always set up data consumers (to receive inputs from host/other clients)
            console.log(
              "[Netplay] Setting up data consumers for live stream room",
            );
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
                "orderedRelay";

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

            // Set up data producers for input (everyone needs to send inputs)
            console.log("[Netplay] Setting up data producers for input");
            setTimeout(() => this.netplaySetupDataProducers(), 1500);
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

    // 1. Clean up intervals
    if (this._producerRetryInterval) {
      clearInterval(this._producerRetryInterval);
      this._producerRetryInterval = null;
    }
    if (this._audioRetryInterval) {
      clearInterval(this._audioRetryInterval);
      this._audioRetryInterval = null;
    }

    // 2. Leave room via RoomManager
    if (this.emulator.netplay.engine) {
      try {
        await this.leaveRoom();
        console.log("[Netplay] Left room successfully");
      } catch (error) {
        console.error("[Netplay] Error leaving room:", error);
      }
    }

    // 3. Disconnect transport
    if (this.emulator.netplay.transport) {
      try {
        await this.emulator.netplay.transport.disconnect();
        console.log("[Netplay] Transport disconnected");
      } catch (error) {
        console.error("[Netplay] Error disconnecting transport:", error);
      }
    }

    // 4. Clean up engine and transport references
    if (this.emulator.netplay) {
      this.emulator.netplay.engine = null;
      this.emulator.netplay.transport = null;
      this.emulator.netplay.adapter = null;
      console.log("[Netplay] Cleared engine and transport references");
    }

    // 5. Restore original simulateInput
    if (this.gameManager && this.gameManager.originalSimulateInput) {
      this.gameManager.simulateInput = this.gameManager.originalSimulateInput;
      delete this.gameManager.originalSimulateInput;
      console.log("[Netplay] Restored original simulateInput");
    }

    // 6. Comprehensive UI cleanup via NetplayMenu
    if (this.netplayMenu) {
      // Reset all netplay menu state
      this.netplayMenu.isNetplay = false;

      // Clear the entire netplay state object
      if (this.netplayMenu.netplay) {
        this.netplayMenu.netplay = {};
      }

      // Reset global EJS netplay state
      if (window.EJS) {
        window.EJS.isNetplay = false;
      }

      // Restore normal bottom bar buttons
      if (this.netplayMenu.restoreNormalBottomBar) {
        this.netplayMenu.restoreNormalBottomBar();
      }

      // Hide menu completely
      if (this.netplayMenu.hide) {
        this.netplayMenu.hide();
      }

      // Reset to initial state (no tabs shown)
      if (this.netplayMenu.netplayMenu) {
        const titleElement = this.netplayMenu.netplayMenu.querySelector("h4");
        if (titleElement) {
          titleElement.innerText = "Netplay";
        }
      }
    }

    // 7. Hide chat component
    if (this.chatComponent) {
      this.chatComponent.hide();
    }

    console.log("[Netplay] Room leave and cleanup completed");
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

      // Capture mic audio for voice chat (only for non-spectators)
      const isSpectator = this.sessionState?.isSpectatorRole() || false;
      if (!isSpectator) {
        try {
          console.log(
            "[Netplay] 🎤 Setting up mic audio producer for voice chat...",
          );
          const micAudioTrack = await this.netplayCaptureMicAudio();
          if (micAudioTrack) {
            await this.sfuTransport.createMicAudioProducer(micAudioTrack);
            console.log("[Netplay] ✅ Mic audio producer created");
          } else {
            console.log(
              "[Netplay] ℹ️ Mic audio not available (user denied permission or no mic found)",
            );
          }
        } catch (error) {
          console.error(
            "[Netplay] ❌ Failed to create mic audio producer:",
            error,
          );
          // Mic audio is optional, don't throw here
        }
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

      // Check input mode and set up P2P channels if needed for unorderedP2P
      const inputMode =
        this.dataChannelManager?.mode ||
        this.configManager?.getSetting("inputMode") ||
        this.config.inputMode ||
        "orderedRelay";

      if (inputMode === "unorderedP2P" || inputMode === "orderedP2P") {
        console.log(
          `[Netplay] Input mode is ${inputMode}, setting up P2P data channels...`,
        );
        await this.netplaySetupP2PChannels();
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
      if (playerEntries.length > 0) {
        // For simplicity, assume the first player in the list is the host
        // This is a heuristic - in practice, the server should provide host information
        [hostPlayerId] = playerEntries[0];
        console.log("[Netplay] Assuming first player is host:", hostPlayerId);
        console.log(
          "[Netplay] All available players:",
          playerEntries.map(([id]) => id),
        );
      }

      // Alternative: look for a player that might have host privileges or special markers
      for (const [playerId, playerData] of Object.entries(players)) {
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
          // Public TURN servers (may have rate limits)
          {
            urls: "turn:turn.anyfirewall.com:443?transport=tcp",
            username: "webrtc",
            credential: "webrtc",
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
          // Could fall back to relay mode here
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
          pc.close();
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
            clearTimeout(connectionTimeout);
            pc.close();
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
      console.log(
        `[Netplay] Created unordered channel: ${unorderedChannel.label}, id: ${unorderedChannel.id}, readyState: ${unorderedChannel.readyState}`,
      );

      const orderedChannel = pc.createDataChannel("input-ordered", {
        ordered: true,
      });
      console.log(
        `[Netplay] Created ordered channel: ${orderedChannel.label}, id: ${orderedChannel.id}, readyState: ${orderedChannel.readyState}`,
      );

      // Add channels to DataChannelManager immediately
      if (this.dataChannelManager) {
        console.log(
          `[Netplay] Adding P2P channels for host to DataChannelManager`,
        );
        this.dataChannelManager.addP2PChannel("host", {
          ordered: orderedChannel,
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
      orderedChannel.onopen = () => {
        console.log(`[Netplay] Client ordered P2P channel opened with host`);
        console.log(`[Netplay] Ordered channel state:`, {
          label: orderedChannel.label,
          id: orderedChannel.id,
          readyState: orderedChannel.readyState,
          bufferedAmount: orderedChannel.bufferedAmount,
        });
      };

      unorderedChannel.onmessage = (event) => {
        console.log(
          `[Netplay] Client received P2P message on unordered channel:`,
          event.data,
        );
      };
      orderedChannel.onmessage = (event) => {
        console.log(
          `[Netplay] Client received P2P message on ordered channel:`,
          event.data,
        );
      };

      unorderedChannel.onclose = () => {
        console.log(`[Netplay] Client unordered P2P channel closed with host`);
      };
      orderedChannel.onclose = () => {
        console.log(`[Netplay] Client ordered P2P channel closed with host`);
      };

      unorderedChannel.onerror = (error) => {
        console.error(`[Netplay] Client unordered P2P channel error:`, error);
      };
      orderedChannel.onerror = (error) => {
        console.error(`[Netplay] Client ordered P2P channel error:`, error);
      };

      // Listen for data channels (though we created them, this handles any additional ones)
      pc.ondatachannel = (event) => {
        const channel = event.channel;
        console.log(
          `[Netplay] Client received data channel: ${channel.label}, id: ${channel.id}, readyState: ${channel.readyState}`,
        );

        // Determine channel type and add to DataChannelManager
        if (this.dataChannelManager) {
          if (channel.label === "input-unordered") {
            console.log(
              `[Netplay] Adding unordered channel to DataChannelManager`,
            );
            this.dataChannelManager.addP2PChannel("host", {
              unordered: channel,
              ordered: null, // Will be set when ordered channel arrives
            });
          } else if (channel.label === "input-ordered") {
            console.log(
              `[Netplay] Adding ordered channel to DataChannelManager`,
            );
            // Update existing entry with ordered channel
            const existing = this.dataChannelManager.p2pChannels.get("host");
            if (existing) {
              existing.ordered = channel;
            } else {
              this.dataChannelManager.addP2PChannel("host", {
                ordered: channel,
                unordered: null,
              });
            }
          }
          console.log(
            `[Netplay] Client DataChannelManager now has ${this.dataChannelManager.p2pChannels.size} P2P connections`,
          );
        }

        // Set up event handlers
        channel.onopen = () => {
          console.log(
            `[Netplay] Client ${channel.label} P2P channel opened with host`,
          );
        };

        channel.onerror = (error) => {
          console.error(
            `[Netplay] Client ${channel.label} P2P channel error:`,
            error,
          );
        };

        channel.onclose = () => {
          console.log(
            `[Netplay] Client ${channel.label} P2P channel closed with host`,
          );
          if (this.dataChannelManager) {
            this.dataChannelManager.removeP2PChannel("host");
          }
        };
      };

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          // Send ICE candidate to host via signaling
          this.socketTransport.sendDataMessage({
            "webrtc-signal": {
              candidate: event.candidate,
            },
          });
        }
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
    } else if (currentMode === "orderedP2P") {
      console.log(
        `[Netplay] Falling back from orderedP2P to orderedRelay for ${targetId}`,
      );
      this.dataChannelManager.mode = "orderedRelay";
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

      const inputMode =
        this.dataChannelManager?.mode ||
        this.configManager?.getSetting("inputMode") ||
        this.config.inputMode ||
        "orderedRelay";

      if (inputMode !== "unorderedP2P" && inputMode !== "orderedP2P") {
        console.log(
          `[Netplay] Input mode is ${inputMode}, P2P channels not needed`,
        );
        return;
      }

      // Set up WebRTC signaling for P2P data channels
      if (this.socketTransport) {
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
                  // Public TURN servers (may have rate limits)
                  {
                    urls: "turn:turn.anyfirewall.com:443?transport=tcp",
                    username: "webrtc",
                    credential: "webrtc",
                  },
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
                console.log(
                  `[Netplay] Host received data channel from ${sender}: ${channel.label}, id: ${channel.id}, readyState: ${channel.readyState}`,
                );

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
              });

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
              console.log(`[Netplay] Received ICE candidate from ${sender}`);
              // ICE candidate handling would be done in RTCPeerConnection
            }
          } catch (error) {
            console.error("[Netplay] Failed to handle WebRTC signal:", error);
          }
        });

        console.log(
          "[Netplay] P2P channel setup complete - listening for WebRTC signals from clients",
        );
      }
    } catch (error) {
      console.error("[Netplay] Failed to setup P2P channels:", error);
    }
  }

  // Capture canvas as video track for netplay streaming
  async netplayCaptureCanvasVideo() {
    try {
      console.log("[Netplay] Attempting to capture canvas video...");
      // Get the canvas element
      const canvas = this.canvas || document.querySelector("canvas");
      console.log(
        "[Netplay] Canvas element:",
        canvas,
        "Width:",
        canvas?.width,
        "Height:",
        canvas?.height,
      );

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
          frameRate: 30,
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
      // FIRST: Try to capture audio directly from the EmulatorJS instance using the proper WebAudio approach
      // This uses the clean hook to tap into the WebAudio graph and is preferred for emulator audio
      try {
        console.log(
          "[Netplay] Attempting direct EmulatorJS WebAudio capture (preferred method)",
        );
        console.log(
          "[Netplay] Checking for EmulatorJS instance with audio hook:",
          {
            hasEJS: !!window.EJS_emulator,
            hasGetAudioOutputNode:
              typeof window.EJS_emulator?.getAudioOutputNode === "function",
          },
        );

        if (
          window.EJS_emulator &&
          typeof window.EJS_emulator.getAudioOutputNode === "function"
        ) {
          const audioOutputNode = window.EJS_emulator.getAudioOutputNode();
          console.log("[Netplay] EmulatorJS getAudioOutputNode returned:", {
            hasNode: !!audioOutputNode,
            nodeType: audioOutputNode?.constructor?.name,
            context: audioOutputNode?.context?.constructor?.name,
          });

          if (
            audioOutputNode &&
            audioOutputNode.context &&
            typeof audioOutputNode.connect === "function"
          ) {
            try {
              // Create MediaStreamDestinationNode in the same audio context
              const audioContext = audioOutputNode.context;
              const destination = audioContext.createMediaStreamDestination();

              // Connect the emulator's audio output to our capture destination
              // This taps the audio BEFORE it goes to speakers
              audioOutputNode.connect(destination);

              const audioTrack = destination.stream.getAudioTracks()[0];
              if (audioTrack) {
                console.log(
                  "[Netplay] ✅ Game audio captured from EmulatorJS WebAudio graph",
                  {
                    trackId: audioTrack.id,
                    enabled: audioTrack.enabled,
                    settings: audioTrack.getSettings(),
                    audioContextState: audioContext.state,
                    nodeType: audioOutputNode.constructor.name,
                  },
                );
                return audioTrack;
              } else {
                console.log(
                  "[Netplay] MediaStreamDestinationNode created but no audio track available",
                );
              }
            } catch (webAudioError) {
              console.log(
                "[Netplay] Failed to create MediaStreamDestinationNode:",
                webAudioError.message,
              );
            }
          } else if (audioOutputNode === null) {
            console.log(
              "[Netplay] EmulatorJS reports no audio output node available (expected for some cores)",
            );
          } else {
            console.log(
              "[Netplay] EmulatorJS audio output node not suitable for capture",
            );
          }
        } else {
          console.log("[Netplay] EmulatorJS audio hook not available");
        }
      } catch (emulatorError) {
        console.log(
          "[Netplay] EmulatorJS audio capture failed:",
          emulatorError.message,
        );
      }

      // SECOND: Try to capture browser tab audio as fallback
      // This prompts the user to select the browser tab for ROM audio capture
      try {
        console.log(
          "[Netplay] Fallback: Requesting display audio capture (select browser tab for ROM audio)",
        );
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: false,
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            sampleRate: 44100,
            channelCount: 2,
          },
        });

        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) {
          console.log("[Netplay] Audio captured from display (tab audio)", {
            trackId: audioTrack.id,
            enabled: audioTrack.enabled,
            settings: audioTrack.getSettings(),
          });
          return audioTrack;
        }
      } catch (displayError) {
        console.log(
          "[Netplay] Display audio capture failed:",
          displayError.message,
        );
        if (displayError.name === "NotSupportedError") {
          console.log(
            "[Netplay] Browser does not support audio capture from display/screen sharing",
          );
        } else if (displayError.name === "NotAllowedError") {
          console.log(
            "[Netplay] User denied permission for display audio capture",
          );
        } else {
          console.log("[Netplay] Display audio capture cancelled or failed");
        }
      }

      // THIRD: Try to capture audio from existing audio/video elements on the page
      try {
        console.log(
          "[Netplay] Checking for EmulatorJS instance with audio hook:",
          {
            hasEJS: !!window.EJS_emulator,
            hasGetAudioOutputNode:
              typeof window.EJS_emulator?.getAudioOutputNode === "function",
          },
        );

        if (
          window.EJS_emulator &&
          typeof window.EJS_emulator.getAudioOutputNode === "function"
        ) {
          const audioOutputNode = window.EJS_emulator.getAudioOutputNode();
          console.log("[Netplay] EmulatorJS getAudioOutputNode returned:", {
            hasNode: !!audioOutputNode,
            nodeType: audioOutputNode?.constructor?.name,
            context: audioOutputNode?.context?.constructor?.name,
          });

          if (
            audioOutputNode &&
            audioOutputNode.context &&
            typeof audioOutputNode.connect === "function"
          ) {
            try {
              // Create MediaStreamDestinationNode in the same audio context
              const audioContext = audioOutputNode.context;
              const destination = audioContext.createMediaStreamDestination();

              // Connect the emulator's audio output to our capture destination
              // This taps the audio BEFORE it goes to speakers
              audioOutputNode.connect(destination);

              const audioTrack = destination.stream.getAudioTracks()[0];
              if (audioTrack) {
                console.log(
                  "[Netplay] Audio captured from EmulatorJS WebAudio graph",
                  {
                    trackId: audioTrack.id,
                    enabled: audioTrack.enabled,
                    settings: audioTrack.getSettings(),
                    audioContextState: audioContext.state,
                    nodeType: audioOutputNode.constructor.name,
                  },
                );
                return audioTrack;
              } else {
                console.log(
                  "[Netplay] MediaStreamDestinationNode created but no audio track available",
                );
              }
            } catch (webAudioError) {
              console.log(
                "[Netplay] Failed to create MediaStreamDestinationNode:",
                webAudioError.message,
              );
            }
          } else if (audioOutputNode === null) {
            console.log(
              "[Netplay] EmulatorJS reports no audio output node available (expected for some cores)",
            );
          } else {
            console.log(
              "[Netplay] EmulatorJS audio output node not suitable for capture",
            );
          }
        } else {
          console.log("[Netplay] EmulatorJS audio hook not available");
        }
      } catch (emulatorError) {
        console.log(
          "[Netplay] EmulatorJS audio capture failed:",
          emulatorError.message,
        );
      }

      // THIRD: Try to capture audio from existing audio/video elements on the page
      // This is most likely to capture emulator audio
      try {
        const mediaElements = document.querySelectorAll("audio, video");
        console.log(
          `[Netplay] Found ${mediaElements.length} media elements to check for audio capture`,
        );

        for (const element of mediaElements) {
          console.log(
            `[Netplay] Checking media element: ${element.tagName}#${element.id || "no-id"}`,
            {
              src: element.src || element.currentSrc,
              readyState: element.readyState,
              paused: element.paused,
              muted: element.muted,
              volume: element.volume,
              duration: element.duration,
            },
          );

          if (element.captureStream || element.mozCaptureStream) {
            try {
              const captureMethod =
                element.captureStream || element.mozCaptureStream;
              const stream = captureMethod.call(element);
              const audioTrack = stream.getAudioTracks()[0];
              if (audioTrack) {
                console.log("[Netplay] Audio captured from media element", {
                  elementTag: element.tagName,
                  elementId: element.id,
                  trackId: audioTrack.id,
                  enabled: audioTrack.enabled,
                  readyState: element.readyState,
                  duration: element.duration,
                });
                return audioTrack;
              } else {
                console.log(
                  `[Netplay] No audio track in stream from ${element.tagName} element`,
                );
              }
            } catch (captureError) {
              console.log(
                `[Netplay] Failed to capture from ${element.tagName} element:`,
                captureError.message,
              );
            }
          } else {
            console.log(
              `[Netplay] ${element.tagName} element doesn't support captureStream`,
            );
          }
        }

        if (mediaElements.length === 0) {
          console.log("[Netplay] No audio/video elements found on page");
        }
      } catch (elementError) {
        console.log(
          "[Netplay] Media element enumeration failed:",
          elementError.message,
        );
      }

      // FOURTH: Try to capture from document stream (experimental)
      try {
        if (document.captureStream) {
          console.log("[Netplay] Attempting to capture from document stream");
          const stream = document.captureStream();
          const audioTrack = stream.getAudioTracks()[0];
          if (audioTrack) {
            console.log("[Netplay] Audio captured from document", {
              trackId: audioTrack.id,
              enabled: audioTrack.enabled,
            });
            return audioTrack;
          }
        }
      } catch (docError) {
        console.log("[Netplay] Document capture failed:", docError.message);
      }

      // Try canvas capture stream (may include audio in some cases)
      try {
        const canvas =
          document.querySelector("canvas.ejs_canvas") ||
          document.querySelector("canvas");
        if (canvas && canvas.captureStream) {
          console.log("[Netplay] Attempting to capture from canvas stream");
          const stream = canvas.captureStream(30);
          const audioTrack = stream.getAudioTracks()[0];
          if (audioTrack) {
            console.log("[Netplay] Audio captured from canvas", {
              trackId: audioTrack.id,
              enabled: audioTrack.enabled,
            });
            return audioTrack;
          } else {
            console.log("[Netplay] Canvas stream has no audio track");
          }
        }
      } catch (canvasError) {
        console.log(
          "[Netplay] Canvas audio capture failed:",
          canvasError.message,
        );
      }

      // FIFTH: Try to capture audio from the Web Audio API context destination
      // This captures all audio output from the page, including emulator audio
      try {
        console.log(
          "[Netplay] Attempting to capture from Web Audio API destination (all page audio including ROM)",
        );

        // Create a Web Audio context if one doesn't exist
        let audioContext = window.AudioContext || window.webkitAudioContext;
        if (!audioContext) {
          throw new Error("Web Audio API not supported");
        }

        const context = new audioContext();
        const destination = context.createMediaStreamDestination();

        // Note: This creates a destination, but audio needs to be routed through Web Audio context
        const audioTrack = destination.stream.getAudioTracks()[0];
        if (audioTrack) {
          console.log(
            "[Netplay] Audio destination created from Web Audio context",
            {
              trackId: audioTrack.id,
              enabled: audioTrack.enabled,
              contextState: context.state,
              note: "This may be silent if no audio is routed through Web Audio",
            },
          );
          return audioTrack;
        }
      } catch (contextError) {
        console.log(
          "[Netplay] Web Audio context capture failed:",
          contextError.message,
        );
      }

      // SECOND: Try to capture audio from browser's audio output (tab audio)
      // Note: This requires user to select the browser tab/window for audio capture
      try {
        console.log(
          "[Netplay] Requesting display audio capture (select browser tab for ROM audio)",
        );
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: false,
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            sampleRate: 44100,
            channelCount: 2,
          },
        });

        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) {
          console.log("[Netplay] Audio captured from display (tab audio)", {
            trackId: audioTrack.id,
            enabled: audioTrack.enabled,
            settings: audioTrack.getSettings(),
          });
          return audioTrack;
        }
      } catch (displayError) {
        console.log(
          "[Netplay] Display audio capture failed:",
          displayError.message,
        );
        if (displayError.name === "NotSupportedError") {
          console.log(
            "[Netplay] Browser does not support audio capture from display/screen sharing",
          );
          console.log(
            "[Netplay] ROM audio capture will require alternative methods",
          );
        } else if (displayError.name === "NotAllowedError") {
          console.log(
            "[Netplay] User denied permission for display audio capture",
          );
        }
      }

      // Try to capture audio from emulator's OpenAL/Web Audio sources
      if (this.emulator?.Module?.AL?.currentCtx) {
        const openALContext = this.emulator.Module.AL.currentCtx;

        console.log(
          "[Netplay] Found OpenAL context, attempting simple audio capture",
          {
            hasSources: !!openALContext.sources,
            sourcesCount: openALContext.sources?.length || 0,
            contextType: openALContext.constructor?.name,
          },
        );

        // Simple approach: try to tap into OpenAL's output
        try {
          // Create our own Web Audio context for capture
          const webAudioContext = new (
            window.AudioContext || window.webkitAudioContext
          )();
          const destination = webAudioContext.createMediaStreamDestination();

          // If OpenAL has sources, try to tap the first active one
          if (openALContext.sources && openALContext.sources.length > 0) {
            let tapped = false;

            for (const source of openALContext.sources) {
              if (source && source.gain && source.gain.connect) {
                try {
                  console.log("[Netplay] Tapping OpenAL source gain node");
                  // Create a gain node at unity gain for our capture chain
                  const captureGain = webAudioContext.createGain();
                  captureGain.gain.value = 1.0;

                  // Try to connect the OpenAL gain node to our capture chain
                  // Note: This may not work if they're in different contexts
                  if (source.gain.context === webAudioContext) {
                    source.gain.connect(captureGain);
                    captureGain.connect(destination);
                    tapped = true;
                    console.log(
                      "[Netplay] Successfully tapped OpenAL gain node for audio capture",
                    );
                    break; // Just tap the first one that works
                  } else {
                    console.log(
                      "[Netplay] OpenAL source in different context - cannot tap directly",
                    );
                  }
                } catch (tapError) {
                  console.log(
                    "[Netplay] Failed to tap OpenAL source:",
                    tapError.message,
                  );
                }
              }
            }

            if (tapped) {
              const audioTrack = destination.stream.getAudioTracks()[0];
              if (audioTrack) {
                console.log("[Netplay] Audio captured from OpenAL gain node", {
                  trackId: audioTrack.id,
                  enabled: audioTrack.enabled,
                });
                return audioTrack;
              }
            }
          }

          // Fallback: create a basic audio track from the destination
          const audioTrack = destination.stream.getAudioTracks()[0];
          if (audioTrack) {
            console.log(
              "[Netplay] Created basic audio capture track from Web Audio destination",
              {
                trackId: audioTrack.id,
                enabled: audioTrack.enabled,
                note: "May be silent if no audio is routed through Web Audio",
              },
            );
            return audioTrack;
          }
        } catch (openALError) {
          console.log(
            "[Netplay] OpenAL audio capture failed:",
            openALError.message,
          );
        }
      } else {
        console.log("[Netplay] Emulator OpenAL context not available");
      }
    } catch (error) {
      console.log(
        "[Netplay] Audio capture setup failed, trying fallback:",
        error,
      );
    }

    // Try alternative: Capture system audio (some browsers support this)
    try {
      console.log("[Netplay] Attempting system audio capture (desktop audio)");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 44100,
          channelCount: 2,
          // Some browsers support system audio via these constraints
          deviceId: "default", // Try default system audio
          // Try to request system audio instead of microphone
          mandatory: {
            chromeMediaSource: "system", // Chrome extension API for system audio
          },
        },
        video: false,
      });

      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        console.log("[Netplay] Audio captured from system audio", {
          trackId: audioTrack.id,
          enabled: audioTrack.enabled,
          note: "This may capture system audio including emulator output",
        });
        return audioTrack;
      }
    } catch (systemError) {
      console.log(
        "[Netplay] System audio capture failed:",
        systemError.message,
      );
    }

    // Fallback: Capture microphone input (user permission required)
    try {
      console.log("[Netplay] Falling back to microphone capture");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 44100,
          channelCount: 2,
        },
        video: false,
      });

      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        console.log("[Netplay] Audio captured from microphone", {
          trackId: audioTrack.id,
          enabled: audioTrack.enabled,
          note: "Microphone audio - not ROM audio, but at least audio pipeline works",
        });
        return audioTrack;
      }
    } catch (micError) {
      console.log(
        "[Netplay] Microphone audio capture failed:",
        micError.message,
      );
    }

    // Test audio pipeline with oscillator (for debugging)
    try {
      console.log(
        "[Netplay] Creating test audio track with oscillator to verify pipeline",
      );
      const audioContext = new (
        window.AudioContext || window.webkitAudioContext
      )();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      const destination = audioContext.createMediaStreamDestination();

      // Very quiet tone to test audio pipeline
      oscillator.frequency.value = 440; // A4 note
      gainNode.gain.value = 0.01; // Very quiet

      oscillator.connect(gainNode);
      gainNode.connect(destination);

      oscillator.start();
      console.log(
        "[Netplay] Started test oscillator (very quiet tone to verify audio pipeline works)",
      );

      const audioTrack = destination.stream.getAudioTracks()[0];
      if (audioTrack) {
        console.log(
          "[Netplay] Test audio track created - if you hear a quiet tone, the audio pipeline works!",
        );
        return audioTrack;
      }
    } catch (oscError) {
      console.log("[Netplay] Test oscillator failed:", oscError.message);
    }

    // Last resort: Create a silent audio track (better than no audio for sync)
    try {
      const audioContext = new (
        window.AudioContext || window.webkitAudioContext
      )();
      const destination = audioContext.createMediaStreamDestination();
      const audioTrack = destination.stream.getAudioTracks()[0];
      if (audioTrack) {
        console.log("[Netplay] Created silent audio track for sync");
        return audioTrack;
      }
    } catch (error) {
      console.warn("[Netplay] Could not create audio track:", error);
    }

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
