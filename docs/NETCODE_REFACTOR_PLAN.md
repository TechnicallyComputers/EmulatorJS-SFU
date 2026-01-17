---
name: Netcode Compartmentalization
overview: Extract netplay logic from emulator.js into a portable core module with a thin adapter layer, designed for future C++/Java/Kotlin ports. Core module uses primitive data types and minimal emulator interface. Adapter handles EmulatorJS-specific operations like input simulation, frame counting, and media capture.
---

# Netcode Compartmentalization Plan

## Architecture Overview

The netplay code will be split into two layers:

1. **Core Netplay Module** (`netplay-core/`) - Portable, emulator-agnostic netplay logic
2. **Emulator Adapter** (`netplay-adapters/emulatorjs/`) - Thin translation layer for EmulatorJS

## Module Structure

```
data/src/netplay/
├── core/                           # Portable netplay core (language-agnostic design)
│   ├── NetplayEngine.js            # Main orchestrator
│   ├── transport/                  # Network transport layer
│   │   ├── SFUTransport.js         # mediasoup SFU client
│   │   ├── SocketTransport.js      # Socket.IO room management
│   │   └── DataChannelManager.js   # Input data channel handling
│   ├── input/                      # Input synchronization
│   │   ├── InputSync.js            # Frame-based input sync
│   │   ├── InputQueue.js           # Input buffering/retry
│   │   ├── SlotManager.js          # Player slot assignment
│   │   └── frameworks/             # Input frameworks
│   │       ├── SimpleController.js  # Simple controllers (EmulatorJS: 30 inputs)
│   │       └── ComplexController.js # Complex controllers (Native: variable)
│   ├── room/                       # Room and player management
│   │   ├── RoomManager.js          # Room operations (join/create/leave)
│   │   ├── PlayerManager.js        # Player list and metadata
│   │   ├── MetadataValidator.js    # ROM/emulator hash checking
│   │   ├── GameModeManager.js      # Game mode rules and validation
│   │   ├── UsernameManager.js      # Netplay username enforcement
│   │   └── SpectatorManager.js     # Spectator management and chat
│   ├── session/                    # Session state management
│   │   ├── SessionState.js         # Current session state
│   │   └── FrameCounter.js         # Frame counting logic
│   └── config/                     # Configuration
│       └── ConfigManager.js        # Settings and defaults
└── adapters/
    └── emulatorjs/
        ├── EmulatorJSAdapter.js    # Main adapter implementation
        └── interface.js            # Emulator interface definition
```

## Core Module Interface (Emulator Adapter Contract)

The core module requires a minimal emulator interface implemented by adapters:

```javascript
// Emulator Interface (for adapters to implement)
interface IEmulator {
  // Input simulation (primitives only for portability)
  simulateInput(playerIndex: number, inputIndex: number, value: number): void;

  // Frame counting (core manages logic, adapter provides current frame)
  getCurrentFrame(): number;
  setCurrentFrame(frame: number): void;
  onFrame(callback: (frame: number) => void): () => void; // unsubscribe

  // Media capture (returns standard Web APIs)
  captureVideoStream(fps: number): Promise<MediaStream | null>;
  captureAudioStream(): Promise<MediaStream | null>;

  // Session control
  pause(): void;
  resume(): void;
  isPaused(): boolean;
  onPauseChange(callback: (paused: boolean) => void): () => void;

  // Metadata (for room hash validation)
  getEmulatorInfo(): { core: string, version: string };
  getROMInfo(): { hash: string, size: number, name: string } | null;

  // Input framework support (adapter selects framework)
  getInputFramework(): "simple" | "complex";
  getControllerType(): string; // "standard", "switch", "ps3", etc.

  // UI (optional - can be no-op in native emulators)
  displayMessage(message: string, durationMs: number): void;
  showOverlay(type: string, data: any): void;
  hideOverlay(type: string): void;
}
```

**Key Design Decisions:**

- All numeric types (playerIndex, inputIndex, value, frame) are primitive numbers
- No complex objects in core interface - arrays/objects only for metadata/hash checking
- Media streams use standard Web APIs (MediaStream) - native adapters will bridge to platform equivalents
- UI methods are optional (no-op acceptable for native emulators without UI)

## Data Formats (Primitive-Based)

### Input Frameworks

**Simple Controller Framework** (EmulatorJS: SNES, Genesis, etc.):

```javascript
// Simple array of 30 integers (0-30 inputs per frame per player)
inputState: number[]  // [inputIndex0, inputIndex1, ..., inputIndex29]

// Input message
{
  playerIndex: number,      // 0-3
  inputIndex: number,       // 0-29
  value: number,            // 0 or 1 for buttons, -32767 to 32767 for analog
  frame: number             // Frame number (for ordering)
}
```

**Complex Controller Framework** (Native: Switch, PS3, Wii, Xbox, etc.):

```javascript
// Separate framework for complex controllers
// Uses primitive arrays but with larger input state
inputState: number[]  // Extended array based on controller type

// Controller-specific input mapping
{
  controllerType: string,   // "switch", "ps3", "wii", "xbox", etc.
  playerIndex: number,      // 0-7 (supports more players)
  inputIndex: number,       // Extended range based on controller
  value: number,            // Values vary by controller type
  frame: number
}
```

**Design Note:** Simple framework (EmulatorJS) uses fixed 30-input array. Complex framework (native emulators) uses variable-length arrays based on controller type. Both use primitive numbers only for portability.

## Phase 1: Create Core Structure

1. Create `data/src/netplay/` directory structure
2. Define `IEmulator` interface in TypeScript/JSDoc
3. Create stub implementations for core modules
