/**
 * Minimal .env.local loader for local scripts.
 *
 * No dotenv dependency: the format we need is trivial, and adding a package
 * that reads credential files is not worth it. Vercel injects real environment
 * variables in production, so this is a local-development convenience only.
 *
 * Never logs values. Never writes the file back.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Load KEY=VALUE pairs from .env.local into process.env.
 *
 * Existing process.env values win, so an explicitly exported variable is never
 * silently overridden by the file.
 *
 * Returns the NAMES that were loaded — never the values.
 */
export function loadEnvLocal(root = process.cwd()) {
  const path = join(root, ".env.local");
  if (!existsSync(path)) return { path, found: false, keys: [] };

  const contents = readFileSync(path, "utf8");
  const keys = [];

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const equals = line.indexOf("=");
    if (equals === -1) continue;

    const key = line.slice(0, equals).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = line.slice(equals + 1).trim();
    // Strip one matching pair of surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }

    keys.push(key);
    if (process.env[key] === undefined) process.env[key] = value;
  }

  return { path, found: true, keys };
}
