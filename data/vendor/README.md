# mediasoup-client browser UMD

This folder should contain a browser-compatible UMD build of `mediasoup-client`
that sets `window.mediasoupClient`. The client code in this repo checks
for `window.mediasoupClient` before enabling SFU features.

How to obtain a browser build

- If you build `mediasoup-client` from source, produce a UMD bundle that
  exposes `window.mediasoupClient`.
- Alternatively, obtain a prebuilt browser bundle from a trusted CDN or
  build distribution. Place the file here and name it `mediasoup-client-umd.js`.

Notes

- A placeholder file is provided (`mediasoup-client-umd.js`) so the page
  won't throw a runtime error. Replace the placeholder with the real
  browser build to enable SFU media (send/receive via mediasoup).
