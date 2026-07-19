import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const electron = require("electron");
const vite = join(dirname(require.resolve("vite/package.json")), "bin", "vite.js");
const children = [];

function terminateChildren() {
  for (const child of children) child.kill();
}

async function waitForWebsite(url, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Website development server did not start at ${url}.`);
}

async function findAvailablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a local development port.");
  const { port } = address;
  await new Promise((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())));
  return port;
}

const port = await findAvailablePort();
const websiteUrl = `http://127.0.0.1:${port}`;
const website = spawn(process.execPath, [vite, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  stdio: "inherit",
});
children.push(website);

try {
  const websiteStartupFailure = new Promise((_, reject) => {
    website.once("exit", (code) => reject(new Error(`Website development server stopped during startup (exit ${code ?? "unknown"}).`)));
  });
  await Promise.race([waitForWebsite(websiteUrl), websiteStartupFailure]);
  const build = spawn(process.execPath, ["scripts/build-electron.mjs"], {
    stdio: "inherit",
  });
  children.push(build);
  const buildExitCode = await new Promise((resolve) => build.once("exit", resolve));
  if (buildExitCode !== 0) throw new Error("Electron main/preload build failed.");

  const app = spawn(electron, ["."], {
    stdio: "inherit",
    env: { ...process.env, VITE_DEV_SERVER_URL: websiteUrl },
  });
  children.push(app);
  app.once("exit", (code) => {
    terminateChildren();
    process.exitCode = code ?? 0;
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  terminateChildren();
  process.exitCode = 1;
}

process.on("SIGINT", terminateChildren);
process.on("SIGTERM", terminateChildren);
