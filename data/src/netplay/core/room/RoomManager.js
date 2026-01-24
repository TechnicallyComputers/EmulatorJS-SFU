/**
 * RoomManager - Room operations (join/create/leave)
 *
 * Handles:
 * - Room operations via Socket.IO
 * - Room discovery (list rooms)
 * - Room creation and management
 * - Player join/leave handling
 */

class RoomManager {
  /**
   * @param {Object} socketTransport - SocketTransport instance
   * @param {Object} config - Configuration
   * @param {Object} sessionState - SessionState instance
   */
  constructor(socketTransport, config = {}, sessionState) {
    this.socket = socketTransport;
    this.config = config;
    this.sessionState = sessionState;
  }

  /**
   * List available rooms.
   * @returns {Promise<Array>} Array of room objects {id, name, current, max, hasPassword}
   */
  async listRooms() {
    if (!this.socket.isConnected()) {
      throw new Error("Socket not connected");
    }

    return new Promise((resolve, reject) => {
      this.socket.emit("get-open-rooms", {}, (error, rooms) => {
        if (error) {
          reject(new Error(error));
          return;
        }
        resolve(rooms || []);
      });
    });
  }

  /**
   * Create a new room (host).
   * @param {string} roomName - Room name
   * @param {number} maxPlayers - Maximum players
   * @param {string|null} password - Room password (optional)
   * @param {Object} playerInfo - Player information (netplayUsername, userId, etc.)
   * @returns {Promise<string>} Room ID (sessionid)
   */
  async createRoom(roomName, maxPlayers, password = null, playerInfo = {}) {
    if (!this.socket.isConnected()) {
      throw new Error("Socket not connected");
    }

    // Generate session ID
    const sessionid = this.generateSessionId();

    // Prepare player extra data
    const extra = {
      domain: window.location.host,
      game_id: this.config.gameId || null,
      room_name: roomName,
      player_name: playerInfo.netplayUsername || playerInfo.name || "Player",
      player_slot: playerInfo.preferredSlot || 0,
      userid: playerInfo.userId || this.generatePlayerId(),
      sessionid: sessionid,
      input_mode:
        this.config.inputMode ||
        (typeof window.EJS_NETPLAY_INPUT_MODE === "string"
          ? window.EJS_NETPLAY_INPUT_MODE
          : null) ||
        "unorderedRelay",
      // Include netplay_mode and room_phase if provided
      netplay_mode:
        playerInfo.netplay_mode !== undefined ? playerInfo.netplay_mode : 0,
      room_phase:
        playerInfo.room_phase !== undefined ? playerInfo.room_phase : "running",
      sync_config: playerInfo.sync_config || null,
      spectator_mode:
        playerInfo.spectator_mode !== undefined ? playerInfo.spectator_mode : 1,
      // Include ROM and emulator metadata for room creation
      romHash: playerInfo.romHash || null,
      rom_hash: playerInfo.romHash || null, // Backward compatibility
      rom_name: playerInfo.romName || playerInfo.romFilename || null,
      romFilename: playerInfo.romFilename || null,
      system: playerInfo.system || null,
      platform: playerInfo.platform || null,
      coreId: playerInfo.coreId || playerInfo.system || null,
      core_type: playerInfo.coreId || playerInfo.system || null, // Backward compatibility
      coreVersion: playerInfo.coreVersion || null,
      systemType: playerInfo.systemType || playerInfo.system || null,
      metadata: playerInfo.metadata || null,
    };

    // Update session state
    this.sessionState.setHost(true);
    this.sessionState.setLocalPlayer(
      extra.userid,
      extra.player_name,
      extra.userid,
    );

    return new Promise((resolve, reject) => {
      this.socket.emit(
        "open-room",
        {
          extra: extra,
          maxPlayers: maxPlayers,
          password: password,
        },
        (error, result) => {
          if (error) {
            reject(new Error(error));
            return;
          }

          // Room created successfully
          this.sessionState.setRoom(
            roomName,
            password,
            this.config.gameMode || null,
          );
          resolve(sessionid);
        },
      );
    });
  }

  /**
   * Join an existing room (client).
   * @param {string} sessionId - Room session ID
   * @param {string} roomName - Room name
   * @param {number} maxPlayers - Maximum players
   * @param {string|null} password - Room password (if required)
   * @param {Object} playerInfo - Player information
   * @returns {Promise<void>}
   */
  async joinRoom(
    sessionId,
    roomName,
    maxPlayers,
    password = null,
    playerInfo = {},
  ) {
    if (!this.socket.isConnected()) {
      throw new Error("Socket not connected");
    }

    // Prepare player extra data
    const playerId = playerInfo.userId || this.generatePlayerId();
    const preferredSlot =
      playerInfo.preferredSlot ||
      this.config.preferredSlot ||
      (typeof window.EJS_NETPLAY_PREFERRED_SLOT === "number"
        ? window.EJS_NETPLAY_PREFERRED_SLOT
        : null) ||
      0;

    const extra = {
      domain: window.location.host,
      game_id: this.config.gameId || null,
      room_name: roomName,
      player_name: playerInfo.netplayUsername || playerInfo.name || "Player",
      player_slot: preferredSlot,
      userid: playerId,
      sessionid: sessionId,
      netplay_mode: this.config.netplayMode || 0,
      input_mode: this.config.inputMode || "unorderedRelay",

      // ✅ ADD ROM METADATA FOR COMPATIBILITY VALIDATION
      rom_hash: playerInfo.romHash || null,
      rom_name: playerInfo.romName || playerInfo.romFilename || null,
      core_type: playerInfo.core || playerInfo.system || null,
      system: playerInfo.system || null,
      platform: playerInfo.platform || null,
      coreId: playerInfo.coreId || playerInfo.core || null,
      coreVersion: playerInfo.coreVersion || null,
      romHash: playerInfo.romHash || null,
      systemType: playerInfo.systemType || playerInfo.system || null,
    };

    // Update session state (host status will be determined from server response)
    // Don't set host status yet - wait for server response
    this.sessionState.setLocalPlayer(playerId, extra.player_name, playerId);
    this.sessionState.setRoom(roomName, password, this.config.gameMode || null);

    console.log(
      `[RoomManager] joinRoom called: roomName=${roomName}, playerId=${playerId}`,
    );
    console.log(`[RoomManager] Socket connected: ${this.socket.isConnected()}`);

    return new Promise((resolve, reject) => {
      // Ensure socket is connected
      if (!this.socket.isConnected()) {
        console.warn(
          "[RoomManager] Socket not connected, waiting for connection...",
        );
        // Wait for connection (if callback is provided)
        if (this.config.callbacks?.onSocketReady) {
          this.config.callbacks.onSocketReady(() => {
            console.log("[RoomManager] Socket ready, proceeding with join");
            this.emitJoinRoom(extra, password, resolve, reject);
          });
          return;
        }
        console.error(
          "[RoomManager] Socket not connected and no onSocketReady callback",
        );
        reject(new Error("Socket not connected"));
        return;
      }

      console.log("[RoomManager] Socket connected, proceeding with join");
      this.emitJoinRoom(extra, password, resolve, reject);
    });
  }

  /**
   * Emit join-room event.
   * @private
   * @param {Object} extra - Player extra data
   * @param {string|null} password - Room password
   * @param {Function} resolve - Promise resolve
   * @param {Function} reject - Promise reject
   */
  emitJoinRoom(extra, password, resolve, reject) {
    console.log("[RoomManager] Emitting join-room event:", {
      roomName: extra.room_name,
      playerName: extra.player_name,
      playerId: extra.userid,
    });

    this.socket.emit(
      "join-room",
      {
        extra: extra,
        password: password,
      },
      (error, response) => {
        console.log("[RoomManager] join-room callback received:", {
          error,
          responseKeys: response ? Object.keys(response) : null,
        });
        if (error) {
          // Handle auth errors specially
          if (
            typeof error === "string" &&
            (error.includes("unauthorized") ||
              error.includes("token") ||
              error.includes("auth"))
          ) {
            if (window.handleSfuAuthError) {
              window.handleSfuAuthError();
              // Don't resolve/reject - auth handler will manage retry
              return;
            }
          }

          // For structured errors (like compatibility issues), preserve the object
          if (typeof error === "object" && error.error) {
            const structuredError = new Error(error.message || error.error);
            structuredError.details = error; // Preserve the full error object
            reject(structuredError);
          } else {
            // For string errors, convert to Error object
            reject(
              new Error(
                typeof error === "string" ? error : JSON.stringify(error),
              ),
            );
          }
          return;
        }

        // Update players list
        if (this.sessionState && response && response.users) {
          Object.entries(response.users || {}).forEach(
            ([playerId, playerData]) => {
              this.sessionState.addPlayer(playerId, playerData);
            },
          );
        }

        // Check if current player is the host based on server response
        const localPlayerId = extra.userid;
        const localPlayerData = response?.users?.[localPlayerId];
        if (localPlayerData && localPlayerData.is_host === true) {
          console.log(
            `[RoomManager] Player ${localPlayerId} is the room host (from server response)`,
          );
          this.sessionState.setHost(true);
        } else {
          console.log(
            `[RoomManager] Player ${localPlayerId} is not the room host`,
          );
          this.sessionState.setHost(false);
        }

        // Room joined successfully - return the response with room info
        resolve(response);
      },
    );
  }

  /**
   * Leave current room.
   * @param {string|null} reason - Leave reason (optional)
   * @returns {Promise<void>}
   */
  async leaveRoom(reason = null) {
    if (!this.socket.isConnected()) {
      // Socket already disconnected, just cleanup
      this.sessionState.clearRoom();
      this.sessionState.reset();
      return;
    }

    return new Promise((resolve) => {
      this.socket.emit(
        "leave-room",
        {
          roomName: this.sessionState.roomName,
          reason: reason,
        },
        () => {
          // Always cleanup, even if server doesn't respond
          this.sessionState.clearRoom();
          this.sessionState.reset();
          resolve();
        },
      );

      // Timeout after 2 seconds
      setTimeout(() => {
        this.sessionState.clearRoom();
        this.sessionState.reset();
        resolve();
      }, 2000);
    });
  }

  /**
   * DELAY_SYNC: Toggle ready state
   * @param {string} roomName - Room name
   * @returns {Promise}
   */
  async toggleReady(roomName) {
    console.log("[RoomManager] toggleReady called for room:", roomName);

    if (!this.socket.isConnected()) {
      console.error("[RoomManager] Socket not connected for ready toggle");
      throw new Error("Socket not connected");
    }

    return new Promise((resolve, reject) => {
      this.socket.emit(
        "toggle-ready",
        {
          roomName: roomName,
        },
        (error) => {
          if (error) {
            reject(new Error(error));
            return;
          }
          resolve();
        },
      );
    });
  }

  /**
   * DELAY_SYNC: Start game (host only)
   * @param {string} roomName - Room name
   * @returns {Promise}
   */
  async startGame(roomName) {
    console.log("[RoomManager] startGame called for room:", roomName);

    if (!this.socket.isConnected()) {
      console.error("[RoomManager] Socket not connected for game start");
      throw new Error("Socket not connected");
    }

    return new Promise((resolve, reject) => {
      this.socket.emit(
        "start-game",
        {
          roomName: roomName,
        },
        (error) => {
          if (error) {
            reject(new Error(error));
            return;
          }
          resolve();
        },
      );
    });
  }

  /**
   * DELAY_SYNC: Send ready at frame 1
   * @param {string} roomName - Room name
   * @param {number} frame - Frame number
   * @returns {Promise}
   */
  async sendReadyAtFrame1(roomName, frame) {
    console.log("[RoomManager] sendReadyAtFrame1 called:", { roomName, frame });

    if (!this.socket.isConnected()) {
      console.error("[RoomManager] Socket not connected for ready-at-frame-1");
      throw new Error("Socket not connected");
    }

    return new Promise((resolve, reject) => {
      this.socket.emit(
        "ready-at-frame-1",
        {
          roomName: roomName,
          frame: frame,
        },
        (error) => {
          if (error) {
            reject(new Error(error));
            return;
          }
          resolve();
        },
      );
    });
  }

  /**
   * Update room metadata
   * @param {string} roomName - Room name
   * @param {Object} metadata - Metadata to update
   * @returns {Promise}
   */
  async updateRoomMetadata(roomName, metadata) {
    console.log("[RoomManager] updateRoomMetadata called:", {
      roomName,
      metadata,
    });

    if (!this.socket.isConnected()) {
      console.error("[RoomManager] Socket not connected for metadata update");
      throw new Error("Socket not connected");
    }

    return new Promise((resolve, reject) => {
      this.socket.emit(
        "update-room-metadata",
        {
          roomName: roomName,
          metadata: metadata,
        },
        (error) => {
          if (error) {
            reject(new Error(error));
            return;
          }
          resolve();
        },
      );
    });
  }

  /**
   * Update player metadata
   * @param {string} roomName - Room name
   * @param {Object} metadata - Metadata to update
   * @returns {Promise}
   */
  async updatePlayerMetadata(roomName, metadata) {
    console.log("[RoomManager] updatePlayerMetadata called:", {
      roomName,
      metadata,
    });

    if (!this.socket.isConnected()) {
      console.error(
        "[RoomManager] Socket not connected for player metadata update",
      );
      throw new Error("Socket not connected");
    }

    return new Promise((resolve, reject) => {
      this.socket.emit(
        "update-player-metadata",
        {
          roomName: roomName,
          metadata: metadata,
        },
        (error) => {
          if (error) {
            reject(new Error(error));
            return;
          }
          resolve();
        },
      );
    });
  }

  /**
   * Send JOIN_INFO with validation data (DELAY_SYNC only)
   * @param {string} roomName - Room name
   * @param {Object} joinInfo - Join validation info
   * @returns {Promise}
   */
  async sendJoinInfo(roomName, joinInfo) {
    console.log("[RoomManager] sendJoinInfo called:", { roomName, joinInfo });

    if (!this.socket.isConnected()) {
      console.error("[RoomManager] Socket not connected for join info");
      throw new Error("Socket not connected");
    }

    return new Promise((resolve, reject) => {
      this.socket.emit(
        "join-info",
        {
          roomName: roomName,
          ...joinInfo,
        },
        (error) => {
          if (error) {
            reject(new Error(error));
            return;
          }
          resolve();
        },
      );
    });
  }

  /**
   * Generate a session ID (GUID).
   * @private
   * @returns {string}
   */
  generateSessionId() {
    return this.generateGuid();
  }

  /**
   * Generate a player ID (GUID).
   * @private
   * @returns {string}
   */
  generatePlayerId() {
    return this.generateGuid();
  }

  /**
   * Update player slot.
   * @param {number} slot - New slot number (0-3)
   * @returns {Promise<void>}
   */
  async updatePlayerSlot(slot) {
    console.log("[RoomManager] updatePlayerSlot called with slot:", slot);

    if (!this.socket.isConnected()) {
      console.error("[RoomManager] Socket not connected for slot update");
      throw new Error("Socket not connected");
    }

    const roomName = this.sessionState?.roomName;
    if (!roomName) {
      console.error("[RoomManager] Not in a room for slot update");
      throw new Error("Not in a room");
    }

    console.log("[RoomManager] Sending update-player-slot message:", {
      roomName,
      playerSlot: slot,
    });

    return new Promise((resolve, reject) => {
      this.socket.emit(
        "update-player-slot",
        {
          roomName: roomName,
          playerSlot: slot,
        },
        (error) => {
          if (error) {
            reject(new Error(error));
            return;
          }
          resolve();
        },
      );
    });
  }

  /**
   * Generate a GUID.
   * @private
   * @returns {string}
   */
  generateGuid() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Setup Socket.IO event listeners for room events.
   */
  setupEventListeners() {
    console.log(
      `[RoomManager] Setting up event listeners, isRoomListing=${this.config.isRoomListing}`,
    );

    // Listen for player join/leave events
    this.socket.on("users-updated", (users) => {
      console.log(
        "[RoomManager] 🔔 RECEIVED users-updated event:",
        Object.keys(users || {}),
      );

      if (this.sessionState) {
        // Clear existing players
        const currentPlayers = this.sessionState.getPlayers();
        console.log(
          "[RoomManager] Current players before update:",
          Array.from(currentPlayers.keys()),
        );

        // Remove players that are no longer in the room
        for (const [playerId, playerData] of currentPlayers) {
          if (!users[playerId]) {
            console.log(`[RoomManager] Removing player: ${playerId}`);
            this.sessionState.removePlayer(playerId);
          }
        }

        // Add/update players
        Object.entries(users || {}).forEach(([playerId, playerData]) => {
          console.log(
            `[RoomManager] Adding/updating player: ${playerId}`,
            playerData,
          );
          this.sessionState.addPlayer(playerId, playerData);
        });

        console.log(
          "[RoomManager] Players after update:",
          Array.from(this.sessionState.getPlayers().keys()),
        );
      }

      if (this.config.callbacks?.onUsersUpdated) {
        console.log("[RoomManager] Calling onUsersUpdated callback");
        this.config.callbacks.onUsersUpdated(users);
      } else {
        console.log(
          "[RoomManager] No onUsersUpdated callback available, skipping UI update",
        );
      }
    });

    // Listen for player slot updates
    this.socket.on("player-slot-updated", (data) => {
      console.log("[RoomManager] Received player-slot-updated:", data);
      console.log(
        "[RoomManager] Current session state players:",
        Array.from(this.sessionState?.getPlayers()?.keys() || []),
      );
      if (data && data.playerId && data.playerSlot !== undefined) {
        // Update session state
        if (this.sessionState) {
          const players = this.sessionState.getPlayers();

          // Find player by name since server sends player name but session state uses UUIDs as keys
          let playerId = data.playerId;
          let player = players.get(playerId);

          // If direct lookup fails, search by player name
          if (!player) {
            for (const [id, playerData] of players) {
              if (
                playerData.name === data.playerId ||
                playerData.player_name === data.playerId
              ) {
                playerId = id;
                player = playerData;
                break;
              }
            }
          }

          if (player) {
            player.player_slot = data.playerSlot;
            player.slot = data.playerSlot;
            // Update the player in the session state
            this.sessionState.addPlayer(playerId, player);
            console.log(
              "[RoomManager] Updated session state for player:",
              playerId,
              "slot:",
              data.playerSlot,
            );
          } else {
            console.warn(
              "[RoomManager] Could not find player in session state:",
              data.playerId,
            );
          }
        }

        // Trigger targeted slot update
        if (this.config.callbacks?.onPlayerSlotUpdated) {
          this.config.callbacks.onPlayerSlotUpdated(
            data.playerId,
            data.playerSlot,
          );
        } else if (this.config.callbacks?.onUsersUpdated) {
          // Fallback to full update if targeted update not available
          const currentUsers = this.sessionState?.getPlayersObject() || {};
          this.config.callbacks.onUsersUpdated(currentUsers);
        }
      }
    });

    // Listen for room close event
    this.socket.on("room-closed", (data) => {
      if (this.config.callbacks?.onRoomClosed) {
        this.config.callbacks.onRoomClosed(data);
      }
    });

    // DELAY_SYNC: Listen for ready state updates
    this.socket.on("player-ready-updated", (data) => {
      console.log("[RoomManager] Received player-ready-updated:", data);
      if (data && data.playerId && data.ready !== undefined) {
        // Update session state
        if (this.sessionState) {
          const players = this.sessionState.getPlayers();
          const player = players.get(data.playerId);
          if (player) {
            player.ready = data.ready;
            console.log(
              `[RoomManager] Updated ready state for ${data.playerId}: ${data.ready}`,
            );
          }
        }

        // Trigger callback
        if (this.config.callbacks?.onPlayerReadyUpdated) {
          this.config.callbacks.onPlayerReadyUpdated(data.playerId, data.ready);
        }
      }
    });

    // DELAY_SYNC: Listen for prepare start
    this.socket.on("prepare-start", (data) => {
      console.log("[RoomManager] Received prepare-start:", data);
      if (this.config.callbacks?.onPrepareStart) {
        this.config.callbacks.onPrepareStart(data);
      }
    });

    // DELAY_SYNC: Listen for validation status updates
    this.socket.on("player-validation-updated", (data) => {
      console.log("[RoomManager] Received player-validation-updated:", data);
      if (data && data.playerId && data.validationStatus !== undefined) {
        // Update session state
        if (this.sessionState) {
          const players = this.sessionState.getPlayers();
          const player = players.get(data.playerId);
          if (player) {
            player.validationStatus = data.validationStatus;
            player.validationReason = data.validationReason;
            console.log(
              `[RoomManager] Updated validation for ${data.playerId}: ${data.validationStatus}`,
            );
          }
        }

        // Trigger callback
        if (this.config.callbacks?.onPlayerValidationUpdated) {
          this.config.callbacks.onPlayerValidationUpdated(
            data.playerId,
            data.validationStatus,
            data.validationReason,
          );
        }
      }
    });

    // DELAY_SYNC: Listen for synchronized game start
    this.socket.on("start-game", (data) => {
      console.log("[RoomManager] Received start-game:", data);
      if (this.config.callbacks?.onGameStart) {
        this.config.callbacks.onGameStart(data);
      }
    });
  }
}

window.RoomManager = RoomManager;
