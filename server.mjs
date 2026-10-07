import { Miniflare, Log, LogLevel } from "miniflare";
import { mkdir, readFile, writeFile, rename, copyFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { patchWorker } from "./patch-worker.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8787);
const dataRoot = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, ".railway-data");
const runtimeDir = path.join(dataRoot, "runtime");
const workerPath = path.join(runtimeDir, "worker.js");
const bundledSourcePath = path.join(__dirname, "src", "Source.js");
const updateSourceUrl = process.env.UPDATE_SOURCE_URL || "https://raw.githubusercontent.com/panel-zeus/Z-E-U-S/refs/heads/main/zeus.obfuscated.js";

await mkdir(runtimeDir, { recursive: true });

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function installBundledIfNeeded() {
  if (await fileExists(workerPath)) return;
  const source = await readFile(bundledSourcePath, "utf8");
  await writeFile(workerPath, patchWorker(source), "utf8");
}

await installBundledIfNeeded();

let mf;
let updateInProgress = false;

function bindings() {
  const keys = [
    "RAILWAY_API_TOKEN", "RAILWAY_PROJECT_ID", "RAILWAY_ENVIRONMENT_ID", "RAILWAY_SERVICE_ID",
    "RAILWAY_PUBLIC_DOMAIN", "RAILWAY_SERVICE_NAME", "PANEL_RECOVERY_TOKEN", "WORKER_NAME",
    "CF_API_TOKEN", "CF_ACCOUNT_ID"
  ];
  const out = { RUNTIME_PLATFORM: "railway" };
  for (const key of keys) if (process.env[key]) out[key] = process.env[key];
  return out;
}

async function control(request) {
  const u = new URL(request.url);
  if (u.pathname === "/health") return Response.json({ ok: true, platform: "railway" });
  if (u.pathname !== "/update" || request.method !== "POST") return new Response("Not Found", { status: 404 });
  if (updateInProgress) return Response.json({ error: "Update already in progress" }, { status: 409 });

  updateInProgress = true;
  try {
    const res = await fetch(updateSourceUrl, { headers: { "User-Agent": "Zeus-Railway-Updater/1.0", "Cache-Control": "no-cache" } });
    if (!res.ok) throw new Error(`Update source returned HTTP ${res.status}`);
    const upstream = await res.text();
    if (!upstream.includes("export default") || upstream.length < 50000) throw new Error("Downloaded source does not look valid");
    const patched = patchWorker(upstream);
    const tmp = workerPath + ".next";
    const backup = workerPath + ".bak";
    await writeFile(tmp, patched, "utf8");
    if (await fileExists(workerPath)) await copyFile(workerPath, backup);
    await rename(tmp, workerPath);

    const version = patched.match(/CURRENT_VERSION.*?['\"]([0-9]+\.[0-9]+\.[0-9]+)['\"]/i)?.[1] || null;
    setTimeout(async () => {
      try {
        await mf.setOptions(options());
        console.log(`[update] Worker reloaded${version ? ` to v${version}` : ""}.`);
      } catch (err) {
        console.error("[update] Reload failed:", err);
        try {
          if (await fileExists(backup)) {
            await copyFile(backup, workerPath);
            await mf.setOptions(options());
          }
        } catch (rollbackErr) {
          console.error("[update] Rollback failed:", rollbackErr);
        }
      } finally {
        updateInProgress = false;
      }
    }, 250);

    return Response.json({ success: true, version });
  } catch (err) {
    updateInProgress = false;
    return Response.json({ error: err?.message || String(err) }, { status: 500 });
  }
}

function options() {
  return {
    host: "0.0.0.0",
    port,
    modules: true,
    modulesRules: [{ type: "ESModule", include: ["**/*.js"], fallthrough: true }],
    scriptPath: workerPath,
    compatibilityDate: "2026-07-10",
    compatibilityFlags: ["nodejs_compat"],
    cf: false,
    bindings: bindings(),
    serviceBindings: { CONTROL: control },
    d1Databases: { DB: "00000000-0000-0000-0000-000000000001" },
    resourcePersistencePath: path.join(dataRoot, "miniflare"),
    cacheAPI: true,
    log: new Log(process.env.DEBUG === "1" ? LogLevel.DEBUG : LogLevel.INFO),
  };
}

mf = new Miniflare(options());
const ready = await mf.ready;
console.log(`[zeus-railway] listening on ${ready?.toString?.() || `0.0.0.0:${port}`}`);
console.log(`[zeus-railway] persistent data: ${dataRoot}`);

async function shutdown(signal) {
  console.log(`[zeus-railway] ${signal}; shutting down`);
  try { await mf.dispose(); } finally { process.exit(0); }
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
