/**
 * Dependency-free pathname routing for the public website.
 *
 * The site intentionally does not use a routing library. Vercel rewrites every
 * path to `/index.html`, so this resolver is what turns a deep link into a page.
 * Unknown paths fall back to the homepage, matching the previous behaviour.
 */

export const publicRoutes = ["home", "beta", "nexus-cloud", "nexus-cloud-portal"] as const;

export type PublicRoute = (typeof publicRoutes)[number];

/** Path each route is canonically served from. */
export const publicRoutePaths: Record<Exclude<PublicRoute, "home">, string> = {
  beta: "/beta",
  "nexus-cloud": "/nexus-cloud",
  "nexus-cloud-portal": "/nexus-cloud/portal",
};

export function resolvePublicRoute(pathname: string): PublicRoute {
  // Tolerate trailing slashes and casing so `/Nexus-Cloud/` resolves like `/nexus-cloud`.
  const normalized = pathname.replace(/\/+$/, "").toLowerCase();

  switch (normalized) {
    case "/beta":
      return "beta";
    case "/nexus-cloud":
      return "nexus-cloud";
    case "/nexus-cloud/portal":
      return "nexus-cloud-portal";
    default:
      return "home";
  }
}
