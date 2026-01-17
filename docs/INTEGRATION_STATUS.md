# Netplay Refactor - Integration Status

## Phase 5 Integration Summary

Phase 5 integration hooks have been added to `emulator.js`. The integration is designed to:

1. **Gracefully fallback** - If NetplayEngine modules are not available, it uses legacy code
2. **Backward compatible** - All existing `this.netplay` API methods are proxied
3. **Progressive enhancement** - New features work when modules are available

## Integration Points

### 1. NetplayEngine Initialization (`defineNetplayFunctions()`)

Added at the start of `defineNetplayFunctions()`:

- Creates `EmulatorJSAdapter` instance
- Creates `NetplayEngine` with configuration
- Initializes engine asynchronously (non-blocking)
- Populates `this.netplay` with state from engine

### 2. Frame Processing (`netplayInitModulePostMainLoop`)

Modified to:

- Try `NetplayEngine.processFrameInputs()` first (if available)
- Fallback to legacy frame processing if engine not ready

### 3. Proxy Methods (`this.netplay.*`)

All `this.netplay` methods are proxied:

- `openRoom()` - Uses `RoomManager.createRoom()` if available
- `joinRoom()` - Uses `RoomManager.joinRoom()` if available
- `leaveRoom()` - Uses `RoomManager.leaveRoom()` if available
- `sendMessage()` - Uses `SocketTransport.sendDataMessage()` if available

## Module Loading Requirements

For NetplayEngine to work, the following modules must be available as global classes:

- `NetplayEngine` (from `core/NetplayEngine.js`)
- `EmulatorJSAdapter` (from `adapters/emulatorjs/EmulatorJSAdapter.js`)

Plus all their dependencies:

- SocketTransport, SFUTransport, DataChannelManager
- InputSync, InputQueue, SlotManager
- RoomManager, PlayerManager, etc.

## Build System Note

The minify script currently uses `data/src/*.js` which only matches top-level files. To include netplay modules, either:

1. Update minify glob to `data/src/**/*.js` (recursive)
2. Or concatenate netplay modules separately before minification
3. Or use a bundler that handles ES6 modules properly

## Current Status

✅ **Integration code added** - Hooks are in place
⏳ **Module loading** - Needs build system update to include netplay modules
⏳ **Testing** - Pending module availability

## Next Steps

1. Update build system to include netplay modules
2. Test initialization and frame processing
3. Verify backward compatibility
4. Complete Phase 6 (cleanup of old code)

## Backward Compatibility

All legacy netplay code remains in place. The integration:

- Checks if NetplayEngine is available before using it
- Falls back to legacy code if modules aren't loaded
- Maintains all existing `this.netplay` API methods

This ensures existing code continues to work during the transition period.
