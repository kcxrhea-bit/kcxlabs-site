import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { inspectProject } = await import(new URL("../dist-electron/project-discovery.cjs", import.meta.url));
const { mergeElectronBuilderPackage } = await import(new URL("../dist-electron/distribution-service.cjs", import.meta.url));

test("Electron setup merges package metadata without deleting scripts or dependencies", () => {
  const existing = { name: "x", custom: { keep: true }, dependencies: { react: "1" }, devDependencies: { electron: "1", vite: "1", custom: "1" }, scripts: { dev: "x", build: "y", custom: "z" } };
  const { packageJson, conflicts } = mergeElectronBuilderPackage(existing, "X", "x", "43.1.1");
  assert.deepEqual(conflicts, []);
  assert.deepEqual(packageJson.custom, existing.custom);
  assert.deepEqual(packageJson.dependencies, existing.dependencies);
  assert.equal(packageJson.devDependencies.custom, "1");
  assert.equal(packageJson.scripts.dev, "x");
  assert.equal(packageJson.scripts["package:win"], "npm run build:electron && electron-builder --win portable");
  assert.equal(packageJson.build.files.includes("dist-electron/**/*"), true);
});

test("Electron setup reports conflicting existing packaging fields", () => {
  const { conflicts } = mergeElectronBuilderPackage({ scripts: { installer: "custom" }, build: { appId: "custom.app" } }, "X", "x", "1.0.0");
  assert.deepEqual(conflicts, ["scripts.installer", "build.appId"]);
});

test("inspects multi-target repos and detects package manager without mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "kcx-discovery-"));
  try {
    await mkdir(join(root, "apps", "android", "android"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "multi", dependencies: { electron: "1", vite: "1", react: "1" } }));
    await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    await writeFile(join(root, "vite.config.ts"), "export default {};");
    await writeFile(join(root, "apps", "android", "capacitor.config.ts"), "export default {};");
    await writeFile(join(root, "apps", "android", "android", "gradlew.bat"), "@echo off\n");
    const before = await readFile(join(root, "package.json"), "utf8");
    const found = await inspectProject(root);
    assert.deepEqual(found.projectTypes, ["electron", "web", "android", "capacitor"]);
    assert.equal(found.packageManager, "pnpm");
    assert.deepEqual(found.backends, ["gradle"]);
    assert.equal(await readFile(join(root, "package.json"), "utf8"), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("preserves the existing Electron backend instead of recommending another", async () => {
  const root = await mkdtemp(join(tmpdir(), "kcx-backend-"));
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "forge-app", devDependencies: { electron: "1", "@electron-forge/cli": "1" } }));
    await writeFile(join(root, "forge.config.js"), "module.exports = {};");
    const found = await inspectProject(root);
    assert.ok(found.projectTypes.includes("electron"));
    assert.deepEqual(found.backends, ["electron-forge"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
