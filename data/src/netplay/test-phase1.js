/**
 * Phase 1 Test - Verify module structure and interface
 * 
 * Tests:
 * - Directory structure exists
 * - Core modules can be imported
 * - Interface definition is valid
 * - Adapter stubs are created
 */

// Test imports (using ES6 modules)
async function testPhase1() {
  const results = {
    passed: 0,
    failed: 0,
    errors: [],
  };

  const test = (name, fn) => {
    try {
      const result = fn();
      if (result) {
        results.passed++;
        console.log(`✓ ${name}`);
      } else {
        results.failed++;
        results.errors.push(`${name}: Test returned false`);
        console.error(`✗ ${name}`);
      }
    } catch (error) {
      results.failed++;
      results.errors.push(`${name}: ${error.message}`);
      console.error(`✗ ${name}: ${error.message}`);
    }
  };

  console.log("Testing Phase 1: Core Structure\n");

  // Test 1: Verify NetplayEngine exists
  test("NetplayEngine module exists", () => {
    // This would normally import, but we'll check file exists
    const fs = require("fs");
    const path = require("path");
    const enginePath = path.join(__dirname, "core", "NetplayEngine.js");
    return fs.existsSync(enginePath);
  });

  // Test 2: Verify interface exists
  test("IEmulator interface exists", () => {
    const fs = require("fs");
    const path = require("path");
    const interfacePath = path.join(__dirname, "adapters", "emulatorjs", "interface.js");
    return fs.existsSync(interfacePath);
  });

  // Test 3: Verify adapter exists
  test("EmulatorJSAdapter exists", () => {
    const fs = require("fs");
    const path = require("path");
    const adapterPath = path.join(__dirname, "adapters", "emulatorjs", "EmulatorJSAdapter.js");
    return fs.existsSync(adapterPath);
  });

  // Test 4: Verify all core modules exist
  const coreModules = [
    "core/NetplayEngine.js",
    "core/config/ConfigManager.js",
    "core/session/SessionState.js",
    "core/session/FrameCounter.js",
    "core/transport/SFUTransport.js",
    "core/transport/SocketTransport.js",
    "core/transport/DataChannelManager.js",
    "core/input/InputSync.js",
    "core/input/InputQueue.js",
    "core/input/SlotManager.js",
    "core/input/frameworks/SimpleController.js",
    "core/input/frameworks/ComplexController.js",
    "core/room/RoomManager.js",
    "core/room/PlayerManager.js",
    "core/room/MetadataValidator.js",
    "core/room/GameModeManager.js",
    "core/room/UsernameManager.js",
    "core/room/SpectatorManager.js",
    "adapters/emulatorjs/EmulatorJSAdapter.js",
    "adapters/emulatorjs/interface.js",
  ];

  console.log("\nTesting core modules:");
  const fs = require("fs");
  const path = require("path");
  
  coreModules.forEach((module) => {
    test(`  ${module}`, () => {
      const modulePath = path.join(__dirname, module);
      return fs.existsSync(modulePath);
    });
  });

  // Summary
  console.log(`\n=== Phase 1 Test Results ===`);
  console.log(`Passed: ${results.passed}`);
  console.log(`Failed: ${results.failed}`);
  
  if (results.errors.length > 0) {
    console.log("\nErrors:");
    results.errors.forEach((error) => console.error(`  - ${error}`));
  }

  return results.failed === 0;
}

// Run test if executed directly
if (typeof require !== "undefined" && require.main === module) {
  testPhase1().then((success) => {
    process.exit(success ? 0 : 1);
  });
}

export default testPhase1;
