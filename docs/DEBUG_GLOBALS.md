# Debugging Global Assignments

## Issue

`window.NetplayEngine` and `window.EmulatorJSAdapter` are `undefined` in the browser.

## Diagnosis Steps

### 1. Verify Source Files Have Direct Assignments

Check source files end with:
```javascript
window.NetplayEngine = NetplayEngine;
window.EmulatorJSAdapter = EmulatorJSAdapter;
```

**NOT**:
```javascript
if (typeof window !== "undefined") {
  window.NetplayEngine = NetplayEngine;
}
```

### 2. Rebuild After Changes

After modifying source files, **always rebuild**:
```bash
cd EmulatorJS-SFU
node minify/minify.js
```

### 3. Check Minified Output

Verify assignments exist in minified file:
```bash
grep "window.NetplayEngine=" data/emulator.min.js
grep "window.EmulatorJSAdapter=" data/emulator.min.js
```

### 4. Verify No Conditional Wrappers

Check minified code doesn't have:
```javascript
typeof window&&(window.NetplayEngine=NetplayEngine)
```

Should be:
```javascript
window.NetplayEngine=NetplayEngine;
```

### 5. Browser Console Test

After rebuild and browser refresh (hard refresh: Ctrl+Shift+R):
```javascript
typeof window.NetplayEngine  // Should be "function" or "object", NOT "undefined"
window.NetplayEngine  // Should show class definition
```

## Common Issues

### Issue 1: Browser Cache

**Symptom**: Changes not reflected in browser

**Fix**: Hard refresh (Ctrl+Shift+R) or clear cache

### Issue 2: Minifier Not Rebuilding

**Symptom**: Source changed but minified file unchanged

**Fix**: 
- Check minify script output for errors
- Manually delete `data/emulator.min.js` and rebuild
- Check file timestamps: `ls -la data/emulator.min.js`

### Issue 3: Assignment Inside Closure

**Symptom**: Assignment exists but `window.ClassName` is undefined

**Fix**: Ensure assignment is at top level, not inside function/IIFE

### Issue 4: Terser Removing Code

**Symptom**: Assignment removed during minification

**Fix**: Check terser options - should NOT have `compress.drop_console` or aggressive dead code elimination

## Current Fix Applied

Changed from conditional:
```javascript
if (typeof window !== "undefined") {
  window.NetplayEngine = NetplayEngine;
}
```

To direct assignment:
```javascript
window.NetplayEngine = NetplayEngine;
```

**Reason**: Browser code always has `window`, and conditional may be optimized away or cause timing issues.

## Next Steps

1. Verify source files have direct assignments
2. Rebuild: `node minify/minify.js`
3. Hard refresh browser (Ctrl+Shift+R)
4. Check console: `typeof window.NetplayEngine`
5. If still undefined, check browser console for syntax errors
