/**
 * UsernameManager - Netplay username enforcement
 * 
 * Manages:
 * - Netplay username validation and enforcement
 * - Binds netplayUsername to userId from RoMM token
 * - Prevents duplicate room joins for same account
 * - Enforces unique netplay username in lobbies
 * 
 * TODO: Implement in Phase 4
 */

class UsernameManager {
  constructor() {
    this.usernameToUserId = new Map(); // netplayUsername -> userId
    this.userIdToUsername = new Map(); // userId -> netplayUsername
  }

  /**
   * Bind netplay username to user ID.
   * @param {string} netplayUsername - Netplay username (from RoMM)
   * @param {string} userId - User ID (sub from JWT)
   * @returns {boolean} True if binding successful
   */
  bindUsername(netplayUsername, userId) {
    // Prevent duplicate usernames from different users
    const existingUserId = this.usernameToUserId.get(netplayUsername);
    if (existingUserId && existingUserId !== userId) {
      return false; // Username already taken by different user
    }

    this.usernameToUserId.set(netplayUsername, userId);
    this.userIdToUsername.set(userId, netplayUsername);
    return true;
  }

  /**
   * Get user ID for a netplay username.
   * @param {string} netplayUsername - Netplay username
   * @returns {string|null} User ID or null
   */
  getUserIdForUsername(netplayUsername) {
    return this.usernameToUserId.get(netplayUsername) ?? null;
  }

  /**
   * Get netplay username for a user ID.
   * @param {string} userId - User ID
   * @returns {string|null} Netplay username or null
   */
  getUsernameForUserId(userId) {
    return this.userIdToUsername.get(userId) ?? null;
  }

  /**
   * Check if username is available (not in use by another user).
   * @param {string} netplayUsername - Netplay username to check
   * @param {string} userId - Current user ID (excluded from check)
   * @returns {boolean} True if available
   */
  isUsernameAvailable(netplayUsername, userId) {
    const existingUserId = this.usernameToUserId.get(netplayUsername);
    return !existingUserId || existingUserId === userId;
  }

  /**
   * Remove username binding (on disconnect).
   * @param {string} userId - User ID
   */
  unbindUsername(userId) {
    const username = this.userIdToUsername.get(userId);
    if (username) {
      this.usernameToUserId.delete(username);
      this.userIdToUsername.delete(userId);
    }
  }
}

window.UsernameManager = UsernameManager;
