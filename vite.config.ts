import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => ({
  base: mode === "electron" ? "./" : "/",
  plugins: [react(), tailwindcss()],
  // Dev-only: `server` is never read by `vite build`, so this has no effect
  // on the production bundle or on vercel.json's routing.
  //
  // `vercel.json`'s SPA rewrite (`/((?!api/).*)` → `/index.html`) is correct
  // and load-bearing in production, where no Vite dev server exists. Under
  // `vercel dev` that same rewrite also intercepts Vite's own dev-only asset
  // paths (`/@vite/client`, `/@react-refresh`, ...) before they reach Vite,
  // so the browser gets `index.html`'s markup back where it expected a JS
  // module and the app never mounts. Running `vite` directly (`npm run
  // dev:website`) sidesteps that rewrite entirely — no local Vercel routing
  // sits in front of it — and this proxy sends `/api/*` on to a `vercel dev`
  // instance running separately for real Neon/R2-backed function execution.
  server: {
    proxy: {
      "/api": { target: "http://localhost:3456", changeOrigin: true },
    },
  },
}));
