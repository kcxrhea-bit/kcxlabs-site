import { next } from "@vercel/functions";

/**
 * Server-side gate for the private family game routes (/kids/*, /kids-legacy/*, /kids-ios15/*).
 * Runs on Vercel's Edge runtime before any static file (including .wasm/.pck/.js/.wav/manifest/
 * service worker) is served, so protection covers the whole route tree, not just index.html.
 *
 * Verifies the `kids_auth` cookie set by server/kids-access/route.ts (POST /api/kids-access).
 * Both sides compute HMAC-SHA256(payload, KIDS_ACCESS_CODE) — that route with node:crypto, this
 * file with SubtleCrypto (Edge runtime has no node:crypto) — same algorithm, same digest.
 *
 * Fails closed: if KIDS_ACCESS_CODE is unset, no cookie can ever verify, so access is always
 * denied rather than silently allowed.
 */

export const config = {
  matcher: [
    "/kids", "/kids/:path*",
    "/kids-legacy", "/kids-legacy/:path*",
    "/kids-ios15", "/kids-ios15/:path*",
  ],
};

const COOKIE_NAME = "kids_auth";

function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function isAuthorized(request: Request, secret: string): Promise<boolean> {
  const token = parseCookie(request.headers.get("cookie"), COOKIE_NAME);
  if (!token) return false;
  const [expiresAtStr, signature] = token.split(".");
  if (!expiresAtStr || !signature) return false;
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  const expected = await hmacHex(secret, expiresAtStr);
  return constantTimeEqual(expected, signature);
}

export default async function middleware(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const secret = process.env.KIDS_ACCESS_CODE;

  if (secret && (await isAuthorized(request, secret))) {
    return next();
  }

  const accessUrl = new URL("/kids-access", url);
  accessUrl.searchParams.set("next", url.pathname);
  const response = Response.redirect(accessUrl, 307);
  // Belt-and-suspenders: the /kids-access page itself already carries a robots meta tag and
  // the vercel.json headers block covers static /kids/* assets, but the redirect response
  // itself should never be indexed or cached either.
  const headers = new Headers(response.headers);
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, headers });
}
