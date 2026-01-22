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
      "createElement",
      "createPopup",
      "localization",
      "createSubPopup",
      "addEventListener",
      "saveSettings",
      // add other commonly used methods
    ].forEach((fn) => {
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

  // Mobile detection utility
  isMobileDevice() {
    return (
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent,
      ) ||
      (window.innerWidth <= 768 && window.innerHeight <= 1024)
    );
  }

  // ============================================================================
  // CENTRALIZED SLOT MANAGEMENT SYSTEM
  // ============================================================================

  /**
   * Get the authoritative player table (single source of truth)
   * @returns {Object} playerTable[playerId] = { playerId, slot, role, connected, ... }
   */
  getPlayerTable() {
    const joinedPlayers = this.netplay?.joinedPlayers || [];
    // Convert array to object keyed by playerId for backward compatibility
    const playerTable = {};
    for (const player of joinedPlayers) {
      if (player.id) {
        playerTable[player.id] = { ...player, playerId: player.id };
      }
    }

    // Ensure local player is always in the table (but avoid duplicates)
    const myPlayerId = this.getMyPlayerId();
    if (myPlayerId && !playerTable[myPlayerId]) {
      // Check if local player is already in joinedPlayers with a different ID
      const myPlayerName = this.netplay?.name;
      const existingLocalPlayer = joinedPlayers.find(
        (p) =>
          p.id === myPlayerId ||
          (myPlayerName && p.name === myPlayerName) ||
          p.id === this.netplay?.engine?.sessionState?.localPlayerId,
      );

      if (!existingLocalPlayer) {
        // Local player not found in joinedPlayers, add them
        const sessionSlot =
          this.netplay?.engine?.sessionState?.getLocalPlayerSlot();
        const localSlot =
          sessionSlot !== null && sessionSlot !== undefined
            ? sessionSlot
            : (this.netplay?.localSlot ?? 0);
        playerTable[myPlayerId] = {
          playerId: myPlayerId,
          id: myPlayerId,
          name: this.netplay?.name || myPlayerId,
          slot: localSlot,
          role: localSlot === 8 ? "spectator" : "player",
          connected: true,
          ready: false,
        };
        console.log(
          "[NetplayMenu] Added local player to player table:",
          myPlayerId,
          "slot:",
          localSlot,
          "(from session state:",
          sessionSlot !== null && sessionSlot !== undefined ? "yes" : "no",
          "fallback:",
          this.netplay?.localSlot ?? 0,
          ")",
        );
      } else {
        // Local player exists with different ID, use existing entry
        playerTable[existingLocalPlayer.id] = {
          ...existingLocalPlayer,
          playerId: existingLocalPlayer.id,
        };
        console.log(
          "[NetplayMenu] Local player already in joinedPlayers with different ID:",
          existingLocalPlayer.id,
          "using existing entry instead of adding duplicate",
        );
      }
    }

    return playerTable;
  }

  /**
   * Get current player's ID
   * @returns {string|null}
   */
  getMyPlayerId() {
    return (
      this.netplay?.engine?.sessionState?.localPlayerId ||
      this.netplay?.name ||
      null
    );
  }

  /**
   * Convert slot number to display text
   * @param {number} slot - Slot number (0-8)
   * @returns {string} Display text (P1-P8 or Spectator)
   */
  getSlotDisplayText(slot) {
    if (slot === 8) {
      return "Spectator";
    }
    return `P${slot + 1}`;
  }

  /**
   * Get status emoji for player in live stream mode
   * @param {Object} player - Player object
   * @returns {string} Status emoji (🖥️ Host, 🎮 Client, 👀 Spectator)
   */
  getPlayerStatusEmoji(player) {
    if (!player) return "🎮";

    if (this.isPlayerHost(player)) {
      return "🖥️";
    } else if (player.slot === 8) {
      return "👀"; // Spectator
    }
  }

  /**
   * Check if a player is the host (centralized host determination)
   * @param {Object} player - Player object with id property
   * @returns {boolean} True if this player is the host
   */
  isPlayerHost(player) {
    if (!player || !player.id) return false;

    const myPlayerId = this.getMyPlayerId();
    const myPlayerName = this.netplay?.name;
    const isHost = this.netplay?.engine?.sessionState?.isHostRole() || false;

    // Check if this player represents the current user (by ID or name)
    const isCurrentUser =
      player.id === myPlayerId ||
      (myPlayerName && player.name === myPlayerName) ||
      player.id === this.netplay?.engine?.sessionState?.localPlayerId;

    return isCurrentUser && isHost;
  }

  /**
   * CENTRAL SLOT UPDATE FUNCTION - Only way slots should change
   * @param {string} playerId - Player to update
   * @param {number} newSlot - New slot (0-7) or 8 for spectator
   * @returns {boolean} true if update succeeded
   */
  updatePlayerSlot(playerId, newSlot) {
    const playerTable = this.getPlayerTable();
    const player = playerTable[playerId];

    if (!player) {
      console.warn(
        "[NetplayMenu] Cannot update slot for unknown player:",
        playerId,
      );
      return false;
    }

    // Prevent slot collision (each slot can be occupied by at most one player)
    if (newSlot !== null) {
      for (const [pid, p] of Object.entries(playerTable)) {
        if (pid !== playerId && p.slot === newSlot) {
          console.warn(
            "[NetplayMenu] Slot",
            newSlot,
            "already occupied by player",
            pid,
          );
          return false; // slot already taken
        }
      }
    }

    const oldSlot = player.slot;
    player.slot = newSlot;

    // Update role based on slot
    if (newSlot === 8) {
      player.role = "spectator";
    } else if (newSlot >= 0 && newSlot <= 7) {
      player.role = "player";
    }

    // Also update the joinedPlayers array if the player exists there
    if (this.netplay?.joinedPlayers) {
      const joinedPlayer = this.netplay.joinedPlayers.find(
        (p) => p.id === playerId,
      );
      if (joinedPlayer) {
        joinedPlayer.slot = newSlot;
        if (newSlot === 8) {
          joinedPlayer.role = "spectator";
        } else if (newSlot >= 0 && newSlot <= 7) {
          joinedPlayer.role = "player";
        }
        console.log(
          "[NetplayMenu] Updated slot in joinedPlayers array:",
          playerId,
          oldSlot,
          "->",
          newSlot,
        );
      } else {
        // Player not in joinedPlayers, add them
        this.netplay.joinedPlayers.push({
          id: playerId,
          name: player.name || playerId,
          slot: newSlot,
          role: newSlot === 8 ? "spectator" : "player",
          connected: true,
          ready: false,
        });
        console.log(
          "[NetplayMenu] Added player to joinedPlayers array:",
          playerId,
          "slot:",
          newSlot,
        );
      }
    }

    console.log(
      "[NetplayMenu] Updated player slot:",
      playerId,
      oldSlot,
      "->",
      newSlot,
      "(role:",
      player.role,
      ")",
    );

    // Notify all systems of the change
    this.notifyPlayerTableUpdated();

    return true;
  }

  /**
   * Compute available slots (derived from playerTable, never stored)
   * @param {string} myPlayerId - Current player's ID (to exclude their slot)
   * @param {Array<number>} allSlots - All possible slots [0,1,2,3]
   * @returns {Array<number>} Available slots
   */
  computeAvailableSlots(myPlayerId, allSlots = [0, 1, 2, 3]) {
    const playerTable = this.getPlayerTable();

    // Slots taken by other players (exclude our own slot)
    const taken = new Set(
      Object.values(playerTable)
        .filter(
          (p) =>
            p.playerId !== myPlayerId &&
            p.slot !== null &&
            p.slot !== undefined &&
            p.slot !== 8, // Spectators don't take player slots
        )
        .map((p) => p.slot),
    );

    return allSlots.filter((slot) => !taken.has(slot));
  }

  /**
   * Get slot selector options (derived from playerTable)
   * @param {string} myPlayerId - Current player's ID
   * @param {Array<number>} allSlots - All possible slots [0,1,2,3]
   * @returns {Array<{value: number, text: string, disabled: boolean, selected: boolean}>}
   */
  getSlotSelectorOptions(myPlayerId, allSlots = [0, 1, 2, 3]) {
    // Find local player directly from joinedPlayers
    const localPlayerId = this.netplay?.engine?.sessionState?.localPlayerId;
    const localPlayerName = this.netplay?.name;

    let me = null;
    if (localPlayerId) {
      me = this.netplay?.joinedPlayers?.find((p) => p.id === localPlayerId);
    }
    if (!me && localPlayerName) {
      me = this.netplay?.joinedPlayers?.find((p) => p.name === localPlayerName);
    }

    if (!me) {
      console.warn(
        "[NetplayMenu] Cannot get slot selector options: local player not found in joinedPlayers",
        {
          myPlayerId,
          localPlayerId,
          localPlayerName,
          joinedPlayersCount: this.netplay?.joinedPlayers?.length,
        },
      );
      return [];
    }

    const available = this.computeAvailableSlots(myPlayerId, allSlots);
    const options = [];

    // Get current player's slot from player table (synchronized with UI updates)
    let currentPlayerSlot = me.slot;

    // Debug: Log player table slot info
    console.log("[NetplayMenu] Slot selector player table debug:");
    console.log("  myPlayerId:", myPlayerId);
    console.log("  currentPlayerSlot from table:", currentPlayerSlot);
    console.log("  player table entry:", me);

    // Ensure we have a valid player slot (player table should always provide this)
    if (currentPlayerSlot === null || currentPlayerSlot === undefined) {
      console.warn(
        "[NetplayMenu] Player table returned invalid slot, defaulting to 0",
      );
      currentPlayerSlot = 0;
    }

    // Always include current slot first (now guaranteed to be a valid player slot)
    options.push({
      value: currentPlayerSlot,
      text: this.getSlotDisplayText(currentPlayerSlot),
      disabled: false,
      selected: true,
    });

    // Add available slots
    for (const slot of available) {
      if (slot !== currentPlayerSlot) {
        // Don't duplicate current slot
        options.push({
          value: slot,
          text: this.getSlotDisplayText(slot),
          disabled: false,
          selected: false,
        });
      }
    }

    // Add spectator option (never auto-selected - user must choose it explicitly)
    options.push({
      value: 8, // Special value for spectator
      text: "Spectator",
      disabled: false,
      selected: currentPlayerSlot === 8,
    });

    return options;
  }

  /**
   * Request a slot change (UI intent -> authoritative update)
   * @param {number} newSlot - Requested slot (0-3) or 4 for spectator
   */
  requestSlotChange(newSlot) {
    console.log(
      "[NetplayMenu] requestSlotChange called with newSlot:",
      newSlot,
    );

    // Find local player using session state (more reliable than player table)
    const localPlayerId = this.netplay?.engine?.sessionState?.localPlayerId;
    const localPlayerName = this.netplay?.name;

    let me = null;
    if (localPlayerId) {
      // Try to find by session state ID first
      me = this.netplay?.joinedPlayers?.find((p) => p.id === localPlayerId);
    }
    if (!me && localPlayerName) {
      // Fallback to finding by name
      me = this.netplay?.joinedPlayers?.find((p) => p.name === localPlayerName);
    }

    if (!me) {
      console.warn(
        "[NetplayMenu] Cannot request slot change: local player not found in joinedPlayers",
        {
          localPlayerId,
          localPlayerName,
          joinedPlayersCount: this.netplay?.joinedPlayers?.length,
        },
      );
      return;
    }

    // Convert spectator (4) to slot 8
    const actualSlot = newSlot === 4 ? 8 : newSlot;

    if (me.slot === actualSlot) {
      console.log(
        "[NetplayMenu] Slot change requested but already in slot:",
        actualSlot,
      );
      return;
    }

    console.log(
      "[NetplayMenu] Requesting slot change:",
      me.id,
      me.slot,
      "->",
      actualSlot,
    );

    // Update local state optimistically before server request
    this.updatePlayerSlot(me.id, actualSlot);

    this.notifyServerOfSlotChange(actualSlot);
  }

  /**
   * Notify server of slot change
   * @param {number|null} slot
   */
  async notifyServerOfSlotChange(slot) {
    console.log(
      "[NetplayMenu] notifyServerOfSlotChange called with slot:",
      slot,
    );
    console.log(
      "[NetplayMenu] roomManager exists:",
      !!this.netplay?.engine?.roomManager,
    );
    console.log(
      "[NetplayMenu] slot condition check:",
      slot === 8 || (slot >= 0 && slot < 4),
    );

    if (
      this.netplay?.engine?.roomManager &&
      (slot === 8 || (slot >= 0 && slot < 4))
    ) {
      try {
        console.log(
          "[NetplayMenu] Calling roomManager.updatePlayerSlot with slot:",
          slot,
        );
        await this.netplay.engine.roomManager.updatePlayerSlot(slot);

        // Update global slot variable for SimpleController
        window.EJS_NETPLAY_PREFERRED_SLOT = slot;
        this.netplay.localSlot = slot;

        console.log(
          "[NetplayMenu] Successfully notified server of slot change:",
          slot,
        );
        console.log(
          "[NetplayMenu] Updated window.EJS_NETPLAY_PREFERRED_SLOT to:",
          slot,
        );
      } catch (error) {
        console.error(
          "[NetplayMenu] Failed to notify server of slot change:",
          error,
        );
        console.error("[NetplayMenu] Error details:", error.message);
      }
    } else {
      console.log(
        "[NetplayMenu] Skipping server notification - not in room or invalid slot",
      );
    }
  }

  /**
   * NOTIFICATION SYSTEM - Called whenever playerTable changes for any reason
   */
  notifyPlayerTableUpdated() {
    console.log(
      "[NetplayMenu] Player table updated, refreshing all dependent UI",
    );

    // Update slot selector UI
    this.updateSlotSelectorUI();

    // Update input sync with new slot
    this.updateInputSyncWithCurrentSlot();

    // Update player table display
    if (this.netplay.liveStreamPlayerTable) {
      this.netplayUpdatePlayerTable(this.netplay.joinedPlayers); // Uses real data
    }

    // Update taken slots tracking (for backward compatibility)
    this.updateTakenSlotsFromPlayerTable();
  }

  /**
   * NOTIFICATION SYSTEM - Called for targeted updates (avoids full table rebuild)
   */
  notifyPlayerTableUpdatedTargeted() {
    console.log(
      "[NetplayMenu] Player table updated (targeted), refreshing dependent UI only",
    );

    // Update slot selector UI
    this.updateSlotSelectorUI();

    // Update input sync with new slot
    this.updateInputSyncWithCurrentSlot();

    // Update taken slots tracking (for backward compatibility)
    this.updateTakenSlotsFromPlayerTable();

    // SKIP: Full table rebuild - we only updated specific cells
  }

  /**
   * Update slot selector UI from playerTable
   */
  updateSlotSelectorUI() {
    if (!this.netplay?.slotSelect) return;

    const myPlayerId = this.getMyPlayerId();
    if (!myPlayerId) return;

    const options = this.getSlotSelectorOptions(myPlayerId);

    // Check if spectator option already exists
    const existingSpectator = this.netplay.slotSelect.querySelector('option[value="8"]');

    // Clear existing options
    this.netplay.slotSelect.innerHTML = "";

    // Add new options
    for (const option of options) {
      if (option.value === 8 && existingSpectator) {
        this.netplay.slotSelect.appendChild(existingSpectator);
        continue;
      }
      const opt = this.createElement("option");
      opt.value = String(option.value);
      opt.innerText = option.text;
      if (option.disabled) opt.disabled = true;
      if (option.selected) opt.selected = true;
      this.netplay.slotSelect.appendChild(opt);
    }

    console.log(
      "[NetplayMenu] Updated slot selector UI with",
      options.length,
      "options",
    );
  }

  /**
   * Update input sync to use current slot from playerTable
   */
  updateInputSyncWithCurrentSlot() {
    // Find local player directly from joinedPlayers
    const localPlayerId = this.netplay?.engine?.sessionState?.localPlayerId;
    const localPlayerName = this.netplay?.name;

    let me = null;
    if (localPlayerId) {
      me = this.netplay?.joinedPlayers?.find((p) => p.id === localPlayerId);
    }
    if (!me && localPlayerName) {
      me = this.netplay?.joinedPlayers?.find((p) => p.name === localPlayerName);
    }

    const mySlot = me?.slot;

    // Update InputSync slot manager
    if (
      this.netplay?.engine?.inputSync?.slotManager &&
      mySlot !== null &&
      mySlot !== undefined
    ) {
      const playerId = me.id;
      const assignedSlot = this.netplay.engine.inputSync.slotManager.assignSlot(
        playerId,
        mySlot,
      );
      console.log(
        "[NetplayMenu] Updated InputSync slot manager:",
        playerId,
        "-> slot",
        assignedSlot,
      );
    }

    // Update global slot preference
    if (typeof window !== "undefined") {
      window.EJS_NETPLAY_PREFERRED_SLOT = mySlot;
    }

    // Clear SimpleController cache for slot changes
    if (this.netplay?.engine?.inputSync?.controller?.lastInputValues) {
      this.netplay.engine.inputSync.controller.lastInputValues = {};
    }
  }

  /**
   * Update taken slots tracking (for backward compatibility with existing code)
   */
  updateTakenSlotsFromPlayerTable() {
    if (!this.netplay.takenSlots) {
      this.netplay.takenSlots = new Set();
    }
    this.netplay.takenSlots.clear();

    const playerTable = this.getPlayerTable();
    for (const player of Object.values(playerTable)) {
      if (
        player.slot !== null &&
        player.slot !== undefined &&
        player.slot !== 8 && // Spectators don't take player slots
        player.slot < 4
      ) {
        this.netplay.takenSlots.add(player.slot);
      }
    }
  }
  show() {
    if (this.netplayMenu) {
      this.netplayMenu.style.display = "block";
      this.setupNetplayBottomBar("listings");

      // Switch to rooms tab when showing listings
      if (this.netplay.tabs && this.netplay.tabs[0] && this.netplay.tabs[1]) {
        this.netplay.tabs[0].style.display = ""; // Show rooms tab
        this.netplay.tabs[1].style.display = "none"; // Hide joined tab
      }
    }
  }

  hide() {
    if (this.netplayMenu) {
      this.netplayMenu.style.display = "none";
      this.restoreNormalBottomBar();
    }
  }

  // Returns true if the menu is visible, false otherwise, optional isHidden does opposite.
  isVisible() {
    return this.netplayMenu && this.netplayMenu.style.display !== "none";
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
            this.netplayHostPausedElem,
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
            this.netplayHostPausedElem,
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

    // Add debug ping test button for lobby
    this.addPingTestButton();
  }

  /**
   * Add a debug button to test ping functionality in lobby
   */
  addPingTestButton() {
    // Remove existing ping test button if it exists
    const existingButton = document.getElementById("ejs-netplay-ping-test");
    if (existingButton) {
      existingButton.remove();
    }

    // Create ping test button
    const pingButton = document.createElement("button");
    pingButton.id = "ejs-netplay-ping-test";
    pingButton.innerHTML = "🔄 Test Ping";
    pingButton.style.cssText = `
      position: fixed;
      top: 60px;
      right: 10px;
      z-index: 10000;
      background: #007bff;
      color: white;
      border: none;
      padding: 8px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    `;

    pingButton.onclick = () => {
      try {
        if (window.EJS_emulator && window.EJS_emulator.netplayEngine) {
          const engine = window.EJS_emulator.netplayEngine;

          if (pingButton.innerHTML.includes("Test Ping")) {
            // Start ping test
            console.log("[NetplayMenu] Starting ping test...");
            engine.startPingTest();
            pingButton.innerHTML = "⏹️ Stop Ping";
            pingButton.style.background = "#dc3545";
          } else {
            // Stop ping test
            console.log("[NetplayMenu] Stopping ping test...");
            engine.stopPingTest();
            pingButton.innerHTML = "🔄 Test Ping";
            pingButton.style.background = "#007bff";
          }
        } else {
          console.error(
            "[NetplayMenu] Netplay engine not available for ping test",
          );
          alert("Netplay engine not available");
        }
      } catch (error) {
        console.error("[NetplayMenu] Error with ping test:", error);
        alert("Error with ping test: " + error.message);
      }
    };

    // Create ordered mode test button
    const orderedButton = document.createElement("button");
    orderedButton.id = "ejs-netplay-ordered-test";
    orderedButton.innerHTML = "📋 Ordered Mode";
    orderedButton.style.cssText = `
      position: fixed;
      top: 90px;
      right: 10px;
      z-index: 10000;
      background: #28a745;
      color: white;
      border: none;
      padding: 8px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    `;

    orderedButton.onclick = () => {
      try {
        if (window.EJS_emulator && window.EJS_emulator.netplayEngine) {
          const engine = window.EJS_emulator.netplayEngine;

          if (orderedButton.innerHTML.includes("Ordered Mode")) {
            // Force ordered mode
            console.log("[NetplayMenu] Forcing ordered mode for testing...");
            const originalMode = engine.forceOrderedMode(true);
            orderedButton.innerHTML = "🔄 Unordered Mode";
            orderedButton.style.background = "#ffc107";
            orderedButton.style.color = "black";
            orderedButton._originalMode = originalMode;
          } else {
            // Restore original mode
            console.log("[NetplayMenu] Restoring unordered mode...");
            if (orderedButton._originalMode) {
              engine.forceOrderedMode(false);
            }
            orderedButton.innerHTML = "📋 Ordered Mode";
            orderedButton.style.background = "#28a745";
            orderedButton.style.color = "white";
          }
        } else {
          console.error(
            "[NetplayMenu] Netplay engine not available for ordered mode test",
          );
          alert("Netplay engine not available");
        }
      } catch (error) {
        console.error("[NetplayMenu] Error with ordered mode test:", error);
        alert("Error with ordered mode test: " + error.message);
      }
    };

    // Add hover effect
    orderedButton.onmouseover = () => {
      orderedButton.style.opacity = "0.8";
    };
    orderedButton.onmouseout = () => {
      orderedButton.style.opacity = "1";
    };

    document.body.appendChild(orderedButton);

    // Add hover effect
    pingButton.onmouseover = () => {
      pingButton.style.opacity = "0.8";
    };
    pingButton.onmouseout = () => {
      pingButton.style.opacity = "1";
    };

    document.body.appendChild(pingButton);
    console.log("[NetplayMenu] Added ping test button to lobby");
  }

  // Switch to live stream room UI
  netplaySwitchToLiveStreamRoom(roomName, password) {
    if (!this.netplayMenu) return;

    // Check if host and player slot at the beginning
    const isHost = this.netplay?.engine?.sessionState?.isHostRole() || false;
    // Create the slot selector
    const joinedDiv = this.netplay.tabs[1];
    const slotSelect = this.createSlotSelector(joinedDiv, "prepend");
    this.netplay.slotSelect = slotSelect;

    // For livestream clients, hide the canvas immediately so video can be displayed
    if (!isHost) {
      if (
        this.emulator &&
        this.emulator.canvas &&
        this.emulator.canvas.style.display !== "none"
      ) {
        console.log("[NetplayMenu] Hiding canvas for livestream client");
        this.emulator.canvas.style.display = "none";
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
      this.netplay.passwordElem.innerText = password
        ? `Password: ${password}`
        : "";
      this.netplay.passwordElem.style.display = password ? "" : "none";
    }

    // Create the Live Stream UI if it doesn't exist.
    if (!this.netplay.liveStreamPlayerTable) {
      // Reorder elements: move room name above slot selector
      if (
        this.netplay.roomNameElem &&
        this.netplay.slotSelect &&
        this.netplay.slotSelect.parentElement
      ) {
        const joinedContainer =
          this.netplay.slotSelect.parentElement.parentElement;
        const slotControls = this.netplay.slotSelect.parentElement;
        // Move room name to be right above the slot selector
        joinedContainer.insertBefore(this.netplay.roomNameElem, slotControls);
      }

      // Create the player table
      const table = this.createNetplayTable("livestream");

      // Insert table after the slot selector
      if (this.netplay.slotSelect && this.netplay.slotSelect.parentElement) {
        this.netplay.slotSelect.parentElement.parentElement.insertBefore(
          table,
          this.netplay.slotSelect.parentElement.nextSibling,
        );
      }
    }

    // This populates and updates the table.
    this.netplayUpdatePlayerTable(this.netplay.joinedPlayers); // Uses real data
    // Setup the bottom bar buttons.
    this.setupNetplayBottomBar("livestream");

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
      this.netplay.passwordElem.innerText = password
        ? `Password: ${password}`
        : "";
      this.netplay.passwordElem.style.display = password ? "" : "none";
    }

    // Create the Delay Sync UI if it doesn't exist.
    if (!this.netplay.delaySyncPlayerTable) {
      // Set up the player slot selector first
      const joinedDiv = this.netplay.tabs[1];
      const joinedControls = joinedDiv.querySelector(".ejs_netplay_header");
      const slotSelect = this.createSlotSelector(joinedControls);
      this.netplay.slotSelect = slotSelect;

      // Create the player table
      const table = this.createNetplayTable("delaysync");

      // Insert table after the slot selector
      if (this.netplay.slotSelect && this.netplay.slotSelect.parentElement) {
        this.netplay.slotSelect.parentElement.parentElement.insertBefore(
          table,
          this.netplay.slotSelect.parentElement.nextSibling,
        );
      }

      // Hide Live Stream player slot if it exists
      if (
        this.netplay.playerSlotSelect &&
        this.netplay.playerSlotSelect.parentElement
      ) {
        this.netplay.playerSlotSelect.parentElement.style.display = "none";
      }
    }

    // Initialize player list (host is always player 1)
    this.netplayUpdatePlayerTable(this.netplay.joinedPlayers);

    // Bottom bar buttons for Delay Sync mode
    this.setupNetplayBottomBar("delaysync");

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
          { text: "", width: "80px" },
        ],
        reference: "table",
      },
      livestream: {
        headers: [
          { text: "Player", width: "60px", align: "center" },
          { text: "Name", align: "center" },
          { text: "Status", width: "60px", align: "center" },
        ],
        reference: "liveStreamPlayerTable",
      },
      delaysync: {
        headers: [
          { text: "Player", width: "60px", align: "center" },
          { text: "Name", align: "center" },
          { text: "Ready", width: "60px", align: "right" },
        ],
        reference: "delaySyncPlayerTable",
      },
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

    config.headers.forEach((header) => {
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

      // Add the same background and styling, with mobile adjustments
      const isMobile = this.isMobileDevice();
      this.netplayBottomBar.style.background = "rgba(0,0,0,0.8)";
      this.netplayBottomBar.style.position = "absolute";
      this.netplayBottomBar.style.display = "flex";
      this.netplayBottomBar.style.justifyContent = "center";
      this.netplayBottomBar.style.alignItems = "center";
      this.netplayBottomBar.style.gap = isMobile ? "6px" : "10px";
      this.netplayBottomBar.style.bottom = "0";
      this.netplayBottomBar.style.left = "0";
      this.netplayBottomBar.style.right = "0";
      this.netplayBottomBar.style.zIndex = "10000";
      this.netplayBottomBar.style.padding = isMobile ? "6px 8px" : "10px 15px";
      this.netplayBottomBar.style.minHeight = isMobile ? "40px" : "50px";
    }

    // Always show the netplay bottom bar
    this.netplayBottomBar.classList.remove("ejs_menu_bar_hidden");
    this.netplayBottomBar.style.display = "";

    // Handle room-type-specific setup
    if (roomType === "listings") {
      // Start room list fetching for listings mode
      if (this.netplay && this.netplay.updateList) {
        this.netplay.updateList.start();
      }
    } else {
      // For room modes, clear any popup buttons (but keep popup visible for room interface)
      if (this.netplayMenu) {
        const popupContainer =
          this.netplayMenu.querySelector(".ejs_popup_body");
        if (popupContainer) {
          const buttons =
            popupContainer.parentElement.querySelectorAll(".ejs_button");
          buttons.forEach((button) => button.remove());
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
        appliesTo: (roomType) => roomType === "listings",
      },

      // Room-specific buttons
      syncReady: {
        text: "Ready",
        action: () => this.netplayToggleReady(),
        appliesTo: (roomType) => roomType.endsWith("sync"),
        property: "readyButton",
      },
      syncLaunch: {
        text: "Launch Game",
        action: () => this.netplayLaunchGame(),
        appliesTo: (roomType) => roomType.endsWith("sync"),
        property: "launchButton",
        disabled: true,
      },
      leaveRoom: {
        text: "Leave Room",
        action: async () => {
          try {
            await this.emulator.netplay.engine.netplayLeaveRoom(); // ← Now awaited
          } catch (error) {
            console.error("[NetplayMenu] Error leaving room:", error);
          }
        },
        appliesTo: (roomType) => roomType !== "listings",
      },

      // Universal buttons
      settings: {
        text: "Settings",
        action: () => this.netplaySettingsMenu(),
        appliesTo: () => true,
        style: { backgroundColor: "#666" }, // Grey for passive button
      },
      closeMenu: {
        text: "Close Menu",
        action: () => this.hide(),
        appliesTo: () => true,
        style: { backgroundColor: "#666" }, // Grey for passive button
      },
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
    const isMobile = this.isMobileDevice();

    if (!bar[key]) {
      const btn = this.createElement("a");
      btn.classList.add("ejs_button");
      btn.innerText = config.text;
      btn.style.whiteSpace = "nowrap";

      // Apply mobile-specific button styling
      if (isMobile) {
        btn.style.fontSize = "0.85em";
        btn.style.padding = "6px 10px";
        btn.style.minWidth = "auto";
        btn.style.maxWidth = "120px";
      } else {
        btn.style.fontSize = "0.9em";
        btn.style.padding = "8px 15px";
      }

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
    const isMobile = this.isMobileDevice();

    // Add border styling - tighter for mobile
    content.style.border = "2px solid rgba(var(--ejs-primary-color), 0.3)";
    content.style.borderRadius = isMobile ? "6px" : "8px";
    content.style.padding = isMobile ? "6px" : "8px";
    content.style.maxWidth = isMobile ? "95%" : "100%";
    content.style.maxHeight = isMobile ? "80vh" : "auto";
    content.style.boxSizing = "border-box";
    content.style.overflowY = isMobile ? "auto" : "visible";
    content.classList.add("ejs_cheat_parent");

    // Title - more compact, especially for mobile
    const header = this.createElement("div");
    const title = this.createElement("h2");
    title.innerText = "Netplay Settings";
    title.classList.add("ejs_netplay_name_heading");
    title.style.margin = isMobile ? "0 0 6px 0" : "0 0 8px 0";
    title.style.fontSize = isMobile ? "1.1em" : "1.2em";
    header.appendChild(title);
    content.appendChild(header);

    // Settings container with table - mobile optimized
    const settingsContainer = this.createElement("div");
    settingsContainer.style.maxHeight = isMobile
      ? "calc(100vh - 150px)"
      : "calc(100vh - 200px)";
    settingsContainer.style.overflowY = "auto";
    settingsContainer.style.overflowX = "auto";
    settingsContainer.style.width = "100%";

    // Create table for settings - two columns layout, mobile optimized
    const settingsTable = this.createElement("table");
    settingsTable.style.width = "100%";
    settingsTable.style.borderCollapse = "collapse";
    settingsTable.style.fontSize = isMobile ? "0.85em" : "0.9em";
    settingsTable.style.marginBottom = isMobile ? "6px" : "8px";

    // Helper function to create a table cell for label
    const createLabelCell = (label) => {
      const cell = this.createElement("td");
      cell.innerText = label;
      cell.style.padding = "6px 8px";
      cell.style.fontWeight = "bold";
      cell.style.color = "#fff";
      cell.style.verticalAlign = "middle";
      cell.style.whiteSpace = "nowrap";
      cell.style.width = "25%";
      return cell;
    };

    // Helper function to create a table cell for control
    const createControlCell = (control) => {
      const cell = this.createElement("td");
      cell.style.padding = "4px 8px";
      cell.style.verticalAlign = "middle";
      cell.style.width = "25%";
      cell.appendChild(control);
      return cell;
    };

    // Helper function to create table row with two settings side by side
    const createTwoColumnRow = (label1, control1, label2, control2) => {
      const row = this.createElement("tr");
      row.style.borderBottom = "1px solid rgba(255,255,255,0.1)";

      row.appendChild(createLabelCell(label1));
      row.appendChild(createControlCell(control1));

      if (label2 && control2) {
        row.appendChild(createLabelCell(label2));
        row.appendChild(createControlCell(control2));
      } else {
        // If only one setting, span across two columns
        const emptyCell = this.createElement("td");
        emptyCell.colSpan = 2;
        row.appendChild(emptyCell);
      }

      return row;
    };

    // Helper function to create select dropdown - more compact for two-column layout
    const createSelect = (options, currentValue, onChange) => {
      const select = this.createElement("select");
      slotSelect.style.backgroundColor = "#333";
      slotSelect.style.color = "#fff";
      slotSelect.style.border = "1px solid #555";
      slotSelect.style.borderRadius = "4px";
      slotSelect.style.padding = "3px 6px";
      slotSelect.style.width = "100%";
      slotSelect.style.maxWidth = "100%";
      slotSelect.style.fontSize = "0.9em";
      slotSelect.style.boxSizing = "border-box";

      Object.entries(options).forEach(([value, label]) => {
        const option = this.createElement("option");
        option.value = value;
        option.innerText = label;
        if (value === currentValue) option.selected = true;
        slotSelect.appendChild(option);
      });

      if (onChange) {
        this.addEventListener(slotSelect, "change", () =>
          onChange(slotSelect.value),
        );
      }

      return slotSelect;
    };

    // Helper function to get current setting value
    const getSetting = (key, defaultValue) => {
      return (
        this.emulator.getSettingValue(key) || this.emulator[key] || defaultValue
      );
    };

    // Helper function to save setting
    const saveSetting = (key, value) => {
      this.emulator[key] = value;
      this.emulator.saveSettings();
    };

    // SVC with VP9 setting
    const normalizeVSVCMode = (v) => {
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
      (value) => saveSetting("netplayVP9SVC", value),
    );

    // Legacy Simulcast setting
    const simulcastSelect = createSelect(
      {
        enabled: "Enabled",
        disabled: "Disabled",
      },
      getSetting("netplaySimulcast", "disabled"),
      (value) => saveSetting("netplaySimulcast", value),
    );

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
      (value) => saveSetting("netplayHostCodec", value),
    );

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
      normalizeSimulcastQuality(
        getSetting("netplayClientSimulcastQuality", "high"),
      ),
      (value) => saveSetting("netplayClientSimulcastQuality", value),
    );

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
      (value) => saveSetting("netplayRetryConnectionTimer", parseInt(value)),
    );

    // Unordered Retries setting
    const unorderedRetriesSelect = createSelect(
      {
        0: "0",
        1: "1",
        2: "2",
      },
      String(getSetting("netplayUnorderedRetries", 0)),
      (value) => saveSetting("netplayUnorderedRetries", parseInt(value)),
    );

    // Input Mode setting - shows current active mode
    const currentMode =
      this.engine?.dataChannelManager?.mode ||
      getSetting("netplayInputMode", "unorderedRelay");

    const inputModeSelect = createSelect(
      {
        unorderedRelay: "Unordered Relay",
        orderedRelay: "Ordered Relay",
        unorderedP2P: "Unordered P2P",
        orderedP2P: "Ordered P2P",
      },
      currentMode, // Use current active mode, not just saved setting
      (value) => {
        saveSetting("netplayInputMode", value);
        // Trigger immediate mode switch for dynamic transport changes
        if (this.engine?.dataChannelManager) {
          console.log(
            `[NetplayMenu] 🔄 User changed input mode to ${value}, applying immediately`,
          );

          // Show visual feedback during switching
          const selectedOption =
            inputModeSelect.options[inputModeSelect.selectedIndex];
          const originalText = selectedOption.text;
          selectedOption.text = `${originalText} (Switching...)`;
          inputModeSelect.disabled = true;

          this.netplayApplyInputMode("setting-change").finally(() => {
            // Re-enable dropdown and update to show actual current mode
            setTimeout(() => {
              inputModeSelect.disabled = false;
              selectedOption.text = originalText; // Restore original text

              // Update dropdown to reflect the actual active mode
              const activeMode = this.engine?.dataChannelManager?.mode;
              if (activeMode && activeMode !== inputModeSelect.value) {
                inputModeSelect.value = activeMode;
                console.log(
                  `[NetplayMenu] Updated dropdown to show active mode: ${activeMode}`,
                );
              }
            }, 1500); // Allow time for mode switch to complete
          });
        }
      },
    );

    // P2P Connectivity Test button - more compact for two-column layout
    const testButton = this.createElement("button");
    testButton.innerText = "Test P2P";
    testButton.className = "ejs_button";
    testButton.style.padding = "4px 8px";
    testButton.style.fontSize = "0.85em";
    testButton.style.width = "100%";
    testButton.style.maxWidth = "100%";
    testButton.onclick = () => {
      if (this.engine?.testP2PConnectivity) {
        console.log("[NetplayMenu] 🔬 Starting P2P connectivity test...");
        this.engine.testP2PConnectivity().catch((err) => {
          console.error("[NetplayMenu] P2P connectivity test failed:", err);
        });
      } else {
        console.warn(
          "[NetplayMenu] P2P connectivity test not available - engine not ready",
        );
      }
    };

    // ICE Server Configuration Test button - more compact for two-column layout
    const iceTestButton = this.createElement("button");
    iceTestButton.innerText = "Test ICE";
    iceTestButton.className = "ejs_button";
    iceTestButton.style.padding = "4px 8px";
    iceTestButton.style.fontSize = "0.85em";
    iceTestButton.style.width = "100%";
    iceTestButton.style.maxWidth = "100%";
    iceTestButton.onclick = () => {
      if (this.engine?.testIceServerConfiguration) {
        console.log(
          "[NetplayMenu] 🧊 Starting ICE server configuration test...",
        );
        this.engine
          .testIceServerConfiguration()
          .then((result) => {
            if (result) {
              console.log(
                "[NetplayMenu] ICE server test completed successfully:",
                result,
              );
            } else {
              console.warn(
                "[NetplayMenu] ICE server test failed or returned no results",
              );
            }
          })
          .catch((err) => {
            console.error(
              "[NetplayMenu] ICE server configuration test failed:",
              err,
            );
          });
      } else {
        console.warn(
          "[NetplayMenu] ICE server test not available - engine not ready",
        );
      }
    };

    // Add settings in two-column layout
    settingsTable.appendChild(
      createTwoColumnRow(
        "SVC with VP9",
        vp9SvcSelect,
        "Legacy Simulcast",
        simulcastSelect,
      ),
    );
    settingsTable.appendChild(
      createTwoColumnRow(
        "Host Codec",
        hostCodecSelect,
        "Client Simulcast Quality",
        clientQualitySelect,
      ),
    );
    settingsTable.appendChild(
      createTwoColumnRow(
        "Retry Connection Timer",
        retryTimerSelect,
        "Unordered Retries",
        unorderedRetriesSelect,
      ),
    );
    settingsTable.appendChild(
      createTwoColumnRow("Input Mode", inputModeSelect, null, null),
    );
    settingsTable.appendChild(
      createTwoColumnRow(
        "P2P Test",
        testButton,
        "ICE Config Test",
        iceTestButton,
      ),
    );

    settingsContainer.appendChild(settingsTable);
    content.appendChild(settingsContainer);

    // Close button - mobile optimized
    const closeBtn = this.createElement("button");
    closeBtn.classList.add("ejs_button_button");
    closeBtn.classList.add("ejs_popup_submit");
    closeBtn.style["background-color"] = "rgba(var(--ejs-primary-color),1)";
    closeBtn.style.marginTop = isMobile ? "6px" : "8px";
    closeBtn.style.padding = isMobile ? "5px 12px" : "6px 16px";
    closeBtn.style.fontSize = isMobile ? "0.85em" : "0.9em";
    closeBtn.style.width = isMobile ? "100%" : "auto";
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
    // Initialize ready states array for maxPlayers
    this.netplay.playerReadyStates = new Array(maxPlayers).fill(false);
    this.netplay.playerReadyStates[0] = true; // Host starts ready

    // Create fallback player data for host (will be replaced when server data arrives)
    const fallbackPlayers = [
      {
        id: this.getMyPlayerId() || "host",
        slot: 0,
        name: this.netplay.name || "Host",
        ready: true,
        role: "player",
      },
    ];

    // Use centralized table update mechanics
    this.netplayUpdatePlayerTable(fallbackPlayers);

    // If we have full player data (from netplayUpdatePlayerList), update the table with it
    // Otherwise, keep the fallback host-only display
    if (this.netplay.joinedPlayers && this.netplay.joinedPlayers.length > 0) {
      console.log(
        "[NetplayMenu] Updating delay sync table with full player data",
      );
      this.netplayUpdatePlayerTable(this.netplay.joinedPlayers);
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
      console.log(
        `[NetplayMenu] Rebuilding ${isDelaySync ? "delay sync" : "live stream"} player table with`,
        playersArray.length,
        "players",
      );

      // Clear existing table
      console.log(
        "[NetplayMenu] Clearing existing table, had",
        tbody.children.length,
        "rows",
      );
      tbody.innerHTML = "";

      // Rebuild table with current players
      playersArray.forEach((player, index) => {
        console.log(`[NetplayMenu] Adding player ${index}:`, player);

        const row = this.createElement("tr");
        // Add data attribute with player ID for reliable identification
        row.setAttribute("data-player-id", player.id);

        // Player column (use actual player slot, not array index)
        const playerCell = this.createElement("td");
        playerCell.innerText = this.getSlotDisplayText(player.slot);
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
          // Live stream: Status emoji
          thirdCell.innerText = this.getPlayerStatusEmoji(player);
          thirdCell.style.textAlign = "center";
        }

        row.appendChild(thirdCell);
        tbody.appendChild(row);
      });

      console.log(
        "[NetplayMenu] Table rebuild complete, now has",
        tbody.children.length,
        "rows",
      );

      // Log the content of each row for debugging
      for (let i = 0; i < tbody.children.length; i++) {
        const row = tbody.children[i];
        const cells = row.querySelectorAll("td");
        const cellTexts = Array.from(cells).map((cell) => cell.textContent);
        console.log(`[NetplayMenu] Row ${i} content:`, cellTexts);
      }

      // Also log the entire table HTML for debugging
      console.log("[NetplayMenu] Table HTML:", tbody.innerHTML);

      return;
    }

    // Handle individual slot (legacy behavior)
    const slot = playersOrSlot;
    const player = this.netplay.joinedPlayers.find((p) => p.slot === slot);
    if (!player) return;

    // Check if a row for this player already exists
    const existingRow = tbody.querySelector(
      `tr[data-player-id="${player.id}"]`,
    );

    let row;
    if (existingRow) {
      // Update existing row instead of creating duplicate
      console.log(
        `[NetplayMenu] Updating existing row for player ${player.id} in slot ${slot}`,
      );
      row = existingRow;
      // Clear existing cells to rebuild them
      row.innerHTML = "";
    } else {
      // Create new row only if none exists
      console.log(
        `[NetplayMenu] Creating new row for player ${player.id} in slot ${slot}`,
      );
      row = this.createElement("tr");
    }

    // Add data attribute with player ID for reliable identification
    row.setAttribute("data-player-id", player.id);

    // Player column (same for both table types)
    const playerCell = this.createElement("td");
    playerCell.innerText = this.getSlotDisplayText(slot);
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
      // Live stream: Status emoji
      thirdCell.innerText = this.getPlayerStatusEmoji(player);
      thirdCell.style.textAlign = "center";
    }

    row.appendChild(thirdCell);

    // Only append if this is a new row (not updating existing)
    if (!existingRow) {
      tbody.appendChild(row);
    }
  }

  // Update player slot in table
  netplayUpdatePlayerSlot(slot) {
    // Find and update the local player in joinedPlayers
    if (this.netplay.joinedPlayers) {
      const localPlayerId = this.netplay.engine?.sessionState?.localPlayerId;
      const localPlayerName = this.netplay.name;
      const localPlayer = this.netplay.joinedPlayers.find(
        (p) =>
          (localPlayerId && p.id === localPlayerId) ||
          (localPlayerName && p.name === localPlayerName),
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
      const hostPlayer = this.netplay.joinedPlayers.find((p) =>
        this.isPlayerHost(p),
      );
      if (hostPlayer) {
        // Move from old slot to new slot
        const oldSlot = hostPlayer.slot;
        hostPlayer.slot = slot;

        // Update taken slots
        if (!this.netplay.takenSlots) this.netplay.takenSlots = new Set();
        this.netplay.takenSlots.delete(oldSlot);
        this.netplay.takenSlots.add(slot);

        // Re-render the table
        this.netplayUpdatePlayerTable(this.netplay.joinedPlayers); // Uses real data
      }
    }

    // Update Live Stream table if it exists
    if (this.netplay.liveStreamPlayerTable) {
      const tbody = this.netplay.liveStreamPlayerTable;
      if (tbody.children[0]) {
        const playerCell = tbody.children[0].querySelector("td:first-child");
        if (playerCell) {
          playerCell.innerText = this.getSlotDisplayText(slot);
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
        currentPlayers =
          this.netplay.engine.playerManager.getPlayersObject() || {};
        hasPlayerData = Object.keys(currentPlayers).length > 0;
        console.log(
          "[NetplayMenu] Got current players for slot selector:",
          currentPlayers,
        );
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

      console.log(
        "[NetplayMenu] Updated taken slots from player data:",
        Array.from(this.netplay.takenSlots),
      );
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

    // Use centralized slot selector options
    const myPlayerId = this.getMyPlayerId();
    const options = this.getSlotSelectorOptions(myPlayerId);

    // Add options to select element
    for (const option of options) {
      const opt = this.createElement("option");
      opt.value = String(option.value);
      opt.innerText = option.text;
      if (option.disabled) opt.disabled = true;
      if (option.selected) opt.selected = true;
      slotSelect.appendChild(opt);
    }

    // Store reference
    this.netplay.slotSelect = slotSelect;

    // Set up event listener (only if not already wired)
    if (!this.netplay._slotSelectWired) {
      this.netplay._slotSelectWired = true;
      this.addEventListener(slotSelect, "change", () => {
        const raw = parseInt(slotSelect.value, 10);
        const slot = isNaN(raw) ? 0 : Math.max(0, Math.min(8, raw)); // Allow 0-8 (Spectator)

        // Use centralized slot change system
        this.requestSlotChange(slot);

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
      const passwordElement = this.netplay.tabs[1].querySelector(
        'input[type="password"], .ejs_netplay_password',
      );
      if (passwordElement && passwordElement.parentElement) {
        passwordElement.parentElement.parentElement.insertBefore(
          slotContainer,
          passwordElement.parentElement.nextSibling,
        );
      } else {
        // Fallback: insert at the beginning of the tab
        this.netplay.tabs[1].insertBefore(
          slotContainer,
          this.netplay.tabs[1].firstChild,
        );
      }
    }
  }

  netplayUpdateSlotSelector() {
    if (
      !this.netplay?.slotSelect ||
      !(this.netplay.slotSelect instanceof Element)
    ) {
      console.warn("[NetplayMenu] Slot selector not available for update");
      return;
    }

    const slotSelect = this.netplay.slotSelect;
    // Clear all options except Spectator
    const spectatorOption = slotSelect.querySelector('option[value="8"]');
    slotSelect.innerHTML = "";

    // Use centralized slot selector options logic
    const myPlayerId = this.getMyPlayerId();

    if (myPlayerId) {
      const options = this.getSlotSelectorOptions(myPlayerId);

      // Apply options to the select element
      for (const option of options) {
        const opt = this.createElement("option");
        opt.value = String(option.value);
        opt.innerText = option.text;
        if (option.disabled) {
          opt.disabled = true;
        }
        if (option.selected) {
          opt.selected = true;
        }
        slotSelect.appendChild(opt);
      }
    } else {
      console.warn("[NetplayMenu] Cannot update slot selector: no player ID");
    }

    // The slot selector options are already configured with the correct selected option
    // by getSlotSelectorOptions. No need to manually set the value here.
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
      ready: false,
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
      if (
        this.netplay.playerReadyStates &&
        availableSlot < this.netplay.playerReadyStates.length
      ) {
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
    this.netplay.joinedPlayers = this.netplay.joinedPlayers.filter(
      (p) => p.slot !== slot,
    );

    // Free up the slot
    if (this.netplay.takenSlots) {
      this.netplay.takenSlots.delete(slot);
    }

    // Remove from Delay Sync table
    if (this.netplay.delaySyncPlayerTable) {
      // Re-render the entire table
      this.netplayUpdatePlayerTable(this.netplay.joinedPlayers); // Uses real data
    }

    // Update slot selector to remove the taken slot
    this.netplayUpdateSlotSelector();
  }

  // Toggle ready status
  netplayToggleReady() {
    if (!this.netplay.readyButton) return;

    // Toggle the host's ready status
    const hostPlayer = this.netplay.joinedPlayers.find((p) =>
      this.isPlayerHost(p),
    );
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
    this.netplay.readyButton.innerText = hostPlayer.ready
      ? "Not Ready"
      : "Ready";

    // Check if all players are ready to enable launch button
    this.netplayUpdateLaunchButton();
  }

  // Update launch game button state
  netplayUpdateLaunchButton() {
    if (!this.netplay.launchButton || !this.netplay.joinedPlayers) return;

    // Check if all joined players are ready
    const allReady = this.netplay.joinedPlayers.every((player) => player.ready);
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
      typeCell.innerText =
        room.netplay_mode === 1 ? "Delay Sync" : "Live Stream";
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

    // Remove debug buttons when leaving lobby
    const pingButton = document.getElementById("ejs-netplay-ping-test");
    if (pingButton) {
      pingButton.remove();
      console.log("[NetplayMenu] Removed ping test button");
    }

    const orderedButton = document.getElementById("ejs-netplay-ordered-test");
    if (orderedButton) {
      orderedButton.remove();
      console.log("[NetplayMenu] Removed ordered mode test button");
    }
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
        },
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
    ["Yes", "No"].forEach((val) => {
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
    ["Live Stream", "Delay Sync"].forEach((val) => {
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
    ["Timeout + Last Known", "Strict Sync"].forEach((val) => {
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
      const allowSpectators = spectatorSelect
        ? spectatorSelect.value === "yes"
        : true;
      const roomType = roomTypeSelect.value;
      const frameDelay = frameDelaySelect
        ? parseInt(frameDelaySelect.value, 10)
        : 2;
      const syncMode = syncModeSelect ? syncModeSelect.value : "timeout";

      if (!roomName) {
        alert("Please enter a room name");
        return;
      }

      try {
        container.remove(); // Remove the popup
        await this.engine.netplayCreateRoom(
          roomName,
          maxPlayers,
          password,
          allowSpectators,
          roomType,
          frameDelay,
          syncMode,
        );
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
      delaySyncOptions.style.display =
        roomTypeSelect.value === "delay_sync" ? "" : "none";
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
        const cookies = document.cookie.split(";");
        for (const cookie of cookies) {
          const [name, value] = cookie.trim().split("=");
          if (name === "romm_sfu_token" || name === "sfu_token") {
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
          let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
          while (base64.length % 4) {
            base64 += "=";
          }

          // Decode base64 to binary string, then convert to proper UTF-8
          const binaryString = atob(base64);

          // Convert binary string to UTF-8 using TextDecoder if available, otherwise fallback
          if (typeof TextDecoder !== "undefined") {
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            return new TextDecoder("utf-8").decode(bytes);
          } else {
            // Fallback for older browsers: this may not handle all UTF-8 correctly
            return decodeURIComponent(escape(binaryString));
          }
        };

        try {
          const payloadStr = base64UrlDecode(token.split(".")[1]);
          const payload = JSON.parse(payloadStr);

          if (payload.sub) {
            // Use the netplay ID as player name, truncate if too long (Unicode-safe)
            playerName = Array.from(payload.sub).slice(0, 20).join("");
          }
        } catch (parseError) {
          console.error(
            "[NetplayMenu] Failed to parse JWT payload:",
            parseError,
          );
        }
      }
    } catch (e) {
      console.warn(
        "[NetplayMenu] Failed to extract player name from token:",
        e,
      );
    }

    if (!menuExists) {
      // Create popup first, but pass empty buttons array for setup by createBottomBarButtons
      const body = this.createPopup("Netplay Listings", {}, true);

      // Set netplayMenu
      this.netplayMenu = body.parentElement;
      const rooms = this.createElement("div");
      this.defineNetplayFunctions();
      const table = this.createNetplayTable("listings", rooms);
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
          const cookies = document.cookie.split(";");
          for (const cookie of cookies) {
            const [name, value] = cookie.trim().split("=");
            if (name === "romm_sfu_token" || name === "sfu_token") {
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
            let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
            while (base64.length % 4) {
              base64 += "=";
            }

            // Decode base64 to binary string, then convert to proper UTF-8
            const binaryString = atob(base64);

            // Convert binary string to UTF-8 using TextDecoder if available, otherwise fallback
            if (typeof TextDecoder !== "undefined") {
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              return new TextDecoder("utf-8").decode(bytes);
            } else {
              // Fallback for older browsers: this may not handle all UTF-8 correctly
              return decodeURIComponent(escape(binaryString));
            }
          };

          try {
            const payloadStr = base64UrlDecode(token.split(".")[1]);
            console.log("[EmulatorJS] Raw JWT payload:", payloadStr);
            const payload = JSON.parse(payloadStr);
            console.log("[EmulatorJS] Parsed JWT payload:", payload);

            if (payload.sub) {
              console.log("[EmulatorJS] Original sub field:", payload.sub);
              // Use the netplay ID as player name, truncate if too long (Unicode-safe)
              playerName = Array.from(payload.sub).slice(0, 20).join("");
              console.log("[EmulatorJS] Extracted player name:", playerName);
              console.log(
                "[EmulatorJS] Player name char codes:",
                Array.from(playerName).map((c) => c.charCodeAt(0)),
              );
            }
          } catch (parseError) {
            console.error(
              "[EmulatorJS] Failed to parse JWT payload:",
              parseError,
            );
          }
        }
      } catch (e) {
        console.warn(
          "[EmulatorJS] Failed to extract player name from token:",
          e,
        );
      }

      // Create the netplay object after extracting the player name
      this.emulator.netplay = {
        name: playerName,
        engine: this.engine,
        passwordElem: password,
        roomNameElem: title2,
        createButton: this.leaveCreateButton,
        tabs: [rooms, joined],
        slotSelect: slotSelect,
        // Single source of truth for netplay ID - prioritizes session state over fallbacks
        getNetplayId: function () {
          // Priority order: session state (authenticated) > name > "local"
          return (
            this.engine?.sessionState?.localPlayerId || this.name || "local"
          );
        },
        ...this.emulator.netplay,
      };

      // Update existing player data if player table was already created
      if (this.emulator.netplay.joinedPlayers) {
        // Update the local player's name in joinedPlayers
        const localPlayer = this.emulator.netplay.joinedPlayers.find(
          (p) =>
            p.name === "local" ||
            p.name ===
              this.emulator.netplay.engine?.sessionState?.localPlayerId,
        );
        if (localPlayer) {
          localPlayer.name = playerName;
        }

        // Refresh the delay sync player table if it exists
        if (this.emulator.netplay.delaySyncPlayerTable) {
          // Clear and recreate the table with updated names
          this.emulator.netplay.delaySyncPlayerTable.innerHTML = "";
          this.emulator.netplay.joinedPlayers.forEach((player) => {
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

    // Setup correct UI based on current room state before showing
    if (this.emulator.netplay && this.emulator.netplay.currentRoomId) {
      // User is in a room, setup room UI
      const roomType =
        this.emulator.netplay.currentRoom?.netplay_mode === 1
          ? "delaysync"
          : "livestream";

      // Ensure room UI elements exist (they might not if menu was created before joining room)
      if (roomType === "livestream" && !this.netplay.liveStreamPlayerTable) {
        // Set up the player slot selector first
        const slotSelect = this.createSlotSelector();
        this.netplay.slotSelect = slotSelect;

        // Add slot selector to the joined tab
        if (this.netplay.tabs && this.netplay.tabs[1]) {
          this.netplay.tabs[1].appendChild(slotSelect);
        }

        // Create the player table
        const table = this.createNetplayTable("livestream");

        // Insert table after the slot selector
        if (this.netplay.slotSelect && this.netplay.slotSelect.parentElement) {
          this.netplay.slotSelect.parentElement.insertBefore(
            table,
            this.netplay.slotSelect.nextSibling,
          );
        }

        // This populates and updates the table.
        this.netplayUpdatePlayerTable(this.netplay.joinedPlayers); // Uses real data
      } else if (
        roomType === "delaysync" &&
        !this.netplay.delaySyncPlayerTable
      ) {
        // Set up the player slot selector first
        const slotSelect = this.createSlotSelector();
        this.netplay.slotSelect = slotSelect;

        // Add slot selector to the joined tab
        if (this.netplay.tabs && this.netplay.tabs[1]) {
          this.netplay.tabs[1].appendChild(slotSelect);
        }

        // Create the player table
        const table = this.createNetplayTable("delaysync");

        // Insert table after the slot selector
        if (this.netplay.slotSelect && this.netplay.slotSelect.parentElement) {
          this.netplay.slotSelect.parentElement.insertBefore(
            table,
            this.netplay.slotSelect.nextSibling,
          );
        }

        // Initialize player list (host is always player 1)
        this.netplayUpdatePlayerTable(this.netplay.joinedPlayers);
      }

      // Switch to joined tab for room view
      if (this.netplay.tabs && this.netplay.tabs[0] && this.netplay.tabs[1]) {
        this.netplay.tabs[0].style.display = "none"; // Hide rooms tab
        this.netplay.tabs[1].style.display = ""; // Show joined tab
      }

      // Update title based on room type
      const titleElement = this.netplayMenu.querySelector("h4");
      if (titleElement) {
        titleElement.innerText =
          roomType === "delaysync" ? "Delay Sync Room" : "Live Stream Room";
      }

      // Setup bottom bar for room type
      this.setupNetplayBottomBar(roomType);

      // Update room info display
      if (this.netplay.roomNameElem) {
        this.netplay.roomNameElem.innerText =
          this.emulator.netplay.currentRoom?.name ||
          this.emulator.netplay.currentRoomId;
      }
      if (this.netplay.passwordElem) {
        const hasPassword = this.emulator.netplay.currentRoom?.password;
        this.netplay.passwordElem.innerText = hasPassword
          ? `Password: ${"*".repeat(hasPassword.length)}`
          : "";
        this.netplay.passwordElem.style.display = hasPassword ? "" : "none";
      }
    } else {
      // User is not in a room, setup listings UI
      this.setupNetplayBottomBar("listings");

      // Switch to rooms tab when showing listings
      if (this.netplay.tabs && this.netplay.tabs[0] && this.netplay.tabs[1]) {
        this.netplay.tabs[0].style.display = ""; // Show rooms tab
        this.netplay.tabs[1].style.display = "none"; // Hide joined tab
      }
    }

    // Show netplay menu
    this.netplayMenu.style.display = "block";

    // Hide player slot selector in lobby view (only for new menus)
    if (
      !menuExists &&
      this.netplay &&
      this.netplay.slotSelect &&
      this.netplay.slotSelect.parentElement
    ) {
      this.netplay.slotSelect.parentElement.style.display = "none";
    }

    // Show player name popup only if no valid name was extracted from token AND this is a new menu
    if (!menuExists && (!playerName || playerName === "Player")) {
      this.netplay = {
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

    this.setupNetplayBottomBar("listings");
    this.netplay.updateList.start();
  }

  // Create a a slot slector with styling and listener to update input slot and player table
  createSlotSelector(container = null, position = "append") {
    const slotSelect = this.createElement("select");
    // Add basic styling to make it look like a proper dropdown
    slotSelect.style.backgroundColor = "#333";
    slotSelect.style.border = "1px solid #555";
    slotSelect.style.borderRadius = "4px";
    slotSelect.style.padding = "4px 8px";
    slotSelect.style.minWidth = "80px";
    slotSelect.style.cursor = "pointer";
    slotSelect.style.color = "#fff";

    // Add options to select element
    for (let i = 0; i < 4; i++) {
      const opt = this.createElement("option");
      opt.value = String(i);
      opt.innerText = "P" + (i + 1);
      slotSelect.appendChild(opt);
    }

    // Add spectator option
    const spectatorOpt = this.createElement("option");
    spectatorOpt.value = "4";
    spectatorOpt.innerText = "Spectator";
    slotSelect.appendChild(spectatorOpt);

    // Determine current player's slot (prioritize localSlot, then find by name/ID)
    let currentPlayerSlot = this.netplay.localSlot;
    if (currentPlayerSlot === undefined || currentPlayerSlot === null) {
      // Try to find current player in joined players
      const localPlayerId = this.netplay.engine?.sessionState?.localPlayerId;
      const localPlayerName = this.netplay.name;
      const localPlayer = this.netplay.joinedPlayers?.find(
        (p) =>
          (localPlayerId && p.id === localPlayerId) ||
          (localPlayerName && p.name === localPlayerName),
      );
      if (localPlayer) {
        currentPlayerSlot = localPlayer.slot;
        // Update localSlot to match
        this.netplay.localSlot = currentPlayerSlot;
      }
    }

    // Get current value (preference or previously selected)
    const currentValue =
      this.netplayPreferredSlot ||
      (typeof window !== "undefined"
        ? window.EJS_NETPLAY_PREFERRED_SLOT
        : null) ||
      null;

    // Set the current selection to the player's assigned slot, or first available
    if (
      currentPlayerSlot !== undefined &&
      currentPlayerSlot !== null &&
      slotSelect.querySelector(`option[value="${currentPlayerSlot}"]`)
    ) {
      // Player has an assigned slot and it's available in the dropdown, select it
      slotSelect.value = String(currentPlayerSlot);
      console.log(
        `[NetplayMenu] Set slot selector to current player slot: ${currentPlayerSlot}`,
      );
    } else if (slotSelect.querySelector(`option[value="${currentValue}"]`)) {
      // Restore previous selection if valid
      slotSelect.value = currentValue;
    } else if (slotSelect.options.length > 0) {
      // Select first available option
      slotSelect.value = slotSelect.options[0].value;
      console.log(
        `[NetplayMenu] Set slot selector to first available: ${slotSelect.value}`,
      );
    }
    // Attach event listener immediately
    this.addEventListener(slotSelect, "change", async () => {
      const raw = parseInt(slotSelect.value, 10);
      const slot = isNaN(raw) ? 0 : Math.max(0, Math.min(8, raw));
      console.log("[NetplayMenu] Slot selector changed to:", slot);

      try {
        await this.requestSlotChange(slot);

        // Only save settings if server accepted the change
        if (this.settings) {
          this.settings.netplayPreferredSlot = String(slot);
        }
        this.saveSettings();
      } catch (error) {
        console.error(
          "[NetplayMenu] Slot change rejected by server:",
          error.message,
        );

        // Revert the slot selector to its previous value
        const previousValue =
          this.netplay.localSlot !== undefined ? this.netplay.localSlot : 0;
        slotSelect.value = String(previousValue);

        // Show user feedback about why the change was rejected
        alert(`Cannot change to slot ${slot}: ${error.message}`);
      }
    });
    // If container provided, insert into DOM
    if (container) {
      const slotLabel = this.createElement("strong");
      slotLabel.innerText =
        this.localization("Player Select") || "Player Select";
      slotLabel.marginRight = "10px"; // some spacing

      if (position === "append") {
        container.appendChild(slotLabel);
        container.appendChild(slotSelect);
      } else if (position === "prepend") {
        // For prepend, insert both label and select at the beginning
        container.insertBefore(slotSelect, container.firstChild);
        container.insertBefore(slotLabel, slotSelect);
      }
    }

    return slotSelect;
  }

  // Hook into emulator's volume control to sync stream audio volume
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
    Object.defineProperty(this.emulator, "volume", {
      get: function () {
        return volumeProperty;
      },
      set: function (value) {
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
      },
    });

    console.log(
      "[NetplayMenu] Stream audio volume control hooked into emulator volume",
    );
  }

  /**
   * Validate player data and log debug information
   * @param {Object} data - Player data from server
   * @returns {boolean} True if validation passed
   */
  validateAndDebugPlayerData(data) {
    console.log("[NetplayMenu] Updating player list:", data);
    console.log(
      "[NetplayMenu] Players object keys:",
      Object.keys(data.players || {}),
    );
    console.log(
      "[NetplayMenu] Players object values:",
      Object.values(data.players || {}),
    );

    // Debug player data structure
    if (data.players) {
      Object.entries(data.players).forEach(([playerId, playerData]) => {
        console.log(`[NetplayMenu] Player ${playerId} data:`, {
          name: playerData.name,
          player_name: playerData.player_name,
          netplay_username: playerData.netplay_username,
          allKeys: Object.keys(playerData),
        });
      });
    }

    if (!data || !data.players) {
      console.warn("[NetplayMenu] No players data provided");
      return false;
    }
    return true;
  }

  /**
   * Convert server player format to local joinedPlayers format
   * @param {Object} data - Player data from server
   * @returns {Array} Array of player objects in local format
   */
  convertServerPlayersToLocalFormat(data) {
    const playersArray = Object.entries(data.players).map(
      ([playerId, playerData]) => {
        // Prefer netplay_username for display (censored), fallback to player_name (uncensored), then name
        const resolvedName =
          playerData.netplay_username ||
          playerData.player_name ||
          playerData.name ||
          "Unknown";
        console.log(`[NetplayMenu] Player ${playerId} name resolution:`, {
          name: playerData.name,
          player_name: playerData.player_name,
          netplay_username: playerData.netplay_username,
          resolvedName,
        });
        return {
          id: playerId,
          slot: playerData.slot || playerData.player_slot || 0,
          name: resolvedName,
          ready: playerData.ready || false,
          // Include any other properties that might be needed
          ...playerData,
        };
      },
    );
    console.log("[NetplayMenu] Converted playersArray:", playersArray);
    console.log("[NetplayMenu] playersArray length:", playersArray.length);

    return playersArray;
  }

  /**
   * Identify the local player from session state
   * @returns {Object} Object with localPlayerId and localPlayerName
   */
  identifyLocalPlayer() {
    const localPlayerId = this.netplay.engine?.sessionState?.localPlayerId;
    const localPlayerName = this.netplay.name;
    console.log(
      "[NetplayMenu] Local player ID:",
      localPlayerId,
      "Local player name:",
      localPlayerName,
    );

    return { localPlayerId, localPlayerName };
  }

  /**
   * Process player slots, preserving local player's slot and auto-assigning for others
   * @param {Array} playersArray - Array of player objects
   * @param {string} localPlayerId - Local player ID
   * @param {string} localPlayerName - Local player name
   * @returns {Set} Set of taken slots
   */
  processPlayerSlots(playersArray, localPlayerId, localPlayerName) {
    // Track current taken slots (spectators don't take player slots)
    const takenSlots = new Set();
    playersArray.forEach((player) => {
      if (
        player.slot !== undefined &&
        player.slot !== null &&
        player.slot !== 8
      ) {
        takenSlots.add(player.slot);
      }
    });

    // Auto-assign slots to players who don't have one or have conflicting slots
    playersArray.forEach((player, index) => {
      // Check if this is the local player
      const isLocalPlayer =
        (localPlayerId && player.id === localPlayerId) ||
        (localPlayerName && player.name === localPlayerName);

      // For local player, preserve their assigned slot from session state
      if (isLocalPlayer) {
        const currentLocalSlot =
          this.netplay?.engine?.sessionState?.getLocalPlayerSlot() ??
          this.netplay?.localSlot;
        if (currentLocalSlot !== null && currentLocalSlot !== undefined) {
          // Override server data with local player's actual slot
          player.slot = currentLocalSlot;
          console.log(
            `[NetplayMenu] Preserving local player slot ${currentLocalSlot} for ${player.name}`,
          );
        }
      }

      // If player has no slot assigned or slot conflicts, assign a free slot
      // (Skip local player since we preserved their slot above, and skip spectators)
      if (
        !isLocalPlayer &&
        player.slot !== 8 &&
        (player.slot === undefined ||
          player.slot === null ||
          takenSlots.has(player.slot))
      ) {
        // Find lowest available slot
        let newSlot = 0;
        while (takenSlots.has(newSlot) && newSlot < 4) {
          newSlot++;
        }

        if (newSlot < 4) {
          console.log(
            `[NetplayMenu] Auto-assigning slot ${newSlot} to player ${player.name} (was ${player.slot})`,
          );
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
            // Update slot selector UI to reflect server-assigned slot
            if (this.netplay.slotSelect) {
              this.netplay.slotSelect.value = String(newSlot);
              console.log(
                `[NetplayMenu] Updated slot selector UI to slot ${newSlot}`,
              );
            }
            console.log(
              `[NetplayMenu] Updated local player slot to ${newSlot}`,
            );
          }
        } else {
          console.warn(
            `[NetplayMenu] No available slots for player ${player.name}`,
          );
        }
      } else {
        // Slot is valid, mark it as taken
        takenSlots.add(player.slot);
      }
    });

    return takenSlots;
  }

  /**
   * Synchronize local state arrays with processed player data
   * @param {Array} playersArray - Array of processed player objects
   */
  synchronizeLocalState(playersArray) {
    // Update joinedPlayers array
    this.netplay.joinedPlayers = playersArray;

    // Update taken slots (spectators don't take player slots)
    if (!this.netplay.takenSlots) {
      this.netplay.takenSlots = new Set();
    }
    this.netplay.takenSlots.clear();
    playersArray.forEach((player) => {
      if (player.slot !== 8) {
        // Spectators don't take player slots
        this.netplay.takenSlots.add(player.slot);
      }
    });

    // Update ready states array
    const maxPlayers = this.netplay.maxPlayers || 4;
    this.netplay.playerReadyStates = new Array(maxPlayers).fill(false);
    playersArray.forEach((player) => {
      if (player.slot < maxPlayers) {
        this.netplay.playerReadyStates[player.slot] = player.ready || false;
      }
    });
  }

  /**
   * Update player UI components (table, selector, buttons)
   * @param {Array} playersArray - Array of player objects
   */
  updatePlayerUI(playersArray) {
    // Update the appropriate player table
    if (
      this.netplay.delaySyncPlayerTable ||
      this.netplay.liveStreamPlayerTable
    ) {
      const tableType = this.netplay.delaySyncPlayerTable
        ? "delay sync"
        : "live stream";
      console.log(
        `[NetplayMenu] Rebuilding ${tableType} player table with`,
        playersArray.length,
        "players",
      );

      // Clear existing table
      const tbody =
        this.netplay.delaySyncPlayerTable || this.netplay.liveStreamPlayerTable;
      console.log(
        "[NetplayMenu] Clearing existing table, had",
        tbody.children.length,
        "rows",
      );
      tbody.innerHTML = "";

      // Rebuild table with current players
      console.log(
        `[NetplayMenu] Rebuilding table with ${playersArray.length} players`,
      );
      this.netplayUpdatePlayerTable(playersArray);

      console.log(
        "[NetplayMenu] Table rebuild complete, now has",
        tbody.children.length,
        "rows",
      );

      // Log the content of each row
      for (let i = 0; i < tbody.children.length; i++) {
        const row = tbody.children[i];
        const cells = row.querySelectorAll("td");
        const cellTexts = Array.from(cells).map((cell) => cell.textContent);
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

  // Update player list in UI
  netplayUpdatePlayerList(data) {
    // 1. Validate and debug
    if (!this.validateAndDebugPlayerData(data)) {
      return;
    }

    // 2. Convert data format
    const playersArray = this.convertServerPlayersToLocalFormat(data);

    // 3. Identify local player
    const { localPlayerId, localPlayerName } = this.identifyLocalPlayer();

    // 4. Process slots (including local player preservation)
    this.processPlayerSlots(playersArray, localPlayerId, localPlayerName);

    // 5. Synchronize local state
    this.synchronizeLocalState(playersArray);

    // 6. Update UI
    this.updatePlayerUI(playersArray);

    // 7. Notify other systems
    this.notifyPlayerTableUpdated();
  }

  // Update just one player's slot in the table (targeted update)
  netplayUpdatePlayerSlot(playerId, newSlot) {
    console.log(
      `[NetplayMenu] Updating slot for player ${playerId} to ${newSlot}`,
    );
    console.log(`[NetplayMenu] joinedPlayers:`, this.netplay.joinedPlayers);

    // Check if this is the local player
    const localPlayerId = this.netplay.engine?.sessionState?.localPlayerId;
    const isLocalPlayer = localPlayerId === playerId;

    // Always update local slot state for slot changes (since only local player can change slots)
    this.netplay.localSlot = newSlot;
    console.log(
      `[NetplayMenu] Updated local player slot to ${newSlot} (player: ${playerId}, local: ${isLocalPlayer})`,
    );

    if (isLocalPlayer) {
      console.log(`[NetplayMenu] Confirmed local player slot update`);
    }

    if (!this.netplay.joinedPlayers) {
      console.warn("[NetplayMenu] No joinedPlayers array to update");
      return;
    }

    // Find the player in the joinedPlayers array
    const playerIndex = this.netplay.joinedPlayers.findIndex(
      (p) => p.id === playerId,
    );
    if (playerIndex === -1) {
      console.warn(
        `[NetplayMenu] Player ${playerId} not found in joinedPlayers`,
      );
      return;
    }

    // Update the player's slot
    const oldSlot = this.netplay.joinedPlayers[playerIndex].slot;
    this.netplay.joinedPlayers[playerIndex].slot = newSlot;

    console.log(
      `[NetplayMenu] Updated player ${playerId} slot from ${oldSlot} to ${newSlot}`,
    );

    // Update taken slots (spectators don't take player slots)
    if (this.netplay.takenSlots) {
      if (oldSlot !== 8) {
        this.netplay.takenSlots.delete(oldSlot);
      }
      if (newSlot !== 8) {
        this.netplay.takenSlots.add(newSlot);
      }
    }

    // Update ready states if slot changed
    if (oldSlot !== newSlot && this.netplay.playerReadyStates) {
      const maxPlayers = this.netplay.maxPlayers || 4;
      if (oldSlot < maxPlayers) {
        this.netplay.playerReadyStates[oldSlot] = false; // Clear old slot
      }
      if (newSlot < maxPlayers) {
        this.netplay.playerReadyStates[newSlot] =
          this.netplay.joinedPlayers[playerIndex].ready || false;
      }
    }

    // Update the table row for this specific player
    const tbody =
      this.netplay.delaySyncPlayerTable || this.netplay.liveStreamPlayerTable;
    console.log(`[NetplayMenu] Table body:`, tbody);
    console.log(
      `[NetplayMenu] Table children:`,
      tbody ? tbody.children.length : "no tbody",
    );

    if (tbody) {
      // Find the table row that corresponds to this player using data attribute
      const playerId = this.netplay.joinedPlayers[playerIndex].id;
      const playerName = this.netplay.joinedPlayers[playerIndex].name;
      console.log(
        `[NetplayMenu] Looking for table row for player ID: ${playerId}`,
      );

      // Use data attribute for reliable identification
      const targetRow = tbody.querySelector(`tr[data-player-id="${playerId}"]`);

      if (targetRow) {
        console.log(`[NetplayMenu] Found table row for player ${playerId}`);
      } else {
        console.warn(
          `[NetplayMenu] Could not find table row for player ID ${playerId}`,
        );
        console.log(`[NetplayMenu] Available table rows:`);
        for (let i = 0; i < tbody.children.length; i++) {
          const row = tbody.children[i];
          const playerIdAttr = row.getAttribute("data-player-id");
          console.log(`  Row ${i}: data-player-id="${playerIdAttr}"`);
        }
      }

      if (targetRow) {
        const slotCell = targetRow.querySelector("td:first-child"); // Slot column is first
        console.log(`[NetplayMenu] Slot cell:`, slotCell);
        if (slotCell) {
          const newSlotText = this.getSlotDisplayText(newSlot);
          console.log(
            `[NetplayMenu] Changing slot cell from "${slotCell.textContent}" to "${newSlotText}"`,
          );
          slotCell.textContent = newSlotText;
          console.log(
            `[NetplayMenu] Updated table row for player ${playerName} slot cell to ${newSlotText}`,
          );
        } else {
          console.warn(
            `[NetplayMenu] Could not find slot cell for player ${playerName}`,
          );
        }
      } else {
        console.warn(
          `[NetplayMenu] Could not find table row for player ${playerName}`,
        );
        console.log(`[NetplayMenu] Available table rows:`);
        for (let i = 0; i < tbody.children.length; i++) {
          const row = tbody.children[i];
          const cells = row.querySelectorAll("td");
          if (cells.length >= 2) {
            console.log(
              `  Row ${i}: slot="${cells[0].textContent}", name="${cells[1].textContent}"`,
            );
          }
        }
      }
    }

    // Update slot selector to reflect changes
    this.netplayUpdateSlotSelector();

    // Update launch button state
    this.netplayUpdateLaunchButton();

    // Notify systems of the targeted update (avoid full table rebuild)
    this.notifyPlayerTableUpdatedTargeted();
  }

  // Clean up room-specific UI elements
  cleanupRoomUI() {
    console.log("[NetplayMenu] Cleaning up room UI elements");

    // Restore canvas visibility (in case it was hidden for livestream)
    if (
      this.emulator &&
      this.emulator.canvas &&
      this.emulator.canvas.style.display === "none"
    ) {
      console.log("[NetplayMenu] Restoring canvas visibility");
      this.emulator.canvas.style.display = "";
    }

    // Clean up media elements
    if (this.netplay && this.netplay.mediaElements) {
      // Remove video element if it exists
      if (
        this.netplay.mediaElements.video &&
        this.netplay.mediaElements.video.parentElement
      ) {
        console.log("[NetplayMenu] Removing video element from DOM");
        this.netplay.mediaElements.video.parentElement.removeChild(
          this.netplay.mediaElements.video,
        );
      }
      // Clear media elements references
      this.netplay.mediaElements = {};
    }

    // Remove table elements from DOM
    if (this.netplay) {
      // Remove live stream table
      if (
        this.netplay.liveStreamPlayerTable &&
        this.netplay.liveStreamPlayerTable.parentElement
      ) {
        const table = this.netplay.liveStreamPlayerTable.parentElement; // tbody -> table
        if (table.parentElement) {
          table.parentElement.removeChild(table);
        }
      }

      // Remove delay sync table
      if (
        this.netplay.delaySyncPlayerTable &&
        this.netplay.delaySyncPlayerTable.parentElement
      ) {
        const table = this.netplay.delaySyncPlayerTable.parentElement; // tbody -> table
        if (table.parentElement) {
          table.parentElement.removeChild(table);
        }
      }

      // Clear table references
      this.netplay.liveStreamPlayerTable = null;
      this.netplay.delaySyncPlayerTable = null;

      // Clear other room-specific UI elements
      if (this.netplay.slotSelect) {
        // Remove all slot selectors from DOM, not just the referenced one.
        const allSlotSelectors = this.netplayMenu?.querySelectorAll("select");
        allSlotSelectors?.forEach((select) => {
          if (select.parentElement) {
            select.parentElement.removeChild(select);
          }
        });

        // Also remove any "Player Select" labels that might be left behind
        const allLabels = this.netplayMenu?.querySelectorAll("strong");
        allLabels?.forEach((label) => {
          // Only remove labels that contain "Player" text (our slot selector labels)
          if (
            label.innerText &&
            label.innerText.includes("Player") &&
            label.parentElement
          ) {
            label.parentElement.removeChild(label);
          }
        });

        //Clear all slot selector references
        this.netplay.slotSelect = null;
        this.netplay._slotSelectWired = false;
        // Try to remove the slot selector from DOM if it has a parent
        if (this.netplay.slotSelect.parentElement) {
          const slotContainer = this.netplay.slotSelect.parentElement;
          // If the parent is just a wrapper container (like our slot container), remove it
          if (
            slotContainer.parentElement &&
            slotContainer.children.length <= 2
          ) {
            // label + select
            slotContainer.parentElement.removeChild(slotContainer);
          } else {
            // Otherwise just remove the select element itself
            slotContainer.removeChild(this.netplay.slotSelect);
          }
        }
        // Also check if it's directly in the joined tab (live stream case)
        if (
          this.netplay.tabs &&
          this.netplay.tabs[1] &&
          this.netplay.tabs[1].contains(this.netplay.slotSelect)
        ) {
          this.netplay.tabs[1].removeChild(this.netplay.slotSelect);
        }
      }

      // Clear the reference
      this.netplay.slotSelect = null;

      // Also clear any slot selector wiring flags
      this.netplay._slotSelectWired = false;

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
      const localPlayer = Object.values(players).find(
        (p) =>
          (localPlayerId && p.id === localPlayerId) ||
          (localPlayerName && p.name === localPlayerName),
      );
      if (
        localPlayer &&
        (localPlayer.slot !== undefined ||
          localPlayer.player_slot !== undefined)
      ) {
        playerSlot =
          localPlayer.slot !== undefined
            ? localPlayer.slot
            : localPlayer.player_slot;
      }
    }

    // Fallback to this.netplay.localSlot or engine.sessionState.localSlot
    if (
      playerSlot === 0 &&
      this.netplay.localSlot !== undefined &&
      this.netplay.localSlot !== null
    ) {
      playerSlot = parseInt(this.netplay.localSlot, 10);
    } else if (
      playerSlot === 0 &&
      engine.sessionState?.localSlot !== undefined
    ) {
      playerSlot = engine.sessionState.localSlot;
    }

    console.log("[NetplayMenu] Setting up input sync:", {
      isHost,
      playerSlot,
      slotName: this.getSlotDisplayText(playerSlot),
    });

    // Set global preferred slot for InputSync (so it maps inputs to correct slot)
    if (typeof window !== "undefined") {
      window.EJS_NETPLAY_PREFERRED_SLOT = playerSlot;
      console.log(
        "[NetplayMenu] Set window.EJS_NETPLAY_PREFERRED_SLOT to:",
        playerSlot,
      );
    }

    // Configure InputSync with the player slot
    if (engine.inputSync.slotManager) {
      if (localPlayerId) {
        const assignedSlot = engine.inputSync.slotManager.assignSlot(
          localPlayerId,
          playerSlot,
        );
        console.log(
          "[NetplayMenu] Assigned slot",
          assignedSlot,
          "to player",
          localPlayerId,
        );
      } else {
        console.warn(
          "[NetplayMenu] No localPlayerId available for slot assignment",
        );
      }
    }

    // Get input mode from settings (unorderedRelay, orderedRelay, or unorderedP2P)
    const inputMode =
      this.emulator.getSettingValue("netplayInputMode") ||
      this.emulator.netplayInputMode ||
      "unorderedRelay";

    console.log("[NetplayMenu] Input mode:", inputMode);

    // Handle dynamic transport switching
    const previousMode = this.engine?.dataChannelManager?.mode;
    const modeChanged = previousMode && previousMode !== inputMode;

    if (modeChanged) {
      console.log(
        `[NetplayMenu] 🚀 Transport mode changed from ${previousMode} to ${inputMode}, switching connections`,
      );

      // Tear down existing P2P connections if switching away from P2P
      if (
        (previousMode === "unorderedP2P" || previousMode === "orderedP2P") &&
        (inputMode === "unorderedRelay" || inputMode === "orderedRelay")
      ) {
        console.log(
          "[NetplayMenu] 🔌 Tearing down P2P connections for relay mode",
        );
        this.netplayTearDownP2PConnections();
      }

      // Tear down existing P2P connections if switching between P2P modes
      if (
        (previousMode === "unorderedP2P" || previousMode === "orderedP2P") &&
        (inputMode === "unorderedP2P" || inputMode === "orderedP2P") &&
        previousMode !== inputMode
      ) {
        console.log(
          "[NetplayMenu] 🔄 Switching between P2P modes, tearing down existing connections",
        );
        this.netplayTearDownP2PConnections();
      }

      // Update DataChannelManager mode
      if (this.engine?.dataChannelManager) {
        this.engine.dataChannelManager.mode = inputMode;

        // Update buffer limit based on new settings
        const unorderedRetries =
          this.emulator.getSettingValue("netplayUnorderedRetries") || 0;
        this.engine.dataChannelManager.maxPendingInputs = Math.max(
          unorderedRetries,
          10,
        ); // Minimum 10
        console.log(
          `[NetplayMenu] 📦 Updated buffer limit to ${this.engine.dataChannelManager.maxPendingInputs}`,
        );
      }
    } else if (this.engine?.dataChannelManager) {
      console.log(
        `[NetplayMenu] Updating DataChannelManager mode from ${this.engine.dataChannelManager.mode} to ${inputMode}`,
      );
      this.engine.dataChannelManager.mode = inputMode;
    }

    // Ensure InputSync is initialized
    if (!engine.inputSync) {
      console.warn("[NetplayMenu] InputSync not initialized yet");
      return;
    }

    // Ensure DataChannelManager is configured with the correct mode
    if (engine.dataChannelManager) {
      engine.dataChannelManager.mode = inputMode;
      console.log("[NetplayMenu] DataChannelManager mode set to:", inputMode);

      // For hosts in P2P mode, set up P2P channels now
      if (
        isHost &&
        (inputMode === "unorderedP2P" || inputMode === "orderedP2P")
      ) {
        console.log(
          "[NetplayMenu] Host setting up P2P channels for mode:",
          inputMode,
        );
        if (engine.netplaySetupP2PChannels) {
          setTimeout(() => {
            engine.netplaySetupP2PChannels().catch((err) => {
              console.error(
                "[NetplayMenu] Failed to setup host P2P channels:",
                err,
              );
            });
          }, 500); // Small delay to ensure everything is ready
        }
      }
    }

    // Set global preferred slot for InputSync (so it maps inputs to correct slot)
    if (typeof window !== "undefined") {
      window.EJS_NETPLAY_PREFERRED_SLOT = playerSlot;
    }

    // Configure InputSync with the player slot
    if (engine.inputSync.slotManager) {
      if (localPlayerId) {
        engine.inputSync.slotManager.assignSlot(localPlayerId, playerSlot);
        console.log(
          "[NetplayMenu] Assigned slot",
          playerSlot,
          "to player",
          localPlayerId,
        );
      }
    }

    // For live stream mode, both host and clients should send inputs via data channel
    if (engine.dataChannelManager) {
      // Override InputSync's sendInputCallback to send via data channel
      const originalSendInputCallback = engine.inputSync.sendInputCallback;
      engine.inputSync.sendInputCallback = (frame, inputData) => {
        console.log("[NetplayMenu] sendInputCallback called:", {
          frame,
          inputData,
        });

        // Call original callback (for Socket.IO fallback)
        if (originalSendInputCallback) {
          console.log("[NetplayMenu] Calling original sendInputCallback");
          originalSendInputCallback(frame, inputData);
        }

        // Send via data channel if ready
        if (engine.dataChannelManager && engine.dataChannelManager.isReady()) {
          console.log(
            "[NetplayMenu] DataChannelManager is ready, sending via data channel",
          );
          if (Array.isArray(inputData)) {
            inputData.forEach((data) => {
              if (data.connected_input && data.connected_input.length === 3) {
                const [playerIndex, inputIndex, value] = data.connected_input;
                const inputPayload = {
                  frame: data.frame || frame || 0,
                  slot: 0, // Default slot for fallback
                  playerIndex: playerIndex,
                  inputIndex: inputIndex,
                  value: value,
                };
                engine.dataChannelManager.sendInput(inputPayload);
              }
            });
          } else if (
            inputData.connected_input &&
            inputData.connected_input.length === 3
          ) {
            const [playerIndex, inputIndex, value] = inputData.connected_input;
            const inputPayload = {
              frame: frame || inputData.frame || 0,
              slot: 0, // Default slot for fallback
              playerIndex: playerIndex,
              inputIndex: inputIndex,
              value: value,
            };
            console.log(
              "[NetplayMenu] Calling dataChannelManager.sendInput with:",
              inputPayload,
            );
            engine.dataChannelManager.sendInput(inputPayload);
          }
        } else {
          console.log(
            "[NetplayMenu] DataChannelManager not ready, inputs will use Socket.IO fallback",
          );
        }
      };

      if (isHost) {
        console.log(
          "[NetplayMenu] Host input callback configured to send via data channel",
        );
      } else {
        console.log(
          "[NetplayMenu] Client input callback configured to send via data channel",
        );
      }
    }

    // Hook into the emulator's simulateInput to forward inputs through netplay
    if (this.emulator?.gameManager?.functions?.simulateInput) {
      const originalSimulateInput =
        this.emulator.gameManager.functions.simulateInput;
      this.emulator.gameManager.functions.simulateInput = (
        playerIndex,
        inputIndex,
        value,
        ...args
      ) => {
        // Call original simulateInput
        originalSimulateInput.call(
          this.emulator.gameManager.functions,
          playerIndex,
          inputIndex,
          value,
          ...args,
        );

        // Forward to netplay if this is a local input (not from network)
        if (this.engine?.inputSync && !args.includes?.("netplay-remote")) {
          console.log(
            `[NetplayMenu] Forwarding local input to netplay: player ${playerIndex}, input ${inputIndex}, value ${value}`,
          );
          this.engine.inputSync.sendInput(playerIndex, inputIndex, value);
        }
      };
      console.log(
        "[NetplayMenu] Hooked into emulator simulateInput for netplay forwarding",
      );
    } else {
      console.warn(
        "[NetplayMenu] Could not hook into emulator simulateInput - netplay input forwarding disabled",
      );
    }

    console.log(
      "[NetplayMenu] Input sync setup complete for slot",
      playerSlot,
      "with mode",
      inputMode,
    );

    // For clients in P2P mode, initiate P2P connection after room is fully set up
    console.log(
      `[NetplayMenu] Checking P2P initiation: isHost=${isHost}, inputMode=${inputMode}, hasEngine=${!!this.engine}, hasMethod=${!!this.engine?.netplayInitiateP2PConnection}`,
    );
    if (
      !isHost &&
      (inputMode === "unorderedP2P" || inputMode === "orderedP2P")
    ) {
      console.log(
        "[NetplayMenu] Client will initiate P2P connection after room setup completes",
      );
      // Delay P2P initiation to allow room data to settle
      setTimeout(() => {
        console.log(
          "[NetplayMenu] Executing delayed P2P connection initiation",
        );
        if (this.engine?.netplayInitiateP2PConnection) {
          console.log("[NetplayMenu] Calling netplayInitiateP2PConnection");
          this.engine.netplayInitiateP2PConnection().catch((err) => {
            console.error(
              "[NetplayMenu] Failed to initiate P2P connection:",
              err,
            );
          });
        } else {
          console.error(
            "[NetplayMenu] P2P connection method not available on engine:",
            this.engine,
          );
        }
      }, 3000); // Increased delay to allow room data to settle
    } else {
      console.log(
        `[NetplayMenu] Skipping P2P initiation: isHost=${isHost}, mode=${inputMode}`,
      );
    }
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

  /**
   * Handle netplay setting changes (called from emulator.js).
   * @param {string} changeType - Type of change ("unordered-retries-change", "setting-change", etc.)
   */
  async netplayApplyInputMode(changeType) {
    console.log(`[NetplayMenu] 📝 Applying input mode change: ${changeType}`);

    if (changeType === "unordered-retries-change") {
      // Update buffer limit when unordered retries setting changes
      const unorderedRetries =
        this.emulator.getSettingValue("netplayUnorderedRetries") || 0;
      if (this.engine?.dataChannelManager) {
        this.engine.dataChannelManager.maxPendingInputs = Math.max(
          unorderedRetries,
          10,
        );
        console.log(
          `[NetplayMenu] 📦 Updated buffer limit to ${this.engine.dataChannelManager.maxPendingInputs} based on unordered retries setting`,
        );
      }
    } else if (changeType === "setting-change") {
      // Handle other setting changes, including input mode changes
      console.log(`[NetplayMenu] 🔄 Applying live input mode change`);
      this.netplaySetupLiveStreamInputSync();

      // Additional handling for dynamic P2P mode switching
      const inputMode =
        this.emulator.getSettingValue("netplayInputMode") || "unorderedRelay";
      const isHost =
        typeof window !== "undefined" && window.EJS_netplay?.isHost;

      // Clean up any stale P2P initiation state before attempting new connections
      if (this.engine) {
        console.log(
          `[NetplayMenu] Resetting P2P initiation state for mode switch to ${inputMode}`,
        );
        this.engine._p2pInitiating = false; // Reset the initiation flag
      }

      // If switching TO P2P mode mid-game, ensure P2P connections are established
      if (inputMode === "unorderedP2P" || inputMode === "orderedP2P") {
        console.log(
          `[NetplayMenu] 🌐 Switching to P2P mode ${inputMode}, ensuring connections are established`,
        );

        if (isHost) {
          // Host: Set up P2P channels if not already done
          if (this.engine?.netplaySetupP2PChannels) {
            try {
              await new Promise((resolve) => setTimeout(resolve, 500));
              console.log(
                `[NetplayMenu] Host re-establishing P2P channels for ${inputMode}`,
              );
              await this.engine.netplaySetupP2PChannels();
            } catch (err) {
              console.error(
                "[NetplayMenu] Failed to re-establish host P2P channels:",
                err,
              );
            }
          }
        } else {
          // Client: Initiate P2P connection if not already done
          if (this.engine?.netplayInitiateP2PConnection) {
            try {
              await new Promise((resolve) => setTimeout(resolve, 1000));
              console.log(
                `[NetplayMenu] Client re-initiating P2P connection for ${inputMode}`,
              );
              await this.engine.netplayInitiateP2PConnection();
            } catch (err) {
              console.error(
                "[NetplayMenu] Failed to re-initiate P2P connection:",
                err,
              );
            }
          }
        }
      }
    }
  }

  /**
   * Tear down existing P2P connections when switching transport modes.
   */
  netplayTearDownP2PConnections() {
    if (!this.engine?.dataChannelManager) {
      return;
    }

    console.log("[NetplayMenu] 🔌 Tearing down P2P connections");

    // Clear all P2P channels
    this.engine.dataChannelManager.p2pChannels.clear();

    // Clear any pending inputs since we're switching transports
    this.engine.dataChannelManager.pendingInputs = [];

    console.log("[NetplayMenu] ✅ P2P connections torn down");
  }

  /**
   * Initialize client-side audio mixing system for game + voice audio.
   */
  netplayInitializeAudioMixer() {
    if (this.netplay.audioMixer) {
      return; // Already initialized
    }

    console.log(
      "[NetplayMenu] 🎛️ Initializing audio mixer for game + voice audio",
    );

    this.netplay.audioMixer = {
      audioContext: null,
      gameSource: null,
      micSource: null,
      gameGain: null,
      micGain: null,
      gameTrack: null,
      micTrack: null,
      audioElement: null,
    };

    try {
      // Create AudioContext
      this.netplay.audioMixer.audioContext = new (
        window.AudioContext || window.webkitAudioContext
      )();

      // Create audio element for output (fallback)
      const audioElement = document.createElement("audio");
      audioElement.autoplay = true;
      audioElement.playsInline = true;
      audioElement.muted = false;
      audioElement.style.display = "none";
      audioElement.id = "ejs-netplay-mixed-audio";
      document.body.appendChild(audioElement);
      this.netplay.audioMixer.audioElement = audioElement;

      // Hook into emulator's volume control
      this.netplaySetupStreamVolumeControl();

      console.log("[NetplayMenu] ✅ Audio mixer initialized");
    } catch (error) {
      console.error(
        "[NetplayMenu] ❌ Failed to initialize audio mixer:",
        error,
      );
    }
  }

  /**
   * Add an audio track to the mixer (game or mic audio).
   * @param {MediaStreamTrack} track - Audio track to add
   * @param {string} type - 'game' or 'mic'
   */
  netplayAddAudioTrack(track, type) {
    if (!this.netplay.audioMixer) {
      console.warn("[NetplayMenu] Audio mixer not initialized");
      return;
    }

    const mixer = this.netplay.audioMixer;
    console.log(`[NetplayMenu] 🎚️ Adding ${type} audio track to mixer`);

    try {
      // Create MediaStream from track
      const stream = new MediaStream([track]);

      if (type === "game") {
        // Disconnect existing game audio if any
        if (mixer.gameSource) {
          mixer.gameSource.disconnect();
        }

        // Create new game audio source
        mixer.gameSource = mixer.audioContext.createMediaStreamSource(stream);
        mixer.gameGain = mixer.audioContext.createGain();
        mixer.gameGain.gain.value = 1.0; // Full volume for game audio
        mixer.gameTrack = track;

        // Connect: game source -> game gain -> context destination
        mixer.gameSource.connect(mixer.gameGain);
        mixer.gameGain.connect(mixer.audioContext.destination);

        console.log("[NetplayMenu] 🎮 Game audio connected to mixer");
      } else if (type === "mic") {
        // Disconnect existing mic audio if any
        if (mixer.micSource) {
          mixer.micSource.disconnect();
        }

        // Create new mic audio source
        mixer.micSource = mixer.audioContext.createMediaStreamSource(stream);
        mixer.micGain = mixer.audioContext.createGain();
        mixer.micGain.gain.value = 0.8; // Slightly quieter voice chat
        mixer.micTrack = track;

        // Connect: mic source -> mic gain -> context destination
        mixer.micSource.connect(mixer.micGain);
        mixer.micGain.connect(mixer.audioContext.destination);

        console.log("[NetplayMenu] 🎤 Mic audio connected to mixer");
      }

      // Resume audio context if suspended
      if (mixer.audioContext.state === "suspended") {
        mixer.audioContext.resume().then(() => {
          console.log("[NetplayMenu] 🔊 Audio context resumed");
        });
      }
    } catch (error) {
      console.error(
        `[NetplayMenu] ❌ Failed to add ${type} audio to mixer:`,
        error,
      );
    }
  }

  // ... continue with all other netplay* functions
  // All other netplay functions moved here...
}

window.NetplayMenu = NetplayMenu;
