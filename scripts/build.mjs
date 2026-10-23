import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const command = process.platform === "win32" ? "node_modules/.bin/vite.cmd" : "node_modules/.bin/vite";
let result;
try {
  result = spawnSync(command, ["build"], {
    env: { ...process.env, WRANGLER_WRITE_LOGS: "false" },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
} finally {
  // Cloudflare Vite may copy local development secrets into the preview bundle.
  // They are runtime-only and must never remain in a deploy artifact.
  await rm(resolve("dist/worker/.dev.vars"), { force: true });
}

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
