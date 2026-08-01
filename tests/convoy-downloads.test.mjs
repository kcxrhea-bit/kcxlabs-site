import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/components/sections/ConvoyDownloadsSection.tsx", import.meta.url), "utf8");

test("Convoy Downloads exposes only the verified hosted web destination", () => {
  assert.match(source, /https:\/\/convoy\.kcxlabs\.org/);
  assert.match(source, /Open Web App/);
  assert.doesNotMatch(source, /localhost|127\.0\.0\.1|expo\.dev\/tunnel/i);
});

test("Convoy native availability stays honest until artifacts exist", () => {
  assert.match(source, /Development Preview/);
  assert.match(source, /iPhone beta coming soon/);
  assert.match(source, /download and sideload the signed APK/);
  assert.match(source, /install TestFlight, open the invitation link, then install Convoy/);
  assert.doesNotMatch(source, /href=.*\.(?:apk|aab|ipa)/i);
  assert.doesNotMatch(source, /testflight\.apple\.com\/join/i);
});
