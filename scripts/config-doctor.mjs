/**
 * Prints which server-side variables are configured. Values are NEVER printed —
 * only presence and character count, so the output is safe to paste or
 * screenshot.
 *
 *   npm run config:doctor
 */

import { loadEnvLocal } from "./load-env.mjs";

const loaded = loadEnvLocal();

const SECRET = new Set([
  "DATABASE_URL",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "CLOUDFLARE_ANALYTICS_TOKEN",
  "OWNER_PASSWORD_HASH",
  "SESSION_SECRET",
]);

const REQUIRED = [
  ["DATABASE_URL", "Neon connection string"],
  ["R2_ACCOUNT_ID", "Cloudflare account id"],
  ["R2_ACCESS_KEY_ID", "R2 token key id (bucket-scoped)"],
  ["R2_SECRET_ACCESS_KEY", "R2 token secret (bucket-scoped)"],
  ["R2_BUCKET", "Bucket name (defaults to kcxlabs-media)"],
];

const OPTIONAL = [
  ["CLOUDFLARE_ANALYTICS_TOKEN", "Account Analytics: Read — enables provider metrics"],
  ["R2_PUBLIC_HOST", "Custom media domain, e.g. media.kcxlabs.org"],
  ["OWNER_EMAIL", "Owner login email"],
  ["OWNER_PASSWORD_HASH", "scrypt hash from npm run auth:hash"],
  ["SESSION_SECRET", "32+ random bytes, hex"],
  ["MAX_UPLOAD_BYTES", "Per-object ceiling"],
  ["MONTHLY_UPLOAD_QUOTA_BYTES", "Monthly upload quota"],
  ["UPLOADS_DISABLED", "Kill switch"],
  ["PUBLIC_SITE_ORIGIN", "Canonical origin for share URLs"],
];

const line = (key, description, required) => {
  const value = process.env[key];
  const present = typeof value === "string" && value.trim() !== "";
  const mark = present ? "OK  " : required ? "MISS" : "--  ";
  const detail = present
    ? SECRET.has(key)
      ? `set (${value.trim().length} chars, hidden)`
      : value.trim()
    : required
      ? "NOT SET — required"
      : "not set";
  return `  [${mark}] ${key.padEnd(28)} ${detail}\n         ${description}`;
};

console.log("\nKCx Media Center — configuration check");
console.log(
  loaded.found
    ? `Loaded .env.local (${loaded.keys.length} variables)\n`
    : "No .env.local found — using process environment only\n",
);

console.log("Required for live integration:");
for (const [key, description] of REQUIRED) console.log(line(key, description, true));

console.log("\nOptional:");
for (const [key, description] of OPTIONAL) console.log(line(key, description, false));

const missing = REQUIRED.filter(([key]) => {
  const value = process.env[key];
  return !(typeof value === "string" && value.trim() !== "");
}).map(([key]) => key);

if (missing.length > 0) {
  console.log(`\nNot ready: ${missing.length} required variable(s) missing.`);
  console.log("Add them to .env.local (already gitignored). See .env.example.\n");
  process.exit(1);
}

console.log("\nAll required variables are present.\n");
