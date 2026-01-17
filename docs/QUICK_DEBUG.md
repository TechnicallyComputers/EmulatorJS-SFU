# Quick Debugging Checklist

## Issue: New netplay code not being called

Since you're mounting the entire EmulatorJS-SFU directory, the file should be available. The issue is likely:

1. **Minified file not rebuilt** after adding debug logging
2. **Browser cache** - needs hard refresh
3. **Timing issue** - classes assigned after integration code runs

## Quick Test Steps

### 1. Verify minified file is up to date

Check if `emulator.min.js` has the latest changes:

```bash
cd /home/alex/Documents/GitHub/EmulatorJS-SFU
ls -lh data/emulator.min.js  # Should be ~559KB, recently modified
```

### 2. Rebuild if needed

```bash
cd /home/alex/Documents/GitHub/EmulatorJS-SFU
node minify/minify.js
```

### 3. Check browser console

After hard refresh (Ctrl+Shift+R), you should see:

**If working:**
```
[EmulatorJS] defineNetplayFunctions() called
[EmulatorJS] NetplayEngineClass: AVAILABLE
[EmulatorJS] EmulatorJSAdapterClass: AVAILABLE
[EmulatorJS] ✅ NetplayEngine classes available - initializing new netplay system
[EmulatorJS] NetplayEngine initialized successfully
[NetplayEngine] Initialized with all subsystems
```

**If NOT working:**
```
[EmulatorJS] defineNetplayFunctions() called
[EmulatorJS] NetplayEngineClass: UNDEFINED
[EmulatorJS] EmulatorJSAdapterClass: UNDEFINED
[EmulatorJS] window.NetplayEngine: UNDEFINED
[EmulatorJS] window.EmulatorJSAdapter: UNDEFINED
[EmulatorJS] ⚠️ NetplayEngine classes NOT available - using legacy netplay code
```

### 4. Check if file is loaded in browser

Open browser dev tools → Network tab → Filter by "emulator.min.js":
- Status should be 200
- Size should be ~559KB
- Check "Response" tab to see if `window.NetplayEngine` is in the file

### 5. Test in console

After page loads, type in browser console:
```javascript
typeof window.NetplayEngine  // Should be "function" not "undefined"
typeof window.EmulatorJSAdapter  // Should be "function" not "undefined"
```

## Common Issues

### Issue: Debug messages not appearing
- **Cause**: Function not being called or file not loaded
- **Fix**: Check Network tab, hard refresh (Ctrl+Shift+R)

### Issue: Classes are UNDEFINED
- **Cause**: Minified file doesn't include netplay modules or global assignments
- **Fix**: Rebuild minified file: `node minify/minify.js`

### Issue: Classes are AVAILABLE but integration fails
- **Cause**: Error in NetplayEngine.initialize() or dependency missing
- **Fix**: Check console for error messages after "✅ NetplayEngine classes available"
