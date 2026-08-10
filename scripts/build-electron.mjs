import { build } from "esbuild";

const shared = {
  bundle: true,
  external: ["electron"],
  platform: "node",
  sourcemap: true,
  target: "node22",
};

await Promise.all([
  build({
    ...shared,
    entryPoints: ["electron/main.ts"],
    format: "cjs",
    outfile: "dist-electron/main.cjs",
  }),
  build({
    ...shared,
    entryPoints: ["electron/preload.ts"],
    format: "cjs",
    outfile: "dist-electron/preload.cjs",
  }),
  build({
    ...shared,
    entryPoints: ["electron/project-discovery.ts"],
    format: "cjs",
    outfile: "dist-electron/project-discovery.cjs",
  }),
  build({
    ...shared,
    entryPoints: ["electron/platform-service.ts"],
    format: "cjs",
    outfile: "dist-electron/platform-service.cjs",
  }),
  build({
    ...shared,
    entryPoints: ["electron/website-addition-service.ts"],
    format: "cjs",
    outfile: "dist-electron/website-addition-service.cjs",
  }),
  build({
    ...shared,
    entryPoints: ["electron/git-publishing-service.ts"],
    format: "cjs",
    outfile: "dist-electron/git-publishing-service.cjs",
  }),
  // Isomorphic media core (types, retention, filename safety, content rules).
  // Bundled here so the node:test suites can import the same compiled logic the
  // API and the Electron media services use, rather than a re-implementation.
  build({
    ...shared,
    entryPoints: ["src/media/index.ts"],
    format: "cjs",
    outfile: "dist-electron/media-core.cjs",
  }),
]);
