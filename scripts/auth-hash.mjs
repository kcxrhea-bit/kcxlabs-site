/**
 * Generates the scrypt hash for OWNER_PASSWORD_HASH, plus a SESSION_SECRET.
 *
 *   npm run auth:hash
 *
 * Reads the password from an environment variable rather than an argument or a
 * prompt, so it never lands in shell history:
 *
 *   PowerShell:  $env:KCX_NEW_PASSWORD='...'; npm run auth:hash
 *
 * Prints the HASH (safe to store in .env.local) and never the password.
 */

import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

const password = process.env.KCX_NEW_PASSWORD;

if (typeof password !== "string" || password.length < 12) {
  console.error("\nSet KCX_NEW_PASSWORD to a password of at least 12 characters, then re-run.\n");
  console.error("  PowerShell:  $env:KCX_NEW_PASSWORD='your-long-password'; npm run auth:hash\n");
  process.exit(1);
}

const salt = randomBytes(16);
const derived = await scryptAsync(password, salt, KEY_LENGTH, {
  N: SCRYPT_N,
  r: SCRYPT_R,
  p: SCRYPT_P,
  maxmem: 128 * SCRYPT_N * SCRYPT_R * 2,
});

const hash = ["scrypt", SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("hex"), derived.toString("hex")].join("$");

console.log("\nAdd these to .env.local (already gitignored). The password itself is not printed.\n");
console.log(`OWNER_PASSWORD_HASH=${hash}`);
console.log(`SESSION_SECRET=${randomBytes(32).toString("hex")}`);
console.log("\nThen clear the variable:  $env:KCX_NEW_PASSWORD=$null\n");
