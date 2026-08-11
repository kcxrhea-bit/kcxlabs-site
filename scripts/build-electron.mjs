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
  // Isomorphic media core (types, retention, filename safety, content rules).
  // Bundled here so the node:test suites can import the same compiled logic the
  // API and the Electron media services use, rather than a re-implementation.
  build({
    ...shared,
    entryPoints: ["src/media/index.ts"],
    format: "cjs",
    outfile: "dist-electron/media-core.cjs",
  }),
  // Dependency-free API library (config validation, auth crypto, id generation)
  // so the node:test suites exercise the same compiled code the handlers run.
  build({
    ...shared,
    entryPoints: ["server/media-api/_lib/index.ts"],
    format: "cjs",
    outfile: "dist-electron/api-core.cjs",
  }),
  // Shared HTTP layer, including the local `vercel dev` compatibility
  // adapter (`toNodeHandler`). Separate from api-core.cjs because it pulls in
  // db.ts (and so the Neon driver) — api-core.cjs stays dependency-free by
  // design; this bundle exists so the adapter test exercises the same
  // compiled code the route handlers actually import.
  build({
    ...shared,
    entryPoints: ["server/media-api/_lib/http.ts"],
    format: "cjs",
    outfile: "dist-electron/api-http.cjs",
  }),
  // A handful of real routes, bundled as-is (their actual `toNodeHandler`
  // export, not a reimplementation), so the adapter test can invoke them
  // with an unauthenticated/malformed request and prove they return through
  // the adapter rather than hang — without ever needing live Neon/R2
  // credentials, since every one of these short-circuits (400/401) before
  // touching either. `outbase` keeps the output layout (dist-electron/routes/...)
  // identical to before the api/ -> server/media-api/routes move.
  build({
    ...shared,
    entryPoints: [
      "server/media-api/routes/auth/pair.ts",
      "server/media-api/routes/auth/revoke.ts",
      "server/media-api/routes/media/check-hash.ts",
      "server/media-api/routes/media/upload-authorize.ts",
      "server/media-api/routes/media/finalize.ts",
      "server/media-api/routes/archive/jobs.ts",
    ],
    format: "cjs",
    outdir: "dist-electron/routes",
    outbase: "server/media-api/routes",
    outExtension: { ".js": ".cjs" },
  }),
  // The single Vercel Function entrypoint, bundled so a test can prove its
  // routing table (`resolveRoute`) sends every one of the 17 real URLs to the
  // correct route module, and that the vercel.json rewrite's __kcx_path
  // reconstruction works, without needing a live Vercel deployment.
  build({
    ...shared,
    entryPoints: ["api/router.ts"],
    format: "cjs",
    outfile: "dist-electron/api-dispatch.cjs",
  }),
]);
