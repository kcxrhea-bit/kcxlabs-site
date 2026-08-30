/**
 * Server-side OAuth for Google Cloud Vision, using the service-account JWT
 * assertion flow (RFC 7523) rather than any client library — this repo has
 * no Google SDK dependency and this flow needs nothing beyond `node:crypto`
 * and `fetch`, both already used throughout `server/`.
 *
 * The service-account JSON (`GOOGLE_VISION_SERVICE_ACCOUNT_JSON`, loaded by
 * `loadGoogleVisionConfig` in `_lib/config.ts`) never leaves this process:
 * it is used only to RS256-sign a short-lived JWT, which is exchanged at
 * Google's token endpoint for an access token. Neither the private key nor
 * the minted access token is ever logged — see `describeAuthError` for how
 * a failure is reported without doing that.
 *
 * The minted access token is cached in-memory for this warm Vercel Function
 * instance until shortly before it expires, so a burst of OCR requests does
 * not mint a fresh token per request.
 */

import { createSign } from "node:crypto";
import type { GoogleVisionConfig } from "../../media-api/_lib/config.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const VISION_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
/** Refresh this many seconds before actual expiry, to avoid racing a token that expires mid-request. */
const EXPIRY_SAFETY_MARGIN_SECONDS = 60;

type CachedToken = { accessToken: string; expiresAtEpochSeconds: number };

let cachedToken: CachedToken | null = null;

export type GoogleAuthResult =
  | { ok: true; accessToken: string }
  | { ok: false; kind: "credential_error"; message: string }
  | { ok: false; kind: "network"; message: string }
  /** The token endpoint itself rejected the JWT/service account — e.g. malformed key, disabled account. */
  | { ok: false; kind: "unauthorized"; status: number; message: string };

function base64Url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Builds and RS256-signs the JWT assertion Google's token endpoint expects
 * for the service-account flow. `scope` is deliberately the single
 * `cloud-platform` scope Vision needs — nothing broader is requested.
 */
function signAssertion(config: GoogleVisionConfig, nowEpochSeconds: number): string | null {
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: config.clientEmail,
    scope: VISION_SCOPE,
    aud: TOKEN_URL,
    iat: nowEpochSeconds,
    exp: nowEpochSeconds + 3600,
  };

  const encodedHeader = base64Url(Buffer.from(JSON.stringify(header)));
  const encodedClaimSet = base64Url(Buffer.from(JSON.stringify(claimSet)));
  const signingInput = `${encodedHeader}.${encodedClaimSet}`;

  try {
    const signer = createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();
    const signature = signer.sign(config.privateKey);
    return `${signingInput}.${base64Url(signature)}`;
  } catch {
    // Malformed private_key (e.g. truncated paste). Never logs the key itself.
    return null;
  }
}

/** Exported for tests: clears the in-memory token cache between test cases. */
export function resetGoogleVisionAuthCacheForTests(): void {
  cachedToken = null;
}

export async function getGoogleVisionAccessToken(
  config: GoogleVisionConfig,
  fetchImpl: typeof fetch = fetch,
  now: () => number = () => Date.now()
): Promise<GoogleAuthResult> {
  const nowEpochSeconds = Math.floor(now() / 1000);

  if (cachedToken !== null && cachedToken.expiresAtEpochSeconds - EXPIRY_SAFETY_MARGIN_SECONDS > nowEpochSeconds) {
    return { ok: true, accessToken: cachedToken.accessToken };
  }

  const assertion = signAssertion(config, nowEpochSeconds);
  if (assertion === null) {
    return { ok: false, kind: "credential_error", message: "Configured Google service-account key could not be used to sign a request." };
  }

  let response: Response;
  try {
    response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
    });
  } catch (error) {
    return { ok: false, kind: "network", message: error instanceof Error ? error.message : "Network error reaching Google's token endpoint." };
  }

  const bodyText = await response.text();
  let body: unknown = null;
  try {
    body = bodyText.length > 0 ? JSON.parse(bodyText) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const errorBody = body as { error?: string; error_description?: string } | null;
    const message = errorBody?.error_description ?? errorBody?.error ?? `Token endpoint returned status ${response.status}.`;
    return { ok: false, kind: "unauthorized", status: response.status, message };
  }

  const parsed = body as { access_token?: unknown; expires_in?: unknown } | null;
  if (!parsed || typeof parsed.access_token !== "string" || typeof parsed.expires_in !== "number") {
    return { ok: false, kind: "credential_error", message: "Token endpoint response was missing access_token/expires_in." };
  }

  cachedToken = { accessToken: parsed.access_token, expiresAtEpochSeconds: nowEpochSeconds + parsed.expires_in };
  return { ok: true, accessToken: parsed.access_token };
}
