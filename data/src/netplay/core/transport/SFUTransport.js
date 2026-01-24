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
   * @param {Object} dataChannelManager - DataChannelManager instance
   */
  constructor(config = {}, socketTransport, dataChannelManager = null) {
    this.config = config;
    this.socket = socketTransport;
    this.dataChannelManager = dataChannelManager;
    this.device = null;
    this.mediasoupClient = null;
    this.routerRtpCapabilities = null;
    this.useSFU = false;

    // SFU state - undefined means not initialized yet
    this.useSFU = undefined;

    // Transports - separate for each media type
    this.videoSendTransport = null;
    this.audioSendTransport = null;
    this.dataSendTransport = null;
    this.recvTransport = null; // Single receive transport for all consumers

    // Producers (host only)
    this.videoProducer = null;
    this.audioProducer = null;
    this.dataProducer = null;

    // Consumers (clients only) - Map: producerId -> Consumer
    this.consumers = new Map();

    // ICE restart tracking
    this.iceRestartTimers = new Map();

    // Drift monitoring (optional, soft monitoring only - no restarts)
    this.driftMonitoringEnabled = config.enableDriftMonitoring !== false; // Default enabled
    this.driftMonitoringInterval = null;
    this.driftThresholds = {
      audioJitterMs: 100, // Warn if audio jitter buffer exceeds 100ms
      packetLossPercent: 5, // Warn if packet loss exceeds 5%
      rttDriftMs: 200, // Warn if RTT drift exceeds 200ms
    };
  }

  /**
   * Set the DataChannelManager instance.
   * @param {Object} dataChannelManager - DataChannelManager instance
   */
  setDataChannelManager(dataChannelManager) {
    this.dataChannelManager = dataChannelManager;
  }

  /**
   * Initialize SFU connection (check availability, load device).
   * @returns {Promise<boolean>} True if SFU is available and initialized
   */
  async initialize() {
    console.log("[SFUTransport] initialize() called, useSFU:", this.useSFU);
    console.log("[SFUTransport] Checking socket connection...");
    if (!this.socket || !this.socket.isConnected()) {
      console.warn("[SFUTransport] Cannot initialize: Socket not connected");
      this.useSFU = false;
      return false;
    }
    console.log(
      "[SFUTransport] Socket is connected, proceeding with SFU initialization",
    );

    try {
      // Check if SFU is available
      console.log("[SFUTransport] Checking SFU availability...");
      const available = await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          console.warn("[SFUTransport] SFU availability check timed out");
          resolve(false);
        }, 5000); // 5 second timeout

        this.socket.emit("sfu-available", {}, (resp) => {
          clearTimeout(timeout);
          console.log("[SFUTransport] SFU availability response:", resp);
          resolve(resp && resp.available);
        });
      });

      if (!available) {
        console.warn("[SFUTransport] SFU server reports not available");
        this.useSFU = false;
        return false;
      }
      console.log("[SFUTransport] SFU server reports available");

      // Get mediasoup client from window or global scope (must be loaded separately)
      console.log("[SFUTransport] Checking for mediasoup-client...");
      console.log(
        "[SFUTransport] window.mediasoupClient:",
        typeof window.mediasoupClient,
      );
      console.log("[SFUTransport] window.mediasoup:", typeof window.mediasoup);
      console.log(
        "[SFUTransport] global mediasoupClient:",
        typeof mediasoupClient,
      );

      this.mediasoupClient =
        window.mediasoupClient ||
        window.mediasoup ||
        (typeof mediasoupClient !== "undefined" ? mediasoupClient : null);

      if (!this.mediasoupClient) {
        console.warn(
          "[SFUTransport] mediasoup-client not available in browser; SFU disabled.",
        );
        this.useSFU = false;
        return false;
      }
      console.log(
        "[SFUTransport] Found mediasoup-client:",
        typeof this.mediasoupClient,
      );

      // Create device
      this.device = new this.mediasoupClient.Device();

      // Request router RTP capabilities
      this.routerRtpCapabilities = await new Promise((resolve, reject) => {
        this.socket.emit("sfu-get-router-rtp-capabilities", {}, (err, data) => {
          if (err) return reject(err);
          resolve(data);
        });
      });

      // Load device with router capabilities
      await this.device.load({
        routerRtpCapabilities: this.routerRtpCapabilities,
      });

      this.useSFU = true;
      console.log(
        "[SFUTransport] SFU available and mediasoup-client initialized",
      );
      return true;
    } catch (err) {
      console.error("[SFUTransport] SFU initialization failed:", err);
      console.error("[SFUTransport] Error stack:", err.stack);
      this.useSFU = false;
      return false;
    }
  }

  /**
   * Fetch ICE servers from the SFU server.
   * @returns {Promise<Array>} Array of ICE server configurations
   */
  async getIceServers() {
    console.log("[SFUTransport] Fetching ICE servers from SFU...");

    if (!this.socket || !this.socket.isConnected()) {
      console.warn(
        "[SFUTransport] Cannot fetch ICE servers: Socket not connected",
      );
      return [];
    }

    try {
      // Get the SFU base URL from the socket
      const sfuUrl = this.socket?.serverUrl;
      if (!sfuUrl) {
        console.warn(
          "[SFUTransport] Cannot fetch ICE servers: No SFU URL available",
        );
        return [];
      }

      // Extract the base URL (remove /socket.io/...)
      const baseUrl = sfuUrl.replace(/\/socket\.io.*$/, "");

      // Get auth token for the request
      const token = this.socket?.authToken;
      if (!token) {
        console.warn(
          "[SFUTransport] Cannot fetch ICE servers: No auth token available",
        );
        return [];
      }

      const iceEndpoint = `${baseUrl}/ice`;

      console.log(`[SFUTransport] Fetching ICE servers from: ${iceEndpoint}`);

      const response = await fetch(iceEndpoint, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        console.warn(
          `[SFUTransport] ICE server fetch failed: ${response.status} ${response.statusText}`,
        );
        return [];
      }

      const data = await response.json();
      console.log("[SFUTransport] Received ICE servers from SFU:", data);

      // Store announced IP for future use if provided
      if (data.announcedIp) {
        console.log(
          `[SFUTransport] SFU provided announced IP: ${data.announcedIp}`,
        );
        this.announcedIp = data.announcedIp;
      }

      if (data && Array.isArray(data.iceServers)) {
        console.log(
          `[SFUTransport] Successfully retrieved ${data.iceServers.length} ICE servers from SFU`,
        );
        return data.iceServers;
      } else {
        console.warn(
          "[SFUTransport] Invalid ICE server response format:",
          data,
        );
        return [];
      }
    } catch (error) {
      console.error(
        "[SFUTransport] Error fetching ICE servers from SFU:",
        error,
      );
      return [];
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

      const mode = normalizeHostCodec(
        this.config.hostCodec ||
          (typeof window.EJS_NETPLAY_HOST_CODEC === "string"
            ? window.EJS_NETPLAY_HOST_CODEC
            : null) ||
          "auto",
      );

      const routerCaps = this.routerRtpCapabilities || null;
      const routerCodecs =
        routerCaps && Array.isArray(routerCaps.codecs) ? routerCaps.codecs : [];

      // Filter video codecs (excluding RTX)
      const candidates = routerCodecs.filter((c) => {
        const mt = c && typeof c.mimeType === "string" ? c.mimeType : "";
        const mtl = mt.toLowerCase();
        if (!mtl.startsWith("video/")) return false;
        if (mtl === "video/rtx") return false;
        return (
          mtl === "video/vp9" || mtl === "video/h264" || mtl === "video/vp8"
        );
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
            cc.mimeType.toLowerCase() === mimeLower,
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
          (c) => c && c.mimeType && c.mimeType.toLowerCase() === wantMime,
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
    // Check if we need to re-initialize SFU
    if (!this.useSFU || !this.device || !this.socket.isConnected()) {
      console.log(
        "[SFUTransport] Not ready, attempting to re-initialize SFU...",
      );

      // Try to re-initialize if socket is connected
      if (this.socket && this.socket.isConnected()) {
        const reInitSuccess = await this.initialize();
        if (!reInitSuccess) {
          console.warn("[SFUTransport] SFU re-initialization failed");
          return;
        }
        console.log("[SFUTransport] SFU re-initialized successfully");
      } else {
        console.warn(
          "[SFUTransport] Cannot create transports: Socket not connected",
        );
        return;
      }
    }

    const role = isHost ? "send" : "recv";

    // Wait for readiness (with re-init capability)
    const ready = await this.waitFor(
      () => {
        // If we become unready during wait, try to re-init
        if (!this.useSFU || !this.device || !this.socket.isConnected()) {
          console.log(
            "[SFUTransport] Lost readiness during wait, re-initializing...",
          );
          this.initialize().catch((err) =>
            console.warn("[SFUTransport] Re-init during wait failed:", err),
          );
          return false;
        }
        return true;
      },
      5000,
      200,
    );

    if (!ready) {
      console.warn(
        "[SFUTransport] Not ready for transport creation after wait",
      );
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
          },
        );
      });

      if (isHost) {
        // Create send transport (host)
        this.sendTransport = this.device.createSendTransport(transportInfo);

        // Setup connection state handlers (ICE restart on failure)
        this.setupTransportEventHandlers(
          this.sendTransport,
          transportInfo.id,
          "send",
        );

        // Listen for connect event and handle DTLS connection
        this.sendTransport.on(
          "connect",
          async ({ dtlsParameters }, callback, errback) => {
            try {
              console.log(
                `[SFUTransport] Transport ${transportInfo.id} connect event received`,
              );
              // Send DTLS parameters to server
              const result = await new Promise((resolve, reject) => {
                this.socket.emit(
                  "sfu-connect-transport",
                  {
                    transportId: transportInfo.id,
                    dtlsParameters,
                  },
                  (err, data) => {
                    if (err) return reject(err);
                    resolve(data);
                  },
                );
              });
              console.log(
                `[SFUTransport] Transport ${transportInfo.id} DTLS connection completed`,
              );
              callback();
            } catch (error) {
              console.error(
                `[SFUTransport] Transport ${transportInfo.id} DTLS connection failed:`,
                error,
              );
              errback(error);
            }
          },
        );

        // Listen for produce event and handle producer creation
        this.sendTransport.on(
          "produce",
          async ({ kind, rtpParameters, appData }, callback, errback) => {
            try {
              console.log(
                `[SFUTransport] Transport ${transportInfo.id} produce event received for ${kind}`,
              );
              // Send produce request to server
              const result = await new Promise((resolve, reject) => {
                this.socket.emit(
                  "sfu-produce",
                  {
                    transportId: transportInfo.id,
                    kind,
                    rtpParameters,
                    appData,
                  },
                  (err, data) => {
                    if (err) return reject(err);
                    resolve(data);
                  },
                );
              });
              console.log(
                `[SFUTransport] Transport ${transportInfo.id} producer created:`,
                result,
              );
              callback({ id: result.id });
            } catch (error) {
              console.error(
                `[SFUTransport] Transport ${transportInfo.id} producer creation failed:`,
                error,
              );
              errback(error);
            }
          },
        );

        console.log("[SFUTransport] Created sendTransport with handlers:", {
          id: transportInfo.id,
        });

        console.log("[SFUTransport] Created sendTransport:", {
          id: transportInfo.id,
        });

        // HOSTS ALSO NEED RECEIVE TRANSPORT TO GET DATA FROM CLIENTS
        try {
          const recvTransportInfo = await new Promise((resolve, reject) => {
            this.socket.emit(
              "sfu-create-transport",
              { direction: "recv" },
              (err, info) => {
                if (err) return reject(err);
                resolve(info);
              },
            );
          });

          this.recvTransport =
            this.device.createRecvTransport(recvTransportInfo);

          this.setupTransportEventHandlers(
            this.recvTransport,
            recvTransportInfo.id,
            "recv",
          );

          // Listen for connect event and handle DTLS connection
          this.recvTransport.on(
            "connect",
            async ({ dtlsParameters }, callback, errback) => {
              try {
                console.log(
                  `[SFUTransport] Transport ${recvTransportInfo.id} connect event received`,
                );
                // Send DTLS parameters to server
                const result = await new Promise((resolve, reject) => {
                  this.socket.emit(
                    "sfu-connect-transport",
                    {
                      transportId: recvTransportInfo.id,
                      dtlsParameters,
                    },
                    (err, data) => {
                      if (err) return reject(err);
                      resolve(data);
                    },
                  );
                });
                console.log(
                  `[SFUTransport] Transport ${recvTransportInfo.id} DTLS connection completed`,
                );
                callback();
              } catch (error) {
                console.error(
                  `[SFUTransport] Transport ${recvTransportInfo.id} DTLS connection failed:`,
                  error,
                );
                errback(error);
              }
            },
          );

          console.log(
            "[SFUTransport] Created recvTransport for host with connect handler:",
            {
              id: recvTransportInfo.id,
            },
          );

          console.log("[SFUTransport] Created recvTransport for host:", {
            id: recvTransportInfo.id,
          });
        } catch (error) {
          console.warn(
            "[SFUTransport] Failed to create receive transport for host:",
            error,
          );
        }
      } else {
        // Create recv transport (client)
        this.recvTransport = this.device.createRecvTransport(transportInfo);

        this.setupTransportEventHandlers(
          this.recvTransport,
          transportInfo.id,
          "recv",
        );

        // Listen for connect event and handle DTLS connection
        this.recvTransport.on(
          "connect",
          async ({ dtlsParameters }, callback, errback) => {
            try {
              console.log(
                `[SFUTransport] Transport ${transportInfo.id} connect event received`,
              );
              // Send DTLS parameters to server
              const result = await new Promise((resolve, reject) => {
                this.socket.emit(
                  "sfu-connect-transport",
                  {
                    transportId: transportInfo.id,
                    dtlsParameters,
                  },
                  (err, data) => {
                    if (err) return reject(err);
                    resolve(data);
                  },
                );
              });
              console.log(
                `[SFUTransport] Transport ${transportInfo.id} DTLS connection completed`,
              );
              callback();
            } catch (error) {
              console.error(
                `[SFUTransport] Transport ${transportInfo.id} DTLS connection failed:`,
                error,
              );
              errback(error);
            }
          },
        );

        console.log(
          "[SFUTransport] Created recvTransport with connect handler:",
          {
            id: transportInfo.id,
          },
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
   * Create a send transport for a specific media type
   * @param {string} mediaType - 'video', 'audio', or 'data' (defaults to 'data')
   * @returns {Promise<Object>} Created transport
   */
  async createSendTransport(mediaType = "data") {
    // Check if we need to re-initialize SFU
    if (!this.useSFU || !this.device || !this.socket.isConnected()) {
      console.log(
        "[SFUTransport] Not ready, attempting to re-initialize SFU...",
      );

      // Try to re-initialize if socket is connected
      if (this.socket && this.socket.isConnected()) {
        const reInitSuccess = await this.initialize();
        if (!reInitSuccess) {
          console.warn("[SFUTransport] SFU re-initialization failed");
          return;
        }
        console.log("[SFUTransport] SFU re-initialized successfully");
      } else {
        console.warn(
          "[SFUTransport] Cannot create send transport: Socket not connected",
        );
        return;
      }
    }

    // Get the appropriate transport property based on media type
    const transportProperty =
      mediaType === "video"
        ? "videoSendTransport"
        : mediaType === "audio"
          ? "audioSendTransport"
          : "dataSendTransport";

    // Check if transport already exists and is usable
    if (this[transportProperty]) {
      try {
        if (
          !this[transportProperty].closed &&
          this[transportProperty].connectionState !== "closed" &&
          this[transportProperty].connectionState !== "failed"
        ) {
          console.log(
            `[SFUTransport] ${mediaType} send transport already exists and is usable`,
          );
          return this[transportProperty];
        }
      } catch (e) {
        console.log(
          `[SFUTransport] ${mediaType} send transport exists but appears invalid, clearing it`,
        );
        this[transportProperty] = null;
      }
    }

    // If transport exists but is closed, clear it
    if (
      this[transportProperty] &&
      (this[transportProperty].closed ||
        this[transportProperty].connectionState === "closed" ||
        this[transportProperty].connectionState === "failed")
    ) {
      console.log(
        `[SFUTransport] ${mediaType} send transport exists but is closed/failed, clearing and creating new one`,
      );
      this[transportProperty] = null;
    }

    // Wait for readiness
    const ready = await this.waitFor(
      () => {
        if (!this.useSFU || !this.device || !this.socket.isConnected()) {
          console.log(
            "[SFUTransport] Lost readiness during wait, re-initializing...",
          );
          this.initialize().catch((err) =>
            console.warn("[SFUTransport] Re-init during wait failed:", err),
          );
          return false;
        }
        return true;
      },
      5000,
      200,
    );

    if (!ready) {
      console.warn(
        `[SFUTransport] Not ready for ${mediaType} send transport creation after wait`,
      );
      return;
    }

    try {
      const transportInfo = await new Promise((resolve, reject) => {
        this.socket.emit(
          "sfu-create-transport",
          { direction: "send" },
          (err, info) => {
            if (err) return reject(err);
            resolve(info);
          },
        );
      });

      // Create send transport
      const transport = this.device.createSendTransport(transportInfo);
      this[transportProperty] = transport;

      // Also set as the main send transport for producers to use
      if (mediaType === "video") {
        this.sendTransport = transport;
      }

      if (!transport) {
        throw new Error(`Failed to create ${mediaType} send transport`);
      }

      // Setup connection state handlers (ICE restart on failure)
      this.setupTransportEventHandlers(
        transport,
        transportInfo.id,
        `send-${mediaType}`,
      );

      // Listen for connect event and handle DTLS connection
      transport.on("connect", async ({ dtlsParameters }, callback, errback) => {
        try {
          console.log(
            `[SFUTransport] Transport ${transportInfo.id} connect event received`,
          );
          // Send DTLS parameters to server
          const result = await new Promise((resolve, reject) => {
            this.socket.emit(
              "sfu-connect-transport",
              {
                transportId: transportInfo.id,
                dtlsParameters,
              },
              (err, data) => {
                if (err) return reject(err);
                resolve(data);
              },
            );
          });
          console.log(
            `[SFUTransport] Transport ${transportInfo.id} DTLS connection completed`,
          );
          callback();
        } catch (error) {
          console.error(
            `[SFUTransport] Transport ${transportInfo.id} DTLS connection failed:`,
            error,
          );
          errback(error);
        }
      });

      // Listen for produce event and handle producer creation
      transport.on(
        "produce",
        async ({ kind, rtpParameters, appData }, callback, errback) => {
          try {
            console.log(
              `[SFUTransport] Transport ${transportInfo.id} produce event received for ${kind}`,
            );
            // Send produce request to server
            const result = await new Promise((resolve, reject) => {
              this.socket.emit(
                "sfu-produce",
                {
                  transportId: transportInfo.id,
                  kind,
                  rtpParameters,
                  appData,
                },
                (err, data) => {
                  if (err) return reject(err);
                  resolve(data);
                },
              );
            });
            console.log(
              `[SFUTransport] Transport ${transportInfo.id} producer created:`,
              result,
            );
            callback({ id: result.id });
          } catch (error) {
            console.error(
              `[SFUTransport] Transport ${transportInfo.id} producer creation failed:`,
              error,
            );
            errback(error);
          }
        },
      );

      // Listen for producedata event and handle data producer creation
      transport.on(
        "producedata",
        async (
          { sctpStreamParameters, label, protocol, appData },
          callback,
          errback,
        ) => {
          try {
            console.log(
              `[SFUTransport] Transport ${transportInfo.id} producedata event received for ${label || "data"}`,
            );
            // Send produce data request to server
            const result = await new Promise((resolve, reject) => {
              this.socket.emit(
                "producedata",
                {
                  transportId: transportInfo.id,
                  sctpStreamParameters,
                  label,
                  protocol,
                  appData,
                },
                (err, data) => {
                  if (err) return reject(err);
                  resolve(data);
                },
              );
            });
            console.log(
              `[SFUTransport] Transport ${transportInfo.id} data producer created:`,
              result,
            );
            callback({ id: result.id });
          } catch (error) {
            console.error(
              `[SFUTransport] Transport ${transportInfo.id} data producer creation failed:`,
              error,
            );
            errback(error);
          }
        },
      );

      console.log(
        `[SFUTransport] Created ${mediaType} sendTransport with handlers:`,
        {
          id: transportInfo.id,
        },
      );

      console.log(`[SFUTransport] Created ${mediaType} sendTransport:`, {
        id: transportInfo.id,
      });

      return transport;
    } catch (error) {
      console.error(
        `[SFUTransport] Failed to create ${mediaType} send transport:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Create a receive transport for consuming media/data from other peers
   * @returns {Promise<Object>} Created receive transport
   */
  async createRecvTransport() {
    // Check if we need to re-initialize SFU
    if (!this.useSFU || !this.device || !this.socket.isConnected()) {
      console.log(
        "[SFUTransport] Not ready, attempting to re-initialize SFU...",
      );

      // Try to re-initialize if socket is connected
      if (this.socket && this.socket.isConnected()) {
        const reInitSuccess = await this.initialize();
        if (!reInitSuccess) {
          console.warn("[SFUTransport] SFU re-initialization failed");
          return;
        }
        console.log("[SFUTransport] SFU re-initialized successfully");
      } else {
        console.warn(
          "[SFUTransport] Cannot create receive transport: Socket not connected",
        );
        return;
      }
    }

    // Check if receive transport already exists and is usable
    if (this.recvTransport) {
      try {
        if (
          !this.recvTransport.closed &&
          this.recvTransport.connectionState !== "closed" &&
          this.recvTransport.connectionState !== "failed"
        ) {
          console.log(
            "[SFUTransport] Receive transport already exists and is usable",
          );
          return this.recvTransport;
        }
      } catch (e) {
        console.log(
          "[SFUTransport] Receive transport exists but appears invalid, clearing it",
        );
        this.recvTransport = null;
      }
    }

    // If transport exists but is closed, clear it
    if (
      this.recvTransport &&
      (this.recvTransport.closed ||
        this.recvTransport.connectionState === "closed" ||
        this.recvTransport.connectionState === "failed")
    ) {
      console.log(
        "[SFUTransport] Receive transport exists but is closed/failed, clearing and creating new one",
      );
      this.recvTransport = null;
    }

    // Wait for readiness
    const ready = await this.waitFor(
      () => {
        if (!this.useSFU || !this.device || !this.socket.isConnected()) {
          console.log(
            "[SFUTransport] Lost readiness during wait, re-initializing...",
          );
          this.initialize().catch((err) =>
            console.warn("[SFUTransport] Re-init during wait failed:", err),
          );
          return false;
        }
        return true;
      },
      5000,
      200,
    );

    if (!ready) {
      console.warn(
        "[SFUTransport] Not ready for receive transport creation after wait",
      );
      return;
    }

    try {
      const transportInfo = await new Promise((resolve, reject) => {
        this.socket.emit(
          "sfu-create-transport",
          { direction: "recv" },
          (err, info) => {
            if (err) return reject(err);
            resolve(info);
          },
        );
      });

      // Create receive transport
      const transport = this.device.createRecvTransport(transportInfo);
      this.recvTransport = transport;

      console.log(
        `[SFUTransport] Created recv transport, DTLS params available:`,
        !!transport.dtlsParameters,
      );

      // Setup connection state handlers
      this.setupTransportEventHandlers(transport, transportInfo.id, "recv");

      // Listen for connect event and handle DTLS connection
      transport.on("connect", async ({ dtlsParameters }, callback, errback) => {
        try {
          console.log(
            `[SFUTransport] Transport ${transportInfo.id} connect event received`,
          );
          // Send DTLS parameters to server
          const result = await new Promise((resolve, reject) => {
            this.socket.emit(
              "sfu-connect-transport",
              {
                transportId: transportInfo.id,
                dtlsParameters,
              },
              (err, data) => {
                if (err) return reject(err);
                resolve(data);
              },
            );
          });
          console.log(
            `[SFUTransport] Transport ${transportInfo.id} DTLS connection completed`,
          );
          callback();
        } catch (error) {
          console.error(
            `[SFUTransport] Transport ${transportInfo.id} DTLS connection failed:`,
            error,
          );
          errback(error);
        }
      });

      console.log(
        `[SFUTransport] Created recvTransport with connect handler:`,
        {
          id: transportInfo.id,
        },
      );

      console.log("[SFUTransport] Created recvTransport:", {
        id: transportInfo.id,
      });

      return transport;
    } catch (error) {
      console.error(
        "[SFUTransport] Failed to create receive transport:",
        error,
      );
      throw error;
    }
  }

  /**
   * Request ICE restart from SFU server.
   * @private
   * @param {Object} transport - Transport object
   * @param {string} transportId - Transport ID
   * @returns {Promise<boolean>} True if restart succeeded
   */
  async requestIceRestart(transport, transportId) {
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
  }

  /**
   * Schedule ICE restart for disconnected transport.
   * @private
   * @param {Object} transport - Transport object
   * @param {string} transportId - Transport ID
   */
  scheduleIceRestart(transport, transportId) {
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
  }

  /**
   * Setup event handlers for transport connection state changes.
   * Handles ICE restart on connection failures.
   * @private
   * @param {Object} transport - Transport object
   * @param {string} transportId - Transport ID
   * @param {string} direction - Transport direction ('send', 'recv', 'send-video', etc.)
   */
  setupTransportEventHandlers(transport, transportId, direction) {
    if (!transport || !transportId) {
      console.warn(
        "[SFUTransport] Cannot setup handlers: missing transport or transportId",
      );
      return;
    }

    // Handle connection state changes
    transport.on("connectionstatechange", () => {
      const state = transport.connectionState;
      console.log(
        `[SFUTransport] Transport ${direction} connection state changed:`,
        {
          transportId,
          state,
        },
      );

      if (state === "connected" || state === "connecting") {
        // Clear any pending ICE restart timers when connection is good
        this.clearIceRestartTimer(transport);
      } else if (state === "disconnected") {
        // Schedule ICE restart for disconnected transport
        this.scheduleIceRestart(transport, transportId);
      } else {
        // Clear timer for other states (failed, closed)
        this.clearIceRestartTimer(transport);
      }
    });
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
   * Create video producer (host only).
   * @param {MediaStreamTrack} videoTrack - Video track from canvas/screen capture
   * @returns {Promise<Object>} Video producer
   */
  async createVideoProducer(videoTrack) {
    if (!this.useSFU || !this.device) {
      throw new Error("SFU not available or device not initialized");
    }

    // Ensure video send transport exists
    if (!this.videoSendTransport) {
      await this.createSendTransport("video");
    }

    if (!this.videoSendTransport) {
      throw new Error("Video send transport not available");
    }

    try {
      // Pick codec
      const codec = this.pickVideoCodec();
      if (!codec) {
        throw new Error("No supported video codec available");
      }

      // Create producer on video transport
      this.videoProducer = await this.videoSendTransport.produce({
        track: videoTrack,
        codec: codec,
      });

      console.log("[SFUTransport] Created video producer:", {
        id: this.videoProducer.id,
        codec: codec.mimeType,
        transportId: this.videoSendTransport.id,
      });

      return this.videoProducer;
    } catch (error) {
      console.error("[SFUTransport] Failed to create video producer:", error);
      throw error;
    }
  }

  /**
   * Create audio producer (host only).
   * @param {MediaStreamTrack} audioTrack - Audio track
   * @returns {Promise<Object>} Audio producer
   */
  async createAudioProducer(audioTrack) {
    if (!this.useSFU || !this.device) {
      throw new Error("SFU not available or device not initialized");
    }

    // Ensure audio send transport exists (separate from video transport)
    if (!this.audioSendTransport) {
      await this.createSendTransport("audio");
    }

    if (!this.audioSendTransport) {
      throw new Error("Audio send transport not available");
    }

    try {
      // Create producer on dedicated audio transport
      // Configure Opus codec for optimal game audio streaming
      this.audioProducer = await this.audioSendTransport.produce({
        track: audioTrack,
        codecOptions: {
          opusStereo: true, // Enable stereo for game audio
          opusFec: true, // Forward Error Correction for reliability
          opusDtx: false, // Disable DTX to prevent sync drift
          opusPtime: 20, // 20ms packet time for optimal latency/bandwidth
        },
      });

      console.log("[SFUTransport] Created audio producer:", {
        id: this.audioProducer.id,
        transportId: this.audioSendTransport.id,
      });

      return this.audioProducer;
    } catch (error) {
      console.error("[SFUTransport] Failed to create audio producer:", error);
      throw error;
    }
  }

  /**
   * Create mic audio producer (voice chat).
   * @param {MediaStreamTrack} micTrack - Microphone audio track
   * @returns {Promise<Object>} Mic audio producer
   */
  async createMicAudioProducer(micTrack) {
    if (!this.useSFU || !this.device) {
      throw new Error("SFU not available or device not initialized");
    }

    // Ensure audio send transport exists (separate from video transport)
    if (!this.audioSendTransport) {
      await this.createSendTransport("audio");
    }

    if (!this.audioSendTransport) {
      throw new Error("Audio send transport not available");
    }

    try {
      // Create mic producer on dedicated audio transport
      // Configure Opus codec for voice chat (mono)
      this.micAudioProducer = await this.audioSendTransport.produce({
        track: micTrack,
        codecOptions: {
          opusStereo: false, // Mono for voice chat
          opusFec: true, // Forward Error Correction for reliability
          opusDtx: false, // Keep voice continuous
          opusPtime: 20, // 20ms packet time for voice latency
        },
      });

      console.log("[SFUTransport] Created mic audio producer:", {
        id: this.micAudioProducer.id,
        transportId: this.audioSendTransport.id,
      });

      return this.micAudioProducer;
    } catch (error) {
      console.error(
        "[SFUTransport] Failed to create mic audio producer:",
        error,
      );
      throw error;
    }
  }

  /**
   * Create data producer for input relay (host only).
   * @returns {Promise<Object>} Data producer
   */
  async createDataProducer() {
    if (!this.useSFU || !this.device) {
      throw new Error("SFU not available or device not initialized");
    }

    // Ensure data send transport exists (separate from video/audio transports)
    if (!this.dataSendTransport) {
      await this.createSendTransport("data");
    }

    if (!this.dataSendTransport) {
      throw new Error("Data send transport not available");
    }

    // Check if transport supports data channels
    if (typeof this.dataSendTransport.produceData !== "function") {
      console.warn("[SFUTransport] Transport does not support data channels");
      return null;
    }

    try {
      // Create data producer on dedicated data transport
      this.dataProducer = await this.dataSendTransport.produceData({
        ordered: false, // Unordered for better performance
        maxPacketLifeTime: 3000, // 3 second TTL for reliability
        label: "netplay-input", // Explicitly label for filtering
      });

      console.log("[SFUTransport] Created data producer:", {
        id: this.dataProducer.id,
        label: this.dataProducer.label,
        readyState: this.dataProducer.readyState,
        transportId: this.dataSendTransport.id,
      });

      // Set up data producer in DataChannelManager
      if (this.dataChannelManager) {
        this.dataChannelManager.setDataProducer(this.dataProducer);
      }

      return this.dataProducer;
    } catch (error) {
      console.error("[SFUTransport] Failed to create data producer:", error);
      throw error;
    }
  }

  /**
   * Create consumers for remote video/audio (clients only).
   * @param {string} producerId - Producer ID to consume
   * @param {string} kind - "video" or "audio"
   * @returns {Promise<Object>} Consumer
   */
  async createConsumer(producerId, kind) {
    if (!this.useSFU || !this.recvTransport || !this.device) {
      throw new Error("SFU not available or recv transport not created");
    }

    try {
      console.log(
        `[SFUTransport] Requesting consumer for producer ${producerId}, kind: ${kind}`,
      );

      let consumer;

      if (kind === "data") {
        // Data consumers use consumedata endpoint (different from video/audio)
        const consumerParams = await new Promise((resolve, reject) => {
          this.socket.emit(
            "consumedata",
            {
              dataProducerId: producerId,
              transportId: this.recvTransport.id,
            },
            (error, params) => {
              if (error) {
                console.error(
                  `[SFUTransport] SFU consume-data request failed for producer ${producerId}:`,
                  error,
                );
                reject(error);
              } else {
                console.log(
                  `[SFUTransport] Received consumer params from SFU for data producer ${producerId}:`,
                  params,
                );
                resolve(params);
              }
            },
          );
        });

        // Create data consumer locally using parameters from SFU
        consumer = await this.recvTransport.consumeData({
          id: consumerParams.id, // Add the missing id parameter
          dataProducerId: consumerParams.dataProducerId,
          sctpStreamParameters: consumerParams.sctpStreamParameters,
          label: consumerParams.label,
          protocol: consumerParams.protocol,
        });

        console.log(`[SFUTransport] Created data consumer:`, {
          id: consumer.id,
          label: consumer.label,
          paused: consumer.paused,
          readyState: consumer.readyState,
        });

        // Resume consumer if paused (mediasoup consumers start paused by default)
        if (consumer.paused) {
          console.log(
            `[SFUTransport] Resuming paused data consumer:`,
            consumer.id,
          );
          await consumer.resume();
          console.log(`[SFUTransport] Data consumer resumed:`, consumer.id);
        }

        // Set up message handling for data consumers
        if (this.dataChannelManager) {
          // Track consumer state
          consumer.on("transportclose", () => {
            console.log(
              `[SFUTransport] Data consumer transport closed:`,
              consumer.id,
            );
          });

          consumer.on("close", () => {
            console.log(`[SFUTransport] Data consumer closed:`, consumer.id);
          });

          consumer.on("open", () => {
            console.log(`[SFUTransport] Data consumer opened:`, consumer.id);
          });

          consumer.on("message", (message) => {
            console.log(
              `[SFUTransport] 📨 Data consumer received message:`,
              message,
            );
            console.log(
              `[SFUTransport] Message type: ${typeof message}, value:`,
              message,
            );
            // For SFU, we don't have the socketId mapping, so pass null
            this.dataChannelManager.handleIncomingMessage(message, null);
          });

          // Check ready state after a delay
          setTimeout(() => {
            console.log(`[SFUTransport] Data consumer state after delay:`, {
              id: consumer.id,
              label: consumer.label,
              readyState: consumer.readyState,
              paused: consumer.paused,
              closed: consumer.closed,
            });
          }, 2000);
        }
      } else {
        // Video/audio consumers use sfu-consume endpoint
        const consumerParams = await new Promise((resolve, reject) => {
          this.socket.emit(
            "sfu-consume",
            {
              producerId: producerId,
              transportId: this.recvTransport.id,
              rtpCapabilities: this.device.rtpCapabilities,
              ignoreDtx: kind === "audio", // Ignore DTX for audio consumers
            },
            (error, params) => {
              if (error) {
                console.error(
                  `[SFUTransport] SFU consume request failed for producer ${producerId}:`,
                  error,
                );
                reject(error);
              } else {
                console.log(
                  `[SFUTransport] Received consumer params from SFU for producer ${producerId}:`,
                  params,
                );
                resolve(params);
              }
            },
          );
        });

        // Create audio/video consumer locally using parameters from SFU
        // For audio consumers, ignore DTX packets to prevent sync drift
        const consumeOptions =
          kind === "audio"
            ? { ...consumerParams, ignoreDtx: true }
            : consumerParams;
        consumer = await this.recvTransport.consume(consumeOptions);
      }

      // Store consumer
      this.consumers.set(producerId, consumer);

      console.log(`[SFUTransport] Created ${kind} consumer:`, {
        producerId,
        consumerId: consumer.id,
      });

      // Start drift monitoring if enabled and not already running
      if (
        this.driftMonitoringEnabled &&
        !this.driftMonitoringInterval &&
        this.consumers.size > 0
      ) {
        this.startDriftMonitoring();
      }

      return consumer;
    } catch (error) {
      console.error(`[SFUTransport] Failed to create ${kind} consumer:`, error);
      throw error;
    }
  }

  /**
   * Start soft drift monitoring (logging only, no restarts).
   * Monitors consumer stats and logs warnings when drift exceeds thresholds.
   * @private
   */
  startDriftMonitoring() {
    if (this.driftMonitoringInterval) {
      return; // Already running
    }

    console.log(
      "[SFUTransport] Starting drift monitoring (soft monitoring only)",
    );

    // Monitor every 5 seconds
    this.driftMonitoringInterval = setInterval(() => {
      this.checkDrift();
    }, 5000);
  }

  /**
   * Stop drift monitoring.
   * @private
   */
  stopDriftMonitoring() {
    if (this.driftMonitoringInterval) {
      clearInterval(this.driftMonitoringInterval);
      this.driftMonitoringInterval = null;
      console.log("[SFUTransport] Stopped drift monitoring");
    }
  }

  /**
   * Check for drift in consumers and log warnings if thresholds exceeded.
   * This is soft monitoring - we log but don't restart transports.
   * @private
   */
  async checkDrift() {
    if (this.consumers.size === 0) {
      this.stopDriftMonitoring();
      return;
    }

    for (const [producerId, consumer] of this.consumers.entries()) {
      try {
        // Skip data consumers - they don't have getStats() method
        if (!consumer.getStats) {
          continue;
        }

        // Get consumer stats (only for video/audio consumers)
        const stats = await consumer.getStats();

        // Find audio/video stats
        for (const [id, stat] of stats.entries()) {
          if (stat.type === "inbound-rtp" && stat.kind) {
            const kind = stat.kind;
            const isAudio = kind === "audio";

            // Check jitter buffer (for audio, this is critical)
            if (isAudio && stat.jitter !== undefined) {
              const jitterMs = stat.jitter * 1000; // Convert to ms
              if (jitterMs > this.driftThresholds.audioJitterMs) {
                console.warn(
                  `[SFUTransport] Audio jitter high: ${jitterMs.toFixed(2)}ms (threshold: ${this.driftThresholds.audioJitterMs}ms)`,
                  {
                    producerId,
                    consumerId: consumer.id,
                  },
                );
              }
            }

            // Check packet loss
            if (
              stat.packetsLost !== undefined &&
              stat.packetsReceived !== undefined
            ) {
              const totalPackets = stat.packetsLost + stat.packetsReceived;
              if (totalPackets > 0) {
                const lossPercent = (stat.packetsLost / totalPackets) * 100;
                if (lossPercent > this.driftThresholds.packetLossPercent) {
                  console.warn(
                    `[SFUTransport] ${kind} packet loss high: ${lossPercent.toFixed(2)}% (threshold: ${this.driftThresholds.packetLossPercent}%)`,
                    {
                      producerId,
                      consumerId: consumer.id,
                      packetsLost: stat.packetsLost,
                      packetsReceived: stat.packetsReceived,
                    },
                  );
                }
              }
            }

            // Check round-trip time (if available)
            if (stat.roundTripTime !== undefined) {
              const rttMs = stat.roundTripTime * 1000;
              // Note: RTT drift detection would require baseline comparison
              // For now, just log if RTT is unusually high
              if (rttMs > 500) {
                console.warn(
                  `[SFUTransport] ${kind} RTT high: ${rttMs.toFixed(2)}ms`,
                  {
                    producerId,
                    consumerId: consumer.id,
                  },
                );
              }
            }
          }
        }
      } catch (error) {
        // Silently ignore stats errors (consumer may be closed)
        if (error.message && !error.message.includes("closed")) {
          console.debug(
            `[SFUTransport] Error getting stats for consumer ${producerId}:`,
            error.message,
          );
        }
      }
    }
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

    // Stop drift monitoring
    this.stopDriftMonitoring();

    // Close consumers
    this.consumers.forEach((consumer) => {
      try {
        consumer.close();
      } catch (e) {}
    });
    this.consumers.clear();

    // Close transports
    if (this.videoSendTransport) {
      try {
        this.videoSendTransport.close();
      } catch (e) {}
      this.videoSendTransport = null;
    }
    if (this.audioSendTransport) {
      try {
        this.audioSendTransport.close();
      } catch (e) {}
      this.audioSendTransport = null;
    }
    if (this.dataSendTransport) {
      try {
        this.dataSendTransport.close();
      } catch (e) {}
      this.dataSendTransport = null;
    }
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
