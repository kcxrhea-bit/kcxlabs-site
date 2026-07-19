import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const platform = await readFile(new URL("../electron/platform-service.ts", import.meta.url), "utf8");
const main = await readFile(new URL("../electron/main.ts", import.meta.url), "utf8");
const catalog = JSON.parse(await readFile(new URL("../src/data/publishing-catalog.json", import.meta.url), "utf8"));
const { scanForProjects } = await import(new URL("../dist-electron/project-discovery.cjs", import.meta.url));
const { PlatformService } = await import(new URL("../dist-electron/platform-service.cjs", import.meta.url));

test("publishing requires an explicit native confirmation", () => {
  assert.match(main, /Publish release/);
  assert.match(main, /confirmation\.response === 1/);
});

test("theme synchronization creates backups and prevents escaped targets", () => {
  assert.match(platform, /\.kcx-theme-backups/);
  assert.match(platform, /Theme destination escaped the project folder/);
});

test("website preview and deployment readiness stay local and manual", () => {
  assert.match(platform, /startPreview/);
  assert.match(platform, /stopPreview/);
  assert.match(platform, /deployAllowed: false/);
});

test("website publishing catalog starts as valid structured metadata", () => {
  assert.equal(catalog.schemaVersion, 1);
  assert.ok(Array.isArray(catalog.products));
  assert.ok(Array.isArray(catalog.releases));
});

test("project discovery scans subfolders and excludes generated directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "kcx-labs-discovery-"));
  try {
    await mkdir(join(root, "app-one"), { recursive: true });
    await mkdir(join(root, "nested", "android-app"), { recursive: true });
    await mkdir(join(root, "node_modules", "ignored-app"), { recursive: true });
    await writeFile(join(root, "app-one", "package.json"), '{"name":"App One"}');
    await writeFile(join(root, "nested", "android-app", "build.gradle.kts"), "plugins {}");
    await writeFile(join(root, "node_modules", "ignored-app", "package.json"), '{"name":"Ignored"}');
    const found = await scanForProjects(root);
    assert.deepEqual(found.map((project) => project.name), ["App One", "android-app"]);
    assert.deepEqual(found[0].markers, ["package.json"]);
    assert.deepEqual(found[1].markers, ["build.gradle.kts"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("website changes require a preview and apply additions only after approval path", async () => {
  const root = await mkdtemp(join(tmpdir(), "kcx-labs-website-"));
  const userData = join(root, "user-data");
  try {
    await mkdir(join(root, "src", "data"), { recursive: true });
    await writeFile(join(root, "src", "data", "publishing-catalog.json"), JSON.stringify({ schemaVersion: 1, products: [], releases: [], categories: [], featuredProjectSlugs: [], archivedProjectSlugs: [] }));
    const service = new PlatformService(root, userData);
    const change = { additions: [{ name: "Scanned App", slug: "scanned-app", folder: join(root, "app"), description: "Candidate", category: "Discovered project", source: "scan" }], removalSlugs: [] };
    const preview = await service.previewWebsiteChange(change);
    assert.equal(preview.canApply, true);
    assert.equal((await service.getWebsiteProducts()).length, 0);
    const applied = await service.applyWebsiteChange(change);
    assert.equal(applied.ok, true);
    assert.equal((await service.getWebsiteProducts()).at(0)?.slug, "scanned-app");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("patch import stays separate from release artifacts and validates its extension", async () => {
  const root = await mkdtemp(join(tmpdir(), "kcx-labs-patch-"));
  try {
    await mkdir(join(root, "src", "data"), { recursive: true });
    await writeFile(join(root, "src", "data", "publishing-catalog.json"), JSON.stringify({ schemaVersion: 1, products: [], releases: [], categories: [], featuredProjectSlugs: [], archivedProjectSlugs: [] }));
    const patchPath = join(root, "fix.patch");
    await writeFile(patchPath, "diff --git a/a b/a\n");
    const service = new PlatformService(root, join(root, "user-data"));
    const project = { id: "project", name: "Project", slug: "project", folder: root, description: "", category: "", currentVersion: "0.0.0", releaseChannel: "stable", websiteVisible: true, downloadVisible: true, folderStatus: "available", createdAt: new Date().toISOString() };
    assert.equal((await service.previewPatch(project, patchPath)).isValid, true);
    assert.equal((await service.previewPatch(project, join(root, "not-a-patch.txt"))).isValid, false);
    const imported = await service.importPatch(project, patchPath);
    assert.equal(imported.ok, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
