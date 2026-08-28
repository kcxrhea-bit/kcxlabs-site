/**
 * Dependency-free pathname routing for the public website.
 *
 * The site intentionally does not use a routing library. Vercel rewrites every
 * unmatched path to `/index.html`, so this resolver is what turns a deep link
 * into a page. Unknown paths fall back to the homepage.
 *
 * `/nexus` and `/nexus/portal` remain canonical. The former `/nexus-cloud`
 * paths remain recognised as local-preview safety aliases.
 */

export const publicRoutes = [
  "home",
  "beta",
  "downloads",
  "nexus",
  "nexus-portal",
  "clips",
  "share",
] as const;

export type PublicRoute = (typeof publicRoutes)[number];

/** Canonical path each route is served from. Use these for every internal link. */
export const publicRoutePaths: Record<Exclude<PublicRoute, "home">, string> = {
  beta: "/beta",
  downloads: "/downloads",
  nexus: "/nexus",
  "nexus-portal": "/nexus/portal",
  clips: "/clips",
  share: "/c/:publicId",
};

/** Legacy paths kept only as permanent redirects. Never link to these. */
export const legacyRoutePaths: Record<string, string> = {
  "/nexus-cloud": publicRoutePaths.nexus,
  "/nexus-cloud/portal": publicRoutePaths["nexus-portal"],
};

export function resolvePublicRoute(pathname: string): PublicRoute {
  const normalized = pathname.replace(/\/+$/, "").toLowerCase();

  if (/^\/c\/[A-Za-z0-9]{16}$/.test(pathname)) {
    return "share";
  }

  switch (normalized) {
    case "/beta":
      return "beta";
    case "/downloads":
      return "downloads";
    case "/nexus":
    case "/nexus-cloud":
      return "nexus";
    case "/nexus/portal":
    case "/nexus-cloud/portal":
      return "nexus-portal";
    case "/clips":
      return "clips";
    default:
      return "home";
  }
}
