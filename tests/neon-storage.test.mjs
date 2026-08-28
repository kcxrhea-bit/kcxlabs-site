import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const service = await readFile(new URL("../electron/neon-storage-service.ts", import.meta.url), "utf8");
const shared = await readFile(new URL("../src/shared/desktop.ts", import.meta.url), "utf8");
const preload = await readFile(new URL("../electron/preload.ts", import.meta.url), "utf8");

test("Neon service has fixed database and protected-table policy", () => {
  assert.match(service, /NEON_DATABASE = "neondb"/);
  assert.match(service, /current_database\(\)/);
  for (const table of ["owners", "schema_migrations", "snapcal_calendars", "snapcal_events", "media"]) assert.match(service, new RegExp(table));
  assert.match(service, /candidates: \[\]/);
});
test("Neon API has no renderer SQL or table input", () => {
  assert.doesNotMatch(shared, /query|sql|tableName: string.*input/i);
  assert.doesNotMatch(preload, /execute|query|sql/i);
});
test("Neon limits, threshold, and auto-clean default are fixed", () => {
  assert.match(service, /FREE_TIER_LIMIT_MB = 512/);
  assert.match(service, /CLEANUP_THRESHOLD_MB = 400/);
  assert.match(service, /autoClean: false/);
});
test("Electron resolves DATABASE_URL from the application root without exposing it", () => {
  assert.match(service, /join\(appRoot, "\.env\.local"\)/);
  assert.match(service, /DATABASE_URL/);
  assert.doesNotMatch(service, /console\.(log|error).*DATABASE_URL/);
});
