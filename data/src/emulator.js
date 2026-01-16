class EmulatorJS {
  getCores() {
    let rv = {
      atari5200: ["a5200"],
      vb: ["beetle_vb"],
      nds: ["melonds", "desmume", "desmume2015"],
      arcade: ["fbneo", "fbalpha2012_cps1", "fbalpha2012_cps2", "same_cdi"],
      nes: ["fceumm", "nestopia"],
      gb: ["gambatte"],
      coleco: ["gearcoleco"],
      segaMS: [
        "smsplus",
        "genesis_plus_gx",
        "genesis_plus_gx_wide",
        "picodrive",
      ],
      segaMD: ["genesis_plus_gx", "genesis_plus_gx_wide", "picodrive"],
      segaGG: ["genesis_plus_gx", "genesis_plus_gx_wide"],
      segaCD: ["genesis_plus_gx", "genesis_plus_gx_wide", "picodrive"],
      sega32x: ["picodrive"],
      sega: ["genesis_plus_gx", "genesis_plus_gx_wide", "picodrive"],
      lynx: ["handy"],
      mame: ["mame2003_plus", "mame2003"],
      ngp: ["mednafen_ngp"],
      pce: ["mednafen_pce"],
      pcfx: ["mednafen_pcfx"],
      psx: ["pcsx_rearmed", "mednafen_psx_hw"],
      ws: ["mednafen_wswan"],
      gba: ["mgba"],
      n64: ["mupen64plus_next", "parallel_n64"],
      "3do": ["opera"],
      psp: ["ppsspp"],
      atari7800: ["prosystem"],
      snes: ["snes9x", "bsnes"],
      atari2600: ["stella2014"],
      jaguar: ["virtualjaguar"],
      segaSaturn: ["yabause"],
      amiga: ["puae"],
      c64: ["vice_x64sc"],
      c128: ["vice_x128"],
      pet: ["vice_xpet"],
      plus4: ["vice_xplus4"],
      vic20: ["vice_xvic"],
      dos: ["dosbox_pure"],
      intv: ["freeintv"],
    };
    if (this.isSafari && this.isMobile) {
      rv.n64 = rv.n64.reverse();
    }
    return rv;
  }
  requiresThreads(core) {
    const requiresThreads = ["ppsspp", "dosbox_pure"];
    return requiresThreads.includes(core);
  }
  requiresWebGL2(core) {
    const requiresWebGL2 = ["ppsspp"];
    return requiresWebGL2.includes(core);
  }
  getCore(generic) {
    const cores = this.getCores();
    const core = this.config.system;
    if (generic) {
      for (const k in cores) {
        if (cores[k].includes(core)) {
          return k;
        }
      }
      return core;
    }
    const gen = this.getCore(true);
    if (
      cores[gen] &&
      cores[gen].includes(this.preGetSetting("retroarch_core"))
    ) {
      return this.preGetSetting("retroarch_core");
    }
    if (cores[core]) {
      return cores[core][0];
    }
    return core;
  }
  createElement(type) {
    return document.createElement(type);
  }
  addEventListener(element, listener, callback) {
    const listeners = listener.split(" ");
    let rv = [];
    for (let i = 0; i < listeners.length; i++) {
      element.addEventListener(listeners[i], callback);
      const data = { cb: callback, elem: element, listener: listeners[i] };
      rv.push(data);
    }
    return rv;
  }
  removeEventListener(data) {
    for (let i = 0; i < data.length; i++) {
      data[i].elem.removeEventListener(data[i].listener, data[i].cb);
    }
  }
  downloadFile(path, progressCB, notWithPath, opts) {
    return new Promise(async (cb) => {
      const data = this.toData(path); //check other data types
      if (data) {
        data.then((game) => {
          if (opts.method === "HEAD") {
            cb({ headers: {} });
          } else {
            cb({ headers: {}, data: game });
          }
        });
        return;
      }
      const basePath = notWithPath ? "" : this.config.dataPath;
      path = basePath + path;
      if (
        !notWithPath &&
        this.config.filePaths &&
        typeof this.config.filePaths[path.split("/").pop()] === "string"
      ) {
        path = this.config.filePaths[path.split("/").pop()];
      }
      let url;
      try {
        url = new URL(path);
      } catch (e) {}
      if (url && !["http:", "https:"].includes(url.protocol)) {
        //Most commonly blob: urls. Not sure what else it could be
        if (opts.method === "HEAD") {
          cb({ headers: {} });
          return;
        }
        try {
          let res = await fetch(path);
          if (
            (opts.type && opts.type.toLowerCase() === "arraybuffer") ||
            !opts.type
          ) {
            res = await res.arrayBuffer();
          } else {
            res = await res.text();
            try {
              res = JSON.parse(res);
            } catch (e) {}
          }
          if (path.startsWith("blob:")) URL.revokeObjectURL(path);
          cb({ data: res, headers: {} });
        } catch (e) {
          cb(-1);
        }
        return;
      }
      const xhr = new XMLHttpRequest();
      if (progressCB instanceof Function) {
        xhr.addEventListener("progress", (e) => {
          const progress = e.total
            ? " " + Math.floor((e.loaded / e.total) * 100).toString() + "%"
            : " " + (e.loaded / 1048576).toFixed(2) + "MB";
          progressCB(progress);
        });
      }
      xhr.onload = function () {
        if (xhr.readyState === xhr.DONE) {
          let data = xhr.response;
          if (
            xhr.status.toString().startsWith("4") ||
            xhr.status.toString().startsWith("5")
          ) {
            cb(-1);
            return;
          }
          try {
            data = JSON.parse(data);
          } catch (e) {}
          cb({
            data: data,
            headers: {
              "content-length": xhr.getResponseHeader("content-length"),
            },
          });
        }
      };
      if (opts.responseType) xhr.responseType = opts.responseType;
      xhr.onerror = () => cb(-1);
      xhr.open(opts.method, path, true);
      xhr.send();
    });
  }
  toData(data, rv) {
    if (
      !(data instanceof ArrayBuffer) &&
      !(data instanceof Uint8Array) &&
      !(data instanceof Blob)
    )
      return null;
    if (rv) return true;
    return new Promise(async (resolve) => {
      if (data instanceof ArrayBuffer) {
        resolve(new Uint8Array(data));
      } else if (data instanceof Uint8Array) {
        resolve(data);
      } else if (data instanceof Blob) {
        resolve(new Uint8Array(await data.arrayBuffer()));
      }
      resolve();
    });
  }
  checkForUpdates() {
    if (this.ejs_version.endsWith("-sfu")) {
      console.warn("Using EmulatorJS-SFU. Not checking for updates.");
      return;
    }
    fetch("https://cdn.emulatorjs.org/stable/data/version.json").then(
      (response) => {
        if (response.ok) {
          response.text().then((body) => {
            let version = JSON.parse(body);
            if (
              this.versionAsInt(this.ejs_version) <
              this.versionAsInt(version.version)
            ) {
              console.log(
                `Using EmulatorJS version ${this.ejs_version} but the newest version is ${version.current_version}\nopen https://github.com/EmulatorJS/EmulatorJS to update`
              );
            }
          });
        }
      }
    );
  }
  versionAsInt(ver) {
    if (typeof ver !== "string") {
      return 0;
    }
    if (ver.endsWith("-beta")) {
      return 99999999;
    }
    // Ignore build suffixes like "-sfu" (e.g. "4.3.0-sfu" -> "4.3.0").
    ver = ver.split("-")[0];
    let rv = ver.split(".");
    if (rv[rv.length - 1].length === 1) {
      rv[rv.length - 1] = "0" + rv[rv.length - 1];
    }
    return parseInt(rv.join(""), 10);
  }
  constructor(element, config) {
    this.ejs_version = "4.3.0-sfu";
    this.extensions = [];
    this.allSettings = {};
    this.initControlVars();
    this.debug = window.EJS_DEBUG_XX === true;
    if (
      this.debug ||
      (window.location &&
        ["localhost", "127.0.0.1"].includes(location.hostname))
    ) {
      this.checkForUpdates();
    }
    this.netplayEnabled = true;
    this.config = config;
    this.config.buttonOpts = this.buildButtonOptions(this.config.buttonOpts);
    this.config.settingsLanguage = window.EJS_settingsLanguage || false;
    switch (this.config.browserMode) {
      case 1: // Force mobile
      case "1":
      case "mobile":
        if (this.debug) {
          console.log("Force mobile mode is enabled");
        }
        this.config.browserMode = 1;
        break;
      case 2: // Force desktop
      case "2":
      case "desktop":
        if (this.debug) {
          console.log("Force desktop mode is enabled");
        }
        this.config.browserMode = 2;
        break;
      default: // Auto detect
        config.browserMode = undefined;
    }
    this.currentPopup = null;
    this.isFastForward = false;
    this.isSlowMotion = false;
    this.failedToStart = false;
    this.rewindEnabled = this.preGetSetting("rewindEnabled") === "enabled";
    this.touch = false;
    this.cheats = [];
    this.started = false;
    this.volume =
      typeof this.config.volume === "number" ? this.config.volume : 0.5;
    if (this.config.defaultControllers)
      this.defaultControllers = this.config.defaultControllers;
    this.muted = false;
    this.paused = true;
    this.missingLang = [];
    this.setElements(element);
    this.setColor(this.config.color || "");
    this.config.alignStartButton =
      typeof this.config.alignStartButton === "string"
        ? this.config.alignStartButton
        : "bottom";
    this.config.backgroundColor =
      typeof this.config.backgroundColor === "string"
        ? this.config.backgroundColor
        : "rgb(51, 51, 51)";
    if (this.config.adUrl) {
      this.config.adSize = Array.isArray(this.config.adSize)
        ? this.config.adSize
        : ["300px", "250px"];
      this.setupAds(
        this.config.adUrl,
        this.config.adSize[0],
        this.config.adSize[1]
      );
    }
    this.isMobile = (() => {
      // browserMode can be either a 1 (force mobile), 2 (force desktop) or undefined (auto detect)
      switch (this.config.browserMode) {
        case 1:
          return true;
        case 2:
          return false;
      }

      let check = false;
      (function (a) {
        if (
          /(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino|android|ipad|playbook|silk/i.test(
            a
          ) ||
          /1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(
            a.substr(0, 4)
          )
        )
          check = true;
      })(navigator.userAgent || navigator.vendor || window.opera);
      return check;
    })();
    this.hasTouchScreen = (function () {
      if (window.PointerEvent && "maxTouchPoints" in navigator) {
        if (navigator.maxTouchPoints > 0) {
          return true;
        }
      } else {
        if (
          window.matchMedia &&
          window.matchMedia("(any-pointer:coarse)").matches
        ) {
          return true;
        } else if (window.TouchEvent || "ontouchstart" in window) {
          return true;
        }
      }
      return false;
    })();
    this.canvas = this.createElement("canvas");
    this.canvas.classList.add("ejs_canvas");
    this.videoRotation = [0, 1, 2, 3].includes(this.config.videoRotation)
      ? this.config.videoRotation
      : this.preGetSetting("videoRotation") || 0;
    this.videoRotationChanged = false;
    this.capture = this.capture || {};
    this.capture.photo = this.capture.photo || {};
    this.capture.photo.source = ["canvas", "retroarch"].includes(
      this.capture.photo.source
    )
      ? this.capture.photo.source
      : "canvas";
    this.capture.photo.format =
      typeof this.capture.photo.format === "string"
        ? this.capture.photo.format
        : "png";
    this.capture.photo.upscale =
      typeof this.capture.photo.upscale === "number"
        ? this.capture.photo.upscale
        : 1;
    this.capture.video = this.capture.video || {};
    this.capture.video.format =
      typeof this.capture.video.format === "string"
        ? this.capture.video.format
        : "detect";
    this.capture.video.upscale =
      typeof this.capture.video.upscale === "number"
        ? this.capture.video.upscale
        : 1;
    this.capture.video.fps =
      typeof this.capture.video.fps === "number" ? this.capture.video.fps : 30;
    this.capture.video.videoBitrate =
      typeof this.capture.video.videoBitrate === "number"
        ? this.capture.video.videoBitrate
        : 2.5 * 1024 * 1024;
    this.capture.video.audioBitrate =
      typeof this.capture.video.audioBitrate === "number"
        ? this.capture.video.audioBitrate
        : 192 * 1024;
    this.bindListeners();
    // Additions for Netplay
    this.netplayCanvas = null;
    this.netplayShowTurnWarning = false;
    this.netplayWarningShown = false;

    const storedSimulcast = this.preGetSetting("netplaySimulcast");
    const envSimulcast =
      typeof window.EJS_NETPLAY_SIMULCAST === "boolean"
        ? window.EJS_NETPLAY_SIMULCAST
        : false;
    const configSimulcast =
      typeof this.config.netplaySimulcast === "boolean"
        ? this.config.netplaySimulcast
        : envSimulcast;
    this.netplaySimulcastEnabled =
      typeof storedSimulcast === "string"
        ? storedSimulcast === "enabled"
        : !!configSimulcast;
    window.EJS_NETPLAY_SIMULCAST = this.netplaySimulcastEnabled;

    // VP9 SVC mode (used when VP9 is selected/negotiated): L1T1 | L1T3 | L2T3
    const normalizeVP9SVCMode = (v) => {
      const s = typeof v === "string" ? v.trim() : "";
      const sl = s.toLowerCase();
      if (sl === "l1t1") return "L1T1";
      if (sl === "l1t3") return "L1T3";
      if (sl === "l2t3") return "L2T3";
      return "L1T1";
    };
    const storedVP9SVC = this.preGetSetting("netplayVP9SVC");
    const envVP9SVC =
      typeof window.EJS_NETPLAY_VP9_SVC_MODE === "string"
        ? window.EJS_NETPLAY_VP9_SVC_MODE
        : null;
    const configVP9SVC =
      typeof this.config.netplayVP9SVC === "string"
        ? this.config.netplayVP9SVC
        : envVP9SVC;
    this.netplayVP9SVCMode = normalizeVP9SVCMode(
      typeof storedVP9SVC === "string" ? storedVP9SVC : configVP9SVC
    );
    window.EJS_NETPLAY_VP9_SVC_MODE = this.netplayVP9SVCMode;

    // Host Codec (SFU video): auto | vp9 | h264 | vp8
    const normalizeHostCodec = (v) => {
      const s = typeof v === "string" ? v.trim().toLowerCase() : "";
      if (s === "vp9" || s === "h264" || s === "vp8" || s === "auto") return s;
      return "auto";
    };
    const storedHostCodec = this.preGetSetting("netplayHostCodec");
    const envHostCodec =
      typeof window.EJS_NETPLAY_HOST_CODEC === "string"
        ? window.EJS_NETPLAY_HOST_CODEC
        : null;
    const configHostCodec =
      typeof this.config.netplayHostCodec === "string"
        ? this.config.netplayHostCodec
        : envHostCodec;
    this.netplayHostCodec = normalizeHostCodec(
      typeof storedHostCodec === "string" ? storedHostCodec : configHostCodec
    );
    window.EJS_NETPLAY_HOST_CODEC = this.netplayHostCodec;

    // Client Simulcast Quality (replaces legacy Client Max Resolution).
    // Values are: high | low.
    const normalizeSimulcastQuality = (v) => {
      const s = typeof v === "string" ? v.trim().toLowerCase() : "";
      if (s === "high" || s === "low") return s;
      if (s === "medium") return "low";
      // Legacy values
      if (s === "720p") return "high";
      if (s === "360p") return "low";
      if (s === "180p") return "low";
      return "high";
    };
    const simulcastQualityToLegacyRes = (q) => {
      const s = normalizeSimulcastQuality(q);
      return s === "low" ? "360p" : "720p";
    };

    const storedSimulcastQuality = this.preGetSetting(
      "netplayClientSimulcastQuality"
    );
    const storedClientMaxRes = this.preGetSetting("netplayClientMaxResolution");

    const envSimulcastQuality =
      typeof window.EJS_NETPLAY_CLIENT_SIMULCAST_QUALITY === "string"
        ? window.EJS_NETPLAY_CLIENT_SIMULCAST_QUALITY
        : typeof window.EJS_NETPLAY_CLIENT_PREFERRED_QUALITY === "string"
        ? window.EJS_NETPLAY_CLIENT_PREFERRED_QUALITY
        : null;
    const envClientMaxRes =
      typeof window.EJS_NETPLAY_CLIENT_MAX_RESOLUTION === "string"
        ? window.EJS_NETPLAY_CLIENT_MAX_RESOLUTION
        : null;

    const configSimulcastQuality =
      typeof this.config.netplayClientSimulcastQuality === "string"
        ? this.config.netplayClientSimulcastQuality
        : envSimulcastQuality;
    const configClientMaxRes =
      typeof this.config.netplayClientMaxResolution === "string"
        ? this.config.netplayClientMaxResolution
        : envClientMaxRes;

    const simulcastQualityRaw =
      (typeof storedSimulcastQuality === "string" && storedSimulcastQuality) ||
      (typeof storedClientMaxRes === "string" && storedClientMaxRes) ||
      (typeof configSimulcastQuality === "string" && configSimulcastQuality) ||
      (typeof configClientMaxRes === "string" && configClientMaxRes) ||
      "high";

    this.netplayClientSimulcastQuality =
      normalizeSimulcastQuality(simulcastQualityRaw);
    window.EJS_NETPLAY_CLIENT_SIMULCAST_QUALITY =
      this.netplayClientSimulcastQuality;
    // Keep older global populated for compatibility with older integrations.
    window.EJS_NETPLAY_CLIENT_PREFERRED_QUALITY =
      this.netplayClientSimulcastQuality;
    // Keep legacy global populated for compatibility with older integrations.
    window.EJS_NETPLAY_CLIENT_MAX_RESOLUTION = simulcastQualityToLegacyRes(
      this.netplayClientSimulcastQuality
    );

    const storedRetryTimer = this.preGetSetting("netplayRetryConnectionTimer");
    const envRetryTimerRaw =
      typeof window.EJS_NETPLAY_RETRY_CONNECTION_TIMER === "number" ||
      typeof window.EJS_NETPLAY_RETRY_CONNECTION_TIMER === "string"
        ? window.EJS_NETPLAY_RETRY_CONNECTION_TIMER
        : null;
    const configRetryTimerRaw =
      typeof this.config.netplayRetryConnectionTimer === "number" ||
      typeof this.config.netplayRetryConnectionTimer === "string"
        ? this.config.netplayRetryConnectionTimer
        : envRetryTimerRaw;
    let retrySeconds = parseInt(
      typeof storedRetryTimer === "string"
        ? storedRetryTimer
        : configRetryTimerRaw,
      10
    );
    if (isNaN(retrySeconds)) retrySeconds = 3;
    if (retrySeconds < 0) retrySeconds = 0;
    if (retrySeconds > 5) retrySeconds = 5;
    this.netplayRetryConnectionTimerSeconds = retrySeconds;
    window.EJS_NETPLAY_RETRY_CONNECTION_TIMER = retrySeconds;

    const storedUnorderedRetries = this.preGetSetting(
      "netplayUnorderedRetries"
    );
    const envUnorderedRetriesRaw =
      typeof window.EJS_NETPLAY_UNORDERED_RETRIES === "number" ||
      typeof window.EJS_NETPLAY_UNORDERED_RETRIES === "string"
        ? window.EJS_NETPLAY_UNORDERED_RETRIES
        : null;
    const configUnorderedRetriesRaw =
      typeof this.config.netplayUnorderedRetries === "number" ||
      typeof this.config.netplayUnorderedRetries === "string"
        ? this.config.netplayUnorderedRetries
        : envUnorderedRetriesRaw;
    let unorderedRetries = parseInt(
      typeof storedUnorderedRetries === "string"
        ? storedUnorderedRetries
        : configUnorderedRetriesRaw,
      10
    );
    if (isNaN(unorderedRetries)) unorderedRetries = 0;
    if (unorderedRetries < 0) unorderedRetries = 0;
    if (unorderedRetries > 2) unorderedRetries = 2;
    this.netplayUnorderedRetries = unorderedRetries;
    window.EJS_NETPLAY_UNORDERED_RETRIES = unorderedRetries;

    const storedInputMode = this.preGetSetting("netplayInputMode");
    const envInputMode =
      typeof window.EJS_NETPLAY_INPUT_MODE === "string"
        ? window.EJS_NETPLAY_INPUT_MODE
        : null;
    const configInputMode =
      typeof this.config.netplayInputMode === "string"
        ? this.config.netplayInputMode
        : envInputMode;
    const normalizeInputMode = (m) => {
      const mode = typeof m === "string" ? m : "";
      if (
        mode === "orderedRelay" ||
        mode === "unorderedRelay" ||
        mode === "unorderedP2P"
      )
        return mode;
      return "unorderedRelay";
    };
    this.netplayInputMode = normalizeInputMode(
      typeof storedInputMode === "string" ? storedInputMode : configInputMode
    );
    window.EJS_NETPLAY_INPUT_MODE = this.netplayInputMode;

    // Preferred local player slot (0-3) for netplay.
    const normalizePreferredSlot = (v) => {
      try {
        if (typeof v === "number" && isFinite(v)) {
          const n = Math.floor(v);
          if (n >= 0 && n <= 3) return n;
          if (n >= 1 && n <= 4) return n - 1;
        }
        const s = typeof v === "string" ? v.trim().toLowerCase() : "";
        if (!s) return 0;
        if (s === "p1") return 0;
        if (s === "p2") return 1;
        if (s === "p3") return 2;
        if (s === "p4") return 3;
        const n = parseInt(s, 10);
        if (!isNaN(n)) {
          if (n >= 0 && n <= 3) return n;
          if (n >= 1 && n <= 4) return n - 1;
        }
      } catch (e) {
        // ignore
      }
      return 0;
    };
    const storedPreferredSlot = this.preGetSetting("netplayPreferredSlot");
    const envPreferredSlot =
      typeof window.EJS_NETPLAY_PREFERRED_SLOT === "number" ||
      typeof window.EJS_NETPLAY_PREFERRED_SLOT === "string"
        ? window.EJS_NETPLAY_PREFERRED_SLOT
        : null;
    const configPreferredSlot =
      typeof this.config.netplayPreferredSlot === "number" ||
      typeof this.config.netplayPreferredSlot === "string"
        ? this.config.netplayPreferredSlot
        : envPreferredSlot;
    this.netplayPreferredSlot = normalizePreferredSlot(
      typeof storedPreferredSlot === "string" ||
        typeof storedPreferredSlot === "number"
        ? storedPreferredSlot
        : configPreferredSlot
    );
    window.EJS_NETPLAY_PREFERRED_SLOT = this.netplayPreferredSlot;

    if (this.netplayEnabled) {
      const iceServers =
        this.config.netplayICEServers || window.EJS_netplayICEServers || [];
      const hasTurnServer = iceServers.some(
        (server) =>
          server &&
          typeof server.urls === "string" &&
          server.urls.startsWith("turn:")
      );
      if (!hasTurnServer) {
        this.netplayShowTurnWarning = true;
      }
      if (this.netplayShowTurnWarning && this.debug) {
        console.warn(
          "WARNING: No TURN addresses are configured! Many clients may fail to connect!"
        );
      }
    }

    if ((this.isMobile || this.hasTouchScreen) && this.virtualGamepad) {
      this.virtualGamepad.classList.add("ejs-vgamepad-active");
      this.canvas.classList.add("ejs-canvas-no-pointer");
    }

    this.fullscreen = false;
    this.enableMouseLock = false;
    this.supportsWebgl2 =
      !!document.createElement("canvas").getContext("webgl2") &&
      this.config.forceLegacyCores !== true;
    this.webgl2Enabled = (() => {
      let setting = this.preGetSetting("webgl2Enabled");
      if (setting === "disabled" || !this.supportsWebgl2) {
        return false;
      } else if (setting === "enabled") {
        return true;
      }
      // Default-on when supported.
      return true;
    })();
    this.isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    if (this.config.disableDatabases) {
      this.storage = {
        rom: new window.EJS_DUMMYSTORAGE(),
        bios: new window.EJS_DUMMYSTORAGE(),
        core: new window.EJS_DUMMYSTORAGE(),
      };
    } else {
      this.storage = {
        rom: new window.EJS_STORAGE("EmulatorJS-roms", "rom"),
        bios: new window.EJS_STORAGE("EmulatorJS-bios", "bios"),
        core: new window.EJS_STORAGE("EmulatorJS-core", "core"),
      };
    }
    // This is not cache. This is save data
    this.storage.states = new window.EJS_STORAGE("EmulatorJS-states", "states");

    this.game.classList.add("ejs_game");
    if (typeof this.config.backgroundImg === "string") {
      this.game.classList.add("ejs_game_background");
      if (this.config.backgroundBlur)
        this.game.classList.add("ejs_game_background_blur");
      this.game.setAttribute(
        "style",
        `--ejs-background-image: url("${this.config.backgroundImg}"); --ejs-background-color: ${this.config.backgroundColor};`
      );
      this.on("start", () => {
        this.game.classList.remove("ejs_game_background");
        if (this.config.backgroundBlur)
          this.game.classList.remove("ejs_game_background_blur");
      });
    } else {
      this.game.setAttribute(
        "style",
        "--ejs-background-color: " + this.config.backgroundColor + ";"
      );
    }

    if (Array.isArray(this.config.cheats)) {
      for (let i = 0; i < this.config.cheats.length; i++) {
        const cheat = this.config.cheats[i];
        if (Array.isArray(cheat) && cheat[0] && cheat[1]) {
          this.cheats.push({
            desc: cheat[0],
            checked: false,
            code: cheat[1],
            is_permanent: true,
          });
        }
      }
    }

    this.createStartButton();
    this.handleResize();

    if (this.config.fixedSaveInterval) {
      this.startSaveInterval(this.config.fixedSaveInterval);
    }
  }

  startSaveInterval(period) {
    if (this.saveSaveInterval) {
      clearInterval(this.saveSaveInterval);
      this.saveSaveInterval = null;
    }
    // Disabled
    if (period === 0 || isNaN(period)) return;
    if (this.started) this.gameManager.saveSaveFiles();
    if (this.debug) console.log("Saving every", period, "miliseconds");
    this.saveSaveInterval = setInterval(() => {
      if (this.started) this.gameManager.saveSaveFiles();
    }, period);
  }

  setColor(color) {
    if (typeof color !== "string") color = "";
    let getColor = function (color) {
      color = color.toLowerCase();
      if (color && /^#([0-9a-fA-f]{3}|[0-9a-fA-f]{6})$/.test(color)) {
        if (color.length === 4) {
          let rv = "#";
          for (let i = 1; i < 4; i++) {
            rv += color.slice(i, i + 1) + color.slice(i, i + 1);
          }
          color = rv;
        }
        let rv = [];
        for (let i = 1; i < 7; i += 2) {
          rv.push(parseInt("0x" + color.slice(i, i + 2), 16));
        }
        return rv.join(", ");
      }
      return null;
    };
    if (!color || getColor(color) === null) {
      this.elements.parent.setAttribute(
        "style",
        "--ejs-primary-color: 26,175,255;"
      );
      return;
    }
    this.elements.parent.setAttribute(
      "style",
      "--ejs-primary-color:" + getColor(color) + ";"
    );
  }
  setupAds(ads, width, height) {
    const div = this.createElement("div");
    const time =
      typeof this.config.adMode === "number" &&
      this.config.adMode > -1 &&
      this.config.adMode < 3
        ? this.config.adMode
        : 2;
    div.classList.add("ejs_ad_iframe");
    const frame = this.createElement("iframe");
    frame.src = ads;
    frame.setAttribute("scrolling", "no");
    frame.setAttribute("frameborder", "no");
    frame.style.width = width;
    frame.style.height = height;
    const closeParent = this.createElement("div");
    closeParent.classList.add("ejs_ad_close");
    const closeButton = this.createElement("a");
    closeParent.appendChild(closeButton);
    closeParent.setAttribute("hidden", "");
    div.appendChild(closeParent);
    div.appendChild(frame);
    if (this.config.adMode !== 1) {
      this.elements.parent.appendChild(div);
    }
    this.addEventListener(closeButton, "click", () => {
      div.remove();
    });

    this.on("start-clicked", () => {
      if (this.config.adMode === 0) div.remove();
      if (this.config.adMode === 1) {
        this.elements.parent.appendChild(div);
      }
    });

    this.on("start", () => {
      closeParent.removeAttribute("hidden");
      const time =
        typeof this.config.adTimer === "number" && this.config.adTimer > 0
          ? this.config.adTimer
          : 10000;
      if (this.config.adTimer === -1) div.remove();
      if (this.config.adTimer === 0) return;
      setTimeout(() => {
        div.remove();
      }, time);
    });
  }
  adBlocked(url, del) {
    if (del) {
      document.querySelector('div[class="ejs_ad_iframe"]').remove();
    } else {
      try {
        document.querySelector('div[class="ejs_ad_iframe"]').remove();
      } catch (e) {}
      this.config.adUrl = url;
      this.setupAds(
        this.config.adUrl,
        this.config.adSize[0],
        this.config.adSize[1]
      );
    }
  }
  on(event, func) {
    if (!this.functions) this.functions = {};
    if (!Array.isArray(this.functions[event])) this.functions[event] = [];
    this.functions[event].push(func);
  }
  callEvent(event, data) {
    if (!this.functions) this.functions = {};
    if (!Array.isArray(this.functions[event])) return 0;
    this.functions[event].forEach((e) => e(data));
    return this.functions[event].length;
  }
  setElements(element) {
    const game = this.createElement("div");
    const elem = document.querySelector(element);
    elem.innerHTML = "";
    elem.appendChild(game);
    this.game = game;

    this.elements = {
      main: this.game,
      parent: elem,
    };
    this.elements.parent.classList.add("ejs_parent");
    this.elements.parent.setAttribute("tabindex", -1);
  }
  // Start button
  createStartButton() {
    const button = this.createElement("div");
    button.classList.add("ejs_start_button");
    let border = 0;
    if (typeof this.config.backgroundImg === "string") {
      button.classList.add("ejs_start_button_border");
      border = 1;
    }
    button.innerText =
      typeof this.config.startBtnName === "string"
        ? this.config.startBtnName
        : this.localization("Start Game");
    if (this.config.alignStartButton == "top") {
      button.style.bottom = "calc(100% - 20px)";
    } else if (this.config.alignStartButton == "center") {
      button.style.bottom = "calc(50% + 22.5px + " + border + "px)";
    }
    this.elements.parent.appendChild(button);
    this.addEventListener(button, "touchstart", () => {
      this.touch = true;
    });
    this.addEventListener(button, "click", this.startButtonClicked.bind(this));
    if (this.config.startOnLoad === true) {
      this.startButtonClicked(button);
    }
    setTimeout(() => {
      this.callEvent("ready");
    }, 20);
  }
  startButtonClicked(e) {
    this.callEvent("start-clicked");
    if (e.pointerType === "touch") {
      this.touch = true;
    }
    if (e.preventDefault) {
      e.preventDefault();
      e.target.remove();
    } else {
      e.remove();
    }
    this.createText();
    this.downloadGameCore();
  }
  // End start button
  createText() {
    this.textElem = this.createElement("div");
    this.textElem.classList.add("ejs_loading_text");
    if (typeof this.config.backgroundImg === "string")
      this.textElem.classList.add("ejs_loading_text_glow");
    this.textElem.innerText = this.localization("Loading...");
    this.elements.parent.appendChild(this.textElem);
  }
  localization(text, log) {
    if (typeof text === "undefined" || text.length === 0) return;
    text = text.toString();
    if (text.includes("EmulatorJS v")) return text;
    if (this.config.langJson) {
      if (typeof log === "undefined") log = true;
      if (!this.config.langJson[text] && log) {
        if (!this.missingLang.includes(text)) this.missingLang.push(text);
        if (this.debug)
          console.log(
            `Translation not found for '${text}'. Language set to '${this.config.language}'`
          );
      }
      return this.config.langJson[text] || text;
    }
    return text;
  }
  checkCompression(data, msg, fileCbFunc) {
    if (!this.compression) {
      this.compression = new window.EJS_COMPRESSION(this);
    }
    if (msg) {
      this.textElem.innerText = msg;
    }
    return this.compression.decompress(
      data,
      (m, appendMsg) => {
        this.textElem.innerText = appendMsg ? msg + m : m;
      },
      fileCbFunc
    );
  }
  checkCoreCompatibility(version) {
    if (
      this.versionAsInt(version.minimumEJSVersion) >
      this.versionAsInt(this.ejs_version)
    ) {
      this.startGameError(this.localization("Outdated EmulatorJS version"));
      throw new Error(
        "Core requires minimum EmulatorJS version of " +
          version.minimumEJSVersion
      );
    }
  }
  startGameError(message) {
    console.log(message);
    this.textElem.innerText = message;
    this.textElem.classList.add("ejs_error_text");

    this.setupSettingsMenu();
    this.loadSettings();

    this.menu.failedToStart();
    this.handleResize();
    this.failedToStart = true;
  }
  downloadGameCore() {
    this.textElem.innerText = this.localization("Download Game Core");
    if (!this.config.threads && this.requiresThreads(this.getCore())) {
      this.startGameError(
        this.localization("Error for site owner") +
          "\n" +
          this.localization("Check console")
      );
      console.warn("This core requires threads, but EJS_threads is not set!");
      return;
    }
    if (!this.supportsWebgl2 && this.requiresWebGL2(this.getCore())) {
      this.startGameError(this.localization("Outdated graphics driver"));
      return;
    }
    if (this.config.threads && typeof window.SharedArrayBuffer !== "function") {
      this.startGameError(
        this.localization("Error for site owner") +
          "\n" +
          this.localization("Check console")
      );
      console.warn(
        "Threads is set to true, but the SharedArrayBuffer function is not exposed. Threads requires 2 headers to be set when sending you html page. See https://stackoverflow.com/a/68630724"
      );
      return;
    }
    const gotCore = (data) => {
      this.defaultCoreOpts = {};
      this.checkCompression(
        new Uint8Array(data),
        this.localization("Decompress Game Core")
      ).then((data) => {
        let js, thread, wasm;
        for (let k in data) {
          if (k.endsWith(".wasm")) {
            wasm = data[k];
          } else if (k.endsWith(".worker.js")) {
            thread = data[k];
          } else if (k.endsWith(".js")) {
            js = data[k];
          } else if (k === "build.json") {
            this.checkCoreCompatibility(
              JSON.parse(new TextDecoder().decode(data[k]))
            );
          } else if (k === "core.json") {
            let core = JSON.parse(new TextDecoder().decode(data[k]));
            this.extensions = core.extensions;
            this.coreName = core.name;
            this.repository = core.repo;
            this.defaultCoreOpts = core.options;
            this.enableMouseLock = core.options.supportsMouse;
            this.retroarchOpts = core.retroarchOpts;
            this.saveFileExt = core.save;
          } else if (k === "license.txt") {
            this.license = new TextDecoder().decode(data[k]);
          }
        }

        if (this.saveFileExt === false) {
          this.elements.bottomBar.saveSavFiles[0].style.display = "none";
          this.elements.bottomBar.loadSavFiles[0].style.display = "none";
        }

        this.initGameCore(js, wasm, thread);
      });
    };
    const report = "cores/reports/" + this.getCore() + ".json";
    this.downloadFile(report, null, false, {
      responseType: "text",
      method: "GET",
    }).then(async (rep) => {
      if (
        rep === -1 ||
        typeof rep === "string" ||
        typeof rep.data === "string"
      ) {
        rep = {};
      } else {
        rep = rep.data;
      }
      if (!rep.buildStart) {
        console.warn(
          "Could not fetch core report JSON! Core caching will be disabled!"
        );
        rep.buildStart = Math.random() * 100;
      }
      if (this.webgl2Enabled === null) {
        this.webgl2Enabled = rep.options ? rep.options.defaultWebGL2 : false;
      }
      if (this.requiresWebGL2(this.getCore())) {
        this.webgl2Enabled = true;
      }
      let threads = false;
      if (typeof window.SharedArrayBuffer === "function") {
        const opt = this.preGetSetting("ejs_threads");
        if (opt) {
          threads = opt === "enabled";
        } else {
          threads = this.config.threads;
        }
      }

      let legacy = this.supportsWebgl2 && this.webgl2Enabled ? "" : "-legacy";
      let filename =
        this.getCore() + (threads ? "-thread" : "") + legacy + "-wasm.data";
      if (!this.debug) {
        const result = await this.storage.core.get(filename);
        if (result && result.version === rep.buildStart) {
          gotCore(result.data);
          return;
        }
      }
      const corePath = "cores/" + filename;
      let res = await this.downloadFile(
        corePath,
        (progress) => {
          this.textElem.innerText =
            this.localization("Download Game Core") + progress;
        },
        false,
        { responseType: "arraybuffer", method: "GET" }
      );
      if (res === -1) {
        console.log("File not found, attemping to fetch from emulatorjs cdn.");
        console.error(
          "**THIS METHOD IS A FAILSAFE, AND NOT OFFICIALLY SUPPORTED. USE AT YOUR OWN RISK**"
        );
        // RomM does not bundle cores; use the upstream EmulatorJS CDN.
        // Default to `nightly` for a consistent "latest cores" location.
        const version =
          typeof window.EJS_CDN_CORES_VERSION === "string" &&
          window.EJS_CDN_CORES_VERSION.length > 0
            ? window.EJS_CDN_CORES_VERSION
            : "nightly";
        res = await this.downloadFile(
          `https://cdn.emulatorjs.org/${version}/data/${corePath}`,
          (progress) => {
            this.textElem.innerText =
              this.localization("Download Game Core") + progress;
          },
          true,
          { responseType: "arraybuffer", method: "GET" }
        );
        if (res === -1) {
          if (!this.supportsWebgl2) {
            this.startGameError(this.localization("Outdated graphics driver"));
          } else {
            this.startGameError(
              this.localization("Error downloading core") +
                " (" +
                filename +
                ")"
            );
          }
          return;
        }
        console.warn(
          "File was not found locally, but was found on the emulatorjs cdn.\nIt is recommended to download the stable release from here: https://cdn.emulatorjs.org/releases/"
        );
      }
      gotCore(res.data);
      this.storage.core.put(filename, {
        version: rep.buildStart,
        data: res.data,
      });
    });
  }
  initGameCore(js, wasm, thread) {
    let script = this.createElement("script");
    script.src = URL.createObjectURL(
      new Blob([js], { type: "application/javascript" })
    );
    script.addEventListener("load", () => {
      this.initModule(wasm, thread);
    });
    document.body.appendChild(script);
  }
  getBaseFileName(force) {
    //Only once game and core is loaded
    if (!this.started && !force) return null;
    if (
      force &&
      this.config.gameUrl !== "game" &&
      !this.config.gameUrl.startsWith("blob:")
    ) {
      return this.config.gameUrl.split("/").pop().split("#")[0].split("?")[0];
    }
    if (typeof this.config.gameName === "string") {
      const invalidCharacters = /[#<$+%>!`&*'|{}/\\?"=@:^\r\n]/gi;
      const name = this.config.gameName.replace(invalidCharacters, "").trim();
      if (name) return name;
    }
    if (!this.fileName) return "game";
    let parts = this.fileName.split(".");
    parts.splice(parts.length - 1, 1);
    return parts.join(".");
  }
  saveInBrowserSupported() {
    return (
      !!window.indexedDB &&
      (typeof this.config.gameName === "string" ||
        !this.config.gameUrl.startsWith("blob:"))
    );
  }
  displayMessage(message, time) {
    if (!this.msgElem) {
      this.msgElem = this.createElement("div");
      this.msgElem.classList.add("ejs_message");
      this.msgElem.style.zIndex = "6";
      this.elements.parent.appendChild(this.msgElem);
    }
    clearTimeout(this.msgTimeout);
    this.msgTimeout = setTimeout(
      () => {
        this.msgElem.innerText = "";
      },
      typeof time === "number" && time > 0 ? time : 3000
    );
    this.msgElem.innerText = message;
  }

  netplayShowHostPausedOverlay() {
    try {
      // Only relevant for spectators/clients.
      if (!this.netplay || this.netplay.owner) return;

      // If an older build created a second overlay element, remove it so we can
      // only ever show the message in one place.
      try {
        if (
          this.netplayHostPausedElem &&
          this.netplayHostPausedElem.parentNode
        ) {
          this.netplayHostPausedElem.parentNode.removeChild(
            this.netplayHostPausedElem
          );
        }
        this.netplayHostPausedElem = null;
      } catch (e) {
        // ignore
      }

      // Standard top-left toast message. Use a long timeout so it effectively
      // persists until host resumes or SFU restarts.
      this.displayMessage("Host has paused emulation", 24 * 60 * 60 * 1000);
    } catch (e) {
      // Best-effort.
    }
  }

  netplayHideHostPausedOverlay() {
    try {
      // Remove legacy overlay element if present.
      try {
        if (
          this.netplayHostPausedElem &&
          this.netplayHostPausedElem.parentNode
        ) {
          this.netplayHostPausedElem.parentNode.removeChild(
            this.netplayHostPausedElem
          );
        }
        this.netplayHostPausedElem = null;
      } catch (e) {
        // ignore
      }

      // Clear the paused message if it's currently being shown.
      if (
        this.msgElem &&
        this.msgElem.innerText === "Host has paused emulation"
      ) {
        clearTimeout(this.msgTimeout);
        this.msgElem.innerText = "";
      }
    } catch (e) {
      // Best-effort.
    }
  }
  downloadStartState() {
    return new Promise((resolve, reject) => {
      if (
        typeof this.config.loadState !== "string" &&
        !this.toData(this.config.loadState, true)
      ) {
        resolve();
        return;
      }
      this.textElem.innerText = this.localization("Download Game State");

      this.downloadFile(
        this.config.loadState,
        (progress) => {
          this.textElem.innerText =
            this.localization("Download Game State") + progress;
        },
        true,
        { responseType: "arraybuffer", method: "GET" }
      ).then((res) => {
        if (res === -1) {
          this.startGameError(
            this.localization("Error downloading game state")
          );
          return;
        }
        this.on("start", () => {
          setTimeout(() => {
            this.gameManager.loadState(new Uint8Array(res.data));
          }, 10);
        });
        resolve();
      });
    });
  }
  downloadGameFile(assetUrl, type, progressMessage, decompressProgressMessage) {
    return new Promise(async (resolve, reject) => {
      if (
        (typeof assetUrl !== "string" || !assetUrl.trim()) &&
        !this.toData(assetUrl, true)
      ) {
        return resolve(assetUrl);
      }
      const gotData = async (input) => {
        const coreFilename = "/" + this.fileName;
        const coreFilePath = coreFilename.substring(
          0,
          coreFilename.length - coreFilename.split("/").pop().length
        );
        if (this.config.dontExtractBIOS === true) {
          this.gameManager.FS.writeFile(
            coreFilePath + assetUrl.split("/").pop(),
            new Uint8Array(input)
          );
          return resolve(assetUrl);
        }
        const data = await this.checkCompression(
          new Uint8Array(input),
          decompressProgressMessage
        );
        for (const k in data) {
          if (k === "!!notCompressedData") {
            this.gameManager.FS.writeFile(
              coreFilePath +
                assetUrl.split("/").pop().split("#")[0].split("?")[0],
              data[k]
            );
            break;
          }
          if (k.endsWith("/")) continue;
          this.gameManager.FS.writeFile(
            coreFilePath + k.split("/").pop(),
            data[k]
          );
        }
      };

      this.textElem.innerText = progressMessage;
      if (!this.debug) {
        const res = await this.downloadFile(assetUrl, null, true, {
          method: "HEAD",
        });
        const result = await this.storage.rom.get(assetUrl.split("/").pop());
        if (
          result &&
          result["content-length"] === res.headers["content-length"] &&
          result.type === type
        ) {
          await gotData(result.data);
          return resolve(assetUrl);
        }
      }
      const res = await this.downloadFile(
        assetUrl,
        (progress) => {
          this.textElem.innerText = progressMessage + progress;
        },
        true,
        { responseType: "arraybuffer", method: "GET" }
      );
      if (res === -1) {
        this.startGameError(this.localization("Network Error"));
        reject();
        return;
      }
      if (assetUrl instanceof File) {
        assetUrl = assetUrl.name;
      } else if (this.toData(assetUrl, true)) {
        assetUrl = "game";
      }
      await gotData(res.data);
      resolve(assetUrl);
      const limit =
        typeof this.config.cacheLimit === "number"
          ? this.config.cacheLimit
          : 1073741824;
      if (
        parseFloat(res.headers["content-length"]) < limit &&
        this.saveInBrowserSupported() &&
        assetUrl !== "game"
      ) {
        this.storage.rom.put(assetUrl.split("/").pop(), {
          "content-length": res.headers["content-length"],
          data: res.data,
          type: type,
        });
      }
    });
  }
  downloadGamePatch() {
    return new Promise(async (resolve) => {
      this.config.gamePatchUrl = await this.downloadGameFile(
        this.config.gamePatchUrl,
        "patch",
        this.localization("Download Game Patch"),
        this.localization("Decompress Game Patch")
      );
      resolve();
    });
  }
  downloadGameParent() {
    return new Promise(async (resolve) => {
      this.config.gameParentUrl = await this.downloadGameFile(
        this.config.gameParentUrl,
        "parent",
        this.localization("Download Game Parent"),
        this.localization("Decompress Game Parent")
      );
      resolve();
    });
  }
  downloadBios() {
    return new Promise(async (resolve) => {
      this.config.biosUrl = await this.downloadGameFile(
        this.config.biosUrl,
        "bios",
        this.localization("Download Game BIOS"),
        this.localization("Decompress Game BIOS")
      );
      resolve();
    });
  }
  downloadRom() {
    const supportsExt = (ext) => {
      const core = this.getCore();
      if (!this.extensions) return false;
      return this.extensions.includes(ext);
    };

    return new Promise((resolve) => {
      this.textElem.innerText = this.localization("Download Game Data");

      const gotGameData = (data) => {
        const coreName = this.getCore(true);
        const altName = this.getBaseFileName(true);
        if (
          ["arcade", "mame"].includes(coreName) ||
          this.config.dontExtractRom === true
        ) {
          this.fileName = altName;
          this.gameManager.FS.writeFile(this.fileName, new Uint8Array(data));
          resolve();
          return;
        }

        // List of cores to generate a CUE file for, if it doesn't exist.
        const cueGeneration = ["mednafen_psx_hw"];
        const prioritizeExtensions = ["cue", "ccd", "toc", "m3u"];

        let createCueFile = cueGeneration.includes(this.getCore());
        if (this.config.disableCue === true) {
          createCueFile = false;
        }

        let fileNames = [];
        this.checkCompression(
          new Uint8Array(data),
          this.localization("Decompress Game Data"),
          (fileName, fileData) => {
            if (fileName.includes("/")) {
              const paths = fileName.split("/");
              let cp = "";
              for (let i = 0; i < paths.length - 1; i++) {
                if (paths[i] === "") continue;
                cp += `/${paths[i]}`;
                if (!this.gameManager.FS.analyzePath(cp).exists) {
                  this.gameManager.FS.mkdir(cp);
                }
              }
            }
            if (fileName.endsWith("/")) {
              this.gameManager.FS.mkdir(fileName);
              return;
            }
            if (fileName === "!!notCompressedData") {
              this.gameManager.FS.writeFile(altName, fileData);
              fileNames.push(altName);
            } else {
              this.gameManager.FS.writeFile(`/${fileName}`, fileData);
              fileNames.push(fileName);
            }
          }
        ).then(() => {
          let isoFile = null;
          let supportedFile = null;
          let cueFile = null;
          fileNames.forEach((fileName) => {
            const ext = fileName.split(".").pop().toLowerCase();
            if (supportedFile === null && supportsExt(ext)) {
              supportedFile = fileName;
            }
            if (
              isoFile === null &&
              ["iso", "cso", "chd", "elf"].includes(ext)
            ) {
              isoFile = fileName;
            }
            if (prioritizeExtensions.includes(ext)) {
              const currentCueExt =
                cueFile === null
                  ? null
                  : cueFile.split(".").pop().toLowerCase();
              if (coreName === "psx") {
                // Always prefer m3u files for psx cores
                if (currentCueExt !== "m3u") {
                  if (cueFile === null || ext === "m3u") {
                    cueFile = fileName;
                  }
                }
              } else {
                const priority = ["cue", "ccd"];
                // Prefer cue or ccd files over toc or m3u
                if (!priority.includes(currentCueExt)) {
                  if (cueFile === null || priority.includes(ext)) {
                    cueFile = fileName;
                  }
                }
              }
            }
          });
          if (supportedFile !== null) {
            this.fileName = supportedFile;
          } else {
            this.fileName = fileNames[0];
          }
          if (
            isoFile !== null &&
            supportsExt(isoFile.split(".").pop().toLowerCase())
          ) {
            this.fileName = isoFile;
          }
          if (
            cueFile !== null &&
            supportsExt(cueFile.split(".").pop().toLowerCase())
          ) {
            this.fileName = cueFile;
          } else if (
            createCueFile &&
            supportsExt("m3u") &&
            supportsExt("cue")
          ) {
            this.fileName = this.gameManager.createCueFile(fileNames);
          }
          if (this.getCore(true) === "dos" && !this.config.disableBatchBootup) {
            this.fileName = this.gameManager.writeBootupBatchFile();
          }
          resolve();
        });
      };
      const downloadFile = async () => {
        const res = await this.downloadFile(
          this.config.gameUrl,
          (progress) => {
            this.textElem.innerText =
              this.localization("Download Game Data") + progress;
          },
          true,
          { responseType: "arraybuffer", method: "GET" }
        );
        if (res === -1) {
          this.startGameError(this.localization("Network Error"));
          return;
        }
        if (this.config.gameUrl instanceof File) {
          this.config.gameUrl = this.config.gameUrl.name;
        } else if (this.toData(this.config.gameUrl, true)) {
          this.config.gameUrl = "game";
        }
        gotGameData(res.data);
        const limit =
          typeof this.config.cacheLimit === "number"
            ? this.config.cacheLimit
            : 1073741824;
        if (
          parseFloat(res.headers["content-length"]) < limit &&
          this.saveInBrowserSupported() &&
          this.config.gameUrl !== "game"
        ) {
          this.storage.rom.put(this.config.gameUrl.split("/").pop(), {
            "content-length": res.headers["content-length"],
            data: res.data,
          });
        }
      };

      if (!this.debug) {
        this.downloadFile(this.config.gameUrl, null, true, {
          method: "HEAD",
        }).then(async (res) => {
          const name =
            typeof this.config.gameUrl === "string"
              ? this.config.gameUrl.split("/").pop()
              : "game";
          const result = await this.storage.rom.get(name);
          if (
            result &&
            result["content-length"] === res.headers["content-length"] &&
            name !== "game"
          ) {
            gotGameData(result.data);
            return;
          }
          downloadFile();
        });
      } else {
        downloadFile();
      }
    });
  }
  downloadFiles() {
    (async () => {
      this.gameManager = new window.EJS_GameManager(this.Module, this);
      await this.gameManager.loadExternalFiles();
      await this.gameManager.mountFileSystems();
      this.callEvent("saveDatabaseLoaded", this.gameManager.FS);
      if (this.getCore() === "ppsspp") {
        await this.gameManager.loadPpssppAssets();
      }
      await this.downloadRom();
      await this.downloadBios();
      await this.downloadStartState();
      await this.downloadGameParent();
      await this.downloadGamePatch();
      this.startGame();
    })();
  }
  initModule(wasmData, threadData) {
    if (typeof window.EJS_Runtime !== "function") {
      console.warn("EJS_Runtime is not defined!");
      this.startGameError(
        this.localization("Error loading EmulatorJS runtime")
      );
      throw new Error("EJS_Runtime is not defined!");
    }

    // Firefox tends to be more sensitive to WebAudio scheduling jitter.
    // Apply a small compatibility patch that nudges towards stability
    // (higher latency + larger ScriptProcessor buffers when used).
    if (!this._ejsWebAudioStabilityPatched) {
      const ua =
        typeof navigator !== "undefined" && navigator.userAgent
          ? navigator.userAgent
          : "";
      const isFirefox = /firefox\//i.test(ua);
      const enabled =
        !(this.config && this.config.firefoxAudioStability === false) &&
        isFirefox;

      if (enabled) {
        const desiredLatencyHint =
          this.config && typeof this.config.audioLatencyHint !== "undefined"
            ? this.config.audioLatencyHint
            : "playback";
        const minScriptProcessorBufferSize =
          this.config &&
          typeof this.config.audioMinScriptProcessorBufferSize === "number"
            ? this.config.audioMinScriptProcessorBufferSize
            : 8192;

        const installWebAudioStabilityPatch = () => {
          const originalAudioContext = window.AudioContext;
          const originalWebkitAudioContext = window.webkitAudioContext;
          const cleanups = [];

          const wrapAudioContextConstructor = (Ctor, assign) => {
            if (typeof Ctor !== "function") return;

            function PatchedAudioContext(options) {
              const nextOptions =
                options && typeof options === "object" ? { ...options } : {};

              if (
                typeof desiredLatencyHint !== "undefined" &&
                desiredLatencyHint !== null &&
                typeof nextOptions.latencyHint === "undefined"
              ) {
                nextOptions.latencyHint = desiredLatencyHint;
              }

              return Reflect.construct(
                Ctor,
                [nextOptions],
                PatchedAudioContext
              );
            }

            PatchedAudioContext.prototype = Ctor.prototype;
            Object.setPrototypeOf(PatchedAudioContext, Ctor);
            assign(PatchedAudioContext);
            cleanups.push(() => assign(Ctor));
          };

          // Patch constructors to supply a default latencyHint.
          wrapAudioContextConstructor(originalAudioContext, (v) => {
            window.AudioContext = v;
          });
          wrapAudioContextConstructor(originalWebkitAudioContext, (v) => {
            window.webkitAudioContext = v;
          });

          // Patch ScriptProcessor buffer size when used (older emscripten paths).
          // Only override explicit small sizes; keep 0 (browser-chosen) as-is.
          if (
            originalAudioContext &&
            originalAudioContext.prototype &&
            typeof originalAudioContext.prototype.createScriptProcessor ===
              "function"
          ) {
            const originalCreateScriptProcessor =
              originalAudioContext.prototype.createScriptProcessor;
            originalAudioContext.prototype.createScriptProcessor = function (
              bufferSize,
              numberOfInputChannels,
              numberOfOutputChannels
            ) {
              let nextBufferSize = bufferSize;
              if (
                typeof bufferSize === "number" &&
                bufferSize > 0 &&
                bufferSize < minScriptProcessorBufferSize
              ) {
                nextBufferSize = minScriptProcessorBufferSize;
              }
              return originalCreateScriptProcessor.call(
                this,
                nextBufferSize,
                numberOfInputChannels,
                numberOfOutputChannels
              );
            };
            cleanups.push(() => {
              originalAudioContext.prototype.createScriptProcessor =
                originalCreateScriptProcessor;
            });
          }

          return () => {
            for (let i = cleanups.length - 1; i >= 0; i--) {
              try {
                cleanups[i]();
              } catch (e) {}
            }
          };
        };

        this._ejsWebAudioStabilityPatched = true;
        this._ejsUninstallWebAudioStabilityPatch =
          installWebAudioStabilityPatch();
        this.on("exit", () => {
          if (typeof this._ejsUninstallWebAudioStabilityPatch === "function") {
            try {
              this._ejsUninstallWebAudioStabilityPatch();
            } catch (e) {}
          }
          this._ejsUninstallWebAudioStabilityPatch = null;
          this._ejsWebAudioStabilityPatched = false;
        });

        if (this.debug) {
          console.log(
            "Firefox WebAudio stability patch enabled:",
            "latencyHint=",
            desiredLatencyHint,
            "minScriptProcessorBufferSize=",
            minScriptProcessorBufferSize
          );
        }
      }
    }

    window
      .EJS_Runtime({
        noInitialRun: true,
        onRuntimeInitialized: null,
        arguments: [],
        preRun: [],
        postRun: [],
        canvas: this.canvas,
        callbacks: {},
        parent: this.elements.parent,
        print: (msg) => {
          if (this.debug) {
            console.log(msg);
          }
        },
        printErr: (msg) => {
          if (this.debug) {
            console.log(msg);
          }
        },
        totalDependencies: 0,
        locateFile: function (fileName) {
          if (this.debug) console.log(fileName);
          if (fileName.endsWith(".wasm")) {
            return URL.createObjectURL(
              new Blob([wasmData], { type: "application/wasm" })
            );
          } else if (fileName.endsWith(".worker.js")) {
            return URL.createObjectURL(
              new Blob([threadData], { type: "application/javascript" })
            );
          }
        },
        getSavExt: () => {
          if (this.saveFileExt) {
            return "." + this.saveFileExt;
          }
          return ".srm";
        },
      })
      .then((module) => {
        this.Module = module;
        this.downloadFiles();
      })
      .catch((e) => {
        console.warn(e);
        this.startGameError(this.localization("Failed to start game"));
      });
  }
  startGame() {
    try {
      const args = [];
      if (this.debug) args.push("-v");
      args.push("/" + this.fileName);
      if (this.debug) console.log(args);

      if (this.textElem) {
        this.textElem.remove();
        this.textElem = null;
      }
      this.game.classList.remove("ejs_game");
      this.game.classList.add("ejs_canvas_parent");
      if (!this.canvas.isConnected) {
        this.game.appendChild(this.canvas);
      }

      let initialResolution;
      if (
        this.Module &&
        typeof this.Module.getNativeResolution === "function"
      ) {
        try {
          initialResolution = this.Module.getNativeResolution();
        } catch (e) {}
      }
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const rect = this.canvas.getBoundingClientRect();
      const displayWidth = Math.floor((rect.width || 0) * dpr);
      const displayHeight = Math.floor((rect.height || 0) * dpr);
      const nativeWidth = Math.floor(
        (initialResolution && initialResolution.width) || 0
      );
      const nativeHeight = Math.floor(
        (initialResolution && initialResolution.height) || 0
      );
      const initialWidth = Math.max(
        1,
        displayWidth,
        nativeWidth,
        Math.floor(640 * dpr)
      );
      const initialHeight = Math.max(
        1,
        displayHeight,
        nativeHeight,
        Math.floor(480 * dpr)
      );
      this.canvas.width = initialWidth;
      this.canvas.height = initialHeight;
      if (this.Module && typeof this.Module.setCanvasSize === "function") {
        this.Module.setCanvasSize(initialWidth, initialHeight);
      }

      this.handleResize();
      this.Module.callMain(args);
      if (
        typeof this.config.softLoad === "number" &&
        this.config.softLoad > 0
      ) {
        this.resetTimeout = setTimeout(() => {
          this.gameManager.restart();
        }, this.config.softLoad * 1000);
      }
      this.Module.resumeMainLoop();
      this.checkSupportedOpts();
      this.setupDisksMenu();
      // hide the disks menu if the disk count is not greater than 1
      if (!(this.gameManager.getDiskCount() > 1)) {
        this.diskParent.style.display = "none";
      }
      this.setupSettingsMenu();
      this.loadSettings();
      this.updateCheatUI();
      this.updateGamepadLabels();
      if (!this.muted) this.setVolume(this.volume);
      if (this.config.noAutoFocus !== true) this.elements.parent.focus();
      this.started = true;
      this.paused = false;
      if (this.touch) {
        this.virtualGamepad.style.display = "";
      }
      this.handleResize();
      if (this.config.fullscreenOnLoad) {
        try {
          this.toggleFullscreen(true);
        } catch (e) {
          if (this.debug) console.warn("Could not fullscreen on load");
        }
      }
      this.menu.open();
      if (this.isSafari && this.isMobile) {
        //Safari is --- funny
        this.checkStarted();
      }
    } catch (e) {
      console.warn("Failed to start game", e);
      this.startGameError(this.localization("Failed to start game"));
      this.callEvent("exit");
      return;
    }
    this.callEvent("start");
  }
  checkStarted() {
    (async () => {
      let sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      let state = "suspended";
      let popup;
      while (state === "suspended") {
        if (!this.Module.AL) return;
        this.Module.AL.currentCtx.sources.forEach((ctx) => {
          state = ctx.gain.context.state;
        });
        if (state !== "suspended") break;
        if (!popup) {
          popup = this.createPopup("", {});
          const button = this.createElement("button");
          button.innerText = this.localization("Click to resume Emulator");
          button.classList.add("ejs_menu_button");
          button.style.width = "25%";
          button.style.height = "25%";
          popup.appendChild(button);
          popup.style["text-align"] = "center";
          popup.style["font-size"] = "28px";
        }
        await sleep(10);
      }
      if (popup) this.closePopup();
    })();
  }
  bindListeners() {
    this.createContextMenu();
    this.createBottomMenuBar();
    this.createControlSettingMenu();
    this.createCheatsMenu();
    this.createNetplayMenu();
    this.setVirtualGamepad();
    this.addEventListener(
      this.elements.parent,
      "keydown keyup",
      this.keyChange.bind(this)
    );
    this.addEventListener(this.elements.parent, "mousedown touchstart", (e) => {
      if (
        document.activeElement !== this.elements.parent &&
        this.config.noAutoFocus !== true
      )
        this.elements.parent.focus();
    });
    this.addEventListener(window, "resize", this.handleResize.bind(this));
    //this.addEventListener(window, "blur", e => console.log(e), true); //TODO - add "click to make keyboard keys work" message?

    let counter = 0;
    this.elements.statePopupPanel = this.createPopup("", {}, true);
    this.elements.statePopupPanel.innerText = this.localization(
      "Drop save state here to load"
    );
    this.elements.statePopupPanel.style["text-align"] = "center";
    this.elements.statePopupPanel.style["font-size"] = "28px";

    //to fix a funny apple bug
    this.addEventListener(
      window,
      "webkitfullscreenchange mozfullscreenchange fullscreenchange MSFullscreenChange",
      () => {
        setTimeout(() => {
          this.handleResize.bind(this);
          if (this.config.noAutoFocus !== true) this.elements.parent.focus();
        }, 0);
      }
    );
    this.addEventListener(window, "beforeunload", (e) => {
      if (this.config.disableAutoUnload) {
        e.preventDefault();
        e.returnValue = "";
        return;
      }
      if (!this.started) return;
      this.callEvent("exit");
    });
    this.addEventListener(this.elements.parent, "dragenter", (e) => {
      e.preventDefault();
      if (!this.started) return;
      counter++;
      this.elements.statePopupPanel.parentElement.style.display = "block";
    });
    this.addEventListener(this.elements.parent, "dragover", (e) => {
      e.preventDefault();
    });
    this.addEventListener(this.elements.parent, "dragleave", (e) => {
      e.preventDefault();
      if (!this.started) return;
      counter--;
      if (counter === 0) {
        this.elements.statePopupPanel.parentElement.style.display = "none";
      }
    });
    this.addEventListener(this.elements.parent, "dragend", (e) => {
      e.preventDefault();
      if (!this.started) return;
      counter = 0;
      this.elements.statePopupPanel.parentElement.style.display = "none";
    });

    this.addEventListener(this.elements.parent, "drop", (e) => {
      e.preventDefault();
      if (!this.started) return;
      this.elements.statePopupPanel.parentElement.style.display = "none";
      counter = 0;
      const items = e.dataTransfer.items;
      let file;
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind !== "file") continue;
        file = items[i];
        break;
      }
      if (!file) return;
      const fileHandle = file.getAsFile();
      fileHandle.arrayBuffer().then((data) => {
        this.gameManager.loadState(new Uint8Array(data));
      });
    });

    this.gamepad = new GamepadHandler(); //https://github.com/ethanaobrien/Gamepad
    this.gamepad.on("connected", (e) => {
      if (!this.gamepadLabels) return;
      for (let i = 0; i < this.gamepadSelection.length; i++) {
        if (this.gamepadSelection[i] === "") {
          this.gamepadSelection[i] =
            this.gamepad.gamepads[e.gamepadIndex].id +
            "_" +
            this.gamepad.gamepads[e.gamepadIndex].index;
          break;
        }
      }
      this.updateGamepadLabels();
    });
    this.gamepad.on("disconnected", (e) => {
      const gamepadIndex = this.gamepad.gamepads.indexOf(
        this.gamepad.gamepads.find((f) => f.index == e.gamepadIndex)
      );
      const gamepadSelection =
        this.gamepad.gamepads[gamepadIndex].id +
        "_" +
        this.gamepad.gamepads[gamepadIndex].index;
      for (let i = 0; i < this.gamepadSelection.length; i++) {
        if (this.gamepadSelection[i] === gamepadSelection) {
          this.gamepadSelection[i] = "";
        }
      }
      setTimeout(this.updateGamepadLabels.bind(this), 10);
    });
    this.gamepad.on("axischanged", this.gamepadEvent.bind(this));
    this.gamepad.on("buttondown", this.gamepadEvent.bind(this));
    this.gamepad.on("buttonup", this.gamepadEvent.bind(this));
  }
  checkSupportedOpts() {
    if (!this.gameManager.supportsStates()) {
      this.elements.bottomBar.saveState[0].style.display = "none";
      this.elements.bottomBar.loadState[0].style.display = "none";
      this.elements.contextMenu.save.style.display = "none";
      this.elements.contextMenu.load.style.display = "none";
    }
    if (!this.config.netplayUrl || this.netplayEnabled === false) {
      this.elements.bottomBar.netplay[0].style.display = "none";
    }

    // Netplay listing uses gameId as a query param, but the server can safely
    // ignore it. Do not hide netplay just because the embedding page didn't
    // provide a numeric ID.
    if (typeof this.config.gameId !== "number") {
      this.config.gameId = 0;
    }
  }
  updateGamepadLabels() {
    for (let i = 0; i < this.gamepadLabels.length; i++) {
      this.gamepadLabels[i].innerHTML = "";
      const def = this.createElement("option");
      def.setAttribute("value", "notconnected");
      def.innerText = "Not Connected";
      this.gamepadLabels[i].appendChild(def);
      for (let j = 0; j < this.gamepad.gamepads.length; j++) {
        const opt = this.createElement("option");
        opt.setAttribute(
          "value",
          this.gamepad.gamepads[j].id + "_" + this.gamepad.gamepads[j].index
        );
        opt.innerText =
          this.gamepad.gamepads[j].id + "_" + this.gamepad.gamepads[j].index;
        this.gamepadLabels[i].appendChild(opt);
      }
      this.gamepadLabels[i].value = this.gamepadSelection[i] || "notconnected";
    }
  }
  createLink(elem, link, text, useP) {
    const elm = this.createElement("a");
    elm.href = link;
    elm.target = "_blank";
    elm.innerText = this.localization(text);
    if (useP) {
      const p = this.createElement("p");
      p.appendChild(elm);
      elem.appendChild(p);
    } else {
      elem.appendChild(elm);
    }
  }
  defaultButtonOptions = {
    playPause: {
      visible: true,
      icon: "play",
      displayName: "Play/Pause",
    },
    play: {
      visible: true,
      icon: '<svg viewBox="0 0 320 512"><path d="M361 215C375.3 223.8 384 239.3 384 256C384 272.7 375.3 288.2 361 296.1L73.03 472.1C58.21 482 39.66 482.4 24.52 473.9C9.377 465.4 0 449.4 0 432V80C0 62.64 9.377 46.63 24.52 38.13C39.66 29.64 58.21 29.99 73.03 39.04L361 215z"/></svg>',
      displayName: "Play",
    },
    pause: {
      visible: true,
      icon: '<svg viewBox="0 0 320 512"><path d="M272 63.1l-32 0c-26.51 0-48 21.49-48 47.1v288c0 26.51 21.49 48 48 48L272 448c26.51 0 48-21.49 48-48v-288C320 85.49 298.5 63.1 272 63.1zM80 63.1l-32 0c-26.51 0-48 21.49-48 48v288C0 426.5 21.49 448 48 448l32 0c26.51 0 48-21.49 48-48v-288C128 85.49 106.5 63.1 80 63.1z"/></svg>',
      displayName: "Pause",
    },
    restart: {
      visible: true,
      icon: '<svg viewBox="0 0 512 512"><path d="M496 48V192c0 17.69-14.31 32-32 32H320c-17.69 0-32-14.31-32-32s14.31-32 32-32h63.39c-29.97-39.7-77.25-63.78-127.6-63.78C167.7 96.22 96 167.9 96 256s71.69 159.8 159.8 159.8c34.88 0 68.03-11.03 95.88-31.94c14.22-10.53 34.22-7.75 44.81 6.375c10.59 14.16 7.75 34.22-6.375 44.81c-39.03 29.28-85.36 44.86-134.2 44.86C132.5 479.9 32 379.4 32 256s100.5-223.9 223.9-223.9c69.15 0 134 32.47 176.1 86.12V48c0-17.69 14.31-32 32-32S496 30.31 496 48z"/></svg>',
      displayName: "Restart",
    },
    mute: {
      visible: true,
      icon: '<svg viewBox="0 0 640 512"><path d="M412.6 182c-10.28-8.334-25.41-6.867-33.75 3.402c-8.406 10.24-6.906 25.35 3.375 33.74C393.5 228.4 400 241.8 400 255.1c0 14.17-6.5 27.59-17.81 36.83c-10.28 8.396-11.78 23.5-3.375 33.74c4.719 5.806 11.62 8.802 18.56 8.802c5.344 0 10.75-1.779 15.19-5.399C435.1 311.5 448 284.6 448 255.1S435.1 200.4 412.6 182zM473.1 108.2c-10.22-8.334-25.34-6.898-33.78 3.34c-8.406 10.24-6.906 25.35 3.344 33.74C476.6 172.1 496 213.3 496 255.1s-19.44 82.1-53.31 110.7c-10.25 8.396-11.75 23.5-3.344 33.74c4.75 5.775 11.62 8.771 18.56 8.771c5.375 0 10.75-1.779 15.22-5.431C518.2 366.9 544 313 544 255.1S518.2 145 473.1 108.2zM534.4 33.4c-10.22-8.334-25.34-6.867-33.78 3.34c-8.406 10.24-6.906 25.35 3.344 33.74C559.9 116.3 592 183.9 592 255.1s-32.09 139.7-88.06 185.5c-10.25 8.396-11.75 23.5-3.344 33.74C505.3 481 512.2 484 519.2 484c5.375 0 10.75-1.779 15.22-5.431C601.5 423.6 640 342.5 640 255.1S601.5 88.34 534.4 33.4zM301.2 34.98c-11.5-5.181-25.01-3.076-34.43 5.29L131.8 160.1H48c-26.51 0-48 21.48-48 47.96v95.92c0 26.48 21.49 47.96 48 47.96h83.84l134.9 119.8C272.7 477 280.3 479.8 288 479.8c4.438 0 8.959-.9314 13.16-2.835C312.7 471.8 320 460.4 320 447.9V64.12C320 51.55 312.7 40.13 301.2 34.98z"/></svg>',
      displayName: "Mute",
    },
    unmute: {
      visible: true,
      icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512"><path d="M301.2 34.85c-11.5-5.188-25.02-3.122-34.44 5.253L131.8 160H48c-26.51 0-48 21.49-48 47.1v95.1c0 26.51 21.49 47.1 48 47.1h83.84l134.9 119.9c5.984 5.312 13.58 8.094 21.26 8.094c4.438 0 8.972-.9375 13.17-2.844c11.5-5.156 18.82-16.56 18.82-29.16V64C319.1 51.41 312.7 40 301.2 34.85zM513.9 255.1l47.03-47.03c9.375-9.375 9.375-24.56 0-33.94s-24.56-9.375-33.94 0L480 222.1L432.1 175c-9.375-9.375-24.56-9.375-33.94 0s-9.375 24.56 0 33.94l47.03 47.03l-47.03 47.03c-9.375 9.375-9.375 24.56 0 33.94c9.373 9.373 24.56 9.381 33.94 0L480 289.9l47.03 47.03c9.373 9.373 24.56 9.381 33.94 0c9.375-9.375 9.375-24.56 0-33.94L513.9 255.1z"/></svg>',
      displayName: "Unmute",
    },
    settings: {
      visible: true,
      icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M495.9 166.6C499.2 175.2 496.4 184.9 489.6 191.2L446.3 230.6C447.4 238.9 448 247.4 448 256C448 264.6 447.4 273.1 446.3 281.4L489.6 320.8C496.4 327.1 499.2 336.8 495.9 345.4C491.5 357.3 486.2 368.8 480.2 379.7L475.5 387.8C468.9 398.8 461.5 409.2 453.4 419.1C447.4 426.2 437.7 428.7 428.9 425.9L373.2 408.1C359.8 418.4 344.1 427 329.2 433.6L316.7 490.7C314.7 499.7 307.7 506.1 298.5 508.5C284.7 510.8 270.5 512 255.1 512C241.5 512 227.3 510.8 213.5 508.5C204.3 506.1 197.3 499.7 195.3 490.7L182.8 433.6C167 427 152.2 418.4 138.8 408.1L83.14 425.9C74.3 428.7 64.55 426.2 58.63 419.1C50.52 409.2 43.12 398.8 36.52 387.8L31.84 379.7C25.77 368.8 20.49 357.3 16.06 345.4C12.82 336.8 15.55 327.1 22.41 320.8L65.67 281.4C64.57 273.1 64 264.6 64 256C64 247.4 64.57 238.9 65.67 230.6L22.41 191.2C15.55 184.9 12.82 175.3 16.06 166.6C20.49 154.7 25.78 143.2 31.84 132.3L36.51 124.2C43.12 113.2 50.52 102.8 58.63 92.95C64.55 85.8 74.3 83.32 83.14 86.14L138.8 103.9C152.2 93.56 167 84.96 182.8 78.43L195.3 21.33C197.3 12.25 204.3 5.04 213.5 3.51C227.3 1.201 241.5 0 256 0C270.5 0 284.7 1.201 298.5 3.51C307.7 5.04 314.7 12.25 316.7 21.33L329.2 78.43C344.1 84.96 359.8 93.56 373.2 103.9L428.9 86.14C437.7 83.32 447.4 85.8 453.4 92.95C461.5 102.8 468.9 113.2 475.5 124.2L480.2 132.3C486.2 143.2 491.5 154.7 495.9 166.6V166.6zM256 336C300.2 336 336 300.2 336 255.1C336 211.8 300.2 175.1 256 175.1C211.8 175.1 176 211.8 176 255.1C176 300.2 211.8 336 256 336z"/></svg>',
      displayName: "Settings",
    },
    fullscreen: {
      visible: true,
      icon: "fullscreen",
      displayName: "Fullscreen",
    },
    enterFullscreen: {
      visible: true,
      icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M208 281.4c-12.5-12.5-32.76-12.5-45.26-.002l-78.06 78.07l-30.06-30.06c-6.125-6.125-14.31-9.367-22.63-9.367c-4.125 0-8.279 .7891-12.25 2.43c-11.97 4.953-19.75 16.62-19.75 29.56v135.1C.0013 501.3 10.75 512 24 512h136c12.94 0 24.63-7.797 29.56-19.75c4.969-11.97 2.219-25.72-6.938-34.87l-30.06-30.06l78.06-78.07c12.5-12.49 12.5-32.75 .002-45.25L208 281.4zM487.1 0h-136c-12.94 0-24.63 7.797-29.56 19.75c-4.969 11.97-2.219 25.72 6.938 34.87l30.06 30.06l-78.06 78.07c-12.5 12.5-12.5 32.76 0 45.26l22.62 22.62c12.5 12.5 32.76 12.5 45.26 0l78.06-78.07l30.06 30.06c9.156 9.141 22.87 11.84 34.87 6.937C504.2 184.6 512 172.9 512 159.1V23.1C512 10.74 501.3 0 487.1 0z"/></svg>',
      displayName: "Enter Fullscreen",
    },
    exitFullscreen: {
      visible: true,
      icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M215.1 272h-136c-12.94 0-24.63 7.797-29.56 19.75C45.47 303.7 48.22 317.5 57.37 326.6l30.06 30.06l-78.06 78.07c-12.5 12.5-12.5 32.75-.0012 45.25l22.62 22.62c12.5 12.5 32.76 12.5 45.26 .0013l78.06-78.07l30.06 30.06c6.125 6.125 14.31 9.367 22.63 9.367c4.125 0 8.279-.7891 12.25-2.43c11.97-4.953 19.75-16.62 19.75-29.56V296C239.1 282.7 229.3 272 215.1 272zM296 240h136c12.94 0 24.63-7.797 29.56-19.75c4.969-11.97 2.219-25.72-6.938-34.87l-30.06-30.06l78.06-78.07c12.5-12.5 12.5-32.76 .0002-45.26l-22.62-22.62c-12.5-12.5-32.76-12.5-45.26-.0003l-78.06 78.07l-30.06-30.06c-9.156-9.141-22.87-11.84-34.87-6.937c-11.97 4.953-19.75 16.62-19.75 29.56v135.1C272 229.3 282.7 240 296 240z"/></svg>',
      displayName: "Exit Fullscreen",
    },
    saveState: {
      visible: true,
      icon: '<svg viewBox="0 0 448 512"><path fill="currentColor" d="M433.941 129.941l-83.882-83.882A48 48 0 0 0 316.118 32H48C21.49 32 0 53.49 0 80v352c0 26.51 21.49 48 48 48h352c26.51 0 48-21.49 48-48V163.882a48 48 0 0 0-14.059-33.941zM224 416c-35.346 0-64-28.654-64-64 0-35.346 28.654-64 64-64s64 28.654 64 64c0 35.346-28.654 64-64 64zm96-304.52V212c0 6.627-5.373 12-12 12H76c-6.627 0-12-5.373-12-12V108c0-6.627 5.373-12 12-12h228.52c3.183 0 6.235 1.264 8.485 3.515l3.48 3.48A11.996 11.996 0 0 1 320 111.48z"/></svg>',
      displayName: "Save State",
    },
    loadState: {
      visible: true,
      icon: '<svg viewBox="0 0 576 512"><path fill="currentColor" d="M572.694 292.093L500.27 416.248A63.997 63.997 0 0 1 444.989 448H45.025c-18.523 0-30.064-20.093-20.731-36.093l72.424-124.155A64 64 0 0 1 152 256h399.964c18.523 0 30.064 20.093 20.73 36.093zM152 224h328v-48c0-26.51-21.49-48-48-48H272l-64-64H48C21.49 64 0 85.49 0 112v278.046l69.077-118.418C86.214 242.25 117.989 224 152 224z"/></svg>',
      displayName: "Load State",
    },
    screenRecord: {
      visible: true,
    },
    gamepad: {
      visible: true,
      icon: '<svg viewBox="0 0 640 512"><path fill="currentColor" d="M480 96H160C71.6 96 0 167.6 0 256s71.6 160 160 160c44.8 0 85.2-18.4 114.2-48h91.5c29 29.6 69.5 48 114.2 48 88.4 0 160-71.6 160-160S568.4 96 480 96zM256 276c0 6.6-5.4 12-12 12h-52v52c0 6.6-5.4 12-12 12h-40c-6.6 0-12-5.4-12-12v-52H76c-6.6 0-12-5.4-12-12v-40c0-6.6 5.4-12 12-12h52v-52c0-6.6 5.4-12 12-12h40c6.6 0 12 5.4 12 12v52h52c6.6 0 12 5.4 12 12v40zm184 68c-26.5 0-48-21.5-48-48s21.5-48 48-48 48 21.5 48 48-21.5 48-48 48zm80-80c-26.5 0-48-21.5-48-48s21.5-48 48-48 48 21.5 48 48-21.5 48-48 48z"/></svg>',
      displayName: "Control Settings",
    },
    cheat: {
      visible: true,
      icon: '<svg viewBox="0 0 496 512"><path fill="currentColor" d="M248 8C111 8 0 119 0 256s111 248 248 248 248-111 248-248S385 8 248 8zm0 448c-110.3 0-200-89.7-200-200S137.7 56 248 56s200 89.7 200 200-89.7 200-200 200zm-80-216c17.7 0 32-14.3 32-32s-14.3-32-32-32-32 14.3-32 32 14.3 32 32 32zm160 0c17.7 0 32-14.3 32-32s-14.3-32-32-32-32 14.3-32 32 14.3 32 32 32zm4 72.6c-20.8 25-51.5 39.4-84 39.4s-63.2-14.3-84-39.4c-8.5-10.2-23.7-11.5-33.8-3.1-10.2 8.5-11.5 23.6-3.1 33.8 30 36 74.1 56.6 120.9 56.6s90.9-20.6 120.9-56.6c8.5-10.2 7.1-25.3-3.1-33.8-10.1-8.4-25.3-7.1-33.8 3.1z" class=""></path></svg>',
      displayName: "Cheats",
    },
    volumeSlider: {
      visible: true,
    },
    saveSavFiles: {
      visible: true,
      icon: '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 23 23"><path d="M3 6.5V5C3 3.89543 3.89543 3 5 3H16.1716C16.702 3 17.2107 3.21071 17.5858 3.58579L20.4142 6.41421C20.7893 6.78929 21 7.29799 21 7.82843V19C21 20.1046 20.1046 21 19 21H5C3.89543 21 3 20.1046 3 19V17.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" fill="transparent"></path><path d="M8 3H16V8.4C16 8.73137 15.7314 9 15.4 9H8.6C8.26863 9 8 8.73137 8 8.4V3Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" fill="transparent"></path><path d="M18 21V13.6C18 13.2686 17.7314 13 17.4 13H15" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" fill="transparent"></path><path d="M6 21V17.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" fill="transparent"></path><path d="M12 12H1M1 12L4 9M1 12L4 15" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
      displayName: "Export Save File",
    },
    loadSavFiles: {
      visible: true,
      icon: '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 23 23"><path d="M3 7.5V5C3 3.89543 3.89543 3 5 3H16.1716C16.702 3 17.2107 3.21071 17.5858 3.58579L20.4142 6.41421C20.7893 6.78929 21 7.29799 21 7.82843V19C21 20.1046 20.1046 21 19 21H5C3.89543 21 3 20.1046 3 19V16.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" fill="transparent"></path><path d="M6 21V17" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"></path><path d="M18 21V13.6C18 13.2686 17.7314 13 17.4 13H15" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" fill="transparent"></path><path d="M16 3V8.4C16 8.73137 15.7314 9 15.4 9H13.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" fill="transparent"></path><path d="M8 3V6" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"></path><path d="M1 12H12M12 12L9 9M12 12L9 15" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
      displayName: "Import Save File",
    },
    quickSave: {
      visible: true,
    },
    quickLoad: {
      visible: true,
    },
    screenshot: {
      visible: true,
    },
    cacheManager: {
      visible: true,
      icon: '<svg viewBox="0 0 1800 1800"><path d="M896 768q237 0 443-43t325-127v170q0 69-103 128t-280 93.5-385 34.5-385-34.5T231 896 128 768V598q119 84 325 127t443 43zm0 768q237 0 443-43t325-127v170q0 69-103 128t-280 93.5-385 34.5-385-34.5-280-93.5-103-128v-170q119 84 325 127t443 43zm0-384q237 0 443-43t325-127v170q0 69-103 128t-280 93.5-385 34.5-385-34.5-280-93.5-103-128V982q119 84 325 127t443 43zM896 0q208 0 385 34.5t280 93.5 103 128v128q0 69-103 128t-280 93.5T896 640t-385-34.5T231 512 128 384V256q0-69 103-128t280-93.5T896 0z"/></svg>',
      displayName: "Cache Manager",
    },
    exitEmulation: {
      visible: true,
      icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 460 460"><path style="fill:none;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;stroke:rgb(255,255,255);stroke-opacity:1;stroke-miterlimit:4;" d="M 14.000061 7.636414 L 14.000061 4.5 C 14.000061 4.223877 13.776123 3.999939 13.5 3.999939 L 4.5 3.999939 C 4.223877 3.999939 3.999939 4.223877 3.999939 4.5 L 3.999939 19.5 C 3.999939 19.776123 4.223877 20.000061 4.5 20.000061 L 13.5 20.000061 C 13.776123 20.000061 14.000061 19.776123 14.000061 19.5 L 14.000061 16.363586 " transform="matrix(21.333333,0,0,21.333333,0,0)"/><path style="fill:none;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;stroke:rgb(255,255,255);stroke-opacity:1;stroke-miterlimit:4;" d="M 9.999939 12 L 21 12 M 21 12 L 18.000366 8.499939 M 21 12 L 18 15.500061 " transform="matrix(21.333333,0,0,21.333333,0,0)"/></svg>',
      displayName: "Exit Emulation",
    },
    netplay: {
      visible: true,
      icon: '<svg viewBox="0 0 512 512"><path fill="currentColor" d="M364.215 192h131.43c5.439 20.419 8.354 41.868 8.354 64s-2.915 43.581-8.354 64h-131.43c5.154-43.049 4.939-86.746 0-128zM185.214 352c10.678 53.68 33.173 112.514 70.125 151.992.221.001.44.008.661.008s.44-.008.661-.008c37.012-39.543 59.467-98.414 70.125-151.992H185.214zm174.13-192h125.385C452.802 84.024 384.128 27.305 300.95 12.075c30.238 43.12 48.821 96.332 58.394 147.925zm-27.35 32H180.006c-5.339 41.914-5.345 86.037 0 128h151.989c5.339-41.915 5.345-86.037-.001-128zM152.656 352H27.271c31.926 75.976 100.6 132.695 183.778 147.925-30.246-43.136-48.823-96.35-58.393-147.925zm206.688 0c-9.575 51.605-28.163 104.814-58.394 147.925 83.178-15.23 151.852-71.949 183.778-147.925H359.344zm-32.558-192c-10.678-53.68-33.174-112.514-70.125-151.992-.221 0-.44-.008-.661-.008s-.44.008-.661.008C218.327 47.551 195.872 106.422 185.214 160h141.572zM16.355 192C10.915 212.419 8 233.868 8 256s2.915 43.581 8.355 64h131.43c-4.939-41.254-5.154-84.951 0-128H16.355zm136.301-32c9.575-51.602 28.161-104.81 58.394-147.925C127.872 27.305 59.198 84.024 27.271 160h125.385z"/></svg>',
      displayName: "Netplay",
    },
    diskButton: {
      visible: true,
      icon: '<svg fill="#FFFFFF" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 473.109 473.109"><path d="M340.963,101.878H12.105C5.423,101.878,0,107.301,0,113.983v328.862c0,6.68,5.423,12.105,12.105,12.105h328.857 c6.685,0,12.104-5.426,12.104-12.105V113.983C353.067,107.301,347.647,101.878,340.963,101.878z M67.584,120.042h217.895v101.884 H67.584V120.042z M296.076,429.228H56.998V278.414h239.079V429.228z M223.947,135.173h30.269v72.638h-30.269V135.173z M274.13,315.741H78.933v-12.105H274.13V315.741z M274.13,358.109H78.933v-12.105H274.13V358.109z M274.13,398.965H78.933v-12.105 H274.13V398.965z M473.109,30.263v328.863c0,6.68-5.426,12.105-12.105,12.105H384.59v-25.724h31.528V194.694H384.59v-56.489h20.93 V36.321H187.625v43.361h-67.583v-49.42c0-6.682,5.423-12.105,12.105-12.105H461.01C467.695,18.158,473.109,23.581,473.109,30.263z M343.989,51.453h30.269v31.321c-3.18-1.918-6.868-3.092-10.853-3.092h-19.416V51.453z M394.177,232.021h-9.581v-12.105h9.581 V232.021z M384.59,262.284h9.581v12.105h-9.581V262.284z M384.59,303.14h9.581v12.104h-9.581V303.14z"/></svg>',
      displayName: "Disks",
    },
    contextMenu: {
      visible: true,
      icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><!--!Font Awesome Free 6.5.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2023 Fonticons, Inc.--><path d="M0 96C0 78.3 14.3 64 32 64H416c17.7 0 32 14.3 32 32s-14.3 32-32 32H32C14.3 128 0 113.7 0 96zM0 256c0-17.7 14.3-32 32-32H416c17.7 0 32 14.3 32 32s-14.3 32-32 32H32c-17.7 0-32-14.3-32-32zM448 416c0 17.7-14.3 32-32 32H32c-17.7 0-32-14.3-32-32s14.3-32 32-32H416c17.7 0 32 14.3 32 32z"/></svg>',
      displayName: "Context Menu",
    },
  };
  defaultButtonAliases = {
    volume: "volumeSlider",
  };
  buildButtonOptions(buttonUserOpts) {
    let mergedButtonOptions = this.defaultButtonOptions;

    // merge buttonUserOpts with mergedButtonOptions
    if (buttonUserOpts) {
      for (const key in buttonUserOpts) {
        let searchKey = key;
        // If the key is an alias, find the actual key in the default buttons
        if (this.defaultButtonAliases[key]) {
          // Use the alias to find the actual key
          // and update the searchKey to the actual key
          searchKey = this.defaultButtonAliases[key];
        }

        // Check if the button exists in the default buttons, and update its properties
        // If the button does not exist, create a custom button
        if (!mergedButtonOptions[searchKey]) {
          // If the button does not exist in the default buttons, create a custom button
          // Custom buttons must have a displayName, icon, and callback property
          if (
            !buttonUserOpts[searchKey] ||
            !buttonUserOpts[searchKey].displayName ||
            !buttonUserOpts[searchKey].icon ||
            !buttonUserOpts[searchKey].callback
          ) {
            if (this.debug)
              console.warn(
                `Custom button "${searchKey}" is missing required properties`
              );
            continue;
          }

          mergedButtonOptions[searchKey] = {
            visible: true,
            displayName: buttonUserOpts[searchKey].displayName || searchKey,
            icon: buttonUserOpts[searchKey].icon || "",
            callback: buttonUserOpts[searchKey].callback || (() => {}),
            custom: true,
          };
        }

        // if the value is a boolean, set the visible property to the value
        if (typeof buttonUserOpts[searchKey] === "boolean") {
          mergedButtonOptions[searchKey].visible = buttonUserOpts[searchKey];
        } else if (typeof buttonUserOpts[searchKey] === "object") {
          // If the value is an object, merge it with the default button properties

          // if the button is the contextMenu, only allow the visible property to be set
          if (searchKey === "contextMenu") {
            mergedButtonOptions[searchKey].visible =
              buttonUserOpts[searchKey].visible !== undefined
                ? buttonUserOpts[searchKey].visible
                : true;
          } else if (this.defaultButtonOptions[searchKey]) {
            // copy properties from the button definition if they aren't null
            for (const prop in buttonUserOpts[searchKey]) {
              if (buttonUserOpts[searchKey][prop] !== null) {
                mergedButtonOptions[searchKey][prop] =
                  buttonUserOpts[searchKey][prop];
              }
            }
          } else {
            // button was not in the default buttons list and is therefore a custom button
            // verify that the value has a displayName, icon, and callback property
            if (
              buttonUserOpts[searchKey].displayName &&
              buttonUserOpts[searchKey].icon &&
              buttonUserOpts[searchKey].callback
            ) {
              mergedButtonOptions[searchKey] = {
                visible: true,
                displayName: buttonUserOpts[searchKey].displayName,
                icon: buttonUserOpts[searchKey].icon,
                callback: buttonUserOpts[searchKey].callback,
                custom: true,
              };
            } else if (this.debug) {
              console.warn(
                `Custom button "${searchKey}" is missing required properties`
              );
            }
          }
        }

        // behaviour exceptions
        switch (searchKey) {
          case "playPause":
            mergedButtonOptions.play.visible =
              mergedButtonOptions.playPause.visible;
            mergedButtonOptions.pause.visible =
              mergedButtonOptions.playPause.visible;
            break;

          case "mute":
            mergedButtonOptions.unmute.visible =
              mergedButtonOptions.mute.visible;
            break;

          case "fullscreen":
            mergedButtonOptions.enterFullscreen.visible =
              mergedButtonOptions.fullscreen.visible;
            mergedButtonOptions.exitFullscreen.visible =
              mergedButtonOptions.fullscreen.visible;
            break;
        }
      }
    }

    return mergedButtonOptions;
  }
  createContextMenu() {
    this.elements.contextmenu = this.createElement("div");
    this.elements.contextmenu.classList.add("ejs_context_menu");
    this.addEventListener(this.game, "contextmenu", (e) => {
      e.preventDefault();
      if (
        (this.config.buttonOpts &&
          this.config.buttonOpts.rightClick === false) ||
        !this.started
      )
        return;
      const parentRect = this.elements.parent.getBoundingClientRect();
      this.elements.contextmenu.style.display = "block";
      const rect = this.elements.contextmenu.getBoundingClientRect();
      const up = e.offsetY + rect.height > parentRect.height - 25;
      const left = e.offsetX + rect.width > parentRect.width - 5;
      this.elements.contextmenu.style.left =
        e.offsetX - (left ? rect.width : 0) + "px";
      this.elements.contextmenu.style.top =
        e.offsetY - (up ? rect.height : 0) + "px";
    });
    const hideMenu = () => {
      this.elements.contextmenu.style.display = "none";
    };
    this.addEventListener(this.elements.contextmenu, "contextmenu", (e) =>
      e.preventDefault()
    );
    this.addEventListener(this.elements.parent, "contextmenu", (e) =>
      e.preventDefault()
    );
    this.addEventListener(this.game, "mousedown touchend", hideMenu);
    const parent = this.createElement("ul");
    const addButton = (title, hidden, functi0n) => {
      //<li><a href="#" onclick="return false">'+title+'</a></li>
      const li = this.createElement("li");
      if (hidden) li.hidden = true;
      const a = this.createElement("a");
      if (functi0n instanceof Function) {
        this.addEventListener(li, "click", (e) => {
          e.preventDefault();
          functi0n();
        });
      }
      a.href = "#";
      a.onclick = "return false";
      a.innerText = this.localization(title);
      li.appendChild(a);
      parent.appendChild(li);
      hideMenu();
      return li;
    };
    let screenshotUrl;
    const screenshot = addButton("Take Screenshot", false, () => {
      if (screenshotUrl) URL.revokeObjectURL(screenshotUrl);
      const date = new Date();
      const fileName =
        this.getBaseFileName() +
        "-" +
        date.getMonth() +
        "-" +
        date.getDate() +
        "-" +
        date.getFullYear();
      this.screenshot((blob, format) => {
        screenshotUrl = URL.createObjectURL(blob);
        const a = this.createElement("a");
        a.href = screenshotUrl;
        a.download = fileName + "." + format;
        a.click();
        hideMenu();
      });
    });

    let screenMediaRecorder = null;
    const startScreenRecording = addButton(
      "Start Screen Recording",
      false,
      () => {
        if (screenMediaRecorder !== null) {
          screenMediaRecorder.stop();
        }
        screenMediaRecorder = this.screenRecord();
        startScreenRecording.setAttribute("hidden", "hidden");
        stopScreenRecording.removeAttribute("hidden");
        hideMenu();
      }
    );
    const stopScreenRecording = addButton("Stop Screen Recording", true, () => {
      if (screenMediaRecorder !== null) {
        screenMediaRecorder.stop();
        screenMediaRecorder = null;
      }
      startScreenRecording.removeAttribute("hidden");
      stopScreenRecording.setAttribute("hidden", "hidden");
      hideMenu();
    });

    const qSave = addButton("Quick Save", false, () => {
      const slot = this.getSettingValue("save-state-slot")
        ? this.getSettingValue("save-state-slot")
        : "1";
      if (this.gameManager.quickSave(slot)) {
        this.displayMessage(
          this.localization("SAVED STATE TO SLOT") + " " + slot
        );
      } else {
        this.displayMessage(this.localization("FAILED TO SAVE STATE"));
      }
      hideMenu();
    });
    const qLoad = addButton("Quick Load", false, () => {
      const slot = this.getSettingValue("save-state-slot")
        ? this.getSettingValue("save-state-slot")
        : "1";
      this.gameManager.quickLoad(slot);
      this.displayMessage(
        this.localization("LOADED STATE FROM SLOT") + " " + slot
      );
      hideMenu();
    });
    this.elements.contextMenu = {
      screenshot: screenshot,
      startScreenRecording: startScreenRecording,
      stopScreenRecording: stopScreenRecording,
      save: qSave,
      load: qLoad,
    };
    addButton("EmulatorJS v" + this.ejs_version, false, () => {
      hideMenu();
      const body = this.createPopup("EmulatorJS", {
        Close: () => {
          this.closePopup();
        },
      });

      body.style.display = "flex";

      const menu = this.createElement("div");
      body.appendChild(menu);
      menu.classList.add("ejs_list_selector");
      const parent = this.createElement("ul");
      const addButton = (title, hidden, functi0n) => {
        const li = this.createElement("li");
        if (hidden) li.hidden = true;
        const a = this.createElement("a");
        if (functi0n instanceof Function) {
          this.addEventListener(li, "click", (e) => {
            e.preventDefault();
            functi0n(li);
          });
        }
        a.href = "#";
        a.onclick = "return false";
        a.innerText = this.localization(title);
        li.appendChild(a);
        parent.appendChild(li);
        hideMenu();
        return li;
      };
      //body.style["padding-left"] = "20%";
      const home = this.createElement("div");
      const license = this.createElement("div");
      license.style.display = "none";
      const retroarch = this.createElement("div");
      retroarch.style.display = "none";
      const coreLicense = this.createElement("div");
      coreLicense.style.display = "none";
      body.appendChild(home);
      body.appendChild(license);
      body.appendChild(retroarch);
      body.appendChild(coreLicense);

      home.innerText = "EmulatorJS v" + this.ejs_version;
      home.appendChild(this.createElement("br"));
      home.appendChild(this.createElement("br"));

      home.classList.add("ejs_context_menu_tab");
      license.classList.add("ejs_context_menu_tab");
      retroarch.classList.add("ejs_context_menu_tab");
      coreLicense.classList.add("ejs_context_menu_tab");

      this.createLink(
        home,
        "https://github.com/EmulatorJS/EmulatorJS",
        "View on GitHub",
        true
      );

      this.createLink(
        home,
        "https://discord.gg/6akryGkETU",
        "Join the discord",
        true
      );

      const info = this.createElement("div");

      this.createLink(info, "https://emulatorjs.org", "EmulatorJS");
      // I do not like using innerHTML, though this should be "safe"
      info.innerHTML += " is powered by ";
      this.createLink(
        info,
        "https://github.com/libretro/RetroArch/",
        "RetroArch"
      );
      if (this.repository && this.coreName) {
        info.innerHTML += ". This core is powered by ";
        this.createLink(info, this.repository, this.coreName);
        info.innerHTML += ".";
      } else {
        info.innerHTML += ".";
      }
      home.appendChild(info);

      home.appendChild(this.createElement("br"));
      menu.appendChild(parent);
      let current = home;
      const setElem = (element, li) => {
        if (current === element) return;
        if (current) {
          current.style.display = "none";
        }
        let activeLi = li.parentElement.querySelector(
          ".ejs_active_list_element"
        );
        if (activeLi) {
          activeLi.classList.remove("ejs_active_list_element");
        }
        li.classList.add("ejs_active_list_element");
        current = element;
        element.style.display = "";
      };
      addButton("Home", false, (li) => {
        setElem(home, li);
      }).classList.add("ejs_active_list_element");
      addButton("EmulatorJS License", false, (li) => {
        setElem(license, li);
      });
      addButton("RetroArch License", false, (li) => {
        setElem(retroarch, li);
      });
      if (this.coreName && this.license) {
        addButton(this.coreName + " License", false, (li) => {
          setElem(coreLicense, li);
        });
        coreLicense.innerText = this.license;
      }
      //Todo - Contributors.

      retroarch.innerText =
        this.localization("This project is powered by") + " ";
      const a = this.createElement("a");
      a.href = "https://github.com/libretro/RetroArch";
      a.target = "_blank";
      a.innerText = "RetroArch";
      retroarch.appendChild(a);
      const licenseLink = this.createElement("a");
      licenseLink.target = "_blank";
      licenseLink.href =
        "https://github.com/libretro/RetroArch/blob/master/COPYING";
      licenseLink.innerText = this.localization(
        "View the RetroArch license here"
      );
      a.appendChild(this.createElement("br"));
      a.appendChild(licenseLink);

      license.innerText =
        '                    GNU GENERAL PUBLIC LICENSE\n                       Version 3, 29 June 2007\n\n Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>\n Everyone is permitted to copy and distribute verbatim copies\n of this license document, but changing it is not allowed.\n\n                            Preamble\n\n  The GNU General Public License is a free, copyleft license for\nsoftware and other kinds of works.\n\n  The licenses for most software and other practical works are designed\nto take away your freedom to share and change the works.  By contrast,\nthe GNU General Public License is intended to guarantee your freedom to\nshare and change all versions of a program--to make sure it remains free\nsoftware for all its users.  We, the Free Software Foundation, use the\nGNU General Public License for most of our software; it applies also to\nany other work released this way by its authors.  You can apply it to\nyour programs, too.\n\n  When we speak of free software, we are referring to freedom, not\nprice.  Our General Public Licenses are designed to make sure that you\nhave the freedom to distribute copies of free software (and charge for\nthem if you wish), that you receive source code or can get it if you\nwant it, that you can change the software or use pieces of it in new\nfree programs, and that you know you can do these things.\n\n  To protect your rights, we need to prevent others from denying you\nthese rights or asking you to surrender the rights.  Therefore, you have\ncertain responsibilities if you distribute copies of the software, or if\nyou modify it: responsibilities to respect the freedom of others.\n\n  For example, if you distribute copies of such a program, whether\ngratis or for a fee, you must pass on to the recipients the same\nfreedoms that you received.  You must make sure that they, too, receive\nor can get the source code.  And you must show them these terms so they\nknow their rights.\n\n  Developers that use the GNU GPL protect your rights with two steps:\n(1) assert copyright on the software, and (2) offer you this License\ngiving you legal permission to copy, distribute and/or modify it.\n\n  For the developers\' and authors\' protection, the GPL clearly explains\nthat there is no warranty for this free software.  For both users\' and\nauthors\' sake, the GPL requires that modified versions be marked as\nchanged, so that their problems will not be attributed erroneously to\nauthors of previous versions.\n\n  Some devices are designed to deny users access to install or run\nmodified versions of the software inside them, although the manufacturer\ncan do so.  This is fundamentally incompatible with the aim of\nprotecting users\' freedom to change the software.  The systematic\npattern of such abuse occurs in the area of products for individuals to\nuse, which is precisely where it is most unacceptable.  Therefore, we\nhave designed this version of the GPL to prohibit the practice for those\nproducts.  If such problems arise substantially in other domains, we\nstand ready to extend this provision to those domains in future versions\nof the GPL, as needed to protect the freedom of users.\n\n  Finally, every program is threatened constantly by software patents.\nStates should not allow patents to restrict development and use of\nsoftware on general-purpose computers, but in those that do, we wish to\navoid the special danger that patents applied to a free program could\nmake it effectively proprietary.  To prevent this, the GPL assures that\npatents cannot be used to render the program non-free.\n\n  The precise terms and conditions for copying, distribution and\nmodification follow.\n\n                       TERMS AND CONDITIONS\n\n  0. Definitions.\n\n  "This License" refers to version 3 of the GNU General Public License.\n\n  "Copyright" also means copyright-like laws that apply to other kinds of\nworks, such as semiconductor masks.\n\n  "The Program" refers to any copyrightable work licensed under this\nLicense.  Each licensee is addressed as "you".  "Licensees" and\n"recipients" may be individuals or organizations.\n\n  To "modify" a work means to copy from or adapt all or part of the work\nin a fashion requiring copyright permission, other than the making of an\nexact copy.  The resulting work is called a "modified version" of the\nearlier work or a work "based on" the earlier work.\n\n  A "covered work" means either the unmodified Program or a work based\non the Program.\n\n  To "propagate" a work means to do anything with it that, without\npermission, would make you directly or secondarily liable for\ninfringement under applicable copyright law, except executing it on a\ncomputer or modifying a private copy.  Propagation includes copying,\ndistribution (with or without modification), making available to the\npublic, and in some countries other activities as well.\n\n  To "convey" a work means any kind of propagation that enables other\nparties to make or receive copies.  Mere interaction with a user through\na computer network, with no transfer of a copy, is not conveying.\n\n  An interactive user interface displays "Appropriate Legal Notices"\nto the extent that it includes a convenient and prominently visible\nfeature that (1) displays an appropriate copyright notice, and (2)\ntells the user that there is no warranty for the work (except to the\nextent that warranties are provided), that licensees may convey the\nwork under this License, and how to view a copy of this License.  If\nthe interface presents a list of user commands or options, such as a\nmenu, a prominent item in the list meets this criterion.\n\n  1. Source Code.\n\n  The "source code" for a work means the preferred form of the work\nfor making modifications to it.  "Object code" means any non-source\nform of a work.\n\n  A "Standard Interface" means an interface that either is an official\nstandard defined by a recognized standards body, or, in the case of\ninterfaces specified for a particular programming language, one that\nis widely used among developers working in that language.\n\n  The "System Libraries" of an executable work include anything, other\nthan the work as a whole, that (a) is included in the normal form of\npackaging a Major Component, but which is not part of that Major\nComponent, and (b) serves only to enable use of the work with that\nMajor Component, or to implement a Standard Interface for which an\nimplementation is available to the public in source code form.  A\n"Major Component", in this context, means a major essential component\n(kernel, window system, and so on) of the specific operating system\n(if any) on which the executable work runs, or a compiler used to\nproduce the work, or an object code interpreter used to run it.\n\n  The "Corresponding Source" for a work in object code form means all\nthe source code needed to generate, install, and (for an executable\nwork) run the object code and to modify the work, including scripts to\ncontrol those activities.  However, it does not include the work\'s\nSystem Libraries, or general-purpose tools or generally available free\nprograms which are used unmodified in performing those activities but\nwhich are not part of the work.  For example, Corresponding Source\nincludes interface definition files associated with source files for\nthe work, and the source code for shared libraries and dynamically\nlinked subprograms that the work is specifically designed to require,\nsuch as by intimate data communication or control flow between those\nsubprograms and other parts of the work.\n\n  The Corresponding Source need not include anything that users\ncan regenerate automatically from other parts of the Corresponding\nSource.\n\n  The Corresponding Source for a work in source code form is that\nsame work.\n\n  2. Basic Permissions.\n\n  All rights granted under this License are granted for the term of\ncopyright on the Program, and are irrevocable provided the stated\nconditions are met.  This License explicitly affirms your unlimited\npermission to run the unmodified Program.  The output from running a\ncovered work is covered by this License only if the output, given its\ncontent, constitutes a covered work.  This License acknowledges your\nrights of fair use or other equivalent, as provided by copyright law.\n\n  You may make, run and propagate covered works that you do not\nconvey, without conditions so long as your license otherwise remains\nin force.  You may convey covered works to others for the sole purpose\nof having them make modifications exclusively for you, or provide you\nwith facilities for running those works, provided that you comply with\nthe terms of this License in conveying all material for which you do\nnot control copyright.  Those thus making or running the covered works\nfor you must do so exclusively on your behalf, under your direction\nand control, on terms that prohibit them from making any copies of\nyour copyrighted material outside their relationship with you.\n\n  Conveying under any other circumstances is permitted solely under\nthe conditions stated below.  Sublicensing is not allowed; section 10\nmakes it unnecessary.\n\n  3. Protecting Users\' Legal Rights From Anti-Circumvention Law.\n\n  No covered work shall be deemed part of an effective technological\nmeasure under any applicable law fulfilling obligations under article\n11 of the WIPO copyright treaty adopted on 20 December 1996, or\nsimilar laws prohibiting or restricting circumvention of such\nmeasures.\n\n  When you convey a covered work, you waive any legal power to forbid\ncircumvention of technological measures to the extent such circumvention\nis effected by exercising rights under this License with respect to\nthe covered work, and you disclaim any intention to limit operation or\nmodification of the work as a means of enforcing, against the work\'s\nusers, your or third parties\' legal rights to forbid circumvention of\ntechnological measures.\n\n  4. Conveying Verbatim Copies.\n\n  You may convey verbatim copies of the Program\'s source code as you\nreceive it, in any medium, provided that you conspicuously and\nappropriately publish on each copy an appropriate copyright notice;\nkeep intact all notices stating that this License and any\nnon-permissive terms added in accord with section 7 apply to the code;\nkeep intact all notices of the absence of any warranty; and give all\nrecipients a copy of this License along with the Program.\n\n  You may charge any price or no price for each copy that you convey,\nand you may offer support or warranty protection for a fee.\n\n  5. Conveying Modified Source Versions.\n\n  You may convey a work based on the Program, or the modifications to\nproduce it from the Program, in the form of source code under the\nterms of section 4, provided that you also meet all of these conditions:\n\n    a) The work must carry prominent notices stating that you modified\n    it, and giving a relevant date.\n\n    b) The work must carry prominent notices stating that it is\n    released under this License and any conditions added under section\n    7.  This requirement modifies the requirement in section 4 to\n    "keep intact all notices".\n\n    c) You must license the entire work, as a whole, under this\n    License to anyone who comes into possession of a copy.  This\n    License will therefore apply, along with any applicable section 7\n    additional terms, to the whole of the work, and all its parts,\n    regardless of how they are packaged.  This License gives no\n    permission to license the work in any other way, but it does not\n    invalidate such permission if you have separately received it.\n\n    d) If the work has interactive user interfaces, each must display\n    Appropriate Legal Notices; however, if the Program has interactive\n    interfaces that do not display Appropriate Legal Notices, your\n    work need not make them do so.\n\n  A compilation of a covered work with other separate and independent\nworks, which are not by their nature extensions of the covered work,\nand which are not combined with it such as to form a larger program,\nin or on a volume of a storage or distribution medium, is called an\n"aggregate" if the compilation and its resulting copyright are not\nused to limit the access or legal rights of the compilation\'s users\nbeyond what the individual works permit.  Inclusion of a covered work\nin an aggregate does not cause this License to apply to the other\nparts of the aggregate.\n\n  6. Conveying Non-Source Forms.\n\n  You may convey a covered work in object code form under the terms\nof sections 4 and 5, provided that you also convey the\nmachine-readable Corresponding Source under the terms of this License,\nin one of these ways:\n\n    a) Convey the object code in, or embodied in, a physical product\n    (including a physical distribution medium), accompanied by the\n    Corresponding Source fixed on a durable physical medium\n    customarily used for software interchange.\n\n    b) Convey the object code in, or embodied in, a physical product\n    (including a physical distribution medium), accompanied by a\n    written offer, valid for at least three years and valid for as\n    long as you offer spare parts or customer support for that product\n    model, to give anyone who possesses the object code either (1) a\n    copy of the Corresponding Source for all the software in the\n    product that is covered by this License, on a durable physical\n    medium customarily used for software interchange, for a price no\n    more than your reasonable cost of physically performing this\n    conveying of source, or (2) access to copy the\n    Corresponding Source from a network server at no charge.\n\n    c) Convey individual copies of the object code with a copy of the\n    written offer to provide the Corresponding Source.  This\n    alternative is allowed only occasionally and noncommercially, and\n    only if you received the object code with such an offer, in accord\n    with subsection 6b.\n\n    d) Convey the object code by offering access from a designated\n    place (gratis or for a charge), and offer equivalent access to the\n    Corresponding Source in the same way through the same place at no\n    further charge.  You need not require recipients to copy the\n    Corresponding Source along with the object code.  If the place to\n    copy the object code is a network server, the Corresponding Source\n    may be on a different server (operated by you or a third party)\n    that supports equivalent copying facilities, provided you maintain\n    clear directions next to the object code saying where to find the\n    Corresponding Source.  Regardless of what server hosts the\n    Corresponding Source, you remain obligated to ensure that it is\n    available for as long as needed to satisfy these requirements.\n\n    e) Convey the object code using peer-to-peer transmission, provided\n    you inform other peers where the object code and Corresponding\n    Source of the work are being offered to the general public at no\n    charge under subsection 6d.\n\n  A separable portion of the object code, whose source code is excluded\nfrom the Corresponding Source as a System Library, need not be\nincluded in conveying the object code work.\n\n  A "User Product" is either (1) a "consumer product", which means any\ntangible personal property which is normally used for personal, family,\nor household purposes, or (2) anything designed or sold for incorporation\ninto a dwelling.  In determining whether a product is a consumer product,\ndoubtful cases shall be resolved in favor of coverage.  For a particular\nproduct received by a particular user, "normally used" refers to a\ntypical or common use of that class of product, regardless of the status\nof the particular user or of the way in which the particular user\nactually uses, or expects or is expected to use, the product.  A product\nis a consumer product regardless of whether the product has substantial\ncommercial, industrial or non-consumer uses, unless such uses represent\nthe only significant mode of use of the product.\n\n  "Installation Information" for a User Product means any methods,\nprocedures, authorization keys, or other information required to install\nand execute modified versions of a covered work in that User Product from\na modified version of its Corresponding Source.  The information must\nsuffice to ensure that the continued functioning of the modified object\ncode is in no case prevented or interfered with solely because\nmodification has been made.\n\n  If you convey an object code work under this section in, or with, or\nspecifically for use in, a User Product, and the conveying occurs as\npart of a transaction in which the right of possession and use of the\nUser Product is transferred to the recipient in perpetuity or for a\nfixed term (regardless of how the transaction is characterized), the\nCorresponding Source conveyed under this section must be accompanied\nby the Installation Information.  But this requirement does not apply\nif neither you nor any third party retains the ability to install\nmodified object code on the User Product (for example, the work has\nbeen installed in ROM).\n\n  The requirement to provide Installation Information does not include a\nrequirement to continue to provide support service, warranty, or updates\nfor a work that has been modified or installed by the recipient, or for\nthe User Product in which it has been modified or installed.  Access to a\nnetwork may be denied when the modification itself materially and\nadversely affects the operation of the network or violates the rules and\nprotocols for communication across the network.\n\n  Corresponding Source conveyed, and Installation Information provided,\nin accord with this section must be in a format that is publicly\ndocumented (and with an implementation available to the public in\nsource code form), and must require no special password or key for\nunpacking, reading or copying.\n\n  7. Additional Terms.\n\n  "Additional permissions" are terms that supplement the terms of this\nLicense by making exceptions from one or more of its conditions.\nAdditional permissions that are applicable to the entire Program shall\nbe treated as though they were included in this License, to the extent\nthat they are valid under applicable law.  If additional permissions\napply only to part of the Program, that part may be used separately\nunder those permissions, but the entire Program remains governed by\nthis License without regard to the additional permissions.\n\n  When you convey a copy of a covered work, you may at your option\nremove any additional permissions from that copy, or from any part of\nit.  (Additional permissions may be written to require their own\nremoval in certain cases when you modify the work.)  You may place\nadditional permissions on material, added by you to a covered work,\nfor which you have or can give appropriate copyright permission.\n\n  Notwithstanding any other provision of this License, for material you\nadd to a covered work, you may (if authorized by the copyright holders of\nthat material) supplement the terms of this License with terms:\n\n    a) Disclaiming warranty or limiting liability differently from the\n    terms of sections 15 and 16 of this License; or\n\n    b) Requiring preservation of specified reasonable legal notices or\n    author attributions in that material or in the Appropriate Legal\n    Notices displayed by works containing it; or\n\n    c) Prohibiting misrepresentation of the origin of that material, or\n    requiring that modified versions of such material be marked in\n    reasonable ways as different from the original version; or\n\n    d) Limiting the use for publicity purposes of names of licensors or\n    authors of the material; or\n\n    e) Declining to grant rights under trademark law for use of some\n    trade names, trademarks, or service marks; or\n\n    f) Requiring indemnification of licensors and authors of that\n    material by anyone who conveys the material (or modified versions of\n    it) with contractual assumptions of liability to the recipient, for\n    any liability that these contractual assumptions directly impose on\n    those licensors and authors.\n\n  All other non-permissive additional terms are considered "further\nrestrictions" within the meaning of section 10.  If the Program as you\nreceived it, or any part of it, contains a notice stating that it is\ngoverned by this License along with a term that is a further\nrestriction, you may remove that term.  If a license document contains\na further restriction but permits relicensing or conveying under this\nLicense, you may add to a covered work material governed by the terms\nof that license document, provided that the further restriction does\nnot survive such relicensing or conveying.\n\n  If you add terms to a covered work in accord with this section, you\nmust place, in the relevant source files, a statement of the\nadditional terms that apply to those files, or a notice indicating\nwhere to find the applicable terms.\n\n  Additional terms, permissive or non-permissive, may be stated in the\nform of a separately written license, or stated as exceptions;\nthe above requirements apply either way.\n\n  8. Termination.\n\n  You may not propagate or modify a covered work except as expressly\nprovided under this License.  Any attempt otherwise to propagate or\nmodify it is void, and will automatically terminate your rights under\nthis License (including any patent licenses granted under the third\nparagraph of section 11).\n\n  However, if you cease all violation of this License, then your\nlicense from a particular copyright holder is reinstated (a)\nprovisionally, unless and until the copyright holder explicitly and\nfinally terminates your license, and (b) permanently, if the copyright\nholder fails to notify you of the violation by some reasonable means\nprior to 60 days after the cessation.\n\n  Moreover, your license from a particular copyright holder is\nreinstated permanently if the copyright holder notifies you of the\nviolation by some reasonable means, this is the first time you have\nreceived notice of violation of this License (for any work) from that\ncopyright holder, and you cure the violation prior to 30 days after\nyour receipt of the notice.\n\n  Termination of your rights under this section does not terminate the\nlicenses of parties who have received copies or rights from you under\nthis License.  If your rights have been terminated and not permanently\nreinstated, you do not qualify to receive new licenses for the same\nmaterial under section 10.\n\n  9. Acceptance Not Required for Having Copies.\n\n  You are not required to accept this License in order to receive or\nrun a copy of the Program.  Ancillary propagation of a covered work\noccurring solely as a consequence of using peer-to-peer transmission\nto receive a copy likewise does not require acceptance.  However,\nnothing other than this License grants you permission to propagate or\nmodify any covered work.  These actions infringe copyright if you do\nnot accept this License.  Therefore, by modifying or propagating a\ncovered work, you indicate your acceptance of this License to do so.\n\n  10. Automatic Licensing of Downstream Recipients.\n\n  Each time you convey a covered work, the recipient automatically\nreceives a license from the original licensors, to run, modify and\npropagate that work, subject to this License.  You are not responsible\nfor enforcing compliance by third parties with this License.\n\n  An "entity transaction" is a transaction transferring control of an\norganization, or substantially all assets of one, or subdividing an\norganization, or merging organizations.  If propagation of a covered\nwork results from an entity transaction, each party to that\ntransaction who receives a copy of the work also receives whatever\nlicenses to the work the party\'s predecessor in interest had or could\ngive under the previous paragraph, plus a right to possession of the\nCorresponding Source of the work from the predecessor in interest, if\nthe predecessor has it or can get it with reasonable efforts.\n\n  You may not impose any further restrictions on the exercise of the\nrights granted or affirmed under this License.  For example, you may\nnot impose a license fee, royalty, or other charge for exercise of\nrights granted under this License, and you may not initiate litigation\n(including a cross-claim or counterclaim in a lawsuit) alleging that\nany patent claim is infringed by making, using, selling, offering for\nsale, or importing the Program or any portion of it.\n\n  11. Patents.\n\n  A "contributor" is a copyright holder who authorizes use under this\nLicense of the Program or a work on which the Program is based.  The\nwork thus licensed is called the contributor\'s "contributor version".\n\n  A contributor\'s "essential patent claims" are all patent claims\nowned or controlled by the contributor, whether already acquired or\nhereafter acquired, that would be infringed by some manner, permitted\nby this License, of making, using, or selling its contributor version,\nbut do not include claims that would be infringed only as a\nconsequence of further modification of the contributor version.  For\npurposes of this definition, "control" includes the right to grant\npatent sublicenses in a manner consistent with the requirements of\nthis License.\n\n  Each contributor grants you a non-exclusive, worldwide, royalty-free\npatent license under the contributor\'s essential patent claims, to\nmake, use, sell, offer for sale, import and otherwise run, modify and\npropagate the contents of its contributor version.\n\n  In the following three paragraphs, a "patent license" is any express\nagreement or commitment, however denominated, not to enforce a patent\n(such as an express permission to practice a patent or covenant not to\nsue for patent infringement).  To "grant" such a patent license to a\nparty means to make such an agreement or commitment not to enforce a\npatent against the party.\n\n  If you convey a covered work, knowingly relying on a patent license,\nand the Corresponding Source of the work is not available for anyone\nto copy, free of charge and under the terms of this License, through a\npublicly available network server or other readily accessible means,\nthen you must either (1) cause the Corresponding Source to be so\navailable, or (2) arrange to deprive yourself of the benefit of the\npatent license for this particular work, or (3) arrange, in a manner\nconsistent with the requirements of this License, to extend the patent\nlicense to downstream recipients.  "Knowingly relying" means you have\nactual knowledge that, but for the patent license, your conveying the\ncovered work in a country, or your recipient\'s use of the covered work\nin a country, would infringe one or more identifiable patents in that\ncountry that you have reason to believe are valid.\n\n  If, pursuant to or in connection with a single transaction or\narrangement, you convey, or propagate by procuring conveyance of, a\ncovered work, and grant a patent license to some of the parties\nreceiving the covered work authorizing them to use, propagate, modify\nor convey a specific copy of the covered work, then the patent license\nyou grant is automatically extended to all recipients of the covered\nwork and works based on it.\n\n  A patent license is "discriminatory" if it does not include within\nthe scope of its coverage, prohibits the exercise of, or is\nconditioned on the non-exercise of one or more of the rights that are\nspecifically granted under this License.  You may not convey a covered\nwork if you are a party to an arrangement with a third party that is\nin the business of distributing software, under which you make payment\nto the third party based on the extent of your activity of conveying\nthe work, and under which the third party grants, to any of the\nparties who would receive the covered work from you, a discriminatory\npatent license (a) in connection with copies of the covered work\nconveyed by you (or copies made from those copies), or (b) primarily\nfor and in connection with specific products or compilations that\ncontain the covered work, unless you entered into that arrangement,\nor that patent license was granted, prior to 28 March 2007.\n\n  Nothing in this License shall be construed as excluding or limiting\nany implied license or other defenses to infringement that may\notherwise be available to you under applicable patent law.\n\n  12. No Surrender of Others\' Freedom.\n\n  If conditions are imposed on you (whether by court order, agreement or\notherwise) that contradict the conditions of this License, they do not\nexcuse you from the conditions of this License.  If you cannot convey a\ncovered work so as to satisfy simultaneously your obligations under this\nLicense and any other pertinent obligations, then as a consequence you may\nnot convey it at all.  For example, if you agree to terms that obligate you\nto collect a royalty for further conveying from those to whom you convey\nthe Program, the only way you could satisfy both those terms and this\nLicense would be to refrain entirely from conveying the Program.\n\n  13. Use with the GNU Affero General Public License.\n\n  Notwithstanding any other provision of this License, you have\npermission to link or combine any covered work with a work licensed\nunder version 3 of the GNU Affero General Public License into a single\ncombined work, and to convey the resulting work.  The terms of this\nLicense will continue to apply to the part which is the covered work,\nbut the special requirements of the GNU Affero General Public License,\nsection 13, concerning interaction through a network will apply to the\ncombination as such.\n\n  14. Revised Versions of this License.\n\n  The Free Software Foundation may publish revised and/or new versions of\nthe GNU General Public License from time to time.  Such new versions will\nbe similar in spirit to the present version, but may differ in detail to\naddress new problems or concerns.\n\n  Each version is given a distinguishing version number.  If the\nProgram specifies that a certain numbered version of the GNU General\nPublic License "or any later version" applies to it, you have the\noption of following the terms and conditions either of that numbered\nversion or of any later version published by the Free Software\nFoundation.  If the Program does not specify a version number of the\nGNU General Public License, you may choose any version ever published\nby the Free Software Foundation.\n\n  If the Program specifies that a proxy can decide which future\nversions of the GNU General Public License can be used, that proxy\'s\npublic statement of acceptance of a version permanently authorizes you\nto choose that version for the Program.\n\n  Later license versions may give you additional or different\npermissions.  However, no additional obligations are imposed on any\nauthor or copyright holder as a result of your choosing to follow a\nlater version.\n\n  15. Disclaimer of Warranty.\n\n  THERE IS NO WARRANTY FOR THE PROGRAM, TO THE EXTENT PERMITTED BY\nAPPLICABLE LAW.  EXCEPT WHEN OTHERWISE STATED IN WRITING THE COPYRIGHT\nHOLDERS AND/OR OTHER PARTIES PROVIDE THE PROGRAM "AS IS" WITHOUT WARRANTY\nOF ANY KIND, EITHER EXPRESSED OR IMPLIED, INCLUDING, BUT NOT LIMITED TO,\nTHE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR\nPURPOSE.  THE ENTIRE RISK AS TO THE QUALITY AND PERFORMANCE OF THE PROGRAM\nIS WITH YOU.  SHOULD THE PROGRAM PROVE DEFECTIVE, YOU ASSUME THE COST OF\nALL NECESSARY SERVICING, REPAIR OR CORRECTION.\n\n  16. Limitation of Liability.\n\n  IN NO EVENT UNLESS REQUIRED BY APPLICABLE LAW OR AGREED TO IN WRITING\nWILL ANY COPYRIGHT HOLDER, OR ANY OTHER PARTY WHO MODIFIES AND/OR CONVEYS\nTHE PROGRAM AS PERMITTED ABOVE, BE LIABLE TO YOU FOR DAMAGES, INCLUDING ANY\nGENERAL, SPECIAL, INCIDENTAL OR CONSEQUENTIAL DAMAGES ARISING OUT OF THE\nUSE OR INABILITY TO USE THE PROGRAM (INCLUDING BUT NOT LIMITED TO LOSS OF\nDATA OR DATA BEING RENDERED INACCURATE OR LOSSES SUSTAINED BY YOU OR THIRD\nPARTIES OR A FAILURE OF THE PROGRAM TO OPERATE WITH ANY OTHER PROGRAMS),\nEVEN IF SUCH HOLDER OR OTHER PARTY HAS BEEN ADVISED OF THE POSSIBILITY OF\nSUCH DAMAGES.\n\n  17. Interpretation of Sections 15 and 16.\n\n  If the disclaimer of warranty and limitation of liability provided\nabove cannot be given local legal effect according to their terms,\nreviewing courts shall apply local law that most closely approximates\nan absolute waiver of all civil liability in connection with the\nProgram, unless a warranty or assumption of liability accompanies a\ncopy of the Program in return for a fee.\n\n                     END OF TERMS AND CONDITIONS\n\n            How to Apply These Terms to Your New Programs\n\n  If you develop a new program, and you want it to be of the greatest\npossible use to the public, the best way to achieve this is to make it\nfree software which everyone can redistribute and change under these terms.\n\n  To do so, attach the following notices to the program.  It is safest\nto attach them to the start of each source file to most effectively\nstate the exclusion of warranty; and each file should have at least\nthe "copyright" line and a pointer to where the full notice is found.\n\n    EmulatorJS: RetroArch on the web\n    Copyright (C) 2022-2024  Ethan O\'Brien\n\n    This program is free software: you can redistribute it and/or modify\n    it under the terms of the GNU General Public License as published by\n    the Free Software Foundation, either version 3 of the License, or\n    (at your option) any later version.\n\n    This program is distributed in the hope that it will be useful,\n    but WITHOUT ANY WARRANTY; without even the implied warranty of\n    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the\n    GNU General Public License for more details.\n\n    You should have received a copy of the GNU General Public License\n    along with this program.  If not, see <https://www.gnu.org/licenses/>.\n\nAlso add information on how to contact you by electronic and paper mail.\n\n  If the program does terminal interaction, make it output a short\nnotice like this when it starts in an interactive mode:\n\n    EmulatorJS  Copyright (C) 2023-2025  Ethan O\'Brien\n    This program comes with ABSOLUTELY NO WARRANTY; for details type `show w\'.\n    This is free software, and you are welcome to redistribute it\n    under certain conditions; type `show c\' for details.\n\nThe hypothetical commands `show w\' and `show c\' should show the appropriate\nparts of the General Public License.  Of course, your program\'s commands\nmight be different; for a GUI interface, you would use an "about box".\n\n  You should also get your employer (if you work as a programmer) or school,\nif any, to sign a "copyright disclaimer" for the program, if necessary.\nFor more information on this, and how to apply and follow the GNU GPL, see\n<https://www.gnu.org/licenses/>.\n\n  The GNU General Public License does not permit incorporating your program\ninto proprietary programs.  If your program is a subroutine library, you\nmay consider it more useful to permit linking proprietary applications with\nthe library.  If this is what you want to do, use the GNU Lesser General\nPublic License instead of this License.  But first, please read\n<https://www.gnu.org/licenses/why-not-lgpl.html>.\n';
    });

    if (this.config.buttonOpts) {
      if (this.config.buttonOpts.screenshot.visible === false)
        screenshot.setAttribute("hidden", "");
      if (this.config.buttonOpts.screenRecord.visible === false)
        startScreenRecording.setAttribute("hidden", "");
      if (this.config.buttonOpts.quickSave.visible === false)
        qSave.setAttribute("hidden", "");
      if (this.config.buttonOpts.quickLoad.visible === false)
        qLoad.setAttribute("hidden", "");
    }

    this.elements.contextmenu.appendChild(parent);

    this.elements.parent.appendChild(this.elements.contextmenu);
  }
  closePopup() {
    if (this.currentPopup !== null) {
      try {
        this.currentPopup.remove();
      } catch (e) {}
      this.currentPopup = null;
    }
  }
  //creates a full box popup.
  createPopup(popupTitle, buttons, hidden) {
    if (!hidden) this.closePopup();
    const popup = this.createElement("div");
    popup.classList.add("ejs_popup_container");
    this.elements.parent.appendChild(popup);
    const title = this.createElement("h4");
    title.innerText = this.localization(popupTitle);
    const main = this.createElement("div");
    main.classList.add("ejs_popup_body");

    popup.appendChild(title);
    popup.appendChild(main);

    const padding = this.createElement("div");
    padding.style["padding-top"] = "10px";
    popup.appendChild(padding);

    for (let k in buttons) {
      const button = this.createElement("a");
      if (buttons[k] instanceof Function) {
        button.addEventListener("click", (e) => {
          buttons[k]();
          e.preventDefault();
        });
      }
      button.classList.add("ejs_button");
      button.innerText = this.localization(k);
      popup.appendChild(button);
    }
    if (!hidden) {
      this.currentPopup = popup;
    } else {
      popup.style.display = "none";
    }

    return main;
  }
  selectFile() {
    return new Promise((resolve, reject) => {
      const file = this.createElement("input");
      file.type = "file";
      this.addEventListener(file, "change", (e) => {
        resolve(e.target.files[0]);
      });
      file.click();
    });
  }
  isPopupOpen() {
    return (
      this.cheatMenu.style.display !== "none" ||
      this.netplayMenu.style.display !== "none" ||
      this.controlMenu.style.display !== "none" ||
      this.currentPopup !== null
    );
  }
  isChild(first, second) {
    if (!first || !second) return false;
    const adown = first.nodeType === 9 ? first.documentElement : first;

    if (first === second) return true;

    if (adown.contains) {
      return adown.contains(second);
    }

    return (
      first.compareDocumentPosition &&
      first.compareDocumentPosition(second) & 16
    );
  }
  createBottomMenuBar() {
    this.elements.menu = this.createElement("div");

    //prevent weird glitch on some devices
    this.elements.menu.style.opacity = 0;
    this.on("start", (e) => {
      this.elements.menu.style.opacity = "";
    });
    this.elements.menu.classList.add("ejs_menu_bar");
    this.elements.menu.classList.add("ejs_menu_bar_hidden");

    let timeout = null;
    let ignoreEvents = false;
    const hide = () => {
      if (this.paused || this.settingsMenuOpen || this.disksMenuOpen) return;
      this.elements.menu.classList.add("ejs_menu_bar_hidden");
    };

    const show = () => {
      clearTimeout(timeout);
      timeout = setTimeout(hide, 3000);
      this.elements.menu.classList.remove("ejs_menu_bar_hidden");
    };

    this.menu = {
      close: () => {
        clearTimeout(timeout);
        this.elements.menu.classList.add("ejs_menu_bar_hidden");
      },
      open: (force) => {
        if (!this.started && force !== true) return;
        clearTimeout(timeout);
        if (force !== true) timeout = setTimeout(hide, 3000);
        this.elements.menu.classList.remove("ejs_menu_bar_hidden");
      },
      toggle: () => {
        if (!this.started) return;
        clearTimeout(timeout);
        if (this.elements.menu.classList.contains("ejs_menu_bar_hidden")) {
          timeout = setTimeout(hide, 3000);
        }
        this.elements.menu.classList.toggle("ejs_menu_bar_hidden");
      },
    };

    this.createBottomMenuBarListeners = () => {
      const clickListener = (e) => {
        if (e.pointerType === "touch") return;
        if (
          !this.started ||
          ignoreEvents ||
          document.pointerLockElement === this.canvas
        )
          return;
        if (this.isPopupOpen()) return;
        show();
      };
      const mouseListener = (e) => {
        if (
          !this.started ||
          ignoreEvents ||
          document.pointerLockElement === this.canvas
        )
          return;
        if (this.isPopupOpen()) return;
        const deltaX = e.movementX;
        const deltaY = e.movementY;
        const threshold = this.elements.menu.offsetHeight + 30;
        const mouseY = e.clientY;

        if (mouseY >= window.innerHeight - threshold) {
          show();
          return;
        }
        let angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
        if (angle < 0) angle += 360;
        if (angle < 85 || angle > 95) return;
        show();
      };
      if (this.menu.mousemoveListener)
        this.removeEventListener(this.menu.mousemoveListener);

      if (
        (this.preGetSetting("menubarBehavior") || "downward") === "downward"
      ) {
        this.menu.mousemoveListener = this.addEventListener(
          this.elements.parent,
          "mousemove",
          mouseListener
        );
      } else {
        this.menu.mousemoveListener = this.addEventListener(
          this.elements.parent,
          "mousemove",
          clickListener
        );
      }

      this.addEventListener(this.elements.parent, "click", clickListener);
    };
    this.createBottomMenuBarListeners();

    this.elements.parent.appendChild(this.elements.menu);

    let tmout;
    this.addEventListener(this.elements.parent, "mousedown touchstart", (e) => {
      if (
        this.isChild(this.elements.menu, e.target) ||
        this.isChild(this.elements.menuToggle, e.target)
      )
        return;
      if (
        !this.started ||
        this.elements.menu.classList.contains("ejs_menu_bar_hidden") ||
        this.isPopupOpen()
      )
        return;
      const width = this.elements.parent.getBoundingClientRect().width;
      if (width > 575) return;
      clearTimeout(tmout);
      tmout = setTimeout(() => {
        ignoreEvents = false;
      }, 2000);
      ignoreEvents = true;
      this.menu.close();
    });

    let paddingSet = false;
    //Now add buttons
    const addButton = (buttonConfig, callback, element, both) => {
      const button = this.createElement("button");
      button.type = "button";
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("role", "presentation");
      svg.setAttribute("focusable", "false");
      svg.innerHTML = buttonConfig.icon;
      const text = this.createElement("span");
      text.innerText = this.localization(buttonConfig.displayName);
      if (paddingSet) text.classList.add("ejs_menu_text_right");
      text.classList.add("ejs_menu_text");

      button.classList.add("ejs_menu_button");
      button.appendChild(svg);
      button.appendChild(text);
      if (element) {
        element.appendChild(button);
      } else {
        this.elements.menu.appendChild(button);
      }
      if (callback instanceof Function) {
        this.addEventListener(button, "click", callback);
      }

      if (buttonConfig.callback instanceof Function) {
        this.addEventListener(button, "click", buttonConfig.callback);
      }
      return both ? [button, svg, text] : button;
    };

    const restartButton = addButton(this.config.buttonOpts.restart, () => {
      if (this.isNetplay && this.netplay.owner) {
        this.gameManager.restart();
        this.netplay.reset();
        this.netplay.sendMessage({ restart: true });
        this.play();
      } else if (!this.isNetplay) {
        this.gameManager.restart();
      }
    });
    const pauseButton = addButton(this.config.buttonOpts.pause, () => {
      if (this.isNetplay && this.netplay.owner) {
        this.pause();
        this.gameManager.saveSaveFiles();
        this.netplay.sendMessage({ pause: true });
        // Also broadcast a system message to spectators.
        try {
          if (this.netplay.socket && this.netplay.socket.connected) {
            this.netplay.socket.emit("netplay-host-paused", {});
          }
        } catch (e) {
          // ignore
        }
      } else if (!this.isNetplay) {
        this.pause();
      }
    });
    const playButton = addButton(this.config.buttonOpts.play, () => {
      if (this.isNetplay && this.netplay.owner) {
        this.play();
        this.netplay.sendMessage({ play: true });
        try {
          if (this.netplay.socket && this.netplay.socket.connected) {
            this.netplay.socket.emit("netplay-host-resumed", {});
          }
        } catch (e) {
          // ignore
        }
      } else if (!this.isNetplay) {
        this.play();
      }
    });
    playButton.style.display = "none";
    this.togglePlaying = (dontUpdate) => {
      this.paused = !this.paused;
      if (!dontUpdate) {
        if (this.paused) {
          pauseButton.style.display = "none";
          playButton.style.display = "";
        } else {
          pauseButton.style.display = "";
          playButton.style.display = "none";
        }
      }
      this.gameManager.toggleMainLoop(this.paused ? 0 : 1);

      // Notify netplay spectators when host pauses/resumes.
      // This is separate from the P2P input channel.
      if (
        this.isNetplay &&
        this.netplay &&
        this.netplay.owner &&
        this.netplay.socket &&
        this.netplay.socket.connected
      ) {
        try {
          this.netplay.socket.emit(
            this.paused ? "netplay-host-paused" : "netplay-host-resumed",
            {}
          );
        } catch (e) {
          // ignore
        }
      }

      // In SFU netplay, pausing can cause some browsers to stop producing frames
      // from a canvas capture track. On resume, re-produce the SFU video track
      // from a stable capture source.
      if (
        !this.paused &&
        this.isNetplay &&
        this.netplay &&
        this.netplay.owner &&
        this.netplay.useSFU
      ) {
        if (typeof this.netplayReproduceHostVideoToSFU === "function") {
          setTimeout(() => {
            try {
              this.netplayReproduceHostVideoToSFU("resume");
            } catch (e) {
              // ignore
            }
          }, 0);
        }
      }

      //I now realize its not easy to pause it while the cursor is locked, just in case I guess
      if (this.enableMouseLock) {
        if (this.canvas.exitPointerLock) {
          this.canvas.exitPointerLock();
        } else if (this.canvas.mozExitPointerLock) {
          this.canvas.mozExitPointerLock();
        }
      }
    };
    this.play = (dontUpdate) => {
      if (this.paused) this.togglePlaying(dontUpdate);
    };
    this.pause = (dontUpdate) => {
      if (!this.paused) this.togglePlaying(dontUpdate);
    };

    let stateUrl;
    const saveState = addButton(this.config.buttonOpts.saveState, async () => {
      let state;
      try {
        state = this.gameManager.getState();
      } catch (e) {
        this.displayMessage(this.localization("FAILED TO SAVE STATE"));
        return;
      }
      const { screenshot, format } = await this.takeScreenshot(
        this.capture.photo.source,
        this.capture.photo.format,
        this.capture.photo.upscale
      );
      const called = this.callEvent("saveState", {
        screenshot: screenshot,
        format: format,
        state: state,
      });
      if (called > 0) return;
      if (stateUrl) URL.revokeObjectURL(stateUrl);
      if (
        this.getSettingValue("save-state-location") === "browser" &&
        this.saveInBrowserSupported()
      ) {
        this.storage.states.put(this.getBaseFileName() + ".state", state);
        this.displayMessage(this.localization("SAVED STATE TO BROWSER"));
      } else {
        const blob = new Blob([state]);
        stateUrl = URL.createObjectURL(blob);
        const a = this.createElement("a");
        a.href = stateUrl;
        a.download = this.getBaseFileName() + ".state";
        a.click();
      }
    });
    const loadState = addButton(this.config.buttonOpts.loadState, async () => {
      const called = this.callEvent("loadState");
      if (called > 0) return;
      if (
        this.getSettingValue("save-state-location") === "browser" &&
        this.saveInBrowserSupported()
      ) {
        this.storage.states.get(this.getBaseFileName() + ".state").then((e) => {
          this.gameManager.loadState(e);
          this.displayMessage(this.localization("LOADED STATE FROM BROWSER"));
        });
      } else {
        const file = await this.selectFile();
        const state = new Uint8Array(await file.arrayBuffer());
        this.gameManager.loadState(state);
      }
    });
    const controlMenu = addButton(this.config.buttonOpts.gamepad, () => {
      this.controlMenu.style.display = "";
    });
    const cheatMenu = addButton(this.config.buttonOpts.cheat, () => {
      this.cheatMenu.style.display = "";
    });

    const cache = addButton(this.config.buttonOpts.cacheManager, () => {
      this.openCacheMenu();
    });

    if (this.config.disableDatabases) cache.style.display = "none";

    let savUrl;

    const saveSavFiles = addButton(
      this.config.buttonOpts.saveSavFiles,
      async () => {
        const file = await this.gameManager.getSaveFile();
        const { screenshot, format } = await this.takeScreenshot(
          this.capture.photo.source,
          this.capture.photo.format,
          this.capture.photo.upscale
        );
        const called = this.callEvent("saveSave", {
          screenshot: screenshot,
          format: format,
          save: file,
        });
        if (called > 0) return;
        const blob = new Blob([file]);
        savUrl = URL.createObjectURL(blob);
        const a = this.createElement("a");
        a.href = savUrl;
        a.download = this.gameManager.getSaveFilePath().split("/").pop();
        a.click();
      }
    );
    const loadSavFiles = addButton(
      this.config.buttonOpts.loadSavFiles,
      async () => {
        const called = this.callEvent("loadSave");
        if (called > 0) return;
        const file = await this.selectFile();
        const sav = new Uint8Array(await file.arrayBuffer());
        const path = this.gameManager.getSaveFilePath();
        const paths = path.split("/");
        let cp = "";
        for (let i = 0; i < paths.length - 1; i++) {
          if (paths[i] === "") continue;
          cp += "/" + paths[i];
          if (!this.gameManager.FS.analyzePath(cp).exists)
            this.gameManager.FS.mkdir(cp);
        }
        if (this.gameManager.FS.analyzePath(path).exists)
          this.gameManager.FS.unlink(path);
        this.gameManager.FS.writeFile(path, sav);
        this.gameManager.loadSaveFiles();
      }
    );
    const netplay = addButton(this.config.buttonOpts.netplay, async () => {
      this.openNetplayMenu();
    });
    // Ensure the netplay button is visible by default (workaround for styling issues)
    try {
      if (netplay && netplay.style) netplay.style.display = "";
    } catch (e) {}

    // add custom buttons
    // get all elements from this.config.buttonOpts with custom: true
    if (this.config.buttonOpts) {
      for (const [key, value] of Object.entries(this.config.buttonOpts)) {
        if (value.custom === true) {
          const customBtn = addButton(value);
        }
      }
    }

    const spacer = this.createElement("span");
    spacer.classList.add("ejs_menu_bar_spacer");
    this.elements.menu.appendChild(spacer);
    paddingSet = true;

    const volumeSettings = this.createElement("div");
    volumeSettings.classList.add("ejs_volume_parent");
    const muteButton = addButton(
      this.config.buttonOpts.mute,
      () => {
        muteButton.style.display = "none";
        unmuteButton.style.display = "";
        this.muted = true;
        this.setVolume(0);
      },
      volumeSettings
    );
    const unmuteButton = addButton(
      this.config.buttonOpts.unmute,
      () => {
        if (this.volume === 0) this.volume = 0.5;
        muteButton.style.display = "";
        unmuteButton.style.display = "none";
        this.muted = false;
        this.setVolume(this.volume);
      },
      volumeSettings
    );
    unmuteButton.style.display = "none";

    const volumeSlider = this.createElement("input");
    volumeSlider.setAttribute("data-range", "volume");
    volumeSlider.setAttribute("type", "range");
    volumeSlider.setAttribute("min", 0);
    volumeSlider.setAttribute("max", 1);
    volumeSlider.setAttribute("step", 0.01);
    volumeSlider.setAttribute("autocomplete", "off");
    volumeSlider.setAttribute("role", "slider");
    volumeSlider.setAttribute("aria-label", "Volume");
    volumeSlider.setAttribute("aria-valuemin", 0);
    volumeSlider.setAttribute("aria-valuemax", 100);

    this.setVolume = (volume) => {
      this.saveSettings();
      this.muted = volume === 0;
      volumeSlider.value = volume;
      volumeSlider.setAttribute("aria-valuenow", volume * 100);
      volumeSlider.setAttribute(
        "aria-valuetext",
        (volume * 100).toFixed(1) + "%"
      );
      volumeSlider.setAttribute(
        "style",
        "--value: " +
          volume * 100 +
          "%;margin-left: 5px;position: relative;z-index: 2;"
      );
      if (
        this.Module.AL &&
        this.Module.AL.currentCtx &&
        this.Module.AL.currentCtx.sources
      ) {
        this.Module.AL.currentCtx.sources.forEach((e) => {
          e.gain.gain.value = volume;
        });
      }
      if (!this.config.buttonOpts || this.config.buttonOpts.mute !== false) {
        unmuteButton.style.display = volume === 0 ? "" : "none";
        muteButton.style.display = volume === 0 ? "none" : "";
      }
    };

    this.addEventListener(
      volumeSlider,
      "change mousemove touchmove mousedown touchstart mouseup",
      (e) => {
        setTimeout(() => {
          const newVal = parseFloat(volumeSlider.value);
          if (newVal === 0 && this.muted) return;
          this.volume = newVal;
          this.setVolume(this.volume);
        }, 5);
      }
    );

    if (!this.config.buttonOpts || this.config.buttonOpts.volume !== false) {
      volumeSettings.appendChild(volumeSlider);
    }

    this.elements.menu.appendChild(volumeSettings);

    const contextMenuButton = addButton(
      this.config.buttonOpts.contextMenu,
      () => {
        if (this.elements.contextmenu.style.display === "none") {
          this.elements.contextmenu.style.display = "block";
          this.elements.contextmenu.style.left =
            getComputedStyle(this.elements.parent).width.split("px")[0] / 2 -
            getComputedStyle(this.elements.contextmenu).width.split("px")[0] /
              2 +
            "px";
          this.elements.contextmenu.style.top =
            getComputedStyle(this.elements.parent).height.split("px")[0] / 2 -
            getComputedStyle(this.elements.contextmenu).height.split("px")[0] /
              2 +
            "px";
          setTimeout(this.menu.close.bind(this), 20);
        } else {
          this.elements.contextmenu.style.display = "none";
        }
      }
    );

    this.diskParent = this.createElement("div");
    this.diskParent.id = "ejs_disksMenu";
    this.disksMenuOpen = false;
    const diskButton = addButton(
      this.config.buttonOpts.diskButton,
      () => {
        this.disksMenuOpen = !this.disksMenuOpen;
        diskButton[1].classList.toggle("ejs_svg_rotate", this.disksMenuOpen);
        this.disksMenu.style.display = this.disksMenuOpen ? "" : "none";
        diskButton[2].classList.toggle("ejs_disks_text", this.disksMenuOpen);
      },
      this.diskParent,
      true
    );
    this.elements.menu.appendChild(this.diskParent);
    this.closeDisksMenu = () => {
      if (!this.disksMenu) return;
      this.disksMenuOpen = false;
      diskButton[1].classList.toggle("ejs_svg_rotate", this.disksMenuOpen);
      diskButton[2].classList.toggle("ejs_disks_text", this.disksMenuOpen);
      this.disksMenu.style.display = "none";
    };
    this.addEventListener(this.elements.parent, "mousedown touchstart", (e) => {
      if (this.isChild(this.disksMenu, e.target)) return;
      if (e.pointerType === "touch") return;
      if (e.target === diskButton[0] || e.target === diskButton[2]) return;
      this.closeDisksMenu();
    });

    this.settingParent = this.createElement("div");
    this.settingsMenuOpen = false;
    const settingButton = addButton(
      this.config.buttonOpts.settings,
      () => {
        this.settingsMenuOpen = !this.settingsMenuOpen;
        settingButton[1].classList.toggle(
          "ejs_svg_rotate",
          this.settingsMenuOpen
        );
        this.settingsMenu.style.display = this.settingsMenuOpen ? "" : "none";
        settingButton[2].classList.toggle(
          "ejs_settings_text",
          this.settingsMenuOpen
        );
      },
      this.settingParent,
      true
    );
    this.elements.menu.appendChild(this.settingParent);
    this.closeSettingsMenu = () => {
      if (!this.settingsMenu) return;
      this.settingsMenuOpen = false;
      settingButton[1].classList.toggle(
        "ejs_svg_rotate",
        this.settingsMenuOpen
      );
      settingButton[2].classList.toggle(
        "ejs_settings_text",
        this.settingsMenuOpen
      );
      this.settingsMenu.style.display = "none";
    };
    this.addEventListener(this.elements.parent, "mousedown touchstart", (e) => {
      if (this.isChild(this.settingsMenu, e.target)) return;
      if (e.pointerType === "touch") return;
      if (e.target === settingButton[0] || e.target === settingButton[2])
        return;
      this.closeSettingsMenu();
    });

    this.addEventListener(this.canvas, "click", (e) => {
      if (e.pointerType === "touch") return;
      if (this.enableMouseLock && !this.paused) {
        if (this.canvas.requestPointerLock) {
          this.canvas.requestPointerLock();
        } else if (this.canvas.mozRequestPointerLock) {
          this.canvas.mozRequestPointerLock();
        }
        this.menu.close();
      }
    });

    const enter = addButton(this.config.buttonOpts.enterFullscreen, () => {
      this.toggleFullscreen(true);
    });
    const exit = addButton(this.config.buttonOpts.exitFullscreen, () => {
      this.toggleFullscreen(false);
    });
    exit.style.display = "none";

    this.toggleFullscreen = (fullscreen) => {
      if (fullscreen) {
        if (this.elements.parent.requestFullscreen) {
          this.elements.parent.requestFullscreen();
        } else if (this.elements.parent.mozRequestFullScreen) {
          this.elements.parent.mozRequestFullScreen();
        } else if (this.elements.parent.webkitRequestFullscreen) {
          this.elements.parent.webkitRequestFullscreen();
        } else if (this.elements.parent.msRequestFullscreen) {
          this.elements.parent.msRequestFullscreen();
        }
        exit.style.display = "";
        enter.style.display = "none";
        if (this.isMobile) {
          try {
            screen.orientation
              .lock(this.getCore(true) === "nds" ? "portrait" : "landscape")
              .catch((e) => {});
          } catch (e) {}
        }
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
          document.mozCancelFullScreen();
        } else if (document.msExitFullscreen) {
          document.msExitFullscreen();
        }
        exit.style.display = "none";
        enter.style.display = "";
        if (this.isMobile) {
          try {
            screen.orientation.unlock();
          } catch (e) {}
        }
      }
    };

    let exitMenuIsOpen = false;
    const exitEmulation = addButton(
      this.config.buttonOpts.exitEmulation,
      async () => {
        if (exitMenuIsOpen) return;
        exitMenuIsOpen = true;
        const popups = this.createSubPopup();
        this.game.appendChild(popups[0]);
        popups[1].classList.add("ejs_cheat_parent");
        popups[1].style.width = "100%";
        const popup = popups[1];
        const header = this.createElement("div");
        header.classList.add("ejs_cheat_header");
        const title = this.createElement("h2");
        title.innerText = this.localization("Are you sure you want to exit?");
        title.classList.add("ejs_cheat_heading");
        const close = this.createElement("button");
        close.classList.add("ejs_cheat_close");
        header.appendChild(title);
        header.appendChild(close);
        popup.appendChild(header);
        this.addEventListener(close, "click", (e) => {
          exitMenuIsOpen = false;
          popups[0].remove();
        });
        popup.appendChild(this.createElement("br"));

        const footer = this.createElement("footer");
        const submit = this.createElement("button");
        const closeButton = this.createElement("button");
        submit.innerText = this.localization("Exit");
        closeButton.innerText = this.localization("Cancel");
        submit.classList.add("ejs_button_button");
        closeButton.classList.add("ejs_button_button");
        submit.classList.add("ejs_popup_submit");
        closeButton.classList.add("ejs_popup_submit");
        submit.style["background-color"] = "rgba(var(--ejs-primary-color),1)";
        footer.appendChild(submit);
        const span = this.createElement("span");
        span.innerText = " ";
        footer.appendChild(span);
        footer.appendChild(closeButton);
        popup.appendChild(footer);

        this.addEventListener(closeButton, "click", (e) => {
          popups[0].remove();
          exitMenuIsOpen = false;
        });

        this.addEventListener(submit, "click", (e) => {
          popups[0].remove();
          const body = this.createPopup("EmulatorJS has exited", {});
          this.callEvent("exit");
        });
        setTimeout(this.menu.close.bind(this), 20);
      }
    );

    this.addEventListener(
      document,
      "webkitfullscreenchange mozfullscreenchange fullscreenchange",
      (e) => {
        if (e.target !== this.elements.parent) return;
        if (document.fullscreenElement === null) {
          exit.style.display = "none";
          enter.style.display = "";
        } else {
          //not sure if this is possible, lets put it here anyways
          exit.style.display = "";
          enter.style.display = "none";
        }
      }
    );

    const hasFullscreen = !!(
      this.elements.parent.requestFullscreen ||
      this.elements.parent.mozRequestFullScreen ||
      this.elements.parent.webkitRequestFullscreen ||
      this.elements.parent.msRequestFullscreen
    );

    if (!hasFullscreen) {
      exit.style.display = "none";
      enter.style.display = "none";
    }

    this.elements.bottomBar = {
      playPause: [pauseButton, playButton],
      restart: [restartButton],
      settings: [settingButton],
      contextMenu: [contextMenuButton],
      fullscreen: [enter, exit],
      saveState: [saveState],
      loadState: [loadState],
      gamepad: [controlMenu],
      cheat: [cheatMenu],
      cacheManager: [cache],
      saveSavFiles: [saveSavFiles],
      loadSavFiles: [loadSavFiles],
      netplay: [netplay],
      exit: [exitEmulation],
    };

    if (this.config.buttonOpts) {
      if (this.debug) console.log(this.config.buttonOpts);
      if (this.config.buttonOpts.playPause.visible === false) {
        pauseButton.style.display = "none";
        playButton.style.display = "none";
      }
      if (
        this.config.buttonOpts.contextMenu.visible === false &&
        this.config.buttonOpts.rightClick !== false &&
        this.isMobile === false
      )
        contextMenuButton.style.display = "none";
      if (this.config.buttonOpts.restart.visible === false)
        restartButton.style.display = "none";
      if (this.config.buttonOpts.settings.visible === false)
        settingButton[0].style.display = "none";
      if (this.config.buttonOpts.fullscreen.visible === false) {
        enter.style.display = "none";
        exit.style.display = "none";
      }
      if (this.config.buttonOpts.mute.visible === false) {
        muteButton.style.display = "none";
        unmuteButton.style.display = "none";
      }
      if (this.config.buttonOpts.saveState.visible === false)
        saveState.style.display = "none";
      if (this.config.buttonOpts.loadState.visible === false)
        loadState.style.display = "none";
      if (this.config.buttonOpts.saveSavFiles.visible === false)
        saveSavFiles.style.display = "none";
      if (this.config.buttonOpts.loadSavFiles.visible === false)
        loadSavFiles.style.display = "none";
      if (this.config.buttonOpts.gamepad.visible === false)
        controlMenu.style.display = "none";
      if (this.config.buttonOpts.cheat.visible === false)
        cheatMenu.style.display = "none";
      if (this.config.buttonOpts.cacheManager.visible === false)
        cache.style.display = "none";
      if (this.config.buttonOpts.netplay.visible === false)
        netplay.style.display = "none";
      if (this.config.buttonOpts.diskButton.visible === false)
        diskButton[0].style.display = "none";
      if (this.config.buttonOpts.volumeSlider.visible === false)
        volumeSlider.style.display = "none";
      if (this.config.buttonOpts.exitEmulation.visible === false)
        exitEmulation.style.display = "none";
    }

    this.menu.failedToStart = () => {
      if (!this.config.buttonOpts) this.config.buttonOpts = {};
      this.config.buttonOpts.mute = false;

      settingButton[0].style.display = "";

      // Hide all except settings button.
      pauseButton.style.display = "none";
      playButton.style.display = "none";
      contextMenuButton.style.display = "none";
      restartButton.style.display = "none";
      enter.style.display = "none";
      exit.style.display = "none";
      muteButton.style.display = "none";
      unmuteButton.style.display = "none";
      saveState.style.display = "none";
      loadState.style.display = "none";
      saveSavFiles.style.display = "none";
      loadSavFiles.style.display = "none";
      controlMenu.style.display = "none";
      cheatMenu.style.display = "none";
      cache.style.display = "none";
      netplay.style.display = "none";
      diskButton[0].style.display = "none";
      volumeSlider.style.display = "none";
      exitEmulation.style.display = "none";

      this.elements.menu.style.opacity = "";
      this.elements.menu.style.background = "transparent";
      this.virtualGamepad.style.display = "none";
      settingButton[0].classList.add("shadow");
      this.menu.open(true);
    };
  }
  openCacheMenu() {
    (async () => {
      const list = this.createElement("table");
      const tbody = this.createElement("tbody");
      const body = this.createPopup("Cache Manager", {
        "Clear All": async () => {
          const roms = await this.storage.rom.getSizes();
          for (const k in roms) {
            await this.storage.rom.remove(k);
          }
          tbody.innerHTML = "";
        },
        Close: () => {
          this.closePopup();
        },
      });
      const roms = await this.storage.rom.getSizes();
      list.style.width = "100%";
      list.style["padding-left"] = "10px";
      list.style["text-align"] = "left";
      body.appendChild(list);
      list.appendChild(tbody);
      const getSize = function (size) {
        let i = -1;
        do {
          (size /= 1024), i++;
        } while (size > 1024);
        return (
          Math.max(size, 0.1).toFixed(1) +
          [" kB", " MB", " GB", " TB", "PB", "EB", "ZB", "YB"][i]
        );
      };
      for (const k in roms) {
        const line = this.createElement("tr");
        const name = this.createElement("td");
        const size = this.createElement("td");
        const remove = this.createElement("td");
        remove.style.cursor = "pointer";
        name.innerText = k;
        size.innerText = getSize(roms[k]);

        const a = this.createElement("a");
        a.innerText = this.localization("Remove");
        this.addEventListener(remove, "click", () => {
          this.storage.rom.remove(k);
          line.remove();
        });
        remove.appendChild(a);

        line.appendChild(name);
        line.appendChild(size);
        line.appendChild(remove);
        tbody.appendChild(line);
      }
    })();
  }
  getControlScheme() {
    if (
      this.config.controlScheme &&
      typeof this.config.controlScheme === "string"
    ) {
      return this.config.controlScheme;
    } else {
      return this.getCore(true);
    }
  }
  createControlSettingMenu() {
    let buttonListeners = [];
    this.checkGamepadInputs = () => buttonListeners.forEach((elem) => elem());
    this.gamepadLabels = [];
    this.gamepadSelection = [];
    this.controls = JSON.parse(JSON.stringify(this.defaultControllers));
    const body = this.createPopup(
      "Control Settings",
      {
        Reset: () => {
          this.controls = JSON.parse(JSON.stringify(this.defaultControllers));
          this.setupKeys();
          this.checkGamepadInputs();
          this.saveSettings();
        },
        Clear: () => {
          this.controls = { 0: {}, 1: {}, 2: {}, 3: {} };
          this.setupKeys();
          this.checkGamepadInputs();
          this.saveSettings();
        },
        Close: () => {
          this.controlMenu.style.display = "none";
        },
      },
      true
    );
    this.setupKeys();
    this.controlMenu = body.parentElement;
    body.classList.add("ejs_control_body");

    let buttons;
    if ("gb" === this.getControlScheme()) {
      buttons = [
        { id: 8, label: this.localization("A") },
        { id: 0, label: this.localization("B") },
        { id: 2, label: this.localization("SELECT") },
        { id: 3, label: this.localization("START") },
        { id: 4, label: this.localization("UP") },
        { id: 5, label: this.localization("DOWN") },
        { id: 6, label: this.localization("LEFT") },
        { id: 7, label: this.localization("RIGHT") },
      ];
    } else if ("nes" === this.getControlScheme()) {
      buttons = [
        { id: 8, label: this.localization("A") },
        { id: 0, label: this.localization("B") },
        { id: 2, label: this.localization("SELECT") },
        { id: 3, label: this.localization("START") },
        { id: 4, label: this.localization("UP") },
        { id: 5, label: this.localization("DOWN") },
        { id: 6, label: this.localization("LEFT") },
        { id: 7, label: this.localization("RIGHT") },
      ];
      if (this.getCore() === "nestopia") {
        buttons.push({ id: 10, label: this.localization("SWAP DISKS") });
      } else {
        buttons.push({ id: 10, label: this.localization("SWAP DISKS") });
        buttons.push({ id: 11, label: this.localization("EJECT/INSERT DISK") });
      }
    } else if ("snes" === this.getControlScheme()) {
      buttons = [
        { id: 8, label: this.localization("A") },
        { id: 0, label: this.localization("B") },
        { id: 9, label: this.localization("X") },
        { id: 1, label: this.localization("Y") },
        { id: 2, label: this.localization("SELECT") },
        { id: 3, label: this.localization("START") },
        { id: 4, label: this.localization("UP") },
        { id: 5, label: this.localization("DOWN") },
        { id: 6, label: this.localization("LEFT") },
        { id: 7, label: this.localization("RIGHT") },
        { id: 10, label: this.localization("L") },
        { id: 11, label: this.localization("R") },
      ];
    } else if ("n64" === this.getControlScheme()) {
      buttons = [
        { id: 0, label: this.localization("A") },
        { id: 1, label: this.localization("B") },
        { id: 3, label: this.localization("START") },
        { id: 4, label: this.localization("D-PAD UP") },
        { id: 5, label: this.localization("D-PAD DOWN") },
        { id: 6, label: this.localization("D-PAD LEFT") },
        { id: 7, label: this.localization("D-PAD RIGHT") },
        { id: 10, label: this.localization("L") },
        { id: 11, label: this.localization("R") },
        { id: 12, label: this.localization("Z") },
        { id: 19, label: this.localization("STICK UP") },
        { id: 18, label: this.localization("STICK DOWN") },
        { id: 17, label: this.localization("STICK LEFT") },
        { id: 16, label: this.localization("STICK RIGHT") },
        { id: 23, label: this.localization("C-PAD UP") },
        { id: 22, label: this.localization("C-PAD DOWN") },
        { id: 21, label: this.localization("C-PAD LEFT") },
        { id: 20, label: this.localization("C-PAD RIGHT") },
      ];
    } else if ("gba" === this.getControlScheme()) {
      buttons = [
        { id: 8, label: this.localization("A") },
        { id: 0, label: this.localization("B") },
        { id: 10, label: this.localization("L") },
        { id: 11, label: this.localization("R") },
        { id: 2, label: this.localization("SELECT") },
        { id: 3, label: this.localization("START") },
        { id: 4, label: this.localization("UP") },
        { id: 5, label: this.localization("DOWN") },
        { id: 6, label: this.localization("LEFT") },
        { id: 7, label: this.localization("RIGHT") },
      ];
    } else if ("nds" === this.getControlScheme()) {
      buttons = [
        { id: 8, label: this.localization("A") },
        { id: 0, label: this.localization("B") },
        { id: 9, label: this.localization("X") },
        { id: 1, label: this.localization("Y") },
        { id: 2, label: this.localization("SELECT") },
        { id: 3, label: this.localization("START") },
        { id: 4, label: this.localization("UP") },
        { id: 5, label: this.localization("DOWN") },
        { id: 6, label: this.localization("LEFT") },
        { id: 7, label: this.localization("RIGHT") },
        { id: 10, label: this.localization("L") },
        { id: 11, label: this.localization("R") },
        { id: 14, label: this.localization("Microphone") },
      ];
    } else if ("vb" === this.getControlScheme()) {
      buttons = [
        { id: 8, label: this.localization("A") },
        { id: 0, label: this.localization("B") },
        { id: 10, label: this.localization("L") },
        { id: 11, label: this.localization("R") },
        { id: 2, label: this.localization("SELECT") },
        { id: 3, label: this.localization("START") },
        { id: 4, label: this.localization("LEFT D-PAD UP") },
        { id: 5, label: this.localization("LEFT D-PAD DOWN") },
        { id: 6, label: this.localization("LEFT D-PAD LEFT") },
        { id: 7, label: this.localization("LEFT D-PAD RIGHT") },
        { id: 19, label: this.localization("RIGHT D-PAD UP") },
        { id: 18, label: this.localization("RIGHT D-PAD DOWN") },
        { id: 17, label: this.localization("RIGHT D-PAD LEFT") },
        { id: 16, label: this.localization("RIGHT D-PAD RIGHT") },
      ];
    } else if (
      ["segaMD", "segaCD", "sega32x"].includes(this.getControlScheme())
    ) {
      buttons = [
        { id: 1, label: this.localization("A") },
        { id: 0, label: this.localization("B") },
        { id: 8, label: this.localization("C") },
        { id: 10, label: this.localization("X") },
        { id: 9, label: this.localization("Y") },
        { id: 11, label: this.localization("Z") },
        { id: 3, label: this.localization("START") },
        { id: 2, label: this.localization("MODE") },
        { id: 4, label: this.localization("UP") },
        { id: 5, label: this.localization("DOWN") },
        { id: 6, label: this.localization("LEFT") },
        { id: 7, label: this.localization("RIGHT") },
      ];
    } else if ("segaMS" === this.getControlScheme()) {
      buttons = [
        { id: 0, label: this.localization("BUTTON 1 / START") },
        { id: 8, label: this.localization("BUTTON 2") },
        { id: 4, label: this.localization("UP") },
        { id: 5, label: this.localization("DOWN") },
        { id: 6, label: this.localization("LEFT") },
        { id: 7, label: this.localization("RIGHT") },
      ];
    } else if ("segaGG" === this.getControlScheme()) {
      buttons = [
        { id: 0, label: this.localization("BUTTON 1") },
        { id: 8, label: this.localization("BUTTON 2") },
        { id: 3, label: this.localization("START") },
        { id: 4, label: this.localization("UP") },
        { id: 5, label: this.localization("DOWN") },
        { id: 6, label: this.localization("LEFT") },
        { id: 7, label: this.localization("RIGHT") },
      ];
    } else if ("segaSaturn" === this.getControlScheme()) {
      buttons = [
        { id: 1, label: this.localization("A") },
        { id: 0, label: this.localization("B") },
        { id: 8, label: this.localization("C") },
        { id: 9, label: this.localization("X") },
        { id: 10, label: this.localization("Y") },
        { id: 11, label: this.localization("Z") },
        { id: 12, label: this.localization("L") },
        { id: 13, label: this.localization("R") },
        { id: 3, label: this.localization("START") },
        { id: 4, label: this.localization("UP") },
        { id: 5, label: this.localization("DOWN") },
        { id: 6, label: this.localization("LEFT") },
        { id: 7, label: this.localization("RIGHT") },
      ];
    } else if ("3do" === this.getControlScheme()) {
      buttons = [
        { id: 1, label: this.localization("A") },
        { id: 0, label: this.localization("B") },
        { id: 8, label: this.localization("C") },
        { id: 10, label: this.localization("L") },
        { id: 11, label: this.localization("R") },
        { id: 2, label: this.localization("X") },
        { id: 3, label: this.localization("P") },
        { id: 4, label: this.localization("UP") },
        { id: 5, label: this.localization("DOWN") },
        { id: 6, label: this.localization("LEFT") },
        { id: 7, label: this.localization("RIGHT") },
      ];
    } else if ("atari2600" === this.getControlScheme()) {
      buttons = [
        { id: 0, label: this.localization("FIRE") },
        { id: 2, label: this.localization("SELECT") },
        { id: 3, label: this.localization("RESET") },
        { id: 4, label: this.localization("UP") },
        { id: 5, label: this.localization("DOWN") },
        { id: 6, label: this.localization("LEFT") },
        { id: 7, label: this.localization("RIGHT") },
        { id: 10, label: this.localization("LEFT DIFFICULTY A") },
        { id: 12, label: this.localization("LEFT DIFFICULTY B") },
        { id: 11, label: this.localization("RIGHT DIFFICULTY A") },
        { id: 13, label: this.localization("RIGHT DIFFICULTY B") },
        { id: 14, label: this.localization("COLOR") },
        { id: 15, label: this.localization("B/W") },
      ];
    } else if ("atari7800" === this.getControlScheme()) {
      buttons = [
        { id: 0, label: this.localization("BUTTON 1") },
        { id: 8, label: this.localization("BUTTON 2") },
        { id: 2, label: this.localization("SELECT") },
        { id: 3, label: this.localization("PAUSE") },
        { id: 9, label: this.localization("RESET") },
        { id: 4, label: this.localization("UP") },
        { id: 5, label: this.localization("DOWN") },
        { id: 6, label: this.localization("LEFT") },
        { id: 7, label: this.localization("RIGHT") },
        { id: 10, label: this.localization("LEFT DIFFICULTY") },
        { id: 11, label: this.localization("RIGHT DIFFICULTY") },
      ];
    } else if ("lynx" === this.getControlScheme()) {
      buttons = [
        { id: 8, label: this.localization("A") },
        { id: 0, label: this.localization("B") },
        { id: 10, label: this.localization("OPTION 1") },
        { id: 11, label: this.localization("OPTION 2") },
        { id: 3, label: this.localization("START") },
        { id: 4, label: this.localization("UP") },
        { id: 5, label: this.localization("DOWN") },
        { id: 6, label: this.localization("LEFT") },
        { id: 7, label: this.localization("RIGHT") },
      ];
    } else if ("jaguar" === this.getControlScheme()) {
      buttons = [
        { id: 8, label: this.localization("A") },
        { id: 0, label: this.localization("B") },
        { id: 1, label: this.localization("C") },
        { id: 2, label: this.localization("PAUSE") },
        { id: 3, label: this.localization("OPTION") },
        { id: 4, label: this.localization("UP") },
        { id: 5, label: this.localization("DOWN") },
        { id: 6, label: this.localization("LEFT") },
        { id: 7, label: this.localization("RIGHT") },
      ];
    } else if ("pce" === this.getControlScheme()) {
      buttons = [
        { id: 8, label: this.localization("I") },
        { id: 0, label: this.localization("II") },
        { id: 2, label: this.localization("SELECT") },
        { id: 3, label: this.localization("RUN") },
        { id: 4, label: this.localization("UP") },
        { id: 5, label: this.localization("DOWN") },
        { id: 6, label: this.localization("LEFT") },
        { id: 7, label: this.localization("RIGHT") },
      ];
    } else if ("ngp" === this.getControlScheme()) {
      buttons = [
        { id: 0, label: this.localization("A") },
        { id: 8, label: this.localization("B") },
        { id: 3, label: this.localization("OPTION") },
        { id: 4, label: this.localization("UP") },
        { id: 5, label: this.localization("DOWN") },
        { id: 6, label: this.localization("LEFT") },
        { id: 7, label: this.localization("RIGHT") },
      ];
    } else if ("ws" === this.getControlScheme()) {
      buttons = [
        { id: 8, label: this.localization("A") },
        { id: 0, label: this.localization("B") },
        { id: 3, label: this.localization("START") },
        { id: 4, label: this.localization("X UP") },
        { id: 5, label: this.localization("X DOWN") },
        { id: 6, label: this.localization("X LEFT") },
        { id: 7, label: this.localization("X RIGHT") },
        { id: 13, label: this.localization("Y UP") },
        { id: 12, label: this.localization("Y DOWN") },
        { id: 10, label: this.localization("Y LEFT") },
        { id: 11, label: this.localization("Y RIGHT") },
      ];
    } else if ("coleco" === this.getControlScheme()) {
      buttons = [
        { id: 8, label: this.localization("LEFT BUTTON") },
        { id: 0, label: this.localization("RIGHT BUTTON") },
        { id: 9, label: this.localization("1") },
        { id: 1, label: this.localization("2") },
        { id: 11, label: this.localization("3") },
        { id: 10, label: this.localization("4") },
        { id: 13, label: this.localization("5") },
        { id: 12, label: this.localization("6") },
        { id: 15, label: this.localization("7") },
        { id: 14, label: this.localization("8") },
        { id: 2, label: this.localization("*") },
        { id: 3, label: this.localization("#") },
        { id: 4, label: this.localization("UP") },
        { id: 5, label: this.localization("DOWN") },
        { id: 6, label: this.localization("LEFT") },
        { id: 7, label: this.localization("RIGHT") },
      ];
    } else if ("pcfx" === this.getControlScheme()) {
      buttons = [
        { id: 8, label: this.localization("I") },
        { id: 0, label: this.localization("II") },
        { id: 9, label: this.localization("III") },
        { id: 1, label: this.localization("IV") },
        { id: 10, label: this.localization("V") },
        { id: 11, label: this.localization("VI") },
        { id: 3, label: this.localization("RUN") },
        { id: 2, label: this.localization("SELECT") },
        { id: 12, label: this.localization("MODE1") },
        { id: 13, label: this.localization("MODE2") },
        { id: 4, label: this.localization("UP") },
        { id: 5, label: this.localization("DOWN") },
        { id: 6, label: this.localization("LEFT") },
        { id: 7, label: this.localization("RIGHT") },
      ];
    } else if ("psp" === this.getControlScheme()) {
      buttons = [
        { id: 9, label: this.localization("\u25B3") }, // △
        { id: 1, label: this.localization("\u25A1") }, // □
        { id: 0, label: this.localization("\uFF58") }, // ｘ
        { id: 8, label: this.localization("\u25CB") }, // ○
        { id: 2, label: this.localization("SELECT") },
        { id: 3, label: this.localization("START") },
        { id: 4, label: this.localization("UP") },
        { id: 5, label: this.localization("DOWN") },
        { id: 6, label: this.localization("LEFT") },
        { id: 7, label: this.localization("RIGHT") },
        { id: 10, label: this.localization("L") },
        { id: 11, label: this.localization("R") },
        { id: 19, label: this.localization("STICK UP") },
        { id: 18, label: this.localization("STICK DOWN") },
        { id: 17, label: this.localization("STICK LEFT") },
        { id: 16, label: this.localization("STICK RIGHT") },
      ];
    } else if ("psx" === this.getControlScheme()) {
      buttons = [
        { id: 9, label: this.localization("\u25B3") }, // △
        { id: 1, label: this.localization("\u25A1") }, // □
        { id: 0, label: this.localization("\uFF58") }, // ｘ
        { id: 8, label: this.localization("\u25CB") }, // ○
        { id: 2, label: this.localization("SELECT") },
        { id: 3, label: this.localization("START") },
        { id: 4, label: this.localization("UP") },
        { id: 5, label: this.localization("DOWN") },
        { id: 6, label: this.localization("LEFT") },
        { id: 7, label: this.localization("RIGHT") },
        { id: 10, label: this.localization("L1") },
        { id: 11, label: this.localization("R1") },
        { id: 12, label: this.localization("L2") },
        { id: 13, label: this.localization("R2") },
        { id: 19, label: this.localization("L STICK UP") },
        { id: 18, label: this.localization("L STICK DOWN") },
        { id: 17, label: this.localization("L STICK LEFT") },
        { id: 16, label: this.localization("L STICK RIGHT") },
        { id: 23, label: this.localization("R STICK UP") },
        { id: 22, label: this.localization("R STICK DOWN") },
        { id: 21, label: this.localization("R STICK LEFT") },
        { id: 20, label: this.localization("R STICK RIGHT") },
      ];
    } else {
      buttons = [
        { id: 0, label: this.localization("B") },
        { id: 1, label: this.localization("Y") },
        { id: 2, label: this.localization("SELECT") },
        { id: 3, label: this.localization("START") },
        { id: 4, label: this.localization("UP") },
        { id: 5, label: this.localization("DOWN") },
        { id: 6, label: this.localization("LEFT") },
        { id: 7, label: this.localization("RIGHT") },
        { id: 8, label: this.localization("A") },
        { id: 9, label: this.localization("X") },
        { id: 10, label: this.localization("L") },
        { id: 11, label: this.localization("R") },
        { id: 12, label: this.localization("L2") },
        { id: 13, label: this.localization("R2") },
        { id: 14, label: this.localization("L3") },
        { id: 15, label: this.localization("R3") },
        { id: 19, label: this.localization("L STICK UP") },
        { id: 18, label: this.localization("L STICK DOWN") },
        { id: 17, label: this.localization("L STICK LEFT") },
        { id: 16, label: this.localization("L STICK RIGHT") },
        { id: 23, label: this.localization("R STICK UP") },
        { id: 22, label: this.localization("R STICK DOWN") },
        { id: 21, label: this.localization("R STICK LEFT") },
        { id: 20, label: this.localization("R STICK RIGHT") },
      ];
    }
    if (["arcade", "mame"].includes(this.getControlScheme())) {
      for (const buttonIdx in buttons) {
        if (buttons[buttonIdx].id === 2) {
          buttons[buttonIdx].label = this.localization("INSERT COIN");
        }
      }
    }
    buttons.push(
      { id: 24, label: this.localization("QUICK SAVE STATE") },
      { id: 25, label: this.localization("QUICK LOAD STATE") },
      { id: 26, label: this.localization("CHANGE STATE SLOT") },
      { id: 27, label: this.localization("FAST FORWARD") },
      { id: 29, label: this.localization("SLOW MOTION") },
      { id: 28, label: this.localization("REWIND") }
    );
    let nums = [];
    for (let i = 0; i < buttons.length; i++) {
      nums.push(buttons[i].id);
    }
    for (let i = 0; i < 30; i++) {
      if (!nums.includes(i)) {
        delete this.defaultControllers[0][i];
        delete this.defaultControllers[1][i];
        delete this.defaultControllers[2][i];
        delete this.defaultControllers[3][i];
        delete this.controls[0][i];
        delete this.controls[1][i];
        delete this.controls[2][i];
        delete this.controls[3][i];
      }
    }

    //if (_this.statesSupported === false) {
    //    delete buttons[24];
    //    delete buttons[25];
    //    delete buttons[26];
    //}
    let selectedPlayer;
    let players = [];
    let playerDivs = [];

    const playerSelect = this.createElement("ul");
    playerSelect.classList.add("ejs_control_player_bar");
    for (let i = 1; i < 5; i++) {
      const playerContainer = this.createElement("li");
      playerContainer.classList.add("tabs-title");
      playerContainer.setAttribute("role", "presentation");
      const player = this.createElement("a");
      player.innerText = this.localization("Player") + " " + i;
      player.setAttribute("role", "tab");
      player.setAttribute("aria-controls", "controls-" + (i - 1));
      player.setAttribute("aria-selected", "false");
      player.id = "controls-" + (i - 1) + "-label";
      this.addEventListener(player, "click", (e) => {
        e.preventDefault();
        players[selectedPlayer].classList.remove("ejs_control_selected");
        playerDivs[selectedPlayer].setAttribute("hidden", "");
        selectedPlayer = i - 1;
        players[i - 1].classList.add("ejs_control_selected");
        playerDivs[i - 1].removeAttribute("hidden");
      });
      playerContainer.appendChild(player);
      playerSelect.appendChild(playerContainer);
      players.push(playerContainer);
    }
    body.appendChild(playerSelect);

    const controls = this.createElement("div");
    for (let i = 0; i < 4; i++) {
      if (!this.controls[i]) this.controls[i] = {};
      const player = this.createElement("div");
      const playerTitle = this.createElement("div");

      const gamepadTitle = this.createElement("div");
      gamepadTitle.innerText = this.localization("Connected Gamepad") + ": ";

      const gamepadName = this.createElement("select");
      gamepadName.classList.add("ejs_gamepad_dropdown");
      gamepadName.setAttribute("title", "gamepad-" + i);
      gamepadName.setAttribute("index", i);
      this.gamepadLabels.push(gamepadName);
      this.gamepadSelection.push("");
      this.addEventListener(gamepadName, "change", (e) => {
        const controller = e.target.value;
        const player = parseInt(e.target.getAttribute("index"));
        if (controller === "notconnected") {
          this.gamepadSelection[player] = "";
        } else {
          for (let i = 0; i < this.gamepadSelection.length; i++) {
            if (player === i) continue;
            if (this.gamepadSelection[i] === controller) {
              this.gamepadSelection[i] = "";
            }
          }
          this.gamepadSelection[player] = controller;
          this.updateGamepadLabels();
        }
      });
      const def = this.createElement("option");
      def.setAttribute("value", "notconnected");
      def.innerText = "Not Connected";
      gamepadName.appendChild(def);
      gamepadTitle.appendChild(gamepadName);
      gamepadTitle.classList.add("ejs_gamepad_section");

      const leftPadding = this.createElement("div");
      leftPadding.style = "width:25%;float:left;";
      leftPadding.innerHTML = "&nbsp;";

      const aboutParent = this.createElement("div");
      aboutParent.style = "font-size:12px;width:50%;float:left;";
      const gamepad = this.createElement("div");
      gamepad.style = "text-align:center;width:50%;float:left;";
      gamepad.innerText = this.localization("Gamepad");
      aboutParent.appendChild(gamepad);
      const keyboard = this.createElement("div");
      keyboard.style = "text-align:center;width:50%;float:left;";
      keyboard.innerText = this.localization("Keyboard");
      aboutParent.appendChild(keyboard);

      const headingPadding = this.createElement("div");
      headingPadding.style = "clear:both;";

      playerTitle.appendChild(gamepadTitle);
      playerTitle.appendChild(leftPadding);
      playerTitle.appendChild(aboutParent);

      if ((this.touch || this.hasTouchScreen) && i === 0) {
        const vgp = this.createElement("div");
        vgp.style =
          "width:25%;float:right;clear:none;padding:0;font-size: 11px;padding-left: 2.25rem;";
        vgp.classList.add("ejs_control_row");
        vgp.classList.add("ejs_cheat_row");
        const input = this.createElement("input");
        input.type = "checkbox";
        input.checked = true;
        input.value = "o";
        input.id = "ejs_vp";
        vgp.appendChild(input);
        const label = this.createElement("label");
        label.for = "ejs_vp";
        label.innerText = "Virtual Gamepad";
        vgp.appendChild(label);
        label.addEventListener("click", (e) => {
          input.checked = !input.checked;
          this.changeSettingOption(
            "virtual-gamepad",
            input.checked ? "enabled" : "disabled"
          );
        });
        this.on("start", (e) => {
          if (this.getSettingValue("virtual-gamepad") === "disabled") {
            input.checked = false;
          }
        });
        playerTitle.appendChild(vgp);
      }

      playerTitle.appendChild(headingPadding);

      player.appendChild(playerTitle);

      for (const buttonIdx in buttons) {
        const k = buttons[buttonIdx].id;
        const controlLabel = buttons[buttonIdx].label;

        const buttonText = this.createElement("div");
        buttonText.setAttribute("data-id", k);
        buttonText.setAttribute("data-index", i);
        buttonText.setAttribute("data-label", controlLabel);
        buttonText.style = "margin-bottom:10px;";
        buttonText.classList.add("ejs_control_bar");

        const title = this.createElement("div");
        title.style = "width:25%;float:left;font-size:12px;";
        const label = this.createElement("label");
        label.innerText = controlLabel + ":";
        title.appendChild(label);

        const textBoxes = this.createElement("div");
        textBoxes.style = "width:50%;float:left;";

        const textBox1Parent = this.createElement("div");
        textBox1Parent.style = "width:50%;float:left;padding: 0 5px;";
        const textBox1 = this.createElement("input");
        textBox1.style = "text-align:center;height:25px;width: 100%;";
        textBox1.type = "text";
        textBox1.setAttribute("readonly", "");
        textBox1.setAttribute("placeholder", "");
        textBox1Parent.appendChild(textBox1);

        const textBox2Parent = this.createElement("div");
        textBox2Parent.style = "width:50%;float:left;padding: 0 5px;";
        const textBox2 = this.createElement("input");
        textBox2.style = "text-align:center;height:25px;width: 100%;";
        textBox2.type = "text";
        textBox2.setAttribute("readonly", "");
        textBox2.setAttribute("placeholder", "");
        textBox2Parent.appendChild(textBox2);

        buttonListeners.push(() => {
          textBox2.value = "";
          textBox1.value = "";
          if (this.controls[i][k] && this.controls[i][k].value !== undefined) {
            let value = this.keyMap[this.controls[i][k].value];
            value = this.localization(value);
            textBox2.value = value;
          }
          if (
            this.controls[i][k] &&
            this.controls[i][k].value2 !== undefined &&
            this.controls[i][k].value2 !== ""
          ) {
            let value2 = this.controls[i][k].value2.toString();
            if (value2.includes(":")) {
              value2 = value2.split(":");
              value2 =
                this.localization(value2[0]) +
                ":" +
                this.localization(value2[1]);
            } else if (!isNaN(value2)) {
              value2 =
                this.localization("BUTTON") + " " + this.localization(value2);
            } else {
              value2 = this.localization(value2);
            }
            textBox1.value = value2;
          }
        });

        if (this.controls[i][k] && this.controls[i][k].value) {
          let value = this.keyMap[this.controls[i][k].value];
          value = this.localization(value);
          textBox2.value = value;
        }
        if (this.controls[i][k] && this.controls[i][k].value2) {
          let value2 = this.controls[i][k].value2.toString();
          if (value2.includes(":")) {
            value2 = value2.split(":");
            value2 =
              this.localization(value2[0]) + ":" + this.localization(value2[1]);
          } else if (!isNaN(value2)) {
            value2 =
              this.localization("BUTTON") + " " + this.localization(value2);
          } else {
            value2 = this.localization(value2);
          }
          textBox1.value = value2;
        }

        textBoxes.appendChild(textBox1Parent);
        textBoxes.appendChild(textBox2Parent);

        const padding = this.createElement("div");
        padding.style = "clear:both;";
        textBoxes.appendChild(padding);

        const setButton = this.createElement("div");
        setButton.style = "width:25%;float:left;";
        const button = this.createElement("a");
        button.classList.add("ejs_control_set_button");
        button.innerText = this.localization("Set");
        setButton.appendChild(button);

        const padding2 = this.createElement("div");
        padding2.style = "clear:both;";

        buttonText.appendChild(title);
        buttonText.appendChild(textBoxes);
        buttonText.appendChild(setButton);
        buttonText.appendChild(padding2);

        player.appendChild(buttonText);

        this.addEventListener(buttonText, "mousedown", (e) => {
          e.preventDefault();
          this.controlPopup.parentElement.parentElement.removeAttribute(
            "hidden"
          );
          this.controlPopup.innerText =
            "[ " + controlLabel + " ]\n" + this.localization("Press Keyboard");
          this.controlPopup.setAttribute("button-num", k);
          this.controlPopup.setAttribute("player-num", i);
        });
      }
      controls.appendChild(player);
      player.setAttribute("hidden", "");
      playerDivs.push(player);
    }
    body.appendChild(controls);

    selectedPlayer = 0;
    players[0].classList.add("ejs_control_selected");
    playerDivs[0].removeAttribute("hidden");

    const popup = this.createElement("div");
    popup.classList.add("ejs_popup_container");
    const popupMsg = this.createElement("div");
    this.addEventListener(popup, "mousedown click touchstart", (e) => {
      if (this.isChild(popupMsg, e.target)) return;
      this.controlPopup.parentElement.parentElement.setAttribute("hidden", "");
    });
    const btn = this.createElement("a");
    btn.classList.add("ejs_control_set_button");
    btn.innerText = this.localization("Clear");
    this.addEventListener(btn, "mousedown click touchstart", (e) => {
      const num = this.controlPopup.getAttribute("button-num");
      const player = this.controlPopup.getAttribute("player-num");
      if (!this.controls[player][num]) {
        this.controls[player][num] = {};
      }
      this.controls[player][num].value = 0;
      this.controls[player][num].value2 = "";
      this.controlPopup.parentElement.parentElement.setAttribute("hidden", "");
      this.checkGamepadInputs();
      this.saveSettings();
    });
    popupMsg.classList.add("ejs_popup_box");
    popupMsg.innerText = "";
    popup.setAttribute("hidden", "");
    const popMsg = this.createElement("div");
    this.controlPopup = popMsg;
    popup.appendChild(popupMsg);
    popupMsg.appendChild(popMsg);
    popupMsg.appendChild(this.createElement("br"));
    popupMsg.appendChild(btn);
    this.controlMenu.appendChild(popup);
  }
  initControlVars() {
    this.defaultControllers = {
      0: {
        0: {
          value: "x",
          value2: "BUTTON_2",
        },
        1: {
          value: "s",
          value2: "BUTTON_4",
        },
        2: {
          value: "v",
          value2: "SELECT",
        },
        3: {
          value: "enter",
          value2: "START",
        },
        4: {
          value: "up arrow",
          value2: "DPAD_UP",
        },
        5: {
          value: "down arrow",
          value2: "DPAD_DOWN",
        },
        6: {
          value: "left arrow",
          value2: "DPAD_LEFT",
        },
        7: {
          value: "right arrow",
          value2: "DPAD_RIGHT",
        },
        8: {
          value: "z",
          value2: "BUTTON_1",
        },
        9: {
          value: "a",
          value2: "BUTTON_3",
        },
        10: {
          value: "q",
          value2: "LEFT_TOP_SHOULDER",
        },
        11: {
          value: "e",
          value2: "RIGHT_TOP_SHOULDER",
        },
        12: {
          value: "tab",
          value2: "LEFT_BOTTOM_SHOULDER",
        },
        13: {
          value: "r",
          value2: "RIGHT_BOTTOM_SHOULDER",
        },
        14: {
          value: "",
          value2: "LEFT_STICK",
        },
        15: {
          value: "",
          value2: "RIGHT_STICK",
        },
        16: {
          value: "h",
          value2: "LEFT_STICK_X:+1",
        },
        17: {
          value: "f",
          value2: "LEFT_STICK_X:-1",
        },
        18: {
          value: "g",
          value2: "LEFT_STICK_Y:+1",
        },
        19: {
          value: "t",
          value2: "LEFT_STICK_Y:-1",
        },
        20: {
          value: "l",
          value2: "RIGHT_STICK_X:+1",
        },
        21: {
          value: "j",
          value2: "RIGHT_STICK_X:-1",
        },
        22: {
          value: "k",
          value2: "RIGHT_STICK_Y:+1",
        },
        23: {
          value: "i",
          value2: "RIGHT_STICK_Y:-1",
        },
        24: {
          value: "1",
        },
        25: {
          value: "2",
        },
        26: {
          value: "3",
        },
        27: {},
        28: {},
        29: {},
      },
      1: {},
      2: {},
      3: {},
    };
    this.keyMap = {
      0: "",
      8: "backspace",
      9: "tab",
      13: "enter",
      16: "shift",
      17: "ctrl",
      18: "alt",
      19: "pause/break",
      20: "caps lock",
      27: "escape",
      32: "space",
      33: "page up",
      34: "page down",
      35: "end",
      36: "home",
      37: "left arrow",
      38: "up arrow",
      39: "right arrow",
      40: "down arrow",
      45: "insert",
      46: "delete",
      48: "0",
      49: "1",
      50: "2",
      51: "3",
      52: "4",
      53: "5",
      54: "6",
      55: "7",
      56: "8",
      57: "9",
      65: "a",
      66: "b",
      67: "c",
      68: "d",
      69: "e",
      70: "f",
      71: "g",
      72: "h",
      73: "i",
      74: "j",
      75: "k",
      76: "l",
      77: "m",
      78: "n",
      79: "o",
      80: "p",
      81: "q",
      82: "r",
      83: "s",
      84: "t",
      85: "u",
      86: "v",
      87: "w",
      88: "x",
      89: "y",
      90: "z",
      91: "left window key",
      92: "right window key",
      93: "select key",
      96: "numpad 0",
      97: "numpad 1",
      98: "numpad 2",
      99: "numpad 3",
      100: "numpad 4",
      101: "numpad 5",
      102: "numpad 6",
      103: "numpad 7",
      104: "numpad 8",
      105: "numpad 9",
      106: "multiply",
      107: "add",
      109: "subtract",
      110: "decimal point",
      111: "divide",
      112: "f1",
      113: "f2",
      114: "f3",
      115: "f4",
      116: "f5",
      117: "f6",
      118: "f7",
      119: "f8",
      120: "f9",
      121: "f10",
      122: "f11",
      123: "f12",
      144: "num lock",
      145: "scroll lock",
      186: "semi-colon",
      187: "equal sign",
      188: "comma",
      189: "dash",
      190: "period",
      191: "forward slash",
      192: "grave accent",
      219: "open bracket",
      220: "back slash",
      221: "close braket",
      222: "single quote",
    };
  }
  setupKeys() {
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 30; j++) {
        if (this.controls[i][j]) {
          this.controls[i][j].value = parseInt(
            this.keyLookup(this.controls[i][j].value)
          );
          if (this.controls[i][j].value === -1 && this.debug) {
            delete this.controls[i][j].value;
            if (this.debug)
              console.warn("Invalid key for control " + j + " player " + i);
          }
        }
      }
    }
  }
  keyLookup(controllerkey) {
    if (controllerkey === undefined) return 0;
    if (typeof controllerkey === "number") return controllerkey;
    controllerkey = controllerkey.toString().toLowerCase();
    const values = Object.values(this.keyMap);
    if (values.includes(controllerkey)) {
      const index = values.indexOf(controllerkey);
      return Object.keys(this.keyMap)[index];
    }
    return -1;
  }
  keyChange(e) {
    if (e.repeat) return;
    if (!this.started) return;
    if (
      this.controlPopup.parentElement.parentElement.getAttribute("hidden") ===
      null
    ) {
      const num = this.controlPopup.getAttribute("button-num");
      const player = this.controlPopup.getAttribute("player-num");
      if (!this.controls[player][num]) {
        this.controls[player][num] = {};
      }
      this.controls[player][num].value = e.keyCode;
      this.controlPopup.parentElement.parentElement.setAttribute("hidden", "");
      this.checkGamepadInputs();
      this.saveSettings();
      return;
    }
    if (
      this.settingsMenu.style.display !== "none" ||
      this.isPopupOpen() ||
      this.getSettingValue("keyboardInput") === "enabled"
    )
      return;
    e.preventDefault();
    const special = [16, 17, 18, 19, 20, 21, 22, 23];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 30; j++) {
        if (this.controls[i][j] && this.controls[i][j].value === e.keyCode) {
          this.gameManager.simulateInput(
            i,
            j,
            e.type === "keyup" ? 0 : special.includes(j) ? 0x7fff : 1
          );
        }
      }
    }
  }
  gamepadEvent(e) {
    if (!this.started) return;
    const gamepadIndex = this.gamepadSelection.indexOf(
      this.gamepad.gamepads[e.gamepadIndex].id +
        "_" +
        this.gamepad.gamepads[e.gamepadIndex].index
    );
    if (gamepadIndex < 0) {
      return; // Gamepad not set anywhere
    }
    const value = (function (value) {
      if (value > 0.5 || value < -0.5) {
        return value > 0 ? 1 : -1;
      } else {
        return 0;
      }
    })(e.value || 0);
    if (
      this.controlPopup.parentElement.parentElement.getAttribute("hidden") ===
      null
    ) {
      if ("buttonup" === e.type || (e.type === "axischanged" && value === 0))
        return;
      const num = this.controlPopup.getAttribute("button-num");
      const player = parseInt(this.controlPopup.getAttribute("player-num"));
      if (gamepadIndex !== player) return;
      if (!this.controls[player][num]) {
        this.controls[player][num] = {};
      }
      this.controls[player][num].value2 = e.label;
      this.controlPopup.parentElement.parentElement.setAttribute("hidden", "");
      this.checkGamepadInputs();
      this.saveSettings();
      return;
    }
    if (this.settingsMenu.style.display !== "none" || this.isPopupOpen())
      return;
    const special = [16, 17, 18, 19, 20, 21, 22, 23];
    for (let i = 0; i < 4; i++) {
      if (gamepadIndex !== i) continue;
      for (let j = 0; j < 30; j++) {
        if (!this.controls[i][j] || this.controls[i][j].value2 === undefined) {
          continue;
        }
        const controlValue = this.controls[i][j].value2;

        if (
          ["buttonup", "buttondown"].includes(e.type) &&
          (controlValue === e.label || controlValue === e.index)
        ) {
          this.gameManager.simulateInput(
            i,
            j,
            e.type === "buttonup" ? 0 : special.includes(j) ? 0x7fff : 1
          );
        } else if (e.type === "axischanged") {
          if (
            typeof controlValue === "string" &&
            controlValue.split(":")[0] === e.axis
          ) {
            if (special.includes(j)) {
              if (j === 16 || j === 17) {
                if (e.value > 0) {
                  this.gameManager.simulateInput(i, 16, 0x7fff * e.value);
                  this.gameManager.simulateInput(i, 17, 0);
                } else {
                  this.gameManager.simulateInput(i, 17, -0x7fff * e.value);
                  this.gameManager.simulateInput(i, 16, 0);
                }
              } else if (j === 18 || j === 19) {
                if (e.value > 0) {
                  this.gameManager.simulateInput(i, 18, 0x7fff * e.value);
                  this.gameManager.simulateInput(i, 19, 0);
                } else {
                  this.gameManager.simulateInput(i, 19, -0x7fff * e.value);
                  this.gameManager.simulateInput(i, 18, 0);
                }
              } else if (j === 20 || j === 21) {
                if (e.value > 0) {
                  this.gameManager.simulateInput(i, 20, 0x7fff * e.value);
                  this.gameManager.simulateInput(i, 21, 0);
                } else {
                  this.gameManager.simulateInput(i, 21, -0x7fff * e.value);
                  this.gameManager.simulateInput(i, 20, 0);
                }
              } else if (j === 22 || j === 23) {
                if (e.value > 0) {
                  this.gameManager.simulateInput(i, 22, 0x7fff * e.value);
                  this.gameManager.simulateInput(i, 23, 0);
                } else {
                  this.gameManager.simulateInput(i, 23, -0x7fff * e.value);
                  this.gameManager.simulateInput(i, 22, 0);
                }
              }
            } else if (
              value === 0 ||
              controlValue === e.label ||
              controlValue === `${e.axis}:${value}`
            ) {
              this.gameManager.simulateInput(i, j, value === 0 ? 0 : 1);
            }
          }
        }
      }
    }
  }
  setVirtualGamepad() {
    this.virtualGamepad = this.createElement("div");
    this.toggleVirtualGamepad = (show) => {
      this.virtualGamepad.style.display = show ? "" : "none";
    };
    this.virtualGamepad.classList.add("ejs_virtualGamepad_parent");
    this.elements.parent.appendChild(this.virtualGamepad);

    const speedControlButtons = [
      {
        type: "button",
        text: "Fast",
        id: "speed_fast",
        location: "center",
        left: -35,
        top: 50,
        fontSize: 15,
        block: true,
        input_value: 27,
      },
      {
        type: "button",
        text: "Slow",
        id: "speed_slow",
        location: "center",
        left: 95,
        top: 50,
        fontSize: 15,
        block: true,
        input_value: 29,
      },
    ];
    if (this.rewindEnabled) {
      speedControlButtons.push({
        type: "button",
        text: "Rewind",
        id: "speed_rewind",
        location: "center",
        left: 30,
        top: 50,
        fontSize: 15,
        block: true,
        input_value: 28,
      });
    }

    let info;
    if (
      this.config.VirtualGamepadSettings &&
      (function (set) {
        if (!Array.isArray(set)) {
          if (this.debug)
            console.warn(
              "Virtual gamepad settings is not array! Using default gamepad settings"
            );
          return false;
        }
        if (!set.length) {
          if (this.debug)
            console.warn(
              "Virtual gamepad settings is empty! Using default gamepad settings"
            );
          return false;
        }
        for (let i = 0; i < set.length; i++) {
          if (!set[i].type) continue;
          try {
            if (set[i].type === "zone" || set[i].type === "dpad") {
              if (!set[i].location) {
                console.warn(
                  "Missing location value for " +
                    set[i].type +
                    "! Using default gamepad settings"
                );
                return false;
              } else if (!set[i].inputValues) {
                console.warn(
                  "Missing inputValues for " +
                    set[i].type +
                    "! Using default gamepad settings"
                );
                return false;
              }
              continue;
            }
            if (!set[i].location) {
              console.warn(
                "Missing location value for button " +
                  set[i].text +
                  "! Using default gamepad settings"
              );
              return false;
            } else if (!set[i].type) {
              console.warn(
                "Missing type value for button " +
                  set[i].text +
                  "! Using default gamepad settings"
              );
              return false;
            } else if (!set[i].id.toString()) {
              console.warn(
                "Missing id value for button " +
                  set[i].text +
                  "! Using default gamepad settings"
              );
              return false;
            } else if (!set[i].input_value.toString()) {
              console.warn(
                "Missing input_value for button " +
                  set[i].text +
                  "! Using default gamepad settings"
              );
              return false;
            }
          } catch (e) {
            console.warn(
              "Error checking values! Using default gamepad settings"
            );
            return false;
          }
        }
        return true;
      })(this.config.VirtualGamepadSettings)
    ) {
      info = this.config.VirtualGamepadSettings;
    } else if ("gba" === this.getControlScheme()) {
      info = [
        {
          type: "button",
          text: "B",
          id: "b",
          location: "right",
          left: 10,
          top: 70,
          bold: true,
          input_value: 0,
        },
        {
          type: "button",
          text: "A",
          id: "a",
          location: "right",
          left: 81,
          top: 40,
          bold: true,
          input_value: 8,
        },
        {
          type: "dpad",
          id: "dpad",
          location: "left",
          left: "50%",
          top: "50%",
          joystickInput: false,
          inputValues: [4, 5, 6, 7],
        },
        {
          type: "button",
          text: "Start",
          id: "start",
          location: "center",
          left: 60,
          fontSize: 15,
          block: true,
          input_value: 3,
        },
        {
          type: "button",
          text: "Select",
          id: "select",
          location: "center",
          left: -5,
          fontSize: 15,
          block: true,
          input_value: 2,
        },
        {
          type: "button",
          text: "L",
          id: "l",
          location: "left",
          left: 3,
          top: -90,
          bold: true,
          block: true,
          input_value: 10,
        },
        {
          type: "button",
          text: "R",
          id: "r",
          location: "right",
          right: 3,
          top: -90,
          bold: true,
          block: true,
          input_value: 11,
        },
      ];
      info.push(...speedControlButtons);
    } else if ("gb" === this.getControlScheme()) {
      info = [
        {
          type: "button",
          text: "A",
          id: "a",
          location: "right",
          left: 81,
          top: 40,
          bold: true,
          input_value: 8,
        },
        {
          type: "button",
          text: "B",
          id: "b",
          location: "right",
          left: 10,
          top: 70,
          bold: true,
          input_value: 0,
        },
        {
          type: "dpad",
          id: "dpad",
          location: "left",
          left: "50%",
          top: "50%",
          joystickInput: false,
          inputValues: [4, 5, 6, 7],
        },
        {
          type: "button",
          text: "Start",
          id: "start",
          location: "center",
          left: 60,
          fontSize: 15,
          block: true,
          input_value: 3,
        },
        {
          type: "button",
          text: "Select",
          id: "select",
          location: "center",
          left: -5,
          fontSize: 15,
          block: true,
          input_value: 2,
        },
      ];
      info.push(...speedControlButtons);
    } else if ("nes" === this.getControlScheme()) {
      info = [
        {
          type: "button",
          text: "B",
          id: "b",
          location: "right",
          right: 75,
          top: 70,
          bold: true,
          input_value: 0,
        },
        {
          type: "button",
          text: "A",
          id: "a",
          location: "right",
          right: 5,
          top: 70,
          bold: true,
          input_value: 8,
        },
        {
          type: "dpad",
          id: "dpad",
          location: "left",
          left: "50%",
          right: "50%",
          joystickInput: false,
          inputValues: [4, 5, 6, 7],
        },
        {
          type: "button",
          text: "Start",
          id: "start",
          location: "center",
          left: 60,
          fontSize: 15,
          block: true,
          input_value: 3,
        },
        {
          type: "button",
          text: "Select",
          id: "select",
          location: "center",
          left: -5,
          fontSize: 15,
          block: true,
          input_value: 2,
        },
      ];
      info.push(...speedControlButtons);
    } else if ("n64" === this.getControlScheme()) {
      info = [
        {
          type: "button",
          text: "B",
          id: "b",
          location: "right",
          left: -10,
          top: 95,
          input_value: 1,
          bold: true,
        },
        {
          type: "button",
          text: "A",
          id: "a",
          location: "right",
          left: 40,
          top: 150,
          input_value: 0,
          bold: true,
        },
        {
          type: "zone",
          id: "stick",
          location: "left",
          left: "50%",
          top: "100%",
          joystickInput: true,
          inputValues: [16, 17, 18, 19],
        },
        {
          type: "zone",
          id: "dpad",
          location: "left",
          left: "50%",
          top: "0%",
          joystickInput: false,
          inputValues: [4, 5, 6, 7],
        },
        {
          type: "button",
          text: "Start",
          id: "start",
          location: "center",
          left: 30,
          top: -10,
          fontSize: 15,
          block: true,
          input_value: 3,
        },
        {
          type: "button",
          text: "L",
          id: "l",
          block: true,
          location: "top",
          left: 10,
          top: -40,
          bold: true,
          input_value: 10,
        },
        {
          type: "button",
          text: "R",
          id: "r",
          block: true,
          location: "top",
          right: 10,
          top: -40,
          bold: true,
          input_value: 11,
        },
        {
          type: "button",
          text: "Z",
          id: "z",
          block: true,
          location: "top",
          left: 10,
          bold: true,
          input_value: 12,
        },
        {
          fontSize: 20,
          type: "button",
          text: "CU",
          id: "cu",
          joystickInput: true,
          location: "right",
          left: 25,
          top: -65,
          input_value: 23,
        },
        {
          fontSize: 20,
          type: "button",
          text: "CD",
          id: "cd",
          joystickInput: true,
          location: "right",
          left: 25,
          top: 15,
          input_value: 22,
        },
        {
          fontSize: 20,
          type: "button",
          text: "CL",
          id: "cl",
          joystickInput: true,
          location: "right",
          left: -15,
          top: -25,
          input_value: 21,
        },
        {
          fontSize: 20,
          type: "button",
          text: "CR",
          id: "cr",
          joystickInput: true,
          location: "right",
          left: 65,
          top: -25,
          input_value: 20,
        },
      ];
      info.push(...speedControlButtons);
    } else if ("nds" === this.getControlScheme()) {
      info = [
        {
          type: "button",
          text: "X",
          id: "x",
          location: "right",
          left: 40,
          bold: true,
          input_value: 9,
        },
        {
          type: "button",
          text: "Y",
          id: "y",
          location: "right",
          top: 40,
          bold: true,
          input_value: 1,
        },
        {
          type: "button",
          text: "A",
          id: "a",
          location: "right",
          left: 81,
          top: 40,
          bold: true,
          input_value: 8,
        },
        {
          type: "button",
          text: "B",
          id: "b",
          location: "right",
          left: 40,
          top: 80,
          bold: true,
          input_value: 0,
        },
        {
          type: "dpad",
          id: "dpad",
          location: "left",
          left: "50%",
          top: "50%",
          joystickInput: false,
          inputValues: [4, 5, 6, 7],
        },
        {
          type: "button",
          text: "Start",
          id: "start",
          location: "center",
          left: 60,
          fontSize: 15,
          block: true,
          input_value: 3,
        },
        {
          type: "button",
          text: "Select",
          id: "select",
          location: "center",
          left: -5,
          fontSize: 15,
          block: true,
          input_value: 2,
        },
        {
          type: "button",
          text: "L",
          id: "l",
          location: "left",
          left: 3,
          top: -100,
          bold: true,
          block: true,
          input_value: 10,
        },
        {
          type: "button",
          text: "R",
          id: "r",
          location: "right",
          right: 3,
          top: -100,
          bold: true,
          block: true,
          input_value: 11,
        },
      ];
      info.push(...speedControlButtons);
    } else if ("snes" === this.getControlScheme()) {
      info = [
        {
          type: "button",
          text: "X",
          id: "x",
          location: "right",
          left: 40,
          bold: true,
          input_value: 9,
        },
        {
          type: "button",
          text: "Y",
          id: "y",
          location: "right",
          top: 40,
          bold: true,
          input_value: 1,
        },
        {
          type: "button",
          text: "A",
          id: "a",
          location: "right",
          left: 81,
          top: 40,
          bold: true,
          input_value: 8,
        },
        {
          type: "button",
          text: "B",
          id: "b",
          location: "right",
          left: 40,
          top: 80,
          bold: true,
          input_value: 0,
        },
        {
          type: "dpad",
          id: "dpad",
          location: "left",
          left: "50%",
          top: "50%",
          joystickInput: false,
          inputValues: [4, 5, 6, 7],
        },
        {
          type: "button",
          text: "Start",
          id: "start",
          location: "center",
          left: 60,
          fontSize: 15,
          block: true,
          input_value: 3,
        },
        {
          type: "button",
          text: "Select",
          id: "select",
          location: "center",
          left: -5,
          fontSize: 15,
          block: true,
          input_value: 2,
        },
        {
          type: "button",
          text: "L",
          id: "l",
          location: "left",
          left: 3,
          top: -100,
          bold: true,
          block: true,
          input_value: 10,
        },
        {
          type: "button",
          text: "R",
          id: "r",
          location: "right",
          right: 3,
          top: -100,
          bold: true,
          block: true,
          input_value: 11,
        },
      ];
      info.push(...speedControlButtons);
    } else if (
      ["segaMD", "segaCD", "sega32x"].includes(this.getControlScheme())
    ) {
      info = [
        {
          type: "button",
          text: "A",
          id: "a",
          location: "right",
          right: 145,
          top: 70,
          bold: true,
          input_value: 1,
        },
        {
          type: "button",
          text: "B",
          id: "b",
          location: "right",
          right: 75,
          top: 70,
          bold: true,
          input_value: 0,
        },
        {
          type: "button",
          text: "C",
          id: "c",
          location: "right",
          right: 5,
          top: 70,
          bold: true,
          input_value: 8,
        },
        {
          type: "button",
          text: "X",
          id: "x",
          location: "right",
          right: 145,
          top: 0,
          bold: true,
          input_value: 10,
        },
        {
          type: "button",
          text: "Y",
          id: "y",
          location: "right",
          right: 75,
          top: 0,
          bold: true,
          input_value: 9,
        },
        {
          type: "button",
          text: "Z",
          id: "z",
          location: "right",
          right: 5,
          top: 0,
          bold: true,
          input_value: 11,
        },
        {
          type: "dpad",
          id: "dpad",
          location: "left",
          left: "50%",
          right: "50%",
          joystickInput: false,
          inputValues: [4, 5, 6, 7],
        },
        {
          type: "button",
          text: "Mode",
          id: "mode",
          location: "center",
          left: -5,
          fontSize: 15,
          block: true,
          input_value: 2,
        },
        {
          type: "button",
          text: "Start",
          id: "start",
          location: "center",
          left: 60,
          fontSize: 15,
          block: true,
          input_value: 3,
        },
      ];
      info.push(...speedControlButtons);
    } else if ("segaMS" === this.getControlScheme()) {
      info = [
        {
          type: "button",
          text: "1",
          id: "button_1",
          location: "right",
          left: 10,
          top: 40,
          bold: true,
          input_value: 0,
        },
        {
          type: "button",
          text: "2",
          id: "button_2",
          location: "right",
          left: 81,
          top: 40,
          bold: true,
          input_value: 8,
        },
        {
          type: "dpad",
          id: "dpad",
          location: "left",
          left: "50%",
          right: "50%",
          joystickInput: false,
          inputValues: [4, 5, 6, 7],
        },
      ];
      info.push(...speedControlButtons);
    } else if ("segaGG" === this.getControlScheme()) {
      info = [
        {
          type: "button",
          text: "1",
          id: "button_1",
          location: "right",
          left: 10,
          top: 70,
          bold: true,
          input_value: 0,
        },
        {
          type: "button",
          text: "2",
          id: "button_2",
          location: "right",
          left: 81,
          top: 40,
          bold: true,
          input_value: 8,
        },
        {
          type: "dpad",
          id: "dpad",
          location: "left",
          left: "50%",
          top: "50%",
          joystickInput: false,
          inputValues: [4, 5, 6, 7],
        },
        {
          type: "button",
          text: "Start",
          id: "start",
          location: "center",
          left: 30,
          fontSize: 15,
          block: true,
          input_value: 3,
        },
      ];
      info.push(...speedControlButtons);
    } else if ("segaSaturn" === this.getControlScheme()) {
      info = [
        {
          type: "button",
          text: "A",
          id: "a",
          location: "right",
          right: 145,
          top: 70,
          bold: true,
          input_value: 1,
        },
        {
          type: "button",
          text: "B",
          id: "b",
          location: "right",
          right: 75,
          top: 70,
          bold: true,
          input_value: 0,
        },
        {
          type: "button",
          text: "C",
          id: "c",
          location: "right",
          right: 5,
          top: 70,
          bold: true,
          input_value: 8,
        },
        {
          type: "button",
          text: "X",
          id: "x",
          location: "right",
          right: 145,
          top: 0,
          bold: true,
          input_value: 9,
        },
        {
          type: "button",
          text: "Y",
          id: "y",
          location: "right",
          right: 75,
          top: 0,
          bold: true,
          input_value: 10,
        },
        {
          type: "button",
          text: "Z",
          id: "z",
          location: "right",
          right: 5,
          top: 0,
          bold: true,
          input_value: 11,
        },
        {
          type: "dpad",
          id: "dpad",
          location: "left",
          left: "50%",
          right: "50%",
          joystickInput: false,
          inputValues: [4, 5, 6, 7],
        },
        {
          type: "button",
          text: "L",
          id: "l",
          location: "left",
          left: 3,
          top: -90,
          bold: true,
          block: true,
          input_value: 12,
        },
        {
          type: "button",
          text: "R",
          id: "r",
          location: "right",
          right: 3,
          top: -90,
          bold: true,
          block: true,
          input_value: 13,
        },
        {
          type: "button",
          text: "Start",
          id: "start",
          location: "center",
          left: 30,
          fontSize: 15,
          block: true,
          input_value: 3,
        },
      ];
      info.push(...speedControlButtons);
    } else if ("atari2600" === this.getControlScheme()) {
      info = [
        {
          type: "button",
          text: "",
          id: "button_1",
          location: "right",
          right: 10,
          top: 70,
          bold: true,
          input_value: 0,
        },
        {
          type: "dpad",
          id: "dpad",
          location: "left",
          left: "50%",
          right: "50%",
          joystickInput: false,
          inputValues: [4, 5, 6, 7],
        },
        {
          type: "button",
          text: "Reset",
          id: "reset",
          location: "center",
          left: 60,
          fontSize: 15,
          block: true,
          input_value: 3,
        },
        {
          type: "button",
          text: "Select",
          id: "select",
          location: "center",
          left: -5,
          fontSize: 15,
          block: true,
          input_value: 2,
        },
      ];
      info.push(...speedControlButtons);
    } else if ("atari7800" === this.getControlScheme()) {
      info = [
        {
          type: "button",
          text: "1",
          id: "button_1",
          location: "right",
          right: 75,
          top: 70,
          bold: true,
          input_value: 0,
        },
        {
          type: "button",
          text: "2",
          id: "button_2",
          location: "right",
          right: 5,
          top: 70,
          bold: true,
          input_value: 8,
        },
        {
          type: "dpad",
          id: "dpad",
          location: "left",
          left: "50%",
          right: "50%",
          joystickInput: false,
          inputValues: [4, 5, 6, 7],
        },
        {
          type: "button",
          text: "Reset",
          id: "reset",
          location: "center",
          left: -35,
          fontSize: 15,
          block: true,
          input_value: 9,
        },
        {
          type: "button",
          text: "Pause",
          id: "pause",
          location: "center",
          left: 95,
          fontSize: 15,
          block: true,
          input_value: 3,
        },
        {
          type: "button",
          text: "Select",
          id: "select",
          location: "center",
          left: 30,
          fontSize: 15,
          block: true,
          input_value: 2,
        },
      ];
      info.push(...speedControlButtons);
    } else if ("lynx" === this.getControlScheme()) {
      info = [
        {
          type: "button",
          text: "B",
          id: "button_1",
          location: "right",
          right: 75,
          top: 70,
          bold: true,
          input_value: 0,
        },
        {
          type: "button",
          text: "A",
          id: "button_2",
          location: "right",
          right: 5,
          top: 70,
          bold: true,
          input_value: 8,
        },
        {
          type: "dpad",
          id: "dpad",
          location: "left",
          left: "50%",
          right: "50%",
          joystickInput: false,
          inputValues: [4, 5, 6, 7],
        },
        {
          type: "button",
          text: "Opt 1",
          id: "option_1",
          location: "center",
          left: -35,
          fontSize: 15,
          block: true,
          input_value: 10,
        },
        {
          type: "button",
          text: "Opt 2",
          id: "option_2",
          location: "center",
          left: 95,
          fontSize: 15,
          block: true,
          input_value: 11,
        },
        {
          type: "button",
          text: "Start",
          id: "start",
          location: "center",
          left: 30,
          fontSize: 15,
          block: true,
          input_value: 3,
        },
      ];
      info.push(...speedControlButtons);
    } else if ("jaguar" === this.getControlScheme()) {
      info = [
        {
          type: "button",
          text: "A",
          id: "a",
          location: "right",
          right: 145,
          top: 70,
          bold: true,
          input_value: 8,
        },
        {
          type: "button",
          text: "B",
          id: "b",
          location: "right",
          right: 75,
          top: 70,
          bold: true,
          input_value: 0,
        },
        {
          type: "button",
          text: "C",
          id: "c",
          location: "right",
          right: 5,
          top: 70,
          bold: true,
          input_value: 1,
        },
        {
          type: "dpad",
          id: "dpad",
          location: "left",
          left: "50%",
          right: "50%",
          joystickInput: false,
          inputValues: [4, 5, 6, 7],
        },
        {
          type: "button",
          text: "Option",
          id: "option",
          location: "center",
          left: 60,
          fontSize: 15,
          block: true,
          input_value: 3,
        },
        {
          type: "button",
          text: "Pause",
          id: "pause",
          location: "center",
          left: -5,
          fontSize: 15,
          block: true,
          input_value: 2,
        },
      ];
      info.push(...speedControlButtons);
    } else if ("vb" === this.getControlScheme()) {
      info = [
        {
          type: "button",
          text: "B",
          id: "b",
          location: "right",
          right: 75,
          top: 150,
          bold: true,
          input_value: 0,
        },
        {
          type: "button",
          text: "A",
          id: "a",
          location: "right",
          right: 5,
          top: 150,
          bold: true,
          input_value: 8,
        },
        {
          type: "dpad",
          id: "left_dpad",
          location: "left",
          left: "50%",
          right: "50%",
          joystickInput: false,
          inputValues: [4, 5, 6, 7],
        },
        {
          type: "dpad",
          id: "right_dpad",
          location: "right",
          left: "50%",
          right: "50%",
          joystickInput: false,
          inputValues: [19, 18, 17, 16],
        },
        {
          type: "button",
          text: "L",
          id: "l",
          location: "left",
          left: 3,
          top: -90,
          bold: true,
          block: true,
          input_value: 10,
        },
        {
          type: "button",
          text: "R",
          id: "r",
          location: "right",
          right: 3,
          top: -90,
          bold: true,
          block: true,
          input_value: 11,
        },
        {
          type: "button",
          text: "Start",
          id: "start",
          location: "center",
          left: 60,
          fontSize: 15,
          block: true,
          input_value: 3,
        },
        {
          type: "button",
          text: "Select",
          id: "select",
          location: "center",
          left: -5,
          fontSize: 15,
          block: true,
          input_value: 2,
        },
      ];
      info.push(...speedControlButtons);
    } else if ("3do" === this.getControlScheme()) {
      info = [
        {
          type: "button",
          text: "A",
          id: "a",
          location: "right",
          right: 145,
          top: 70,
          bold: true,
          input_value: 1,
        },
        {
          type: "button",
          text: "B",
          id: "b",
          location: "right",
          right: 75,
          top: 70,
          bold: true,
          input_value: 0,
        },
        {
          type: "button",
          text: "C",
          id: "c",
          location: "right",
          right: 5,
          top: 70,
          bold: true,
          input_value: 8,
        },
        {
          type: "dpad",
          id: "dpad",
          location: "left",
          left: "50%",
          right: "50%",
          joystickInput: false,
          inputValues: [4, 5, 6, 7],
        },
        {
          type: "button",
          text: "L",
          id: "l",
          location: "left",
          left: 3,
          top: -90,
          bold: true,
          block: true,
          input_value: 10,
        },
        {
          type: "button",
          text: "R",
          id: "r",
          location: "right",
          right: 3,
          top: -90,
          bold: true,
          block: true,
          input_value: 11,
        },
        {
          type: "button",
          text: "X",
          id: "x",
          location: "center",
          left: -5,
          fontSize: 15,
          block: true,
          bold: true,
          input_value: 2,
        },
        {
          type: "button",
          text: "P",
          id: "p",
          location: "center",
          left: 60,
          fontSize: 15,
          block: true,
          bold: true,
          input_value: 3,
        },
      ];
      info.push(...speedControlButtons);
    } else if ("pce" === this.getControlScheme()) {
      info = [
        {
          type: "button",
          text: "II",
          id: "ii",
          location: "right",
          right: 75,
          top: 70,
          bold: true,
          input_value: 0,
        },
        {
          type: "button",
          text: "I",
          id: "i",
          location: "right",
          right: 5,
          top: 70,
          bold: true,
          input_value: 8,
        },
        {
          type: "dpad",
          id: "dpad",
          location: "left",
          left: "50%",
          right: "50%",
          joystickInput: false,
          inputValues: [4, 5, 6, 7],
        },
        {
          type: "button",
          text: "Run",
          id: "run",
          location: "center",
          left: 60,
          fontSize: 15,
          block: true,
          input_value: 3,
        },
        {
          type: "button",
          text: "Select",
          id: "select",
          location: "center",
          left: -5,
          fontSize: 15,
          block: true,
          input_value: 2,
        },
      ];
      info.push(...speedControlButtons);
    } else if ("ngp" === this.getControlScheme()) {
      info = [
        {
          type: "button",
          text: "A",
          id: "a",
          location: "right",
          right: 75,
          top: 70,
          bold: true,
          input_value: 0,
        },
        {
          type: "button",
          text: "B",
          id: "b",
          location: "right",
          right: 5,
          top: 50,
          bold: true,
          input_value: 8,
        },
        {
          type: "dpad",
          id: "dpad",
          location: "left",
          left: "50%",
          right: "50%",
          joystickInput: false,
          inputValues: [4, 5, 6, 7],
        },
        {
          type: "button",
          text: "Option",
          id: "option",
          location: "center",
          left: 30,
          fontSize: 15,
          block: true,
          input_value: 3,
        },
      ];
      info.push(...speedControlButtons);
    } else if ("ws" === this.getControlScheme()) {
      info = [
        {
          type: "button",
          text: "B",
          id: "b",
          location: "right",
          right: 75,
          top: 150,
          bold: true,
          input_value: 0,
        },
        {
          type: "button",
          text: "A",
          id: "a",
          location: "right",
          right: 5,
          top: 150,
          bold: true,
          input_value: 8,
        },
        {
          type: "dpad",
          id: "x_dpad",
          location: "left",
          left: "50%",
          right: "50%",
          joystickInput: false,
          inputValues: [4, 5, 6, 7],
        },
        {
          type: "dpad",
          id: "y_dpad",
          location: "right",
          left: "50%",
          right: "50%",
          joystickInput: false,
          inputValues: [13, 12, 10, 11],
        },
        {
          type: "button",
          text: "Start",
          id: "start",
          location: "center",
          left: 30,
          fontSize: 15,
          block: true,
          input_value: 3,
        },
      ];
      info.push(...speedControlButtons);
    } else if ("coleco" === this.getControlScheme()) {
      info = [
        {
          type: "button",
          text: "L",
          id: "l",
          location: "right",
          left: 10,
          top: 40,
          bold: true,
          input_value: 8,
        },
        {
          type: "button",
          text: "R",
          id: "r",
          location: "right",
          left: 81,
          top: 40,
          bold: true,
          input_value: 0,
        },
        {
          type: "dpad",
          id: "dpad",
          location: "left",
          left: "50%",
          right: "50%",
          joystickInput: false,
          inputValues: [4, 5, 6, 7],
        },
      ];
      info.push(...speedControlButtons);
    } else if ("pcfx" === this.getControlScheme()) {
      info = [
        {
          type: "button",
          text: "I",
          id: "i",
          location: "right",
          right: 5,
          top: 70,
          bold: true,
          input_value: 8,
        },
        {
          type: "button",
          text: "II",
          id: "ii",
          location: "right",
          right: 75,
          top: 70,
          bold: true,
          input_value: 0,
        },
        {
          type: "button",
          text: "III",
          id: "iii",
          location: "right",
          right: 145,
          top: 70,
          bold: true,
          input_value: 9,
        },
        {
          type: "button",
          text: "IV",
          id: "iv",
          location: "right",
          right: 5,
          top: 0,
          bold: true,
          input_value: 1,
        },
        {
          type: "button",
          text: "V",
          id: "v",
          location: "right",
          right: 75,
          top: 0,
          bold: true,
          input_value: 10,
        },
        {
          type: "button",
          text: "VI",
          id: "vi",
          location: "right",
          right: 145,
          top: 0,
          bold: true,
          input_value: 11,
        },
        {
          type: "dpad",
          id: "dpad",
          location: "left",
          left: "50%",
          right: "50%",
          joystickInput: false,
          inputValues: [4, 5, 6, 7],
        },
        {
          type: "button",
          text: "Select",
          id: "select",
          location: "center",
          left: -5,
          fontSize: 15,
          block: true,
          input_value: 2,
        },
        {
          type: "button",
          text: "Run",
          id: "run",
          location: "center",
          left: 60,
          fontSize: 15,
          block: true,
          input_value: 3,
        },
      ];
      info.push(...speedControlButtons);
    } else {
      info = [
        {
          type: "button",
          text: "Y",
          id: "y",
          location: "right",
          left: 40,
          bold: true,
          input_value: 9,
        },
        {
          type: "button",
          text: "X",
          id: "x",
          location: "right",
          top: 40,
          bold: true,
          input_value: 1,
        },
        {
          type: "button",
          text: "B",
          id: "b",
          location: "right",
          left: 81,
          top: 40,
          bold: true,
          input_value: 8,
        },
        {
          type: "button",
          text: "A",
          id: "a",
          location: "right",
          left: 40,
          top: 80,
          bold: true,
          input_value: 0,
        },
        {
          type: "zone",
          id: "dpad",
          location: "left",
          left: "50%",
          top: "50%",
          joystickInput: false,
          inputValues: [4, 5, 6, 7],
        },
        {
          type: "button",
          text: "Start",
          id: "start",
          location: "center",
          left: 60,
          fontSize: 15,
          block: true,
          input_value: 3,
        },
        {
          type: "button",
          text: "Select",
          id: "select",
          location: "center",
          left: -5,
          fontSize: 15,
          block: true,
          input_value: 2,
        },
      ];
      info.push(...speedControlButtons);
    }
    for (let i = 0; i < info.length; i++) {
      if (info[i].text) {
        info[i].text = this.localization(info[i].text);
      }
    }
    info = JSON.parse(JSON.stringify(info));

    const up = this.createElement("div");
    up.classList.add("ejs_virtualGamepad_top");
    const down = this.createElement("div");
    down.classList.add("ejs_virtualGamepad_bottom");
    const left = this.createElement("div");
    left.classList.add("ejs_virtualGamepad_left");
    const right = this.createElement("div");
    right.classList.add("ejs_virtualGamepad_right");
    const elems = { top: up, center: down, left, right };

    this.virtualGamepad.appendChild(up);
    this.virtualGamepad.appendChild(down);
    this.virtualGamepad.appendChild(left);
    this.virtualGamepad.appendChild(right);

    this.toggleVirtualGamepadLeftHanded = (enabled) => {
      left.classList.toggle("ejs_virtualGamepad_left", !enabled);
      right.classList.toggle("ejs_virtualGamepad_right", !enabled);
      left.classList.toggle("ejs_virtualGamepad_right", enabled);
      right.classList.toggle("ejs_virtualGamepad_left", enabled);
    };

    const leftHandedMode = false;
    const blockCSS =
      "height:31px;text-align:center;border:1px solid #ccc;border-radius:5px;line-height:31px;";
    const controlSchemeCls = `cs_${this.getControlScheme()}`
      .split(/\s/g)
      .join("_");

    for (let i = 0; i < info.length; i++) {
      if (info[i].type !== "button") continue;
      if (leftHandedMode && ["left", "right"].includes(info[i].location)) {
        info[i].location = info[i].location === "left" ? "right" : "left";
        const amnt = JSON.parse(JSON.stringify(info[i]));
        if (amnt.left) {
          info[i].right = amnt.left;
        }
        if (amnt.right) {
          info[i].left = amnt.right;
        }
      }
      let style = "";
      if (info[i].left) {
        style +=
          "left:" +
          info[i].left +
          (typeof info[i].left === "number" ? "px" : "") +
          ";";
      }
      if (info[i].right) {
        style +=
          "right:" +
          info[i].right +
          (typeof info[i].right === "number" ? "px" : "") +
          ";";
      }
      if (info[i].top) {
        style +=
          "top:" +
          info[i].top +
          (typeof info[i].top === "number" ? "px" : "") +
          ";";
      }
      if (!info[i].bold) {
        style += "font-weight:normal;";
      } else if (info[i].bold) {
        style += "font-weight:bold;";
      }
      info[i].fontSize = info[i].fontSize || 30;
      style += "font-size:" + info[i].fontSize + "px;";
      if (info[i].block) {
        style += blockCSS;
      }
      if (["top", "center", "left", "right"].includes(info[i].location)) {
        const button = this.createElement("div");
        button.style = style;
        button.innerText = info[i].text;
        button.classList.add("ejs_virtualGamepad_button", controlSchemeCls);
        if (info[i].id) {
          button.classList.add(`b_${info[i].id}`);
        }
        elems[info[i].location].appendChild(button);
        const value = info[i].input_new_cores || info[i].input_value;
        let downValue = info[i].joystickInput === true ? 0x7fff : 1;
        this.addEventListener(
          button,
          "touchstart touchend touchcancel",
          (e) => {
            e.preventDefault();
            if (e.type === "touchend" || e.type === "touchcancel") {
              e.target.classList.remove("ejs_virtualGamepad_button_down");
              window.setTimeout(() => {
                this.gameManager.simulateInput(0, value, 0);
              });
            } else {
              e.target.classList.add("ejs_virtualGamepad_button_down");
              this.gameManager.simulateInput(0, value, downValue);
            }
          }
        );
      }
    }

    const createDPad = (opts) => {
      const container = opts.container;
      const callback = opts.event;
      const dpadMain = this.createElement("div");
      dpadMain.classList.add("ejs_dpad_main");
      const vertical = this.createElement("div");
      vertical.classList.add("ejs_dpad_vertical");
      const horizontal = this.createElement("div");
      horizontal.classList.add("ejs_dpad_horizontal");
      const bar1 = this.createElement("div");
      bar1.classList.add("ejs_dpad_bar");
      const bar2 = this.createElement("div");
      bar2.classList.add("ejs_dpad_bar");

      horizontal.appendChild(bar1);
      vertical.appendChild(bar2);
      dpadMain.appendChild(vertical);
      dpadMain.appendChild(horizontal);

      const updateCb = (e) => {
        e.preventDefault();
        const touch = e.targetTouches[0];
        if (!touch) return;
        const rect = dpadMain.getBoundingClientRect();
        const x = touch.clientX - rect.left - dpadMain.clientWidth / 2;
        const y = touch.clientY - rect.top - dpadMain.clientHeight / 2;
        let up = 0,
          down = 0,
          left = 0,
          right = 0,
          angle = Math.atan(x / y) / (Math.PI / 180);

        if (y <= -10) {
          up = 1;
        }
        if (y >= 10) {
          down = 1;
        }

        if (x >= 10) {
          right = 1;
          left = 0;
          if ((angle < 0 && angle >= -35) || (angle > 0 && angle <= 35)) {
            right = 0;
          }
          up = angle < 0 && angle >= -55 ? 1 : 0;
          down = angle > 0 && angle <= 55 ? 1 : 0;
        }

        if (x <= -10) {
          right = 0;
          left = 1;
          if ((angle < 0 && angle >= -35) || (angle > 0 && angle <= 35)) {
            left = 0;
          }
          up = angle > 0 && angle <= 55 ? 1 : 0;
          down = angle < 0 && angle >= -55 ? 1 : 0;
        }

        dpadMain.classList.toggle("ejs_dpad_up_pressed", up);
        dpadMain.classList.toggle("ejs_dpad_down_pressed", down);
        dpadMain.classList.toggle("ejs_dpad_right_pressed", right);
        dpadMain.classList.toggle("ejs_dpad_left_pressed", left);

        callback(up, down, left, right);
      };
      const cancelCb = (e) => {
        e.preventDefault();
        dpadMain.classList.remove("ejs_dpad_up_pressed");
        dpadMain.classList.remove("ejs_dpad_down_pressed");
        dpadMain.classList.remove("ejs_dpad_right_pressed");
        dpadMain.classList.remove("ejs_dpad_left_pressed");

        callback(0, 0, 0, 0);
      };

      this.addEventListener(dpadMain, "touchstart touchmove", updateCb);
      this.addEventListener(dpadMain, "touchend touchcancel", cancelCb);

      container.appendChild(dpadMain);
    };

    info.forEach((dpad, index) => {
      if (dpad.type !== "dpad") return;
      if (leftHandedMode && ["left", "right"].includes(dpad.location)) {
        dpad.location = dpad.location === "left" ? "right" : "left";
        const amnt = JSON.parse(JSON.stringify(dpad));
        if (amnt.left) {
          dpad.right = amnt.left;
        }
        if (amnt.right) {
          dpad.left = amnt.right;
        }
      }
      const elem = this.createElement("div");
      let style = "";
      if (dpad.left) {
        style += "left:" + dpad.left + ";";
      }
      if (dpad.right) {
        style += "right:" + dpad.right + ";";
      }
      if (dpad.top) {
        style += "top:" + dpad.top + ";";
      }
      elem.classList.add(controlSchemeCls);
      if (dpad.id) {
        elem.classList.add(`b_${dpad.id}`);
      }
      elem.style = style;
      elems[dpad.location].appendChild(elem);
      createDPad({
        container: elem,
        event: (up, down, left, right) => {
          if (dpad.joystickInput) {
            if (up === 1) up = 0x7fff;
            if (down === 1) down = 0x7fff;
            if (left === 1) left = 0x7fff;
            if (right === 1) right = 0x7fff;
          }
          this.gameManager.simulateInput(0, dpad.inputValues[0], up);
          this.gameManager.simulateInput(0, dpad.inputValues[1], down);
          this.gameManager.simulateInput(0, dpad.inputValues[2], left);
          this.gameManager.simulateInput(0, dpad.inputValues[3], right);
        },
      });
    });

    info.forEach((zone, index) => {
      if (zone.type !== "zone") return;
      if (leftHandedMode && ["left", "right"].includes(zone.location)) {
        zone.location = zone.location === "left" ? "right" : "left";
        const amnt = JSON.parse(JSON.stringify(zone));
        if (amnt.left) {
          zone.right = amnt.left;
        }
        if (amnt.right) {
          zone.left = amnt.right;
        }
      }
      const elem = this.createElement("div");
      this.addEventListener(
        elem,
        "touchstart touchmove touchend touchcancel",
        (e) => {
          e.preventDefault();
        }
      );
      elem.classList.add(controlSchemeCls);
      if (zone.id) {
        elem.classList.add(`b_${zone.id}`);
      }
      elems[zone.location].appendChild(elem);
      const zoneObj = nipplejs.create({
        zone: elem,
        mode: "static",
        position: {
          left: zone.left,
          top: zone.top,
        },
        color: zone.color || "red",
      });
      zoneObj.on("end", () => {
        this.gameManager.simulateInput(0, zone.inputValues[0], 0);
        this.gameManager.simulateInput(0, zone.inputValues[1], 0);
        this.gameManager.simulateInput(0, zone.inputValues[2], 0);
        this.gameManager.simulateInput(0, zone.inputValues[3], 0);
      });
      zoneObj.on("move", (e, info) => {
        const degree = info.angle.degree;
        const distance = info.distance;
        if (zone.joystickInput === true) {
          let x = 0,
            y = 0;
          if (degree > 0 && degree <= 45) {
            x = distance / 50;
            y = (-0.022222222222222223 * degree * distance) / 50;
          }
          if (degree > 45 && degree <= 90) {
            x = (0.022222222222222223 * (90 - degree) * distance) / 50;
            y = -distance / 50;
          }
          if (degree > 90 && degree <= 135) {
            x = (0.022222222222222223 * (90 - degree) * distance) / 50;
            y = -distance / 50;
          }
          if (degree > 135 && degree <= 180) {
            x = -distance / 50;
            y = (-0.022222222222222223 * (180 - degree) * distance) / 50;
          }
          if (degree > 135 && degree <= 225) {
            x = -distance / 50;
            y = (-0.022222222222222223 * (180 - degree) * distance) / 50;
          }
          if (degree > 225 && degree <= 270) {
            x = (-0.022222222222222223 * (270 - degree) * distance) / 50;
            y = distance / 50;
          }
          if (degree > 270 && degree <= 315) {
            x = (-0.022222222222222223 * (270 - degree) * distance) / 50;
            y = distance / 50;
          }
          if (degree > 315 && degree <= 359.9) {
            x = distance / 50;
            y = (0.022222222222222223 * (360 - degree) * distance) / 50;
          }
          if (x > 0) {
            this.gameManager.simulateInput(0, zone.inputValues[0], 0x7fff * x);
            this.gameManager.simulateInput(0, zone.inputValues[1], 0);
          } else {
            this.gameManager.simulateInput(0, zone.inputValues[1], 0x7fff * -x);
            this.gameManager.simulateInput(0, zone.inputValues[0], 0);
          }
          if (y > 0) {
            this.gameManager.simulateInput(0, zone.inputValues[2], 0x7fff * y);
            this.gameManager.simulateInput(0, zone.inputValues[3], 0);
          } else {
            this.gameManager.simulateInput(0, zone.inputValues[3], 0x7fff * -y);
            this.gameManager.simulateInput(0, zone.inputValues[2], 0);
          }
        } else {
          if (degree >= 30 && degree < 150) {
            this.gameManager.simulateInput(0, zone.inputValues[0], 1);
          } else {
            window.setTimeout(() => {
              this.gameManager.simulateInput(0, zone.inputValues[0], 0);
            }, 30);
          }
          if (degree >= 210 && degree < 330) {
            this.gameManager.simulateInput(0, zone.inputValues[1], 1);
          } else {
            window.setTimeout(() => {
              this.gameManager.simulateInput(0, zone.inputValues[1], 0);
            }, 30);
          }
          if (degree >= 120 && degree < 240) {
            this.gameManager.simulateInput(0, zone.inputValues[2], 1);
          } else {
            window.setTimeout(() => {
              this.gameManager.simulateInput(0, zone.inputValues[2], 0);
            }, 30);
          }
          if (degree >= 300 || (degree >= 0 && degree < 60)) {
            this.gameManager.simulateInput(0, zone.inputValues[3], 1);
          } else {
            window.setTimeout(() => {
              this.gameManager.simulateInput(0, zone.inputValues[3], 0);
            }, 30);
          }
        }
      });
    });

    if (this.touch || this.hasTouchScreen) {
      const menuButton = this.createElement("div");
      menuButton.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path d="M0 96C0 78.33 14.33 64 32 64H416C433.7 64 448 78.33 448 96C448 113.7 433.7 128 416 128H32C14.33 128 0 113.7 0 96zM0 256C0 238.3 14.33 224 32 224H416C433.7 224 448 238.3 448 256C448 273.7 433.7 288 416 288H32C14.33 288 0 273.7 0 256zM416 448H32C14.33 448 0 433.7 0 416C0 398.3 14.33 384 32 384H416C433.7 384 448 398.3 448 416C448 433.7 433.7 448 416 448z"/></svg>';
      menuButton.classList.add("ejs_virtualGamepad_open");
      menuButton.style.display = "none";
      this.on("start", () => {
        menuButton.style.display = "";
        if (
          matchMedia("(pointer:fine)").matches &&
          this.getSettingValue("menu-bar-button") !== "visible"
        ) {
          menuButton.style.opacity = 0;
          this.changeSettingOption("menu-bar-button", "hidden", true);
        }
      });
      this.elements.parent.appendChild(menuButton);
      let timeout;
      let ready = true;
      this.addEventListener(
        menuButton,
        "touchstart touchend mousedown mouseup click",
        (e) => {
          if (!ready) return;
          clearTimeout(timeout);
          timeout = setTimeout(() => {
            ready = true;
          }, 2000);
          ready = false;
          e.preventDefault();
          this.menu.toggle();
        }
      );
      this.elements.menuToggle = menuButton;
    }

    this.virtualGamepad.style.display = "none";
  }
  handleResize() {
    if (this.virtualGamepad) {
      if (this.virtualGamepad.style.display === "none") {
        this.virtualGamepad.style.opacity = 0;
        this.virtualGamepad.style.display = "";
        setTimeout(() => {
          this.virtualGamepad.style.display = "none";
          this.virtualGamepad.style.opacity = "";
        }, 250);
      }
    }
    const positionInfo = this.elements.parent.getBoundingClientRect();
    this.game.parentElement.classList.toggle(
      "ejs_small_screen",
      positionInfo.width <= 575
    );
    //This wouldnt work using :not()... strange.
    this.game.parentElement.classList.toggle(
      "ejs_big_screen",
      positionInfo.width > 575
    );

    if (!this.handleSettingsResize) return;
    this.handleSettingsResize();
  }
  getElementSize(element) {
    let elem = element.cloneNode(true);
    elem.style.position = "absolute";
    elem.style.opacity = 0;
    elem.removeAttribute("hidden");
    element.parentNode.appendChild(elem);
    const res = elem.getBoundingClientRect();
    elem.remove();
    return {
      width: res.width,
      height: res.height,
    };
  }
  saveSettings() {
    if (
      !window.localStorage ||
      this.config.disableLocalStorage ||
      !this.settingsLoaded
    )
      return;
    if (!this.started && !this.failedToStart) return;
    const coreSpecific = {
      controlSettings: this.controls,
      settings: this.settings,
      cheats: this.cheats,
    };
    const ejs_settings = {
      volume: this.volume,
      muted: this.muted,
    };
    localStorage.setItem("ejs-settings", JSON.stringify(ejs_settings));
    localStorage.setItem(
      this.getLocalStorageKey(),
      JSON.stringify(coreSpecific)
    );
  }
  getLocalStorageKey() {
    let identifier = (this.config.gameId || 1) + "-" + this.getCore(true);
    if (typeof this.config.gameName === "string") {
      identifier += "-" + this.config.gameName;
    } else if (
      typeof this.config.gameUrl === "string" &&
      !this.config.gameUrl.toLowerCase().startsWith("blob:")
    ) {
      identifier += "-" + this.config.gameUrl;
    } else if (this.config.gameUrl instanceof File) {
      identifier += "-" + this.config.gameUrl.name;
    } else if (typeof this.config.gameId !== "number") {
      console.warn(
        "gameId (EJS_gameID) is not set. This may result in settings persisting across games."
      );
    }
    return "ejs-" + identifier + "-settings";
  }
  preGetSetting(setting) {
    if (window.localStorage && !this.config.disableLocalStorage) {
      let coreSpecific = localStorage.getItem(this.getLocalStorageKey());
      try {
        coreSpecific = JSON.parse(coreSpecific);
        if (coreSpecific && coreSpecific.settings) {
          return coreSpecific.settings[setting];
        }
      } catch (e) {
        console.warn("Could not load previous settings", e);
      }
    }
    if (this.config.defaultOptions && this.config.defaultOptions[setting]) {
      return this.config.defaultOptions[setting];
    }
    return null;
  }
  getCoreSettings() {
    if (!window.localStorage || this.config.disableLocalStorage) {
      if (this.config.defaultOptions) {
        let rv = "";
        for (const k in this.config.defaultOptions) {
          let value = isNaN(this.config.defaultOptions[k])
            ? `"${this.config.defaultOptions[k]}"`
            : this.config.defaultOptions[k];
          rv += `${k} = ${value}\n`;
        }
        return rv;
      }
      return "";
    }
    let coreSpecific = localStorage.getItem(this.getLocalStorageKey());
    if (coreSpecific) {
      try {
        coreSpecific = JSON.parse(coreSpecific);
        if (!(coreSpecific.settings instanceof Object))
          throw new Error("Not a JSON object");
        let rv = "";
        for (const k in coreSpecific.settings) {
          let value = isNaN(coreSpecific.settings[k])
            ? `"${coreSpecific.settings[k]}"`
            : coreSpecific.settings[k];
          rv += `${k} = ${value}\n`;
        }
        for (const k in this.config.defaultOptions) {
          if (rv.includes(k)) continue;
          let value = isNaN(this.config.defaultOptions[k])
            ? `"${this.config.defaultOptions[k]}"`
            : this.config.defaultOptions[k];
          rv += `${k} = ${value}\n`;
        }
        return rv;
      } catch (e) {
        console.warn("Could not load previous settings", e);
      }
    }
    return "";
  }
  loadSettings() {
    if (!window.localStorage || this.config.disableLocalStorage) return;
    this.settingsLoaded = true;
    let ejs_settings = localStorage.getItem("ejs-settings");
    let coreSpecific = localStorage.getItem(this.getLocalStorageKey());
    if (coreSpecific) {
      try {
        coreSpecific = JSON.parse(coreSpecific);
        if (
          !(coreSpecific.controlSettings instanceof Object) ||
          !(coreSpecific.settings instanceof Object) ||
          !Array.isArray(coreSpecific.cheats)
        )
          return;
        this.controls = coreSpecific.controlSettings;
        this.checkGamepadInputs();
        for (const k in coreSpecific.settings) {
          this.changeSettingOption(k, coreSpecific.settings[k]);
        }
        for (let i = 0; i < coreSpecific.cheats.length; i++) {
          const cheat = coreSpecific.cheats[i];
          let includes = false;
          for (let j = 0; j < this.cheats.length; j++) {
            if (
              this.cheats[j].desc === cheat.desc &&
              this.cheats[j].code === cheat.code
            ) {
              this.cheats[j].checked = cheat.checked;
              includes = true;
              break;
            }
          }
          if (includes) continue;
          this.cheats.push(cheat);
        }
      } catch (e) {
        console.warn("Could not load previous settings", e);
      }
    }
    if (ejs_settings) {
      try {
        ejs_settings = JSON.parse(ejs_settings);
        if (
          typeof ejs_settings.volume !== "number" ||
          typeof ejs_settings.muted !== "boolean"
        )
          return;
        this.volume = ejs_settings.volume;
        this.muted = ejs_settings.muted;
        this.setVolume(this.muted ? 0 : this.volume);
      } catch (e) {
        console.warn("Could not load previous settings", e);
      }
    }
  }
  handleSpecialOptions(option, value) {
    if (option === "shader") {
      this.enableShader(value);
    } else if (option === "disk") {
      this.gameManager.setCurrentDisk(value);
    } else if (option === "virtual-gamepad") {
      this.toggleVirtualGamepad(value !== "disabled");
    } else if (option === "menu-bar-button") {
      this.elements.menuToggle.style.display = "";
      this.elements.menuToggle.style.opacity = value === "visible" ? 0.5 : 0;
    } else if (option === "virtual-gamepad-left-handed-mode") {
      this.toggleVirtualGamepadLeftHanded(value !== "disabled");
    } else if (option === "ff-ratio") {
      if (this.isFastForward) this.gameManager.toggleFastForward(0);
      if (value === "unlimited") {
        this.gameManager.setFastForwardRatio(0);
      } else if (!isNaN(value)) {
        this.gameManager.setFastForwardRatio(parseFloat(value));
      }
      setTimeout(() => {
        if (this.isFastForward) this.gameManager.toggleFastForward(1);
      }, 10);
    } else if (option === "fastForward") {
      if (value === "enabled") {
        this.isFastForward = true;
        this.gameManager.toggleFastForward(1);
      } else if (value === "disabled") {
        this.isFastForward = false;
        this.gameManager.toggleFastForward(0);
      }
    } else if (option === "sm-ratio") {
      if (this.isSlowMotion) this.gameManager.toggleSlowMotion(0);
      this.gameManager.setSlowMotionRatio(parseFloat(value));
      setTimeout(() => {
        if (this.isSlowMotion) this.gameManager.toggleSlowMotion(1);
      }, 10);
    } else if (option === "slowMotion") {
      if (value === "enabled") {
        this.isSlowMotion = true;
        this.gameManager.toggleSlowMotion(1);
      } else if (value === "disabled") {
        this.isSlowMotion = false;
        this.gameManager.toggleSlowMotion(0);
      }
    } else if (option === "rewind-granularity") {
      if (this.rewindEnabled) {
        this.gameManager.setRewindGranularity(parseInt(value));
      }
    } else if (option === "vsync") {
      this.gameManager.setVSync(value === "enabled");
    } else if (option === "videoRotation") {
      value = parseInt(value);
      if (this.videoRotationChanged === true || value !== 0) {
        this.gameManager.setVideoRotation(value);
        this.videoRotationChanged = true;
      } else if (this.videoRotationChanged === true && value === 0) {
        this.gameManager.setVideoRotation(0);
        this.videoRotationChanged = true;
      }
    } else if (
      option === "save-save-interval" &&
      !this.config.fixedSaveInterval
    ) {
      value = parseInt(value);
      this.startSaveInterval(value * 1000);
    } else if (option === "menubarBehavior") {
      this.createBottomMenuBarListeners();
    } else if (option === "keyboardInput") {
      this.gameManager.setKeyboardEnabled(value === "enabled");
    } else if (option === "altKeyboardInput") {
      this.gameManager.setAltKeyEnabled(value === "enabled");
    } else if (option === "lockMouse") {
      this.enableMouseLock = value === "enabled";
    } else if (option === "netplayVP9SVC") {
      const normalizeVP9SVCMode = (v) => {
        const s = typeof v === "string" ? v.trim() : "";
        const sl = s.toLowerCase();
        if (sl === "l1t1") return "L1T1";
        if (sl === "l1t3") return "L1T3";
        if (sl === "l2t3") return "L2T3";
        return "L1T1";
      };
      this.netplayVP9SVCMode = normalizeVP9SVCMode(value);
      window.EJS_NETPLAY_VP9_SVC_MODE = this.netplayVP9SVCMode;

      // Only the host can apply encode changes immediately.
      try {
        if (
          this.isNetplay &&
          this.netplay &&
          this.netplay.owner &&
          typeof this.netplayReproduceHostVideoToSFU === "function"
        ) {
          const isVp9Producer = (() => {
            try {
              const p = this.netplay.producer;
              const codecs =
                p && p.rtpParameters && Array.isArray(p.rtpParameters.codecs)
                  ? p.rtpParameters.codecs
                  : [];
              return codecs.some(
                (c) =>
                  c &&
                  typeof c.mimeType === "string" &&
                  c.mimeType.toLowerCase() === "video/vp9"
              );
            } catch (e) {
              return false;
            }
          })();
          if (isVp9Producer) {
            setTimeout(() => {
              try {
                this.netplayReproduceHostVideoToSFU("vp9-svc-change");
              } catch (e) {}
            }, 0);
          }
        }
      } catch (e) {}
    } else if (option === "netplaySimulcast") {
      this.netplaySimulcastEnabled = value === "enabled";
      window.EJS_NETPLAY_SIMULCAST = this.netplaySimulcastEnabled;
    } else if (option === "netplayHostCodec") {
      const normalizeHostCodec = (v) => {
        const s = typeof v === "string" ? v.trim().toLowerCase() : "";
        if (s === "vp9" || s === "h264" || s === "vp8" || s === "auto")
          return s;
        return "auto";
      };
      this.netplayHostCodec = normalizeHostCodec(value);
      window.EJS_NETPLAY_HOST_CODEC = this.netplayHostCodec;

      // If host is currently producing SFU video, re-produce so codec takes effect.
      try {
        if (
          this.isNetplay &&
          this.netplay &&
          this.netplay.owner &&
          typeof this.netplayReproduceHostVideoToSFU === "function"
        ) {
          setTimeout(() => {
            try {
              this.netplayReproduceHostVideoToSFU("host-codec-change");
            } catch (e) {}
          }, 0);
        }
      } catch (e) {}
    } else if (
      option === "netplayClientSimulcastQuality" ||
      option === "netplayClientMaxResolution"
    ) {
      const normalizeSimulcastQuality = (v) => {
        const s = typeof v === "string" ? v.trim().toLowerCase() : "";
        if (s === "high" || s === "low") return s;
        if (s === "medium") return "low";
        if (s === "720p") return "high";
        if (s === "360p") return "low";
        if (s === "180p") return "low";
        return "high";
      };
      const simulcastQualityToLegacyRes = (q) => {
        const s = normalizeSimulcastQuality(q);
        return s === "low" ? "360p" : "720p";
      };

      this.netplayClientSimulcastQuality = normalizeSimulcastQuality(value);
      window.EJS_NETPLAY_CLIENT_SIMULCAST_QUALITY =
        this.netplayClientSimulcastQuality;
      window.EJS_NETPLAY_CLIENT_PREFERRED_QUALITY =
        this.netplayClientSimulcastQuality;
      window.EJS_NETPLAY_CLIENT_MAX_RESOLUTION = simulcastQualityToLegacyRes(
        this.netplayClientSimulcastQuality
      );
    } else if (option === "netplayRetryConnectionTimer") {
      let retrySeconds = parseInt(value, 10);
      if (isNaN(retrySeconds)) retrySeconds = 3;
      if (retrySeconds < 0) retrySeconds = 0;
      if (retrySeconds > 5) retrySeconds = 5;
      this.netplayRetryConnectionTimerSeconds = retrySeconds;
      window.EJS_NETPLAY_RETRY_CONNECTION_TIMER = retrySeconds;
    } else if (option === "netplayUnorderedRetries") {
      let unorderedRetries = parseInt(value, 10);
      if (isNaN(unorderedRetries)) unorderedRetries = 0;
      if (unorderedRetries < 0) unorderedRetries = 0;
      if (unorderedRetries > 2) unorderedRetries = 2;
      this.netplayUnorderedRetries = unorderedRetries;
      window.EJS_NETPLAY_UNORDERED_RETRIES = unorderedRetries;

      try {
        if (
          this.isNetplay &&
          this.netplay &&
          typeof this.netplayApplyInputMode === "function"
        ) {
          setTimeout(() => {
            try {
              this.netplayApplyInputMode("unordered-retries-change");
            } catch (e) {}
          }, 0);
        }
      } catch (e) {}
    } else if (option === "netplayInputMode") {
      const mode = typeof value === "string" ? value : "";
      this.netplayInputMode =
        mode === "orderedRelay" ||
        mode === "unorderedRelay" ||
        mode === "unorderedP2P"
          ? mode
          : "unorderedRelay";
      window.EJS_NETPLAY_INPUT_MODE = this.netplayInputMode;

      try {
        if (
          this.isNetplay &&
          this.netplay &&
          typeof this.netplayApplyInputMode === "function"
        ) {
          setTimeout(() => {
            try {
              this.netplayApplyInputMode("setting-change");
            } catch (e) {}
          }, 0);
        }
      } catch (e) {}
    }
  }
  menuOptionChanged(option, value) {
    this.saveSettings();
    this.allSettings[option] = value;
    if (this.debug) console.log(option, value);
    if (!this.gameManager) return;
    this.handleSpecialOptions(option, value);
    this.gameManager.setVariable(option, value);
    this.saveSettings();
  }
  setupDisksMenu() {
    this.disksMenu = this.createElement("div");
    this.disksMenu.classList.add("ejs_settings_parent");
    const nested = this.createElement("div");
    nested.classList.add("ejs_settings_transition");
    this.disks = {};

    const home = this.createElement("div");
    home.style.overflow = "auto";
    const menus = [];
    this.handleDisksResize = () => {
      let needChange = false;
      if (this.disksMenu.style.display !== "") {
        this.disksMenu.style.opacity = "0";
        this.disksMenu.style.display = "";
        needChange = true;
      }
      let height = this.elements.parent.getBoundingClientRect().height;
      let w2 = this.diskParent.parentElement.getBoundingClientRect().width;
      let disksX = this.diskParent.getBoundingClientRect().x;
      if (w2 > window.innerWidth) disksX += w2 - window.innerWidth;
      const onTheRight = disksX > (w2 - 15) / 2;
      if (height > 375) height = 375;
      home.style["max-height"] = height - 95 + "px";
      nested.style["max-height"] = height - 95 + "px";
      for (let i = 0; i < menus.length; i++) {
        menus[i].style["max-height"] = height - 95 + "px";
      }
      this.disksMenu.classList.toggle("ejs_settings_center_left", !onTheRight);
      this.disksMenu.classList.toggle("ejs_settings_center_right", onTheRight);
      if (needChange) {
        this.disksMenu.style.display = "none";
        this.disksMenu.style.opacity = "";
      }
    };

    home.classList.add("ejs_setting_menu");
    nested.appendChild(home);
    let funcs = [];
    this.changeDiskOption = (title, newValue) => {
      this.disks[title] = newValue;
      funcs.forEach((e) => e(title));
    };
    let allOpts = {};

    // TODO - Why is this duplicated?
    const addToMenu = (title, id, options, defaultOption) => {
      const span = this.createElement("span");
      span.innerText = title;

      const current = this.createElement("div");
      current.innerText = "";
      current.classList.add("ejs_settings_main_bar_selected");
      span.appendChild(current);

      const menu = this.createElement("div");
      menus.push(menu);
      menu.setAttribute("hidden", "");
      menu.classList.add("ejs_parent_option_div");
      const button = this.createElement("button");
      const goToHome = () => {
        const homeSize = this.getElementSize(home);
        nested.style.width = homeSize.width + 20 + "px";
        nested.style.height = homeSize.height + "px";
        menu.setAttribute("hidden", "");
        home.removeAttribute("hidden");
      };
      this.addEventListener(button, "click", goToHome);

      button.type = "button";
      button.classList.add("ejs_back_button");
      menu.appendChild(button);
      const pageTitle = this.createElement("span");
      pageTitle.innerText = title;
      pageTitle.classList.add("ejs_menu_text_a");
      button.appendChild(pageTitle);

      const optionsMenu = this.createElement("div");
      optionsMenu.classList.add("ejs_setting_menu");

      let buttons = [];
      let opts = options;
      if (Array.isArray(options)) {
        opts = {};
        for (let i = 0; i < options.length; i++) {
          opts[options[i]] = options[i];
        }
      }
      allOpts[id] = opts;

      funcs.push((title) => {
        if (id !== title) return;
        for (let j = 0; j < buttons.length; j++) {
          buttons[j].classList.toggle(
            "ejs_option_row_selected",
            buttons[j].getAttribute("ejs_value") === this.disks[id]
          );
        }
        this.menuOptionChanged(id, this.disks[id]);
        current.innerText = opts[this.disks[id]];
      });

      for (const opt in opts) {
        const optionButton = this.createElement("button");
        buttons.push(optionButton);
        optionButton.setAttribute("ejs_value", opt);
        optionButton.type = "button";
        optionButton.value = opts[opt];
        optionButton.classList.add("ejs_option_row");
        optionButton.classList.add("ejs_button_style");

        this.addEventListener(optionButton, "click", (e) => {
          this.disks[id] = opt;
          for (let j = 0; j < buttons.length; j++) {
            buttons[j].classList.remove("ejs_option_row_selected");
          }
          optionButton.classList.add("ejs_option_row_selected");
          this.menuOptionChanged(id, opt);
          current.innerText = opts[opt];
          goToHome();
        });
        if (defaultOption === opt) {
          optionButton.classList.add("ejs_option_row_selected");
          this.menuOptionChanged(id, opt);
          current.innerText = opts[opt];
        }

        const msg = this.createElement("span");
        msg.innerText = opts[opt];
        optionButton.appendChild(msg);

        optionsMenu.appendChild(optionButton);
      }

      home.appendChild(optionsMenu);

      nested.appendChild(menu);
    };

    if (this.gameManager.getDiskCount() > 1) {
      const diskLabels = {};
      let isM3U = false;
      let disks = {};
      if (this.fileName.split(".").pop() === "m3u") {
        disks = this.gameManager.Module.FS.readFile(this.fileName, {
          encoding: "utf8",
        }).split("\n");
        isM3U = true;
      }
      for (let i = 0; i < this.gameManager.getDiskCount(); i++) {
        // default if not an m3u loaded rom is "Disk x"
        // if m3u, then use the file name without the extension
        // if m3u, and contains a |, then use the string after the | as the disk label
        if (!isM3U) {
          diskLabels[i.toString()] = "Disk " + (i + 1);
        } else {
          // get disk name from m3u
          const diskLabelValues = disks[i].split("|");
          // remove the file extension from the disk file name
          let diskLabel = diskLabelValues[0].replace(
            "." + diskLabelValues[0].split(".").pop(),
            ""
          );
          if (diskLabelValues.length >= 2) {
            // has a label - use that instead
            diskLabel = diskLabelValues[1];
          }
          diskLabels[i.toString()] = diskLabel;
        }
      }
      addToMenu(
        this.localization("Disk"),
        "disk",
        diskLabels,
        this.gameManager.getCurrentDisk().toString()
      );
    }

    this.disksMenu.appendChild(nested);

    this.diskParent.appendChild(this.disksMenu);
    this.diskParent.style.position = "relative";

    const homeSize = this.getElementSize(home);
    nested.style.width = homeSize.width + 20 + "px";
    nested.style.height = homeSize.height + "px";

    this.disksMenu.style.display = "none";

    if (this.debug) {
      console.log("Available core options", allOpts);
    }

    if (this.config.defaultOptions) {
      for (const k in this.config.defaultOptions) {
        this.changeDiskOption(k, this.config.defaultOptions[k]);
      }
    }
  }
  getSettingValue(id) {
    return this.allSettings[id] || this.settings[id] || null;
  }
  setupSettingsMenu() {
    this.settingsMenu = this.createElement("div");
    this.settingsMenu.classList.add("ejs_settings_parent");
    const nested = this.createElement("div");
    nested.classList.add("ejs_settings_transition");
    this.settings = {};
    const menus = [];
    let parentMenuCt = 0;

    const createSettingParent = (child, title, parentElement) => {
      const rv = this.createElement("div");
      rv.classList.add("ejs_setting_menu");

      if (child) {
        const menuOption = this.createElement("div");
        menuOption.classList.add("ejs_settings_main_bar");
        const span = this.createElement("span");
        span.innerText = title;

        menuOption.appendChild(span);
        parentElement.appendChild(menuOption);

        const menu = this.createElement("div");
        const menuChild = this.createElement("div");
        menus.push(menu);
        parentMenuCt++;
        menu.setAttribute("hidden", "");
        menuChild.classList.add("ejs_parent_option_div");
        const button = this.createElement("button");
        const goToHome = () => {
          const homeSize = this.getElementSize(parentElement);
          nested.style.width = homeSize.width + 20 + "px";
          nested.style.height = homeSize.height + "px";
          menu.setAttribute("hidden", "");
          parentElement.removeAttribute("hidden");
        };
        this.addEventListener(menuOption, "click", (e) => {
          const targetSize = this.getElementSize(menu);
          nested.style.width = targetSize.width + 20 + "px";
          nested.style.height = targetSize.height + "px";
          menu.removeAttribute("hidden");
          rv.scrollTo(0, 0);
          parentElement.setAttribute("hidden", "");
        });
        const observer = new MutationObserver((list) => {
          for (const k of list) {
            for (const removed of k.removedNodes) {
              if (removed === menu) {
                menuOption.remove();
                observer.disconnect();
                const index = menus.indexOf(menu);
                if (index !== -1) menus.splice(index, 1);
                this.settingsMenu.style.display = "";
                const homeSize = this.getElementSize(parentElement);
                nested.style.width = homeSize.width + 20 + "px";
                nested.style.height = homeSize.height + "px";
                // This SHOULD always be called before the game started - this SHOULD never be an issue
                this.settingsMenu.style.display = "none";
              }
            }
          }
        });
        this.addEventListener(button, "click", goToHome);

        button.type = "button";
        button.classList.add("ejs_back_button");
        menuChild.appendChild(button);
        const pageTitle = this.createElement("span");
        pageTitle.innerText = title;
        pageTitle.classList.add("ejs_menu_text_a");
        button.appendChild(pageTitle);

        // const optionsMenu = this.createElement("div");
        // optionsMenu.classList.add("ejs_setting_menu");
        // menu.appendChild(optionsMenu);

        menuChild.appendChild(rv);
        menu.appendChild(menuChild);
        nested.appendChild(menu);
        observer.observe(nested, {
          childList: true,
          subtree: true,
        });
      }

      return rv;
    };

    const checkForEmptyMenu = (element) => {
      if (element.firstChild === null) {
        element.parentElement.remove(); // No point in keeping an empty menu
        parentMenuCt--;
      }
    };

    const home = createSettingParent();

    this.handleSettingsResize = () => {
      let needChange = false;
      if (this.settingsMenu.style.display !== "") {
        this.settingsMenu.style.opacity = "0";
        this.settingsMenu.style.display = "";
        needChange = true;
      }
      let height = this.elements.parent.getBoundingClientRect().height;
      let w2 = this.settingParent.parentElement.getBoundingClientRect().width;
      let settingsX = this.settingParent.getBoundingClientRect().x;
      if (w2 > window.innerWidth) settingsX += w2 - window.innerWidth;
      const onTheRight = settingsX > (w2 - 15) / 2;
      if (height > 375) height = 375;
      home.style["max-height"] = height - 95 + "px";
      nested.style["max-height"] = height - 95 + "px";
      for (let i = 0; i < menus.length; i++) {
        menus[i].style["max-height"] = height - 95 + "px";
      }
      this.settingsMenu.classList.toggle(
        "ejs_settings_center_left",
        !onTheRight
      );
      this.settingsMenu.classList.toggle(
        "ejs_settings_center_right",
        onTheRight
      );
      if (needChange) {
        this.settingsMenu.style.display = "none";
        this.settingsMenu.style.opacity = "";
      }
    };
    nested.appendChild(home);

    let funcs = [];
    let settings = {};
    this.changeSettingOption = (title, newValue, startup) => {
      this.allSettings[title] = newValue;
      if (startup !== true) {
        this.settings[title] = newValue;
      }
      settings[title] = newValue;
      funcs.forEach((e) => e(title));
    };
    let allOpts = {};

    const addToMenu = (
      title,
      id,
      options,
      defaultOption,
      parentElement,
      useParentParent
    ) => {
      if (
        Array.isArray(this.config.hideSettings) &&
        this.config.hideSettings.includes(id)
      ) {
        return;
      }
      parentElement = parentElement || home;
      const transitionElement = useParentParent
        ? parentElement.parentElement.parentElement
        : parentElement;
      const menuOption = this.createElement("div");
      menuOption.classList.add("ejs_settings_main_bar");
      const span = this.createElement("span");
      span.innerText = title;

      const current = this.createElement("div");
      current.innerText = "";
      current.classList.add("ejs_settings_main_bar_selected");
      span.appendChild(current);

      menuOption.appendChild(span);
      parentElement.appendChild(menuOption);

      const menu = this.createElement("div");
      menus.push(menu);
      const menuChild = this.createElement("div");
      menu.setAttribute("hidden", "");
      menuChild.classList.add("ejs_parent_option_div");

      const optionsMenu = this.createElement("div");
      optionsMenu.classList.add("ejs_setting_menu");

      const button = this.createElement("button");
      const goToHome = () => {
        transitionElement.removeAttribute("hidden");
        menu.setAttribute("hidden", "");
        const homeSize = this.getElementSize(transitionElement);
        nested.style.width = homeSize.width + 20 + "px";
        nested.style.height = homeSize.height + "px";
        transitionElement.removeAttribute("hidden");
      };
      this.addEventListener(menuOption, "click", (e) => {
        const targetSize = this.getElementSize(menu);
        nested.style.width = targetSize.width + 20 + "px";
        nested.style.height = targetSize.height + "px";
        menu.removeAttribute("hidden");
        optionsMenu.scrollTo(0, 0);
        transitionElement.setAttribute("hidden", "");
        transitionElement.setAttribute("hidden", "");
      });
      this.addEventListener(button, "click", goToHome);

      button.type = "button";
      button.classList.add("ejs_back_button");
      menuChild.appendChild(button);
      const pageTitle = this.createElement("span");
      pageTitle.innerText = title;
      pageTitle.classList.add("ejs_menu_text_a");
      button.appendChild(pageTitle);

      let buttons = [];
      let opts = options;
      if (Array.isArray(options)) {
        opts = {};
        for (let i = 0; i < options.length; i++) {
          opts[options[i]] = options[i];
        }
      }
      allOpts[id] = opts;

      funcs.push((title) => {
        if (id !== title) return;
        for (let j = 0; j < buttons.length; j++) {
          buttons[j].classList.toggle(
            "ejs_option_row_selected",
            buttons[j].getAttribute("ejs_value") === settings[id]
          );
        }
        this.menuOptionChanged(id, settings[id]);
        current.innerText = opts[settings[id]];
      });

      for (const opt in opts) {
        const optionButton = this.createElement("button");
        buttons.push(optionButton);
        optionButton.setAttribute("ejs_value", opt);
        optionButton.type = "button";
        optionButton.value = opts[opt];
        optionButton.classList.add("ejs_option_row");
        optionButton.classList.add("ejs_button_style");

        this.addEventListener(optionButton, "click", (e) => {
          this.changeSettingOption(id, opt);
          for (let j = 0; j < buttons.length; j++) {
            buttons[j].classList.remove("ejs_option_row_selected");
          }
          optionButton.classList.add("ejs_option_row_selected");
          this.menuOptionChanged(id, opt);
          current.innerText = opts[opt];
          goToHome();
        });
        if (defaultOption === opt) {
          optionButton.classList.add("ejs_option_row_selected");
          this.menuOptionChanged(id, opt);
          current.innerText = opts[opt];
        }

        const msg = this.createElement("span");
        msg.innerText = opts[opt];
        optionButton.appendChild(msg);

        optionsMenu.appendChild(optionButton);
      }

      menuChild.appendChild(optionsMenu);

      menu.appendChild(menuChild);
      nested.appendChild(menu);
    };
    const cores = this.getCores();
    const core = cores[this.getCore(true)];
    if (core && core.length > 1) {
      addToMenu(
        this.localization(
          "Core" + " (" + this.localization("Requires restart") + ")"
        ),
        "retroarch_core",
        core,
        this.getCore(),
        home
      );
    }
    if (
      typeof window.SharedArrayBuffer === "function" &&
      !this.requiresThreads(this.getCore())
    ) {
      addToMenu(
        this.localization("Threads"),
        "ejs_threads",
        {
          enabled: this.localization("Enabled"),
          disabled: this.localization("Disabled"),
        },
        this.config.threads ? "enabled" : "disabled",
        home
      );
    }

    const graphicsOptions = createSettingParent(
      true,
      "Graphics Settings",
      home
    );

    if (this.config.shaders) {
      const builtinShaders = {
        "2xScaleHQ.glslp": this.localization("2xScaleHQ"),
        "4xScaleHQ.glslp": this.localization("4xScaleHQ"),
        "crt-aperture.glslp": this.localization("CRT aperture"),
        "crt-beam": this.localization("CRT beam"),
        "crt-caligari": this.localization("CRT caligari"),
        "crt-easymode.glslp": this.localization("CRT easymode"),
        "crt-geom.glslp": this.localization("CRT geom"),
        "crt-lottes": this.localization("CRT lottes"),
        "crt-mattias.glslp": this.localization("CRT mattias"),
        "crt-yeetron": this.localization("CRT yeetron"),
        "crt-zfast": this.localization("CRT zfast"),
        sabr: this.localization("SABR"),
        bicubic: this.localization("Bicubic"),
        "mix-frames": this.localization("Mix frames"),
      };
      let shaderMenu = {
        disabled: this.localization("Disabled"),
      };
      for (const shaderName in this.config.shaders) {
        if (builtinShaders[shaderName]) {
          shaderMenu[shaderName] = builtinShaders[shaderName];
        } else {
          shaderMenu[shaderName] = shaderName;
        }
      }
      addToMenu(
        this.localization("Shaders"),
        "shader",
        shaderMenu,
        "disabled",
        graphicsOptions,
        true
      );
    }

    if (this.supportsWebgl2 && !this.requiresWebGL2(this.getCore())) {
      addToMenu(
        this.localization("WebGL2") +
          " (" +
          this.localization("Requires restart") +
          ")",
        "webgl2Enabled",
        {
          enabled: this.localization("Enabled"),
          disabled: this.localization("Disabled"),
        },
        this.webgl2Enabled ? "enabled" : "disabled",
        graphicsOptions,
        true
      );
    }

    addToMenu(
      this.localization("FPS"),
      "fps",
      {
        show: this.localization("show"),
        hide: this.localization("hide"),
      },
      "hide",
      graphicsOptions,
      true
    );

    addToMenu(
      this.localization("VSync"),
      "vsync",
      {
        enabled: this.localization("Enabled"),
        disabled: this.localization("Disabled"),
      },
      "disabled",
      graphicsOptions,
      true
    );

    addToMenu(
      this.localization("Video Rotation"),
      "videoRotation",
      {
        0: "0 deg",
        1: "90 deg",
        2: "180 deg",
        3: "270 deg",
      },
      this.videoRotation.toString(),
      graphicsOptions,
      true
    );

    const screenCaptureOptions = createSettingParent(
      true,
      "Screen Capture",
      home
    );

    addToMenu(
      this.localization("Screenshot Source"),
      "screenshotSource",
      {
        canvas: "canvas",
        retroarch: "retroarch",
      },
      this.capture.photo.source,
      screenCaptureOptions,
      true
    );

    let screenshotFormats = {
      png: "png",
      jpeg: "jpeg",
      webp: "webp",
    };
    if (this.isSafari) {
      delete screenshotFormats["webp"];
    }
    if (!(this.capture.photo.format in screenshotFormats)) {
      this.capture.photo.format = "png";
    }
    addToMenu(
      this.localization("Screenshot Format"),
      "screenshotFormat",
      screenshotFormats,
      this.capture.photo.format,
      screenCaptureOptions,
      true
    );

    const screenshotUpscale = this.capture.photo.upscale.toString();
    let screenshotUpscales = {
      0: "native",
      1: "1x",
      2: "2x",
      3: "3x",
    };
    if (!(screenshotUpscale in screenshotUpscales)) {
      screenshotUpscales[screenshotUpscale] = screenshotUpscale + "x";
    }
    addToMenu(
      this.localization("Screenshot Upscale"),
      "screenshotUpscale",
      screenshotUpscales,
      screenshotUpscale,
      screenCaptureOptions,
      true
    );

    const screenRecordFPS = this.capture.video.fps.toString();
    let screenRecordFPSs = {
      30: "30",
      60: "60",
    };
    if (!(screenRecordFPS in screenRecordFPSs)) {
      screenRecordFPSs[screenRecordFPS] = screenRecordFPS;
    }
    addToMenu(
      this.localization("Screen Recording FPS"),
      "screenRecordFPS",
      screenRecordFPSs,
      screenRecordFPS,
      screenCaptureOptions,
      true
    );

    let screenRecordFormats = {
      mp4: "mp4",
      webm: "webm",
    };
    for (const format in screenRecordFormats) {
      if (!MediaRecorder.isTypeSupported("video/" + format)) {
        delete screenRecordFormats[format];
      }
    }
    if (!(this.capture.video.format in screenRecordFormats)) {
      this.capture.video.format = Object.keys(screenRecordFormats)[0];
    }
    addToMenu(
      this.localization("Screen Recording Format"),
      "screenRecordFormat",
      screenRecordFormats,
      this.capture.video.format,
      screenCaptureOptions,
      true
    );

    const screenRecordUpscale = this.capture.video.upscale.toString();
    let screenRecordUpscales = {
      1: "1x",
      2: "2x",
      3: "3x",
      4: "4x",
    };
    if (!(screenRecordUpscale in screenRecordUpscales)) {
      screenRecordUpscales[screenRecordUpscale] = screenRecordUpscale + "x";
    }
    addToMenu(
      this.localization("Screen Recording Upscale"),
      "screenRecordUpscale",
      screenRecordUpscales,
      screenRecordUpscale,
      screenCaptureOptions,
      true
    );

    const screenRecordVideoBitrate = this.capture.video.videoBitrate.toString();
    let screenRecordVideoBitrates = {
      1048576: "1 Mbit/sec",
      2097152: "2 Mbit/sec",
      2621440: "2.5 Mbit/sec",
      3145728: "3 Mbit/sec",
      4194304: "4 Mbit/sec",
    };
    if (!(screenRecordVideoBitrate in screenRecordVideoBitrates)) {
      screenRecordVideoBitrates[screenRecordVideoBitrate] =
        screenRecordVideoBitrate + " Bits/sec";
    }
    addToMenu(
      this.localization("Screen Recording Video Bitrate"),
      "screenRecordVideoBitrate",
      screenRecordVideoBitrates,
      screenRecordVideoBitrate,
      screenCaptureOptions,
      true
    );

    const screenRecordAudioBitrate = this.capture.video.audioBitrate.toString();
    let screenRecordAudioBitrates = {
      65536: "64 Kbit/sec",
      131072: "128 Kbit/sec",
      196608: "192 Kbit/sec",
      262144: "256 Kbit/sec",
      327680: "320 Kbit/sec",
    };
    if (!(screenRecordAudioBitrate in screenRecordAudioBitrates)) {
      screenRecordAudioBitrates[screenRecordAudioBitrate] =
        screenRecordAudioBitrate + " Bits/sec";
    }
    addToMenu(
      this.localization("Screen Recording Audio Bitrate"),
      "screenRecordAudioBitrate",
      screenRecordAudioBitrates,
      screenRecordAudioBitrate,
      screenCaptureOptions,
      true
    );

    checkForEmptyMenu(screenCaptureOptions);

    const speedOptions = createSettingParent(true, "Speed Options", home);

    addToMenu(
      this.localization("Fast Forward"),
      "fastForward",
      {
        enabled: this.localization("Enabled"),
        disabled: this.localization("Disabled"),
      },
      "disabled",
      speedOptions,
      true
    );

    addToMenu(
      this.localization("Fast Forward Ratio"),
      "ff-ratio",
      [
        "1.5",
        "2.0",
        "2.5",
        "3.0",
        "3.5",
        "4.0",
        "4.5",
        "5.0",
        "5.5",
        "6.0",
        "6.5",
        "7.0",
        "7.5",
        "8.0",
        "8.5",
        "9.0",
        "9.5",
        "10.0",
        "unlimited",
      ],
      "3.0",
      speedOptions,
      true
    );

    addToMenu(
      this.localization("Slow Motion"),
      "slowMotion",
      {
        enabled: this.localization("Enabled"),
        disabled: this.localization("Disabled"),
      },
      "disabled",
      speedOptions,
      true
    );

    addToMenu(
      this.localization("Slow Motion Ratio"),
      "sm-ratio",
      [
        "1.5",
        "2.0",
        "2.5",
        "3.0",
        "3.5",
        "4.0",
        "4.5",
        "5.0",
        "5.5",
        "6.0",
        "6.5",
        "7.0",
        "7.5",
        "8.0",
        "8.5",
        "9.0",
        "9.5",
        "10.0",
      ],
      "3.0",
      speedOptions,
      true
    );

    addToMenu(
      this.localization(
        "Rewind Enabled" + " (" + this.localization("Requires restart") + ")"
      ),
      "rewindEnabled",
      {
        enabled: this.localization("Enabled"),
        disabled: this.localization("Disabled"),
      },
      "disabled",
      speedOptions,
      true
    );

    if (this.rewindEnabled) {
      addToMenu(
        this.localization("Rewind Granularity"),
        "rewind-granularity",
        ["1", "3", "6", "12", "25", "50", "100"],
        "6",
        speedOptions,
        true
      );
    }

    const inputOptions = createSettingParent(true, "Input Options", home);

    addToMenu(
      this.localization("Menubar Mouse Trigger"),
      "menubarBehavior",
      {
        downward: this.localization("Downward Movement"),
        anywhere: this.localization("Movement Anywhere"),
      },
      "downward",
      inputOptions,
      true
    );

    addToMenu(
      this.localization("Direct Keyboard Input"),
      "keyboardInput",
      {
        disabled: this.localization("Disabled"),
        enabled: this.localization("Enabled"),
      },
      this.defaultCoreOpts && this.defaultCoreOpts.useKeyboard === true
        ? "enabled"
        : "disabled",
      inputOptions,
      true
    );

    addToMenu(
      this.localization("Forward Alt key"),
      "altKeyboardInput",
      {
        disabled: this.localization("Disabled"),
        enabled: this.localization("Enabled"),
      },
      "disabled",
      inputOptions,
      true
    );

    addToMenu(
      this.localization("Lock Mouse"),
      "lockMouse",
      {
        disabled: this.localization("Disabled"),
        enabled: this.localization("Enabled"),
      },
      this.enableMouseLock === true ? "enabled" : "disabled",
      inputOptions,
      true
    );

    checkForEmptyMenu(inputOptions);

    const netplayOptions = createSettingParent(true, "Netplay Options", home);

    addToMenu(
      this.localization("SVC with VP9"),
      "netplayVP9SVC",
      {
        L1T1: "L1T1",
        L1T3: "L1T3",
        L2T3: "L2T3",
      },
      (() => {
        const normalizeVP9SVCMode = (v) => {
          const s = typeof v === "string" ? v.trim() : "";
          const sl = s.toLowerCase();
          if (sl === "l1t1") return "L1T1";
          if (sl === "l1t3") return "L1T3";
          if (sl === "l2t3") return "L2T3";
          return "L1T1";
        };
        return normalizeVP9SVCMode(
          this.preGetSetting("netplayVP9SVC") ||
            this.netplayVP9SVCMode ||
            "L1T1"
        );
      })(),
      netplayOptions,
      true
    );

    addToMenu(
      this.localization("Legacy Simulcast"),
      "netplaySimulcast",
      {
        enabled: this.localization("Enabled"),
        disabled: this.localization("Disabled"),
      },
      this.preGetSetting("netplaySimulcast") ||
        (this.netplaySimulcastEnabled ? "enabled" : "disabled"),
      netplayOptions,
      true
    );

    addToMenu(
      this.localization("Host Codec"),
      "netplayHostCodec",
      {
        auto: this.localization("Auto"),
        vp9: "VP9",
        h264: "H264",
        vp8: "VP8",
      },
      (() => {
        const normalizeHostCodec = (v) => {
          const s = typeof v === "string" ? v.trim().toLowerCase() : "";
          if (s === "vp9" || s === "h264" || s === "vp8" || s === "auto")
            return s;
          return "auto";
        };
        return normalizeHostCodec(
          this.preGetSetting("netplayHostCodec") ||
            this.netplayHostCodec ||
            "auto"
        );
      })(),
      netplayOptions,
      true
    );

    addToMenu(
      this.localization("Client Simulcast Quality"),
      "netplayClientSimulcastQuality",
      {
        high: this.localization("High"),
        low: this.localization("Low"),
      },
      (() => {
        const normalizeSimulcastQuality = (v) => {
          const s = typeof v === "string" ? v.trim().toLowerCase() : "";
          if (s === "high" || s === "low") return s;
          if (s === "medium") return "low";
          if (s === "720p") return "high";
          if (s === "360p") return "low";
          if (s === "180p") return "low";
          return "high";
        };
        return normalizeSimulcastQuality(
          this.preGetSetting("netplayClientSimulcastQuality") ||
            this.preGetSetting("netplayClientMaxResolution") ||
            this.netplayClientSimulcastQuality ||
            "high"
        );
      })(),
      netplayOptions,
      true
    );

    addToMenu(
      this.localization("Retry Connection Timer"),
      "netplayRetryConnectionTimer",
      {
        0: this.localization("Disabled"),
        1: "1 second",
        2: "2 seconds",
        3: "3 seconds",
        4: "4 seconds",
        5: "5 seconds",
      },
      (
        this.preGetSetting("netplayRetryConnectionTimer") ||
        (this.netplayRetryConnectionTimerSeconds || 3).toString()
      ).toString(),
      netplayOptions,
      true
    );

    addToMenu(
      this.localization("Unordered Retries"),
      "netplayUnorderedRetries",
      {
        0: "0",
        1: "1",
        2: "2",
      },
      (
        this.preGetSetting("netplayUnorderedRetries") ||
        (typeof this.netplayUnorderedRetries === "number"
          ? this.netplayUnorderedRetries
          : 0
        ).toString()
      ).toString(),
      netplayOptions,
      true
    );

    addToMenu(
      this.localization("Input Mode"),
      "netplayInputMode",
      {
        unorderedRelay: this.localization("Unordered Relay"),
        orderedRelay: this.localization("Ordered Relay"),
        unorderedP2P: this.localization("Unordered P2P"),
      },
      this.preGetSetting("netplayInputMode") ||
        this.netplayInputMode ||
        "unorderedRelay",
      netplayOptions,
      true
    );

    checkForEmptyMenu(netplayOptions);

    if (this.saveInBrowserSupported()) {
      const saveStateOpts = createSettingParent(true, "Save States", home);
      addToMenu(
        this.localization("Save State Slot"),
        "save-state-slot",
        ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
        "1",
        saveStateOpts,
        true
      );
      addToMenu(
        this.localization("Save State Location"),
        "save-state-location",
        {
          download: this.localization("Download"),
          browser: this.localization("Keep in Browser"),
        },
        "download",
        saveStateOpts,
        true
      );
      if (!this.config.fixedSaveInterval) {
        addToMenu(
          this.localization("System Save interval"),
          "save-save-interval",
          {
            0: "Disabled",
            30: "30 seconds",
            60: "1 minute",
            300: "5 minutes",
            600: "10 minutes",
            900: "15 minutes",
            1800: "30 minutes",
          },
          "300",
          saveStateOpts,
          true
        );
      }
      checkForEmptyMenu(saveStateOpts);
    }

    if (this.touch || this.hasTouchScreen) {
      const virtualGamepad = createSettingParent(true, "Virtual Gamepad", home);
      addToMenu(
        this.localization("Virtual Gamepad"),
        "virtual-gamepad",
        {
          enabled: this.localization("Enabled"),
          disabled: this.localization("Disabled"),
        },
        this.isMobile ? "enabled" : "disabled",
        virtualGamepad,
        true
      );
      addToMenu(
        this.localization("Menu Bar Button"),
        "menu-bar-button",
        {
          visible: this.localization("visible"),
          hidden: this.localization("hidden"),
        },
        "visible",
        virtualGamepad,
        true
      );
      addToMenu(
        this.localization("Left Handed Mode"),
        "virtual-gamepad-left-handed-mode",
        {
          enabled: this.localization("Enabled"),
          disabled: this.localization("Disabled"),
        },
        "disabled",
        virtualGamepad,
        true
      );
      checkForEmptyMenu(virtualGamepad);
    }

    let coreOpts;
    try {
      coreOpts = this.gameManager.getCoreOptions();
    } catch (e) {}
    if (coreOpts) {
      const coreOptions = createSettingParent(
        true,
        "Backend Core Options",
        home
      );
      coreOpts.split("\n").forEach((line, index) => {
        let option = line.split("; ");
        let name = option[0];
        let options = option[1].split("|"),
          optionName = name
            .split("|")[0]
            .replace(/_/g, " ")
            .replace(/.+\-(.+)/, "$1");
        options.slice(1, -1);
        if (options.length === 1) return;
        let availableOptions = {};
        for (let i = 0; i < options.length; i++) {
          availableOptions[options[i]] = this.localization(
            options[i],
            this.config.settingsLanguage
          );
        }
        addToMenu(
          this.localization(optionName, this.config.settingsLanguage),
          name.split("|")[0],
          availableOptions,
          name.split("|").length > 1
            ? name.split("|")[1]
            : options[0].replace("(Default) ", ""),
          coreOptions,
          true
        );
      });
      checkForEmptyMenu(coreOptions);
    }

    /*
        this.retroarchOpts = [
            {
                title: "Audio Latency", // String
                name: "audio_latency", // String - value to be set in retroarch.cfg
                // options should ALWAYS be strings here...
                options: ["8", "16", "32", "64", "128"], // values
                options: {"8": "eight", "16": "sixteen", "32": "thirty-two", "64": "sixty-four", "128": "one hundred-twenty-eight"}, // This also works
                default: "128", // Default
                isString: false // Surround value with quotes in retroarch.cfg file?
            }
        ];*/

    if (this.retroarchOpts && Array.isArray(this.retroarchOpts)) {
      const retroarchOptsMenu = createSettingParent(
        true,
        "RetroArch Options" +
          " (" +
          this.localization("Requires restart") +
          ")",
        home
      );
      this.retroarchOpts.forEach((option) => {
        addToMenu(
          this.localization(option.title, this.config.settingsLanguage),
          option.name,
          option.options,
          option.default,
          retroarchOptsMenu,
          true
        );
      });
      checkForEmptyMenu(retroarchOptsMenu);
    }

    checkForEmptyMenu(graphicsOptions);
    checkForEmptyMenu(speedOptions);

    this.settingsMenu.appendChild(nested);

    this.settingParent.appendChild(this.settingsMenu);
    this.settingParent.style.position = "relative";

    this.settingsMenu.style.display = "";
    const homeSize = this.getElementSize(home);
    nested.style.width = homeSize.width + 20 + "px";
    nested.style.height = homeSize.height + "px";

    this.settingsMenu.style.display = "none";

    if (this.debug) {
      console.log("Available core options", allOpts);
    }

    if (this.config.defaultOptions) {
      for (const k in this.config.defaultOptions) {
        this.changeSettingOption(k, this.config.defaultOptions[k], true);
      }
    }

    if (parentMenuCt === 0) {
      this.on("start", () => {
        this.elements.bottomBar.settings[0][0].style.display = "none";
      });
    }
  }
  createSubPopup(hidden) {
    const popup = this.createElement("div");
    popup.classList.add("ejs_popup_container");
    popup.classList.add("ejs_popup_container_box");
    const popupMsg = this.createElement("div");
    popupMsg.innerText = "";
    if (hidden) popup.setAttribute("hidden", "");
    popup.appendChild(popupMsg);
    return [popup, popupMsg];
  }

  updateNetplayUI(isJoining) {
    if (!this.elements.bottomBar) return;

    const bar = this.elements.bottomBar;
    const isClient = !this.netplay.owner;
    const shouldHideButtons = isJoining && isClient;
    const elementsToToggle = [
      ...(bar.playPause || []),
      ...(bar.restart || []),
      ...(bar.saveState || []),
      ...(bar.loadState || []),
      ...(bar.cheat || []),
      ...(bar.saveSavFiles || []),
      ...(bar.loadSavFiles || []),
      ...(bar.exit || []),
      ...(bar.contextMenu || []),
      ...(bar.cacheManager || []),
    ];

    // Add the parent containers to the same logic
    if (
      bar.settings &&
      bar.settings.length > 0 &&
      bar.settings[0].parentElement
    ) {
      elementsToToggle.push(bar.settings[0].parentElement);
    }
    if (this.diskParent) {
      elementsToToggle.push(this.diskParent);
    }

    elementsToToggle.forEach((el) => {
      if (el) {
        el.classList.toggle("netplay-hidden", shouldHideButtons);
      }
    });
  }

  createNetplayMenu() {
    const body = this.createPopup(
      "Netplay",
      {
        "Create a Room": () => {
          if (typeof this.netplay.updateList !== "function")
            this.defineNetplayFunctions();
          if (this.isNetplay) {
            this.netplay.leaveRoom();
          } else {
            this.netplay.showOpenRoomDialog();
          }
        },
        Close: () => {
          this.netplayMenu.style.display = "none";
          if (this.netplay.updateList) {
            this.netplay.updateList.stop();
          }
        },
      },
      true
    );
    this.netplayMenu = body.parentElement;
    const createButton = this.netplayMenu.getElementsByTagName("a")[0];
    const rooms = this.createElement("div");
    const title = this.createElement("strong");
    title.innerText = this.localization("Rooms");
    const table = this.createElement("table");
    table.classList.add("ejs_netplay_table");
    table.style.width = "100%";
    table.setAttribute("cellspacing", "0");
    const thead = this.createElement("thead");
    const row = this.createElement("tr");
    const addToHeader = (text) => {
      const item = this.createElement("td");
      item.innerText = text;
      item.style["text-align"] = "center";
      row.appendChild(item);
      return item;
    };
    thead.appendChild(row);
    addToHeader("Room Name").style["text-align"] = "left";
    addToHeader("Players").style.width = "80px";
    addToHeader("").style.width = "80px";
    table.appendChild(thead);
    const tbody = this.createElement("tbody");

    table.appendChild(tbody);
    rooms.appendChild(title);
    rooms.appendChild(table);

    const joined = this.createElement("div");
    const title2 = this.createElement("strong");
    title2.innerText = "{roomname}";
    const password = this.createElement("div");
    password.innerText = "Password: ";

    // Joined-room controls (shown only after join/create)
    const joinedControls = this.createElement("div");
    joinedControls.classList.add("ejs_netplay_header");
    joinedControls.style.display = "flex";
    joinedControls.style.alignItems = "center";
    joinedControls.style.gap = "10px";
    joinedControls.style.margin = "10px 0";
    joinedControls.style.justifyContent = "flex-start";

    const slotLabel = this.createElement("strong");
    slotLabel.innerText = this.localization("Player Slot") || "Player Slot";
    const slotSelect = this.createElement("select");
    for (let i = 0; i < 4; i++) {
      const opt = this.createElement("option");
      opt.value = String(i);
      opt.innerText = "P" + (i + 1);
      slotSelect.appendChild(opt);
    }
    const slotCurrent = this.createElement("span");
    slotCurrent.style.opacity = "0.85";
    slotCurrent.style.marginLeft = "4px";

    joinedControls.appendChild(slotLabel);
    joinedControls.appendChild(slotSelect);
    joinedControls.appendChild(slotCurrent);

    const table2 = this.createElement("table");
    table2.classList.add("ejs_netplay_table");
    table2.style.width = "100%";
    table2.setAttribute("cellspacing", "0");
    const thead2 = this.createElement("thead");
    const row2 = this.createElement("tr");
    const addToHeader2 = (text) => {
      const item = this.createElement("td");
      item.innerText = text;
      row2.appendChild(item);
      return item;
    };
    thead2.appendChild(row2);
    addToHeader2("Player").style.width = "80px";
    addToHeader2("Name");
    addToHeader2("").style.width = "80px";
    table2.appendChild(thead2);
    const tbody2 = this.createElement("tbody");

    table2.appendChild(tbody2);
    joined.appendChild(title2);
    joined.appendChild(password);
    joined.appendChild(joinedControls);
    joined.appendChild(table2);

    joined.style.display = "none";
    body.appendChild(rooms);
    body.appendChild(joined);

    this.openNetplayMenu = () => {
      if (this.netplayShowTurnWarning && !this.netplayWarningShown) {
        const warningDiv = this.createElement("div");
        warningDiv.className = "ejs_netplay_warning";
        warningDiv.innerText =
          "Warning: No TURN server configured. Netplay connections may fail.";
        const menuBody = this.netplayMenu.querySelector(".ejs_popup_body");
        if (menuBody) {
          menuBody.prepend(warningDiv);
          this.netplayWarningShown = true;
        }
      }
      this.netplayMenu.style.display = "";
      if (!this.netplay || (this.netplay && !this.netplay.name)) {
        this.netplay = {
          table: tbody,
          playerTable: tbody2,
          passwordElem: password,
          roomNameElem: title2,
          createButton: createButton,
          tabs: [rooms, joined],
          slotSelect: slotSelect,
          slotCurrent: slotCurrent,
          ...this.netplay,
        };
        const popups = this.createSubPopup();
        this.netplayMenu.appendChild(popups[0]);
        popups[1].classList.add("ejs_cheat_parent");
        const popup = popups[1];

        const header = this.createElement("div");
        const title = this.createElement("h2");
        title.innerText = this.localization("Set Player Name");
        title.classList.add("ejs_netplay_name_heading");
        header.appendChild(title);
        popup.appendChild(header);

        const main = this.createElement("div");
        main.classList.add("ejs_netplay_header");
        const head = this.createElement("strong");
        head.innerText = this.localization("Player Name");
        const input = this.createElement("input");
        input.type = "text";
        input.setAttribute("maxlength", 20);

        main.appendChild(head);
        main.appendChild(this.createElement("br"));
        main.appendChild(input);
        popup.appendChild(main);

        popup.appendChild(this.createElement("br"));
        const submit = this.createElement("button");
        submit.classList.add("ejs_button_button");
        submit.classList.add("ejs_popup_submit");
        submit.style["background-color"] = "rgba(var(--ejs-primary-color),1)";
        submit.innerText = this.localization("Submit");
        popup.appendChild(submit);
        this.addEventListener(submit, "click", (e) => {
          if (!input.value.trim()) return;
          this.netplay.name = input.value.trim();
          popups[0].remove();
        });
      }

      // Always populate slot UI from current preference, and wire live switching once.
      try {
        if (this.netplay && this.netplay.slotSelect) {
          const s =
            typeof this.netplay.localSlot === "number"
              ? this.netplay.localSlot
              : typeof this.netplayPreferredSlot === "number"
              ? this.netplayPreferredSlot
              : 0;
          this.netplay.slotSelect.value = String(Math.max(0, Math.min(3, s)));
          if (this.netplay.slotCurrent) {
            this.netplay.slotCurrent.innerText =
              "(" + "P" + (Math.max(0, Math.min(3, s)) + 1) + ")";
          }

          if (!this.netplay._slotSelectWired) {
            this.netplay._slotSelectWired = true;
            this.addEventListener(this.netplay.slotSelect, "change", () => {
              const raw = parseInt(this.netplay.slotSelect.value, 10);
              const slot = isNaN(raw) ? 0 : Math.max(0, Math.min(3, raw));
              this.netplay.localSlot = slot;
              this.netplayPreferredSlot = slot;
              window.EJS_NETPLAY_PREFERRED_SLOT = slot;
              if (this.netplay.slotCurrent) {
                this.netplay.slotCurrent.innerText =
                  "(" + "P" + (slot + 1) + ")";
              }
              if (this.netplay.extra) {
                this.netplay.extra.player_slot = slot;
              }
              if (this.settings) {
                this.settings.netplayPreferredSlot = String(slot);
              }
              this.saveSettings();
            });
          }
        }
      } catch (e) {
        // ignore
      }
      if (typeof this.netplay.updateList !== "function") {
        this.defineNetplayFunctions();
      }
      this.netplay.updateList.start();
    };
  }

  defineNetplayFunctions() {
    const EJS_INSTANCE = this;

    // SFU audio stability helpers.
    // Keep these on `this` so nested callbacks can access them reliably.
    if (typeof this._ejsExtractOutboundAudioBytesSent !== "function") {
      this._ejsExtractOutboundAudioBytesSent = (stats) => {
        try {
          let best = null;
          const consider = (s) => {
            if (!s) return;
            const type = typeof s.type === "string" ? s.type : "";
            if (type && type !== "outbound-rtp") return;
            const mediaType =
              typeof s.mediaType === "string"
                ? s.mediaType
                : typeof s.kind === "string"
                ? s.kind
                : "";
            if (mediaType && mediaType !== "audio") return;
            const b =
              typeof s.bytesSent === "number"
                ? s.bytesSent
                : typeof s.bytes === "number"
                ? s.bytes
                : null;
            if (typeof b === "number") {
              best = best === null ? b : Math.max(best, b);
            }
          };

          if (!stats) return null;
          if (Array.isArray(stats)) {
            stats.forEach(consider);
            return best;
          }
          if (typeof stats.forEach === "function") {
            // RTCStatsReport
            stats.forEach(consider);
            return best;
          }
          if (typeof stats === "object") {
            for (const k in stats) consider(stats[k]);
            return best;
          }
          return null;
        } catch (e) {
          return null;
        }
      };
    }

    if (typeof this._ejsEnsureHostAudioProducerHealthMonitor !== "function") {
      this._ejsEnsureHostAudioProducerHealthMonitor = () => {
        try {
          if (!this.netplay || !this.netplay.owner) return;
          if (this.netplay._ejsHostAudioHealthTimer) return;

          this.netplay._ejsHostAudioHealth = {
            lastBytesSent: null,
            lastChangeAt: Date.now(),
            lastCheckedAt: 0,
          };

          this.netplay._ejsHostAudioHealthTimer = setInterval(async () => {
            try {
              if (!this.netplay || !this.netplay.owner || !this.netplay.useSFU)
                return;
              if (!this.netplay.audioProducer) return;
              if (this.netplay.audioProducer.closed) return;

              const audioTrack =
                (this.netplay && this.netplay._ejsHostAudioTrack) ||
                (this.netplay.localStream &&
                this.netplay.localStream.getAudioTracks
                  ? this.netplay.localStream.getAudioTracks()[0]
                  : null);
              if (!audioTrack) return;
              if (audioTrack.enabled === false) return;

              const p = this.netplay.audioProducer;
              if (typeof p.getStats !== "function") return;

              const now = Date.now();
              const health = this.netplay._ejsHostAudioHealth;
              if (
                health &&
                health.lastCheckedAt &&
                now - health.lastCheckedAt < 2500
              )
                return;
              if (health) health.lastCheckedAt = now;

              const stats = await p.getStats().catch(() => null);
              const bytes =
                typeof this._ejsExtractOutboundAudioBytesSent === "function"
                  ? this._ejsExtractOutboundAudioBytesSent(stats)
                  : null;
              if (typeof bytes !== "number") return;

              if (health.lastBytesSent === null) {
                health.lastBytesSent = bytes;
                health.lastChangeAt = now;
                return;
              }

              if (bytes > health.lastBytesSent) {
                health.lastBytesSent = bytes;
                health.lastChangeAt = now;
                return;
              }

              // No progress for a while: attempt an automatic recovery.
              if (now - health.lastChangeAt > 12000) {
                console.warn(
                  "[Netplay] Host audio producer appears stalled; attempting SFU audio recovery",
                  {
                    bytesSent: bytes,
                    lastChangeAt: health.lastChangeAt,
                  }
                );
                health.lastChangeAt = now;
                if (typeof this.netplayReproduceHostAudioToSFU === "function") {
                  this.netplayReproduceHostAudioToSFU(
                    "host-audio-producer-stalled"
                  );
                } else if (
                  typeof this.netplayReproduceHostVideoToSFU === "function"
                ) {
                  this.netplayReproduceHostVideoToSFU(
                    "host-audio-producer-stalled"
                  );
                }
              }
            } catch (e) {
              // ignore
            }
          }, 5000);
        } catch (e) {
          // ignore
        }
      };
    }

    if (typeof this._ejsAttachHostAudioRecoveryHandlers !== "function") {
      this._ejsAttachHostAudioRecoveryHandlers = (mediaStream, origin) => {
        try {
          if (!this.netplay || !this.netplay.owner) return;
          const at =
            mediaStream && mediaStream.getAudioTracks
              ? mediaStream.getAudioTracks()[0]
              : null;
          if (!at) return;
          if (at._ejsHostAudioRecoveryInstalled) return;
          at._ejsHostAudioRecoveryInstalled = true;

          const tag = typeof origin === "string" ? origin : "unknown";
          at.onended = () => {
            console.warn("[Netplay] Host audio track ended", {
              id: at.id,
              origin: tag,
            });
            if (typeof this.netplayReproduceHostAudioToSFU === "function") {
              this.netplayReproduceHostAudioToSFU("host-audio-track-ended");
            } else if (
              typeof this.netplayReproduceHostVideoToSFU === "function"
            ) {
              this.netplayReproduceHostVideoToSFU("host-audio-track-ended");
            }
          };
          at.onmute = () => {
            console.warn("[Netplay] Host audio track muted", {
              id: at.id,
              origin: tag,
            });
            if (typeof this.netplayReproduceHostAudioToSFU === "function") {
              this.netplayReproduceHostAudioToSFU("host-audio-track-muted");
            } else if (
              typeof this.netplayReproduceHostVideoToSFU === "function"
            ) {
              this.netplayReproduceHostVideoToSFU("host-audio-track-muted");
            }
          };
          at.onunmute = () => {
            console.log("[Netplay] Host audio track unmuted", {
              id: at.id,
              origin: tag,
            });
          };
        } catch (e) {
          // ignore
        }
      };
    }

    // Client-side SFU audio recovery (spectator): detect stalled inbound audio and re-consume.
    if (typeof this._ejsExtractInboundAudioBytesReceived !== "function") {
      this._ejsExtractInboundAudioBytesReceived = (stats) => {
        try {
          let best = null;
          const consider = (s) => {
            if (!s) return;
            const type = typeof s.type === "string" ? s.type : "";
            if (type && type !== "inbound-rtp") return;

            const mediaType =
              typeof s.mediaType === "string"
                ? s.mediaType
                : typeof s.kind === "string"
                ? s.kind
                : "";
            if (mediaType && mediaType !== "audio") return;

            const b =
              typeof s.bytesReceived === "number"
                ? s.bytesReceived
                : typeof s.bytes === "number"
                ? s.bytes
                : null;
            if (typeof b === "number") {
              best = best === null ? b : Math.max(best, b);
            }
          };

          if (!stats) return null;
          if (Array.isArray(stats)) {
            stats.forEach(consider);
            return best;
          }
          if (typeof stats.forEach === "function") {
            // RTCStatsReport or mediasoup-client stats report
            stats.forEach(consider);
            return best;
          }
          if (typeof stats === "object") {
            for (const k in stats) consider(stats[k]);
            return best;
          }
          return null;
        } catch (e) {
          return null;
        }
      };
    }

    if (
      typeof this._ejsEnsureClientSfuAudioConsumerHealthMonitor !== "function"
    ) {
      this._ejsEnsureClientSfuAudioConsumerHealthMonitor = () => {
        try {
          if (!this.netplay || !this.isNetplay) return;
          if (this.netplay.owner) return;
          if (!this.netplay.useSFU) return;
          if (this.netplay._ejsClientAudioHealthTimer) return;

          this.netplay._ejsClientAudioHealth = {
            lastBytesReceived: null,
            lastChangeAt: Date.now(),
            lastCheckedAt: 0,
            lastRecoverAt: 0,
            recovering: false,
          };

          this.netplay._ejsAttemptClientSfuAudioRecovery = async (reason) => {
            try {
              if (!this.netplay || !this.isNetplay) return;
              if (this.netplay.owner) return;
              if (!this.netplay.useSFU) return;

              const now = Date.now();
              const health = this.netplay._ejsClientAudioHealth;
              if (health && health.recovering) return;
              if (
                health &&
                health.lastRecoverAt &&
                now - health.lastRecoverAt < 15000
              )
                return;
              if (health) {
                health.recovering = true;
                health.lastRecoverAt = now;
              }

              const producerId =
                this.netplay._ejsSfuAudioProducerId ||
                (this.netplay.audioConsumer &&
                  this.netplay.audioConsumer.producerId) ||
                null;

              console.warn("[Netplay][SFU] Attempting client audio recovery", {
                reason: reason || "unknown",
                producerId,
              });

              // Close the existing consumer to force a fresh consume.
              try {
                if (this.netplay.audioConsumer) {
                  this.netplay.audioConsumer.close();
                }
              } catch (e) {}
              this.netplay.audioConsumer = null;

              // Remove any existing audio tracks from the SFU MediaStream.
              try {
                if (this.netplay.sfuStream) {
                  this.netplay.sfuStream.getTracks().forEach((t) => {
                    if (t && t.kind === "audio") {
                      try {
                        this.netplay.sfuStream.removeTrack(t);
                      } catch (e) {}
                    }
                  });
                }
              } catch (e) {}

              // Allow re-consuming this producer id.
              try {
                if (producerId && this.netplay.sfuConsumedProducerIds) {
                  this.netplay.sfuConsumedProducerIds.delete(producerId);
                }
              } catch (e) {}

              // Re-consume the same producer id if we know it.
              try {
                if (
                  producerId &&
                  typeof this.netplayConsumeSFUProducer === "function"
                ) {
                  await this.netplayConsumeSFUProducer(producerId);
                }
              } catch (e) {
                console.warn(
                  "[Netplay][SFU] Client audio re-consume failed",
                  e
                );
              }

              // Nudge playback in case the element got stuck.
              try {
                const el =
                  this.netplay && (this.netplay.audioEl || this.netplay.video);
                if (el && typeof el.play === "function") {
                  await el.play().catch(() => null);
                }
              } catch (e) {}
            } finally {
              try {
                const health =
                  this.netplay && this.netplay._ejsClientAudioHealth;
                if (health) {
                  health.recovering = false;
                  health.lastBytesReceived = null;
                  health.lastChangeAt = Date.now();
                }
              } catch (e) {}
            }
          };

          this.netplay._ejsClientAudioHealthTimer = setInterval(async () => {
            try {
              if (!this.netplay || !this.isNetplay) return;
              if (this.netplay.owner) return;
              if (!this.netplay.useSFU) return;

              const c = this.netplay.audioConsumer;
              if (!c || c.closed) return;
              if (typeof c.getStats !== "function") return;

              // If the video element isn't playing yet (autoplay policies),
              // don't treat this as an audio stall.
              const v =
                this.netplay && (this.netplay.audioEl || this.netplay.video);
              if (v && v.paused && v.readyState >= 2) {
                // Try a periodic play() nudge.
                const now = Date.now();
                if (
                  !this.netplay._ejsLastPlayNudgeAt ||
                  now - this.netplay._ejsLastPlayNudgeAt > 15000
                ) {
                  this.netplay._ejsLastPlayNudgeAt = now;
                  try {
                    await v.play();
                  } catch (e) {}
                }
                return;
              }

              const now = Date.now();
              const health = this.netplay._ejsClientAudioHealth;
              if (
                health &&
                health.lastCheckedAt &&
                now - health.lastCheckedAt < 2500
              )
                return;
              if (health) health.lastCheckedAt = now;

              const stats = await c.getStats().catch(() => null);
              const bytes =
                typeof this._ejsExtractInboundAudioBytesReceived === "function"
                  ? this._ejsExtractInboundAudioBytesReceived(stats)
                  : null;
              if (typeof bytes !== "number") return;

              if (health.lastBytesReceived === null) {
                health.lastBytesReceived = bytes;
                health.lastChangeAt = now;
                return;
              }

              if (bytes > health.lastBytesReceived) {
                health.lastBytesReceived = bytes;
                health.lastChangeAt = now;
                return;
              }

              // No inbound progress for a while: attempt recovery.
              if (now - health.lastChangeAt > 12000) {
                await this.netplay._ejsAttemptClientSfuAudioRecovery(
                  "consumer-stalled"
                );
              }
            } catch (e) {
              // ignore
            }
          }, 5000);
        } catch (e) {
          // ignore
        }
      };
    }

    // Client-side SFU audio silence detection: bytes can keep flowing while the
    // rendered audio gets stuck silent (common on some mobile browsers).
    // Use an analyser to detect prolonged silence and trigger a re-consume.
    if (typeof this._ejsEnsureClientSfuAudioSilenceMonitor !== "function") {
      this._ejsEnsureClientSfuAudioSilenceMonitor = () => {
        try {
          if (!this.netplay || !this.isNetplay) return;
          if (this.netplay.owner) return;
          if (!this.netplay.useSFU) return;
          if (this.netplay._ejsClientAudioSilenceTimer) return;

          const silenceMs =
            typeof window !== "undefined" &&
            typeof window.EJS_NETPLAY_AUDIO_SILENCE_MS === "number" &&
            window.EJS_NETPLAY_AUDIO_SILENCE_MS > 0
              ? window.EJS_NETPLAY_AUDIO_SILENCE_MS
              : 25000;
          const rmsThreshold =
            typeof window !== "undefined" &&
            typeof window.EJS_NETPLAY_AUDIO_SILENCE_RMS === "number" &&
            window.EJS_NETPLAY_AUDIO_SILENCE_RMS > 0
              ? window.EJS_NETPLAY_AUDIO_SILENCE_RMS
              : 0.003;

          this.netplay._ejsClientAudioSilence = {
            lastNonSilentAt: Date.now(),
            lastRecoverAt: 0,
            trackId: null,
            ctx: null,
            analyser: null,
            data: null,
            source: null,
          };

          const ensureGraph = (stream, trackId) => {
            const st = this.netplay._ejsClientAudioSilence;
            if (!st) return false;

            if (st.trackId === trackId && st.ctx && st.analyser && st.data) {
              return true;
            }

            // Tear down any prior graph.
            try {
              if (st.source) st.source.disconnect();
            } catch (e) {}
            try {
              if (st.analyser) st.analyser.disconnect();
            } catch (e) {}
            st.source = null;
            st.analyser = null;
            st.data = null;
            st.trackId = trackId;

            try {
              const AC = window.AudioContext || window.webkitAudioContext;
              if (typeof AC !== "function") return false;
              if (!st.ctx || st.ctx.state === "closed") {
                st.ctx = new AC({ latencyHint: "interactive" });
              }
              st.analyser = st.ctx.createAnalyser();
              st.analyser.fftSize = 2048;
              st.data = new Uint8Array(st.analyser.fftSize);
              st.source = st.ctx.createMediaStreamSource(stream);
              st.source.connect(st.analyser);
              st.lastNonSilentAt = Date.now();
              return true;
            } catch (e) {
              return false;
            }
          };

          const measureRms = () => {
            const st = this.netplay._ejsClientAudioSilence;
            if (!st || !st.analyser || !st.data) return null;
            try {
              st.analyser.getByteTimeDomainData(st.data);
              let sumSq = 0;
              for (let i = 0; i < st.data.length; i++) {
                const v = (st.data[i] - 128) / 128;
                sumSq += v * v;
              }
              return Math.sqrt(sumSq / st.data.length);
            } catch (e) {
              return null;
            }
          };

          this.netplay._ejsClientAudioSilenceTimer = setInterval(async () => {
            try {
              if (!this.netplay || !this.isNetplay) return;
              if (this.netplay.owner) return;
              if (!this.netplay.useSFU) return;

              const a = this.netplay.audioEl;
              if (a) {
                // If it got paused, nudge play.
                if (a.paused && a.readyState >= 2) {
                  try {
                    await a.play();
                  } catch (e) {}
                  return;
                }
                // If user muted/volume=0, don't treat silence as a failure.
                if (a.muted || a.volume === 0) return;
              }

              const stream =
                this.netplay.sfuAudioStream || this.netplay.sfuStream;
              const track =
                stream && stream.getAudioTracks
                  ? stream.getAudioTracks()[0]
                  : null;
              if (!track) return;

              // Only run silence detection when bytes are still flowing (otherwise
              // the bytesReceived stall monitor should handle it).
              const health = this.netplay._ejsClientAudioHealth;
              const now = Date.now();
              if (!health || !health.lastChangeAt) return;
              if (now - health.lastChangeAt > 8000) return;

              const ok = ensureGraph(stream, track.id);
              if (!ok) return;

              const st = this.netplay._ejsClientAudioSilence;
              if (st && st.ctx && st.ctx.state === "suspended") {
                try {
                  await st.ctx.resume();
                } catch (e) {}
              }

              const rms = measureRms();
              if (typeof rms === "number" && rms > rmsThreshold) {
                if (st) st.lastNonSilentAt = now;
                return;
              }

              if (!st) return;
              if (now - st.lastNonSilentAt < silenceMs) return;
              if (st.lastRecoverAt && now - st.lastRecoverAt < 20000) return;

              st.lastRecoverAt = now;
              st.lastNonSilentAt = now;
              if (
                this.netplay &&
                typeof this.netplay._ejsAttemptClientSfuAudioRecovery ===
                  "function"
              ) {
                await this.netplay._ejsAttemptClientSfuAudioRecovery(
                  "silence-detected"
                );
              }
            } catch (e) {
              // ignore
            }
          }, 2000);
        } catch (e) {
          // ignore
        }
      };
    }

    function guidGenerator() {
      const S4 = function () {
        return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
      };
      return (
        S4() +
        S4() +
        "-" +
        S4() +
        "-" +
        S4() +
        "-" +
        S4() +
        "-" +
        S4() +
        S4() +
        S4()
      );
    }
    this.getNativeResolution = function () {
      if (this.Module && this.Module.getNativeResolution) {
        try {
          const res = this.Module.getNativeResolution();
          console.log("Native resolution from Module:", res);
          return res;
        } catch (error) {
          console.error("Failed to get native resolution:", error);
          return {
            width: 640,
            height: 480,
          };
        }
      }
      return {
        width: 640,
        height: 480,
      };
    };

    this.netplayGetUserIndex = function () {
      if (!this.isNetplay || !this.netplay.players || !this.netplay.playerID) {
        console.warn(
          "netplayGetUserIndex: Netplay not active or players/playerID undefined"
        );
        return 0;
      }
      const playerIds = Object.keys(this.netplay.players);
      const index = playerIds.indexOf(this.netplay.playerID);
      return index === -1 ? 0 : index;
    };

    this.netplay.simulateInput = (player, index, value) => {
      console.log("netplay.simulateInput called:", {
        player,
        index,
        value,
        playerIndex: this.netplayGetUserIndex(),
      });
      if (
        !this.isNetplay ||
        !this.gameManager ||
        !this.gameManager.functions ||
        !this.gameManager.functions.simulateInput
      ) {
        console.error(
          "Cannot simulate input: Netplay not active or gameManager.functions.simulateInput undefined"
        );
        return;
      }
      let playerIndex = parseInt(player, 10);
      if (isNaN(playerIndex)) playerIndex = 0;
      if (playerIndex < 0) playerIndex = 0;
      if (playerIndex > 3) playerIndex = 3;

      // Client slot enforcement: use the lobby-selected slot for outgoing inputs.
      // (Some client code paths send inputs via netplaySendMessage("sync-control")
      // instead of the SFU datachannel hook.)
      if (this.netplay && !this.netplay.owner) {
        try {
          const slotRaw =
            this.netplay.localSlot ??
            this.netplayPreferredSlot ??
            window.EJS_NETPLAY_PREFERRED_SLOT ??
            0;
          let slot = parseInt(slotRaw, 10);
          if (!isNaN(slot)) {
            if (slot < 0) slot = 0;
            if (slot > 3) slot = 3;
            playerIndex = slot;
          }
        } catch (e) {
          // ignore
        }
      }
      let frame = this.netplay.currentFrame || 0;
      if (this.netplay.owner) {
        if (!this.netplay.inputsData[frame])
          this.netplay.inputsData[frame] = [];
        this.netplay.inputsData[frame].push({
          frame: frame,
          connected_input: [playerIndex, index, value],
        });
        this.gameManager.functions.simulateInput(playerIndex, index, value);
      } else {
        this.gameManager.functions.simulateInput(playerIndex, index, value);
        if (this.netplaySendMessage) {
          this.netplaySendMessage({
            "sync-control": [
              {
                frame: frame + 20,
                connected_input: [playerIndex, index, value],
              },
            ],
          });
        } else {
          console.error("netplaySendMessage is undefined");
        }
      }
    };

    this.netplayUpdateTableList = async () => {
      if (!this.netplay || !this.netplay.table) {
        console.error("netplay or netplay.table is undefined");
        return;
      }

      const addToTable = (id, name, current, max, hasPassword) => {
        const row = this.createElement("tr");
        row.classList.add("ejs_netplay_table_row");
        const addCell = (text) => {
          const item = this.createElement("td");
          item.innerText = text;
          item.style.padding = "10px 0";
          item.style["text-align"] = "center";
          row.appendChild(item);
          return item;
        };
        addCell(name).style["text-align"] = "left";
        addCell(current + "/" + max).style.width = "80px";
        const parent = addCell("");
        parent.style.width = "80px";
        this.netplay.table.appendChild(row);

        if (current < max) {
          const join = this.createElement("button");
          join.classList.add("ejs_netplay_join_button", "ejs_button_button");
          join.style["background-color"] = "rgba(var(--ejs-primary-color),1)";
          join.innerText = this.localization("Join");
          parent.appendChild(join);

          this.addEventListener(join, "click", () => {
            if (hasPassword) {
              let password = prompt("Please enter the room password:");
              if (password !== null) {
                password = password.trim();
                this.netplayJoinRoom(id, name, max, password);
              }
            } else {
              this.netplayJoinRoom(id, name, max, null);
            }
          });
        }
      };

      try {
        const open = await this.netplayGetOpenRooms();
        this.netplay.table.innerHTML = "";
        for (const k in open) {
          addToTable(
            k,
            open[k].room_name,
            open[k].current,
            open[k].max,
            open[k].hasPassword
          );
        }
      } catch (e) {
        console.error("Could not update room list:", e);
      }
    };

    this.netplayGetOpenRooms = async () => {
      if (!this.netplay.url) {
        console.error("netplay.url is undefined");
        return {};
      }
      try {
        const response = await fetch(
          this.netplay.url +
            "/list?domain=" +
            window.location.host +
            "&game_id=" +
            this.config.gameId
        );
        const data = await response.text();
        console.log("Fetched open rooms:", data);
        const parsed = JSON.parse(data);
        // Normalize response formats: server may return either an object mapping
        // roomName -> info, or { rooms: [ { room_name, players, maxPlayers, hasPassword } ] }
        if (parsed && parsed.rooms && Array.isArray(parsed.rooms)) {
          const out = {};
          for (const r of parsed.rooms) {
            const name = r.room_name || r.name || "";
            out[name] = {
              room_name: r.room_name || name,
              current: r.players || r.current || 0,
              max: r.maxPlayers || r.max || 0,
              hasPassword: !!r.hasPassword,
            };
          }
          return out;
        }
        return parsed || {};
      } catch (error) {
        console.error("Error fetching open rooms:", error);

        // for room listings, attempt token refresh on any error.
        // Should be safe because token refresh is idempotent.
        if (window.handleSfuAuthError) {
          console.log("Room listing failed, attempting token refresh...");
          window.handleSfuAuthError("read");
        }

        return {};
      }
    };

    this.netplayUpdateListStart = () => {
      if (!this.netplayUpdateTableList) {
        console.error("netplayUpdateTableList is undefined");
        return;
      }
      this.netplay.updateListInterval = setInterval(
        this.netplayUpdateTableList.bind(this),
        1000
      );
    };

    this.netplayUpdateListStop = () => {
      clearInterval(this.netplay.updateListInterval);
    };

    this.netplayShowOpenRoomDialog = () => {
      if (
        !this.createSubPopup ||
        !this.createElement ||
        !this.localization ||
        !this.addEventListener
      ) {
        console.error(
          "Required methods for netplayShowOpenRoomDialog are undefined"
        );
        return;
      }
      this.originalControls = JSON.parse(JSON.stringify(this.controls));
      const popups = this.createSubPopup();
      this.netplayMenu.appendChild(popups[0]);
      popups[1].classList.add("ejs_cheat_parent");
      const popup = popups[1];

      const header = this.createElement("div");
      const title = this.createElement("h2");
      title.innerText = this.localization("Create a room");
      title.classList.add("ejs_netplay_name_heading");
      header.appendChild(title);
      popup.appendChild(header);

      const main = this.createElement("div");
      main.classList.add("ejs_netplay_header");
      const rnhead = this.createElement("strong");
      rnhead.innerText = this.localization("Room Name");
      const rninput = this.createElement("input");
      rninput.type = "text";
      rninput.setAttribute("maxlength", "20");

      const maxhead = this.createElement("strong");
      maxhead.innerText = this.localization("Max Players");
      const maxinput = this.createElement("select");
      const playerCounts = ["2", "3", "4"];
      playerCounts.forEach((count) => {
        const option = this.createElement("option");
        option.value = count;
        option.innerText = count;
        option.classList.add("option-enabled");
        maxinput.appendChild(option);
      });

      const pwhead = this.createElement("strong");
      pwhead.innerText = this.localization("Password (optional)");
      const pwinput = this.createElement("input");
      pwinput.type = "text";
      pwinput.setAttribute("maxlength", "20");

      main.appendChild(rnhead);
      main.appendChild(this.createElement("br"));
      main.appendChild(rninput);
      main.appendChild(maxhead);
      main.appendChild(this.createElement("br"));
      main.appendChild(maxinput);
      main.appendChild(pwhead);
      main.appendChild(this.createElement("br"));
      main.appendChild(pwinput);
      popup.appendChild(main);

      popup.appendChild(this.createElement("br"));
      const submit = this.createElement("button");
      submit.classList.add("ejs_button_button", "ejs_popup_submit");
      submit.style["background-color"] = "rgba(var(--ejs-primary-color),1)";
      submit.style.margin = "0 10px";
      submit.innerText = this.localization("Submit");
      popup.appendChild(submit);
      this.addEventListener(submit, "click", () => {
        console.log("Submit button clicked");
        if (!rninput.value.trim()) {
          console.log("Room name is empty, aborting");
          return;
        }
        const roomName = rninput.value.trim();
        const maxPlayers = parseInt(maxinput.value);
        const password = pwinput.value.trim();
        console.log("Creating room with:", {
          roomName,
          maxPlayers,
          password,
        });
        this.netplayOpenRoom(roomName, maxPlayers, password);
        popups[0].remove();
      });
      const close = this.createElement("button");
      close.classList.add("ejs_button_button", "ejs_popup_submit");
      close.style.margin = "0 10px";
      close.innerText = this.localization("Close");
      popup.appendChild(close);
      this.addEventListener(close, "click", () => popups[0].remove());
    };

    this.netplayInitWebRTCStream = async () => {
      if (this.netplay.localStream) {
        console.log("netplayInitWebRTCStream: localStream already present");
        return true;
      }
      console.log("Initializing WebRTC stream for owner...");
      const { width: nativeWidth, height: nativeHeight } =
        this.getNativeResolution();
      if (this.canvas) {
        this.canvas.width = nativeWidth;
        this.canvas.height = nativeHeight;
      }
      if (this.netplay.owner && this.Module && this.Module.setCanvasSize) {
        this.Module.setCanvasSize(nativeWidth, nativeHeight);
        console.log("Set emulator canvas size to native:", {
          width: nativeWidth,
          height: nativeHeight,
        });
      }

      // Some Emscripten cores set inline CSS pixel sizes when setCanvasSize()
      // is called, which can cause the canvas to overflow/clamp off-screen in
      // responsive layouts.
      //
      // IMPORTANT: Netplay may already be using a pixel-based aspect fitter
      // (see this._netplayResizeCanvas) which is triggered on resize/fullscreen.
      // Do NOT force width/height=100% here or we will temporarily override the
      // fitter until the next resize event.
      if (this.canvas && this.canvas.style) {
        Object.assign(this.canvas.style, {
          maxWidth: "100%",
          maxHeight: "100%",
          display: "block",
          objectFit: "contain",
          objectPosition: "center",
        });

        // First-time netplay init can be affected by delayed inline styles from
        // the core/runtime (e.g. position:fixed/absolute + transforms). That
        // can shift the canvas off-screen until the user triggers a resize.
        // Normalize alignment without touching width/height (the aspect fitter
        // owns those).
        const normalizeOwnerCanvasAlignment = () => {
          try {
            if (!this.netplay || !this.netplay.owner || !this.canvas) return;
            Object.assign(this.canvas.style, {
              position: "relative",
              top: "0",
              left: "0",
              right: "auto",
              bottom: "auto",
              transform: "none",
              marginLeft: "auto",
              marginRight: "auto",
            });
          } catch (e) {
            // ignore
          }
        };
        normalizeOwnerCanvasAlignment();
        if (typeof window !== "undefined" && window.requestAnimationFrame) {
          window.requestAnimationFrame(normalizeOwnerCanvasAlignment);
        }
        setTimeout(normalizeOwnerCanvasAlignment, 50);
        setTimeout(normalizeOwnerCanvasAlignment, 250);
        setTimeout(normalizeOwnerCanvasAlignment, 1000);

        if (typeof this._netplayResizeCanvas === "function") {
          try {
            this._netplayResizeCanvas();
            // Layout may not be settled yet; re-run shortly.
            if (typeof window !== "undefined" && window.requestAnimationFrame) {
              window.requestAnimationFrame(() => {
                if (typeof this._netplayResizeCanvas === "function") {
                  this._netplayResizeCanvas();
                }
              });
            }
            setTimeout(() => {
              if (typeof this._netplayResizeCanvas === "function") {
                this._netplayResizeCanvas();
              }
            }, 150);
          } catch (e) {
            // ignore
          }
        }
      }

      // Wait for the emulator canvas to have non-zero layout size before
      // attempting to capture it. Some browsers / Emscripten setups may
      // temporarily report 0x0 while the core initializes or the DOM
      // layout is updated, which causes repeated "Could not get screen
      // dimensions" errors and broken capture.
      const waitForCanvasSize = async (timeout = 3000, interval = 100) => {
        const start = Date.now();
        while (
          (this.canvas.clientWidth === 0 || this.canvas.clientHeight === 0) &&
          Date.now() - start < timeout
        ) {
          await new Promise((r) => setTimeout(r, interval));
        }
        return this.canvas.clientWidth > 0 && this.canvas.clientHeight > 0;
      };

      const hasSize = await waitForCanvasSize(3000, 100);
      if (!hasSize) {
        console.warn(
          "Canvas reported zero layout size after wait; falling back to native resolution"
        );
        // Ensure canvas logical size is set from native resolution so
        // captureStream has sensible dimensions even if layout is zero.
        const { width: fallbackW, height: fallbackH } =
          this.getNativeResolution() || { width: 640, height: 480 };
        this.canvas.width = fallbackW;
        this.canvas.height = fallbackH;
      }

      // Try capture with retries because some cores may briefly report
      // invalid canvas state while initializing. Return true on success.
      let stream = null;
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // Prefer capturing directly from the emulator canvas.
        // Some cores render via WebGL, and copying into a 2D canvas can result
        // in black frames. The helper will still fall back to a copy-canvas
        // when the canvas has 0x0 size.
        stream = this.collectScreenRecordingMediaTracks(this.canvas, 30);
        if (stream && stream.getTracks().length) break;
        console.warn(`capture attempt ${attempt} failed; retrying...`);
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
      if (!stream || !stream.getTracks().length) {
        console.error("Failed to capture stream after retries:", stream);
        this.displayMessage("Failed to initialize video stream", 5000);
        return false;
      }
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        // Always prefer native capture resolution. Simulcast encodings handle
        // downscaling; forcing 1280x720 here would make "High" non-native.
        const targetW = nativeWidth;
        const targetH = nativeHeight;
        videoTrack
          .applyConstraints({
            width: {
              ideal: targetW,
            },
            height: {
              ideal: targetH,
            },
            frameRate: {
              ideal: 30,
              max: 30,
            },
          })
          .catch((err) => console.error("Constraint error:", err));
        console.log("Track settings:", videoTrack.getSettings());
      }
      stream.getTracks().forEach((track) => {
        console.log("Track:", {
          kind: track.kind,
          enabled: track.enabled,
          muted: track.muted,
        });
        track.onmute = () => console.warn("Track muted:", track.id);
        track.onended = () => console.warn("Track ended:", track.id);
      });
      this.netplay.localStream = stream;
      console.log("netplayInitWebRTCStream: localStream initialized", {
        id: stream.id,
      });

      // After successfully acquiring the capture stream, request an immediate
      // layout re-fit. Some embeds rely on the app's global resize handler
      // (not the netplay fitter) to update the canvas buffer dimensions.
      // Without this, the host can remain at the native 640x480 buffer size
      // until the user manually resizes the window.
      try {
        const requestHostCanvasRelayout = () => {
          try {
            if (typeof this._netplayResizeCanvas === "function") {
              this._netplayResizeCanvas();
            }
          } catch (e) {
            // ignore
          }
          try {
            if (typeof window !== "undefined" && window.dispatchEvent) {
              window.dispatchEvent(new Event("resize"));
            }
          } catch (e) {
            // ignore
          }
        };
        requestHostCanvasRelayout();
        if (typeof window !== "undefined" && window.requestAnimationFrame) {
          window.requestAnimationFrame(requestHostCanvasRelayout);
        }
        setTimeout(requestHostCanvasRelayout, 50);
        setTimeout(requestHostCanvasRelayout, 250);
      } catch (e) {
        // ignore
      }

      // Helper to re-create SFU producers from a fresh capture.
      // Used on resume to recover from capture tracks that can freeze after pause.
      this.netplayReproduceHostVideoToSFU = async (reason = "unknown") => {
        try {
          if (!this.netplay || !this.netplay.owner || !this.netplay.useSFU)
            return false;

          const now = Date.now();
          if (
            this.netplay._lastSFUReproduceAt &&
            now - this.netplay._lastSFUReproduceAt < 1500
          )
            return false;
          this.netplay._lastSFUReproduceAt = now;

          console.log("[Netplay] Reproducing SFU media from capture", {
            reason,
          });

          const oldStream = this.netplay.localStream;

          const refreshed = this.collectScreenRecordingMediaTracks(
            this.canvas,
            30
          );
          if (!refreshed || !refreshed.getTracks().length) {
            console.error(
              "[Netplay] Failed to re-capture stream for SFU",
              refreshed
            );
            return false;
          }
          const videoTrack = refreshed.getVideoTracks()[0];
          const audioTrack = refreshed.getAudioTracks()[0];

          try {
            this.netplay._ejsHostAudioTrack = audioTrack || null;
          } catch (e) {
            // ignore
          }

          try {
            if (
              typeof this._ejsAttachHostAudioRecoveryHandlers === "function"
            ) {
              this._ejsAttachHostAudioRecoveryHandlers(refreshed, "reproduce");
            }
            if (
              typeof this._ejsEnsureHostAudioProducerHealthMonitor ===
              "function"
            ) {
              this._ejsEnsureHostAudioProducerHealthMonitor();
            }
          } catch (e) {
            // ignore
          }

          if (!this.netplay.sendTransport) {
            await this.netplayCreateSFUTransports();
          }

          if (!this.netplay.sendTransport) {
            console.warn("[Netplay] Cannot re-produce: sendTransport missing");
            return false;
          }

          const forceReproduceVideo =
            typeof reason === "string" &&
            (reason.includes("codec") || reason.includes("svc"));

          if (videoTrack) {
            const existing = this.netplay.producer;
            if (
              existing &&
              !existing.closed &&
              !forceReproduceVideo &&
              typeof existing.replaceTrack === "function"
            ) {
              await existing.replaceTrack({ track: videoTrack });
              console.log("[Netplay] Replaced SFU video track (replaceTrack)");
            } else {
              if (existing) {
                try {
                  existing.close();
                } catch (e) {}
                this.netplay.producer = null;
              }

              const produceParams = {
                track: videoTrack,
              };
              let preferredCodec = null;
              try {
                preferredCodec =
                  typeof this.netplayPickSFUVideoCodec === "function"
                    ? this.netplayPickSFUVideoCodec()
                    : null;
                if (preferredCodec) produceParams.codec = preferredCodec;
              } catch (e) {}

              const codecMime =
                preferredCodec && typeof preferredCodec.mimeType === "string"
                  ? preferredCodec.mimeType.toLowerCase()
                  : "";
              const wantsVP9 = codecMime === "video/vp9";
              const simulcastEnabled =
                this.netplaySimulcastEnabled === true ||
                window.EJS_NETPLAY_SIMULCAST === true;

              if (wantsVP9) {
                const normalizeVP9SVCMode = (v) => {
                  const s = typeof v === "string" ? v.trim() : "";
                  const sl = s.toLowerCase();
                  if (sl === "l1t1") return "L1T1";
                  if (sl === "l1t3") return "L1T3";
                  if (sl === "l2t3") return "L2T3";
                  return "L1T1";
                };
                const svcMode = normalizeVP9SVCMode(
                  this.netplayVP9SVCMode ||
                    window.EJS_NETPLAY_VP9_SVC_MODE ||
                    "L1T1"
                );
                produceParams.encodings = [
                  {
                    scalabilityMode: svcMode,
                    dtx: false,
                  },
                ];
                produceParams.appData = Object.assign(
                  {},
                  produceParams.appData,
                  {
                    ejsSVC: true,
                    ejsScalabilityMode: svcMode,
                  }
                );
              } else if (simulcastEnabled) {
                produceParams.encodings = [
                  {
                    rid: "h",
                    scaleResolutionDownBy: 1,
                    maxBitrate: 2500000,
                  },
                  {
                    rid: "l",
                    scaleResolutionDownBy: 2,
                    maxBitrate: 900000,
                  },
                ];
                produceParams.appData = {
                  ejsSimulcast: true,
                  ejsLayers: ["high", "low"],
                };
              }

              this.netplay.producer = await this.netplay.sendTransport.produce(
                produceParams
              );
              console.log(
                "[Netplay] Produced video to SFU (reproduce), id=",
                this.netplay.producer.id
              );
            }
          } else {
            console.warn("[Netplay] No video track available to re-produce");
          }

          if (audioTrack) {
            const existingAudio = this.netplay.audioProducer;
            if (
              existingAudio &&
              !existingAudio.closed &&
              typeof existingAudio.replaceTrack === "function"
            ) {
              await existingAudio.replaceTrack({ track: audioTrack });
              console.log("[Netplay] Replaced SFU audio track (replaceTrack)");
            } else {
              if (existingAudio) {
                try {
                  existingAudio.close();
                } catch (e) {}
                this.netplay.audioProducer = null;
              }
              this.netplay.audioProducer =
                await this.netplay.sendTransport.produce({ track: audioTrack });
              console.log(
                "[Netplay] Produced audio to SFU (reproduce), id=",
                this.netplay.audioProducer.id
              );
            }
            try {
              if (
                typeof this._ejsEnsureHostAudioProducerHealthMonitor ===
                "function"
              ) {
                this._ejsEnsureHostAudioProducerHealthMonitor();
              }
            } catch (e) {
              // ignore
            }
          } else {
            console.warn("[Netplay] No audio track available to re-produce");
          }

          // Swap streams only after the producers are updated, to avoid a brief
          // drop while we stop old tracks.
          this.netplay.localStream = refreshed;
          try {
            if (oldStream && oldStream.getTracks) {
              oldStream.getTracks().forEach((t) => {
                try {
                  if (typeof t._ejsAudioCaptureCleanup === "function") {
                    t._ejsAudioCaptureCleanup();
                  }
                } catch (e) {}
                try {
                  t.stop();
                } catch (e) {}
              });
            }
          } catch (e) {
            // ignore
          }
          return true;
        } catch (e) {
          console.error("[Netplay] Failed to reproduce SFU video", e);
          return false;
        }
      };

      // Audio-only SFU recovery: refresh just the audio producer.
      // This avoids jarring video resets when only audio stalls.
      this.netplayReproduceHostAudioToSFU = async (reason = "unknown") => {
        try {
          if (!this.netplay || !this.netplay.owner || !this.netplay.useSFU)
            return false;

          const now = Date.now();
          if (
            this.netplay._lastSFUAudioReproduceAt &&
            now - this.netplay._lastSFUAudioReproduceAt < 8000
          )
            return false;
          this.netplay._lastSFUAudioReproduceAt = now;

          console.log("[Netplay] Reproducing SFU audio from capture", {
            reason,
          });

          const refreshed =
            this.collectScreenRecordingMediaTracks(this.canvas, 30, {
              audioOnly: true,
            }) || this.collectScreenRecordingMediaTracks(this.canvas, 30);
          if (!refreshed || !refreshed.getTracks().length) return false;
          const audioTrack =
            refreshed.getAudioTracks && refreshed.getAudioTracks()[0];
          if (!audioTrack) return false;

          // Stop any prior audio-only capture track/graph.
          try {
            const prev = this.netplay._ejsHostAudioTrack;
            if (prev && prev !== audioTrack) {
              try {
                if (typeof prev._ejsAudioCaptureCleanup === "function") {
                  prev._ejsAudioCaptureCleanup();
                }
              } catch (e) {}
              try {
                prev.stop();
              } catch (e) {}
            }
          } catch (e) {
            // ignore
          }
          this.netplay._ejsHostAudioTrack = audioTrack;

          try {
            if (
              typeof this._ejsAttachHostAudioRecoveryHandlers === "function"
            ) {
              const ms = new MediaStream();
              ms.addTrack(audioTrack);
              this._ejsAttachHostAudioRecoveryHandlers(ms, "reproduce-audio");
            }
          } catch (e) {
            // ignore
          }

          if (!this.netplay.sendTransport) {
            await this.netplayCreateSFUTransports();
          }
          if (!this.netplay.sendTransport) return false;

          const existingAudio = this.netplay.audioProducer;
          if (
            existingAudio &&
            !existingAudio.closed &&
            typeof existingAudio.replaceTrack === "function"
          ) {
            await existingAudio.replaceTrack({ track: audioTrack });
            console.log("[Netplay] Replaced SFU audio track (replaceTrack)");
          } else {
            if (existingAudio) {
              try {
                existingAudio.close();
              } catch (e) {}
              this.netplay.audioProducer = null;
            }
            this.netplay.audioProducer =
              await this.netplay.sendTransport.produce({ track: audioTrack });
            console.log(
              "[Netplay] Produced audio to SFU (reproduce-audio), id=",
              this.netplay.audioProducer.id
            );
          }

          try {
            if (
              typeof this._ejsEnsureHostAudioProducerHealthMonitor ===
              "function"
            ) {
              this._ejsEnsureHostAudioProducerHealthMonitor();
            }
          } catch (e) {
            // ignore
          }

          return true;
        } catch (e) {
          console.error("[Netplay] Failed to reproduce SFU audio", e);
          return false;
        }
      };

      // Host-side audio recovery/monitoring.
      try {
        if (typeof this._ejsAttachHostAudioRecoveryHandlers === "function") {
          this._ejsAttachHostAudioRecoveryHandlers(stream, "initial");
        }
        if (
          typeof this._ejsEnsureHostAudioProducerHealthMonitor === "function"
        ) {
          this._ejsEnsureHostAudioProducerHealthMonitor();
        }
      } catch (e) {
        // ignore
      }

      // Install synthetic fallback if host video track mutes/ends
      try {
        const hostVideoTrack = stream.getVideoTracks()[0];
        if (hostVideoTrack) {
          const installSyntheticFallback = async () => {
            if (this.netplay.syntheticFallbackActive) return;
            console.warn(
              "Host video track lost frames - installing synthetic fallback"
            );
            this.netplay.syntheticFallbackActive = true;

            const { width: nw, height: nh } = this.getNativeResolution() || {
              width: 640,
              height: 480,
            };
            const canvas = document.createElement("canvas");
            canvas.width = nw;
            canvas.height = nh;
            canvas.style.display = "none";
            try {
              document.body.appendChild(canvas);
            } catch (e) {
              /* ignore */
            }
            const ctx = canvas.getContext("2d");
            let t = 0;
            const iv = setInterval(() => {
              try {
                ctx.fillStyle = `hsl(${t % 360} 60% 50%)`.replace(/ /g, "");
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                t += 6;
              } catch (e) {}
            }, 1000 / 30);

            const s = canvas.captureStream(30);
            this.netplay.synthetic = { canvas, interval: iv, stream: s };
            const ttrack = s.getVideoTracks()[0];
            try {
              if (!this.netplay.sendTransport)
                await this.netplayCreateSFUTransports();
              if (this.netplay.producer) {
                try {
                  this.netplay.producer.close();
                } catch (e) {}
              }
              const simulcast =
                this.netplaySimulcastEnabled === true ||
                window.EJS_NETPLAY_SIMULCAST === true;
              const produceParams = {
                track: ttrack,
              };
              let preferredCodec = null;
              try {
                preferredCodec =
                  typeof this.netplayPickSFUVideoCodec === "function"
                    ? this.netplayPickSFUVideoCodec()
                    : null;
                if (preferredCodec) produceParams.codec = preferredCodec;
              } catch (e) {}

              const codecMime =
                preferredCodec && typeof preferredCodec.mimeType === "string"
                  ? preferredCodec.mimeType.toLowerCase()
                  : "";
              const wantsVP9 = codecMime === "video/vp9";

              if (wantsVP9) {
                const normalizeVP9SVCMode = (v) => {
                  const s = typeof v === "string" ? v.trim() : "";
                  const sl = s.toLowerCase();
                  if (sl === "l1t1") return "L1T1";
                  if (sl === "l1t3") return "L1T3";
                  if (sl === "l2t3") return "L2T3";
                  return "L1T1";
                };
                const svcMode = normalizeVP9SVCMode(
                  this.netplayVP9SVCMode ||
                    window.EJS_NETPLAY_VP9_SVC_MODE ||
                    "L1T1"
                );
                produceParams.encodings = [
                  {
                    scalabilityMode: svcMode,
                    dtx: false,
                  },
                ];
                produceParams.appData = Object.assign(
                  {},
                  produceParams.appData,
                  {
                    ejsSVC: true,
                    ejsScalabilityMode: svcMode,
                  }
                );
              } else if (simulcast) {
                produceParams.encodings = [
                  {
                    rid: "h",
                    scaleResolutionDownBy: 1,
                    maxBitrate: 2500000,
                  },
                  {
                    rid: "l",
                    scaleResolutionDownBy: 2,
                    maxBitrate: 900000,
                  },
                ];
                produceParams.appData = {
                  ejsSimulcast: true,
                  ejsLayers: ["high", "low"],
                };
              }

              this.netplay.producer = await this.netplay.sendTransport.produce(
                produceParams
              );
              console.log(
                "Produced synthetic fallback to SFU, id=",
                this.netplay.producer.id
              );
            } catch (e) {
              console.error("Failed to produce synthetic fallback", e);
              clearInterval(iv);
              if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
              this.netplay.syntheticFallbackActive = false;
            }
          };

          const removeSyntheticFallback = async () => {
            if (!this.netplay.syntheticFallbackActive) return;
            console.log(
              "Original host track resumed - removing synthetic fallback"
            );
            this.netplay.syntheticFallbackActive = false;
            if (this.netplay.producer) {
              try {
                this.netplay.producer.close();
              } catch (e) {}
              this.netplay.producer = null;
            }
            if (this.netplay.synthetic) {
              try {
                clearInterval(this.netplay.synthetic.interval);
              } catch (e) {}
              try {
                if (
                  this.netplay.synthetic.canvas &&
                  this.netplay.synthetic.canvas.parentNode
                )
                  this.netplay.synthetic.canvas.parentNode.removeChild(
                    this.netplay.synthetic.canvas
                  );
              } catch (e) {}
              this.netplay.synthetic = null;
            }
            try {
              if (!this.netplay.sendTransport)
                await this.netplayCreateSFUTransports();
              const originalTrack = stream.getVideoTracks()[0];
              if (originalTrack) {
                const produceParams = {
                  track: originalTrack,
                };
                let preferredCodec = null;
                try {
                  preferredCodec =
                    typeof this.netplayPickSFUVideoCodec === "function"
                      ? this.netplayPickSFUVideoCodec()
                      : null;
                  if (preferredCodec) produceParams.codec = preferredCodec;
                } catch (e) {}

                const codecMime =
                  preferredCodec && typeof preferredCodec.mimeType === "string"
                    ? preferredCodec.mimeType.toLowerCase()
                    : "";
                const wantsVP9 = codecMime === "video/vp9";
                const simulcastEnabled =
                  this.netplaySimulcastEnabled === true ||
                  window.EJS_NETPLAY_SIMULCAST === true;

                if (wantsVP9) {
                  const normalizeVP9SVCMode = (v) => {
                    const s = typeof v === "string" ? v.trim() : "";
                    const sl = s.toLowerCase();
                    if (sl === "l1t1") return "L1T1";
                    if (sl === "l1t3") return "L1T3";
                    if (sl === "l2t3") return "L2T3";
                    return "L1T1";
                  };
                  const svcMode = normalizeVP9SVCMode(
                    this.netplayVP9SVCMode ||
                      window.EJS_NETPLAY_VP9_SVC_MODE ||
                      "L1T1"
                  );
                  produceParams.encodings = [
                    {
                      scalabilityMode: svcMode,
                      dtx: false,
                    },
                  ];
                  produceParams.appData = Object.assign(
                    {},
                    produceParams.appData,
                    {
                      ejsSVC: true,
                      ejsScalabilityMode: svcMode,
                    }
                  );
                } else if (simulcastEnabled) {
                  produceParams.encodings = [
                    {
                      rid: "h",
                      scaleResolutionDownBy: 1,
                      maxBitrate: 2500000,
                    },
                    {
                      rid: "l",
                      scaleResolutionDownBy: 2,
                      maxBitrate: 900000,
                    },
                  ];
                  produceParams.appData = {
                    ejsSimulcast: true,
                    ejsLayers: ["high", "low"],
                  };
                }

                this.netplay.producer =
                  await this.netplay.sendTransport.produce(produceParams);
                console.log(
                  "Re-produced original host track to SFU, id=",
                  this.netplay.producer.id
                );
              }
            } catch (e) {
              console.error("Failed to re-produce original track", e);
            }
          };

          hostVideoTrack.onmute = () => {
            console.warn("Host video track muted", hostVideoTrack.id);
            installSyntheticFallback();
          };
          hostVideoTrack.onended = () => {
            console.warn("Host video track ended", hostVideoTrack.id);
            installSyntheticFallback();
          };
          hostVideoTrack.onunmute = () => {
            console.log("Host video track unmuted", hostVideoTrack.id);
            removeSyntheticFallback();
          };
        }
      } catch (e) {
        console.warn("Failed to attach synthetic fallback handlers", e);
      }
      return true;
    };

    // Attempt to use SFU (mediasoup) for netplay. Falls back to peer-to-peer if unavailable.
    this.netplayAttemptSFU = async () => {
      if (!this.netplay.socket || !this.netplay.url) return false;
      if (this.netplay.useSFU !== undefined) return this.netplay.useSFU;
      try {
        const available = await new Promise((resolve) => {
          this.netplay.socket.emit("sfu-available", {}, (resp) =>
            resolve(resp && resp.available)
          );
        });
        if (!available) {
          this.netplay.useSFU = false;
          return false;
        }

        // Use a browser-provided `mediasoupClient` global (UMD/browser bundle).
        // Do NOT attempt to load the library from UNPKG here because many
        // of the package entry points are CommonJS and will throw
        // "exports is not defined" when executed in the browser.
        const mediasoupClient =
          window.mediasoupClient || window.mediasoup || null;
        if (!mediasoupClient) {
          console.warn(
            "mediasoup-client not available in browser; SFU disabled.\n" +
              "To enable SFU in-browser include a browser-compatible mediasoup-client bundle that sets `window.mediasoupClient`."
          );
          this.netplay.useSFU = false;
          return false;
        }

        this.netplay.mediasoupClient = mediasoupClient;
        this.netplay.device = new mediasoupClient.Device();

        // Request router RTP capabilities from server
        const routerRtpCapabilities = await new Promise((resolve, reject) => {
          this.netplay.socket.emit(
            "sfu-get-router-rtp-capabilities",
            {},
            (err, data) => {
              if (err) return reject(err);
              resolve(data);
            }
          );
        });

        // Keep for codec preference decisions.
        this.netplay.routerRtpCapabilities = routerRtpCapabilities;

        await this.netplay.device.load({ routerRtpCapabilities });

        // Helper used by SFU producers to select/force a video codec.
        // - If Host Codec is Auto: pick first supported codec in router order.
        // - If forced: pick that codec if supported, else fall back to Auto.
        this.netplayPickSFUVideoCodec = () => {
          try {
            const normalizeHostCodec = (v) => {
              const s = typeof v === "string" ? v.trim().toLowerCase() : "";
              if (s === "vp9" || s === "h264" || s === "vp8" || s === "auto")
                return s;
              return "auto";
            };
            const mode = normalizeHostCodec(
              (typeof this.netplayHostCodec === "string"
                ? this.netplayHostCodec
                : null) ||
                (typeof window.EJS_NETPLAY_HOST_CODEC === "string"
                  ? window.EJS_NETPLAY_HOST_CODEC
                  : null) ||
                "auto"
            );

            const routerCaps =
              (this.netplay && this.netplay.routerRtpCapabilities) || null;
            const routerCodecs =
              routerCaps && Array.isArray(routerCaps.codecs)
                ? routerCaps.codecs
                : [];

            // Preserve router order.
            const candidates = routerCodecs.filter((c) => {
              const mt = c && typeof c.mimeType === "string" ? c.mimeType : "";
              const mtl = mt.toLowerCase();
              if (!mtl.startsWith("video/")) return false;
              if (mtl === "video/rtx") return false;
              return (
                mtl === "video/vp9" ||
                mtl === "video/h264" ||
                mtl === "video/vp8"
              );
            });

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

            for (const c of candidates) {
              const mt = c && typeof c.mimeType === "string" ? c.mimeType : "";
              const mtl = mt.toLowerCase();
              if (supports(mtl)) return c;
            }
          } catch (e) {}
          return null;
        };

        this.netplay.useSFU = true;
        console.log("SFU available and mediasoup-client initialized");
        return true;
      } catch (err) {
        console.warn("SFU attempt failed:", err);
        this.netplay.useSFU = false;
        return false;
      }
    };

    // Create SFU transports for send/recv depending on role
    this.netplayCreateSFUTransports = async () => {
      // Ensure required pieces are present; wait briefly for socket/device to appear
      const waitFor = async (condFn, timeout = 5000, interval = 200) => {
        const t0 = Date.now();
        while (!condFn() && Date.now() - t0 < timeout) {
          await new Promise((r) => setTimeout(r, interval));
        }
        return condFn();
      };

      const ready = await waitFor(
        () =>
          this.netplay.useSFU &&
          this.netplay.device &&
          this.netplay.socket &&
          this.netplay.socket.connected,
        5000,
        200
      );
      if (!ready) {
        console.warn(
          "netplayCreateSFUTransports returning early (not ready):",
          {
            useSFU: this.netplay.useSFU,
            hasDevice: !!this.netplay.device,
            hasSocket: !!this.netplay.socket,
            socketConnected: !!(
              this.netplay.socket && this.netplay.socket.connected
            ),
          }
        );
        return;
      }
      try {
        const role = this.netplay.owner ? "send" : "recv";
        // Helper to request ICE restart from SFU server and apply to transport
        const requestSfuIceRestart = async (transport, transportId) => {
          try {
            if (!transport || !transportId) return false;
            if (!this.netplay || !this.netplay.socket) return false;
            if (!this.netplay.socket.connected) return false;
            if (transport.closed) return false;

            // Prevent duplicate restarts if connectionstatechange fires repeatedly.
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

            console.warn("[Netplay][SFU] Requesting ICE restart", {
              transportId,
              direction: transport.direction,
              connectionState: transport.connectionState,
            });

            const resp = await new Promise((resolve, reject) => {
              this.netplay.socket.emit(
                "sfu-restart-ice",
                { transportId },
                (err, data) => {
                  if (err) return reject(err);
                  resolve(data);
                }
              );
            });

            const iceParameters = resp && resp.iceParameters;
            if (!iceParameters) throw new Error("missing iceParameters");
            if (typeof transport.restartIce !== "function") {
              throw new Error("transport.restartIce not available");
            }

            await transport.restartIce({ iceParameters });
            console.warn("[Netplay][SFU] ICE restart completed", {
              transportId,
              direction: transport.direction,
            });
            return true;
          } catch (e) {
            console.warn("[Netplay][SFU] ICE restart failed", e);
            return false;
          } finally {
            try {
              transport._ejsIceRestartInProgress = false;
            } catch (e) {}
          }
        };

        const getSfuRetryTimerSeconds = () => {
          let secs =
            typeof this.netplayRetryConnectionTimerSeconds === "number"
              ? this.netplayRetryConnectionTimerSeconds
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
        };

        const clearDisconnectedRetryTimer = (transport) => {
          try {
            if (transport && transport._ejsDisconnectedRetryTimerId) {
              clearTimeout(transport._ejsDisconnectedRetryTimerId);
              transport._ejsDisconnectedRetryTimerId = null;
            }
          } catch (e) {}
        };

        const scheduleDisconnectedIceRestart = (transport, transportId) => {
          try {
            if (!transport || !transportId) return;
            if (transport.closed) return;
            if (transport._ejsIceRestartInProgress) return;
            if (transport._ejsDisconnectedRetryTimerId) return;

            const secs = getSfuRetryTimerSeconds();
            if (!secs) return;
            transport._ejsDisconnectedRetryTimerSeconds = secs;
            transport._ejsDisconnectedRetryTimerId = setTimeout(() => {
              try {
                transport._ejsDisconnectedRetryTimerId = null;
                if (transport.closed) return;
                if (transport.connectionState !== "disconnected") return;
                requestSfuIceRestart(transport, transportId);
              } catch (e) {}
            }, secs * 1000);
          } catch (e) {}
        };

        const transportInfo = await new Promise((resolve, reject) => {
          this.netplay.socket.emit(
            "sfu-create-transport",
            { direction: role },
            (err, info) => {
              if (err) return reject(err);
              resolve(info);
            }
          );
        });

        if (this.netplay.owner) {
          const sendTransport =
            this.netplay.device.createSendTransport(transportInfo);

          // If ICE fails (common on mobile network transitions), request an ICE restart
          // from the server and call transport.restartIce({ iceParameters }).
          sendTransport.on("connectionstatechange", (state) => {
            try {
              if (state === "failed") {
                clearDisconnectedRetryTimer(sendTransport);
                requestSfuIceRestart(sendTransport, transportInfo.id);
              } else if (state === "disconnected") {
                scheduleDisconnectedIceRestart(sendTransport, transportInfo.id);
              } else {
                clearDisconnectedRetryTimer(sendTransport);
              }
            } catch (e) {}
          });

          sendTransport.on(
            "connect",
            ({ dtlsParameters }, callback, errback) => {
              this.netplay.socket.emit(
                "sfu-connect-transport",
                { transportId: transportInfo.id, dtlsParameters },
                (err) => {
                  if (err) return errback(err);
                  callback();
                }
              );
            }
          );
          sendTransport.on(
            "produce",
            async ({ kind, rtpParameters }, callback, errback) => {
              this.netplay.socket.emit(
                "sfu-produce",
                { transportId: transportInfo.id, kind, rtpParameters },
                (err, id) => {
                  if (err) return errback(err);
                  callback({ id });
                }
              );
            }
          );
          this.netplay.sendTransport = sendTransport;
          console.log("Created sendTransport for SFU:", {
            id: transportInfo.id,
          });

          // If local stream already exists, attempt to produce immediately.
          if (this.netplay.localStream) {
            const videoTrack = this.netplay.localStream.getVideoTracks()[0];
            const audioTrack = this.netplay.localStream.getAudioTracks()[0];

            if (!this.netplay.producer && videoTrack) {
              try {
                const produceParams = {
                  track: videoTrack,
                };
                let preferredCodec = null;
                try {
                  preferredCodec =
                    typeof this.netplayPickSFUVideoCodec === "function"
                      ? this.netplayPickSFUVideoCodec()
                      : null;
                  if (preferredCodec) produceParams.codec = preferredCodec;
                } catch (e) {}

                const codecMime =
                  preferredCodec && typeof preferredCodec.mimeType === "string"
                    ? preferredCodec.mimeType.toLowerCase()
                    : "";
                const wantsVP9 = codecMime === "video/vp9";
                const simulcastEnabled =
                  this.netplaySimulcastEnabled === true ||
                  window.EJS_NETPLAY_SIMULCAST === true;

                if (wantsVP9) {
                  const normalizeVP9SVCMode = (v) => {
                    const s = typeof v === "string" ? v.trim() : "";
                    const sl = s.toLowerCase();
                    if (sl === "l1t1") return "L1T1";
                    if (sl === "l1t3") return "L1T3";
                    if (sl === "l2t3") return "L2T3";
                    return "L1T1";
                  };
                  const svcMode = normalizeVP9SVCMode(
                    this.netplayVP9SVCMode ||
                      window.EJS_NETPLAY_VP9_SVC_MODE ||
                      "L1T1"
                  );
                  produceParams.encodings = [
                    {
                      scalabilityMode: svcMode,
                      dtx: false,
                    },
                  ];
                  produceParams.appData = Object.assign(
                    {},
                    produceParams.appData,
                    {
                      ejsSVC: true,
                      ejsScalabilityMode: svcMode,
                    }
                  );
                } else if (simulcastEnabled) {
                  produceParams.encodings = [
                    {
                      rid: "h",
                      scaleResolutionDownBy: 1,
                      maxBitrate: 2500000,
                    },
                    {
                      rid: "l",
                      scaleResolutionDownBy: 2,
                      maxBitrate: 900000,
                    },
                  ];
                  produceParams.appData = {
                    ejsSimulcast: true,
                    ejsLayers: ["high", "low"],
                  };
                }

                this.netplay.producer = await sendTransport.produce(
                  produceParams
                );
                console.log(
                  "Produced video to SFU (immediate), id=",
                  this.netplay.producer.id
                );
                try {
                  console.log(
                    "Host track settings after produce:",
                    videoTrack.getSettings()
                  );
                } catch (e) {
                  console.warn("Could not read host track settings", e);
                }
              } catch (e) {
                console.error("Failed to produce video to SFU (immediate):", e);
              }
            }

            if (!this.netplay.audioProducer && audioTrack) {
              try {
                this.netplay.audioProducer = await sendTransport.produce({
                  track: audioTrack,
                });
                console.log(
                  "Produced audio to SFU (immediate), id=",
                  this.netplay.audioProducer.id
                );
              } catch (e) {
                console.error("Failed to produce audio to SFU (immediate):", e);
              }
            }
          }

          // SFU DataChannel relay (inputs): owner consumes data producers on a dedicated recv transport.
          if (!this.netplay.dataRecvTransport) {
            const dataTransportInfo = await new Promise((resolve, reject) => {
              this.netplay.socket.emit(
                "sfu-create-transport",
                { direction: "recv" },
                (err, info) => {
                  if (err) return reject(err);
                  resolve(info);
                }
              );
            });

            const dataRecvTransport =
              this.netplay.device.createRecvTransport(dataTransportInfo);

            dataRecvTransport.on("connectionstatechange", (state) => {
              try {
                if (state === "failed") {
                  clearDisconnectedRetryTimer(dataRecvTransport);
                  requestSfuIceRestart(dataRecvTransport, dataTransportInfo.id);
                } else if (state === "disconnected") {
                  scheduleDisconnectedIceRestart(
                    dataRecvTransport,
                    dataTransportInfo.id
                  );
                } else {
                  clearDisconnectedRetryTimer(dataRecvTransport);
                }
              } catch (e) {}
            });

            dataRecvTransport.on(
              "connect",
              ({ dtlsParameters }, callback, errback) => {
                this.netplay.socket.emit(
                  "sfu-connect-transport",
                  { transportId: dataTransportInfo.id, dtlsParameters },
                  (err) => {
                    if (err) return errback(err);
                    callback();
                  }
                );
              }
            );

            this.netplay.dataRecvTransport = dataRecvTransport;
            this.netplay.dataRecvTransportId = dataTransportInfo.id;
            this.netplay.sfuDataConsumedProducerIds = new Set();

            const handleRelayInputPayload = (payload) => {
              try {
                const msg =
                  typeof payload === "string"
                    ? payload
                    : payload && payload.data
                    ? payload.data
                    : payload;
                const text =
                  typeof msg === "string"
                    ? msg
                    : msg instanceof ArrayBuffer
                    ? new TextDecoder().decode(new Uint8Array(msg))
                    : null;
                if (!text) return;
                const data = JSON.parse(text);

                if (data && data.type === "host-left") {
                  this.displayMessage("Host left. Restarting...", 3000);
                  this.netplayLeaveRoom("host-left-sfu-data");
                  return;
                }

                const playerIndex = data.player;
                const applyInput = (idx, val) => {
                  const frame = this.netplay.currentFrame || 0;
                  if (!this.netplay.inputsData[frame]) {
                    this.netplay.inputsData[frame] = [];
                  }
                  this.netplay.inputsData[frame].push({
                    frame: frame,
                    connected_input: [playerIndex, idx, val],
                  });

                  if (
                    this.gameManager &&
                    this.gameManager.functions &&
                    this.gameManager.functions.simulateInput
                  ) {
                    // Apply remote input without being affected by host slot override.
                    const raw =
                      this.netplay && this.netplay._ejsRawSimulateInputFn;
                    if (typeof raw === "function") {
                      try {
                        this.netplay._ejsApplyingRemoteInput = true;
                        raw(playerIndex, idx, val);
                      } finally {
                        this.netplay._ejsApplyingRemoteInput = false;
                      }
                    } else {
                      this.gameManager.functions.simulateInput(
                        playerIndex,
                        idx,
                        val
                      );
                    }
                  }
                };

                // Snapshot packets (state array) are used when unordered retries are 0
                // so lost release packets are corrected by later packets.
                if (data && Array.isArray(data.state)) {
                  if (!this.netplay.remoteInputStates)
                    this.netplay.remoteInputStates = {};
                  const key = `sfu:${playerIndex}`;
                  const prev = Array.isArray(
                    this.netplay.remoteInputStates[key]
                  )
                    ? this.netplay.remoteInputStates[key]
                    : new Array(30).fill(0);
                  const next = new Array(30).fill(0);
                  for (let i = 0; i < 30; i++) {
                    const raw = data.state[i];
                    const v = parseInt(raw, 10);
                    next[i] = isNaN(v) ? 0 : v;
                    if (next[i] !== (prev[i] || 0)) {
                      applyInput(i, next[i]);
                    }
                  }
                  this.netplay.remoteInputStates[key] = next;
                  return;
                }

                applyInput(data.index, data.value);
              } catch (e) {
                console.warn("[Netplay][SFU] Failed to process relay input", e);
              }
            };

            const consumeDataProducerId = async (dataProducerId) => {
              try {
                if (!dataProducerId) return;
                if (!this.netplay || !this.netplay.useSFU) return;
                if (!this.netplay.device || !this.netplay.dataRecvTransport)
                  return;
                if (this.netplay.sfuDataConsumedProducerIds.has(dataProducerId))
                  return;
                this.netplay.sfuDataConsumedProducerIds.add(dataProducerId);

                const params = await new Promise((resolve, reject) => {
                  this.netplay.socket.emit(
                    "sfu-consume-data",
                    {
                      dataProducerId,
                      transportId: dataTransportInfo.id,
                    },
                    (err, p) => {
                      if (err) return reject(err);
                      resolve(p);
                    }
                  );
                });

                const dataConsumer = await dataRecvTransport.consumeData({
                  id: params.id,
                  dataProducerId: params.dataProducerId,
                  sctpStreamParameters: params.sctpStreamParameters,
                  label: params.label,
                  protocol: params.protocol,
                  appData: params.appData,
                });

                dataConsumer.on("message", (message) => {
                  handleRelayInputPayload(message);
                });

                console.log("[Netplay][SFU] Consumed dataProducer", {
                  dataProducerId,
                  dataConsumerId: dataConsumer.id,
                  label: dataConsumer.label,
                });
              } catch (e) {
                console.warn(
                  "[Netplay][SFU] Failed consuming dataProducer",
                  dataProducerId,
                  e
                );
              }
            };

            this.netplayConsumeSFUDataProducer = consumeDataProducerId;

            try {
              const existing = await new Promise((resolve, reject) => {
                this.netplay.socket.emit(
                  "sfu-get-data-producers",
                  {},
                  (err, list) => {
                    if (err) return reject(err);
                    resolve(list || []);
                  }
                );
              });
              for (const p of existing) {
                const id = p && (p.id || p.dataProducerId);
                if (id) await consumeDataProducerId(id);
              }
            } catch (e) {
              console.warn("[Netplay][SFU] Failed listing data producers", e);
            }
          }
        } else {
          const recvTransport =
            this.netplay.device.createRecvTransport(transportInfo);

          recvTransport.on("connectionstatechange", (state) => {
            try {
              if (state === "failed") {
                clearDisconnectedRetryTimer(recvTransport);
                requestSfuIceRestart(recvTransport, transportInfo.id);
              } else if (state === "disconnected") {
                scheduleDisconnectedIceRestart(recvTransport, transportInfo.id);
              } else {
                clearDisconnectedRetryTimer(recvTransport);
              }
            } catch (e) {}
          });

          recvTransport.on(
            "connect",
            ({ dtlsParameters }, callback, errback) => {
              this.netplay.socket.emit(
                "sfu-connect-transport",
                { transportId: transportInfo.id, dtlsParameters },
                (err) => {
                  if (err) return errback(err);
                  callback();
                }
              );
            }
          );
          this.netplay.recvTransport = recvTransport;
          console.log("Created recvTransport for SFU:", {
            id: transportInfo.id,
          });

          // SFU DataChannel relay (inputs): clients produce data on a dedicated send transport.
          try {
            const mode =
              (typeof this.netplayInputMode === "string" &&
                this.netplayInputMode) ||
              (typeof window.EJS_NETPLAY_INPUT_MODE === "string" &&
                window.EJS_NETPLAY_INPUT_MODE) ||
              "unorderedRelay";
            const usesRelay =
              mode === "orderedRelay" || mode === "unorderedRelay";
            if (usesRelay && !this.netplay.inputSendTransport) {
              const dataSendInfo = await new Promise((resolve, reject) => {
                this.netplay.socket.emit(
                  "sfu-create-transport",
                  { direction: "send" },
                  (err, info) => {
                    if (err) return reject(err);
                    resolve(info);
                  }
                );
              });

              const inputSendTransport =
                this.netplay.device.createSendTransport(dataSendInfo);

              inputSendTransport.on("connectionstatechange", (state) => {
                try {
                  if (state === "failed") {
                    clearDisconnectedRetryTimer(inputSendTransport);
                    requestSfuIceRestart(inputSendTransport, dataSendInfo.id);
                  } else if (state === "disconnected") {
                    scheduleDisconnectedIceRestart(
                      inputSendTransport,
                      dataSendInfo.id
                    );
                  } else {
                    clearDisconnectedRetryTimer(inputSendTransport);
                  }
                } catch (e) {}
              });

              inputSendTransport.on(
                "connect",
                ({ dtlsParameters }, callback, errback) => {
                  this.netplay.socket.emit(
                    "sfu-connect-transport",
                    { transportId: dataSendInfo.id, dtlsParameters },
                    (err) => {
                      if (err) return errback(err);
                      callback();
                    }
                  );
                }
              );

              inputSendTransport.on(
                "producedata",
                (
                  { sctpStreamParameters, label, protocol, appData },
                  callback,
                  errback
                ) => {
                  this.netplay.socket.emit(
                    "sfu-produce-data",
                    {
                      transportId: dataSendInfo.id,
                      sctpStreamParameters,
                      label,
                      protocol,
                      appData,
                    },
                    (err, id) => {
                      if (err) return errback(err);
                      callback({ id });
                    }
                  );
                }
              );

              this.netplay.inputSendTransport = inputSendTransport;
              this.netplay.inputSendTransportId = dataSendInfo.id;
              console.log("Created inputSendTransport for SFU DataChannel:", {
                id: dataSendInfo.id,
              });
            }
          } catch (e) {
            console.warn(
              "[Netplay][SFU] Failed creating inputSendTransport",
              e
            );
          }

          // Helper for consuming a single producer id (also used by the
          // Socket.IO 'new-producer' event).
          // Always reset SFU receive state on (re)join. If we keep a stale
          // consumed-id set, reconnects can incorrectly skip consuming the
          // current room's producers.
          try {
            if (this.netplay.sfuStream) {
              this.netplay.sfuStream.getTracks().forEach((t) => {
                try {
                  t.stop();
                } catch (e) {}
              });
            }
          } catch (e) {}
          this.netplay.sfuConsumedProducerIds = new Set();
          this.netplay.sfuStream = new MediaStream();
          // Keep separate streams so we can attach audio to an <audio> element.
          // This improves reliability on some mobile browsers where audio tied
          // to a <video> element can get stuck muted/paused.
          this.netplay.sfuAudioStream = new MediaStream();
          this.netplay.sfuVideoStream = new MediaStream();
          const sfuStream = this.netplay.sfuStream;
          const sfuAudioStream = this.netplay.sfuAudioStream;
          const sfuVideoStream = this.netplay.sfuVideoStream;

          const useAudioElementFallback =
            typeof window !== "undefined"
              ? window.EJS_NETPLAY_AUDIO_ELEMENT_FALLBACK !== false
              : true;

          const ensureVideoElement = () => {
            if (!this.netplay.video) {
              this.netplay.video = document.createElement("video");
              this.netplay.video.playsInline = true;
              // When using an <audio> element for sound, keep the video muted to
              // avoid double-audio and to reduce the chance of autoplay issues.
              this.netplay.video.muted = useAudioElementFallback ? true : false;
            }
            const desired = useAudioElementFallback
              ? sfuVideoStream
              : sfuStream;
            if (this.netplay.video.srcObject !== desired) {
              this.netplay.video.srcObject = desired;
            }
            return this.netplay.video;
          };

          const ensureAudioElement = () => {
            if (!useAudioElementFallback) return null;
            if (!this.netplay.audioEl) {
              const el = document.createElement("audio");
              el.autoplay = true;
              el.muted = false;
              el.controls = false;
              // Keep it in DOM (some mobile browsers are picky) but invisible.
              el.style.position = "absolute";
              el.style.left = "0";
              el.style.top = "0";
              el.style.width = "1px";
              el.style.height = "1px";
              el.style.opacity = "0";
              el.style.pointerEvents = "none";
              el.id = "netplay-audio";
              this.netplay.audioEl = el;
            }
            const desired = sfuAudioStream;
            if (this.netplay.audioEl.srcObject !== desired) {
              this.netplay.audioEl.srcObject = desired;
            }
            try {
              const container =
                this.netplay.videoContainer ||
                (this.elements && this.elements.parent) ||
                document.body;
              if (container && !this.netplay.audioEl.parentElement) {
                container.appendChild(this.netplay.audioEl);
              }
            } catch (e) {}
            return this.netplay.audioEl;
          };

          const consumeProducerId = async (producerId) => {
            try {
              if (!producerId) return;
              if (!this.netplay || !this.netplay.useSFU) return;
              if (!this.netplay.device || !this.netplay.recvTransport) return;
              if (this.netplay.sfuConsumedProducerIds.has(producerId)) return;
              this.netplay.sfuConsumedProducerIds.add(producerId);

              const consumerParams = await new Promise((resolve, reject) => {
                this.netplay.socket.emit(
                  "sfu-consume",
                  {
                    producerId,
                    transportId: transportInfo.id,
                    rtpCapabilities: this.netplay.device.rtpCapabilities,
                  },
                  (err, params) => {
                    if (err) return reject(err);
                    resolve(params);
                  }
                );
              });
              const consumer = await recvTransport.consume({
                id: consumerParams.id,
                producerId: consumerParams.producerId,
                kind: consumerParams.kind,
                rtpParameters: consumerParams.rtpParameters,
              });
              console.log("SFU consumer created:", {
                consumerId: consumer.id,
                producerId: consumer.producerId,
                kind: consumer.kind,
                trackId: consumer.track && consumer.track.id,
              });

              // Track the current audio consumer so we can monitor/recover it.
              try {
                if (consumer && consumer.kind === "audio") {
                  this.netplay.audioConsumer = consumer;
                  this.netplay._ejsSfuAudioProducerId =
                    consumer.producerId || producerId;
                  if (
                    typeof this
                      ._ejsEnsureClientSfuAudioConsumerHealthMonitor ===
                    "function"
                  ) {
                    this._ejsEnsureClientSfuAudioConsumerHealthMonitor();
                  }
                }
              } catch (e) {
                // ignore
              }

              // Enforce client preference for SFU video quality.
              // When host uses our 2-layer simulcast, mediasoup consumer spatial layers are:
              // 0=low, 1=high.
              try {
                if (consumer && consumer.kind === "video") {
                  const normalizeSimulcastQuality = (v) => {
                    const s =
                      typeof v === "string" ? v.trim().toLowerCase() : "";
                    if (s === "high" || s === "low") return s;
                    if (s === "medium") return "low";
                    if (s === "720p") return "high";
                    if (s === "360p") return "low";
                    if (s === "180p") return "low";
                    return "high";
                  };
                  const prefRaw =
                    (typeof this.netplayClientSimulcastQuality === "string"
                      ? this.netplayClientSimulcastQuality
                      : null) ||
                    (typeof window.EJS_NETPLAY_CLIENT_SIMULCAST_QUALITY ===
                    "string"
                      ? window.EJS_NETPLAY_CLIENT_SIMULCAST_QUALITY
                      : null) ||
                    (typeof window.EJS_NETPLAY_CLIENT_PREFERRED_QUALITY ===
                    "string"
                      ? window.EJS_NETPLAY_CLIENT_PREFERRED_QUALITY
                      : null) ||
                    // Legacy fallback
                    (typeof window.EJS_NETPLAY_CLIENT_MAX_RESOLUTION ===
                    "string"
                      ? window.EJS_NETPLAY_CLIENT_MAX_RESOLUTION
                      : null) ||
                    "high";
                  const pref = normalizeSimulcastQuality(prefRaw);
                  const spatialLayer = pref === "low" ? 0 : 1;
                  if (typeof consumer.setPreferredLayers === "function") {
                    consumer.setPreferredLayers({
                      spatialLayer,
                      temporalLayer: 2,
                    });
                  }
                }
              } catch (e) {
                console.warn("Failed to set preferred layers on consumer", e);
              }

              // If we got a consumer+track, SFU is active in practice.
              try {
                this.netplay.useSFU = true;
                this.netplay._sfuDecisionMade = true;
              } catch (e) {}

              // Replace existing track of same kind in the shared stream.
              try {
                if (consumer && consumer.track) {
                  sfuStream.getTracks().forEach((t) => {
                    if (t && t.kind === consumer.track.kind) {
                      try {
                        sfuStream.removeTrack(t);
                      } catch (e) {}
                    }
                  });
                  sfuStream.addTrack(consumer.track);
                }
              } catch (e) {
                console.warn("Failed to attach consumer track to sfuStream", e);
              }

              // Keep audio/video separated for more reliable playback on mobile.
              try {
                if (consumer && consumer.track) {
                  if (consumer.track.kind === "audio" && sfuAudioStream) {
                    sfuAudioStream.getTracks().forEach((t) => {
                      if (t && t.kind === "audio") {
                        try {
                          sfuAudioStream.removeTrack(t);
                        } catch (e) {}
                      }
                    });
                    sfuAudioStream.addTrack(consumer.track);
                    const a = ensureAudioElement();
                    if (a && typeof a.play === "function") {
                      a.play().catch(() => {
                        try {
                          if (
                            typeof this.promptUserInteraction === "function"
                          ) {
                            this.promptUserInteraction(a);
                          }
                        } catch (e) {}
                      });
                    }
                    // Start a silence detector so we can recover if we end up
                    // receiving bytes but rendering silence.
                    try {
                      if (
                        typeof this._ejsEnsureClientSfuAudioSilenceMonitor ===
                        "function"
                      ) {
                        this._ejsEnsureClientSfuAudioSilenceMonitor();
                      }
                    } catch (e) {}
                  }

                  if (consumer.track.kind === "video" && sfuVideoStream) {
                    sfuVideoStream.getTracks().forEach((t) => {
                      if (t && t.kind === "video") {
                        try {
                          sfuVideoStream.removeTrack(t);
                        } catch (e) {}
                      }
                    });
                    sfuVideoStream.addTrack(consumer.track);
                  }
                }
              } catch (e) {
                console.warn(
                  "Failed to attach consumer track to sfuAudioStream/sfuVideoStream",
                  e
                );
              }

              // Instrument consumer track lifecycle
              try {
                if (consumer.track) {
                  consumer.track.onended = () =>
                    console.warn("consumer.track ended", consumer.track.id);
                  consumer.track.onmute = () =>
                    console.warn("consumer.track muted", consumer.track.id);
                  consumer.track.onunmute = () =>
                    console.log("consumer.track unmuted", consumer.track.id);

                  // If SFU audio track stops, try to re-consume it.
                  if (consumer.kind === "audio") {
                    const trigger = (why) => {
                      try {
                        if (
                          this.netplay &&
                          typeof this.netplay
                            ._ejsAttemptClientSfuAudioRecovery === "function"
                        ) {
                          this.netplay._ejsAttemptClientSfuAudioRecovery(
                            `track-${why}`
                          );
                        }
                      } catch (e) {}
                    };
                    consumer.track.onended = () => {
                      console.warn(
                        "consumer.audio track ended",
                        consumer.track.id
                      );
                      trigger("ended");
                    };
                    consumer.track.onmute = () => {
                      console.warn(
                        "consumer.audio track muted",
                        consumer.track.id
                      );
                      trigger("muted");
                    };
                  }
                }
              } catch (e) {
                console.warn(
                  "Failed to attach track handlers to consumer.track",
                  e
                );
              }

              // Only create/attach the video element and start drawing when we actually got video.
              if (consumer.kind === "video") {
                this.netplay.video = ensureVideoElement();

                const v = this.netplay.video;
                const addLog = (ev) =>
                  v.addEventListener(ev, () =>
                    console.log(`video event: ${ev}`, {
                      readyState: v.readyState,
                      paused: v.paused,
                      videoWidth: v.videoWidth,
                      videoHeight: v.videoHeight,
                    })
                  );
                [
                  "loadedmetadata",
                  "loadeddata",
                  "play",
                  "playing",
                  "pause",
                  "error",
                  "stalled",
                  "suspend",
                  "emptied",
                  "abort",
                  "resize",
                ].forEach(addLog);

                const markReadyFromSFUFrames = (ev) => {
                  try {
                    if (v.videoWidth > 0 && v.videoHeight > 0) {
                      this.netplay.webRtcReady = true;
                      if (this.netplay && this.netplay._webrtcReadyTimeoutId) {
                        clearTimeout(this.netplay._webrtcReadyTimeoutId);
                        this.netplay._webrtcReadyTimeoutId = null;
                      }
                      console.log(
                        "[Netplay] Marked ready from SFU video frames",
                        {
                          event: ev,
                          videoWidth: v.videoWidth,
                          videoHeight: v.videoHeight,
                        }
                      );
                    }
                  } catch (e) {}
                };
                ["loadedmetadata", "loadeddata", "playing", "resize"].forEach(
                  (ev) =>
                    v.addEventListener(ev, () => markReadyFromSFUFrames(ev))
                );
                v.addEventListener("error", (e) =>
                  console.error("Video element error event", e)
                );

                try {
                  v.style.display = "block";
                  v.style.position = "absolute";
                  v.style.left = "0";
                  v.style.top = "0";
                  v.style.width = "100%";
                  v.style.height = "100%";
                  v.style.objectFit = "contain";
                  v.style.objectPosition = "top center";
                  v.style.pointerEvents = "none";
                  v.style.background = "black";
                  v.id = "netplay-video";

                  const container =
                    this.netplay.videoContainer ||
                    (this.elements && this.elements.parent) ||
                    document.body;
                  try {
                    if (container && container.style)
                      container.style.display = "block";
                  } catch (e) {}
                  container.appendChild(v);
                  console.log(
                    "Netplay SFU video element attached and visible",
                    v
                  );
                } catch (e) {
                  console.warn("Failed to append video element to DOM", e);
                }

                const tryPlay = async (retries = 5, delay = 1000) => {
                  for (let i = 0; i < retries; i++) {
                    try {
                      await v.play();
                      console.log("video.play() succeeded on attempt", i + 1);
                      // If video is playing, host is effectively resumed.
                      if (
                        typeof this.netplayHideHostPausedOverlay === "function"
                      ) {
                        this.netplayHideHostPausedOverlay();
                      }
                      return true;
                    } catch (err) {
                      console.warn(
                        "video.play() attempt",
                        i + 1,
                        "failed",
                        err
                      );
                      if (i === retries - 1) break;
                      await new Promise((r) => setTimeout(r, delay));
                    }
                  }
                  return false;
                };
                try {
                  v.addEventListener(
                    "loadeddata",
                    () => {
                      if (
                        typeof this.netplayHideHostPausedOverlay === "function"
                      ) {
                        this.netplayHideHostPausedOverlay();
                      }
                    },
                    { once: true }
                  );
                } catch (e) {
                  // ignore
                }
                const played = await tryPlay().catch(() => false);
                if (!played) {
                  console.warn("video.play() failed after retries");
                  if (typeof this.promptUserInteraction === "function") {
                    this.promptUserInteraction(v);
                  }
                }

                setTimeout(() => {
                  console.log("video size check after attach", {
                    videoWidth: v.videoWidth,
                    videoHeight: v.videoHeight,
                  });
                  if (v.videoWidth === 0 || v.videoHeight === 0) {
                    console.warn(
                      "Attached video has zero dimensions - no frames yet or consumer not producing frames"
                    );
                  }
                }, 2000);

                this.drawVideoToCanvas();
              }
            } catch (err) {
              console.error("Error consuming producer from SFU:", err);
            }
          };

          this.netplayConsumeSFUProducer = consumeProducerId;

          // Ask server to tell us about existing producers to consume
          this.netplay.socket.emit(
            "sfu-get-producers",
            {},
            async (err, producers) => {
              if (err) return console.error("sfu-get-producers error", err);

              const list = Array.isArray(producers) ? producers : [];
              for (const p of list) {
                await consumeProducerId(p && p.id);
              }

              // If we raced the room join or producers are registered slightly
              // later (e.g. host re-produced while nobody was connected), retry once.
              if (list.length === 0) {
                setTimeout(() => {
                  try {
                    if (!this.netplay || !this.netplay.useSFU) return;
                    if (this.netplay.owner) return;
                    if (!this.netplay.socket || !this.netplay.socket.connected)
                      return;
                    this.netplay.socket.emit(
                      "sfu-get-producers",
                      {},
                      async (err2, producers2) => {
                        if (err2)
                          return console.error(
                            "sfu-get-producers retry error",
                            err2
                          );
                        const list2 = Array.isArray(producers2)
                          ? producers2
                          : [];
                        for (const p2 of list2) {
                          await consumeProducerId(p2 && p2.id);
                        }
                      }
                    );
                  } catch (e) {
                    console.warn("SFU producer resync retry failed", e);
                  }
                }, 750);
              }
            }
          );
        }
      } catch (err) {
        console.error("Failed to create SFU transports:", err);
        this.netplay.useSFU = false;
      }
    };

    // Ensure the SFU DataChannel send transport exists for relay inputs.
    // IMPORTANT: This must not recreate SFU media transports (video/audio), because
    // it may be called during mid-session input-mode switches.
    this.netplayEnsureSFUInputSendTransport = async () => {
      try {
        if (!this.netplay || !this.isNetplay) return false;
        if (this.netplay.owner) return false;
        if (!this.netplay.useSFU) return false;
        if (!this.netplay.device || !this.netplay.socket) return false;
        if (!this.netplay.socket.connected) return false;

        if (
          this.netplay.inputSendTransport &&
          !this.netplay.inputSendTransport.closed &&
          typeof this.netplay.inputSendTransport.produceData === "function"
        ) {
          return true;
        }

        const dataSendInfo = await new Promise((resolve, reject) => {
          this.netplay.socket.emit(
            "sfu-create-transport",
            { direction: "send" },
            (err, info) => {
              if (err) return reject(err);
              resolve(info);
            }
          );
        });

        const inputSendTransport =
          this.netplay.device.createSendTransport(dataSendInfo);

        inputSendTransport.on(
          "connect",
          ({ dtlsParameters }, callback, errback) => {
            this.netplay.socket.emit(
              "sfu-connect-transport",
              { transportId: dataSendInfo.id, dtlsParameters },
              (err) => {
                if (err) return errback(err);
                callback();
              }
            );
          }
        );

        inputSendTransport.on(
          "producedata",
          (
            { sctpStreamParameters, label, protocol, appData },
            callback,
            errback
          ) => {
            this.netplay.socket.emit(
              "sfu-produce-data",
              {
                transportId:
                  this.netplay.inputSendTransportId || dataSendInfo.id,
                sctpStreamParameters,
                label,
                protocol,
                appData,
              },
              (err, id) => {
                if (err) return errback(err);
                callback({ id });
              }
            );
          }
        );

        this.netplay.inputSendTransport = inputSendTransport;
        this.netplay.inputSendTransportId = dataSendInfo.id;
        console.log("Created inputSendTransport for SFU DataChannel:", {
          id: dataSendInfo.id,
        });
        return true;
      } catch (e) {
        console.warn("[Netplay][SFU] Failed ensuring inputSendTransport", e);
        return false;
      }
    };

    this.netplayCreatePeerConnection = (peerId, options = {}) => {
      const controlsOnly =
        this.netplay && this.netplay._hybridOnly
          ? true
          : typeof options.controlsOnly === "boolean"
          ? options.controlsOnly
          : this.netplay && this.netplay._sfuDecisionMade !== true
          ? true
          : !!this.netplay.useSFU;

      const markNetplayReady = (reason) => {
        try {
          this.netplay.webRtcReady = true;
          if (this.netplay && this.netplay._webrtcReadyTimeoutId) {
            clearTimeout(this.netplay._webrtcReadyTimeoutId);
            this.netplay._webrtcReadyTimeoutId = null;
          }
          if (reason) {
            console.log("[Netplay] Marked ready:", reason);
          }
        } catch (e) {
          // Best-effort.
        }
      };
      console.log(
        `[Netplay] Creating RTCPeerConnection for peer ${peerId} with ICE servers:`,
        this.config.netplayICEServers
      );
      const pc = new RTCPeerConnection({
        iceServers: this.config.netplayICEServers,
        iceCandidatePoolSize: 10,
      });

      pc.addEventListener("iceconnectionstatechange", () => {
        console.log(
          `[Netplay] ICE connection state for peer ${peerId}:`,
          pc.iceConnectionState
        );
      });
      pc.addEventListener("signalingstatechange", () => {
        console.log(
          `[Netplay] Signaling state for peer ${peerId}:`,
          pc.signalingState
        );
      });
      pc.addEventListener("icegatheringstatechange", () => {
        console.log(
          `[Netplay] ICE gathering state for peer ${peerId}:`,
          pc.iceGatheringState
        );
      });

      let dataChannel;
      let unorderedDataChannel;

      if (this.netplay.owner) {
        const attachHostDataChannelHandlers = (ch) => {
          if (!ch) return;
          ch.onopen = () => {
            console.log(
              `[Netplay] Data channel opened for peer ${peerId} (${ch.label})`
            );
            markNetplayReady("datachannel-open");
          };
          ch.onclose = () =>
            console.warn(
              `[Netplay] Data channel closed for peer ${peerId} (${ch.label})`
            );
          ch.onerror = (e) =>
            console.error(
              `[Netplay] Data channel error for peer ${peerId} (${ch.label}):`,
              e
            );
          ch.onmessage = (event) => {
            console.log(
              `[Netplay] Data channel message from peer ${peerId} (${ch.label}):`,
              event.data
            );
            const data = JSON.parse(event.data);
            if (data.type === "host-left") {
              this.displayMessage("Host left. Restarting...", 3000);
              this.netplayLeaveRoom("host-left-datachannel");
              return;
            }

            const playerIndex = data.player;
            const applyInput = (idx, val) => {
              const frame = this.netplay.currentFrame || 0;
              if (!this.netplay.inputsData[frame]) {
                this.netplay.inputsData[frame] = [];
              }
              this.netplay.inputsData[frame].push({
                frame: frame,
                connected_input: [playerIndex, idx, val],
              });
              if (
                this.gameManager &&
                this.gameManager.functions &&
                this.gameManager.functions.simulateInput
              ) {
                // Apply remote input without being affected by host slot override.
                const raw = this.netplay && this.netplay._ejsRawSimulateInputFn;
                if (typeof raw === "function") {
                  try {
                    this.netplay._ejsApplyingRemoteInput = true;
                    raw(playerIndex, idx, val);
                  } finally {
                    this.netplay._ejsApplyingRemoteInput = false;
                  }
                } else {
                  this.gameManager.functions.simulateInput(
                    playerIndex,
                    idx,
                    val
                  );
                }
              } else {
                console.error(
                  "Cannot process input: gameManager.functions.simulateInput is undefined"
                );
              }
            };

            // Snapshot packets (state array) are used when unordered retries are 0
            // so lost release packets are corrected by later packets.
            if (data && Array.isArray(data.state)) {
              try {
                if (!this.netplay.remoteInputStates)
                  this.netplay.remoteInputStates = {};
                const key = `p2p:${peerId}:${playerIndex}`;
                const prev = Array.isArray(this.netplay.remoteInputStates[key])
                  ? this.netplay.remoteInputStates[key]
                  : new Array(30).fill(0);
                const next = new Array(30).fill(0);
                for (let i = 0; i < 30; i++) {
                  const raw = data.state[i];
                  const v = parseInt(raw, 10);
                  next[i] = isNaN(v) ? 0 : v;
                  if (next[i] !== (prev[i] || 0)) {
                    applyInput(i, next[i]);
                  }
                }
                this.netplay.remoteInputStates[key] = next;
              } catch (e) {
                console.warn("[Netplay] Failed processing input snapshot", e);
              }
              return;
            }

            applyInput(data.index, data.value);
          };
        };

        dataChannel = pc.createDataChannel("inputs");
        attachHostDataChannelHandlers(dataChannel);

        // Allow client-initiated channels (e.g. unordered P2P inputs).
        pc.ondatachannel = (event) => {
          try {
            const ch = event && event.channel;
            if (!ch) return;
            console.log(
              `[Netplay] Received data channel for peer ${peerId} (owner):`,
              ch.label
            );
            attachHostDataChannelHandlers(ch);
            if (ch.label === "inputs-unordered") {
              unorderedDataChannel = ch;
            }
          } catch (e) {
            console.warn("[Netplay] Failed handling ondatachannel (owner)", e);
          }
        };
      } else {
        pc.ondatachannel = (event) => {
          dataChannel = event.channel;
          console.log(
            `[Netplay] Received data channel for peer ${peerId}:`,
            dataChannel
          );

          // Persist the received channel onto the stored peer connection entry.
          if (
            this.netplay.peerConnections &&
            this.netplay.peerConnections[peerId]
          ) {
            this.netplay.peerConnections[peerId].dataChannel = dataChannel;
          }

          dataChannel.onopen = () => {
            console.log(`[Netplay] Data channel opened for peer ${peerId}`);
            markNetplayReady("datachannel-open");
          };
          dataChannel.onclose = () =>
            console.warn(`[Netplay] Data channel closed for peer ${peerId}`);
          dataChannel.onerror = (e) =>
            console.error(
              `[Netplay] Data channel error for peer ${peerId}:`,
              e
            );
          dataChannel.onmessage = (event) => {
            console.log(
              `[Netplay] Data channel message from peer ${peerId}:`,
              event.data
            );
            const data = JSON.parse(event.data);
            if (data.type === "host-left") {
              this.displayMessage("Host left. Restarting...", 3000);
              this.netplayLeaveRoom("host-left-datachannel");
              return;
            }
            console.log(`Received input from host ${peerId}:`, data);
            if (
              this.gameManager &&
              this.gameManager.functions &&
              this.gameManager.functions.simulateInput
            ) {
              this.gameManager.functions.simulateInput(
                data.player,
                data.index,
                data.value
              );
            } else {
              console.error(
                "Cannot process input: gameManager.functions.simulateInput is undefined"
              );
            }
          };
        };

        // If the user requested Unordered P2P, create a client-initiated data channel
        // with ordered=false and maxRetransmits set by Netplay Options.
        try {
          const mode =
            (typeof this.netplayInputMode === "string" &&
              this.netplayInputMode) ||
            (typeof window.EJS_NETPLAY_INPUT_MODE === "string" &&
              window.EJS_NETPLAY_INPUT_MODE) ||
            "unorderedRelay";
          if (mode === "unorderedP2P") {
            const retriesRaw =
              typeof this.netplayUnorderedRetries === "number" ||
              typeof this.netplayUnorderedRetries === "string"
                ? this.netplayUnorderedRetries
                : window.EJS_NETPLAY_UNORDERED_RETRIES;
            let retries = parseInt(retriesRaw, 10);
            if (isNaN(retries)) retries = 0;
            if (retries < 0) retries = 0;
            if (retries > 2) retries = 2;
            unorderedDataChannel = pc.createDataChannel("inputs-unordered", {
              ordered: false,
              maxRetransmits: retries,
            });
            unorderedDataChannel.onopen = () => {
              console.log(
                `[Netplay] Unordered P2P data channel opened for peer ${peerId}`
              );
              markNetplayReady("datachannel-open");
            };
            unorderedDataChannel.onclose = () =>
              console.warn(
                `[Netplay] Unordered P2P data channel closed for peer ${peerId}`
              );
            unorderedDataChannel.onerror = (e) =>
              console.error(
                `[Netplay] Unordered P2P data channel error for peer ${peerId}:`,
                e
              );

            // Persist onto stored entry (if already present).
            if (
              this.netplay.peerConnections &&
              this.netplay.peerConnections[peerId]
            ) {
              this.netplay.peerConnections[peerId].unorderedDataChannel =
                unorderedDataChannel;
            }
          }
        } catch (e) {
          console.warn(
            "[Netplay] Failed creating unordered P2P data channel",
            e
          );
        }
      }

      // If SFU is enabled, P2P is for controls only (data channel).
      // Avoid adding media tracks/transceivers.
      if (!controlsOnly) {
        if (this.netplay.owner && this.netplay.localStream) {
          this.netplay.localStream.getTracks().forEach((track) => {
            pc.addTrack(track, this.netplay.localStream);
          });

          const codecs = RTCRtpSender.getCapabilities("video").codecs;
          const order = ["video/VP9", "video/H264", "video/VP8"];
          const preferredCodecs = codecs
            .filter((codec) => order.includes(codec.mimeType))
            .sort(
              (a, b) => order.indexOf(a.mimeType) - order.indexOf(b.mimeType)
            );
          const transceiver = pc
            .getTransceivers()
            .find(
              (t) =>
                t.sender && t.sender.track && t.sender.track.kind === "video"
            );
          if (transceiver && preferredCodecs.length) {
            try {
              transceiver.setCodecPreferences(preferredCodecs);
            } catch (error) {
              console.error("Failed to set codec preferences:", error);
            }
          }
        } else {
          pc.addTransceiver("video", {
            direction: "recvonly",
          });
        }
      } else {
        console.log(
          `[Netplay] SFU enabled; creating controls-only P2P connection for peer ${peerId}`
        );
      }

      this.netplay.peerConnections[peerId] = {
        pc,
        dataChannel,
        unorderedDataChannel,
      };

      let streamReceived = false;
      const streamTimeout = controlsOnly
        ? null
        : setTimeout(() => {
            const hasSFUVideoFrames = () => {
              try {
                return (
                  !!this.netplay &&
                  !!this.netplay.video &&
                  this.netplay.video.videoWidth > 0 &&
                  this.netplay.video.videoHeight > 0
                );
              } catch (e) {
                return false;
              }
            };

            if (
              !streamReceived &&
              !this.netplay.owner &&
              !hasSFUVideoFrames()
            ) {
              this.displayMessage(
                "Failed to receive video stream. Check your network and try again.",
                5000
              );
              this.netplayLeaveRoom("p2p-stream-timeout");
            }
          }, 10000);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          this.netplay.socket.emit("webrtc-signal", {
            target: peerId,
            candidate: event.candidate,
          });
        }
      };

      pc.onicecandidateerror = (event) => {
        console.error("ICE candidate error for peer", peerId, ":", event);
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          markNetplayReady("pc-connected");
          return;
        }

        if (
          pc.connectionState !== "failed" &&
          pc.connectionState !== "disconnected"
        ) {
          return;
        }

        // In SFU mode the P2P PC is controls-only; browsers can briefly flip to
        // disconnected and then recover. Don't immediately kill the data channel.
        if (controlsOnly) {
          const existing =
            this.netplay.peerConnections &&
            this.netplay.peerConnections[peerId];
          const dc = existing && existing.dataChannel;
          const dcOpen = !!dc && dc.readyState === "open";
          console.warn(
            `[Netplay] Controls-only PC ${peerId} state ${pc.connectionState} (dcOpen=${dcOpen}) - waiting before reconnect`
          );

          if (existing && existing._reconnectTimeoutId) {
            clearTimeout(existing._reconnectTimeoutId);
            existing._reconnectTimeoutId = null;
          }

          if (existing) {
            existing._reconnectTimeoutId = setTimeout(() => {
              // If this timer is stale (we've already replaced the PC), do nothing.
              const currentEntry =
                this.netplay &&
                this.netplay.peerConnections &&
                this.netplay.peerConnections[peerId];
              if (currentEntry && currentEntry !== existing) return;

              // If the peer is no longer present in the room, quietly clean up and
              // skip reconnect UI/errors.
              const peerStillPresent = !!(
                this.netplay &&
                this.netplay.players &&
                Object.values(this.netplay.players).some(
                  (p) => p && p.socketId === peerId
                )
              );
              if (!peerStillPresent) {
                try {
                  pc.close();
                } catch (e) {
                  // ignore
                }
                if (this.netplay && this.netplay.peerConnections) {
                  delete this.netplay.peerConnections[peerId];
                }
                return;
              }

              const stillBad =
                pc.connectionState === "failed" ||
                pc.connectionState === "disconnected";
              const nowDcOpen =
                existing.dataChannel &&
                existing.dataChannel.readyState === "open";
              if (!stillBad || nowDcOpen) {
                console.log(
                  `[Netplay] Controls-only PC ${peerId} recovered; skipping reconnect`,
                  { state: pc.connectionState, nowDcOpen }
                );
                return;
              }

              this.displayMessage(
                "Connection with player lost. Attempting to reconnect...",
                3000
              );
              try {
                pc.close();
              } catch (e) {
                // ignore
              }
              delete this.netplay.peerConnections[peerId];
              setTimeout(
                () =>
                  this.netplayCreatePeerConnection(peerId, {
                    controlsOnly: true,
                  }),
                2000
              );
            }, 5000);
          }
          return;
        }

        // Legacy P2P mode: reconnect immediately.
        this.displayMessage(
          "Connection with player lost. Attempting to reconnect...",
          3000
        );
        if (streamTimeout) clearTimeout(streamTimeout);
        pc.close();
        delete this.netplay.peerConnections[peerId];
        setTimeout(() => this.netplayCreatePeerConnection(peerId), 2000);
      };

      if (!controlsOnly) {
        pc.ontrack = (event) => {
          if (!this.netplay.owner) {
            streamReceived = true;
            if (streamTimeout) clearTimeout(streamTimeout);
            const stream = event.streams[0];
            if (!this.netplay.video) {
              this.netplay.video = document.createElement("video");
              this.netplay.video.muted = true;
              this.netplay.video.playsInline = true;
            }
            this.netplay.video.srcObject = stream;
            this.netplay.video.play().catch(() => {
              if (this.isMobile) {
                this.promptUserInteraction(this.netplay.video);
              }
            });
            this.drawVideoToCanvas();
          }
        };
      }

      if (this.netplay.owner) {
        pc.createOffer()
          .then((offer) => {
            offer.sdp = offer.sdp.replace(
              /profile-level-id=[0-9a-fA-F]+/,
              "profile-level-id=42e01f"
            );
            return pc.setLocalDescription(offer);
          })
          .then(() => {
            this.netplay.socket.emit("webrtc-signal", {
              target: peerId,
              offer: pc.localDescription,
            });
          })
          .catch((error) => console.error("Error creating offer:", error));
      }

      return pc;
    };

    this.showVideoOverlay = () => {
      const videoElement = this.netplay.video;
      if (!videoElement) {
        console.error("showVideoOverlay: videoElement is not initialized");
        return;
      }
      console.log(
        "showVideoOverlay called, videoElement exists:",
        videoElement
      );

      if (videoElement.parentElement) {
        console.log(
          "Removing video element from current parent:",
          videoElement.parentElement
        );
        videoElement.parentElement.removeChild(videoElement);
      }

      // Keep the overlay within the emulator container (not document.body) and
      // size/center it using the same aspect-ratio rules as the main canvas.
      const aspect =
        (this.netplay && this.netplay.lockedAspectRatio) ||
        (videoElement.videoWidth && videoElement.videoHeight
          ? videoElement.videoWidth / videoElement.videoHeight
          : this.canvas && this.canvas.width && this.canvas.height
          ? this.canvas.width / this.canvas.height
          : 700 / 720);

      const container =
        (this.netplay && this.netplay.videoContainer) ||
        (this.elements && this.elements.parent) ||
        document.body;
      let vw = 0;
      let vh = 0;
      try {
        if (
          container &&
          typeof container.getBoundingClientRect === "function"
        ) {
          const rect = container.getBoundingClientRect();
          vw = rect.width;
          vh = rect.height;
        }
      } catch (e) {
        // ignore
      }
      if (!vw || !vh) {
        vw = window.innerWidth;
        vh = window.innerHeight;
      }
      let newWidth, newHeight;
      if (vw / vh > aspect) {
        newHeight = vh;
        newWidth = vh * aspect;
      } else {
        newWidth = vw;
        newHeight = vw / aspect;
      }

      videoElement.style.position = "absolute";
      videoElement.style.top = "0";
      videoElement.style.left = "50%";
      videoElement.style.transform = "translateX(-50%)";
      videoElement.style.width = `${newWidth}px`;
      videoElement.style.height = `${newHeight}px`;
      videoElement.style.border = "1px solid white";
      videoElement.style.zIndex = "1";
      videoElement.style.display = "";
      videoElement.style.objectFit = "contain";
      videoElement.style.objectPosition = "top center";

      try {
        if (container && container.style && !container.style.position) {
          container.style.position = "relative";
        }
      } catch (e) {
        // ignore
      }
      container.appendChild(videoElement);
      console.log(
        "Video overlay added to DOM, styles:",
        videoElement.style.cssText
      );

      const playVideo = async () => {
        console.log(
          "Attempting to play video, readyState:",
          videoElement.readyState,
          "Paused:",
          videoElement.paused,
          "Ended:",
          videoElement.ended,
          "Muted:",
          videoElement.muted
        );
        try {
          await videoElement.play();
          console.log(
            "Video playback started successfully, currentTime:",
            videoElement.currentTime
          );
        } catch (error) {
          console.error("Video play error:", error);
          if (this.isMobile) {
            this.promptUserInteraction(videoElement);
          } else {
            console.log(
              "Autoplay failed on desktop, but user interaction not required for muted video"
            );
          }
        }
        if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
          console.warn(
            "Video element has zero dimensions, likely no valid frame:",
            {
              videoWidth: videoElement.videoWidth,
              videoHeight: videoElement.videoHeight,
            }
          );
        } else {
          console.log("Video dimensions:", {
            videoWidth: videoElement.videoWidth,
            videoHeight: videoElement.videoHeight,
          });
        }
      };
      playVideo();
    };

    this.drawVideoToCanvas = () => {
      const videoElement = this.netplay.video;
      const canvas = this.netplayCanvas;
      if (!canvas) {
        console.error("drawVideoToCanvas: Missing canvas!");
      }
      const ctx = canvas.getContext("2d", {
        alpha: false,
        willReadFrequently: true,
      });

      if (!videoElement || !ctx) {
        console.error("drawVideoToCanvas: Missing video, or context!");
        return;
      }

      const { width: nativeWidth, height: nativeHeight } =
        this.getNativeResolution() || {
          width: 720,
          height: 700,
        };
      canvas.width = nativeWidth;
      canvas.height = nativeHeight;

      const ensureVideoPlaying = async () => {
        let retries = 0;
        const maxRetries = 5;
        while (retries < maxRetries) {
          if (videoElement.paused || videoElement.ended) {
            try {
              await videoElement.play();
            } catch (error) {
              if (this.isMobile) this.promptUserInteraction(videoElement);
            }
          }
          if (videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
            if (!this.netplay.lockedAspectRatio) {
              this.netplay.lockedAspectRatio =
                videoElement.videoWidth / videoElement.videoHeight;
              console.log(
                "Locked aspect ratio:",
                this.netplay.lockedAspectRatio
              );
            }
            break;
          }
          retries++;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        if (retries >= maxRetries) {
          this.displayMessage("Failed to initialize video stream", 5000);
          this.netplayLeaveRoom("video-init-failed");
        }
      };

      const drawFrame = () => {
        if (!this.isNetplay || this.netplay.owner) return;

        const aspect =
          this.netplay.lockedAspectRatio ||
          videoElement.videoWidth / videoElement.videoHeight ||
          nativeWidth / nativeHeight;

        if (
          videoElement.readyState >= videoElement.HAVE_CURRENT_DATA &&
          videoElement.videoWidth > 0
        ) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          const canvasAspect = nativeWidth / nativeHeight;
          let drawWidth, drawHeight, offsetX, offsetY;

          if (aspect > canvasAspect) {
            drawWidth = nativeWidth;
            drawHeight = nativeWidth / aspect;
            offsetX = 0;
            offsetY = 0;
          } else {
            drawHeight = nativeHeight;
            drawWidth = nativeHeight * aspect;
            offsetX = (nativeWidth - drawWidth) / 2;
            offsetY = 0;
          }

          ctx.drawImage(
            videoElement,
            0,
            0,
            videoElement.videoWidth,
            videoElement.videoHeight,
            offsetX,
            offsetY,
            drawWidth,
            drawHeight
          );
        }

        requestAnimationFrame(drawFrame);
      };

      videoElement.addEventListener(
        "loadeddata",
        () => {
          ensureVideoPlaying().then(drawFrame);
        },
        {
          once: true,
        }
      );

      ensureVideoPlaying();
    };

    this.netplayStartSocketIO = (callback) => {
      if (!this.netplay.previousPlayers) {
        this.netplay.previousPlayers = {};
      }
      if (!this.netplay.peerConnections) {
        this.netplay.peerConnections = {};
      }

      // Always key P2P connections by Socket.IO socketId.
      // In SFU mode, P2P is controls-only (data channel).
      this.netplayInitControlsP2P = (controlsOnly) => {
        if (!this.netplay || !this.netplay.players) return;
        const localSocketId =
          this.netplay.socket && this.netplay.socket.id
            ? String(this.netplay.socket.id).trim()
            : null;
        const localUserid = this.netplay.playerID
          ? String(this.netplay.playerID).trim()
          : null;
        Object.keys(this.netplay.players).forEach((userId) => {
          if (userId === this.netplay.playerID) return;
          const extra = this.netplay.players[userId] || null;

          // Never create a P2P connection to ourselves.
          // Some deployments key `players` by username (not userid), so `userId !== playerID`
          // can still refer to the local player.
          if (
            extra &&
            localUserid &&
            extra.userid !== undefined &&
            extra.userid !== null &&
            String(extra.userid).trim() === localUserid
          ) {
            return;
          }

          const peerSocketIdRaw = extra && (extra.socketId || extra.socket_id);
          const peerSocketId = peerSocketIdRaw
            ? String(peerSocketIdRaw).trim()
            : "";
          if (!peerSocketId) {
            console.warn(
              `[Netplay] Player ${userId} has no socketId yet; delaying P2P controls init`
            );
            return;
          }

          // SocketId-based self-check (most reliable).
          if (localSocketId && peerSocketId === localSocketId) {
            return;
          }

          if (!this.netplay.peerConnections[peerSocketId]) {
            console.log(
              `[Netplay] Initializing P2P controls for peer (socketId) ${peerSocketId}`
            );
            this.netplayCreatePeerConnection(peerSocketId, { controlsOnly });
          }
        });
      };

      if (typeof io === "undefined") {
        console.error(
          "Socket.IO client library not loaded. Please include <script src='https://cdn.socket.io/4.5.0/socket.io.min.js'></script>"
        );
        this.displayMessage("Socket.IO not available", 5000);
        return;
      }
      if (this.netplay.socket && this.netplay.socket.connected) {
        console.log(
          "Socket already connected, reusing:",
          this.netplay.socket.id
        );
        callback();
        return;
      }
      if (!this.netplay.url) {
        console.error("Cannot initialize Socket.IO: netplay.url is undefined");
        this.displayMessage("Network configuration error", 5000);
        return;
      }
      console.log(
        "Initializing new Socket.IO connection to:",
        this.netplay.url
      );

      // Netplay socket connection establishment
      // This handles initial connection errors
      this.netplay.socket = io(this.netplay.url);
      this.netplay.socket.on("connect", () => {
        console.log("Socket.IO connected:", this.netplay.socket.id);
        callback();
      });
      this.netplay.socket.on("connect_error", (error) => {
        console.error("Socket.IO connection error:", error.message);
        this.displayMessage(
          "Failed to connect to server: " + error.message,
          5000
        );
      });

      // SFU: host may create new producers during runtime (e.g. after pause/resume
      // when re-producing tracks). Consume new producers as they appear.
      this.netplay.socket.on("new-producer", async (data) => {
        try {
          if (!this.netplay || !this.netplay.useSFU) return;
          if (
            !this.netplay.owner &&
            typeof this.netplayConsumeSFUProducer === "function"
          ) {
            const producerId = data && (data.id || data.producerId);
            if (producerId) {
              console.log("[Netplay] new-producer received", { producerId });
              await this.netplayConsumeSFUProducer(producerId);
              // If SFU is producing again, clear any host-paused overlay.
              this.netplayHideHostPausedOverlay();
            }
          }
        } catch (e) {
          console.warn("[Netplay] Failed handling new-producer", e);
        }
      });

      this.netplay.socket.on("new-data-producer", async (data) => {
        try {
          if (!this.netplay || !this.netplay.useSFU) return;
          if (
            this.netplay.owner &&
            typeof this.netplayConsumeSFUDataProducer === "function"
          ) {
            const dataProducerId = data && (data.id || data.dataProducerId);
            if (dataProducerId) {
              console.log("[Netplay] new-data-producer received", {
                dataProducerId,
              });
              await this.netplayConsumeSFUDataProducer(dataProducerId);
            }
          }
        } catch (e) {
          console.warn("[Netplay] Failed handling new-data-producer", e);
        }
      });

      // Netplay system messages.
      this.netplay.socket.on("netplay-host-paused", (data) => {
        try {
          if (!this.netplay || this.netplay.owner) return;
          console.log("[Netplay] netplay-host-paused received", data);
          this.netplayShowHostPausedOverlay();
        } catch (e) {
          // ignore
        }
      });
      this.netplay.socket.on("netplay-host-resumed", (data) => {
        try {
          if (!this.netplay || this.netplay.owner) return;
          console.log("[Netplay] netplay-host-resumed received", data);
          this.netplayHideHostPausedOverlay();
        } catch (e) {
          // ignore
        }
      });
      this.netplay.socket.on("users-updated", (users) => {
        const currentPlayers = users || {};
        const previousPlayerIds = Object.keys(this.netplay.previousPlayers);
        const currentPlayerIds = Object.keys(currentPlayers);

        // Find who joined
        currentPlayerIds.forEach((id) => {
          if (!previousPlayerIds.includes(id) && id !== this.netplay.playerID) {
            const playerName = currentPlayers[id].player_name || "A player";
            this.displayMessage(`${playerName} has joined the room.`);
          }
        });

        // Find who left
        previousPlayerIds.forEach((id) => {
          if (!currentPlayerIds.includes(id)) {
            const playerName =
              this.netplay.previousPlayers[id].player_name || "A player";
            this.displayMessage(`${playerName} has left the room.`);
          }
        });

        this.netplay.previousPlayers = currentPlayers;

        console.log("Users updated:", users);
        this.netplay.players = users;
        this.netplayUpdatePlayersTable();

        // Clean up any peer connections for peers that are no longer in the room.
        // Otherwise the host can show "Attempting to reconnect..." and churn ICE after
        // a player intentionally leaves.
        try {
          const activeSocketIds = new Set(
            Object.values(this.netplay.players || {})
              .map((p) => p && p.socketId)
              .filter(Boolean)
          );
          if (this.netplay.peerConnections) {
            Object.keys(this.netplay.peerConnections).forEach(
              (peerSocketId) => {
                if (!activeSocketIds.has(peerSocketId)) {
                  const stale = this.netplay.peerConnections[peerSocketId];
                  try {
                    if (stale && stale._reconnectTimeoutId) {
                      clearTimeout(stale._reconnectTimeoutId);
                      stale._reconnectTimeoutId = null;
                    }
                  } catch (e) {
                    // ignore
                  }
                  try {
                    if (stale && stale.dataChannel) stale.dataChannel.close();
                  } catch (e) {
                    // ignore
                  }
                  try {
                    if (stale && stale.pc) stale.pc.close();
                  } catch (e) {
                    // ignore
                  }
                  delete this.netplay.peerConnections[peerSocketId];
                }
              }
            );
          }
        } catch (e) {
          console.warn("[Netplay] users-updated peer cleanup failed", e);
        }

        // users-updated can fire before SFU decision is made (especially right after connect).
        // Creating a P2P peer connection too early may create recvonly video + timeouts and
        // force the client to leave even while SFU is working.
        if (!this.netplay || this.netplay._sfuDecisionMade !== true) {
          console.log(
            "[Netplay] users-updated received before SFU decision; deferring P2P init"
          );
          return;
        }

        if (typeof this.netplayInitControlsP2P === "function") {
          this.netplayInitControlsP2P(!!this.netplay.useSFU);
        }
        if (this.netplay.owner) {
          console.log("Owner setting up WebRTC for updated users...");
          (async () => {
            const localSocketId =
              this.netplay && this.netplay.socket && this.netplay.socket.id
                ? String(this.netplay.socket.id).trim()
                : null;
            const localUserid =
              this.netplay && this.netplay.playerID
                ? String(this.netplay.playerID).trim()
                : null;

            // In SFU mode we still want P2P for controls even if P2P media
            // stream init fails/isn't needed.
            if (!this.netplay.useSFU) {
              const ok = await this.netplayInitWebRTCStream().catch((err) => {
                console.error("users-updated: init stream failed", err);
                return false;
              });
              if (!ok)
                return console.warn(
                  "users-updated: unable to init local stream; skipping peer setup"
                );
            }
            Object.keys(users).forEach((playerId) => {
              // Some deployments key `users` by username (not userid), so this check alone
              // does NOT reliably exclude the local player.
              if (playerId === this.netplay.playerID) return;

              const extra =
                this.netplay.players && this.netplay.players[playerId]
                  ? this.netplay.players[playerId]
                  : null;

              // Skip self by userid when available.
              if (
                extra &&
                localUserid &&
                extra.userid !== undefined &&
                extra.userid !== null &&
                String(extra.userid).trim() === localUserid
              ) {
                return;
              }

              const socketIdRaw = extra && (extra.socketId || extra.socket_id);
              const peerSocketId = socketIdRaw
                ? String(socketIdRaw).trim()
                : "";
              if (!peerSocketId) {
                console.error(
                  "No socketId for player",
                  playerId,
                  "- WebRTC may fail"
                );
                return;
              }

              // Skip self by socketId (most reliable).
              if (localSocketId && peerSocketId === localSocketId) {
                return;
              }

              if (!this.netplay.peerConnections[peerSocketId]) {
                console.log(
                  "Creating peer connection for (socketId)",
                  peerSocketId
                );
                this.netplayCreatePeerConnection(peerSocketId, {
                  controlsOnly: !!this.netplay.useSFU,
                });
              }
            });
          })();
        }
      });
      this.netplay.socket.on("disconnect", (reason) => {
        if (this.netplay && this.netplay._leaving) return;

        console.warn("Socket.IO disconnected:", reason);

        // Avoid immediately tearing down the room on transient disconnects.
        // If we don't reconnect shortly, fall back to leaving.
        if (this.netplay._disconnectLeaveTimeoutId) {
          clearTimeout(this.netplay._disconnectLeaveTimeoutId);
        }
        this.netplay._disconnectLeaveTimeoutId = setTimeout(() => {
          try {
            if (this.netplay && !this.netplay._leaving) {
              const stillDisconnected =
                !this.netplay.socket || !this.netplay.socket.connected;
              if (stillDisconnected) {
                this.displayMessage(
                  "Disconnected from server. Leaving room...",
                  3000
                );
                this.netplayLeaveRoom("socket-disconnect-timeout");
              }
            }
          } catch (e) {
            // Best-effort.
          }
        }, 10000);
      });

      this.netplay.socket.on("connect", () => {
        if (this.netplay && this.netplay._disconnectLeaveTimeoutId) {
          clearTimeout(this.netplay._disconnectLeaveTimeoutId);
          this.netplay._disconnectLeaveTimeoutId = null;
        }

        try {
          if (this.netplay && this.netplay._ejsHostAudioHealthTimer) {
            clearInterval(this.netplay._ejsHostAudioHealthTimer);
            this.netplay._ejsHostAudioHealthTimer = null;
          }
          if (this.netplay) this.netplay._ejsHostAudioHealth = null;
        } catch (e) {
          // ignore
        }
      });
      this.netplay.socket.on("data-message", (data) =>
        this.netplayDataMessage(data)
      );

      this.netplay.socket.on("webrtc-signal", async (data) => {
        const { sender, offer, candidate, answer, requestRenegotiate } = data;
        console.log(`Received WebRTC signal from ${sender}:`, {
          offer: !!offer,
          answer: !!answer,
          candidate: !!candidate,
          requestRenegotiate,
        });
        if (!sender && !requestRenegotiate) {
          console.warn(
            "Ignoring signal with no sender and no renegotiation request",
            data
          );
          return;
        }
        if (requestRenegotiate && !sender) {
          console.warn(
            "Ignoring renegotiation request with undefined sender",
            data
          );
          this.netplay.socket.emit("webrtc-signal-error", {
            error: "Renegotiation request missing sender",
            data,
          });
          return;
        }
        let pcData = sender ? this.netplay.peerConnections[sender] : null;

        if (pcData && !pcData.iceCandidateQueue) {
          pcData.iceCandidateQueue = [];
        }

        if (!pcData && sender) {
          console.log(
            "No existing peer connection for",
            sender,
            "- creating new one"
          );
          pcData = {
            pc: this.netplayCreatePeerConnection(sender),
            dataChannel: null,
            iceCandidateQueue: [],
          };
          this.netplay.peerConnections[sender] = pcData;
        }
        const pc = pcData.pc;
        try {
          if (offer) {
            console.log("Processing offer from", sender);
            await pc.setRemoteDescription(new RTCSessionDescription(offer));

            if (pcData.iceCandidateQueue.length > 0) {
              console.log(
                `Processing ${pcData.iceCandidateQueue.length} queued ICE candidates.`
              );
              for (const queuedCandidate of pcData.iceCandidateQueue) {
                await pc.addIceCandidate(new RTCIceCandidate(queuedCandidate));
              }
              pcData.iceCandidateQueue = [];
            }

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            console.log("Sending answer to", sender);
            this.netplay.socket.emit("webrtc-signal", {
              target: sender,
              answer: pc.localDescription,
            });
          } else if (answer) {
            console.log("Processing answer from", sender);
            await pc.setRemoteDescription(new RTCSessionDescription(answer));

            if (pcData.iceCandidateQueue.length > 0) {
              console.log(
                `Processing ${pcData.iceCandidateQueue.length} queued ICE candidates.`
              );
              for (const queuedCandidate of pcData.iceCandidateQueue) {
                await pc.addIceCandidate(new RTCIceCandidate(queuedCandidate));
              }
              pcData.iceCandidateQueue = [];
            }
          } else if (candidate) {
            if (pc.remoteDescription) {
              console.log("Adding ICE candidate from", sender);
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } else {
              console.log(
                "Remote description not set. Queueing ICE candidate from",
                sender
              );
              pcData.iceCandidateQueue.push(candidate);
            }
          } else if (requestRenegotiate && this.netplay.owner) {
            console.log("Owner handling renegotiation request...");
            Object.keys(this.netplay.peerConnections).forEach((peerId) => {
              if (peerId && this.netplay.peerConnections[peerId]) {
                const peerConn = this.netplay.peerConnections[peerId].pc;
                console.log(
                  "Closing and recreating peer connection for",
                  peerId
                );
                peerConn.close();
                delete this.netplay.peerConnections[peerId];
                this.netplayCreatePeerConnection(peerId);
              }
            });
          }
        } catch (error) {
          console.error("WebRTC signaling error:", error);
        }
      });
    };

    this.netplayUpdatePlayersTable = () => {
      if (!this.netplay.playerTable) {
        console.error("netplay.playerTable is undefined");
        return;
      }
      const table = this.netplay.playerTable;
      table.innerHTML = "";

      const playerCount = Object.keys(this.netplay.players).length;
      const maxPlayers = this.netplay.maxPlayers || "?";

      const addToTable = (playerNumber, playerName, statusText) => {
        const row = this.createElement("tr");
        const addCell = (text) => {
          const item = this.createElement("td");
          item.innerText = text;
          row.appendChild(item);
          return item;
        };
        addCell(playerNumber).style.width = "80px";
        addCell(playerName);
        addCell(statusText).style.width = "80px";
        table.appendChild(row);
      };

      let i = 0;
      for (const k in this.netplay.players) {
        const playerNumber = i + 1;
        const playerName = this.netplay.players[k].player_name || "Unknown";
        const statusText = i === 0 ? `${playerCount}/${maxPlayers}` : "";
        addToTable(playerNumber, playerName, statusText);
        i++;
      }
    };

    this.netplayOpenRoom = (roomName, maxPlayers, password) => {
      const sessionid = guidGenerator();
      this.netplay.playerID = guidGenerator();
      this.netplay.players = {};
      this.netplay.maxPlayers = maxPlayers;
      this.netplay.localSlot =
        typeof this.netplayPreferredSlot === "number"
          ? this.netplayPreferredSlot
          : 0;
      // Ensure the leave guard never leaks across sessions.
      this.netplay._leaving = false;
      this.netplay._sfuDecisionMade = false;
      // Force SFU capability to be re-evaluated for this new room/session.
      // (useSFU=false is a cached result; undefined means "unknown")
      this.netplay.useSFU = undefined;
      this.netplay.device = null;
      this.netplay.extra = {
        domain: window.location.host,
        game_id: this.config.gameId,
        room_name: roomName,
        player_name: this.netplay.name,
        player_slot: this.netplay.localSlot,
        // maps a userid from netplay session negotiation to player ID for mapping controls in game
        userid: this.netplay.playerID,
        sessionid: sessionid,
        input_mode:
          this.netplayInputMode ||
          window.EJS_NETPLAY_INPUT_MODE ||
          "unorderedRelay",
      };
      this.netplay.players[this.netplay.playerID] = this.netplay.extra;
      this.netplay.owner = true;

      // Netplay room create error handling
      this.netplayStartSocketIO(() => {
        this.netplay.socket.emit(
          "open-room",
          {
            extra: this.netplay.extra,
            maxPlayers: maxPlayers,
            password: password,
          },
          (error) => {
            if (error) {
              // Room create fails
              console.error("Error opening room:", error);
              // Check if this is an authentication error
              if (
                error.includes("unauthorized") ||
                error.includes("token") ||
                error.includes("auth")
              ) {
                // Call the token refresh function from base.vue
                if (window.handleSfuAuthError) {
                  window.handleSfuAuthError();
                  return; // Don't show error message - refreshing token instead
                }
              }
              // If error for some other reasons unrelated to token validity...
              this.displayMessage("Failed to create room: " + error, 5000);
              return;
            }
            // Room created successfully, join created room.
            this.netplayRoomJoined(true, roomName, password, sessionid);
          }
        );
      });
    };

    this.netplayJoinRoom = (sessionid, roomName, maxPlayers, password) => {
      this.netplay.playerID = guidGenerator();
      this.netplay.players = {};
      this.netplay.maxPlayers = maxPlayers;
      this.netplay.localSlot =
        typeof this.netplayPreferredSlot === "number"
          ? this.netplayPreferredSlot
          : 0;
      // Ensure the leave guard never leaks across sessions.
      this.netplay._leaving = false;
      this.netplay._sfuDecisionMade = false;
      // Force SFU capability to be re-evaluated for this new room/session.
      this.netplay.useSFU = undefined;
      this.netplay.device = null;
      this.netplay.extra = {
        domain: window.location.host,
        game_id: this.config.gameId,
        room_name: roomName,
        player_name: this.netplay.name,
        player_slot: this.netplay.localSlot,
        userid: this.netplay.playerID,
        sessionid: sessionid,
        input_mode:
          this.netplayInputMode ||
          window.EJS_NETPLAY_INPUT_MODE ||
          "unorderedRelay",
      };
      this.netplay.players[this.netplay.playerID] = this.netplay.extra;
      this.netplay.owner = false;

      // Netplay room join error handling
      this.netplayStartSocketIO(() => {
        this.netplay.socket.emit(
          "join-room",
          {
            extra: this.netplay.extra,
            password: password,
          },
          (error, users) => {
            if (error) {
              console.error("Error joining room:", error);

              // Check if this is an auth error
              if (
                error.includes("unauthorized") ||
                error.includes("token") ||
                error.includes("auth")
              ) {
                // Calls the refresh function from base.vue
                if (window.handleSfuAuthError) {
                  window.handleSfuAuthError();
                  return; // Don't show an error message - refreshing token instead.
                }
              }
              // If error for some reason other than authentication...
              alert("Error joining room: " + error);
              return;
            }
            this.netplay.players = users;
            this.netplayRoomJoined(false, roomName, password, sessionid);
          }
        );
      });
    };

    this.netplayRoomJoined = async (isOwner, roomName, password, roomId) => {
      console.log(
        "[Netplay] Build stamp:",
        "sfu-media+p2p-controls-2026-01-06a"
      );
      console.log(
        "[Netplay] netplayRoomJoined called. isOwner:",
        isOwner,
        "players:",
        Object.keys(this.netplay.players)
      );
      EJS_INSTANCE.updateNetplayUI(true);

      if (
        !this.netplay ||
        !this.canvas ||
        !this.elements ||
        !this.elements.parent
      ) {
        console.error("netplayRoomJoined: Required objects are undefined", {
          netplay: !!this.netplay,
          canvas: !!this.canvas,
          elements: !!this.elements,
          parent: !!(this.elements && this.elements.parent),
        });
        this.displayMessage("Failed to initialize netplay room", 5000);
        return;
      }

      if (!this.netplayCanvas) {
        this.netplayCanvas = this.createElement("canvas");
        this.netplayCanvas.classList.add("ejs_canvas");
        this.netplayCanvas.style.display = "none";
        this.netplayCanvas.style.position = "absolute";
        this.netplayCanvas.style.top = "0";
        this.netplayCanvas.style.left = "0";
        this.netplayCanvas.style.zIndex = "5";
        this.netplayCanvas.style.objectFit = "contain";
        this.netplayCanvas.style.width = "100%";
        this.netplayCanvas.style.height = "100%";
        this.netplayCanvas.style.objectPosition = "top center";
      }

      this.isNetplay = true;
      this.netplay.inputs = {};
      this.netplay.owner = isOwner;
      this.netplay._sfuDecisionMade = false;

      // Host local slot override: allow the room owner to switch which player
      // their *local* inputs control, without affecting remote players.
      try {
        if (
          isOwner &&
          this.netplay &&
          this.gameManager &&
          this.gameManager.functions &&
          typeof this.gameManager.functions.simulateInput === "function"
        ) {
          if (!this.netplay._ejsRawSimulateInputFn) {
            this.netplay._ejsRawSimulateInputFn =
              this.gameManager.functions.simulateInput;
          }
          if (!this.netplay._ejsSlotOverrideInstalled) {
            this.netplay._ejsSlotOverrideInstalled = true;
            this.gameManager.functions.simulateInput = (
              player,
              index,
              value
            ) => {
              try {
                if (!this.netplay || !this.isNetplay) {
                  return this.netplay._ejsRawSimulateInputFn(
                    player,
                    index,
                    value
                  );
                }
                if (this.netplay._ejsApplyingRemoteInput) {
                  return this.netplay._ejsRawSimulateInputFn(
                    player,
                    index,
                    value
                  );
                }
                const slot =
                  typeof this.netplay.localSlot === "number"
                    ? this.netplay.localSlot
                    : player;
                return this.netplay._ejsRawSimulateInputFn(slot, index, value);
              } catch (e) {
                return this.netplay._ejsRawSimulateInputFn(
                  player,
                  index,
                  value
                );
              }
            };
          }
        }
      } catch (e) {
        // ignore
      }
      // Hybrid-only build mode: SFU audio/video is mandatory; P2P is controls-only.
      this.netplay._hybridOnly = !!(
        (this.config && this.config.netplayHybridOnly) ||
        window.EJS_NETPLAY_HYBRID_ONLY === true
      );
      // Re-evaluate SFU on every join (do not reuse cached false from a prior run).
      this.netplay.useSFU = undefined;
      // Wait until the emulator/core has started (so canvas/native
      // resolution is stable) before attempting SFU. This avoids
      // capturing a zero-sized canvas from cores that initialize
      // asynchronously.
      const waitForStarted = async (timeout = 10000, interval = 200) => {
        const t0 = Date.now();
        while (!this.started && Date.now() - t0 < timeout) {
          await new Promise((r) => setTimeout(r, interval));
        }
        return this.started;
      };

      try {
        await waitForStarted(10000, 200);
        const useSFU = await this.netplayAttemptSFU();
        this.netplay._sfuDecisionMade = true;
        this.netplay.useSFU = !!useSFU;
        // Now that SFU decision is known, initialize P2P controls appropriately.
        if (typeof this.netplayInitControlsP2P === "function") {
          this.netplayInitControlsP2P(!!useSFU);
        }
        if (useSFU) {
          console.log("Using SFU for netplay");
          if (this.netplay.owner) {
            try {
              const ok = await this.netplayInitWebRTCStream();
              if (ok) await this.netplayCreateSFUTransports();
              else
                console.warn(
                  "SFU init skipped: failed to initialize local stream (owner)"
                );
            } catch (err) {
              console.error("SFU init error (owner):", err);
            }
          } else {
            try {
              await this.netplayCreateSFUTransports();
            } catch (err) {
              console.error("SFU init error (client):", err);
            }
          }
        } else {
          if (this.netplay._hybridOnly) {
            console.error(
              "SFU is required for this build (hybrid-only); leaving room"
            );
            this.displayMessage(
              "Netplay requires SFU (hybrid-only build).",
              5000
            );
            this.netplayLeaveRoom("sfu-required");
            return;
          }
          console.log("SFU not used; falling back to peer-to-peer");
        }
      } catch (err) {
        console.warn("netplayAttemptSFU failed or timed out:", err);
      }

      // Input channel selection (can be changed mid-session).
      // Non-owner sends inputs either via SFU DataChannel relay (ordered/unordered)
      // or via P2P unordered DataChannel.
      this.netplayTeardownRelayInputs = (reason) => {
        try {
          if (!this.netplay) return;
          if (this.netplay.inputDataProducer) {
            try {
              this.netplay.inputDataProducer.close();
            } catch (e) {}
            this.netplay.inputDataProducer = null;
          }
        } catch (e) {
          console.warn("[Netplay] Failed to teardown relay inputs", {
            reason,
            error: e,
          });
        }
      };

      this.netplayTeardownUnorderedP2PInputs = (reason) => {
        try {
          if (!this.netplay) return;
          Object.values(this.netplay.peerConnections || {}).forEach(
            (pcData) => {
              const dc = pcData && pcData.unorderedDataChannel;
              if (!dc) return;
              try {
                if (dc.readyState !== "closed") dc.close();
              } catch (e) {}
              try {
                pcData.unorderedDataChannel = null;
              } catch (e) {}
            }
          );
        } catch (e) {
          console.warn("[Netplay] Failed to teardown unordered P2P inputs", {
            reason,
            error: e,
          });
        }
      };

      this.netplayEnsureUnorderedP2PInputs = (retries, reason) => {
        try {
          if (!this.netplay) return;
          Object.values(this.netplay.peerConnections || {}).forEach(
            (pcData) => {
              if (!pcData || !pcData.pc) return;

              // Recreate the channel to apply changed retransmit settings.
              if (pcData.unorderedDataChannel) {
                try {
                  if (pcData.unorderedDataChannel.readyState !== "closed") {
                    pcData.unorderedDataChannel.close();
                  }
                } catch (e) {}
                pcData.unorderedDataChannel = null;
              }

              const dc = pcData.pc.createDataChannel("inputs-unordered", {
                ordered: false,
                maxRetransmits: retries,
              });
              dc.onopen = () =>
                console.log("[Netplay] Unordered P2P input channel open", {
                  reason,
                });
              dc.onclose = () =>
                console.warn("[Netplay] Unordered P2P input channel closed", {
                  reason,
                });
              dc.onerror = (e) =>
                console.error("[Netplay] Unordered P2P input channel error", e);
              pcData.unorderedDataChannel = dc;
            }
          );
        } catch (e) {
          console.warn("[Netplay] Failed ensuring unordered P2P channel", e);
        }
      };

      this.netplayApplyInputMode = async (reason) => {
        try {
          if (!this.isNetplay || !this.netplay) return;
          if (this.netplay.owner) return;

          const retriesRaw =
            typeof this.netplayUnorderedRetries === "number" ||
            typeof this.netplayUnorderedRetries === "string"
              ? this.netplayUnorderedRetries
              : window.EJS_NETPLAY_UNORDERED_RETRIES;
          let retries = parseInt(retriesRaw, 10);
          if (isNaN(retries)) retries = 0;
          if (retries < 0) retries = 0;
          if (retries > 2) retries = 2;

          const mode =
            (typeof this.netplayInputMode === "string" &&
              this.netplayInputMode) ||
            (typeof window.EJS_NETPLAY_INPUT_MODE === "string" &&
              window.EJS_NETPLAY_INPUT_MODE) ||
            "unorderedRelay";

          if (mode === "orderedRelay" || mode === "unorderedRelay") {
            if (!this.netplay.useSFU) {
              console.warn(
                "[Netplay] Input mode is relay but SFU is not available"
              );
              return;
            }

            // Data-only switch: ensure we only have one input path alive.
            this.netplayTeardownUnorderedP2PInputs("switch-to-relay:" + reason);
            this.netplayTeardownRelayInputs("switch-to-relay:" + reason);

            // Do not recreate SFU media transports here.
            if (typeof this.netplayEnsureSFUInputSendTransport === "function") {
              await this.netplayEnsureSFUInputSendTransport();
            }

            if (
              !this.netplay.inputSendTransport ||
              typeof this.netplay.inputSendTransport.produceData !== "function"
            ) {
              console.warn("[Netplay] inputSendTransport not ready for relay");
              return;
            }

            const ordered = mode === "orderedRelay";
            const produceOpts = {
              ordered,
              label: "ejs-inputs",
              protocol: "json",
              appData: { ejsType: "inputs", ejsInputMode: mode },
            };
            if (!ordered) produceOpts.maxRetransmits = retries;

            this.netplay.inputDataProducer =
              await this.netplay.inputSendTransport.produceData(produceOpts);
            console.log("[Netplay] Input relay channel ready", {
              reason,
              mode,
              dataProducerId: this.netplay.inputDataProducer.id,
            });
            return;
          }

          // unorderedP2P
          this.netplayTeardownRelayInputs("switch-to-unorderedP2P:" + reason);
          this.netplayTeardownUnorderedP2PInputs(
            "switch-to-unorderedP2P:" + reason
          );
          this.netplayEnsureUnorderedP2PInputs(retries, reason);
        } catch (e) {
          console.warn("[Netplay] netplayApplyInputMode failed", e);
        }
      };

      try {
        await this.netplayApplyInputMode("join");
      } catch (e) {
        // ignore
      }
      console.log("Room joined with extra:", this.netplay.extra);

      if (this.netplay.roomNameElem) {
        this.netplay.roomNameElem.innerText = roomName;
      }
      if (this.netplay.tabs && this.netplay.tabs[0] && this.netplay.tabs[1]) {
        this.netplay.tabs[0].style.display = "none";
        this.netplay.tabs[1].style.display = "";
      }
      if (this.netplay.passwordElem) {
        if (password) {
          this.netplay.passwordElem.style.display = "";
          this.netplay.passwordElem.innerText =
            this.localization("Password") + ": " + password;
        } else {
          this.netplay.passwordElem.style.display = "none";
        }
      }
      if (this.netplay.createButton) {
        this.netplay.createButton.innerText = this.localization("Leave Room");
      }
      this.netplayUpdatePlayersTable();

      // Netplay overlays use absolute positioning; keep a positioning context,
      // but do not force viewport dimensions (breaks embeds).
      if (this.elements.parent && this.elements.parent.style) {
        if (!this.elements.parent.style.position) {
          this.elements.parent.style.position = "relative";
        }
      }

      const { width: nativeWidth, height: nativeHeight } =
        this.getNativeResolution() || {
          width: 700,
          height: 720,
        };

      if (!this.netplay.owner) {
        // In SFU mode, the non-owner is a spectator: show the SFU video and
        // keep the emulator canvas out of the layout (but not 0x0 / display:none,
        // which can trigger Emscripten screen dimension errors in some cores).
        if (this.netplay.useSFU) {
          // Spectator mode: do not run local emulation/audio; watch SFU media.
          try {
            this.gameManager.toggleMainLoop(0);
            this.paused = true;
            this.netplay._spectatorPausedLocal = true;
          } catch (e) {
            // ignore
          }
          try {
            const audioCtx =
              this.Module &&
              this.Module.AL &&
              this.Module.AL.currentCtx &&
              this.Module.AL.currentCtx.audioCtx;
            if (audioCtx && audioCtx.state === "running") {
              audioCtx.suspend();
              this.netplay._spectatorSuspendedAudio = true;
            }
          } catch (e) {
            // ignore
          }

          if (this.canvas) {
            this.canvas.width = 1;
            this.canvas.height = 1;
            Object.assign(this.canvas.style, {
              display: "block",
              position: "absolute",
              left: "-9999px",
              top: "-9999px",
              width: "1px",
              height: "1px",
              opacity: "0",
              pointerEvents: "none",
            });
            try {
              if (this.Module && this.Module.setCanvasSize) {
                this.Module.setCanvasSize(1, 1);
              }
            } catch (e) {
              // Best-effort; some cores may not expose setCanvasSize here.
            }
          }

          if (!this.netplay.videoContainer) {
            this.netplay.videoContainer = this.createElement("div");
            Object.assign(this.netplay.videoContainer.style, {
              position: "absolute",
              top: "0",
              left: "0",
              width: "100%",
              height: "100%",
              zIndex: "5",
              background: "black",
              pointerEvents: "none",
            });
          }
          // If we previously left a room, videoContainer may be display:none.
          // Ensure it's visible again when joining in SFU spectator mode.
          this.netplay.videoContainer.style.display = "block";
          if (!this.netplay.videoContainer.parentElement) {
            this.elements.parent.appendChild(this.netplay.videoContainer);
          }
          if (this.netplayCanvas) {
            this.netplayCanvas.style.display = "none";
          }
        } else {
          // P2P fallback (legacy): display the netplay canvas.
          this.canvas.style.display = "none";
          if (!this.netplayCanvas.parentElement) {
            this.elements.parent.appendChild(this.netplayCanvas);
            console.log(
              "Appended netplayCanvas to this.elements.parent:",
              this.elements.parent
            );
          }
          this.netplayCanvas.width = nativeWidth;
          this.netplayCanvas.height = nativeHeight;
          Object.assign(this.netplayCanvas.style, {
            position: "absolute",
            top: "0",
            left: "0",
            width: "100%",
            height: "100%",
            zIndex: "5",
            display: "block",
            pointerEvents: "none",
          });
        }

        const parentStyles = window.getComputedStyle(this.elements.parent);
        console.log("Parent container styles:", {
          display: parentStyles.display,
          visibility: parentStyles.visibility,
          opacity: parentStyles.opacity,
          position: parentStyles.position,
          zIndex: parentStyles.zIndex,
        });

        if (
          this.elements.bottomBar &&
          this.elements.bottomBar.cheat &&
          this.elements.bottomBar.cheat[0]
        ) {
          this.netplay.oldStyles = [
            this.elements.bottomBar.cheat[0].style.display,
          ];
          this.elements.bottomBar.cheat[0].style.display = "none";
        }
        if (this.gameManager && this.gameManager.resetCheat) {
          this.gameManager.resetCheat();
        }
        console.log("Player 2 joined, awaiting WebRTC stream...");
        this.elements.parent.focus();

        // For the spectator client in SFU mode, keyboard/gamepad events still
        // flow through GameManager.simulateInput(). Intercept that path and
        // forward inputs over the P2P data channel to the host.
        if (
          this.gameManager &&
          typeof this.gameManager.simulateInput === "function"
        ) {
          if (!this.netplay.originalSimulateInputMethod) {
            this.netplay.originalSimulateInputMethod =
              this.gameManager.simulateInput;
          }

          const sendInputOverDataChannel = (player, index, value) => {
            let playerIndex = parseInt(player, 10);
            if (isNaN(playerIndex)) playerIndex = 0;
            if (playerIndex < 0) playerIndex = 0;
            if (playerIndex > 3) playerIndex = 3;

            // Live slot switching: always send as the currently selected local slot.
            try {
              const slotRaw =
                (this.netplay &&
                  (this.netplay.localSlot ??
                    this.netplayPreferredSlot ??
                    window.EJS_NETPLAY_PREFERRED_SLOT)) ||
                0;
              let slot = parseInt(slotRaw, 10);
              if (!isNaN(slot)) {
                if (slot < 0) slot = 0;
                if (slot > 3) slot = 3;
                playerIndex = slot;
              }
            } catch (e) {
              // ignore
            }
            const mode =
              (typeof this.netplayInputMode === "string" &&
                this.netplayInputMode) ||
              (typeof window.EJS_NETPLAY_INPUT_MODE === "string" &&
                window.EJS_NETPLAY_INPUT_MODE) ||
              "unorderedRelay";

            const retriesRaw =
              typeof this.netplayUnorderedRetries === "number" ||
              typeof this.netplayUnorderedRetries === "string"
                ? this.netplayUnorderedRetries
                : window.EJS_NETPLAY_UNORDERED_RETRIES;
            let retries = parseInt(retriesRaw, 10);
            if (isNaN(retries)) retries = 0;
            if (retries < 0) retries = 0;
            if (retries > 2) retries = 2;

            // For unordered channels with maxRetransmits=0, send a full controller snapshot
            // (default state merged with current held state) in every packet.
            const shouldSendSnapshot =
              retries === 0 &&
              (mode === "unorderedRelay" || mode === "unorderedP2P");

            let payload;
            if (shouldSendSnapshot) {
              try {
                if (!this.netplay) this.netplay = {};
                if (!Array.isArray(this.netplay.localInputState)) {
                  this.netplay.localInputState = new Array(30).fill(0);
                }
                const idx = parseInt(index, 10);
                if (!isNaN(idx) && idx >= 0 && idx < 30) {
                  const v = parseInt(value, 10);
                  this.netplay.localInputState[idx] = isNaN(v) ? 0 : v;
                }
                payload = JSON.stringify({
                  player: playerIndex,
                  state: this.netplay.localInputState,
                });
              } catch (e) {
                payload = JSON.stringify({ player: playerIndex, index, value });
              }
            } else {
              payload = JSON.stringify({ player: playerIndex, index, value });
            }
            try {
              if (mode === "orderedRelay" || mode === "unorderedRelay") {
                const dp = this.netplay && this.netplay.inputDataProducer;
                if (dp && !dp.closed && typeof dp.send === "function") {
                  dp.send(payload);
                  return;
                }
              }

              if (mode === "unorderedP2P") {
                let sent = false;
                Object.values(this.netplay.peerConnections || {}).forEach(
                  (pcData) => {
                    if (
                      pcData &&
                      pcData.unorderedDataChannel &&
                      pcData.unorderedDataChannel.readyState === "open"
                    ) {
                      pcData.unorderedDataChannel.send(payload);
                      sent = true;
                    }
                  }
                );
                if (sent) return;
              }

              // Fallback: ordered P2P inputs channel.
              Object.values(this.netplay.peerConnections || {}).forEach(
                (pcData) => {
                  if (
                    pcData &&
                    pcData.dataChannel &&
                    pcData.dataChannel.readyState === "open"
                  ) {
                    pcData.dataChannel.send(payload);
                  }
                }
              );
            } catch (e) {
              console.error("Failed to send input over dataChannel:", e);
            }
          };

          this.gameManager.simulateInput = (player, index, value) => {
            console.log("Player 2 input:", {
              player,
              index,
              value,
              playerIndex: this.netplayGetUserIndex(),
            });
            sendInputOverDataChannel(player, index, value);
          };

          // Some code paths call gameManager.functions.simulateInput.
          if (
            this.gameManager.functions &&
            typeof this.gameManager.functions.simulateInput === "function"
          ) {
            if (!this.netplay.originalSimulateInputFn) {
              this.netplay.originalSimulateInputFn =
                this.gameManager.functions.simulateInput;
            }
            this.gameManager.functions.simulateInput = (
              player,
              index,
              value
            ) => {
              console.log("Player 2 input (fn):", {
                player,
                index,
                value,
                playerIndex: this.netplayGetUserIndex(),
              });
              sendInputOverDataChannel(player, index, value);
            };
          }
        } else {
          console.error(
            "Cannot override simulateInput: gameManager.simulateInput is undefined"
          );
        }

        if (this.isMobile && this.gamepadElement) {
          const newGamepad = this.gamepadElement.cloneNode(true);
          this.gamepadElement.parentNode.replaceChild(
            newGamepad,
            this.gamepadElement
          );
          this.gamepadElement = newGamepad;
          Object.assign(this.gamepadElement.style, {
            zIndex: "1000",
            position: "absolute",
            pointerEvents: "auto",
          });

          this.gamepadElement.addEventListener(
            "touchstart",
            (e) => {
              e.preventDefault();
              const button = e.target.closest("[data-button]");
              if (
                button &&
                this.gameManager &&
                this.gameManager.functions &&
                this.gameManager.functions.simulateInput
              ) {
                this.gameManager.functions.simulateInput(
                  0,
                  button.dataset.button,
                  1
                );
              }
            },
            {
              passive: false,
            }
          );

          this.gamepadElement.addEventListener(
            "touchend",
            (e) => {
              e.preventDefault();
              const button = e.target.closest("[data-button]");
              if (
                button &&
                this.gameManager &&
                this.gameManager.functions &&
                this.gameManager.functions.simulateInput
              ) {
                this.gameManager.functions.simulateInput(
                  0,
                  button.dataset.button,
                  0
                );
              }
            },
            {
              passive: false,
            }
          );

          this.gamepadElement.focus();
        }
        const updateGamepadStyles = () => {
          if (this.isMobile && this.gamepadElement) {
            Object.assign(this.gamepadElement.style, {
              zIndex: "1000",
              position: "absolute",
              pointerEvents: "auto",
            });
            this.netplayCanvas.style.pointerEvents = "none";
            this.netplayCanvas.width = nativeWidth;
            this.netplayCanvas.height = nativeHeight;
            this.netplayCanvas.style.width = "100%";
            this.netplayCanvas.style.height = "100%";
          }
        };
        document.addEventListener("fullscreenchange", updateGamepadStyles);
        document.addEventListener(
          "webkitfullscreenchange",
          updateGamepadStyles
        );

        // Keep a handle so we can cancel the timeout if we leave early.
        if (this.netplay._webrtcReadyTimeoutId) {
          clearTimeout(this.netplay._webrtcReadyTimeoutId);
        }
        this.netplay._webrtcReadyTimeoutId = setTimeout(() => {
          const hasOpenDataChannel = () => {
            try {
              return Object.values(this.netplay.peerConnections || {}).some(
                (pcData) =>
                  pcData &&
                  pcData.dataChannel &&
                  pcData.dataChannel.readyState === "open"
              );
            } catch (e) {
              return false;
            }
          };

          const hasSFUVideoFrames = () => {
            try {
              return (
                !!this.netplay.video &&
                this.netplay.video.videoWidth > 0 &&
                this.netplay.video.videoHeight > 0
              );
            } catch (e) {
              return false;
            }
          };

          const ready =
            !!this.netplay.webRtcReady ||
            hasOpenDataChannel() ||
            hasSFUVideoFrames();

          if (!ready) {
            console.error("WebRTC connection not established after timeout");
            this.displayMessage(
              "Failed to connect to Player 1. Please check your network and try again.",
              5000
            );
            if (this.interactionOverlay) {
              this.interactionOverlay.remove();
              this.interactionOverlay = null;
            }
            this.netplayLeaveRoom("webrtc-ready-timeout");
          } else {
            console.log("Netplay ready before timeout", {
              webRtcReady: !!this.netplay.webRtcReady,
              hasOpenDataChannel: hasOpenDataChannel(),
              hasSFUVideoFrames: hasSFUVideoFrames(),
            });
          }
        }, 10000);
      } else {
        if (this.canvas) {
          this.canvas.width = nativeWidth;
          this.canvas.height = nativeHeight;
          this.canvas.style.display = "block";
          this.canvas.style.objectFit = "contain";
        }
        if (this.netplayCanvas) {
          this.netplayCanvas.style.display = "none";
        }
        if (this.netplay.videoContainer) {
          this.netplay.videoContainer.style.display = "none";
        }
        if (
          this.elements.bottomBar &&
          this.elements.bottomBar.cheat &&
          this.elements.bottomBar.cheat[0]
        ) {
          this.netplay.oldStyles = [
            this.elements.bottomBar.cheat[0].style.display,
          ];
        }

        if (this.netplay.owner && this.Module && this.Module.setCanvasSize) {
          this.Module.setCanvasSize(nativeWidth, nativeHeight);
        }

        this.netplay.lockedAspectRatio = nativeWidth / nativeHeight;
        const resizeCanvasWithAspect = () => {
          const aspect = this.netplay.lockedAspectRatio;
          let vw = 0;
          let vh = 0;
          try {
            const container =
              (this.netplay && this.netplay.videoContainer) ||
              (this.elements && this.elements.parent) ||
              null;
            if (
              container &&
              typeof container.getBoundingClientRect === "function"
            ) {
              const rect = container.getBoundingClientRect();
              vw = rect.width;
              vh = rect.height;
            }
          } catch (e) {
            // ignore
          }
          // On first netplay initialization, the container can briefly report
          // 0x0 while layout settles. Falling back to window size causes an
          // oversized canvas until the user manually resizes the window.
          // Instead, retry briefly until we can read the real container size.
          if (!vw || !vh) {
            const start =
              (this.netplay && this.netplay._resizeInitStart) || Date.now();
            if (this.netplay) this.netplay._resizeInitStart = start;
            if (Date.now() - start < 1500) {
              if (
                typeof window !== "undefined" &&
                window.requestAnimationFrame
              ) {
                window.requestAnimationFrame(resizeCanvasWithAspect);
              } else {
                setTimeout(resizeCanvasWithAspect, 50);
              }
              return;
            }
            // Last resort: if the container never reports a size, fall back.
            vw = window.innerWidth;
            vh = window.innerHeight;
          } else if (this.netplay) {
            this.netplay._resizeInitStart = null;
          }
          let newWidth, newHeight;

          if (vw / vh > aspect) {
            newHeight = vh;
            newWidth = vh * aspect;
          } else {
            newWidth = vw;
            newHeight = vw / aspect;
          }

          if (this.canvas) {
            Object.assign(this.canvas.style, {
              width: `${newWidth}px`,
              height: `${newHeight}px`,
              display: "block",
              objectFit: "contain",
            });

            // Keep the resized canvas horizontally centered. Use normal flow
            // centering (margin auto) to avoid snapping back to left alignment
            // if other code clears absolute-positioning styles.
            Object.assign(this.canvas.style, {
              position: "relative",
              top: "0",
              left: "0",
              transform: "none",
              marginLeft: "auto",
              marginRight: "auto",
            });
          }

          // If a netplay video element is present (SFU or legacy video overlay),
          // keep it sized/centered like the main canvas.
          try {
            const v = this.netplay && this.netplay.video;
            if (v && v.style && v.parentElement) {
              Object.assign(v.style, {
                width: `${newWidth}px`,
                height: `${newHeight}px`,
                display: "block",
                position: "absolute",
                top: "0",
                left: "50%",
                transform: "translateX(-50%)",
                objectFit: "contain",
                objectPosition: "top center",
                pointerEvents: "none",
                background: "black",
              });
            }
          } catch (e) {
            // ignore
          }
        };
        this._netplayResizeCanvas = resizeCanvasWithAspect;
        window.addEventListener("resize", resizeCanvasWithAspect);
        document.addEventListener("fullscreenchange", resizeCanvasWithAspect);
        document.addEventListener(
          "webkitfullscreenchange",
          resizeCanvasWithAspect
        );
        resizeCanvasWithAspect();
        window.dispatchEvent(new Event("resize"));
      }
    };

    this.netplayLeaveRoom = (reason) => {
      EJS_INSTANCE.updateNetplayUI(false);

      // Guard against recursive/double leave (e.g. socket disconnect handler
      // firing due to our own socket.disconnect()).
      if (this.netplay && this.netplay._leaving) return;
      if (this.netplay) this.netplay._leaving = true;

      try {
        console.warn("[Netplay] Leaving netplay room", {
          reason: reason || "(unknown)",
          useSFU: !!(this.netplay && this.netplay.useSFU),
          sfuDecisionMade: !!(this.netplay && this.netplay._sfuDecisionMade),
          webRtcReady: !!(this.netplay && this.netplay.webRtcReady),
          hasVideo: !!(this.netplay && this.netplay.video),
          videoSize:
            this.netplay && this.netplay.video
              ? {
                  videoWidth: this.netplay.video.videoWidth,
                  videoHeight: this.netplay.video.videoHeight,
                }
              : null,
        });
        try {
          console.trace("[Netplay] netplayLeaveRoom() trace");
        } catch (e) {
          // ignore
        }

        console.log(
          `Leaving netplay room... [reason=${reason || "(unknown)"}]`
        );

        if (this.netplay && this.netplay._webrtcReadyTimeoutId) {
          clearTimeout(this.netplay._webrtcReadyTimeoutId);
          this.netplay._webrtcReadyTimeoutId = null;
        }

        if (this.netplay && this.netplay._disconnectLeaveTimeoutId) {
          clearTimeout(this.netplay._disconnectLeaveTimeoutId);
          this.netplay._disconnectLeaveTimeoutId = null;
        }

        if (this.netplay.owner && this.netplaySendMessage) {
          this.netplaySendMessage({
            type: "host-left",
          });
        }

        if (this.netplay.socket && this.netplay.socket.connected) {
          this.netplay.socket.emit("leave-room");
        }

        if (this.netplay.socket) {
          this.netplay.socket.disconnect();
          this.netplay.socket = null;
        }

        // Tear down SFU state so a re-join starts clean.
        try {
          if (this.netplay && this.netplay._ejsClientAudioHealthTimer) {
            clearInterval(this.netplay._ejsClientAudioHealthTimer);
            this.netplay._ejsClientAudioHealthTimer = null;
          }
          if (this.netplay) {
            this.netplay._ejsClientAudioHealth = null;
            this.netplay._ejsAttemptClientSfuAudioRecovery = null;
            this.netplay._ejsSfuAudioProducerId = null;
            this.netplay.audioConsumer = null;
          }
        } catch (e) {}

        try {
          if (this.netplay.producer) this.netplay.producer.close();
        } catch (e) {}
        this.netplay.producer = null;

        try {
          if (this.netplay.audioProducer) this.netplay.audioProducer.close();
        } catch (e) {}
        this.netplay.audioProducer = null;

        try {
          if (this.netplay.sendTransport) this.netplay.sendTransport.close();
        } catch (e) {}
        this.netplay.sendTransport = null;

        try {
          if (this.netplay.recvTransport) this.netplay.recvTransport.close();
        } catch (e) {}
        this.netplay.recvTransport = null;

        this.netplay.device = null;
        // Set to undefined so netplayAttemptSFU() will actually retry on next join.
        this.netplay.useSFU = undefined;
        this.netplay._sfuDecisionMade = false;

        if (this.netplay.localStream) {
          this.netplay.localStream.getTracks().forEach((track) => track.stop());
          this.netplay.localStream = null;
        }

        try {
          this.netplayConsumeSFUProducer = null;
        } catch (e) {}
        try {
          if (this.netplay.sfuConsumedProducerIds)
            this.netplay.sfuConsumedProducerIds.clear();
        } catch (e) {}

        if (this.netplay.sfuStream) {
          try {
            this.netplay.sfuStream.getTracks().forEach((track) => {
              try {
                track.stop();
              } catch (e) {}
            });
          } catch (e) {}
          this.netplay.sfuStream = null;
        }

        if (this.netplay.sfuAudioStream) {
          try {
            this.netplay.sfuAudioStream.getTracks().forEach((track) => {
              try {
                track.stop();
              } catch (e) {}
            });
          } catch (e) {}
          this.netplay.sfuAudioStream = null;
        }

        if (this.netplay.sfuVideoStream) {
          try {
            this.netplay.sfuVideoStream.getTracks().forEach((track) => {
              try {
                track.stop();
              } catch (e) {}
            });
          } catch (e) {}
          this.netplay.sfuVideoStream = null;
        }

        if (this.netplay.peerConnections) {
          Object.values(this.netplay.peerConnections).forEach((pcData) => {
            if (pcData.pc) pcData.pc.close();
          });
          this.netplay.peerConnections = {};
        }

        if (this.netplayCanvas && this.netplayCanvas.parentElement) {
          this.netplayCanvas.parentElement.removeChild(this.netplayCanvas);
          this.netplayCanvas.style.display = "none";
        }
        if (this.netplay.video && this.netplay.video.parentElement) {
          this.netplay.video.parentElement.removeChild(this.netplay.video);
          this.netplay.video.srcObject = null;
          this.netplay.video = null;
        }
        if (this.netplay.audioEl && this.netplay.audioEl.parentElement) {
          this.netplay.audioEl.parentElement.removeChild(this.netplay.audioEl);
          try {
            this.netplay.audioEl.srcObject = null;
          } catch (e) {}
          this.netplay.audioEl = null;
        }
        if (this.netplay.videoContainer) {
          this.netplay.videoContainer.style.display = "none";
        }

        // Clear client audio watchdogs.
        try {
          if (this.netplay._ejsClientAudioHealthTimer) {
            clearInterval(this.netplay._ejsClientAudioHealthTimer);
          }
        } catch (e) {}
        this.netplay._ejsClientAudioHealthTimer = null;

        try {
          if (this.netplay._ejsClientAudioSilenceTimer) {
            clearInterval(this.netplay._ejsClientAudioSilenceTimer);
          }
        } catch (e) {}
        this.netplay._ejsClientAudioSilenceTimer = null;

        try {
          const st = this.netplay._ejsClientAudioSilence;
          if (st) {
            try {
              if (st.source) st.source.disconnect();
            } catch (e) {}
            try {
              if (st.analyser) st.analyser.disconnect();
            } catch (e) {}
            try {
              if (st.ctx && st.ctx.state !== "closed") st.ctx.close();
            } catch (e) {}
          }
        } catch (e) {}
        this.netplay._ejsClientAudioSilence = null;

        if (this.canvas) {
          Object.assign(this.canvas.style, {
            display: "block",
            width: "100%",
            height: "100%",
            objectFit: "contain",
            position: "absolute",
            top: "0",
            left: "0",
            transform: "none",
          });
        }

        // If we paused local playback for SFU spectator mode, restore it on leave.
        try {
          if (this.netplay && this.netplay._spectatorSuspendedAudio) {
            const audioCtx =
              this.Module &&
              this.Module.AL &&
              this.Module.AL.currentCtx &&
              this.Module.AL.currentCtx.audioCtx;
            if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
          }
        } catch (e) {
          // ignore
        }
        try {
          if (this.netplay && this.netplay._spectatorPausedLocal) {
            this.gameManager.toggleMainLoop(1);
            this.paused = false;
          }
        } catch (e) {
          // ignore
        }

        if (this.netplay.createButton) {
          this.netplay.createButton.innerText =
            this.localization("Create Room");
        }
        if (this.netplay.tabs) {
          this.netplay.tabs[0].style.display = "";
          this.netplay.tabs[1].style.display = "none";
        }
        if (this.netplay.roomNameElem) {
          this.netplay.roomNameElem.innerText = "";
        }
        if (this.netplay.passwordElem) {
          this.netplay.passwordElem.style.display = "none";
          this.netplay.passwordElem.innerText = "";
        }
        if (this.netplay.playerTable) {
          this.netplay.playerTable.innerHTML = "";
        }

        if (
          this.netplay.oldStyles &&
          this.elements.bottomBar &&
          this.elements.bottomBar.cheat &&
          this.elements.bottomBar.cheat[0]
        ) {
          this.elements.bottomBar.cheat[0].style.display =
            this.netplay.oldStyles[0] || "";
        }

        if (this._netplayResizeCanvas) {
          window.removeEventListener("resize", this._netplayResizeCanvas);
          document.removeEventListener(
            "fullscreenchange",
            this._netplayResizeCanvas
          );
          document.removeEventListener(
            "webkitfullscreenchange",
            this._netplayResizeCanvas
          );
          this._netplayResizeCanvas = null;
        }

        // Restore the original input function when leaving the room
        if (this.gameManager) {
          if (this.netplay.originalSimulateInputMethod) {
            this.gameManager.simulateInput =
              this.netplay.originalSimulateInputMethod;
            this.netplay.originalSimulateInputMethod = null;
          }
          if (
            this.gameManager.functions &&
            this.netplay.originalSimulateInputFn
          ) {
            this.gameManager.functions.simulateInput =
              this.netplay.originalSimulateInputFn;
            this.netplay.originalSimulateInputFn = null;
          }

          // Restore host-side slot override wrapper.
          if (
            this.gameManager.functions &&
            this.netplay &&
            this.netplay._ejsRawSimulateInputFn
          ) {
            this.gameManager.functions.simulateInput =
              this.netplay._ejsRawSimulateInputFn;
            this.netplay._ejsRawSimulateInputFn = null;
            this.netplay._ejsSlotOverrideInstalled = false;
            this.netplay._ejsApplyingRemoteInput = false;
          }
        }

        this.isNetplay = false;
        this.netplay.owner = false;
        this.netplay.players = {};
        this.netplay.playerID = null;
        this.netplay.inputs = {};
        this.netplay.inputsData = {};
        this.netplay.webRtcReady = false;
        this.netplay.lockedAspectRatio = null;
        this.netplay._resizeInitStart = null;
        this.player = 1;

        if (this.originalControls) {
          this.controls = JSON.parse(JSON.stringify(this.originalControls));
          this.originalControls = null;
        }

        if (this.isMobile && this.gamepadElement) {
          Object.assign(this.gamepadElement.style, {
            zIndex: "1000",
            position: "absolute",
            pointerEvents: "auto",
          });
        }

        if (this.gameManager && this.gameManager.restart) {
          this.gameManager.restart();
        } else if (this.startGame) {
          this.startGame();
        }

        this.displayMessage("Left the room", 3000);
      } finally {
        // Always clear the leave guard, even if teardown throws.
        try {
          if (this.netplay) this.netplay._leaving = false;
        } catch (e) {
          // ignore
        }
      }
    };

    this.netplayDataMessage = function (data) {
      if (data["sync-control"]) {
        data["sync-control"].forEach((value) => {
          let inFrame = parseInt(value.frame);
          if (!value.connected_input || value.connected_input[0] < 0) return;
          this.netplay.inputsData[inFrame] =
            this.netplay.inputsData[inFrame] || [];
          this.netplay.inputsData[inFrame].push(value);
          this.netplaySendMessage({
            frameAck: inFrame,
          });
          if (this.netplay.owner) {
            console.log("Owner processing input:", value.connected_input);
            if (
              this.gameManager &&
              this.gameManager.functions &&
              this.gameManager.functions.simulateInput
            ) {
              // Apply remote input without being affected by host slot override.
              const raw = this.netplay && this.netplay._ejsRawSimulateInputFn;
              if (typeof raw === "function") {
                try {
                  this.netplay._ejsApplyingRemoteInput = true;
                  raw(
                    value.connected_input[0],
                    value.connected_input[1],
                    value.connected_input[2]
                  );
                } finally {
                  this.netplay._ejsApplyingRemoteInput = false;
                }
              } else {
                this.gameManager.functions.simulateInput(
                  value.connected_input[0],
                  value.connected_input[1],
                  value.connected_input[2]
                );
              }
            } else {
              console.error(
                "Cannot process input: gameManager.functions.simulateInput is undefined"
              );
            }
          }
        });
      }
      if (data.frameData) {
        console.log("Received frame data on Player 2:", data.frameData);
        if (!this.canvas) {
          console.error("Canvas unavailable for frame data processing");
          return;
        }
        const ctx = this.canvas.getContext("2d");
        if (!ctx) {
          console.error("Canvas context unavailable for frame data processing");
          return;
        }
        if (data.frameData.pixelSample.every((v) => v === 0)) {
          console.warn(
            "Frame data indicates black screen, attempting reconstruction"
          );
          if (this.reconstructFrame) {
            this.reconstructFrame(data.frameData.inputs);
          } else {
            console.error("reconstructFrame is undefined");
          }
        } else {
          console.log("Frame data indicates content, relying on WebRTC stream");
        }
      }
    };

    this.netplaySendMessage = (data) => {
      if (this.netplay.socket && this.netplay.socket.connected) {
        this.netplay.socket.emit("data-message", data);
        console.log("Sent data message:", data);
      } else {
        console.error("Cannot send message: Socket is not connected");
      }
    };

    this.netplayReset = () => {
      this.netplay.init_frame = this.gameManager
        ? this.gameManager.getFrameNum()
        : 0;
      this.netplay.currentFrame = 0;
      this.netplay.inputsData = {};
      this.netplay.syncing = false;
    };

    this.netplayInitModulePostMainLoop = () => {
      if (this.isNetplay && !this.netplay.owner) {
        return;
      }

      this.netplay.currentFrame =
        parseInt(this.gameManager ? this.gameManager.getFrameNum() : 0) -
        (this.netplay.init_frame || 0);
      if (!this.isNetplay) return;

      if (this.netplay.owner) {
        let to_send = [];
        let i = this.netplay.currentFrame;
        if (this.netplay.inputsData[i]) {
          this.netplay.inputsData[i].forEach((value) => {
            if (
              this.gameManager &&
              this.gameManager.functions &&
              this.gameManager.functions.simulateInput
            ) {
              // Replay inputs (local+remote) without forcing the host slot.
              const raw = this.netplay && this.netplay._ejsRawSimulateInputFn;
              if (typeof raw === "function") {
                try {
                  this.netplay._ejsApplyingRemoteInput = true;
                  raw(
                    value.connected_input[0],
                    value.connected_input[1],
                    value.connected_input[2]
                  );
                } finally {
                  this.netplay._ejsApplyingRemoteInput = false;
                }
              } else {
                this.gameManager.functions.simulateInput(
                  value.connected_input[0],
                  value.connected_input[1],
                  value.connected_input[2]
                );
              }
            }
            value.frame = this.netplay.currentFrame + 20;
            to_send.push(value);
          });
          this.netplaySendMessage({
            "sync-control": to_send,
          });
          delete this.netplay.inputsData[i];
        }
      }
    };

    this.netplay.updateList = {
      start: this.netplayUpdateListStart,
      stop: this.netplayUpdateListStop,
    };
    this.netplay.showOpenRoomDialog = this.netplayShowOpenRoomDialog;
    this.netplay.openRoom = this.netplayOpenRoom;
    this.netplay.joinRoom = this.netplayJoinRoom;
    this.netplay.leaveRoom = this.netplayLeaveRoom;
    this.netplay.sendMessage = this.netplaySendMessage;
    this.netplay.updatePlayersTable = this.netplayUpdatePlayersTable;
    this.netplay.createPeerConnection = this.netplayCreatePeerConnection;
    this.netplay.initWebRTCStream = this.netplayInitWebRTCStream;
    this.netplay.roomJoined = this.netplayRoomJoined;

    this.netplay = this.netplay || {};
    this.netplay.init_frame = 0;
    this.netplay.currentFrame = 0;
    this.netplay.inputsData = {};
    this.netplay.syncing = false;
    this.netplay.ready = 0;
    this.netplay.webRtcReady = false;
    this.netplay.peerConnections = this.netplay.peerConnections || {};

    this.netplay.url = this.config.netplayUrl || window.EJS_netplayUrl;

    if (!this.netplay.url) {
      if (this.debug)
        console.error(
          "netplayUrl is not defined. Please set it in EJS_config or as a global EJS_netplayUrl variable."
        );
      this.displayMessage(
        "Network configuration error: netplay URL is not set.",
        5000
      );
      return;
    }

    while (this.netplay.url.endsWith("/")) {
      this.netplay.url = this.netplay.url.substring(
        0,
        this.netplay.url.length - 1
      );
    }
    this.netplay.current_frame = 0;

    if (this.gameManager && this.gameManager.Module) {
      this.gameManager.Module.postMainLoop =
        this.netplayInitModulePostMainLoop.bind(this);
    } else if (this.Module) {
      this.Module.postMainLoop = this.netplayInitModulePostMainLoop.bind(this);
    } else if (this.debug) {
      console.warn("Module is undefined. postMainLoop will not be set.");
    }
  }
  createCheatsMenu() {
    const body = this.createPopup(
      "Cheats",
      {
        "Add Cheat": () => {
          const popups = this.createSubPopup();
          this.cheatMenu.appendChild(popups[0]);
          popups[1].classList.add("ejs_cheat_parent");
          popups[1].style.width = "100%";
          const popup = popups[1];
          const header = this.createElement("div");
          header.classList.add("ejs_cheat_header");
          const title = this.createElement("h2");
          title.innerText = this.localization("Add Cheat Code");
          title.classList.add("ejs_cheat_heading");
          const close = this.createElement("button");
          close.classList.add("ejs_cheat_close");
          header.appendChild(title);
          header.appendChild(close);
          popup.appendChild(header);
          this.addEventListener(close, "click", (e) => {
            popups[0].remove();
          });

          const main = this.createElement("div");
          main.classList.add("ejs_cheat_main");
          const header3 = this.createElement("strong");
          header3.innerText = this.localization("Code");
          main.appendChild(header3);
          main.appendChild(this.createElement("br"));
          const mainText = this.createElement("textarea");
          mainText.classList.add("ejs_cheat_code");
          mainText.style.width = "100%";
          mainText.style.height = "80px";
          main.appendChild(mainText);
          main.appendChild(this.createElement("br"));
          const header2 = this.createElement("strong");
          header2.innerText = this.localization("Description");
          main.appendChild(header2);
          main.appendChild(this.createElement("br"));
          const mainText2 = this.createElement("input");
          mainText2.type = "text";
          mainText2.classList.add("ejs_cheat_code");
          main.appendChild(mainText2);
          main.appendChild(this.createElement("br"));
          popup.appendChild(main);

          const footer = this.createElement("footer");
          const submit = this.createElement("button");
          const closeButton = this.createElement("button");
          submit.innerText = this.localization("Submit");
          closeButton.innerText = this.localization("Close");
          submit.classList.add("ejs_button_button");
          closeButton.classList.add("ejs_button_button");
          submit.classList.add("ejs_popup_submit");
          closeButton.classList.add("ejs_popup_submit");
          submit.style["background-color"] = "rgba(var(--ejs-primary-color),1)";
          footer.appendChild(submit);
          const span = this.createElement("span");
          span.innerText = " ";
          footer.appendChild(span);
          footer.appendChild(closeButton);
          popup.appendChild(footer);

          this.addEventListener(submit, "click", (e) => {
            if (!mainText.value.trim() || !mainText2.value.trim()) return;
            popups[0].remove();
            this.cheats.push({
              code: mainText.value,
              desc: mainText2.value,
              checked: false,
            });
            this.updateCheatUI();
            this.saveSettings();
          });
          this.addEventListener(closeButton, "click", (e) => {
            popups[0].remove();
          });
        },
        Close: () => {
          this.cheatMenu.style.display = "none";
        },
      },
      true
    );
    this.cheatMenu = body.parentElement;
    this.cheatMenu.getElementsByTagName("h4")[0].style["padding-bottom"] =
      "0px";
    const msg = this.createElement("div");
    msg.style["padding-top"] = "0px";
    msg.style["padding-bottom"] = "15px";
    msg.innerText = this.localization(
      "Note that some cheats require a restart to disable"
    );
    body.appendChild(msg);
    const rows = this.createElement("div");
    body.appendChild(rows);
    rows.classList.add("ejs_cheat_rows");
    this.elements.cheatRows = rows;
  }
  updateCheatUI() {
    if (!this.gameManager) return;
    this.elements.cheatRows.innerHTML = "";

    const addToMenu = (desc, checked, code, is_permanent, i) => {
      const row = this.createElement("div");
      row.classList.add("ejs_cheat_row");
      const input = this.createElement("input");
      input.type = "checkbox";
      input.checked = checked;
      input.value = i;
      input.id = "ejs_cheat_switch_" + i;
      row.appendChild(input);
      const label = this.createElement("label");
      label.for = "ejs_cheat_switch_" + i;
      label.innerText = desc;
      row.appendChild(label);
      label.addEventListener("click", (e) => {
        input.checked = !input.checked;
        this.cheats[i].checked = input.checked;
        this.cheatChanged(input.checked, code, i);
        this.saveSettings();
      });
      if (!is_permanent) {
        const close = this.createElement("a");
        close.classList.add("ejs_cheat_row_button");
        close.innerText = "×";
        row.appendChild(close);
        close.addEventListener("click", (e) => {
          this.cheatChanged(false, code, i);
          this.cheats.splice(i, 1);
          this.updateCheatUI();
          this.saveSettings();
        });
      }
      this.elements.cheatRows.appendChild(row);
      this.cheatChanged(checked, code, i);
    };
    this.gameManager.resetCheat();
    for (let i = 0; i < this.cheats.length; i++) {
      addToMenu(
        this.cheats[i].desc,
        this.cheats[i].checked,
        this.cheats[i].code,
        this.cheats[i].is_permanent,
        i
      );
    }
  }
  cheatChanged(checked, code, index) {
    if (!this.gameManager) return;
    this.gameManager.setCheat(index, checked, code);
  }

  enableShader(name) {
    if (!this.gameManager) return;
    try {
      this.Module.FS.unlink("/shader/shader.glslp");
    } catch (e) {}

    if (name === "disabled" || !this.config.shaders[name]) {
      this.gameManager.toggleShader(0);
      return;
    }

    const shaderConfig = this.config.shaders[name];

    if (typeof shaderConfig === "string") {
      this.Module.FS.writeFile("/shader/shader.glslp", shaderConfig, {}, "w+");
    } else {
      const shader = shaderConfig.shader;
      this.Module.FS.writeFile(
        "/shader/shader.glslp",
        shader.type === "base64" ? atob(shader.value) : shader.value,
        {},
        "w+"
      );
      if (shaderConfig.resources && shaderConfig.resources.length) {
        shaderConfig.resources.forEach((resource) => {
          this.Module.FS.writeFile(
            `/shader/${resource.name}`,
            resource.type === "base64" ? atob(resource.value) : resource.value,
            {},
            "w+"
          );
        });
      }
    }

    this.gameManager.toggleShader(1);
  }

  screenshot(callback, source, format, upscale) {
    const imageFormat =
      format ||
      this.getSettingValue("screenshotFormat") ||
      this.capture.photo.format;
    const imageUpscale =
      upscale ||
      parseInt(
        this.getSettingValue("screenshotUpscale") || this.capture.photo.upscale
      );
    const screenshotSource =
      source ||
      this.getSettingValue("screenshotSource") ||
      this.capture.photo.source;
    const videoRotation = parseInt(this.getSettingValue("videoRotation") || 0);
    const aspectRatio =
      this.gameManager.getVideoDimensions("aspect") || 1.333333;
    const gameWidth = this.gameManager.getVideoDimensions("width") || 256;
    const gameHeight = this.gameManager.getVideoDimensions("height") || 224;
    const videoTurned = videoRotation === 1 || videoRotation === 3;
    let width = this.canvas.width;
    let height = this.canvas.height;
    let scaleHeight = imageUpscale;
    let scaleWidth = imageUpscale;
    let scale = 1;

    if (screenshotSource === "retroarch") {
      if (width >= height) {
        width = height * aspectRatio;
      } else if (width < height) {
        height = width / aspectRatio;
      }
      this.gameManager.screenshot().then((screenshot) => {
        const blob = new Blob([screenshot], { type: "image/png" });
        if (imageUpscale === 0) {
          callback(blob, "png");
        } else if (imageUpscale > 1) {
          scale = imageUpscale;
          const img = new Image();
          const screenshotUrl = URL.createObjectURL(blob);
          img.src = screenshotUrl;
          img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = width * scale;
            canvas.height = height * scale;
            const ctx = canvas.getContext("2d", { alpha: false });
            ctx.imageSmoothingEnabled = false;
            ctx.scale(scaleWidth, scaleHeight);
            ctx.drawImage(img, 0, 0, width, height);
            canvas.toBlob(
              (blob) => {
                callback(blob, imageFormat);
                img.remove();
                URL.revokeObjectURL(screenshotUrl);
                canvas.remove();
              },
              "image/" + imageFormat,
              1
            );
          };
        }
      });
    } else if (screenshotSource === "canvas") {
      if (width >= height && !videoTurned) {
        width = height * aspectRatio;
      } else if (width < height && !videoTurned) {
        height = width / aspectRatio;
      } else if (width >= height && videoTurned) {
        width = height * (1 / aspectRatio);
      } else if (width < height && videoTurned) {
        width = height / (1 / aspectRatio);
      }
      if (imageUpscale === 0) {
        scale = gameHeight / height;
        scaleHeight = scale;
        scaleWidth = scale;
      } else if (imageUpscale > 1) {
        scale = imageUpscale;
      }
      const captureCanvas = document.createElement("canvas");
      captureCanvas.width = width * scale;
      captureCanvas.height = height * scale;
      captureCanvas.style.display = "none";
      const captureCtx = captureCanvas.getContext("2d", { alpha: false });
      captureCtx.imageSmoothingEnabled = false;
      captureCtx.scale(scale, scale);
      const imageAspect = this.canvas.width / this.canvas.height;
      const canvasAspect = width / height;
      let offsetX = 0;
      let offsetY = 0;

      if (imageAspect > canvasAspect) {
        offsetX = (this.canvas.width - width) / -2;
      } else if (imageAspect < canvasAspect) {
        offsetY = (this.canvas.height - height) / -2;
      }
      const drawNextFrame = () => {
        captureCtx.drawImage(
          this.canvas,
          offsetX,
          offsetY,
          this.canvas.width,
          this.canvas.height
        );
        captureCanvas.toBlob(
          (blob) => {
            callback(blob, imageFormat);
            captureCanvas.remove();
          },
          "image/" + imageFormat,
          1
        );
      };
      requestAnimationFrame(drawNextFrame);
    }
  }

  takeScreenshot(source, format, upscale) {
    return new Promise((resolve) => {
      this.screenshot(
        async (blob, returnFormat) => {
          const arrayBuffer = await blob.arrayBuffer();
          const uint8 = new Uint8Array(arrayBuffer);
          resolve({ screenshot: uint8, format: returnFormat });
        },
        source,
        format,
        upscale
      );
    });
  }

  collectScreenRecordingMediaTracks(canvasEl, fps, options = {}) {
    let videoTrack = null;

    if (options.audioOnly === true) {
      // Skip video capture entirely; used for audio-only SFU recovery.
      videoTrack = null;
    } else {
      // If the source canvas has zero layout or logical size, create an
      // intermediate hidden canvas with the native resolution and continuously
      // draw frames into it. captureStream() will be taken from that canvas so
      // the resulting MediaStream has valid dimensions.
      let sourceCanvas = canvasEl;
      let stopCopyLoop = null;
      const needsCopy =
        options.forceCopy === true ||
        !canvasEl ||
        canvasEl.width === 0 ||
        canvasEl.height === 0 ||
        canvasEl.clientWidth === 0 ||
        canvasEl.clientHeight === 0;
      if (needsCopy) {
        const native = (this.getNativeResolution &&
          this.getNativeResolution()) || { width: 640, height: 480 };
        const captureCanvas = document.createElement("canvas");
        captureCanvas.width = native.width;
        captureCanvas.height = native.height;
        captureCanvas.style.display = "none";
        // Append to DOM so captureStream works consistently across browsers
        try {
          document.body.appendChild(captureCanvas);
        } catch (e) {
          /* ignore */
        }
        const ctx = captureCanvas.getContext("2d", { alpha: false });
        let rafId = null;
        const doCopy = () => {
          try {
            if (canvasEl && canvasEl.width > 0 && canvasEl.height > 0) {
              ctx.drawImage(
                canvasEl,
                0,
                0,
                captureCanvas.width,
                captureCanvas.height
              );
            }
          } catch (err) {
            // Swallow cross-origin or other draw errors
          }
          rafId = requestAnimationFrame(doCopy);
        };
        doCopy();
        stopCopyLoop = () => {
          if (rafId) cancelAnimationFrame(rafId);
          try {
            captureCanvas.remove();
          } catch (e) {}
        };
        sourceCanvas = captureCanvas;
      }

      const videoTracks = sourceCanvas.captureStream(fps).getVideoTracks();
      if (videoTracks.length !== 0) {
        videoTrack = videoTracks[0];
        if (stopCopyLoop) {
          const origOnEnded = videoTrack.onended;
          videoTrack.onended = (...args) => {
            try {
              stopCopyLoop();
            } catch (e) {}
            if (typeof origOnEnded === "function")
              origOnEnded.apply(videoTrack, args);
          };
        }
      } else {
        if (this.debug) console.error("Unable to capture video stream");
        if (stopCopyLoop) stopCopyLoop();
        return null;
      }
    }

    let audioTrack = null;
    if (
      this.Module.AL &&
      this.Module.AL.currentCtx &&
      this.Module.AL.currentCtx.audioCtx
    ) {
      const alContext = this.Module.AL.currentCtx;
      const audioContext = alContext.audioCtx;

      // IMPORTANT: OpenAL/emscripten may recreate source nodes over time.
      // If we only connect the current `alContext.sources` once, the capture
      // stream can go permanently silent after a source refresh. To avoid
      // “audio drops and stays dropped”, keep wiring new source gain nodes
      // into a stable mixer.
      const mixer = audioContext.createGain();
      mixer.gain.value = 1;
      const destination = audioContext.createMediaStreamDestination();
      mixer.connect(destination);

      const connectedGains =
        typeof WeakSet === "function" ? new WeakSet() : null;
      const connectSourcesToMixer = () => {
        try {
          const sources = alContext.sources;
          if (!sources) return;
          for (const sourceIdx in sources) {
            const src = sources[sourceIdx];
            const g = src && src.gain;
            if (!g || typeof g.connect !== "function") continue;
            if (connectedGains && connectedGains.has(g)) continue;
            try {
              g.connect(mixer);
              if (connectedGains) connectedGains.add(g);
            } catch (e) {
              // ignore connect failures
            }
          }
        } catch (e) {
          // ignore
        }
      };

      connectSourcesToMixer();

      // Periodically re-scan for newly created sources.
      const rewireIntervalMs =
        typeof options.audioRewireIntervalMs === "number" &&
        options.audioRewireIntervalMs > 0
          ? options.audioRewireIntervalMs
          : 2000;
      const rewireTimer = setInterval(connectSourcesToMixer, rewireIntervalMs);

      const audioTracks = destination.stream.getAudioTracks();
      if (audioTracks.length !== 0) {
        audioTrack = audioTracks[0];
        // Clean up the timer and graph when the track is stopped.
        const cleanup = () => {
          try {
            clearInterval(rewireTimer);
          } catch (e) {}
          try {
            mixer.disconnect();
          } catch (e) {}
          try {
            destination.disconnect();
          } catch (e) {}
        };
        try {
          audioTrack.addEventListener("ended", cleanup, { once: true });
        } catch (e) {
          // ignore
        }
        try {
          audioTrack._ejsAudioCaptureCleanup = cleanup;
        } catch (e) {
          // ignore
        }
      } else {
        try {
          clearInterval(rewireTimer);
        } catch (e) {}
        try {
          mixer.disconnect();
        } catch (e) {}
        try {
          destination.disconnect();
        } catch (e) {}
      }
    }

    const stream = new MediaStream();
    if (videoTrack && videoTrack.readyState === "live") {
      stream.addTrack(videoTrack);
    }
    if (audioTrack && audioTrack.readyState === "live") {
      stream.addTrack(audioTrack);
    }

    if (options.audioOnly === true && stream.getAudioTracks().length === 0) {
      return null;
    }
    return stream;
  }

  screenRecord() {
    const captureFps =
      this.getSettingValue("screenRecordingFPS") || this.capture.video.fps;
    const captureFormat =
      this.getSettingValue("screenRecordFormat") || this.capture.video.format;
    const captureUpscale =
      this.getSettingValue("screenRecordUpscale") || this.capture.video.upscale;
    const captureVideoBitrate =
      this.getSettingValue("screenRecordVideoBitrate") ||
      this.capture.video.videoBitrate;
    const captureAudioBitrate =
      this.getSettingValue("screenRecordAudioBitrate") ||
      this.capture.video.audioBitrate;
    const aspectRatio =
      this.gameManager.getVideoDimensions("aspect") || 1.333333;
    const videoRotation = parseInt(this.getSettingValue("videoRotation") || 0);
    const videoTurned = videoRotation === 1 || videoRotation === 3;
    let width = 800;
    let height = 600;
    let frameAspect = this.canvas.width / this.canvas.height;
    let canvasAspect = width / height;
    let offsetX = 0;
    let offsetY = 0;

    const captureCanvas = document.createElement("canvas");
    const captureCtx = captureCanvas.getContext("2d", { alpha: false });
    captureCtx.fillStyle = "#000";
    captureCtx.imageSmoothingEnabled = false;
    const updateSize = () => {
      width = this.canvas.width;
      height = this.canvas.height;
      frameAspect = width / height;
      if (width >= height && !videoTurned) {
        width = height * aspectRatio;
      } else if (width < height && !videoTurned) {
        height = width / aspectRatio;
      } else if (width >= height && videoTurned) {
        width = height * (1 / aspectRatio);
      } else if (width < height && videoTurned) {
        width = height / (1 / aspectRatio);
      }
      canvasAspect = width / height;
      captureCanvas.width = width * captureUpscale;
      captureCanvas.height = height * captureUpscale;
      captureCtx.scale(captureUpscale, captureUpscale);
      if (frameAspect > canvasAspect) {
        offsetX = (this.canvas.width - width) / -2;
      } else if (frameAspect < canvasAspect) {
        offsetY = (this.canvas.height - height) / -2;
      }
    };
    updateSize();
    this.addEventListener(this.canvas, "resize", () => {
      updateSize();
    });

    let animation = true;

    const drawNextFrame = () => {
      captureCtx.drawImage(
        this.canvas,
        offsetX,
        offsetY,
        this.canvas.width,
        this.canvas.height
      );
      if (animation) {
        requestAnimationFrame(drawNextFrame);
      }
    };
    requestAnimationFrame(drawNextFrame);

    const chunks = [];
    const tracks = this.collectScreenRecordingMediaTracks(
      captureCanvas,
      captureFps
    );
    const recorder = new MediaRecorder(tracks, {
      videoBitsPerSecond: captureVideoBitrate,
      audioBitsPerSecond: captureAudioBitrate,
      mimeType: "video/" + captureFormat,
    });
    recorder.addEventListener("dataavailable", (e) => {
      chunks.push(e.data);
    });
    recorder.addEventListener("stop", () => {
      const blob = new Blob(chunks);
      const url = URL.createObjectURL(blob);
      const date = new Date();
      const a = document.createElement("a");
      a.href = url;
      a.download =
        this.getBaseFileName() +
        "-" +
        date.getMonth() +
        "-" +
        date.getDate() +
        "-" +
        date.getFullYear() +
        "." +
        captureFormat;
      a.click();

      animation = false;
      captureCanvas.remove();
    });
    recorder.start();

    return recorder;
  }

  enableSaveUpdateEvent() {
    // https://stackoverflow.com/questions/7616461
    // Modified to accept a buffer instead of a string and return hex instead of an int
    async function cyrb53(charBuffer, seed = 0) {
      let h1 = 0xdeadbeef ^ seed,
        h2 = 0x41c6ce57 ^ seed;
      for (let i = 0, ch; i < charBuffer.length; i++) {
        ch = charBuffer[i];
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
      }
      h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
      h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
      h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
      h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

      // Cyrb53 is a 53-bit hash; we need 14 hex characters to represent it, and the first char will
      // always be 0 or 1 (since it is only 1 bit)
      return (4294967296 * (2097151 & h2) + (h1 >>> 0))
        .toString(16)
        .padStart(14, "0");
    }

    function withGameSaveHash(saveFile, callback) {
      if (saveFile) {
        cyrb53(saveFile).then((digest) => callback(digest, saveFile));
      } else {
        console.warn("Save file not found when attempting to hash");
        callback(null, null);
      }
    }

    var recentHash = null;
    if (this.gameManager) {
      withGameSaveHash(this.gameManager.getSaveFile(false), (hash, _) => {
        recentHash = hash;
      });
    }

    this.on("saveSaveFiles", (saveFile) => {
      withGameSaveHash(saveFile, (newHash, fileContents) => {
        if (newHash && fileContents && newHash !== recentHash) {
          recentHash = newHash;
          this.takeScreenshot(
            this.capture.photo.source,
            this.capture.photo.format,
            this.capture.photo.upscale
          ).then(({ screenshot, format }) => {
            this.callEvent("saveUpdate", {
              hash: newHash,
              save: fileContents,
              screenshot: screenshot,
              format: format,
            });
          });
        }
      });
    });
  }
}
window.EmulatorJS = EmulatorJS;
// This is EmulatorJS-SFU, not EmulatorJS.  See https://github.com/TechnicallyComputers/EmulatorJS-SFU
