import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { analyzeScriptDependencies, inspectProject, resolveBuildCommands } = await import(new URL("../dist-electron/project-discovery.cjs", import.meta.url));
const { DistributionService, artifactKind, artifactMetadata, mergeElectronBuilderPackage, scriptDiagnostic } = await import(new URL("../dist-electron/distribution-service.cjs", import.meta.url));

function project(folder, name = "fixture") {
  return { id: "fixture-id", name, slug: "fixture", folder, description: "", category: "", currentVersion: "", releaseChannel: "stable", websiteVisible: true, downloadVisible: true, folderStatus: "available", createdAt: "2026-01-01T00:00:00.000Z" };
}

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
  const { conflicts, packageJson } = mergeElectronBuilderPackage({ scripts: { installer: "custom" }, build: { appId: "custom.app" } }, "X", "x", "1.0.0");
  assert.deepEqual(conflicts, ["scripts.installer"]);
  assert.equal(packageJson.build.appId, "custom.app");
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

test("resolves native package-manager commands from project evidence", () => {
  const commands = resolveBuildCommands("C:/fixture", { packageManager: "pnpm@9.1.0", scripts: { build: "vite build", installer: "electron-builder --win nsis" } }, "pnpm");
  assert.equal(commands.find((command) => command.intent === "web").command, "pnpm.cmd");
  assert.deepEqual(commands.find((command) => command.intent === "web").args, ["run", "build"]);
  assert.equal(commands.find((command) => command.intent === "installer").script, "installer");
});

test("classifies framework and Python/.NET evidence without project-name assumptions", async () => {
  const root = await mkdtemp(join(tmpdir(), "kcx-generic-fixture-"));
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "framework-fixture", packageManager: "yarn@4.0.0", scripts: { build: "next build" }, dependencies: { next: "1" } }));
    await writeFile(join(root, "next.config.mjs"), "export default {};\n");
    await writeFile(join(root, "pyproject.toml"), "[project]\nname='fixture'\n");
    await writeFile(join(root, "Example.csproj"), "<Project />\n");
    const found = await inspectProject(root);
    assert.ok(found.projectTypes.includes("web"));
    assert.ok(found.projectTypes.includes("python"));
    assert.ok(found.projectTypes.includes("dotnet"));
    assert.equal(found.packageManager, "yarn");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("non-Electron projects do not receive Electron-specific executable setup assumptions", async () => {
  const root = await mkdtemp(join(tmpdir(), "kcx-non-electron-"));
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture", scripts: { dist: "vite build" } }));
    const service = new DistributionService(root, join(root, ".user-data"));
    const plan = await service.preview(project(root), "executable");
    assert.equal(plan.supported, false);
    assert.equal(plan.readiness, "unsupported");
    assert.doesNotMatch(plan.message, /electron-builder|electron-forge|electron-packager/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("detected packaging architectures select their own executable candidates", async () => {
  const cases = [
    { name: "tauri", files: [["Cargo.toml", "[package]\nname='fixture'\n"], ["src-tauri/main.rs", "fn main() {}\n"]], command: "cargo.exe", backend: "tauri" },
    { name: "dotnet", files: [["Fixture.csproj", "<Project />\n"]], command: "dotnet.exe", backend: "dotnet" },
    { name: "pyinstaller", files: [["pyinstaller.spec", "# spec\n"], ["pyproject.toml", "[project]\nname='fixture'\n"]], command: "pyinstaller.exe", backend: "pyinstaller" },
  ];
  for (const candidate of cases) {
    const root = await mkdtemp(join(tmpdir(), `kcx-${candidate.name}-`));
    try {
      for (const [relative, contents] of candidate.files) { const path = join(root, relative); await mkdir(join(path, ".."), { recursive: true }); await writeFile(path, contents); }
      const service = new DistributionService(root, join(root, ".user-data"));
      const result = await service.preview(project(root), "executable");
      assert.equal(result.supported, true, candidate.name);
      assert.equal(result.command, candidate.command, candidate.name);
      assert.equal(result.commandSource, "detected-backend", candidate.name);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test("ambiguous Windows packaging fails closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "kcx-ambiguous-"));
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture", scripts: { dist: "some-tool --windows" } }));
    const plan = await new DistributionService(root, join(root, ".user-data")).preview(project(root), "installer");
    assert.equal(plan.supported, false);
    assert.equal(plan.readiness, "unsupported");
    assert.equal(plan.diagnostic.candidates.length, 0);
    assert.ok(plan.diagnostic.missingEvidence.length > 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("archive and runnable artifact identities remain typed and distinct", async () => {
  assert.equal(artifactKind("zip"), "project-archive");
  assert.equal(artifactKind("source"), "source-archive");
  assert.equal(artifactKind("executable"), "application-binary");
  assert.notEqual(artifactKind("zip"), artifactKind("executable"));
  const metadata = artifactMetadata(project("C:/fixture"), "source", "C:/staged/fixture-git-source.zip", "C:/staged/fixture-git-source.zip");
  assert.equal(metadata.kind, "source-archive");
  assert.equal(metadata.runnable, false);
  assert.equal(metadata.provenance, "git-archive");
});

test("unsupported Web plans expose structured evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "kcx-web-unsupported-"));
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture" }));
    const plan = await new DistributionService(root, join(root, ".user-data")).preview(project(root), "web");
    assert.equal(plan.readiness, "unsupported");
    assert.equal(plan.diagnostic.problemType, "UNSUPPORTED_PROJECT_STRUCTURE");
    assert.ok(plan.diagnostic.evidence.some((entry) => /build:web|build|compile/i.test(entry)));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("analyzes valid, nested, shared, missing, and circular local scripts", () => {
  const valid = analyzeScriptDependencies({ installer: "npm run package && electron-builder", package: "pnpm run build:main && pnpm build:renderer", "build:main": "tsc", "build:renderer": "vite build" }, "installer");
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.missing, []);
  assert.ok(valid.order.includes("build:main"));
  assert.deepEqual(valid.references.installer, ["package"]);

  const missing = analyzeScriptDependencies({ installer: "npm run build:electron && electron-builder" }, "installer");
  assert.equal(missing.valid, false);
  assert.deepEqual(missing.missing, ["build:electron"]);

  const circular = analyzeScriptDependencies({ installer: "npm run package", package: "yarn installer" }, "installer");
  assert.equal(circular.valid, false);
  assert.deepEqual(circular.cycles[0], ["installer", "package", "installer"]);

  const shared = analyzeScriptDependencies({ installer: "npm run common", executable: "pnpm run common", common: "bun run compile", compile: "vite build" }, "installer");
  assert.equal(shared.valid, true);
  assert.equal(shared.order.filter((name) => name === "common").length, 1);
});

test("external commands do not create false missing-script failures", () => {
  const result = analyzeScriptDependencies({ installer: "vite build && electron-builder --win nsis; cargo build" }, "installer");
  assert.equal(result.valid, true);
  assert.deepEqual(result.missing, []);
});

test("diagnosis exposes evidence and refuses ambiguous repairs", () => {
  const diagnostic = scriptDiagnostic("installer", { installer: "npm run build:electron && electron-builder", build: "vite build", compile: "tsc" }, "installer", "Missing local package script: build:electron", ["electron", "web"]);
  assert.equal(diagnostic.problemType, "MISSING_SCRIPT_DEPENDENCY");
  assert.deepEqual(diagnostic.dependencyChain, ["installer", "build:electron", "MISSING: build:electron"]);
  assert.equal(diagnostic.candidates.length, 2);
  assert.equal(diagnostic.candidates.some((candidate) => candidate.safeToApply), false);
  assert.ok(diagnostic.recommendedNextStep.includes("manually"));
});

test("blocked targets retain diagnosis visibility even without repair metadata", async () => {
  const ui = await readFile(new URL("../src/desktop/ArtifactPreparation.tsx", import.meta.url), "utf8");
  assert.match(ui, /target\.diagnostic \|\| \["blocked", "failed", "needs-setup"\]/);
  assert.match(ui, /No structured diagnosis was produced\./);
  assert.match(ui, /View diagnosis/);
  const wizard = await readFile(new URL("../src/desktop/WorkflowComponents.tsx", import.meta.url), "utf8");
  assert.match(wizard, /Artifact classification/);
});

test("Release Publisher preserves and displays typed artifact identity", async () => {
  const shared = await readFile(new URL("../src/shared/desktop.ts", import.meta.url), "utf8");
  const wizard = await readFile(new URL("../src/desktop/WorkflowComponents.tsx", import.meta.url), "utf8");
  assert.match(shared, /artifactMetadata\?: DistributionArtifactMetadata/);
  assert.match(wizard, /Unclassified artifact/);
  assert.match(wizard, /metadata\.kind/);
});
