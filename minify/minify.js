import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { minify } from "@node-minify/core";
import { terser } from "@node-minify/terser";
import { cleanCss } from "@node-minify/clean-css";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootPath = path.resolve(__dirname, "../");

const cssInput = path.join(rootPath, "data/emulator.css");

/**
 * Get all JavaScript files to include in build, in dependency order.
 * Ensures netplay modules are included and ordered correctly.
 */
function getSourceFiles() {
  const srcDir = path.join(rootPath, "data/src");
  
  // Core modules first (dependencies)
  const coreFiles = [
    // Input frameworks (no dependencies)
    "netplay/core/input/frameworks/SimpleController.js",
    "netplay/core/input/frameworks/ComplexController.js",
    
    // Input modules
    "netplay/core/input/InputQueue.js",
    "netplay/core/input/SlotManager.js",
    "netplay/core/input/InputSync.js",
    
    // Session modules
    "netplay/core/session/FrameCounter.js",
    "netplay/core/session/SessionState.js",
    
    // Config
    "netplay/core/config/ConfigManager.js",
    
    // Room modules (depend on config, session)
    "netplay/core/room/GameModeManager.js",
    "netplay/core/room/UsernameManager.js",
    "netplay/core/room/MetadataValidator.js",
    "netplay/core/room/SpectatorManager.js",
    "netplay/core/room/PlayerManager.js",
    "netplay/core/room/RoomManager.js",
    
    // Transport modules
    "netplay/core/transport/SocketTransport.js",
    "netplay/core/transport/DataChannelManager.js",
    "netplay/core/transport/SFUTransport.js",
    
    // Core engine (depends on all above)
    "netplay/core/NetplayEngine.js",
    
    // Adapter (depends on core)
    "netplay/adapters/emulatorjs/EmulatorJSAdapter.js",
  ];
  
  // Top-level files (existing structure)
  const topLevelFiles = fs.readdirSync(srcDir)
    .filter(file => file.endsWith(".js") && !file.startsWith("."))
    .map(file => file);
  
  // Build full paths for netplay modules
  const netplayFiles = coreFiles
    .map(file => path.join(srcDir, file))
    .filter(filePath => fs.existsSync(filePath));
  
  // Combine: netplay modules first, then top-level files
  // Top-level files maintain their original order (important for emulator.js dependencies)
  const allFiles = [...netplayFiles, ...topLevelFiles.map(f => path.join(srcDir, f))];
  
  // Filter to only existing files
  return allFiles.filter(filePath => fs.existsSync(filePath));
}

async function doMinify() {
  const sourceFiles = getSourceFiles();
  console.log(`[Minify] Including ${sourceFiles.length} source files`);
  console.log(`[Minify] Netplay modules: ${sourceFiles.filter(f => f.includes('netplay')).length} files`);
  
  // Minify with terser - it handles ES6 modules
  // Note: Modules will need to be loaded as globals (via window assignments or script tags)
  const terserOptions = {
    compress: {
      drop_console: false, // Keep console for debugging
    },
    format: {
      comments: false,
    },
    ecma: 2020, // Support ES6+ features
  };

  await minify({
    compressor: terser,
    compressorOptions: terserOptions,
    input: sourceFiles,
    output: path.join(rootPath, "data/emulator.min.js"),
  })
    .catch(function (err) {
      console.error(err);
    })
    .then(function () {
      console.log("Minified JS");
    });

  // Hybrid bundle
  await minify({
    compressor: terser,
    compressorOptions: terserOptions,
    input: sourceFiles,
    output: path.join(rootPath, "data/emulator.hybrid.min.js"),
  })
    .catch(function (err) {
      console.error(err);
    })
    .then(function () {
      console.log("Minified Hybrid JS");
    });

  await minify({
    compressor: cleanCss,
    input: cssInput,
    output: path.join(rootPath, "data/emulator.min.css"),
  })
    .catch(function (err) {
      console.error(err);
    })
    .then(function () {
      console.log("Minified CSS");
    });

  // Root-level bundles for npm/CDN usage
  await minify({
    compressor: terser,
    compressorOptions: terserOptions,
    input: sourceFiles,
    output: path.join(rootPath, "emulator.min.js"),
  })
    .catch(function (err) {
      console.error(err);
    })
    .then(function () {
      console.log("Minified Root JS");
    });

  await minify({
    compressor: terser,
    compressorOptions: terserOptions,
    input: sourceFiles,
    output: path.join(rootPath, "emulator.hybrid.min.js"),
  })
    .catch(function (err) {
      console.error(err);
    })
    .then(function () {
      console.log("Minified Root Hybrid JS");
    });

  await minify({
    compressor: cleanCss,
    input: cssInput,
    output: path.join(rootPath, "emulator.min.css"),
  })
    .catch(function (err) {
      console.error(err);
    })
    .then(function () {
      console.log("Minified Root CSS");
    });
}

console.log("Minifying");
await doMinify();
console.log("Minifying Done!");
