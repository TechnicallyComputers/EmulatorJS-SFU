/**
 * SocketTransport - Socket.IO room management
 *
 * Handles:
 * - Socket.IO client connection
 * - Room operations (join/create/leave)
 * - Player events (join/leave)
 * - Room discovery
 * - Data message sending
 */

class SocketTransport {
  /**
   * @param {Object} config - Configuration
   * @param {string} config.url - SFU server URL
   * @param {Object} config.callbacks - Event callbacks
   */
  constructor(config = {}) {
    this.config = config;
    this.socket = null;
    this.connected = false;
    this.callbacks = config.callbacks || {};
    this.pendingListeners = []; // Queue listeners registered before socket connection
  }

  /**
   * Connect to Socket.IO server.
   * @param {string} url - Server URL
   * @param {string|null} token - Authentication token (optional)
   * @returns {Promise<void>}
   */
  async connect(url, token = null) {
    if (typeof io === "undefined") {
      throw new Error(
        "Socket.IO client library not loaded. Please include <script src='https://cdn.socket.io/4.5.0/socket.io.min.js'></script>"
      );
    }

    if (this.socket && this.socket.connected) {
      console.log("[SocketTransport] Already connected, reusing:", this.socket.id);
      return;
    }

    if (!url) {
      throw new Error("Cannot initialize Socket.IO: URL is undefined");
    }

    // Clean up URL (remove trailing slashes)
    while (url.endsWith("/")) {
      url = url.substring(0, url.length - 1);
    }

    console.log("[SocketTransport] Initializing Socket.IO connection to:", url);

    // Create socket connection
    const socketOptions = {};
    if (token) {
      socketOptions.auth = { token };
    }

    this.socket = io(url, socketOptions);

    // Setup connection event handlers
    this.socket.on("connect", () => {
      console.log("[SocketTransport] Socket.IO connected:", this.socket.id);
      this.connected = true;

      // Register any pending listeners
      if (this.pendingListeners.length > 0) {
        console.log("[SocketTransport] Registering", this.pendingListeners.length, "pending listeners");
        this.pendingListeners.forEach(({ event, callback }) => {
          this.socket.on(event, callback);
        });
        this.pendingListeners = []; // Clear queue
      }

      if (this.callbacks.onConnect) {
        this.callbacks.onConnect(this.socket.id);
      }
    });

    this.socket.on("connect_error", (error) => {
      console.error("[SocketTransport] Connection error:", error.message);
      this.connected = false;
      if (this.callbacks.onConnectError) {
        this.callbacks.onConnectError(error);
      }
    });

    this.socket.on("disconnect", (reason) => {
      console.log("[SocketTransport] Disconnected:", reason);
      this.connected = false;
      if (this.callbacks.onDisconnect) {
        this.callbacks.onDisconnect(reason);
      }
    });

    // Wait for connection
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Socket.IO connection timeout"));
      }, 10000);

      this.socket.once("connect", () => {
        clearTimeout(timeout);
        resolve();
      });

      this.socket.once("connect_error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * Disconnect from server.
   */
  async disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
    }
  }

  /**
   * Check if connected.
   * @returns {boolean}
   */
  isConnected() {
    return this.connected && this.socket && this.socket.connected;
  }

  /**
   * Emit an event to the server.
   * @param {string} event - Event name
   * @param {*} data - Event data
   * @param {Function} callback - Optional callback
   */
  emit(event, data = {}, callback = null) {
    if (!this.isConnected()) {
      console.error("[SocketTransport] Cannot emit: Socket not connected");
      return;
    }
    if (callback) {
      this.socket.emit(event, data, callback);
    } else {
      this.socket.emit(event, data);
    }
  }

  /**
   * Send a data message (for input synchronization).
   * @param {Object} data - Message data (e.g., { "sync-control": [...] })
   */
  sendDataMessage(data) {
    this.emit("data-message", data);
    console.log("[SocketTransport] Sent data message:", data);
  }

  /**
   * Register event listener.
   * @param {string} event - Event name
   * @param {Function} callback - Event callback
   */
  on(event, callback) {
    if (!this.socket) {
      // Queue listener for when socket connects
      console.log("[SocketTransport] Queueing listener for", event, "(socket not yet connected)");
      this.pendingListeners.push({ event, callback });
      return;
    }
    this.socket.on(event, callback);
  }

  /**
   * Remove event listener.
   * @param {string} event - Event name
   * @param {Function} callback - Event callback (optional, removes all if not provided)
   */
  off(event, callback = null) {
    if (!this.socket) {
      return;
    }
    if (callback) {
      this.socket.off(event, callback);
    } else {
      this.socket.off(event);
    }
  }

  /**
   * Get socket ID.
   * @returns {string|null}
   */
  getSocketId() {
    return this.socket?.id || null;
  }

  /**
   * Send frame acknowledgment.
   * @param {number} frame - Frame number
   */
  sendFrameAck(frame) {
    this.sendDataMessage({
      frameAck: frame,
    });
  }
}

window.SocketTransport = SocketTransport;
