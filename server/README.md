Mediasoup SFU server for EmulatorJS

Quick start

1. Install dependencies

```bash
cd server
npm install
```

2. Run server

```bash
npm start
```

This server exposes socket.io handlers used by the client to:

- check SFU availability: `sfu-available`
- get router RTP capabilities: `sfu-get-router-rtp-capabilities`
- create/connect transports: `sfu-create-transport`, `sfu-connect-transport`
- produce/consume media: `sfu-produce`, `sfu-consume`, `sfu-get-producers`

Notes

- This is a minimal example for development/testing. For production you should configure
  proper `listenIps`/announced IPs, secure websockets, and TURN servers if needed.
