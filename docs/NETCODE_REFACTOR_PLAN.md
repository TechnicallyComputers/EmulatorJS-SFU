# Netcode Compartmentalization Plan

## Current State

- **Main file**: `data/src/emulator.js` (15,399 lines)
- **Netplay code**: Scattered throughout the file, deeply integrated with emulator class
- **Dependencies**: mediasoup-client, socket.io
- **State**: Stored in `this.netplay` object and various `this.netplay*` properties
- **Methods**: ~50+ netplay-related methods mixed with emulator logic

## Goals

1. **Readability**: Separate netplay concerns from core emulator logic
2. **Maintainability**: Easier to find, modify, and debug netplay code
3. **Shareability**: Create a portable netcode module that could work with other emulators
4. **Testability**: Isolated modules are easier to unit test
5. **Modularity**: Allow optional netplay loading (already partially done with `netplayEnabled`)

## Proposed Structure

### Phase 1: Extract Core Netplay Module

Create a new `NetplayManager` class that encapsulates all netplay functionality:

```
data/src/netplay/
├── NetplayManager.js          # Main netplay orchestrator
├── SFUClient.js               # SFU-specific WebRTC logic (mediasoup)
├── P2PClient.js               # P2P fallback logic (legacy)
├── InputHandler.js            # Input synchronization and state management
├── RoomManager.js             # Room joining/leaving, player management
├── StreamManager.js           # Video/audio stream handling
├── ConfigManager.js           # Netplay configuration and settings
└── utils/
    ├── codecUtils.js          # VP9/H264 codec helpers
    ├── inputUtils.js          # Input serialization/deserialization
    └── validationUtils.js     # Input validation, frame counting
```

### Phase 2: Integration Layer

Create a thin adapter that bridges the emulator and netplay modules:

```
data/src/netplay/
└── EmulatorAdapter.js        # Adapter between EmulatorJS and NetplayManager
```

This adapter:

- Translates emulator events to netplay events
- Provides emulator-specific callbacks
- Handles emulator state synchronization
- Manages the `this.netplay` object for backward compatibility

### Phase 3: Build System Updates

Modify the build process to:

- Bundle netplay modules separately (optional)
- Create a standalone netplay bundle for sharing
- Maintain backward compatibility with existing builds

## Detailed Module Breakdown

### 1. NetplayManager.js (Core Orchestrator)

**Responsibilities:**

- Initialize and coordinate all netplay subsystems
- Manage lifecycle (connect, disconnect, reconnect)
- Route events between subsystems
- Handle error recovery and fallback logic

**Key Methods:**

```javascript
class NetplayManager {
  constructor(emulatorAdapter, config)
  async connect()
  async disconnect()
  async joinRoom(roomName, password)
  async leaveRoom()
  async createRoom(roomName, password, maxPlayers)
  getState()
  isHost()
  isConnected()
}
```

**Dependencies:**

- EmulatorAdapter (for emulator callbacks)
- SFUClient or P2PClient
- RoomManager
- InputHandler
- StreamManager

### 2. SFUClient.js (SFU WebRTC Implementation)

**Responsibilities:**

- mediasoup-client integration
- WebRTC transport management
- Producer/consumer lifecycle
- Data channel management for inputs
- Codec negotiation (VP9 SVC, H264, VP8)

**Key Methods:**

```javascript
class SFUClient {
  constructor(config)
  async connect(socket, token)
  async createTransports()
  async createVideoProducer(stream)
  async createAudioProducer(stream)
  async createDataProducer(label, protocol)
  async consumeProducer(producerId)
  async consumeDataProducer(dataProducerId)
  getRtpCapabilities()
  disconnect()
}
```

**Dependencies:**

- mediasoup-client (UMD bundle)
- Socket.IO client

### 3. P2PClient.js (Legacy P2P Fallback)

**Responsibilities:**

- Peer-to-peer WebRTC connections
- ICE candidate exchange
- Direct peer connections (non-SFU)

**Key Methods:**

```javascript
class P2PClient {
  constructor(config)
  async connect(socket)
  async createPeerConnection(peerId)
  async handleOffer(offer, peerId)
  async handleAnswer(answer, peerId)
  async handleIceCandidate(candidate, peerId)
  disconnect()
}
```

**Note:** This may be deprecated if SFU becomes the only supported mode.

### 4. InputHandler.js (Input Synchronization)

**Responsibilities:**

- Input state management
- Frame counting and synchronization
- Input serialization/deserialization
- Input mode handling (ordered/unordered)
- Retry logic for lost inputs

**Key Methods:**

```javascript
class InputHandler {
  constructor(config, emulatorAdapter)
  sendInput(inputState, frame)
  receiveInput(inputState, frame, fromPlayerId)
  getCurrentFrame()
  setCurrentFrame(frame)
  reset()
  getInputMode() // 'ordered' | 'unordered'
}
```

**State:**

- Current frame counter
- Input queue/buffer
- Last received inputs per player
- Retry tracking

### 5. RoomManager.js (Room & Player Management)

**Responsibilities:**

- Socket.IO room operations
- Player list management
- Room discovery (list rooms)
- Player join/leave events
- Room metadata

**Key Methods:**

```javascript
class RoomManager {
  constructor(socket, config)
  async listRooms()
  async joinRoom(roomName, password, playerInfo)
  async createRoom(roomName, password, maxPlayers, playerInfo)
  async leaveRoom()
  getPlayers()
  getRoomInfo()
  onPlayerJoin(callback)
  onPlayerLeave(callback)
}
```

**Dependencies:**

- Socket.IO client

### 6. StreamManager.js (Media Stream Handling)

**Responsibilities:**

- Local stream capture (getUserMedia)
- Stream configuration (codec, resolution, bitrate)
- Stream lifecycle (start, stop, pause, resume)
- Canvas capture for video
- Audio track management

**Key Methods:**

```javascript
class StreamManager {
  constructor(config)
  async createLocalStream(canvas, audioContext)
  async stopLocalStream()
  pauseStream()
  resumeStream()
  getVideoTrack()
  getAudioTrack()
  updateStreamSettings(settings)
}
```

### 7. ConfigManager.js (Configuration)

**Responsibilities:**

- Netplay configuration parsing
- Settings persistence (localStorage)
- Default value management
- Configuration validation

**Key Methods:**

```javascript
class ConfigManager {
  constructor(emulatorInstance)
  loadConfig()
  getSetting(key)
  setSetting(key, value)
  getDefaults()
  validateConfig(config)
}
```

**Settings:**

- Simulcast enabled/disabled
- VP9 SVC mode
- Host codec preference
- Client quality settings
- Input mode
- Preferred player slot
- Retry timers

### 8. EmulatorAdapter.js (Integration Layer)

**Responsibilities:**

- Bridge between EmulatorJS and NetplayManager
- Translate emulator events to netplay events
- Provide emulator-specific implementations
- Maintain backward compatibility with `this.netplay`

**Key Methods:**

```javascript
class EmulatorAdapter {
  constructor(emulatorInstance)
  // Emulator callbacks
  onFrame(frameNumber)
  onInput(inputState)
  onPause()
  onResume()
  onSaveState(state)
  onLoadState(state)

  // Netplay callbacks
  simulateInput(inputState, playerId)
  updateVideoElement(videoElement)
  updateAudioElement(audioElement)
  displayMessage(message, duration)
  getCanvas()
  getAudioContext()
}
```

## Migration Strategy

### Step 1: Create Module Structure

1. Create `data/src/netplay/` directory
2. Set up basic module files with class skeletons
3. Add JSDoc comments for all public APIs

### Step 2: Extract SFU Logic First

1. Identify all SFU-related code in `emulator.js`
2. Move to `SFUClient.js`
3. Create adapter methods in `EmulatorAdapter`
4. Test SFU functionality

### Step 3: Extract Input Handling

1. Identify input-related code
2. Move to `InputHandler.js`
3. Update references in emulator
4. Test input synchronization

### Step 4: Extract Room Management

1. Move Socket.IO room logic to `RoomManager.js`
2. Update event handlers
3. Test room operations

### Step 5: Extract Stream Management

1. Move getUserMedia and stream code to `StreamManager.js`
2. Update video/audio handling
3. Test stream capture and playback

### Step 6: Create NetplayManager

1. Wire all modules together
2. Replace direct netplay calls in emulator with NetplayManager
3. Maintain `this.netplay` object for compatibility

### Step 7: Update Build System

1. Modify build.js to include netplay modules
2. Create optional standalone bundle
3. Test minified builds

## Backward Compatibility

To maintain compatibility with existing code:

1. **Keep `this.netplay` object**: Populate it from NetplayManager state
2. **Proxy methods**: Keep existing `netplay*` methods that delegate to NetplayManager
3. **Gradual migration**: Allow both old and new code paths during transition
4. **Feature flags**: Use flags to enable/disable new module system

Example compatibility layer:

```javascript
// In emulator.js constructor
if (this.netplayEnabled) {
  this._netplayManager = new NetplayManager(new EmulatorAdapter(this), config);
  // Populate this.netplay for backward compatibility
  this.netplay = this._netplayManager.getStateObject();
}

// Proxy old methods
netplayAttemptSFU() {
  return this._netplayManager.attemptSFU();
}
```

## Benefits

1. **Reduced file size**: Main emulator.js becomes ~10k lines instead of 15k+
2. **Clear separation**: Netplay code is isolated and easier to understand
3. **Reusability**: NetplayManager could be adapted for other emulators
4. **Testing**: Each module can be unit tested independently
5. **Documentation**: Each module can have focused documentation
6. **Collaboration**: Multiple developers can work on different modules
7. **Future features**: Easier to add rollback netcode, parallel rooms, etc.

## Challenges

1. **Tight coupling**: Netplay is deeply integrated with emulator state
2. **Circular dependencies**: Need careful design to avoid circular refs
3. **Event system**: Emulator's event system needs to work with modules
4. **State synchronization**: Keeping emulator and netplay state in sync
5. **Build complexity**: More modules = more build configuration

## Next Steps

1. **Review this plan** - Get feedback on structure and approach
2. **Create proof of concept** - Extract one small module (e.g., ConfigManager) to validate approach
3. **Set up module system** - Decide on module format (ES6, CommonJS, UMD)
4. **Create migration checklist** - Detailed steps for each phase
5. **Begin extraction** - Start with least-coupled modules first

## Questions to Resolve

1. **Module format**: ES6 modules, CommonJS, or UMD? (Currently using UMD for browser)
2. **Build tooling**: Keep current build.js or migrate to webpack/rollup?
3. **P2P support**: Keep P2P fallback or SFU-only?
4. **Testing strategy**: Unit tests, integration tests, or both?
5. **Documentation**: JSDoc, separate markdown files, or both?
