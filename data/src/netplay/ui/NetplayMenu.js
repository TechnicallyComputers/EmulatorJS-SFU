/**
 * NetplayMenu - Netplay UI management
 *
 * Handles:
 * - Netplay menu creation and management
 * - Room listing and joining
 * - Player management UI
 * - Game launching and room operations
 */

class NetplayMenu {
  /**
   * @param {Object} emulator - The main emulator instance
   */
  constructor(emulator, netplayEngine) {
    this.emulator = emulator;
    this.engine = netplayEngine;
    this.netplayMenu = null;
    this.netplayBottomBar = null;
    // this.menuElement = this.emulator.createPopup('Netplay', [], true);

    // Auto-bind emulator helpers to this instance
    [
      'createElement',
      'createPopup',
      'localization',
      'createSubPopup',
      'addEventListener',
      'saveSettings',
      // add other commonly used methods
    ].forEach(fn => {
      this[fn] = (...args) => this.emulator[fn](...args);
    });
  }

  // Getter to redirect this.netplay to this.emulator.netplay
  get netplay() {
    return this.emulator.netplay;
  }
  set netplay(value) {
    this.emulator.netplay = value;
  }
  show() {
    if (this.netplayMenu) {
      this.netplayMenu.style.display = 'block';
      this.setupNetplayBottomBar('listings');

      // Switch to rooms tab when showing listings
      if (this.netplay.tabs && this.netplay.tabs[0] && this.netplay.tabs[1]) {
        this.netplay.tabs[0].style.display = "";  // Show rooms tab
        this.netplay.tabs[1].style.display = "none";  // Hide joined tab
      }
    }
  }

  hide() {
    if (this.netplayMenu) {
      this.netplayMenu.style.display = 'none';
      this.restoreNormalBottomBar();
    }
  }

  // Returns true if the menu is visible, false otherwise, optional isHidden does opposite.
  isVisible() {
    return this.netplayMenu && this.netplayMenu.style.display !== 'none';
  }
  isHidden() {
    return !this.isVisible();
  }

  // All netplay menu functions are now methods of the NetplayMenu class
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

  netplaySetupDelaySyncLobby() {
    console.log("[Netplay] Setting up delay sync lobby interface");
  
    // Ensure we're on the joined tab
    if (this.netplay.tabs && this.netplay.tabs[0] && this.netplay.tabs[1]) {
      this.netplay.tabs[0].style.display = "none";
      this.netplay.tabs[1].style.display = "";
    }
  
    // Stop room list refresh (if not already stopped)
    if (this.netplay.updateList) {
      this.netplay.updateList.stop();
    }
  
    // Update table headers for lobby
    if (this.netplay.playerTable && this.netplay.playerTable.parentElement) {
      const table = this.netplay.playerTable.parentElement;
      const thead = table.querySelector("thead");
      if (thead) {
        const headerRow = thead.querySelector("tr");
        if (headerRow && headerRow.children.length >= 3) {
          headerRow.children[2].innerText = "Status";
        }
      }
    }
  
    // Hide normal joined controls (bottom bar handles the buttons now)
    if (this.netplay.tabs && this.netplay.tabs[1]) {
      const joinedDiv = this.netplay.tabs[1];
      const joinedControls = joinedDiv.querySelector(".ejs_netplay_header");
      if (joinedControls) {
        joinedControls.style.display = "none";
      }
    }
  
    // Mark as in lobby mode
    this.netplay.isInDelaySyncLobby = true;
  }

  // Switch to live stream room UI
  netplaySwitchToLiveStreamRoom(roomName, password) {
    if (!this.netplayMenu) return;

    // Check if host and player slot at the beginning
    const isHost = this.netplay?.engine?.sessionState?.isHostRole() || false;
    const playerSlot = this.netplay?.localSlot !== undefined && this.netplay.localSlot !== null
      ? parseInt(this.netplay.localSlot, 10)
      : (this.netplay?.engine?.sessionState?.localSlot || 0);

    console.log("[NetplayMenu] Switching to live stream room:", {
      roomName,
      isHost,
      playerSlot,
      slotName: `P${playerSlot + 1}`
    });

    // For livestream clients, hide the canvas immediately so video can be displayed
    if (!isHost) {
      if (this.emulator && this.emulator.canvas && this.emulator.canvas.style.display !== 'none') {
        console.log('[NetplayMenu] Hiding canvas for livestream client');
        this.emulator.canvas.style.display = 'none';
      }
    }

    // Stop room list fetching
    if (this.netplay && this.netplay.updateList) {
      this.netplay.updateList.stop();
    }

    // Hide lobby tabs and show live stream room
    if (this.netplay.tabs && this.netplay.tabs[0] && this.netplay.tabs[1]) {
      this.netplay.tabs[0].style.display = "none";
      this.netplay.tabs[1].style.display = "";
    }

    // Update title
    const titleElement = this.netplayMenu.querySelector("h4");
    if (titleElement) {
      titleElement.innerText = "Live Stream Room";
    }

    // Update room name and password display
    if (this.netplay.roomNameElem) {
      this.netplay.roomNameElem.innerText = roomName;
    }
    if (this.netplay.passwordElem) {
      this.netplay.passwordElem.innerText = password ? `Password: ${password}` : "";
      this.netplay.passwordElem.style.display = password ? "" : "none";
    }

    // Create the Live Stream UI if it doesn't exist.
    if (!this.netplay.liveStreamPlayerTable) {
      // Set up the player slot selector first
      this.netplaySetupSlotSelector();
      
      // Create the player table
      const table = this.createNetplayTable('livestream');
      
      // Insert table after the slot selector
      if (this.netplay.slotSelect && this.netplay.slotSelect.parentElement) {
        this.netplay.slotSelect.parentElement.parentElement.insertBefore(table, this.netplay.slotSelect.parentElement.nextSibling);
      }
    }

    // This populates and updates the table.
    this.netplayInitializeLiveStreamPlayers();
    // Setup the bottom bar buttons.
    this.setupNetplayBottomBar('livestream');

    // Setup input syncing for non-host players
    // Use setTimeout to ensure engine is fully initialized
    setTimeout(() => {
      this.netplaySetupLiveStreamInputSync();
    }, 100);

    this.isNetplay = true;
    // Set global EJS netplay state for GameManager.simulateInput()
    if (window.EJS) {
      window.EJS.isNetplay = true;
    }
  }

  // Switch to delay sync room UI
  netplaySwitchToDelaySyncRoom(roomName, password, maxPlayers) {
    if (!this.netplayMenu) return;

    // Stop room list fetching
    if (this.netplay && this.netplay.updateList) {
      this.netplay.updateList.stop();
    }

    // Hide lobby tabs and show delay sync room
    if (this.netplay.tabs && this.netplay.tabs[0] && this.netplay.tabs[1]) {
      this.netplay.tabs[0].style.display = "none";
      this.netplay.tabs[1].style.display = "";
    }

    // Update title
    const titleElement = this.netplayMenu.querySelector("h4");
    if (titleElement) {
      titleElement.innerText = "Delay Sync Room";
    }

    // Update room name and password display
    if (this.netplay.roomNameElem) {
      this.netplay.roomNameElem.innerText = roomName;
    }
    if (this.netplay.passwordElem) {
      this.netplay.passwordElem.innerText = password ? `Password: ${password}` : "";
      this.netplay.passwordElem.style.display = password ? "" : "none";
    }

    // Create the Delay Sync UI if it doesn't exist.
    if (!this.netplay.delaySyncPlayerTable) {
      // Set up the player slot selector first
      this.netplaySetupSlotSelector();
      
      // Create the player table
      const table = this.createNetplayTable('delaysync');
      
      // Insert table after the slot selector
      if (this.netplay.slotSelect && this.netplay.slotSelect.parentElement) {
        this.netplay.slotSelect.parentElement.parentElement.insertBefore(table, this.netplay.slotSelect.parentElement.nextSibling);
      }
      
      // Hide Live Stream player slot if it exists
      if (this.netplay.playerSlotSelect && this.netplay.playerSlotSelect.parentElement) {
        this.netplay.playerSlotSelect.parentElement.style.display = "none";
      }
    }

    // Initialize player list (host is always player 1)
    this.netplayInitializeDelaySyncPlayers(maxPlayers);
    
    // Bottom bar buttons for Delay Sync mode
    this.setupNetplayBottomBar('delaysync');

    this.isNetplay = true;
    // Set global EJS netplay state for GameManager.simulateInput()
    if (window.EJS) {
      window.EJS.isNetplay = true;
    }
  }

  // Create a centralized table management system
  createNetplayTable(tableType, container = null) {
    const tableConfigs = {
      listings: {
        headers: [
          { text: "Room Type", width: "100px" },
          { text: "Room Name", align: "center" },
          { text: "Players", width: "80px" },
          { text: "", width: "80px" }
        ],
        reference: 'table'
      },
      livestream: {
        headers: [
          { text: "Player", width: "60px", align: "center" },
          { text: "Name", align: "center" },
          { text: "Status", width: "60px", align: "center" }
        ],
        reference: 'liveStreamPlayerTable'
      },
      delaysync: {
        headers: [
          { text: "Player", width: "60px", align: "center" },
          { text: "Name", align: "center" },
          { text: "Ready", width: "60px", align: "right" }
        ],
        reference: 'delaySyncPlayerTable'
      }
    };

    const config = tableConfigs[tableType];
    if (!config) return null;

    // Create table
    const table = this.createElement("table");
    table.classList.add("ejs_netplay_table");
    table.style.width = "100%";
    table.setAttribute("cellspacing", "0");

    // Create header
    const thead = this.createElement("thead");
    const headerRow = this.createElement("tr");
    
    config.headers.forEach(header => {
      const th = this.createElement("td");
      th.innerText = header.text;
      th.style.fontWeight = "bold";
      if (header.width) th.style.width = header.width;
      if (header.align) th.style.textAlign = header.align;
      headerRow.appendChild(th);
    });
    
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Create body
    const tbody = this.createElement("tbody");
    this.netplay[config.reference] = tbody;
    table.appendChild(tbody);

    // Add to container if specified
    if (container) {
      container.appendChild(table);
    }

    return table;
  }

  setupNetplayBottomBar(roomType, popupBody = null) {
    this.currentRoomType = roomType;
  
    // Always hide the original emulator bottom bar
    if (this.emulator.elements.menu) {
      this.emulator.elements.menu.style.display = "none";
    }
  
    // Create our netplay bottom bar if it doesn't exist
    if (!this.netplayBottomBar) {
      this.netplayBottomBar = this.createElement("div");
      this.netplayBottomBar.classList.add("ejs_menu_bar"); // Same styling as original
      this.netplayBottomBar.classList.add("ejs_menu_bar_hidden"); // Start hidden like original
      
      // Copy positioning from original bottom bar
      const originalBar = this.emulator.elements.menu;
      if (originalBar && originalBar.parentElement) {
        originalBar.parentElement.appendChild(this.netplayBottomBar);
      }
      
      // Add the same background and styling
      this.netplayBottomBar.style.background = "rgba(0,0,0,0.8)";
      this.netplayBottomBar.style.position = "absolute";
      this.netplayBottomBar.style.display = "flex";
      this.netplayBottomBar.style.justifyContent = "center";
      this.netplayBottomBar.style.alignItems = "center";
      this.netplayBottomBar.style.gap = "10px";
      this.netplayBottomBar.style.bottom = "0";
      this.netplayBottomBar.style.left = "0";
      this.netplayBottomBar.style.right = "0";
      this.netplayBottomBar.style.zIndex = "10000";
    }
    
    // Always show the netplay bottom bar
    this.netplayBottomBar.classList.remove("ejs_menu_bar_hidden");
    this.netplayBottomBar.style.display = "";
  
    // Handle room-type-specific setup
    if (roomType === 'listings') {
      // Start room list fetching for listings mode
      if (this.netplay && this.netplay.updateList) {
        this.netplay.updateList.start();
      }
    } else {
      // For room modes, clear any popup buttons (but keep popup visible for room interface)
      if (this.netplayMenu) {
        const popupContainer = this.netplayMenu.querySelector('.ejs_popup_body');
        if (popupContainer) {
          const buttons = popupContainer.parentElement.querySelectorAll('.ejs_button');
          buttons.forEach(button => button.remove());
        }
      }
      
      // Set netplay state for actual game rooms
      this.isNetplay = true;
      // Set global EJS netplay state for GameManager.simulateInput()
      if (window.EJS) {
        window.EJS.isNetplay = true;
      }
    }
  
    // Create appropriate buttons for this room type
    this.createBottomBarButtons(this.currentRoomType);
  }

  createBottomBarButtons(roomType) {
    // Clear existing buttons
    if (this.netplayBottomBar) {
      this.netplayBottomBar.innerHTML = "";
    }
  
    const bar = {}; // Button references
    
    const buttonConfigs = {
      // Listings-specific button
      createRoom: {
        text: "Create a Room",
        action: () => {
          if (!this.netplay || typeof this.netplay.updateList !== "function")
            this.defineNetplayFunctions();
          if (this.isNetplay) {
            this.emulator.netplay.engine.netplayLeaveRoom();
          } else {
            this.showOpenRoomDialog();
          }
        },
        appliesTo: roomType => roomType === 'listings'
      },
      
      // Room-specific buttons
      syncReady: {
        text: "Ready",
        action: () => this.netplayToggleReady(),
        appliesTo: roomType => roomType.endsWith('sync'),
        property: 'readyButton'
      },
      syncLaunch: {
        text: "Launch Game", 
        action: () => this.netplayLaunchGame(),
        appliesTo: roomType => roomType.endsWith('sync'),
        property: 'launchButton',
        disabled: true
      },
      leaveRoom: {
        text: "Leave Room",
        action: () => this.emulator.netplay.engine.netplayLeaveRoom(),
        appliesTo: roomType => roomType !== 'listings'
      },
      
      // Universal buttons
      settings: {
        text: "Settings",
        action: () => this.netplaySettingsMenu(),
        appliesTo: () => true,
        style: { backgroundColor: "#666" } // Grey for passive button
      },
      closeMenu: {
        text: "Close Menu",
        action: () => this.hide(),
        appliesTo: () => true,
        style: { backgroundColor: "#666" } // Grey for passive button
      }
    };
    
    // Create applicable buttons
    Object.entries(buttonConfigs).forEach(([key, config]) => {
      if (config.appliesTo(roomType)) {
        this.ensureButtonExists(key, config, bar, this.netplayBottomBar);
      }
    });
  }

  // Restore normal bottom bar buttons (hide Delay Sync buttons)
  restoreNormalBottomBar() {
    // Stop room list fetching
    if (this.netplay && this.netplay.updateList) {
      this.netplay.updateList.stop();
    }
    
    // Hide our netplay bottom bar
    if (this.netplayBottomBar) {
      this.netplayBottomBar.style.display = "none";
    }
    
    // Show the original emulator bottom bar
    if (this.emulator.elements.menu) {
      this.emulator.elements.menu.style.display = "";
    }
  }

  // Helper method to ensure a button exists and is visible
  ensureButtonExists(key, config, bar, container) {
    const targetContainer = container || this.emulator.elements.menu;
    
    if (!bar[key]) {
      const btn = this.createElement("a");
      btn.classList.add("ejs_button");
      btn.innerText = config.text;
      btn.style.whiteSpace = "nowrap";
      if (config.disabled) btn.disabled = true;
      btn.onclick = config.action;
      
      // Apply custom styling if specified
      if (config.style) {
        Object.assign(btn.style, config.style);
      }
      
      targetContainer.appendChild(btn); // Add to our container
      bar[key] = [btn];
      
      if (config.property) {
        this.netplay[config.property] = btn;
      }
    } else {
      bar[key][0].style.display = "";
    }
  }

  // Netplay Settings Menu
  netplaySettingsMenu() {
    const popups = this.createSubPopup();
    const container = popups[0];
    const content = popups[1];

    // Add border styling
    content.style.border = "2px solid rgba(var(--ejs-primary-color), 0.3)";
    content.style.borderRadius = "8px";
    content.style.padding = "10px";
    content.classList.add("ejs_cheat_parent");

    // Title
    const header = this.createElement("div");
    const title = this.createElement("h2");
    title.innerText = "Netplay Settings";
    title.classList.add("ejs_netplay_name_heading");
    header.appendChild(title);
    content.appendChild(header);

    // Settings container (similar to original menu structure)
    const settingsContainer = this.createElement("div");
    settingsContainer.style.maxHeight = "400px";
    settingsContainer.style.overflowY = "auto";

    // Helper function to create setting rows
    const createSettingRow = (label, control) => {
      const row = this.createElement("div");
      row.style.display = "flex";
      row.style.justifyContent = "space-between";
      row.style.alignItems = "center";
      row.style.marginBottom = "10px";
      row.style.padding = "8px";
      row.style.backgroundColor = "rgba(0,0,0,0.1)";
      row.style.borderRadius = "4px";

      const labelDiv = this.createElement("div");
      labelDiv.innerText = label;
      labelDiv.style.fontWeight = "bold";
      labelDiv.style.color = "#fff";

      row.appendChild(labelDiv);
      row.appendChild(control);
      return row;
    };

    // Helper function to create select dropdown
    const createSelect = (options, currentValue, onChange) => {
      const select = this.createElement("select");
      select.style.backgroundColor = "#333";
      select.style.color = "#fff";
      select.style.border = "1px solid #555";
      select.style.borderRadius = "4px";
      select.style.padding = "4px 8px";
      select.style.minWidth = "120px";

      Object.entries(options).forEach(([value, label]) => {
        const option = this.createElement("option");
        option.value = value;
        option.innerText = label;
        if (value === currentValue) option.selected = true;
        select.appendChild(option);
      });

      if (onChange) {
        this.addEventListener(select, "change", () => onChange(select.value));
      }

      return select;
    };

    // Helper function to get current setting value
    const getSetting = (key, defaultValue) => {
      return this.emulator.getSettingValue(key) || this.emulator[key] || defaultValue;
    };

    // Helper function to save setting
    const saveSetting = (key, value) => {
      this.emulator[key] = value;
      this.emulator.saveSettings();
    };

    // SVC with VP9 setting
    const normalizeVP9SVCMode = (v) => {
      const s = typeof v === "string" ? v.trim() : "";
      const sl = s.toLowerCase();
      if (sl === "l1t1") return "L1T1";
      if (sl === "l1t3") return "L1T3";
      if (sl === "l2t3") return "L2T3";
      return "L1T1";
    };

    const vp9SvcSelect = createSelect(
      {
        L1T1: "L1T1",
        L1T3: "L1T3",
        L2T3: "L2T3",
      },
      normalizeVP9SVCMode(getSetting("netplayVP9SVC", "L1T1")),
      (value) => saveSetting("netplayVP9SVC", value)
    );

    settingsContainer.appendChild(createSettingRow("SVC with VP9", vp9SvcSelect));

    // Legacy Simulcast setting
    const simulcastSelect = createSelect(
      {
        enabled: "Enabled",
        disabled: "Disabled",
      },
      getSetting("netplaySimulcast", "disabled"),
      (value) => saveSetting("netplaySimulcast", value)
    );

    settingsContainer.appendChild(createSettingRow("Legacy Simulcast", simulcastSelect));

    // Host Codec setting
    const normalizeHostCodec = (v) => {
      const s = typeof v === "string" ? v.trim().toLowerCase() : "";
      if (s === "vp9" || s === "h264" || s === "vp8" || s === "auto") return s;
      return "auto";
    };

    const hostCodecSelect = createSelect(
      {
        auto: "Auto",
        vp9: "VP9",
        h264: "H264",
        vp8: "VP8",
      },
      normalizeHostCodec(getSetting("netplayHostCodec", "auto")),
      (value) => saveSetting("netplayHostCodec", value)
    );

    settingsContainer.appendChild(createSettingRow("Host Codec", hostCodecSelect));

    // Client Simulcast Quality setting
    const normalizeSimulcastQuality = (v) => {
      const s = typeof v === "string" ? v.trim().toLowerCase() : "";
      if (s === "high" || s === "low") return s;
      if (s === "medium") return "low";
      if (s === "720p") return "high";
      if (s === "360p") return "low";
      if (s === "180p") return "low";
      return "high";
    };

    const clientQualitySelect = createSelect(
      {
        high: "High",
        low: "Low",
      },
      normalizeSimulcastQuality(getSetting("netplayClientSimulcastQuality", "high")),
      (value) => saveSetting("netplayClientSimulcastQuality", value)
    );

    settingsContainer.appendChild(createSettingRow("Client Simulcast Quality", clientQualitySelect));

    // Retry Connection Timer setting
    const retryTimerSelect = createSelect(
      {
        0: "Disabled",
        1: "1 second",
        2: "2 seconds",
        3: "3 seconds",
        4: "4 seconds",
        5: "5 seconds",
      },
      String(getSetting("netplayRetryConnectionTimer", 3)),
      (value) => saveSetting("netplayRetryConnectionTimer", parseInt(value))
    );

    settingsContainer.appendChild(createSettingRow("Retry Connection Timer", retryTimerSelect));

    // Unordered Retries setting
    const unorderedRetriesSelect = createSelect(
      {
        0: "0",
        1: "1",
        2: "2",
      },
      String(getSetting("netplayUnorderedRetries", 0)),
      (value) => saveSetting("netplayUnorderedRetries", parseInt(value))
    );

    settingsContainer.appendChild(createSettingRow("Unordered Retries", unorderedRetriesSelect));

    // Input Mode setting
    const inputModeSelect = createSelect(
      {
        unorderedRelay: "Unordered Relay",
        orderedRelay: "Ordered Relay",
        unorderedP2P: "Unordered P2P",
      },
      getSetting("netplayInputMode", "unorderedRelay"),
      (value) => saveSetting("netplayInputMode", value)
    );

    settingsContainer.appendChild(createSettingRow("Input Mode", inputModeSelect));

    content.appendChild(settingsContainer);

    // Close button
    content.appendChild(this.createElement("br"));
    const closeBtn = this.createElement("button");
    closeBtn.classList.add("ejs_button_button");
    closeBtn.classList.add("ejs_popup_submit");
    closeBtn.style["background-color"] = "rgba(var(--ejs-primary-color),1)";
    closeBtn.innerText = "Close";
    closeBtn.onclick = () => container.remove();

    content.appendChild(closeBtn);

    // Add to netplay menu
    if (this.netplayMenu) {
      this.netplayMenu.appendChild(container);
    }
  }

  // Initialize delay sync player table
  netplayInitializeDelaySyncPlayers(maxPlayers) {
    // Create row for host only (fallback)
    this.netplayUpdatePlayerTable(0);

    // Initialize ready states array for maxPlayers
    this.netplay.playerReadyStates = new Array(maxPlayers).fill(false);
    this.netplay.playerReadyStates[0] = true; // Host starts ready

    // If we have full player data (from netplayUpdatePlayerList), update the table with it
    // Otherwise, keep the default host-only display
    if (this.netplay.joinedPlayers && this.netplay.joinedPlayers.length > 0) {
      console.log("[NetplayMenu] Updating delay sync table with full player data");
      this.netplayUpdatePlayerTable(this.netplay.joinedPlayers);
    } else {
      // Update slot selector to remove taken slots (default behavior)
      this.netplayUpdateSlotSelector();
    }
  }

  // Update player table - handles both individual players and bulk updates
  netplayUpdatePlayerTable(playersOrSlot) {
    // Determine which table type we're using
    let tbody;
    let isDelaySync = false;
    
    if (this.netplay.delaySyncPlayerTable) {
      tbody = this.netplay.delaySyncPlayerTable;
      isDelaySync = true;
    } else if (this.netplay.liveStreamPlayerTable) {
      tbody = this.netplay.liveStreamPlayerTable;
      isDelaySync = false;
    } else {
      return; // No table to update
    }

    // Handle array of players (bulk update)
    if (Array.isArray(playersOrSlot)) {
      const playersArray = playersOrSlot;
      console.log(`[NetplayMenu] Rebuilding ${isDelaySync ? 'delay sync' : 'live stream'} player table with`, playersArray.length, "players");
      
      // Clear existing table
      console.log("[NetplayMenu] Clearing existing table, had", tbody.children.length, "rows");
      tbody.innerHTML = "";
      
      // Rebuild table with current players
      playersArray.forEach((player, index) => {
        console.log(`[NetplayMenu] Adding player ${index}:`, player);
        
        const row = this.createElement("tr");
        
        // Player column (use P1, P2, etc. based on array index)
        const playerCell = this.createElement("td");
        playerCell.innerText = `P${index + 1}`;
        playerCell.style.textAlign = "center";
        row.appendChild(playerCell);
        
        // Name column
        const nameCell = this.createElement("td");
        nameCell.innerText = player.name;
        nameCell.style.textAlign = "center";
        row.appendChild(nameCell);
        
        // Third column - Ready for delay sync, Status for live stream
        const thirdCell = this.createElement("td");
        
        if (isDelaySync) {
          // Delay sync: Ready status with checkmarks
          thirdCell.innerText = player.ready ? "✅" : "⛔";
          thirdCell.style.textAlign = "right";
          thirdCell.classList.add("ready-status");
        } else {
          // Live stream: Host/Client status (first player is host)
          thirdCell.innerText = index === 0 ? "Host" : "Client";
          thirdCell.style.textAlign = "center";
        }
        
        row.appendChild(thirdCell);
        tbody.appendChild(row);
      });

      console.log("[NetplayMenu] Table rebuild complete, now has", tbody.children.length, "rows");

      // Log the content of each row for debugging
      for (let i = 0; i < tbody.children.length; i++) {
        const row = tbody.children[i];
        const cells = row.querySelectorAll('td');
        const cellTexts = Array.from(cells).map(cell => cell.textContent);
        console.log(`[NetplayMenu] Row ${i} content:`, cellTexts);
      }

      // Also log the entire table HTML for debugging
      console.log("[NetplayMenu] Table HTML:", tbody.innerHTML);
      
      return;
    }

    // Handle individual slot (legacy behavior)
    const slot = playersOrSlot;
    const player = this.netplay.joinedPlayers.find(p => p.slot === slot);
    if (!player) return;

    const row = this.createElement("tr");

    // Player column (same for both table types)
    const playerCell = this.createElement("td");
    playerCell.innerText = `P${slot + 1}`;
    playerCell.style.textAlign = "center";
    row.appendChild(playerCell);

    // Name column (same for both table types)
    const nameCell = this.createElement("td");
    nameCell.innerText = player.name;
    nameCell.style.textAlign = "center";
    row.appendChild(nameCell);

    // Third column - Ready for delay sync, Status for live stream
    const thirdCell = this.createElement("td");
    
    if (isDelaySync) {
      // Delay sync: Ready status with checkmarks
      thirdCell.innerText = player.ready ? "✅" : "⛔";
      thirdCell.style.textAlign = "right";
      thirdCell.classList.add("ready-status");
    } else {
      // Live stream: Host/Client status
      thirdCell.innerText = slot === 0 ? "Host" : "Client";
      thirdCell.style.textAlign = "center";
    }
    
    row.appendChild(thirdCell);
    tbody.appendChild(row);
  }  
  
  // Initialize live stream player table
  netplayInitializeLiveStreamPlayers() {
    if (!this.netplay.liveStreamPlayerTable) return;

    const tbody = this.netplay.liveStreamPlayerTable;    
    tbody.innerHTML = "";

    // Initialize taken slots tracking
    if (!this.netplay.takenSlots) {
      this.netplay.takenSlots = new Set();
    }
    this.netplay.takenSlots.clear();

    // Host is always P1
    this.netplay.takenSlots.add(0);
    this.netplay.localSlot = 0;
    this.netplayPreferredSlot = 0;
    if (this.netplay.slotSelect) {
      this.netplay.slotSelect.value = "0";
    }

    // Just show host for now
    const row = this.createElement("tr");

    // Player column
    const playerCell = this.createElement("td");
    playerCell.innerText = "P1";
    playerCell.style.textAlign = "center";
    row.appendChild(playerCell);

    // Name column
    const nameCell = this.createElement("td");
    nameCell.innerText = this.netplay.name || "Host";
    nameCell.style.textAlign = "center";
    row.appendChild(nameCell);

    // Status column
    const statusCell = this.createElement("td");
    statusCell.innerText = "Host";
    statusCell.style.textAlign = "center";
    row.appendChild(statusCell);

    tbody.appendChild(row);

    // If we have full player data (from netplayUpdatePlayerList), update the table.
    // Otherwise, keep the default host-only display.
    if (this.netplay.joinedPlayers && this.netplay.joinedPlayers.length > 0) {
      console.log("[NetplayMenu] Updating live stream player table with", this.netplay.joinedPlayers.length, "players");
      this.netplayUpdatePlayerTable(this.netplay.joinedPlayers);
    }
    // Update slot selector to remove taken slots
    this.netplayUpdateSlotSelector();
  }



  // Update player slot in table
  netplayUpdatePlayerSlot(slot) {
    // Find and update the local player in joinedPlayers
    if (this.netplay.joinedPlayers) {
      const localPlayerId = this.netplay.engine?.sessionState?.localPlayerId;
      const localPlayerName = this.netplay.name;
      const localPlayer = this.netplay.joinedPlayers.find(p =>
        (localPlayerId && p.id === localPlayerId) ||
        (localPlayerName && p.name === localPlayerName)
      );
      
      if (localPlayer) {
        // Store old slot for takenSlots update
        const oldSlot = localPlayer.slot;
        
        // Update the player's slot
        localPlayer.slot = slot;
        
        // Update taken slots
        if (!this.netplay.takenSlots) {
          this.netplay.takenSlots = new Set();
        }
        if (oldSlot !== null && oldSlot !== undefined && oldSlot < 4) {
          this.netplay.takenSlots.delete(oldSlot);
        }
        if (slot < 4) {
          this.netplay.takenSlots.add(slot);
        }
        
        // Re-render the player table with updated data
        if (this.netplay.joinedPlayers.length > 0) {
          this.netplayUpdatePlayerTable(this.netplay.joinedPlayers);
        }
      }
    }

    // Update Delay Sync table if it exists (legacy compatibility)
    if (this.netplay.delaySyncPlayerTable && this.netplay.joinedPlayers) {
      const hostPlayer = this.netplay.joinedPlayers.find(p => p.slot === 0);
      if (hostPlayer) {
        // Move from old slot to new slot
        const oldSlot = hostPlayer.slot;
        hostPlayer.slot = slot;

        // Update taken slots
        if (!this.netplay.takenSlots) this.netplay.takenSlots = new Set();
        this.netplay.takenSlots.delete(oldSlot);
        this.netplay.takenSlots.add(slot);

        // Re-render the table
        this.netplayInitializeDelaySyncPlayers(this.netplay.maxPlayers || 4);
      }
    }

    // Update Live Stream table if it exists
    if (this.netplay.liveStreamPlayerTable) {
      const tbody = this.netplay.liveStreamPlayerTable;
      if (tbody.children[0]) {
        const playerCell = tbody.children[0].querySelector("td:first-child");
        if (playerCell) {
          playerCell.innerText = `P${slot + 1}`;
        }
      }
    }

    // Update slot selector to reflect taken slots
    this.netplayUpdateSlotSelector();
  }

  netplaySetupSlotSelector() {
    // Remove existing slot selector if it exists
    if (this.netplay.slotSelect && this.netplay.slotSelect.parentElement) {
      const slotContainer = this.netplay.slotSelect.parentElement;
      if (slotContainer.parentElement) {
        slotContainer.parentElement.removeChild(slotContainer);
      }
    }
  
    // BEFORE creating the slot selector, ensure we have current player data
    // Get current players from the engine to know which slots are taken
    let currentPlayers = {};
    let hasPlayerData = false;
    
    if (this.netplay.engine?.playerManager) {
      try {
        currentPlayers = this.netplay.engine.playerManager.getPlayersObject() || {};
        hasPlayerData = Object.keys(currentPlayers).length > 0;
        console.log("[NetplayMenu] Got current players for slot selector:", currentPlayers);
      } catch (error) {
        console.warn("[NetplayMenu] Could not get current players:", error);
      }
    }
    
    // If we have player data, update takenSlots before creating selector
    if (hasPlayerData) {
      if (!this.netplay.takenSlots) {
        this.netplay.takenSlots = new Set();
      }
      this.netplay.takenSlots.clear();
      
      // Convert players object to array and track taken slots
      Object.entries(currentPlayers).forEach(([playerId, playerData]) => {
        const slot = playerData.slot || playerData.player_slot || 0;
        if (slot !== undefined && slot !== null && slot < 4) {
          this.netplay.takenSlots.add(slot);
        }
      });
      
      console.log("[NetplayMenu] Updated taken slots from player data:", Array.from(this.netplay.takenSlots));
    }
  
    // Create new slot selector with consistent styling
    const slotLabel = this.createElement("strong");
    slotLabel.innerText = "Player Select:";
  
    const slotSelect = this.createElement("select");
    // Add basic styling to make it look like a proper dropdown
    slotSelect.style.backgroundColor = "#333";
    slotSelect.style.border = "1px solid #555";
    slotSelect.style.borderRadius = "4px";
    slotSelect.style.padding = "4px 8px";
    slotSelect.style.minWidth = "80px";
    slotSelect.style.cursor = "pointer";
    slotSelect.style.color = "#fff";
  
    // Determine current player's slot
    let currentPlayerSlot = this.netplay.localSlot;
    if (currentPlayerSlot === undefined || currentPlayerSlot === null) {
      // Try to find current player in current players data
      const localPlayerId = this.netplay.engine?.sessionState?.localPlayerId;
      const localPlayerName = this.netplay.name;
      
      if (hasPlayerData) {
        const localPlayer = Object.entries(currentPlayers).find(([playerId, playerData]) =>
          (localPlayerId && playerId === localPlayerId) ||
          (localPlayerName && playerData.name === localPlayerName)
        );
        if (localPlayer) {
          currentPlayerSlot = localPlayer[1].slot || localPlayer[1].player_slot || 0;
          // Update our local slot tracking
          this.netplay.localSlot = currentPlayerSlot;
        }
      }
    }
  
    // Add player slots (only available ones, plus current player's slot if taken)
    for (let i = 0; i < 4; i++) {
      const slotAvailable = !hasPlayerData || !this.netplay.takenSlots || !this.netplay.takenSlots.has(i);
      const isCurrentPlayerSlot = i === currentPlayerSlot;
  
      if (slotAvailable || isCurrentPlayerSlot) {
        const opt = this.createElement("option");
        opt.value = String(i);
        opt.innerText = "P" + (i + 1);
        // Disable slots taken by others (but allow current player's slot)
        if (hasPlayerData && this.netplay.takenSlots && this.netplay.takenSlots.has(i) && !isCurrentPlayerSlot) {
          opt.disabled = true;
        }
        slotSelect.appendChild(opt);
      }
    }
  
    // Add Spectator option
    const spectatorOpt = this.createElement("option");
    spectatorOpt.value = "4";
    spectatorOpt.innerText = "Spectator";
    slotSelect.appendChild(spectatorOpt);
  
    // Set the current selection to the player's assigned slot
    if (currentPlayerSlot !== undefined && currentPlayerSlot !== null) {
      slotSelect.value = String(currentPlayerSlot);
    }
  
    // Store reference
    this.netplay.slotSelect = slotSelect;
  
    // Set up event listener (only if not already wired)
    if (!this.netplay._slotSelectWired) {
      this.netplay._slotSelectWired = true;
      this.addEventListener(slotSelect, "change", async () => {
        const raw = parseInt(slotSelect.value, 10);
        const slot = isNaN(raw) ? 0 : Math.max(0, Math.min(4, raw)); // Allow 0-4 (Spectator)

        // Store old slot for takenSlots update
        const oldSlot = this.netplay.localSlot;

        // Update local slot preferences
        this.netplay.localSlot = slot;
        this.netplayPreferredSlot = slot;
        window.EJS_NETPLAY_PREFERRED_SLOT = slot;
        if (this.netplay.extra) {
          this.netplay.extra.player_slot = slot;
        }

        // Update taken slots: remove old slot, add new slot (if not spectator)
        if (!this.netplay.takenSlots) {
          this.netplay.takenSlots = new Set();
        }
        if (oldSlot !== null && oldSlot !== undefined && oldSlot < 4) {
          this.netplay.takenSlots.delete(oldSlot);
        }
        if (slot < 4) {
          this.netplay.takenSlots.add(slot);
        }

        // Update player slot in player data
        this.netplayUpdatePlayerSlot(slot);

        // Update live stream player table if it exists
        if (this.netplay.liveStreamPlayerTable) {
          console.log("[NetplayMenu] Updating live stream player table after slot change");
          this.netplayInitializeLiveStreamPlayers();
        }

        // Reconfigure input sync with new slot
        if (this.netplay.engine && slot < 4) { // Only for player slots, not spectator
          console.log("[NetplayMenu] Reconfiguring input sync for slot:", slot);
          this.netplaySetupLiveStreamInputSync();
        }

        // Send slot update to server if in a room
        if (this.netplay.engine?.roomManager && slot < 4) { // Don't send spectator slot to server
          try {
            await this.netplay.engine.roomManager.updatePlayerSlot(slot);
            console.log(`[NetplayMenu] Sent slot update to server: ${slot}`);
          } catch (error) {
            console.error("[NetplayMenu] Failed to update slot on server:", error);
          }
        }

        // Refresh slot selector dropdown to reflect updated taken slots
        this.netplayUpdateSlotSelector();

        // Save settings
        if (this.settings) {
          this.settings.netplayPreferredSlot = String(slot);
        }
        this.saveSettings();
      });
    }
  
    // Create container
    const slotContainer = this.createElement("div");
    slotContainer.style.display = "flex";
    slotContainer.style.justifyContent = "center";
    slotContainer.style.alignItems = "center";
    slotContainer.style.gap = "8px";
    slotContainer.style.marginTop = "10px";
    slotContainer.style.marginBottom = "10px";
  
    slotContainer.appendChild(slotLabel);
    slotContainer.appendChild(slotSelect);
  
    // Insert into the joined tab after the password element
    if (this.netplay.tabs && this.netplay.tabs[1]) {
      // Find the password element to insert after
      const passwordElement = this.netplay.tabs[1].querySelector('input[type="password"], .ejs_netplay_password');
      if (passwordElement && passwordElement.parentElement) {
        passwordElement.parentElement.parentElement.insertBefore(slotContainer, passwordElement.parentElement.nextSibling);
      } else {
        // Fallback: insert at the beginning of the tab
        this.netplay.tabs[1].insertBefore(slotContainer, this.netplay.tabs[1].firstChild);
      }
    }
  }

  netplayUpdateSlotSelector() {
    if (!this.netplay.slotSelect) return;

    const select = this.netplay.slotSelect;
    const currentValue = select.value;

    // Clear all options except Spectator
    const spectatorOption = select.querySelector('option[value="4"]');
    select.innerHTML = "";

    // Determine current player's slot (prioritize localSlot, then find by name/ID)
    let currentPlayerSlot = this.netplay.localSlot;
    if (currentPlayerSlot === undefined || currentPlayerSlot === null) {
      // Try to find current player in joined players
      const localPlayerId = this.netplay.engine?.sessionState?.localPlayerId;
      const localPlayerName = this.netplay.name;
      const localPlayer = this.netplay.joinedPlayers?.find(p =>
        (localPlayerId && p.id === localPlayerId) ||
        (localPlayerName && p.name === localPlayerName)
      );
      if (localPlayer) {
        currentPlayerSlot = localPlayer.slot;
        // Update localSlot to match
        this.netplay.localSlot = currentPlayerSlot;
      }
    }

    console.log(`[NetplayMenu] Updating slot selector. Current player slot: ${currentPlayerSlot}, Taken slots:`, Array.from(this.netplay.takenSlots || []));

    // Add available player slots (not taken by other players)
    for (let i = 0; i < 4; i++) {
      // Allow selecting slots that are not taken by other players, or the current player's own slot
      const slotAvailable = !this.netplay.takenSlots || !this.netplay.takenSlots.has(i);
      const isCurrentPlayerSlot = i === currentPlayerSlot;

      if (slotAvailable || isCurrentPlayerSlot) {
        const opt = this.createElement("option");
        opt.value = String(i);
        opt.innerText = "P" + (i + 1);
        // Disable slots taken by others (but allow current player's slot)
        if (this.netplay.takenSlots && this.netplay.takenSlots.has(i) && !isCurrentPlayerSlot) {
          opt.disabled = true;
        }
        select.appendChild(opt);
      }
    }

    // Add Spectator option at the end
    if (spectatorOption) {
      select.appendChild(spectatorOption);
    } else {
      const spectatorOpt = this.createElement("option");
      spectatorOpt.value = "4";
      spectatorOpt.innerText = "Spectator";
      select.appendChild(spectatorOpt);
    }

    // Set the current selection to the player's assigned slot, or first available
    if (currentPlayerSlot !== undefined && currentPlayerSlot !== null && select.querySelector(`option[value="${currentPlayerSlot}"]`)) {
      // Player has an assigned slot and it's available in the dropdown, select it
      select.value = String(currentPlayerSlot);
      console.log(`[NetplayMenu] Set slot selector to current player slot: ${currentPlayerSlot}`);
    } else if (select.querySelector(`option[value="${currentValue}"]`)) {
      // Restore previous selection if valid
      select.value = currentValue;
    } else if (select.options.length > 0) {
      // Select first available option
      select.value = select.options[0].value;
      console.log(`[NetplayMenu] Set slot selector to first available: ${select.value}`);
    }
  }

  // Get the lowest available player slot
  netplayGetLowestAvailableSlot() {
    if (!this.netplay.takenSlots) {
      this.netplay.takenSlots = new Set();
    }
    for (let i = 0; i < 4; i++) {
      if (!this.netplay.takenSlots.has(i)) {
        return i;
      }
    }
    return -1; // No slots available
  }

  // Add a joining player with auto-assigned slot
  netplayAddJoiningPlayer(name) {
    const availableSlot = this.netplayGetLowestAvailableSlot();
    if (availableSlot === -1) return null; // No slots available

    const newPlayer = {
      slot: availableSlot,
      name: name,
      ready: false
    };

    if (!this.netplay.joinedPlayers) {
      this.netplay.joinedPlayers = [];
    }
    this.netplay.joinedPlayers.push(newPlayer);
    this.netplay.takenSlots.add(availableSlot);

    // Add to Delay Sync table if it exists
    if (this.netplay.delaySyncPlayerTable) {
      this.netplayUpdatePlayerTable(availableSlot);
      // Update ready states array
      if (this.netplay.playerReadyStates && availableSlot < this.netplay.playerReadyStates.length) {
        this.netplay.playerReadyStates[availableSlot] = false;
      }
    }

    // Update slot selector to remove the taken slot
    this.netplayUpdateSlotSelector();

    return newPlayer;
  }

  // Remove a player (when they leave)
  netplayRemovePlayer(slot) {
    if (!this.netplay.joinedPlayers) return;

    // Remove from joined players
    this.netplay.joinedPlayers = this.netplay.joinedPlayers.filter(p => p.slot !== slot);

    // Free up the slot
    if (this.netplay.takenSlots) {
      this.netplay.takenSlots.delete(slot);
    }

    // Remove from Delay Sync table
    if (this.netplay.delaySyncPlayerTable) {
      // Re-render the entire table
      this.netplayInitializeDelaySyncPlayers(this.netplay.maxPlayers || 4);
    }

    // Update slot selector to remove the taken slot
    this.netplayUpdateSlotSelector();
  }

  // Toggle ready status
  netplayToggleReady() {
    if (!this.netplay.readyButton) return;

    // Toggle the host's ready status (slot 0)
    const hostPlayer = this.netplay.joinedPlayers.find(p => p.slot === 0);
    if (hostPlayer) {
      hostPlayer.ready = !hostPlayer.ready;
      this.netplay.playerReadyStates[0] = hostPlayer.ready;
    }

    // Update UI
    const tbody = this.netplay.delaySyncPlayerTable;
    if (tbody && tbody.children[0]) {
      const readyCell = tbody.children[0].querySelector(".ready-status");
      if (readyCell) {
        readyCell.innerText = hostPlayer.ready ? "✅" : "⛔";
      }
    }

    // Update button text
    this.netplay.readyButton.innerText = hostPlayer.ready ? "Not Ready" : "Ready";

    // Check if all players are ready to enable launch button
    this.netplayUpdateLaunchButton();
  }

  // Update launch game button state
  netplayUpdateLaunchButton() {
    if (!this.netplay.launchButton || !this.netplay.joinedPlayers) return;

    // Check if all joined players are ready
    const allReady = this.netplay.joinedPlayers.every(player => player.ready);
    this.netplay.launchButton.disabled = !allReady;
  }

  // Launch game (host only)
  netplayLaunchGame() {
    console.log("[Delay Sync] Launching game...");
    // TODO: Implement game launch logic
    alert("Game launch not implemented yet");
  }

  // Helper method to update the room table UI
  netplayUpdateRoomTable(rooms) {
    if (!this.netplay || !this.netplay.table) return;

    const tbody = this.netplay.table;
    tbody.innerHTML = ""; // Clear existing rows

    if (rooms.length === 0) {
      const row = this.createElement("tr");
      const cell = this.createElement("td");
      cell.colSpan = 4;
      cell.style.textAlign = "center";
      cell.style.padding = "20px";
      cell.innerText = "No rooms available";
      row.appendChild(cell);
      tbody.appendChild(row);
      return;
    }

    rooms.forEach((room) => {
      // Main row
      const row = this.createElement("tr");
      row.style.cursor = "pointer";
      row.classList.add("ejs_netplay_room_row");

      // Room type cell
      const typeCell = this.createElement("td");
      typeCell.innerText = room.netplay_mode === 1 ? "Delay Sync" : "Live Stream";
      typeCell.style.textAlign = "center";
      typeCell.style.fontSize = "12px";
      typeCell.style.fontWeight = "bold";
      row.appendChild(typeCell);

      // Room name cell
      const nameCell = this.createElement("td");
      nameCell.innerText = room.name + (room.hasPassword ? " 🔐" : "");
      nameCell.style.textAlign = "center";
      row.appendChild(nameCell);

      // Players cell
      const playersCell = this.createElement("td");
      playersCell.innerText = `${room.current}/${room.max}`;
      playersCell.style.textAlign = "center";
      row.appendChild(playersCell);

      // Join button cell
      const joinCell = this.createElement("td");
      joinCell.style.textAlign = "center";

      const joinBtn = this.createElement("button");
      joinBtn.classList.add("ejs_button_button");
      joinBtn.innerText = room.hasPassword ? "Join (PW)" : "Join";
      joinBtn.onclick = (e) => {
        e.stopPropagation(); // Don't trigger row expansion
        this.engine.netplayJoinRoom(room.id, room.hasPassword);
      };

      joinCell.appendChild(joinBtn);
      row.appendChild(joinCell);

      tbody.appendChild(row);

      // Expandable details row (initially hidden)
      const detailsRow = this.createElement("tr");
      detailsRow.style.display = "none";
      detailsRow.classList.add("ejs_netplay_room_details");

      const detailsCell = this.createElement("td");
      detailsCell.colSpan = 4;
      detailsCell.style.padding = "10px";
      detailsCell.style.backgroundColor = "rgba(0,0,0,0.1)";

      // Split details into two columns
      const detailsContainer = this.createElement("div");
      detailsContainer.style.display = "flex";
      detailsContainer.style.justifyContent = "space-between";

      const leftCol = this.createElement("div");
      leftCol.innerText = `Core: ${room.core_type || "Unknown"}`;
      leftCol.style.fontSize = "14px";

      const rightCol = this.createElement("div");
      rightCol.innerText = `ROM: ${room.rom_hash ? room.rom_hash.substring(0, 16) + "..." : "Unknown"}`;
      rightCol.style.fontSize = "14px";
      rightCol.style.textAlign = "right";

      detailsContainer.appendChild(leftCol);
      detailsContainer.appendChild(rightCol);
      detailsCell.appendChild(detailsContainer);
      detailsRow.appendChild(detailsCell);

      tbody.appendChild(detailsRow);

      // Make row clickable to toggle details
      row.addEventListener("click", () => {
        const isExpanded = detailsRow.style.display !== "none";
        detailsRow.style.display = isExpanded ? "none" : "";
      });
    });
  }

  netplayRestoreMenu() {
    this.netplay.isInDelaySyncLobby = false;
  }

  defineNetplayFunctions() {
    const EJS_INSTANCE = this;

    // Initialize NetplayEngine if modules are available
    // Note: This will only work after netplay modules are loaded/included
    // Check both global scope and window object for compatibility
    const NetplayEngineClass =
      typeof NetplayEngine !== "undefined"
        ? NetplayEngine
        : typeof window !== "undefined" && window.NetplayEngine
        ? window.NetplayEngine
        : undefined;
    const EmulatorJSAdapterClass =
      typeof EmulatorJSAdapter !== "undefined"
        ? EmulatorJSAdapter
        : typeof window !== "undefined" && window.EmulatorJSAdapter
        ? window.EmulatorJSAdapter
        : undefined;

    // Initialize this.netplay if it doesn't exist
    if (!this.netplay) {
      this.netplay = {};
    }


    // Define updateList function for refreshing room lists
    if (!this.netplay.updateList) {
      let updateInterval = null;
      this.netplay.updateList = {
        start: () => {
          // Stop any existing interval
          this.netplay.updateList.stop();

          // Start updating room list every 5 seconds
          const updateRooms = async () => {
            if (!this.netplay || !this.netplay.table) return;

            try {
              // Get room list from SFU server
              const rooms = await this.engine.netplayGetRoomList();
              this.netplayUpdateRoomTable(rooms);
            } catch (error) {
              console.error("[Netplay] Failed to update room list:", error);
            }
          };

          // Initial update
          updateRooms();

          // Set up periodic updates
          updateInterval = setInterval(updateRooms, 5000);
        },
        stop: () => {
          if (updateInterval) {
            clearInterval(updateInterval);
            updateInterval = null;
          }
        }
      };
    }

    // Define reset function
    if (!this.netplay.reset) {
      this.netplay.reset = () => {
        console.log("[Netplay] Resetting netplay state");
        // Stop room list updates
        if (this.netplay.updateList) {
          this.netplay.updateList.stop();
        }
        // Reset netplay state
        this.isNetplay = false;
        // Reset global EJS netplay state
        if (window.EJS) {
          window.EJS.isNetplay = false;
        }
        // TODO: Add more reset logic as needed
      };
    }
  }

  showOpenRoomDialog = () => {
    // Create a sub-popup within the netplay menu (like "Set Player Name")
    const popups = this.createSubPopup();
    const container = popups[0];
    const content = popups[1];

    // Use the same styling class as "Set Player Name" popup
    content.classList.add("ejs_cheat_parent");

    // Add title to the dialog using proper CSS class
    const header = this.createElement("div");
    const title = this.createElement("h2");
    title.innerText = "Create Room";
    title.classList.add("ejs_netplay_name_heading");
    header.appendChild(title);
    content.appendChild(header);

    // Create form content using proper CSS classes
    const form = this.createElement("form");
    form.classList.add("ejs_netplay_header");

    // Room name input
    const nameHead = this.createElement("strong");
    nameHead.innerText = "Room Name";
    const nameInput = this.createElement("input");
    nameInput.type = "text";
    nameInput.name = "roomName";
    nameInput.setAttribute("maxlength", 50);
    nameInput.placeholder = "Enter room name...";

    // Max players input
    const maxHead = this.createElement("strong");
    maxHead.innerText = "Max Players";
    const maxSelect = this.createElement("select");
    maxSelect.name = "maxPlayers";
    for (let i = 1; i <= 4; i++) {
      const option = this.createElement("option");
      option.value = String(i);
      option.innerText = String(i);
      if (i === 4) option.selected = true;
      maxSelect.appendChild(option);
    }

    // Password input (optional)
    const passHead = this.createElement("strong");
    passHead.innerText = "Password (Optional)";
    const passInput = this.createElement("input");
    passInput.type = "password";
    passInput.name = "password";
    passInput.placeholder = "Leave empty for public room";
    passInput.autocomplete = "off";

    // Spectators
    const spectatorHead = this.createElement("strong");
    spectatorHead.innerText = "Allow Spectators";
    const spectatorSelect = this.createElement("select");
    spectatorSelect.name = "spectators";
    ["Yes", "No"].forEach(val => {
      const option = this.createElement("option");
      option.value = val.toLowerCase();
      option.innerText = val;
      spectatorSelect.appendChild(option);
    });

    // Room type
    const roomTypeHead = this.createElement("strong");
    roomTypeHead.innerText = "Room Type";
    const roomTypeSelect = this.createElement("select");
    roomTypeSelect.name = "roomType";
    ["Live Stream", "Delay Sync"].forEach(val => {
      const option = this.createElement("option");
      option.value = val.toLowerCase().replace(" ", "_");
      option.innerText = val;
      roomTypeSelect.appendChild(option);
    });

    // Delay sync options (initially hidden)
    const delaySyncOptions = this.createElement("div");
    delaySyncOptions.style.display = "none";

    const frameDelayHead = this.createElement("strong");
    frameDelayHead.innerText = "Frame Delay";
    const frameDelaySelect = this.createElement("select");
    frameDelaySelect.name = "frameDelay";
    for (let i = 1; i <= 10; i++) {
      const option = this.createElement("option");
      option.value = String(i);
      option.innerText = String(i);
      if (i === 2) option.selected = true;
      frameDelaySelect.appendChild(option);
    }

    const syncModeHead = this.createElement("strong");
    syncModeHead.innerText = "Sync Mode";
    const syncModeSelect = this.createElement("select");
    syncModeSelect.name = "syncMode";
    ["Timeout + Last Known", "Strict Sync"].forEach(val => {
      const option = this.createElement("option");
      option.value = val === "Timeout + Last Known" ? "timeout" : "strict";
      option.innerText = val;
      syncModeSelect.appendChild(option);
    });

    // Add Frame Delay field with consistent spacing
    const frameDelayContainer = this.createElement("div");
    frameDelayContainer.style.marginBottom = "8px";
    frameDelayContainer.appendChild(frameDelayHead);
    frameDelayContainer.appendChild(this.createElement("br"));
    frameDelayContainer.appendChild(frameDelaySelect);
    delaySyncOptions.appendChild(frameDelayContainer);

    // Add Sync Mode field with consistent spacing
    const syncModeContainer = this.createElement("div");
    syncModeContainer.style.marginBottom = "8px";
    syncModeContainer.appendChild(syncModeHead);
    syncModeContainer.appendChild(this.createElement("br"));
    syncModeContainer.appendChild(syncModeSelect);
    delaySyncOptions.appendChild(syncModeContainer);

    // Add form elements with tighter spacing
    const addField = (label, element) => {
      const fieldContainer = this.createElement("div");
      fieldContainer.style.marginBottom = "8px"; // Tighter spacing between fields
      fieldContainer.appendChild(label);
      fieldContainer.appendChild(this.createElement("br"));
      fieldContainer.appendChild(element);
      form.appendChild(fieldContainer);
    };

    addField(nameHead, nameInput);
    addField(maxHead, maxSelect);
    addField(passHead, passInput);
    addField(spectatorHead, spectatorSelect);
    addField(roomTypeHead, roomTypeSelect);
    form.appendChild(delaySyncOptions);

    content.appendChild(form);

    // Add buttons at the bottom with proper spacing (like other netplay menus)
    content.appendChild(this.createElement("br"));
    const buttonContainer = this.createElement("div");
    buttonContainer.style.display = "flex";
    buttonContainer.style.gap = "10px"; // Match spacing used in netplay menus
    buttonContainer.style.justifyContent = "center";

    const createBtn = this.createElement("button");
    createBtn.classList.add("ejs_button_button");
    createBtn.classList.add("ejs_popup_submit");
    createBtn.style["background-color"] = "rgba(var(--ejs-primary-color),1)";
    createBtn.innerText = "Create";
    createBtn.onclick = async () => {
      const roomName = nameInput.value.trim();
      const maxPlayers = parseInt(maxSelect.value, 10);
      const password = passInput ? passInput.value.trim() || null : null;
      const allowSpectators = spectatorSelect ? spectatorSelect.value === "yes" : true;
      const roomType = roomTypeSelect.value;
      const frameDelay = frameDelaySelect ? parseInt(frameDelaySelect.value, 10) : 2;
      const syncMode = syncModeSelect ? syncModeSelect.value : "timeout";

      if (!roomName) {
        alert("Please enter a room name");
        return;
      }

      try {
        container.remove(); // Remove the popup
        await this.engine.netplayCreateRoom(roomName, maxPlayers, password, allowSpectators, roomType, frameDelay, syncMode);
      } catch (error) {
        console.error("[Netplay] Failed to create room:", error);
        alert("Failed to create room: " + error.message);
      }
    };

    const cancelBtn = this.createElement("button");
    cancelBtn.classList.add("ejs_button_button");
    cancelBtn.innerText = "Cancel";
    cancelBtn.onclick = () => {
      container.remove(); // Remove the popup
    };

    buttonContainer.appendChild(createBtn);
    buttonContainer.appendChild(cancelBtn);
    content.appendChild(buttonContainer);

    // Show/hide delay sync options based on room type
    roomTypeSelect.addEventListener("change", () => {
      delaySyncOptions.style.display = roomTypeSelect.value === "delay_sync" ? "" : "none";
    });

    // Add the popup to the netplay menu (like "Set Player Name")
    if (this.netplayMenu) {
      this.netplayMenu.appendChild(container);
    }

    // Focus on room name input
    setTimeout(() => nameInput.focus(), 100);
  };

  updateNetplayUI(isJoining) {
    if (!this.emulator.elements.bottomBar) return;

    const bar = this.emulator.elements.bottomBar;
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
    // Check if menu already exists
    const menuExists = !!this.netplayMenu;
    
    // Extract player name from JWT token
    let playerName = "Player"; // Default fallback
    
    try {
      // Get token from window.EJS_netplayToken or token cookie
      let token = window.EJS_netplayToken;
      if (!token) {
        // Try to get token from cookie
        const cookies = document.cookie.split(';');
        for (const cookie of cookies) {
          const [name, value] = cookie.trim().split('=');
          if (name === 'romm_sfu_token' || name === 'sfu_token') {
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
          let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
          while (base64.length % 4) {
            base64 += '=';
          }
          
          // Decode base64 to binary string, then convert to proper UTF-8
          const binaryString = atob(base64);
          
          // Convert binary string to UTF-8 using TextDecoder if available, otherwise fallback
          if (typeof TextDecoder !== 'undefined') {
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            return new TextDecoder('utf-8').decode(bytes);
          } else {
            // Fallback for older browsers: this may not handle all UTF-8 correctly
            return decodeURIComponent(escape(binaryString));
          }
        };
        
        try {
          const payloadStr = base64UrlDecode(token.split('.')[1]);
          const payload = JSON.parse(payloadStr);
          
          if (payload.sub) {
            // Use the netplay ID as player name, truncate if too long (Unicode-safe)
            playerName = Array.from(payload.sub).slice(0, 20).join('');
          }
        } catch (parseError) {
          console.error("[NetplayMenu] Failed to parse JWT payload:", parseError);
        }
      }
    } catch (e) {
      console.warn("[NetplayMenu] Failed to extract player name from token:", e);
    }
    
    if (!menuExists) {
      // Create popup first, but pass empty buttons array for setup by createBottomBarButtons
      const body = this.createPopup("Netplay Listings", {}, true); 
      
      // Set netplayMenu
      this.netplayMenu = body.parentElement;
      
      // Create your own main action button
      const rooms = this.createElement("div");
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
        item.style.fontWeight = "bold";
        row.appendChild(item);
        return item;
      };
      thead.appendChild(row);
      addToHeader("Room Type").style.width = "100px";
      addToHeader("Room Name").style["text-align"] = "center";
      addToHeader("Players").style.width = "80px";
      addToHeader("").style.width = "80px";
      table.appendChild(thead);
      const tbody = this.createElement("tbody");
  
      table.appendChild(tbody);
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
      joinedControls.appendChild(slotLabel);
      joinedControls.appendChild(slotSelect);
  
      joined.appendChild(title2);
      joined.appendChild(password);
      joined.appendChild(joinedControls);
  
      joined.style.display = "none";
      body.appendChild(rooms);
      body.appendChild(joined);
  
      // Extract player name from RomM netplay ID token
      let playerName = "Player"; // Default fallback
      
      try {
        // Get token from window.EJS_netplayToken or token cookie
        let token = window.EJS_netplayToken;
        if (!token) {
          // Try to get token from cookie (same logic as NetplayEngine)
          const cookies = document.cookie.split(';');
          for (const cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'romm_sfu_token' || name === 'sfu_token') {
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
            let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
            while (base64.length % 4) {
              base64 += '=';
            }
            
            // Decode base64 to binary string, then convert to proper UTF-8
            const binaryString = atob(base64);
            
            // Convert binary string to UTF-8 using TextDecoder if available, otherwise fallback
            if (typeof TextDecoder !== 'undefined') {
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              return new TextDecoder('utf-8').decode(bytes);
            } else {
              // Fallback for older browsers: this may not handle all UTF-8 correctly
              return decodeURIComponent(escape(binaryString));
            }
          };
          
          try {
            const payloadStr = base64UrlDecode(token.split('.')[1]);
            console.log("[EmulatorJS] Raw JWT payload:", payloadStr);
            const payload = JSON.parse(payloadStr);
            console.log("[EmulatorJS] Parsed JWT payload:", payload);
            
            if (payload.sub) {
              console.log("[EmulatorJS] Original sub field:", payload.sub);
              // Use the netplay ID as player name, truncate if too long (Unicode-safe)
              playerName = Array.from(payload.sub).slice(0, 20).join('');
              console.log("[EmulatorJS] Extracted player name:", playerName);
              console.log("[EmulatorJS] Player name char codes:", Array.from(playerName).map(c => c.charCodeAt(0)));
            }
          } catch (parseError) {
            console.error("[EmulatorJS] Failed to parse JWT payload:", parseError);
          }
        }
      } catch (e) {
        console.warn("[EmulatorJS] Failed to extract player name from token:", e);
      }
  
      // Create the netplay object after extracting the player name
      this.emulator.netplay = {
        name: playerName,
        engine: this.engine,
        table: tbody,
        passwordElem: password,
        roomNameElem: title2,
        createButton: this.leaveCreateButton,
        tabs: [rooms, joined],
        slotSelect: slotSelect,
        // Single source of truth for netplay ID - prioritizes session state over fallbacks
        getNetplayId: function() {
          // Priority order: session state (authenticated) > name > "local"
          return this.engine?.sessionState?.localPlayerId || this.name || "local";
        },
        ...this.emulator.netplay,
      };
  
      // Update existing player data if player table was already created
      if (this.emulator.netplay.joinedPlayers) {
        // Update the local player's name in joinedPlayers
        const localPlayer = this.emulator.netplay.joinedPlayers.find(p => p.name === "local" || p.name === this.emulator.netplay.engine?.sessionState?.localPlayerId);
        if (localPlayer) {
          localPlayer.name = playerName;
        }
        
        // Refresh the delay sync player table if it exists
        if (this.emulator.netplay.delaySyncPlayerTable) {
          // Clear and recreate the table with updated names
          this.emulator.netplay.delaySyncPlayerTable.innerHTML = "";
          this.emulator.netplay.joinedPlayers.forEach(player => {
            this.netplayUpdatePlayerTable(player.slot);
          });
        }
      }
  
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
  
        if (!this.netplay._slotSelectWired) {
          this.netplay._slotSelectWired = true;
          this.addEventListener(this.netplay.slotSelect, "change", () => {
            const raw = parseInt(this.netplay.slotSelect.value, 10);
            const slot = isNaN(raw) ? 0 : Math.max(0, Math.min(3, raw));
            this.netplay.localSlot = slot;
            this.netplayPreferredSlot = slot;
            window.EJS_NETPLAY_PREFERRED_SLOT = slot;
            if (this.netplay.extra) {
              this.netplay.extra.player_slot = slot;
            }
            // Update player table with new slot
            this.netplayUpdatePlayerSlot(slot);
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
    
    if (!this.netplay || typeof this.netplay.updateList !== "function") {
      this.defineNetplayFunctions();
    }
    
    // Setup correct UI based on current room state before showing
    if (this.emulator.netplay && this.emulator.netplay.currentRoomId) {
      // User is in a room, setup room UI
      const roomType = this.emulator.netplay.currentRoom?.netplay_mode === 1 ? 'delaysync' : 'livestream';

      // Ensure room UI elements exist (they might not if menu was created before joining room)
      if (roomType === 'livestream' && !this.netplay.liveStreamPlayerTable) {
        // Set up the player slot selector first
        this.netplaySetupSlotSelector();

        // Create the player table
        const table = this.createNetplayTable('livestream');

        // Insert table after the slot selector
        if (this.netplay.slotSelect && this.netplay.slotSelect.parentElement) {
          this.netplay.slotSelect.parentElement.parentElement.insertBefore(table, this.netplay.slotSelect.parentElement.nextSibling);
        }

        // This populates and updates the table.
        this.netplayInitializeLiveStreamPlayers();
      } else if (roomType === 'delaysync' && !this.netplay.delaySyncPlayerTable) {
        // Set up the player slot selector first
        this.netplaySetupSlotSelector();

        // Create the player table
        const table = this.createNetplayTable('delaysync');

        // Insert table after the slot selector
        if (this.netplay.slotSelect && this.netplay.slotSelect.parentElement) {
          this.netplay.slotSelect.parentElement.parentElement.insertBefore(table, this.netplay.slotSelect.parentElement.nextSibling);
        }

        // Initialize player list (host is always player 1)
        this.netplayInitializeDelaySyncPlayers(this.emulator.netplay.currentRoom?.max_players || 4);
      }

      // Switch to joined tab for room view
      if (this.netplay.tabs && this.netplay.tabs[0] && this.netplay.tabs[1]) {
        this.netplay.tabs[0].style.display = "none";  // Hide rooms tab
        this.netplay.tabs[1].style.display = "";  // Show joined tab
      }

      // Update title based on room type
      const titleElement = this.netplayMenu.querySelector("h4");
      if (titleElement) {
        titleElement.innerText = roomType === 'delaysync' ? "Delay Sync Room" : "Live Stream Room";
      }

      // Setup bottom bar for room type
      this.setupNetplayBottomBar(roomType);

      // Update room info display
      if (this.netplay.roomNameElem) {
        this.netplay.roomNameElem.innerText = this.emulator.netplay.currentRoom?.name || this.emulator.netplay.currentRoomId;
      }
      if (this.netplay.passwordElem) {
        const hasPassword = this.emulator.netplay.currentRoom?.password;
        this.netplay.passwordElem.innerText = hasPassword ? `Password: ${'*'.repeat(hasPassword.length)}` : "";
        this.netplay.passwordElem.style.display = hasPassword ? "" : "none";
      }
    } else {
      // User is not in a room, setup listings UI
      this.setupNetplayBottomBar('listings');

      // Switch to rooms tab when showing listings
      if (this.netplay.tabs && this.netplay.tabs[0] && this.netplay.tabs[1]) {
        this.netplay.tabs[0].style.display = "";  // Show rooms tab
        this.netplay.tabs[1].style.display = "none";  // Hide joined tab
      }
    }

    // Show netplay menu
    this.netplayMenu.style.display = 'block';
    
    // Hide player slot selector in lobby view (only for new menus)
    if (!menuExists && this.netplay && this.netplay.slotSelect && this.netplay.slotSelect.parentElement) {
      this.netplay.slotSelect.parentElement.style.display = "none";
    }
    
    // Show player name popup only if no valid name was extracted from token AND this is a new menu
    if (!menuExists && (!playerName || playerName === "Player")) {
      this.netplay = {
        table: tbody,
        passwordElem: password,
        roomNameElem: title2,
        createButton: this.leaveCreateButton,
        tabs: [rooms, joined],
        slotSelect: slotSelect,
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
        const enteredName = input.value.trim();
        this.netplay.name = enteredName;
        this.emulator.netplay.name = enteredName; // Also update the emulator netplay object
        popups[0].remove();
      });
    }
  
    this.setupNetplayBottomBar('listings');
    this.netplay.updateList.start();
  }

  // Attach consumer media track to UI elements
  // Audio is the master clock - audio element must be created first
  // Browser handles A/V sync via RTCP, we don't programmatically sync tracks
  netplayAttachConsumerTrack(track, kind) {
    if (!track) {
      console.warn(`[NetplayMenu] No track provided for ${kind}`);
      return;
    }

    console.log(`[NetplayMenu] Attaching ${kind} consumer track:`, track);

    // Initialize media elements storage if not exists
    if (!this.netplay.mediaElements) {
      this.netplay.mediaElements = {};
    }

    try {
      if (kind === 'audio') {
        // Audio is master clock - create audio element first
        let audioElement = this.netplay.mediaElements.audio;
        if (!audioElement) {
          audioElement = document.createElement('audio');
          audioElement.autoplay = true;
          audioElement.playsInline = true;
          audioElement.muted = false; // Ensure audio is not muted
          audioElement.style.display = 'none'; // Hidden element
          audioElement.id = 'ejs-netplay-audio';
          
          // Append to DOM before storing reference
          document.body.appendChild(audioElement);
          this.netplay.mediaElements.audio = audioElement;
          
          // Hook into emulator's volume control to sync stream audio volume
          this.netplaySetupStreamVolumeControl();
          
          // Set initial volume from emulator
          if (this.emulator.volume !== undefined) {
            audioElement.volume = this.emulator.volume;
          }
          
          console.log('[NetplayMenu] Created audio element (master clock)');
        }

        // Ensure audio element is in the DOM
        if (!audioElement.isConnected) {
          console.warn('[NetplayMenu] Audio element not in DOM, re-appending...');
          document.body.appendChild(audioElement);
        }

        // Ensure audio is not muted
        audioElement.muted = false;

        // Stop any existing tracks
        if (audioElement.srcObject) {
          const existingStream = audioElement.srcObject;
          existingStream.getTracks().forEach(t => t.stop());
        }

        // Create new MediaStream with the track
        const audioStream = new MediaStream([track]);
        audioElement.srcObject = audioStream;

        // Ensure playback starts - wait for element to be ready
        const playAudio = async () => {
          try {
            // Wait a tiny bit to ensure element is fully in DOM
            await new Promise(resolve => setTimeout(resolve, 50));
            
            if (audioElement.isConnected && audioElement.srcObject) {
              // Ensure not muted and volume is set
              audioElement.muted = false;
              if (this.emulator.volume !== undefined) {
                audioElement.volume = this.emulator.volume;
              }
              
              await audioElement.play();
              console.log('[NetplayMenu] Audio playback started successfully', {
                muted: audioElement.muted,
                volume: audioElement.volume,
                paused: audioElement.paused,
                readyState: audioElement.readyState
              });
            } else {
              console.warn('[NetplayMenu] Audio element not ready for playback', {
                isConnected: audioElement.isConnected,
                hasSrcObject: !!audioElement.srcObject
              });
            }
          } catch (err) {
            console.warn('[NetplayMenu] Audio autoplay prevented, user interaction may be required:', err);
          }
        };
        
        playAudio();

        console.log('[NetplayMenu] Audio track attached to audio element');
        
        // Debug: Log audio element state
        const audioEl = this.netplay.mediaElements?.audio;
        if (audioEl) {
          console.log('[NetplayMenu] Audio element state:', {
            isConnected: audioEl.isConnected,
            muted: audioEl.muted,
            volume: audioEl.volume,
            srcObject: !!audioEl.srcObject,
            paused: audioEl.paused,
            readyState: audioEl.readyState
          });
        }

      } else if (kind === 'video') {
        // Video follows audio clock - create video element
        let videoElement = this.netplay.mediaElements.video;
        if (!videoElement) {
          videoElement = document.createElement('video');
          videoElement.autoplay = true;
          videoElement.playsInline = true;
          videoElement.muted = true; // Audio comes from audio element
          videoElement.id = 'ejs-netplay-video';

          // Store video element reference BEFORE appending to DOM
          this.netplay.mediaElements.video = videoElement;
        }

        // Show video for clients in livestream rooms, hide for others
        const isHost = this.emulator.netplay.engine?.sessionState?.isHostRole();
        const isLivestream = this.emulator.netplay.currentRoom?.netplay_mode === 0;
        
        console.log('[NetplayMenu] Video element visibility check:', {
          isHost,
          isLivestream,
          currentRoom: this.emulator.netplay.currentRoom,
          netplay_mode: this.emulator.netplay.currentRoom?.netplay_mode
        });
        
        if (!isHost && isLivestream) {
          // Pause emulator when showing video (canvas should already be hidden)
          if (typeof this.emulator.pause === 'function' && !this.emulator.paused) {
            console.log('[NetplayMenu] Pausing emulator before showing video');
            this.emulator.pause();
          }
          
          // Position video element above the emulator canvas
          // The emulator canvas is inside .ejs_game, which is inside .ejs_parent
          // Append to .ejs_game (the actual game display area) to match canvas bounds
          const gameContainer = this.emulator.game || this.emulator.elements?.main;
          const emulatorParent = this.emulator.elements?.parent || this.emulator.game?.parentElement;
          
          // Use game container if available, otherwise fall back to parent
          const targetContainer = gameContainer || emulatorParent;
          
          if (targetContainer) {
            // Ensure container has position relative for absolute positioning
            const containerStyle = window.getComputedStyle(targetContainer);
            if (containerStyle.position === 'static') {
              targetContainer.style.position = 'relative';
            }
            // Ensure overflow is hidden to clip video if it extends beyond bounds
            if (containerStyle.overflow !== 'hidden') {
              targetContainer.style.overflow = 'hidden';
            }
            
            videoElement.style.display = 'block';
            videoElement.style.position = 'absolute';
            videoElement.style.top = '0';
            videoElement.style.left = '0';
            videoElement.style.right = '0'; // Bind to right edge
            videoElement.style.bottom = '0'; // Bind to bottom edge
            videoElement.style.width = '100%';
            videoElement.style.height = '100%';
            videoElement.style.minWidth = '0'; // Allow element to shrink below intrinsic size
            videoElement.style.minHeight = '0'; // Allow element to shrink below intrinsic size
            videoElement.style.maxWidth = '100%'; // Prevent horizontal overflow
            videoElement.style.maxHeight = '100%'; // Prevent vertical overflow
            videoElement.style.boxSizing = 'border-box'; // Include padding/border in size calculations
            videoElement.style.overflow = 'hidden'; // Clip any overflow from video content
            videoElement.style.zIndex = '100'; // Above canvas and most UI elements
            videoElement.style.objectFit = 'contain'; // Fit within container while maintaining aspect ratio
            videoElement.style.objectPosition = 'center center'; // Center the video content
            videoElement.style.transform = 'scale(1.1)'; // Scale up slightly to fill more (clipped by container overflow)
            videoElement.style.transformOrigin = 'center center'; // Scale from center
            videoElement.style.backgroundColor = '#000'; // Black background to match emulator
            
            // Append to target container if not already appended
            if (!targetContainer.contains(videoElement)) {
              targetContainer.appendChild(videoElement);
              console.log('[NetplayMenu] Appended video element to game container:', targetContainer === gameContainer ? 'ejs_game' : 'ejs_parent');
            }
            
            console.log('[NetplayMenu] Created visible video element for livestream client (overlaying paused canvas)');
          } else {
            videoElement.style.display = 'block';
            videoElement.style.position = 'fixed';
            videoElement.style.top = '0';
            videoElement.style.left = '0';
            videoElement.style.width = '100vw';
            videoElement.style.height = '100vh';
            videoElement.style.minWidth = '0';
            videoElement.style.minHeight = '0';
            videoElement.style.maxWidth = '100vw';
            videoElement.style.maxHeight = '100vh';
            videoElement.style.boxSizing = 'border-box';
            videoElement.style.overflow = 'hidden';
            videoElement.style.zIndex = '100';
            videoElement.style.objectFit = 'contain';
            videoElement.style.objectPosition = 'center center';
            videoElement.style.transform = 'scale(1.1)';
            videoElement.style.transformOrigin = 'center center';
            videoElement.style.backgroundColor = '#000';
            if (!document.body.contains(videoElement)) {
              document.body.appendChild(videoElement);
            }
            console.log('[NetplayMenu] Appended video element to body (fallback)');
          }
        } else {
          videoElement.style.display = 'none'; // Hidden for hosts or delay-sync rooms
          // Still append to DOM but hidden
          if (!document.body.contains(videoElement)) {
            document.body.appendChild(videoElement);
          }
          console.log('[NetplayMenu] Created hidden video element (host or delay-sync room)');
        }
        
        // Ensure video element is in the DOM before setting srcObject
        if (!videoElement.isConnected) {
          console.warn('[NetplayMenu] Video element not in DOM, attempting to append...');
          const emulatorParent = this.emulator.elements?.parent || this.emulator.game?.parentElement;
          if (emulatorParent && !emulatorParent.contains(videoElement)) {
            emulatorParent.appendChild(videoElement);
          } else if (!document.body.contains(videoElement)) {
            document.body.appendChild(videoElement);
          }
        }

        // Stop any existing tracks
        if (videoElement.srcObject) {
          const existingStream = videoElement.srcObject;
          existingStream.getTracks().forEach(t => t.stop());
        }

        // Create new MediaStream with the track
        const videoStream = new MediaStream([track]);
        videoElement.srcObject = videoStream;

        // Re-check visibility conditions when attaching track (in case room info wasn't available when element was created)
        const isHostCheck = this.emulator.netplay.engine?.sessionState?.isHostRole();
        const isLivestreamCheck = this.emulator.netplay.currentRoom?.netplay_mode === 0;
        
        if (!isHostCheck && isLivestreamCheck && videoElement.style.display === 'none') {
          console.log('[NetplayMenu] Making video element visible now that track is attached');
          videoElement.style.display = 'block';
        }

        // Ensure playback starts - wait for element to be ready
        const playVideo = async () => {
          try {
            // Wait a tiny bit to ensure element is fully in DOM
            await new Promise(resolve => setTimeout(resolve, 50));
            
            if (videoElement.isConnected && videoElement.srcObject) {
              await videoElement.play();
              console.log('[NetplayMenu] Video playback started successfully');
            } else {
              console.warn('[NetplayMenu] Video element not ready for playback', {
                isConnected: videoElement.isConnected,
                hasSrcObject: !!videoElement.srcObject,
                display: videoElement.style.display
              });
            }
          } catch (err) {
            console.warn('[NetplayMenu] Video autoplay prevented:', err);
            // Try again after user interaction if needed
            if (err.name === 'NotAllowedError') {
              console.log('[NetplayMenu] User interaction may be required for video playback');
            }
          }
        };
        
        playVideo();

        console.log('[NetplayMenu] Video track attached to video element');
      
        // Debug: Log video element state
        const videoEl = this.netplay.mediaElements?.video;
        if (videoEl) {
          console.log('[NetplayMenu] Video element state:', {
            isConnected: videoEl.isConnected,
            display: videoEl.style.display,
            srcObject: !!videoEl.srcObject,
            paused: videoEl.paused,
            readyState: videoEl.readyState,
            videoWidth: videoEl.videoWidth,
            videoHeight: videoEl.videoHeight
          });
        }
    }
    } catch (error) {
        console.error('[NetplayMenu] Error attaching consumer track:', error);
      }
  }

  /**
   * Hook into emulator's volume control to sync stream audio volume
   */
  netplaySetupStreamVolumeControl() {
      if (this.netplay._volumeControlHooked) {
        return;
      }
      this.netplay._volumeControlHooked = true;
      
      // Store original setVolume method
      const originalSetVolume = this.emulator.setVolume.bind(this.emulator);
      
      // Override setVolume to also update stream audio
      this.emulator.setVolume = (volume) => {
        // Call original method first
        originalSetVolume(volume);
        
        // Update stream audio element volume
        const audioElement = this.netplay.mediaElements?.audio;
        if (audioElement) {
          audioElement.volume = volume;
        }
      };
      
      // Also sync when volume property is set directly
      let volumeProperty = this.emulator.volume;
      Object.defineProperty(this.emulator, 'volume', {
        get: function() {
          return volumeProperty;
        },
        set: function(value) {
          volumeProperty = value;
          // Update stream audio if it exists
          const audioElement = this.netplay?.mediaElements?.audio;
          if (audioElement) {
            audioElement.volume = value;
          }
          // Call setVolume to update UI and emulator audio
          if (this.setVolume) {
            this.setVolume(value);
          }
        }
      });
      
      console.log('[NetplayMenu] Stream audio volume control hooked into emulator volume');
    }

  // Update player list in UI
  netplayUpdatePlayerList(data) {
    console.log("[NetplayMenu] Updating player list:", data);
    console.log("[NetplayMenu] Players object keys:", Object.keys(data.players || {}));
    console.log("[NetplayMenu] Players object values:", Object.values(data.players || {}));

    if (!data || !data.players) {
      console.warn("[NetplayMenu] No players data provided");
      return;
    }

    // Convert players object to joinedPlayers array format
    // data.players format: { playerId: { name, slot, ready, ... }, ... }
    // joinedPlayers format: [{ id, slot, name, ready, ... }, ...]
    const playersArray = Object.entries(data.players).map(([playerId, playerData]) => ({
      id: playerId,
      slot: playerData.slot || playerData.player_slot || 0,
      name: playerData.name || playerData.player_name || "Unknown",
      ready: playerData.ready || false,
      // Include any other properties that might be needed
      ...playerData
    }));
    console.log("[NetplayMenu] Converted playersArray:", playersArray);
    console.log("[NetplayMenu] playersArray length:", playersArray.length);

    // Identify the local player to auto-assign slot if needed
    const localPlayerId = this.netplay.engine?.sessionState?.localPlayerId;
    const localPlayerName = this.netplay.name;
    console.log("[NetplayMenu] Local player ID:", localPlayerId, "Local player name:", localPlayerName);

    // Track current taken slots
    const takenSlots = new Set();
    playersArray.forEach(player => {
      if (player.slot !== undefined && player.slot !== null) {
        takenSlots.add(player.slot);
      }
    });

    // Auto-assign slots to players who don't have one or have conflicting slots
    playersArray.forEach((player, index) => {
      // Check if this is the local player
      const isLocalPlayer = (localPlayerId && player.id === localPlayerId) ||
                           (localPlayerName && player.name === localPlayerName);

      // If player has no slot assigned or slot conflicts, assign a free slot
      if (player.slot === undefined || player.slot === null ||
          takenSlots.has(player.slot) && !isLocalPlayer) {
        // Find lowest available slot
        let newSlot = 0;
        while (takenSlots.has(newSlot) && newSlot < 4) {
          newSlot++;
        }

        if (newSlot < 4) {
          console.log(`[NetplayMenu] Auto-assigning slot ${newSlot} to player ${player.name} (was ${player.slot})`);
          player.slot = newSlot;
          takenSlots.add(newSlot);

          // Update local slot preference if this is the local player
          if (isLocalPlayer) {
            this.netplay.localSlot = newSlot;
            this.netplayPreferredSlot = newSlot;
            window.EJS_NETPLAY_PREFERRED_SLOT = newSlot;
            if (this.netplay.extra) {
              this.netplay.extra.player_slot = newSlot;
            }
            console.log(`[NetplayMenu] Updated local player slot to ${newSlot}`);
          }
        } else {
          console.warn(`[NetplayMenu] No available slots for player ${player.name}`);
        }
      } else {
        // Slot is valid, mark it as taken
        takenSlots.add(player.slot);
      }
    });

    // Update joinedPlayers array
    this.netplay.joinedPlayers = playersArray;

    // Update taken slots
    if (!this.netplay.takenSlots) {
      this.netplay.takenSlots = new Set();
    }
    this.netplay.takenSlots.clear();
    playersArray.forEach(player => {
      this.netplay.takenSlots.add(player.slot);
    });

    // Update ready states array
    const maxPlayers = this.netplay.maxPlayers || 4;
    this.netplay.playerReadyStates = new Array(maxPlayers).fill(false);
    playersArray.forEach(player => {
      if (player.slot < maxPlayers) {
        this.netplay.playerReadyStates[player.slot] = player.ready || false;
      }
    });

    // Update the appropriate player table
    if (this.netplay.delaySyncPlayerTable || this.netplay.liveStreamPlayerTable) {
      const tableType = this.netplay.delaySyncPlayerTable ? "delay sync" : "live stream";
      console.log(`[NetplayMenu] Rebuilding ${tableType} player table with`, playersArray.length, "players");

      // Clear existing table
      const tbody = this.netplay.delaySyncPlayerTable || this.netplay.liveStreamPlayerTable;
      console.log("[NetplayMenu] Clearing existing table, had", tbody.children.length, "rows");
      tbody.innerHTML = "";

      // Rebuild table with current players
      console.log(`[NetplayMenu] Rebuilding table with ${playersArray.length} players`);
      this.netplayUpdatePlayerTable(playersArray);

      console.log("[NetplayMenu] Table rebuild complete, now has", tbody.children.length, "rows");

      // Log the content of each row
      for (let i = 0; i < tbody.children.length; i++) {
        const row = tbody.children[i];
        const cells = row.querySelectorAll('td');
        const cellTexts = Array.from(cells).map(cell => cell.textContent);
        console.log(`[NetplayMenu] Row ${i} content:`, cellTexts);
      }

      // Also log the entire table HTML for debugging
      console.log("[NetplayMenu] Table HTML:", tbody.innerHTML);
    } else {
      console.log("[NetplayMenu] No player table to update");
    }

    // Update slot selector to reflect taken slots and select current player's slot
    this.netplayUpdateSlotSelector();

    // Update launch button state
    this.netplayUpdateLaunchButton();
  }
  // Clean up room-specific UI elements
  cleanupRoomUI() {
    console.log("[NetplayMenu] Cleaning up room UI elements");

    // Restore canvas visibility (in case it was hidden for livestream)
    if (this.emulator && this.emulator.canvas && this.emulator.canvas.style.display === 'none') {
      console.log("[NetplayMenu] Restoring canvas visibility");
      this.emulator.canvas.style.display = '';
    }

    // Clean up media elements
    if (this.netplay && this.netplay.mediaElements) {
      // Remove video element if it exists
      if (this.netplay.mediaElements.video && this.netplay.mediaElements.video.parentElement) {
        console.log("[NetplayMenu] Removing video element from DOM");
        this.netplay.mediaElements.video.parentElement.removeChild(this.netplay.mediaElements.video);
      }
      // Clear media elements references
      this.netplay.mediaElements = {};
    }

    // Remove table elements from DOM
    if (this.netplay) {
      // Remove live stream table
      if (this.netplay.liveStreamPlayerTable && this.netplay.liveStreamPlayerTable.parentElement) {
        const table = this.netplay.liveStreamPlayerTable.parentElement; // tbody -> table
        if (table.parentElement) {
          table.parentElement.removeChild(table);
        }
      }

      // Remove delay sync table
      if (this.netplay.delaySyncPlayerTable && this.netplay.delaySyncPlayerTable.parentElement) {
        const table = this.netplay.delaySyncPlayerTable.parentElement; // tbody -> table
        if (table.parentElement) {
          table.parentElement.removeChild(table);
        }
      }

      // Clear table references
      this.netplay.liveStreamPlayerTable = null;
      this.netplay.delaySyncPlayerTable = null;

      // Clear other room-specific UI elements
      if (this.netplay.slotSelect && this.netplay.slotSelect.parentElement) {
        const slotContainer = this.netplay.slotSelect.parentElement;
        if (slotContainer.parentElement) {
          slotContainer.parentElement.removeChild(slotContainer);
        }
      }
      this.netplay.slotSelect = null;

      // Clear player-related state
      this.netplay.joinedPlayers = [];
      this.netplay.takenSlots = new Set();
      this.netplay.playerReadyStates = null;
      this.netplay.localSlot = null;
      this.netplay.PreferredSlot = null;
    }
  }

  // Add this function to NetplayMenu class

  /**
   * Setup input syncing for live stream room based on host status and player slot
   * Non-host players (P2, P3, P4) will send their inputs to the host via data channel
   */
  /**
   * Setup input syncing for live stream room based on host status and player slot
   * Non-host players (P2, P3, P4) will send their inputs to the host via data channel
   */
  netplaySetupLiveStreamInputSync() {
    if (!this.netplay || !this.netplay.engine) {
      console.warn("[NetplayMenu] Engine not available for input sync setup");
      return;
    }

    const engine = this.netplay.engine;
    const isHost = engine.sessionState?.isHostRole() || false;
    
    // Get current player slot from player data (more reliable than this.netplay.localSlot)
    let playerSlot = 0;
    const localPlayerId = engine.sessionState?.localPlayerId;
    const localPlayerName = this.netplay.name;
    
    // Try to get slot from player manager first
    if (engine.playerManager) {
      const players = engine.playerManager.getPlayersObject() || {};
      const localPlayer = Object.values(players).find(p => 
        (localPlayerId && p.id === localPlayerId) ||
        (localPlayerName && p.name === localPlayerName)
      );
      if (localPlayer && (localPlayer.slot !== undefined || localPlayer.player_slot !== undefined)) {
        playerSlot = localPlayer.slot !== undefined ? localPlayer.slot : localPlayer.player_slot;
      }
    }
    
    // Fallback to this.netplay.localSlot or engine.sessionState.localSlot
    if (playerSlot === 0 && (this.netplay.localSlot !== undefined && this.netplay.localSlot !== null)) {
      playerSlot = parseInt(this.netplay.localSlot, 10);
    } else if (playerSlot === 0 && engine.sessionState?.localSlot !== undefined) {
      playerSlot = engine.sessionState.localSlot;
    }

    console.log("[NetplayMenu] Setting up input sync:", {
      isHost,
      playerSlot,
      slotName: `P${playerSlot + 1}`
    });

    // Set global preferred slot for InputSync (so it maps inputs to correct slot)
    if (typeof window !== "undefined") {
      window.EJS_NETPLAY_PREFERRED_SLOT = playerSlot;
      console.log("[NetplayMenu] Set window.EJS_NETPLAY_PREFERRED_SLOT to:", playerSlot);
    }

    // Configure InputSync with the player slot
    if (engine.inputSync.slotManager) {
      if (localPlayerId) {
        const assignedSlot = engine.inputSync.slotManager.assignSlot(localPlayerId, playerSlot);
        console.log("[NetplayMenu] Assigned slot", assignedSlot, "to player", localPlayerId);
      } else {
        console.warn("[NetplayMenu] No localPlayerId available for slot assignment");
      }
    }

    // Get input mode from settings (unorderedRelay, orderedRelay, or unorderedP2P)
    const inputMode = this.emulator.getSettingValue("netplayInputMode") || 
                      this.emulator.netplayInputMode || 
                      "unorderedRelay";

    console.log("[NetplayMenu] Input mode:", inputMode);

    // Ensure InputSync is initialized
    if (!engine.inputSync) {
      console.warn("[NetplayMenu] InputSync not initialized yet");
      return;
    }

    // Ensure DataChannelManager is configured with the correct mode
    if (engine.dataChannelManager) {
      engine.dataChannelManager.mode = inputMode;
      console.log("[NetplayMenu] DataChannelManager mode set to:", inputMode);
    }

    // Set global preferred slot for InputSync (so it maps inputs to correct slot)
    if (typeof window !== "undefined") {
      window.EJS_NETPLAY_PREFERRED_SLOT = playerSlot;
    }

    // Configure InputSync with the player slot
    if (engine.inputSync.slotManager) {
      if (localPlayerId) {
        engine.inputSync.slotManager.assignSlot(localPlayerId, playerSlot);
        console.log("[NetplayMenu] Assigned slot", playerSlot, "to player", localPlayerId);
      }
    }

    // For live stream mode, both host and clients should send inputs via data channel
    if (engine.dataChannelManager) {
      // Override InputSync's sendInputCallback to send via data channel
      const originalSendInputCallback = engine.inputSync.sendInputCallback;
      engine.inputSync.sendInputCallback = (frame, inputData) => {
        // Call original callback (for Socket.IO fallback)
        if (originalSendInputCallback) {
          originalSendInputCallback(frame, inputData);
        }

        // Send via data channel if ready
        if (engine.dataChannelManager && engine.dataChannelManager.isReady()) {
          if (Array.isArray(inputData)) {
            inputData.forEach((data) => {
              if (data.connected_input && data.connected_input.length === 3) {
                const [playerIndex, inputIndex, value] = data.connected_input;
                engine.dataChannelManager.sendInput(playerIndex, inputIndex, value);
              }
            });
          } else if (inputData.connected_input && inputData.connected_input.length === 3) {
            const [playerIndex, inputIndex, value] = inputData.connected_input;
            engine.dataChannelManager.sendInput(playerIndex, inputIndex, value);
          }
        } else {
          console.log("[NetplayMenu] DataChannelManager not ready, inputs will use Socket.IO fallback");
        }
      };

      if (isHost) {
        console.log("[NetplayMenu] Host input callback configured to send via data channel");
      } else {
        console.log("[NetplayMenu] Client input callback configured to send via data channel");
      }
    }

    // The emulator's simulateInput will automatically route through InputSync
    // which will send inputs via DataChannelManager using the configured mode
    console.log("[NetplayMenu] Input sync setup complete for slot", playerSlot, "with mode", inputMode);
  }

  // Join room via socket (legacy method)
  netplayJoinRoomViaSocket(roomName) {
    console.log("[NetplayMenu] Joining room via socket:", roomName);
    // TODO: Implement actual socket room joining
    // For now, this is a stub to prevent errors
  }

  // Setup input forwarding for data producers
  netplaySetupInputForwarding(dataProducer) {
    console.log("[NetplayMenu] Setting up input forwarding:", dataProducer);
    
    // Setup input syncing (this will configure InputSync and DataChannelManager)
    // we will manage conditions here to stage users based on the room type 
    // and their slot + settings when this is called.
    this.netplaySetupLiveStreamInputSync();
  }
  // ... continue with all other netplay* functions
  // All other netplay functions moved here...
}

window.NetplayMenu = NetplayMenu;
