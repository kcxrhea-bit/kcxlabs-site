/**
 * Test-facing barrel for the dependency-free parts of the API library.
 *
 * Bundled to `dist-electron/api-core.cjs` so the node:test suites (plain .mjs,
 * no TypeScript loader) exercise the same compiled code the handlers run.
 *
 * Deliberately excludes `db.ts`, `r2.ts`, and `metrics.ts`: those pull in the
 * Neon and AWS SDKs and only do useful work against live services, so they are
 * verified by the integration script rather than by unit tests.
 */

export * from "./config";
export * from "./auth";
export * from "./ids";
