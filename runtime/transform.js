export function transformWorkerSource(source, socketModuleUrl) {
  let out = source.replace(/\r\n/g, "\n").replace(/^import\s+\{\s*connect\s*\}\s+from\s+["']cloudflare:sockets["'];?/m,
    `import { connect, md5Digest } from ${JSON.stringify(socketModuleUrl)};`);

  out = out.replace('const digest = await crypto.subtle.digest("MD5", data);', 'const digest = await md5Digest(data);');

  const wsBlock = `\tconst socketPair = new WebSocketPair();\n\tconst [clientSock, serverSock] = Object.values(socketPair);\n\tserverSock.accept();\n\tserverSock.binaryType = "arraybuffer";`;
  const wsReplacement = `\tconst serverSock = request && request.__renderWebSocket;\n\tconst clientSock = serverSock;\n\tif (!serverSock) return new Response("WebSocket upgrade required", { status: 426 });\n\tserverSock.binaryType = "arraybuffer";`;
  if (!out.includes(wsBlock)) throw new Error('WebSocketPair block not found; upstream source format changed');
  out = out.replace(wsBlock, wsReplacement);

  out = out.replaceAll('new Response(null, { status: 101, webSocket: clientSock })', 'new Response(null, { status: 204 })');

  // Render exposes one public HTTP(S) endpoint. Advertise its external TLS port by default.
  out = out.replaceAll(
    'const ports = String(user.port || "443").split(",").map((p) => p.trim()).filter((p) => p.length > 0);',
    'const ports = globalThis.__RENDER_PUBLIC_PORT ? [String(globalThis.__RENDER_PUBLIC_PORT)] : String(user.port || "443").split(",").map((p) => p.trim()).filter((p) => p.length > 0);'
  );

  // Cloudflare edge IP rotation only works when the Render custom domain is itself proxied by Cloudflare.
  out = out.replaceAll(
    'if (user.auto_rotate_ip === 1) {',
    'if ((!globalThis.__RENDER_MODE || globalThis.__RENDER_ALLOW_EDGE_IPS) && user.auto_rotate_ip === 1) {'
  );
  out = out.replaceAll(
    'if (ips.length === 1 && ips[0] === host && user.ips && _AI_BLOCKER.length > 0) {',
    'if ((!globalThis.__RENDER_MODE || globalThis.__RENDER_ALLOW_EDGE_IPS) && ips.length === 1 && ips[0] === host && user.ips && _AI_BLOCKER.length > 0) {'
  );
  out = out.replaceAll(
    'if (ips.length === 1 && ips[0] === host && user.ips) {',
    'if ((!globalThis.__RENDER_MODE || globalThis.__RENDER_ALLOW_EDGE_IPS) && ips.length === 1 && ips[0] === host && user.ips) {'
  );

  const usageNeedle = 'async function getCfUsage(env) {\n\tif (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) return { today: 0, total: 0, d1Reads: 0, d1Writes: 0 };';
  const usageReplacement = 'async function getCfUsage(env) {\n\tif (env.RUNTIME === "render") return { today: 0, total: 0, d1Reads: env.DB?.metrics?.reads || 0, d1Writes: env.DB?.metrics?.writes || 0 };\n\tif (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) return { today: 0, total: 0, d1Reads: 0, d1Writes: 0 };';
  if (out.includes(usageNeedle)) out = out.replace(usageNeedle, usageReplacement);

  return out;
}
