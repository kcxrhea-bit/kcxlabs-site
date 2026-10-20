import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function cssFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(full);
    return entry.name.endsWith(".css") ? [full] : [];
  });
}

function rules(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selectors: selector.split(",").map((s) => s.trim()),
    body,
  }));
}

const pageRoots = /^(html|body|#root|:root)$/;

test("no bundled stylesheet locks scrolling or height on html/body/#root unscoped", () => {
  // Every CSS file under src/ can reach the public site bundle (App.tsx imports the desktop shell),
  // so a bare `body { overflow: hidden }` anywhere freezes scrolling on every public page.
  const offenders = [];
  for (const file of cssFiles(join(root, "src"))) {
    for (const { selectors, body } of rules(readFileSync(file, "utf8"))) {
      const locks = /overflow(-y)?\s*:\s*(hidden|clip)/.test(body) || /(^|[;\s])height\s*:\s*100(%|vh|dvh)/.test(body);
      if (!locks) continue;
      for (const selector of selectors) {
        if (pageRoots.test(selector)) offenders.push(`${file}: ${selector}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("the desktop shell's full-viewport lock is scoped to pages rendering .desktop-app", () => {
  const css = readFileSync(join(root, "src", "desktop", "desktop.css"), "utf8");
  assert.match(css, /html:has\(\.desktop-app\) body\s*\{\s*overflow:\s*hidden;/);
});

test("Downloads does not link the private Camera Archive", () => {
  const downloads = readFileSync(join(root, "src", "components", "pages", "DownloadsPage.tsx"), "utf8");
  assert.doesNotMatch(downloads, /CameraArchive|camera-archive|\/api\/camera/);
});
