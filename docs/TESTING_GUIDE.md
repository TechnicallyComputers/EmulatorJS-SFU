# Netplay Refactor - Testing Guide

## Quick Test Checklist

### 1. Verify Modules Are Loaded

Open browser console (F12) and check:

```javascript
// Check if classes are available
typeof window.NetplayEngine !== "undefined"; // Should be true
typeof window.EmulatorJSAdapter !== "undefined"; // Should be true

// Or check directly
window.NetplayEngine; // Should show class definition
window.EmulatorJSAdapter; // Should show class definition
```

### 2. Check for Initialization Messages

When netplay is initialized, you should see:

```
[EmulatorJS] NetplayEngine initialized successfully
[NetplayEngine] Initialized with all subsystems
```

### 3. Verify Integration Code Is Executing

If modules are loaded but not initializing:

- Check for console errors during `defineNetplayFunctions()`
- Look for: `[EmulatorJS] NetplayEngine integration failed`

### 4. Test Netplay Functionality

1. **Create Room**: Click "Create Room" - should use new RoomManager
2. **Join Room**: Join an existing room - should use new RoomManager
3. **Send Input**: Press buttons - should use new InputSync
4. **Frame Processing**: Check console for `[NetplayEngine]` messages during gameplay

### 5. Verify Fallback (If Modules Not Available)

If modules aren't loaded:

- Legacy code should still work
- No console errors
- Netplay functionality works as before

## Troubleshooting

### Modules Not Loading

**Symptom**: `typeof window.NetplayEngine === "undefined"`

**Possible causes**:

1. Minified file doesn't include netplay modules
2. Build failed (check build output)
3. Browser cached old version (hard refresh: Ctrl+Shift+R)

**Solution**:

```bash
# Rebuild
cd EmulatorJS-SFU
npm run minify

# Check minified file includes netplay code
grep "NetplayEngine" data/emulator.min.js | head -5
```

### Initialization Fails

**Symptom**: `[NetplayEngine] Initialization failed`

**Check**:

- Console errors (likely missing dependencies)
- Verify all classes are available:
  ```javascript
  window.ConfigManager;
  window.SessionState;
  window.InputSync;
  // etc.
  ```

### Frame Processing Not Working

**Symptom**: Inputs not syncing, no `[NetplayEngine]` messages

**Check**:

- `_netplayEngine` is created
- `processFrameInputs()` is being called
- Check `netplayInitModulePostMainLoop` is executing

## Expected Console Output

When working correctly, you should see:

```
[Minify] Including 27 source files
[Minify] Netplay modules: 19 files
...
[EmulatorJS] NetplayEngine initialized successfully
[NetplayEngine] Initialized with all subsystems
[SocketTransport] Socket.IO connected: <socket-id>
```

## Next Steps After Testing

Once testing confirms everything works:

1. Phase 6: Cleanup old netplay code from emulator.js
2. Remove legacy fallback code
3. Optimize and stabilize performance
