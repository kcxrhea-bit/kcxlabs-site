// Syncs the already-exported Godot Web/PWA build for KCx Kids World into this site's
// public/kids/ directory, where Vite copies it verbatim into dist/kids/ on build and Vercel
// serves it as a static subtree at https://kcxlabs.org/kids/ (static files win over the SPA
// rewrite in vercel.json, so the game is served untouched — no React app involvement).
//
// Source of truth for the game build is the Godot project's own export, not this repo. Re-run
// this script after every new Web export instead of hand-copying files.
//
// Usage:
//   node scripts/sync-kids-web-build.mjs                          -> build/web        -> public/kids
//   node scripts/sync-kids-web-build.mjs --legacy                 -> build/web-legacy -> public/kids-legacy
//   node scripts/sync-kids-web-build.mjs --source <path> [--dest-name <name>]
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const args = process.argv.slice(2);
const isLegacy = args.includes('--legacy');
const sourceFlagIndex = args.indexOf('--source');
const destNameFlagIndex = args.indexOf('--dest-name');

const source = sourceFlagIndex !== -1 && args[sourceFlagIndex + 1]
  ? resolve(args[sourceFlagIndex + 1])
  : resolve(isLegacy ? 'D:/KCxProjects/KCxKidsWorld/build/web-legacy' : 'D:/KCxProjects/KCxKidsWorld/build/web');
const destName = destNameFlagIndex !== -1 && args[destNameFlagIndex + 1]
  ? args[destNameFlagIndex + 1]
  : (isLegacy ? 'kids-legacy' : 'kids');
const dest = join(repoRoot, 'public', destName);

// Files Godot's Web export must produce for the PWA to function. If any are missing, the
// export is incomplete or the wrong directory was pointed at — fail loudly instead of shipping
// a broken game.
const REQUIRED_FILES = [
  'index.html',
  'index.js',
  'index.wasm',
  'index.pck',
  'index.manifest.json',
  'index.service.worker.js',
  'index.offline.html',
];

// Godot editor import metadata (*.import) sometimes ends up alongside export output; it is
// editor-only and must never ship to the web.
const EXCLUDE_SUFFIXES = ['.import'];

function fail(message) {
  console.error(`[sync-kids-web-build] ${message}`);
  process.exit(1);
}

if (!existsSync(source) || !statSync(source).isDirectory()) {
  fail(`Source directory not found: ${source}\nExport the Godot project to Web first, or pass --source <path>.`);
}

for (const file of REQUIRED_FILES) {
  if (!existsSync(join(source, file))) {
    fail(`Expected Godot export file is missing: ${file} (looked in ${source}).\nRe-export the Web/PWA build before syncing.`);
  }
}

// Only ever clean the destination subdirectory we own — never touch the rest of public/.
if (existsSync(dest)) {
  rmSync(dest, { recursive: true, force: true });
}
mkdirSync(dest, { recursive: true });

function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (EXCLUDE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) continue;
    const fromPath = join(from, entry.name);
    const toPath = join(to, entry.name);
    if (entry.isDirectory()) copyDir(fromPath, toPath);
    else copyFileSync(fromPath, toPath);
  }
}

copyDir(source, dest);

// Godot emits an extra blank line at EOF in some text assets. Normalize copied text so the
// generated route trees remain diff-check clean and deterministic across syncs.
for (const entry of readdirSync(dest, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.(?:html|js|json)$/i.test(entry.name)) continue;
  const textPath = join(dest, entry.name);
  writeFileSync(textPath, `${readFileSync(textPath, 'utf8').trimEnd()}\n`, 'utf8');
}

// Godot derives one origin-wide cache prefix from the project name. Both route-scoped workers
// would therefore delete each other's caches during activation. Give each copied deployment a
// stable route-specific namespace and never store an auth redirect/error under an asset URL.
const workerPath = join(dest, 'index.service.worker.js');
let workerSource = readFileSync(workerPath, 'utf8');
const originalPrefix = "const CACHE_PREFIX = 'Toca Boca Jr: Fu-sw-cache-';";
const routePrefix = `const CACHE_PREFIX = 'kcx-kids-world-${destName}-sw-cache-';`;
const originalCacheCondition = 'if (isCacheable) {';
const safeCacheCondition = 'if (isCacheable && response.ok && !response.redirected) {';

if (!workerSource.includes(originalPrefix) || !workerSource.includes(originalCacheCondition)) {
  fail('Godot service-worker template changed; refusing to publish without verified cache isolation.');
}
workerSource = workerSource
  .replace(originalPrefix, routePrefix)
  .replace(originalCacheCondition, safeCacheCondition);
writeFileSync(workerPath, workerSource, 'utf8');

for (const file of REQUIRED_FILES) {
  if (!existsSync(join(dest, file))) {
    fail(`Copy verification failed: ${file} did not land in ${dest}.`);
  }
}

console.log(`[sync-kids-web-build] Synced Godot Web build from:\n  ${source}\ninto:\n  ${dest}`);
console.log(`[sync-kids-web-build] Run \`npm run build\` and check dist/${destName}/ before deploying.`);
