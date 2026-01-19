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
  constructor(emulator) {
    this.emulator = emulator;
    this.netplayMenu = null;
  }

  /**
   * Initialize and show the netplay menu
   */
  openNetplayMenu() {
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

    // Create the netplay menu UI (moved from openNetplayMenu function)
    // ... [rest of the menu creation code]
    
    this.emulator.netplay = {
      name: playerName,
      table: tbody,
      passwordElem: password,
      roomNameElem: title2,
      createButton: createButton,
      tabs: [rooms, joined],
      slotSelect: slotSelect,
      // Single source of truth for netplay ID - prioritizes session state over fallbacks
      getNetplayId: () => {
        // Priority order: session state (authenticated) > getNetplayId()
        return this.emulator.netplay.engine?.sessionState?.localPlayerId || this.emulator.netplay.name || "local";
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

    this.netplayMenu = menu;
    this.netplayMenu.style.display = "";
  }

  // Move all the netplay* functions here as methods
  netplayShowHostPausedOverlay() {
    // Implementation from emulator.js
  }

  netplayHideHostPausedOverlay() {
    // Implementation from emulator.js
  }

  netplaySetupDelaySyncLobby() {
    // Implementation from emulator.js
  }

  // ... continue with all other netplay* functions

  netplaySwitchToDelaySyncRoom(roomName, password, maxPlayers) {
    if (!this.netplayMenu) return;

    // Stop room listing updates since we're now in a room
    if (this.emulator.netplay.updateList) {
      this.emulator.netplay.updateList.stop();
    }

    // ... rest of the function
  }

  // All other netplay functions moved here...
}

export default NetplayMenu;
