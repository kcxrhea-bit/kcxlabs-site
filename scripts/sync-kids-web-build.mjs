// Syncs the already-exported Godot Web/PWA build for KCx Kids World into this site's
// public/kids/ directory, where Vite copies it verbatim into dist/kids/ on build and Vercel
// serves it as a static subtree at https://kcxlabs.org/kids/ (static files win over the SPA
// rewrite in vercel.json, so the game is served untouched — no React app involvement).
//
// Source of truth for the game build is the Godot project's own export, not this repo. Re-run
// this script after every new Web export instead of hand-copying files.
//
// Usage: node scripts/sync-kids-web-build.mjs [--source <path>]
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const args = process.argv.slice(2);
const sourceFlagIndex = args.indexOf('--source');
const source = sourceFlagIndex !== -1 && args[sourceFlagIndex + 1]
  ? resolve(args[sourceFlagIndex + 1])
  : resolve('D:/KCxProjects/KCxKidsWorld/build/web');
const dest = join(repoRoot, 'public', 'kids');

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

for (const file of REQUIRED_FILES) {
  if (!existsSync(join(dest, file))) {
    fail(`Copy verification failed: ${file} did not land in ${dest}.`);
  }
}

console.log(`[sync-kids-web-build] Synced Godot Web build from:\n  ${source}\ninto:\n  ${dest}`);
console.log('[sync-kids-web-build] Run `npm run build` and check dist/kids/ before deploying.');
