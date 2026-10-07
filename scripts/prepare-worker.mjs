import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { patchWorker } from "../patch-worker.mjs";
const source = await readFile(new URL("../src/Source.js", import.meta.url), "utf8");
const outDir = new URL("../.generated/", import.meta.url);
await mkdir(outDir, { recursive: true });
await writeFile(new URL("worker.js", outDir), patchWorker(source), "utf8");
console.log("Prepared .generated/worker.js");
