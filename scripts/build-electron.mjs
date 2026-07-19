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
]);
