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
    this.callbacks = config.callbacks || {};
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
    };

    // Update session state
    this.sessionState.setHost(true);
    this.sessionState.setLocalPlayer(
      extra.userid,
      extra.player_name,
      extra.userid
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
          this.sessionState.setRoom(roomName, password, this.config.gameMode || null);
          resolve(sessionid);
        }
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
  async joinRoom(sessionId, roomName, maxPlayers, password = null, playerInfo = {}) {
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
      input_mode:
        this.config.inputMode ||
        (typeof window.EJS_NETPLAY_INPUT_MODE === "string"
          ? window.EJS_NETPLAY_INPUT_MODE
          : null) ||
        "unorderedRelay",
    };

    // Update session state
    this.sessionState.setHost(false);
    this.sessionState.setLocalPlayer(playerId, extra.player_name, playerId);

    return new Promise((resolve, reject) => {
      // Ensure socket is connected
      if (!this.socket.isConnected()) {
        // Wait for connection (if callback is provided)
        if (this.callbacks.onSocketReady) {
          this.callbacks.onSocketReady(() => {
            this.emitJoinRoom(extra, password, resolve, reject);
          });
          return;
        }
        reject(new Error("Socket not connected"));
        return;
      }

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
    this.socket.emit(
      "join-room",
      {
        extra: extra,
        password: password,
      },
      (error, response) => {
        if (error) {
          // Handle auth errors specially
          if (
            error.includes("unauthorized") ||
            error.includes("token") ||
            error.includes("auth")
          ) {
            if (window.handleSfuAuthError) {
              window.handleSfuAuthError();
              // Don't resolve/reject - auth handler will manage retry
              return;
            }
          }

          reject(new Error(error));
          return;
        }

        // Update players list
        if (this.sessionState && response && response.users) {
          Object.entries(response.users || {}).forEach(([playerId, playerData]) => {
            this.sessionState.addPlayer(playerId, playerData);
          });
        }

        // Room joined successfully - return the response with room info
        resolve(response);
      }
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
      this.socket.emit("leave-room", { reason: reason }, () => {
        // Always cleanup, even if server doesn't respond
        this.sessionState.clearRoom();
        this.sessionState.reset();
        resolve();
      });

      // Timeout after 2 seconds
      setTimeout(() => {
        this.sessionState.clearRoom();
        this.sessionState.reset();
        resolve();
      }, 2000);
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
    // Listen for player join/leave events
    this.socket.on("users-updated", (users) => {
      if (this.sessionState) {
        // Clear existing players
        const currentPlayers = this.sessionState.getPlayers();
        currentPlayers.forEach((playerId) => {
          if (!users[playerId]) {
            this.sessionState.removePlayer(playerId);
          }
        });

        // Add/update players
        Object.entries(users || {}).forEach(([playerId, playerData]) => {
          this.sessionState.addPlayer(playerId, playerData);
        });
      }

      if (this.callbacks.onUsersUpdated) {
        this.callbacks.onUsersUpdated(users);
      }
    });

    // Listen for room close event
    this.socket.on("room-closed", (data) => {
      if (this.callbacks.onRoomClosed) {
        this.callbacks.onRoomClosed(data);
      }
    });
  }
}

window.RoomManager = RoomManager;
