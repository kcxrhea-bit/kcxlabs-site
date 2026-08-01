/**
 * Dependency-free pathname routing for the public website.
 *
 * The site intentionally does not use a routing library. Vercel rewrites every
 * unmatched path to `/index.html`, so this resolver is what turns a deep link
 * into a page. Unknown paths fall back to the homepage.
 *
 * `/nexus` and `/nexus/portal` are canonical. The former `/nexus-cloud` paths
 * are permanent redirects handled by vercel.json before the SPA catch-all, so
 * they never reach this resolver in production. They are still recognised here
 * as a safety net for local `vite preview`, which does not apply redirects.
 */

export const publicRoutes = ["home", "beta", "nexus", "nexus-portal", "resume"] as const;

export type PublicRoute = (typeof publicRoutes)[number];

/** Canonical path each route is served from. Use these for every internal link. */
export const publicRoutePaths: Record<Exclude<PublicRoute, "home">, string> = {
  beta: "/beta",
  nexus: "/nexus",
  "nexus-portal": "/nexus/portal",
  resume: "/resume",
};

/** Legacy paths kept only as permanent redirects. Never link to these. */
export const legacyRoutePaths: Record<string, string> = {
  "/nexus-cloud": publicRoutePaths.nexus,
  "/nexus-cloud/portal": publicRoutePaths["nexus-portal"],
  "/resume-services": publicRoutePaths.resume,
};

export function resolvePublicRoute(pathname: string): PublicRoute {
  // Tolerate trailing slashes and casing so `/Nexus/` resolves like `/nexus`.
  const normalized = pathname.replace(/\/+$/, "").toLowerCase();

  switch (normalized) {
    case "/beta":
      return "beta";
    case "/nexus":
    // Legacy path, redirected in production; resolved here so a local preview
    // without redirect support still renders the right page.
    case "/nexus-cloud":
      return "nexus";
    case "/nexus/portal":
    case "/nexus-cloud/portal":
      return "nexus-portal";
    case "/resume":
    // Alternate path kept working so either address reaches the same page.
    case "/resume-services":
      return "resume";
    default:
      return "home";
  }
}
