import test from "node:test";
import assert from "node:assert/strict";
import { pageMetadata, renderSeoHtml } from "../scripts/generate-seo-pages.mjs";

const template = `<!doctype html><html><head><meta name="description" content="Base" />
<link rel="canonical" href="https://kcxlabs.org/" /><meta property="og:title" content="KCx Labs" />
<meta property="og:description" content="Base" /><meta property="og:url" content="https://kcxlabs.org/" />
<title>KCx Labs</title></head><body></body></html>`;

test("every public indexable route has distinct route metadata and canonical URL", () => {
  const indexable = Object.values(pageMetadata).filter((page) => !page.noindex);
  assert.deepEqual(indexable.map((page) => page.path), ["/beta", "/downloads", "/nexus", "/nexus/portal", "/clips", "/productions"]);
  for (const page of indexable) {
    const html = renderSeoHtml(template, page);
    const escapedTitle = page.title.replaceAll("&", "&amp;");
    assert.ok(html.includes(`<title>${escapedTitle}</title>`));
    assert.ok(html.includes(`<link rel="canonical" href="https://kcxlabs.org${page.path}" />`));
    assert.ok(html.includes(`<meta property="og:url" content="https://kcxlabs.org${page.path}" />`));
    assert.ok(!html.includes('name="robots" content="noindex'));
  }
});

test("Productions structured data links both official organizations and the channel", () => {
  const html = renderSeoHtml(template, pageMetadata.productions);
  const match = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/);
  assert.ok(match, "missing JSON-LD script");
  const data = JSON.parse(match[1]);
  assert.equal(data["@context"], "https://schema.org");
  const [kcxLabs, productions] = data["@graph"];
  assert.equal(kcxLabs["@type"], "Organization");
  assert.equal(kcxLabs.url, "https://kcxlabs.org/");
  assert.equal(productions["@type"], "Organization");
  assert.equal(productions.url, "https://kcxlabs.org/productions");
  assert.equal(productions.parentOrganization["@id"], kcxLabs["@id"]);
  assert.deepEqual(productions.sameAs, ["https://www.youtube.com/@TannerKCxProductions"]);
});

test("private pages receive noindex and route specific metadata", () => {
  for (const key of ["snapcal", "camera-archive"]) {
    const page = pageMetadata[key];
    const html = renderSeoHtml(template, page);
    assert.ok(html.includes('<meta name="robots" content="noindex, nofollow, noarchive" />'));
    assert.ok(html.includes(`https://kcxlabs.org${page.path}`));
  }
});
