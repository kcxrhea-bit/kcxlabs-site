import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rawSource = await readFile(
  new URL("../src/components/sections/ConvoyBetaSection.tsx", import.meta.url),
  "utf8",
);

/**
 * Block comments are stripped before the URL assertions run.
 *
 * The forbidden-URL checks are about what the page can actually render. The
 * component's comments legitimately *name* the banned things in order to
 * explain why they are banned, and matching on those would either fail the
 * build or pressure someone into deleting the explanation to make a test pass.
 */
const source = rawSource.replace(/\/\*[\s\S]*?\*\//g, "");
const betaPage = await readFile(
  new URL("../src/components/pages/BetaPage.tsx", import.meta.url),
  "utf8",
);

test("Convoy beta section is mounted on the /beta page", () => {
  assert.match(betaPage, /import \{ ConvoyBetaSection \}/);
  assert.match(betaPage, /<ConvoyBetaSection \/>/);
});

test("the web app is the one real, active destination", () => {
  assert.match(source, /https:\/\/convoy\.kcxlabs\.org/);
  assert.match(source, /Open Convoy Web App/);
});

test("no development-only or temporary URL can reach the page", () => {
  // These are the addresses that die with a dev session. A published beta page
  // linking to any of them is broken for every visitor.
  assert.doesNotMatch(source, /localhost|127\.0\.0\.1/i);
  assert.doesNotMatch(source, /ngrok/i);
  assert.doesNotMatch(source, /exp:\/\/|\.exp\.direct|expo\.dev\/tunnel/i);
});

test("no fabricated native artifact is linked", () => {
  // An .aab cannot be installed by a user, and a bare .ipa cannot be installed
  // at all without matching provisioning. Neither may ever appear as an href.
  assert.doesNotMatch(source, /href=["'][^"']*\.(?:apk|aab|ipa)/i);
  assert.doesNotMatch(source, /testflight\.apple\.com\/join/i);
});

test("artifact availability is data-driven and defaults to unavailable", () => {
  // The guarantee is structural: with both constants null there is no code
  // path that renders an enabled native download button. Asserted against the
  // raw file because these are declarations, not prose.
  assert.match(rawSource, /const androidArtifact: AndroidArtifact \| null = null;/);
  assert.match(rawSource, /const iphoneArtifact: IphoneArtifact \| null = null;/);
});

test("unavailable native builds render disabled buttons with the agreed copy", () => {
  assert.match(source, /Android APK coming soon/);
  assert.match(source, /iPhone TestFlight coming soon/);
  // `disabled` plus aria-disabled so the state is conveyed to assistive tech,
  // not only visually.
  assert.match(source, /disabled\s+aria-disabled="true"/);
});

test("Android metadata rows required by the beta brief are present", () => {
  for (const label of ["Version", "File size", "SHA-256", "Requires"]) {
    assert.match(source, new RegExp(`>${label}</dt>`));
  }
  assert.match(source, /Android 7\.0 \(API 24\) or newer/);
  assert.match(source, /Sideload note/);
});

test("release notes and the web-vs-native distinction are explained", () => {
  assert.match(source, /Release notes/);
  assert.match(source, /Development Preview/);
  assert.match(source, /separate deployment from the native packages/);
});

test("Convoy beta acknowledges the original inspiration", () => {
  assert.match(source, /Original Inspiration/);
  assert.match(source, /Convoy was inspired by an original idea from Nicholas Jenkins\./);
});
