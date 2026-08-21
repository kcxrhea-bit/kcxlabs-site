import type { IncomingMessage, ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Server-side gate for the private family game routes (/kids/*, /kids-legacy/*). Deliberately
 * self-contained (no shared media-api _lib imports) — this has nothing to do with the Media
 * Center's Neon/R2-backed stack and shouldn't pull any of it in.
 *
 * The access code lives only in the Vercel environment variable KIDS_ACCESS_CODE — never in
 * source, never in a response body, never logged. On a correct code this issues a signed,
 * HttpOnly session cookie that middleware.ts (Edge runtime, verifies with Web Crypto) checks on
 * every request to a protected route. Both sides derive the same HMAC-SHA256 over the same
 * message with the same key, so it doesn't matter that this handler uses node:crypto while
 * middleware.ts uses SubtleCrypto — the digest is identical.
 *
 * Fails closed: if KIDS_ACCESS_CODE is unset, no code can ever succeed.
 */

const COOKIE_NAME = "kids_auth";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  // `vercel dev` pre-parses the body onto req.body and drains the stream (see api/router.ts /
  // server/media-api/_lib/http.ts for the same pattern); production never sets this.
  const preParsed = (req as IncomingMessage & { body?: unknown }).body;
  if (preParsed !== undefined) {
    if (typeof preParsed === "object" && preParsed !== null) return preParsed as Record<string, unknown>;
    if (typeof preParsed === "string") {
      try {
        return JSON.parse(preParsed) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function sign(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");

  if ((req.method ?? "GET").toUpperCase() !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  const secret = process.env.KIDS_ACCESS_CODE;
  if (!secret) {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: "not_configured" }));
    return;
  }

  const body = await readJsonBody(req);
  const submitted = typeof body?.code === "string" ? body.code.trim() : "";
  if (!submitted || !safeEqual(submitted, secret)) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: "invalid_code" }));
    return;
  }

  const expiresAt = Date.now() + COOKIE_MAX_AGE_SECONDS * 1000;
  const payload = String(expiresAt);
  const token = `${payload}.${sign(secret, payload)}`;
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${token}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`);
  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true }));
}
