/**
 * SFUTransport - SFU WebRTC client (mediasoup)
 *
 * Handles:
 * - mediasoup-client integration
 * - WebRTC transport management
 * - Producer/consumer lifecycle
 * - Codec negotiation (VP9 SVC, H264, VP8)
 * - ICE restart on connection failures
 */

class SFUTransport {
  /**
   * @param {Object} config - Configuration
   * @param {Object} socketTransport - SocketTransport instance
   */
  constructor(config = {}, socketTransport) {
    this.config = config;
    this.socket = socketTransport;
    this.device = null;
    this.mediasoupClient = null;
    this.routerRtpCapabilities = null;
    this.useSFU = false;

    // Transports
    this.sendTransport = null;
    this.recvTransport = null;

    // Producers (host only)
    this.videoProducer = null;
    this.audioProducer = null;
    this.dataProducer = null;

    // Consumers (clients only) - Map: producerId -> Consumer
    this.consumers = new Map();

    // ICE restart tracking
    this.iceRestartTimers = new Map();
  }

  /**
   * Initialize SFU connection (check availability, load device).
   * @returns {Promise<boolean>} True if SFU is available and initialized
   */
  async initialize() {
    if (this.useSFU !== undefined) {
      return this.useSFU;
    }

    if (!this.socket || !this.socket.isConnected()) {
      console.warn("[SFUTransport] Cannot initialize: Socket not connected");
      this.useSFU = false;
      return false;
    }

    try {
      // Check if SFU is available
      const available = await new Promise((resolve) => {
        this.socket.emit("sfu-available", {}, (resp) =>
          resolve(resp && resp.available)
        );
      });

      if (!available) {
        this.useSFU = false;
        return false;
      }

      // Get mediasoup client from window (must be loaded separately)
      this.mediasoupClient =
        window.mediasoupClient || window.mediasoup || null;
      if (!this.mediasoupClient) {
        console.warn(
          "[SFUTransport] mediasoup-client not available in browser; SFU disabled."
        );
        this.useSFU = false;
        return false;
      }

      // Create device
      this.device = new this.mediasoupClient.Device();

      // Request router RTP capabilities
      this.routerRtpCapabilities = await new Promise((resolve, reject) => {
        this.socket.emit(
          "sfu-get-router-rtp-capabilities",
          {},
          (err, data) => {
            if (err) return reject(err);
            resolve(data);
          }
        );
      });

      // Load device with router capabilities
      await this.device.load({ routerRtpCapabilities: this.routerRtpCapabilities });

      this.useSFU = true;
      console.log("[SFUTransport] SFU available and mediasoup-client initialized");
      return true;
    } catch (err) {
      console.warn("[SFUTransport] SFU initialization failed:", err);
      this.useSFU = false;
      return false;
    }
  }

  /**
   * Pick video codec based on configuration and router capabilities.
   * @returns {Object|null} Selected codec or null
   */
  pickVideoCodec() {
    try {
      const normalizeHostCodec = (v) => {
        const s = typeof v === "string" ? v.trim().toLowerCase() : "";
        if (s === "vp9" || s === "h264" || s === "vp8" || s === "auto")
          return s;
        return "auto";
      };

      const mode =
        normalizeHostCodec(
          this.config.hostCodec ||
            (typeof window.EJS_NETPLAY_HOST_CODEC === "string"
              ? window.EJS_NETPLAY_HOST_CODEC
              : null) ||
            "auto"
        );

      const routerCaps = this.routerRtpCapabilities || null;
      const routerCodecs =
        routerCaps && Array.isArray(routerCaps.codecs)
          ? routerCaps.codecs
          : [];

      // Filter video codecs (excluding RTX)
      const candidates = routerCodecs.filter((c) => {
        const mt = c && typeof c.mimeType === "string" ? c.mimeType : "";
        const mtl = mt.toLowerCase();
        if (!mtl.startsWith("video/")) return false;
        if (mtl === "video/rtx") return false;
        return mtl === "video/vp9" || mtl === "video/h264" || mtl === "video/vp8";
      });

      // Check browser support
      const caps =
        typeof RTCRtpSender !== "undefined" &&
        RTCRtpSender.getCapabilities &&
        RTCRtpSender.getCapabilities("video")
          ? RTCRtpSender.getCapabilities("video").codecs || []
          : [];
      const supports = (mimeLower) =>
        caps.some(
          (cc) =>
            cc &&
            typeof cc.mimeType === "string" &&
            cc.mimeType.toLowerCase() === mimeLower
        );

      // If mode is forced, try that first
      const wantMime =
        mode === "vp9"
          ? "video/vp9"
          : mode === "h264"
          ? "video/h264"
          : mode === "vp8"
          ? "video/vp8"
          : null;

      if (wantMime) {
        const forced = candidates.find(
          (c) => c && c.mimeType && c.mimeType.toLowerCase() === wantMime
        );
        if (forced && supports(wantMime)) return forced;
      }

      // Otherwise, pick first supported codec in router order
      for (const c of candidates) {
        const mt = c && typeof c.mimeType === "string" ? c.mimeType : "";
        const mtl = mt.toLowerCase();
        if (supports(mtl)) return c;
      }
    } catch (e) {
      console.error("[SFUTransport] Error picking video codec:", e);
    }
    return null;
  }

  /**
   * Create SFU transports (send for host, recv for clients).
   * @param {boolean} isHost - True if host role
   * @returns {Promise<void>}
   */
  async createTransports(isHost) {
    if (!this.useSFU || !this.device || !this.socket.isConnected()) {
      console.warn("[SFUTransport] Cannot create transports: Not ready");
      return;
    }

    const role = isHost ? "send" : "recv";

    // Wait for readiness
    const ready = await this.waitFor(
      () =>
        this.useSFU &&
        this.device &&
        this.socket.isConnected(),
      5000,
      200
    );

    if (!ready) {
      console.warn("[SFUTransport] Not ready for transport creation");
      return;
    }

    try {
      const transportInfo = await new Promise((resolve, reject) => {
        this.socket.emit(
          "sfu-create-transport",
          { direction: role },
          (err, info) => {
            if (err) return reject(err);
            resolve(info);
          }
        );
      });

      if (isHost) {
        // Create send transport (host)
        this.sendTransport = this.device.createSendTransport(transportInfo);

        // Setup connection state handlers (ICE restart on failure)
        this.setupTransportEventHandlers(
          this.sendTransport,
          transportInfo.id,
          "send"
        );

        console.log("[SFUTransport] Created sendTransport:", {
          id: transportInfo.id,
        });
      } else {
        // Create recv transport (client)
        this.recvTransport = this.device.createRecvTransport(transportInfo);

        this.setupTransportEventHandlers(
          this.recvTransport,
          transportInfo.id,
          "recv"
        );

        console.log("[SFUTransport] Created recvTransport:", {
          id: transportInfo.id,
        });
      }
    } catch (error) {
      console.error("[SFUTransport] Failed to create transport:", error);
      throw error;
    }
  }

  /**
   * Setup transport event handlers (connect, produce, connection state).
   * @private
   * @param {Object} transport - mediasoup Transport
   * @param {string} transportId - Transport ID
   * @param {string} direction - "send" or "recv"
   */
  setupTransportEventHandlers(transport, transportId, direction) {
    // Connect handler
    transport.on("connect", ({ dtlsParameters }, callback, errback) => {
      this.socket.emit(
        "sfu-connect-transport",
        { transportId, dtlsParameters },
        (err) => {
          if (err) return errback(err);
          callback();
        }
      );
    });

    // Produce handler (send transport only)
    if (direction === "send") {
      transport.on(
        "produce",
        async ({ kind, rtpParameters }, callback, errback) => {
          this.socket.emit(
            "sfu-produce",
            { transportId, kind, rtpParameters },
            (err, id) => {
              if (err) return errback(err);
              callback({ id });
            }
          );
        }
      );
    }

    // Connection state change handler (ICE restart on failure/disconnect)
    transport.on("connectionstatechange", (state) => {
      if (state === "failed") {
        this.clearIceRestartTimer(transport);
        this.requestIceRestart(transport, transportId);
      } else if (state === "disconnected") {
        this.scheduleIceRestart(transport, transportId);
      } else {
        this.clearIceRestartTimer(transport);
      }
    });
  }

  /**
   * Request ICE restart from SFU server.
   * @private
   * @param {Object} transport - Transport object
   * @param {string} transportId - Transport ID
   * @returns {Promise<boolean>} True if restart succeeded
   */
  async requestIceRestart(transport, transportId) {
    try {
      if (!transport || !transportId || transport.closed) return false;
      if (!this.socket.isConnected()) return false;

      // Prevent duplicate restarts
      const now = Date.now();
      if (transport._ejsIceRestartInProgress) return false;
      if (
        transport._ejsLastIceRestartAt &&
        now - transport._ejsLastIceRestartAt < 3000
      ) {
        return false;
      }

      transport._ejsIceRestartInProgress = true;
      transport._ejsLastIceRestartAt = now;

      console.warn("[SFUTransport] Requesting ICE restart", {
        transportId,
        direction: transport.direction,
        connectionState: transport.connectionState,
      });

      const resp = await new Promise((resolve, reject) => {
        this.socket.emit("sfu-restart-ice", { transportId }, (err, data) => {
          if (err) return reject(err);
          resolve(data);
        });
      });

      const iceParameters = resp && resp.iceParameters;
      if (!iceParameters) throw new Error("missing iceParameters");
      if (typeof transport.restartIce !== "function") {
        throw new Error("transport.restartIce not available");
      }

      await transport.restartIce({ iceParameters });
      console.warn("[SFUTransport] ICE restart completed", { transportId });

      return true;
    } catch (e) {
      console.warn("[SFUTransport] ICE restart failed", e);
      return false;
    } finally {
      try {
        transport._ejsIceRestartInProgress = false;
      } catch (e) {}
    }
  }

  /**
   * Schedule ICE restart for disconnected transport.
   * @private
   * @param {Object} transport - Transport object
   * @param {string} transportId - Transport ID
   */
  scheduleIceRestart(transport, transportId) {
    try {
      if (!transport || !transportId || transport.closed) return;
      if (transport._ejsIceRestartInProgress) return;
      if (transport._ejsDisconnectedRetryTimerId) return;

      const retrySeconds = this.getRetryTimerSeconds();
      if (!retrySeconds) return;

      transport._ejsDisconnectedRetryTimerSeconds = retrySeconds;
      transport._ejsDisconnectedRetryTimerId = setTimeout(() => {
        try {
          transport._ejsDisconnectedRetryTimerId = null;
          if (transport.closed) return;
          if (transport.connectionState !== "disconnected") return;
          this.requestIceRestart(transport, transportId);
        } catch (e) {}
      }, retrySeconds * 1000);
    } catch (e) {}
  }

  /**
   * Clear ICE restart timer.
   * @private
   * @param {Object} transport - Transport object
   */
  clearIceRestartTimer(transport) {
    try {
      if (transport && transport._ejsDisconnectedRetryTimerId) {
        clearTimeout(transport._ejsDisconnectedRetryTimerId);
        transport._ejsDisconnectedRetryTimerId = null;
      }
    } catch (e) {}
  }

  /**
   * Get retry timer seconds from config.
   * @private
   * @returns {number} Seconds (0-5)
   */
  getRetryTimerSeconds() {
    let secs =
      typeof this.config.retryConnectionTimerSeconds === "number"
        ? this.config.retryConnectionTimerSeconds
        : parseInt(
            typeof window.EJS_NETPLAY_RETRY_CONNECTION_TIMER === "number"
              ? window.EJS_NETPLAY_RETRY_CONNECTION_TIMER
              : window.EJS_NETPLAY_RETRY_CONNECTION_TIMER || "3",
            10
          );
    if (isNaN(secs)) secs = 3;
    if (secs < 0) secs = 0;
    if (secs > 5) secs = 5;
    return secs;
  }

  /**
   * Wait for condition with timeout.
   * @private
   * @param {Function} condFn - Condition function
   * @param {number} timeout - Timeout in ms
   * @param {number} interval - Poll interval in ms
   * @returns {Promise<boolean>}
   */
  async waitFor(condFn, timeout = 5000, interval = 200) {
    const t0 = Date.now();
    while (!condFn() && Date.now() - t0 < timeout) {
      await new Promise((r) => setTimeout(r, interval));
    }
    return condFn();
  }

  /**
   * Check if SFU is available and initialized.
   * @returns {boolean}
   */
  isAvailable() {
    return this.useSFU === true;
  }

  /**
   * Cleanup all transports and resources.
   */
  async cleanup() {
    // Close producers
    if (this.videoProducer) {
      try {
        this.videoProducer.close();
      } catch (e) {}
      this.videoProducer = null;
    }
    if (this.audioProducer) {
      try {
        this.audioProducer.close();
      } catch (e) {}
      this.audioProducer = null;
    }
    if (this.dataProducer) {
      try {
        this.dataProducer.close();
      } catch (e) {}
      this.dataProducer = null;
    }

    // Close consumers
    this.consumers.forEach((consumer) => {
      try {
        consumer.close();
      } catch (e) {}
    });
    this.consumers.clear();

    // Close transports
    if (this.sendTransport) {
      try {
        this.sendTransport.close();
      } catch (e) {}
      this.sendTransport = null;
    }
    if (this.recvTransport) {
      try {
        this.recvTransport.close();
      } catch (e) {}
      this.recvTransport = null;
    }

    this.device = null;
    this.useSFU = false;
  }
}

window.SFUTransport = SFUTransport;
