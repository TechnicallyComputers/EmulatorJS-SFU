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
    this.menuElement = this.emulator.createPopup('Netplay', [], true);
    // Auto-bind emulator helpers to this instance
    [
      'createElement',
      'createPopup',
      'localization',
      'createSubPopup',
      'addEventListener',
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
    this.menuElement.style.display = 'block';
  }

  hide() {
    this.menuElement.style.display = 'none';
  }

  isVisible() {
    return this.menuElement.style.display !== 'none';
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

    // Stop room list refresh
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

    // Hide normal joined controls and show lobby controls
    if (this.netplay.tabs && this.netplay.tabs[1]) {
      const joinedDiv = this.netplay.tabs[1];
      const joinedControls = joinedDiv.querySelector(".ejs_netplay_header");
      if (joinedControls) {
        joinedControls.style.display = "none";
      }

      // Create lobby controls
      const lobbyControls = this.createElement("div");
      lobbyControls.classList.add("ejs_netplay_header");
      lobbyControls.style.display = "flex";
      lobbyControls.style.alignItems = "center";
      lobbyControls.style.gap = "10px";
      lobbyControls.style.margin = "10px 0";
      lobbyControls.style.justifyContent = "center";
      lobbyControls.style.flexWrap = "wrap";

      // Ready button
      const readyButton = this.createElement("button");
      readyButton.classList.add("ejs_button_button");
      readyButton.style["background-color"] = "rgba(var(--ejs-primary-color),1)";
      readyButton.innerText = "Ready";
      readyButton.disabled = this.netplay.extra?.is_spectator;
      lobbyControls.appendChild(readyButton);

      // Launch Game button (only for owner)
      const launchButton = this.createElement("button");
      launchButton.classList.add("ejs_button_button");
      launchButton.style["background-color"] = "rgba(0, 150, 0, 1)";
      launchButton.innerText = "Launch Game";
      launchButton.disabled = !this.netplay.owner;
      if (!this.netplay.owner) {
        launchButton.style.display = "none";
      }
      lobbyControls.appendChild(launchButton);

      // Leave Room button
      const leaveButton = this.createElement("button");
      leaveButton.classList.add("ejs_button_button");
      leaveButton.innerText = "Leave Room";
      lobbyControls.appendChild(leaveButton);

      // Close button
      const closeButton = this.createElement("button");
      closeButton.classList.add("ejs_button_button");
      closeButton.innerText = "Close";
      lobbyControls.appendChild(closeButton);

      // Insert after password element
      const passwordElem = this.netplay.passwordElem;
      if (passwordElem && passwordElem.parentElement) {
        passwordElem.parentElement.insertBefore(lobbyControls, passwordElem.nextSibling);
      }

      // Store reference for cleanup
      this.netplay.lobbyControls = lobbyControls;

      // Event handlers
      this.addEventListener(readyButton, "click", () => {
        readyButton.innerText = readyButton.innerText === "Ready" ? "Not Ready" : "Ready";
      });

      this.addEventListener(launchButton, "click", () => {
        // For now, just hide the lobby
        if (this.netplay.lobbyControls) {
          this.netplay.lobbyControls.remove();
        }
        this.netplayRestoreMenu();
      });

      this.addEventListener(leaveButton, "click", () => {
        this.netplayLeaveRoom();
      });

      this.addEventListener(closeButton, "click", () => {
        if (this.netplayMenu) this.netplayMenu.style.display = "none";
      });
    }

    // Mark as in lobby mode
    this.netplay.isInDelaySyncLobby = true;
  }

  // Switch to live stream room UI
  netplaySwitchToLiveStreamRoom(roomName, password) {
    if (!this.netplayMenu) return;

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

    // Show the existing player slot selector (centered)
    if (this.netplay.slotSelect && this.netplay.slotSelect.parentElement) {
      const slotContainer = this.netplay.slotSelect.parentElement;
      slotContainer.style.display = "";
      slotContainer.style.marginTop = "10px";
      slotContainer.style.marginBottom = "10px";
      slotContainer.style.display = "flex";
      slotContainer.style.justifyContent = "center";
      slotContainer.style.alignItems = "center";
    }

    // Create player table for live stream
    if (!this.netplay.liveStreamPlayerTable) {
      const table = this.createElement("table");
      table.classList.add("ejs_netplay_table");
      table.style.width = "100%";
      table.setAttribute("cellspacing", "0");

      // Table header
      const thead = this.createElement("thead");
      const headerRow = this.createElement("tr");
      ["Player", "Name", "Status"].forEach(text => {
        const th = this.createElement("td");
        th.innerText = text;
        th.style.fontWeight = "bold"; // Make headers bold
        th.style.textAlign = "center";
        if (text === "Player" || text === "Status") th.style.width = "60px";
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);

      // Table body
      const tbody = this.createElement("tbody");
      this.netplay.liveStreamPlayerTable = tbody;
      table.appendChild(tbody);

      // Insert table after player slot selector
      if (this.netplay.slotSelect && this.netplay.slotSelect.parentElement) {
        this.netplay.slotSelect.parentElement.parentElement.insertBefore(table, this.netplay.slotSelect.parentElement.nextSibling);
      }
    }

    // Initialize live stream player table (just host for now)
    this.netplayInitializeLiveStreamPlayers();

    // Hide create button and show leave/close buttons
    const buttons = this.netplayMenu.querySelectorAll("a.ejs_button");
    buttons.forEach(btn => {
      if (btn.innerText === "Create a Room") {
        btn.style.display = "none";
      } else if (btn.innerText === "Close") {
        btn.innerText = "Leave Room";
      }
    });

    this.isNetplay = true;
  }

  // Switch to delay sync room UI
  netplaySwitchToDelaySyncRoom(roomName, password, maxPlayers) {
    if (!this.netplayMenu) return;

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

    // Show the existing player slot selector (centered)
    if (this.netplay.slotSelect && this.netplay.slotSelect.parentElement) {
      const slotContainer = this.netplay.slotSelect.parentElement;
      slotContainer.style.display = "";
      slotContainer.style.marginTop = "10px";
      slotContainer.style.marginBottom = "10px";
      slotContainer.style.display = "flex";
      slotContainer.style.justifyContent = "center";
      slotContainer.style.alignItems = "center";
    }

    // Create player table for delay sync
    if (!this.netplay.delaySyncPlayerTable) {
      const table = this.createElement("table");
      table.classList.add("ejs_netplay_table");
      table.style.width = "100%";
      table.setAttribute("cellspacing", "0");

      // Table header
      const thead = this.createElement("thead");
      const headerRow = this.createElement("tr");
      ["Player", "Name", "Ready"].forEach(text => {
        const th = this.createElement("td");
        th.innerText = text;
        th.style.fontWeight = "bold"; // Make headers bold
        if (text === "Ready") {
          th.style.textAlign = "right"; // Align Ready column to the right
          th.style.width = "60px"; // Status column width
        } else {
          th.style.textAlign = "center";
        }
        if (text === "Player") th.style.width = "60px";
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);

      // Table body
      const tbody = this.createElement("tbody");
      this.netplay.delaySyncPlayerTable = tbody;
      table.appendChild(tbody);

      // Insert table after player slot selector
      if (this.netplay.slotSelect && this.netplay.slotSelect.parentElement) {
        this.netplay.slotSelect.parentElement.parentElement.insertBefore(table, this.netplay.slotSelect.parentElement.nextSibling);
      }
    }

    // Hide Live Stream player slot if it exists
    if (this.netplay.playerSlotSelect && this.netplay.playerSlotSelect.parentElement) {
      this.netplay.playerSlotSelect.parentElement.style.display = "none";
    }

    // Modify bottom bar buttons for Delay Sync mode
    this.setupDelaySyncBottomBar();

    // Initialize player list (host is always player 1)
    this.netplayInitializeDelaySyncPlayers(maxPlayers);

    // Hide create button
    const buttons = this.netplayMenu.querySelectorAll("a.ejs_button");
    buttons.forEach(btn => {
      if (btn.innerText === "Create a Room") {
        btn.style.display = "none";
      }
    });

    this.isNetplay = true;
  }

  // Initialize delay sync player table
  netplayInitializeDelaySyncPlayers(maxPlayers) {
    if (!this.netplay.delaySyncPlayerTable) return;

    const tbody = this.netplay.delaySyncPlayerTable;
    tbody.innerHTML = "";

    // Initialize taken slots tracking
    if (!this.netplay.takenSlots) {
      this.netplay.takenSlots = new Set();
    }
    this.netplay.takenSlots.clear();

    // Initialize player list - only show host initially as P1
    this.netplay.joinedPlayers = [{
      slot: 0,
      name: this.netplay.name || "Host",
      ready: true
    }];

    // Host is always P1
    this.netplay.takenSlots.add(0);
    this.netplay.localSlot = 0;
    this.netplayPreferredSlot = 0;
    if (this.netplay.slotSelect) {
      this.netplay.slotSelect.value = "0";
    }

    // Create row for host only
    this.netplayAddPlayerToTable(0);

    // Initialize ready states array for maxPlayers
    this.netplay.playerReadyStates = new Array(maxPlayers).fill(false);
    this.netplay.playerReadyStates[0] = true; // Host starts ready

    // Update slot selector to remove taken slots
    this.netplayUpdateSlotSelector();
  }

  // Add a player to the delay sync table
  netplayAddPlayerToTable(slot) {
    if (!this.netplay.delaySyncPlayerTable) return;

    const player = this.netplay.joinedPlayers.find(p => p.slot === slot);
    if (!player) return;

    const tbody = this.netplay.delaySyncPlayerTable;
    const row = this.createElement("tr");

    // Player column
    const playerCell = this.createElement("td");
    playerCell.innerText = `P${slot + 1}`;
    playerCell.style.textAlign = "center";
    row.appendChild(playerCell);

    // Name column
    const nameCell = this.createElement("td");
    nameCell.innerText = player.name;
    nameCell.style.textAlign = "center";
    row.appendChild(nameCell);

    // Ready column
    const readyCell = this.createElement("td");
    readyCell.innerText = player.ready ? "✅" : "⛔";
    readyCell.style.textAlign = "right"; // Align to the right
    readyCell.classList.add("ready-status");
    row.appendChild(readyCell);

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

    // Update slot selector to remove taken slots
    this.netplayUpdateSlotSelector();
  }

  // Update player slot in table
  netplayUpdatePlayerSlot(slot) {
    // Update Delay Sync table if it exists
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

  // Update slot selector dropdown to remove taken slots
  netplayUpdateSlotSelector() {
    if (!this.netplay.slotSelect) return;

    const select = this.netplay.slotSelect;
    const currentValue = select.value;

    // Clear all options
    select.innerHTML = "";

    // Add available slots (not taken)
    for (let i = 0; i < 4; i++) {
      if (!this.netplay.takenSlots || !this.netplay.takenSlots.has(i)) {
        const opt = this.createElement("option");
        opt.value = String(i);
        opt.innerText = "P" + (i + 1);
        select.appendChild(opt);
      }
    }

    // Try to restore the current selection, or select the first available
    if (select.querySelector(`option[value="${currentValue}"]`)) {
      select.value = currentValue;
    } else if (select.options.length > 0) {
      select.value = select.options[0].value;
      const newSlot = parseInt(select.value, 10);
      this.netplay.localSlot = newSlot;
      this.netplayPreferredSlot = newSlot;
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
      this.netplayAddPlayerToTable(availableSlot);
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

  // Leave room
  netplayLeaveRoom() {
    console.log("[Netplay] Leaving room...");
    // Reset netplay state
    this.isNetplay = false;

    // Restore normal bottom bar buttons
    this.restoreNormalBottomBar();

    // Hide menu
    if (this.netplayMenu) {
      this.netplayMenu.style.display = "none";
    }

    // Reset to lobby view
    if (this.netplay.tabs && this.netplay.tabs[0] && this.netplay.tabs[1]) {
      this.netplay.tabs[0].style.display = "";
      this.netplay.tabs[1].style.display = "none";
    }

    // Reset title
    const titleElement = this.netplayMenu.querySelector("h4");
    if (titleElement) {
      titleElement.innerText = "Netplay Lobby";
    }

    // Show create room button again
    const buttons = this.netplayMenu.querySelectorAll("a.ejs_button");
    buttons.forEach(btn => {
      if (btn.innerText === "Create a Room" || btn.innerText === "Leave Room") {
        btn.style.display = "";
        if (btn.innerText === "Leave Room") {
          btn.innerText = "Close";
        }
      }
    });

    // TODO: Implement actual room leaving logic
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
        this.netplayJoinRoom(room.id, room.hasPassword);
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

    // Define showOpenRoomDialog function for creating rooms
    if (!this.netplay.showOpenRoomDialog) {
      this.netplay.showOpenRoomDialog = () => {
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
    }

    // Define leaveRoom function
    if (!this.netplay.leaveRoom) {
      this.netplay.leaveRoom = () => {
        console.log("[Netplay] Leaving room");
        // This would normally call the NetplayEngine's leaveRoom method
        // For now, we'll show a placeholder implementation
        alert("Leaving room not fully implemented yet.");
        // TODO: Integrate with actual NetplayEngine room leaving logic
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
        // TODO: Add more reset logic as needed
      };
    }
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
      "Netplay Lobby",
      {
        "Create a Room": () => {
          if (!this.netplay || typeof this.netplay.updateList !== "function")
            this.defineNetplayFunctions();
          if (this.isNetplay) {
            this.netplay.leaveRoom();
          } else {
            this.netplay.showOpenRoomDialog();
          }
        },
        Close: () => {
          if (this.netplayMenu) this.netplayMenu.style.display = "none";
          if (this.netplay && this.netplay.updateList) {
            this.netplay.updateList.stop();
          }
        },
      },
      true
    );
    this.netplayMenu = body.parentElement;
    const createButton = this.netplayMenu.getElementsByTagName("a")[0];
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
      createButton: createButton,
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
          this.netplayAddPlayerToTable(player.slot);
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
    if (this.netplayMenu) this.netplayMenu.style.display = "";
    // Hide player slot selector in lobby view
    if (this.netplay && this.netplay.slotSelect && this.netplay.slotSelect.parentElement) {
      this.netplay.slotSelect.parentElement.style.display = "none";
    }
    // Show player name popup only if no valid name was extracted from token
    if (!playerName || playerName === "Player") {
      this.netplay = {
        table: tbody,
        passwordElem: password,
        roomNameElem: title2,
        createButton: createButton,
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
    this.netplay.updateList.start();
  }

  // Attach consumer media track to UI elements
  netplayAttachConsumerTrack(track, kind) {
    console.log(`[NetplayMenu] Attaching ${kind} consumer track:`, track);
    // TODO: Implement actual track attachment to video/audio elements
    // For now, this is a stub to prevent errors
  }

  // Update player list in UI
  netplayUpdatePlayerList(data) {
    console.log("[NetplayMenu] Updating player list:", data);
    // TODO: Implement actual player list updating in UI
    // For now, this is a stub to prevent errors
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
    // TODO: Implement actual input forwarding setup
    // For now, this is a stub to prevent errors
  }

  // ... continue with all other netplay* functions
  // All other netplay functions moved here...
}

window.NetplayMenu = NetplayMenu;
