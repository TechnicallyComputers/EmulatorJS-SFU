import path from "path";
import { fileURLToPath } from "url";
import { minify } from "@node-minify/core";
import { terser } from "@node-minify/terser";
import { cleanCss } from "@node-minify/clean-css";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootPath = path.resolve(__dirname, "../");

const srcGlob = path.join(rootPath, "data/src/*.js");
const cssInput = path.join(rootPath, "data/emulator.css");

async function doMinify() {
  await minify({
    compressor: terser,
    input: srcGlob,
    output: path.join(rootPath, "data/emulator.min.js"),
  })
    .catch(function (err) {
      console.error(err);
    })
    .then(function () {
      console.log("Minified JS");
    });

  // Hybrid bundle is what loader.js/loader.hybrid.js loads by default.
  // Keep it in sync with the source scripts as well.
  await minify({
    compressor: terser,
    input: srcGlob,
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

  // Also generate root-level bundles for npm/CDN usage.
  await minify({
    compressor: terser,
    input: srcGlob,
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
    input: srcGlob,
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
