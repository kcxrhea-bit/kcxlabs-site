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
]);
