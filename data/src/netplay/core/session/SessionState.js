/**
 * SessionState - Session state management
 * 
 * Tracks:
 * - Current session state (connected, disconnected, joining, etc.)
 * - Player list with netplay usernames
 * - Host/client role tracking
 * - Game mode state
 * - Spectator management
 */

class SessionState {
  constructor() {
    // Session state
    this.state = "disconnected"; // disconnected, connecting, connected, joining, joined
    
    // Role
    this.isHost = false;
    this.isSpectator = false;
    
    // Players and spectators
    this.players = new Map(); // playerId -> { netplayUsername, playerIndex, ... }
    this.spectators = new Map(); // playerId -> { netplayUsername, ... }
    
    // Current room info
    this.roomName = null;
    this.roomPassword = null;
    this.gameMode = null;
    
    // Local player info
    this.localPlayerId = null;
    this.localNetplayUsername = null;
    this.localUserId = null;
  }

  /**
   * Set session state.
   * @param {string} state - New state
   */
  setState(state) {
    this.state = state;
  }

  /**
   * Get current session state.
   * @returns {string}
   */
  getState() {
    return this.state;
  }

  /**
   * Set host/client role.
   * @param {boolean} isHost - True if host
   */
  setHost(isHost) {
    this.isHost = isHost;
  }

  /**
   * Check if current user is host.
   * @returns {boolean}
   */
  isHostRole() {
    return this.isHost;
  }

  /**
   * Set spectator mode.
   * @param {boolean} isSpectator - True if spectator
   */
  setSpectator(isSpectator) {
    this.isSpectator = isSpectator;
  }

  /**
   * Check if current user is spectator.
   * @returns {boolean}
   */
  isSpectatorRole() {
    return this.isSpectator;
  }

  /**
   * Add a player to the session.
   * @param {string} playerId - Player ID (netplay username)
   * @param {Object} playerInfo - Player information
   */
  addPlayer(playerId, playerInfo) {
    this.players.set(playerId, playerInfo);
  }

  /**
   * Remove a player from the session.
   * @param {string} playerId - Player ID
   */
  removePlayer(playerId) {
    this.players.delete(playerId);
  }

  /**
   * Get all players.
   * @returns {Map<string, Object>} Player map
   */
  getPlayers() {
    return new Map(this.players);
  }

  /**
   * Get players as an object (for backward compatibility).
   * @returns {Object} Object mapping playerId -> playerInfo
   */
  getPlayersObject() {
    const obj = {};
    this.players.forEach((info, playerId) => {
      obj[playerId] = info;
    });
    return obj;
  }

  /**
   * Add a spectator to the session.
   * @param {string} spectatorId - Spectator ID
   * @param {Object} spectatorInfo - Spectator information
   */
  addSpectator(spectatorId, spectatorInfo) {
    this.spectators.set(spectatorId, spectatorInfo);
  }

  /**
   * Remove a spectator from the session.
   * @param {string} spectatorId - Spectator ID
   */
  removeSpectator(spectatorId) {
    this.spectators.delete(spectatorId);
  }

  /**
   * Get all spectators.
   * @returns {Map<string, Object>} Spectator map
   */
  getSpectators() {
    return new Map(this.spectators);
  }

  /**
   * Set current room information.
   * @param {string} roomName - Room name
   * @param {string|null} roomPassword - Room password (if any)
   * @param {string|null} gameMode - Game mode ID
   */
  setRoom(roomName, roomPassword = null, gameMode = null) {
    this.roomName = roomName;
    this.roomPassword = roomPassword;
    this.gameMode = gameMode;
  }

  /**
   * Clear current room information.
   */
  clearRoom() {
    this.roomName = null;
    this.roomPassword = null;
    this.gameMode = null;
    this.players.clear();
    this.spectators.clear();
  }

  /**
   * Set local player information.
   * @param {string} playerId - Local player ID
   * @param {string} netplayUsername - Netplay username
   * @param {string} userId - RoMM user ID
   */
  setLocalPlayer(playerId, netplayUsername, userId) {
    this.localPlayerId = playerId;
    this.localNetplayUsername = netplayUsername;
    this.localUserId = userId;
  }

  /**
   * Reset session state to initial state.
   */
  reset() {
    this.state = "disconnected";
    this.isHost = false;
    this.isSpectator = false;
    this.clearRoom();
    this.localPlayerId = null;
    this.localNetplayUsername = null;
    this.localUserId = null;
  }
}

window.SessionState = SessionState;
