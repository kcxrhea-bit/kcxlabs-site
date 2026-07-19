import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const platform = await readFile(new URL("../electron/platform-service.ts", import.meta.url), "utf8");
const main = await readFile(new URL("../electron/main.ts", import.meta.url), "utf8");
const catalog = JSON.parse(await readFile(new URL("../src/data/publishing-catalog.json", import.meta.url), "utf8"));

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
  assert.deepEqual(catalog.products, []);
  assert.deepEqual(catalog.releases, []);
});
