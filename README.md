# ZEUS Panel on Railway

This project runs the supplied Cloudflare Worker on Railway using Cloudflare's local `workerd` runtime through Miniflare. This keeps the original Worker APIs available (`cloudflare:sockets`, `WebSocketPair`, D1 API, Cache API, `ctx.waitUntil`, Web Crypto, Fetch/Streams) instead of rewriting the proxy core into a different networking stack.

## Deploy on Railway

1. Put this directory in a GitHub repository (or deploy it with the Railway CLI).
2. Create a Railway service from the repository and generate a public domain.
3. **Attach a Railway Volume** to the service. Recommended mount path: `/data`.
4. Add `PANEL_RECOVERY_TOKEN` as a long random secret. This is optional but strongly recommended so the panel's password-recovery screen remains usable without exposing a Railway account token.
5. Deploy. Railway supplies `PORT`; the app binds to `0.0.0.0:$PORT` automatically.
6. Open `https://<your-domain>/panel` and complete the initial panel password setup.

The local D1 database and Cache storage are persisted under the attached volume. If no volume is attached, the service still runs, but users/settings can be lost on redeploy/restart.

## What was adapted

- Cloudflare Worker runtime -> local `workerd`/Miniflare runtime inside Railway.
- D1 -> Miniflare's local D1 implementation, persisted on the Railway Volume.
- `cloudflare:sockets` -> remains native to `workerd`; no protocol-core rewrite is required.
- WebSocket upgrade / `WebSocketPair` -> remains Worker-native and Railway forwards WebSockets to the service.
- Client IP detection -> supports `CF-Connecting-IP`, `X-Forwarded-For`, and `X-Real-IP`.
- Panel password recovery -> accepts `PANEL_RECOVERY_TOKEN`; alternatively a Railway API token with access to the current service can be used.
- In-panel updater -> downloads the upstream Worker source, reapplies the Railway compatibility patch, writes it to the persistent volume, and hot-reloads the Worker. A backup is kept as `runtime/worker.js.bak`.
- Existing panel/API/subscription/status/PWA/proxy logic is retained.

## Important Railway networking difference

Railway exposes the HTTP service through its public domain, so client configurations should use the Railway hostname and the normal HTTPS/WSS public endpoint. Cloudflare-specific alternate edge ports (2053, 2083, 2087, 2096, 8443, etc.) are not separate public ports on a normal Railway HTTP service. The Worker logic can still generate configs, but for Railway the practical public WSS port is 443.

If you require a raw TCP public listener in addition to HTTP/WSS, configure Railway TCP Proxy separately; that is a different ingress mode from the Worker WebSocket endpoint.

## Updating

The panel's existing update button now talks to an internal Node control binding rather than the Cloudflare Workers deployment API. By default it downloads:

`https://raw.githubusercontent.com/panel-zeus/Z-E-U-S/refs/heads/main/zeus.obfuscated.js`

Override with `UPDATE_SOURCE_URL` if your source lives elsewhere. Because the patched runtime worker is stored on the Railway Volume, the updated version survives service restarts.

## Backup / restore

Back up the Railway Volume. It contains both the persisted D1 state and the currently active patched Worker source. For a clean reset, remove the Miniflare data on the volume and restart the service.
