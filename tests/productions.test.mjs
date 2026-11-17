import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Productions is routed, discoverable in navigation, and linked from homepage and footer", async () => {
  const [routes, app, nav, section, footer] = await Promise.all([
    read("src/routes.ts"),
    read("src/App.tsx"),
    read("src/data/navigation.ts"),
    read("src/components/sections/ProductionsSection.tsx"),
    read("src/components/layout/Footer.tsx"),
  ]);
  assert.match(routes, /case "\/productions":\s*return "productions"/);
  assert.match(app, /route === "productions"/);
  assert.match(nav, /label: "Productions", href: "\/productions"/);
  assert.match(section, /Tanner &amp; KCx Productions/);
  assert.match(footer, /https:\/\/www\.youtube\.com\/@TannerKCxProductions/);
});

test("Productions page covers the requested categories without embedded videos or invented metrics", async () => {
  const page = await read("src/components/pages/ProductionsPage.tsx");
  for (const label of ["Gaming & Fortnite", "KCx music & music videos", "3D animation", "Cinematic projects"]) {
    assert.ok(page.includes(label), `missing category: ${label}`);
  }
  assert.match(page, /https:\/\/www\.youtube\.com\/@TannerKCxProductions/);
  assert.match(page, /noopener noreferrer/);
  assert.doesNotMatch(page, /<iframe/i);
  assert.doesNotMatch(page, /\b\d+[kKmM]?\s*(?:views|subscribers|videos)\b/i);
});

test("sitemap includes exactly seven indexable public pages and excludes private routes", async () => {
  const [sitemap, robots, vercel] = await Promise.all([
    read("public/sitemap.xml"),
    read("public/robots.txt"),
    read("vercel.json").then(JSON.parse),
  ]);
  const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
  assert.equal(urls.length, 7);
  assert.ok(urls.includes("https://kcxlabs.org/productions"));
  assert.ok(!urls.some((url) => /kids|snapcal|camera-archive|\/c\//i.test(url)));
  assert.match(robots, /Sitemap: https:\/\/kcxlabs\.org\/sitemap\.xml/);
  assert.ok(vercel.rewrites.findIndex((rule) => rule.source === "/productions") < vercel.rewrites.findIndex((rule) => rule.destination === "/index.html"));
  assert.ok(vercel.headers.some((rule) => rule.source === "/snapcal/"));
});
