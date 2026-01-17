# Debugging Container Mount Issues

## Problem

You're mounting `data/src/netplay/core` but the browser loads `data/emulator.min.js`, which is not in that mount path.

## Solution Options

### Option 1: Mount the entire `data/` directory (Recommended for Development)

In your docker-compose.yml, mount the entire EmulatorJS-SFU `data/` directory:

```yaml
volumes:
  - /path/to/EmulatorJS-SFU/data:/var/www/html/assets/emulatorjs-sfu/data
```

This ensures `emulator.min.js` and all source files are available.

### Option 2: Rebuild after building locally

1. Build locally: `cd EmulatorJS-SFU && node minify/minify.js`
2. Copy `data/emulator.min.js` into the container
3. Restart the container

### Option 3: Mount both directories

```yaml
volumes:
  - /path/to/EmulatorJS-SFU/data:/var/www/html/assets/emulatorjs-sfu/data
  - /path/to/EmulatorJS-SFU/data/src:/var/www/html/assets/emulatorjs-sfu/data/src
```

## Debugging Steps

1. **Check if `emulator.min.js` exists in container:**

   ```bash
   podman exec -it romm ls -la /var/www/html/assets/emulatorjs-sfu/data/emulator.min.js
   ```

2. **Check file size (should be ~559KB):**

   ```bash
   podman exec -it romm ls -lh /var/www/html/assets/emulatorjs-sfu/data/emulator.min.js
   ```

3. **Check if NetplayEngine is in the minified file:**

   ```bash
   podman exec -it romm grep -o "window.NetplayEngine=" /var/www/html/assets/emulatorjs-sfu/data/emulator.min.js | head -1
   ```

4. **Check browser console for debug messages:**
   - Look for: `[EmulatorJS] defineNetplayFunctions() called`
   - Look for: `[EmulatorJS] NetplayEngineClass: AVAILABLE/UNDEFINED`
   - Look for: `[EmulatorJS] ✅ NetplayEngine classes available` or `⚠️ NOT available`

## What the Debug Logging Shows

The integration code now logs:

- When `defineNetplayFunctions()` is called
- Whether `NetplayEngineClass` is found
- Whether `EmulatorJSAdapterClass` is found
- Whether `window.NetplayEngine` is available
- Which code path is taken (new system vs legacy)

This will help identify if:

- The function is being called
- The classes are undefined (file not loaded or not built correctly)
- The integration is working (new system) or falling back (legacy)
