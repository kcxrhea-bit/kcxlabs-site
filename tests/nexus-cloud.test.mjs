import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { build } from "esbuild";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");

const app = await read("src/App.tsx");
const routes = await read("src/routes.ts");
const config = await read("src/cloud/config.ts");
const data = await read("src/data/nexus-cloud.ts");
const productPage = await read("src/components/pages/NexusCloudPage.tsx");
const portalPage = await read("src/components/pages/NexusCloudPortalPage.tsx");
const vercelConfig = JSON.parse(await read("vercel.json"));

/**
 * Compile the cloud module so configuration defaults can be asserted for real
 * rather than by reading source. `import.meta.env` is defined as an empty
 * object, which reproduces a build with no VITE_* variables set at all.
 */
async function loadCloudModule() {
  const outfile = join(tmpdir(), `kcx-nexus-cloud-${process.pid}.cjs`);
  await build({
    entryPoints: [new URL("../src/cloud/index.ts", import.meta.url).pathname.replace(/^\//, "")],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node22",
    define: { "import.meta.env": "{}" },
    outfile,
    logLevel: "silent",
  });
  const module = await import(`file://${outfile}`);
  await rm(outfile, { force: true });
  return module;
}

const cloud = await loadCloudModule();

// ---------------------------------------------------------------- routing

test("public routes resolve for nexus cloud, portal, and beta", () => {
  assert.equal(cloud === undefined, false);
  assert.match(routes, /case "\/nexus-cloud":/);
  assert.match(routes, /case "\/nexus-cloud\/portal":/);
  assert.match(routes, /case "\/beta":/);
});

test("unknown paths still fall back to the homepage", () => {
  assert.match(routes, /default:\s*\n\s*return "home";/);
});

test("App renders each public route and keeps the Electron switch first", () => {
  assert.match(app, /if \(window\.kcxDesktop\) \{\s*\n\s*return <DesktopApp \/>;/);
  assert.match(app, /<BetaPage \/>/);
  assert.match(app, /<NexusCloudPage \/>/);
  assert.match(app, /<NexusCloudPortalPage \/>/);
});

test("nested portal assets are rewritten so deep links load the bundle", () => {
  const sources = vercelConfig.rewrites.map((rule) => rule.source);
  assert.ok(sources.includes("/nexus-cloud/assets/(.*)"));
  // The SPA catch-all must remain, and must remain last.
  assert.equal(vercelConfig.rewrites.at(-1).source, "/(.*)");
  assert.equal(vercelConfig.rewrites.at(-1).destination, "/index.html");
});

// ------------------------------------------------------------ truthfulness

test("Local Mode is described as available", () => {
  const local = cloud.nexusCloudStatusValues;
  assert.ok(Array.isArray(local));
  assert.match(data, /name: "Local Mode",\s*\n\s*badge: "Available Today",\s*\n\s*state: "verified"/);
  assert.match(productPage, /Local Mode Available/);
});

test("Cloud and Hybrid modes are never presented as available", () => {
  assert.match(data, /name: "Cloud Mode",\s*\n\s*badge: "In Development",\s*\n\s*state: "in-development"/);
  assert.match(data, /name: "Automatic Hybrid Mode",\s*\n\s*badge: "Planned",\s*\n\s*state: "planned"/);
  assert.match(data, /Cloud Mode is not yet active\./);
  assert.doesNotMatch(productPage, /Cloud Mode Available|Hybrid Mode Available|cloud is now live/i);
});

test("the portal states plainly that it is not connected to a backend", () => {
  assert.match(
    portalPage,
    /Cloud services are currently under development\./,
  );
  assert.match(portalPage, /does not connect to a production\s*\n?\s*cloud backend/);
  assert.match(portalPage, /Preview \/ Not Yet Available/);
});

test("the portal shows no fabricated devices, projects, usage, or sessions", () => {
  // Guards against a later edit adding invented operational data.
  assert.doesNotMatch(portalPage, /activeUsers|activeDevices|lastSync|uptime|requestsToday/i);
  assert.doesNotMatch(portalPage, /\b\d+\s*(devices?|projects?|sessions?|users?)\b/i);
  assert.doesNotMatch(portalPage, /\b\d+(\.\d+)?%/);
});

test("roadmap marks only verified work as verified and publishes no dates", () => {
  assert.match(data, /name: "Local Android Companion",\s*\n\s*state: "verified"/);
  assert.match(data, /name: "Website Foundation",\s*\n\s*state: "current"/);
  assert.match(data, /name: "General Cloud Chat",\s*\n\s*state: "planned"/);
  // No calendar dates anywhere in the roadmap content.
  assert.doesNotMatch(data, /\b(Q[1-4]\s*20\d\d|20\d\d-\d\d-\d\d)\b/);
});

// --------------------------------------------------------- configuration

test("configuration loads with no environment variables present", () => {
  const resolved = cloud.readNexusCloudConfig();
  assert.equal(resolved.status, "preview");
  assert.equal(resolved.previewVisible, true);
  assert.equal(resolved.portalPreviewVisible, true);
  assert.equal(resolved.apiBaseUrl, null);
});

test("cloud chat, sync, and device sync all default to disabled", () => {
  const resolved = cloud.readNexusCloudConfig();
  assert.equal(resolved.cloudChatEnabled, false);
  assert.equal(resolved.syncEnabled, false);
  assert.equal(resolved.deviceSyncEnabled, false);
});

test("invalid values fail safe instead of throwing", () => {
  assert.equal(cloud.parseCloudStatus("definitely-not-a-status"), "preview");
  assert.equal(cloud.parseCloudStatus(undefined), "preview");
  assert.equal(cloud.parseBooleanFlag("maybe", false), false);
  assert.equal(cloud.parseBooleanFlag(undefined, false), false);
});

test("the API base URL rejects non-https and private network hosts", () => {
  assert.equal(cloud.parseApiBaseUrl("https://api.example.com"), "https://api.example.com");
  assert.equal(cloud.parseApiBaseUrl("http://api.example.com"), null);
  assert.equal(cloud.parseApiBaseUrl("https://192.168.1.20"), null);
  assert.equal(cloud.parseApiBaseUrl("https://localhost"), null);
  assert.equal(cloud.parseApiBaseUrl("not a url"), null);
  assert.equal(cloud.parseApiBaseUrl(undefined), null);
});

test("no cloud backend is reported operational in a default build", () => {
  assert.equal(cloud.isCloudBackendOperational(cloud.readNexusCloudConfig()), false);
  assert.equal(cloud.getNexusCloudServiceStatus(cloud.readNexusCloudConfig()).mode, "local");
});

test("the service layer makes no network requests in this phase", async () => {
  const service = await read("src/cloud/service.ts");
  assert.doesNotMatch(service, /\bfetch\(|XMLHttpRequest|WebSocket|axios/);
});

// -------------------------------------------------------------- security

const publicSources = Object.entries({
  "src/App.tsx": app,
  "src/routes.ts": routes,
  "src/cloud/config.ts": config,
  "src/cloud/types.ts": await read("src/cloud/types.ts"),
  "src/cloud/service.ts": await read("src/cloud/service.ts"),
  "src/cloud/index.ts": await read("src/cloud/index.ts"),
  "src/data/nexus-cloud.ts": data,
  "src/data/navigation.ts": await read("src/data/navigation.ts"),
  "src/components/pages/NexusCloudPage.tsx": productPage,
  "src/components/pages/NexusCloudPortalPage.tsx": portalPage,
  "src/components/nexus-cloud/StatusBadge.tsx": await read("src/components/nexus-cloud/StatusBadge.tsx"),
  "src/components/nexus-cloud/ModeCard.tsx": await read("src/components/nexus-cloud/ModeCard.tsx"),
  "src/components/nexus-cloud/CapabilityList.tsx": await read("src/components/nexus-cloud/CapabilityList.tsx"),
  "src/components/nexus-cloud/RoadmapList.tsx": await read("src/components/nexus-cloud/RoadmapList.tsx"),
  "src/components/nexus-cloud/ArchitectureDiagram.tsx": await read(
    "src/components/nexus-cloud/ArchitectureDiagram.tsx",
  ),
});

test("no provider API key names appear in public runtime configuration", () => {
  for (const [name, source] of publicSources) {
    assert.doesNotMatch(source, /OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_API_KEY|_SECRET|_TOKEN\b/, name);
  }
});

test("private gateway ports are not referenced in browser-facing code", () => {
  for (const [name, source] of publicSources) {
    assert.doesNotMatch(source, /8788|8790/, name);
  }
});

test("no absolute Windows project paths appear in public website files", () => {
  for (const [name, source] of publicSources) {
    assert.doesNotMatch(source, /[A-Za-z]:\\\\?KCxProjects/, name);
  }
});

test("the Electron-only publishing catalog is never imported by website code", () => {
  for (const [name, source] of publicSources) {
    assert.doesNotMatch(source, /publishing-catalog/, name);
  }
});
