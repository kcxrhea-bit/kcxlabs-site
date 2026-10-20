/**
 * Server-side configuration and startup validation.
 *
 * This module is the ONLY place environment variables are read. Nothing here is
 * ever bundled into the public website: `api/` is compiled separately from
 * `src/`, and none of these names are `VITE_*`, so Vite cannot inline them.
 *
 * ── Secret hygiene, enforced by construction ────────────────────────────────
 *
 * Errors and diagnostics name the VARIABLE that is missing or malformed. They
 * never include its value, not even truncated. `describeConfig()` returns only
 * booleans, lengths, and non-secret identifiers, so it is safe to log verbatim.
 *
 * If you add a variable here, add it to `SECRET_KEYS` if it is sensitive, and
 * never write it into a log line, an error message, or an API response.
 */

/** Variables whose values must never appear in logs, errors, or responses. */
export const SECRET_KEYS = [
  "DATABASE_URL",
  "R2_SECRET_ACCESS_KEY",
  "R2_ACCESS_KEY_ID",
  "CAMERA_R2_SECRET_ACCESS_KEY",
  "CAMERA_R2_ACCESS_KEY_ID",
  "CLOUDFLARE_ANALYTICS_TOKEN",
  "OWNER_PASSWORD_HASH",
  "SESSION_SECRET",
  "CRON_SECRET",
] as const;

export type SecretKey = (typeof SECRET_KEYS)[number];

export class ConfigError extends Error {
  readonly missing: string[];
  readonly invalid: string[];

  constructor(missing: string[], invalid: string[]) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`missing: ${missing.join(", ")}`);
    if (invalid.length > 0) parts.push(`invalid: ${invalid.join(", ")}`);
    // Names only. Never values.
    super(`Server configuration problem — ${parts.join("; ")}. See .env.example.`);
    this.name = "ConfigError";
    this.missing = missing;
    this.invalid = invalid;
  }
}

function read(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

// ─── Shapes ──────────────────────────────────────────────────────────────────

export type DatabaseConfig = {
  connectionString: string;
};

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** S3-compatible endpoint derived from the account id. */
  endpoint: string;
  /** Public host serving object bytes, or null when not yet configured. */
  publicHost: string | null;
};

export type AnalyticsConfig = {
  apiToken: string;
  accountId: string;
};

export type LimitsConfig = {
  maxUploadBytes: number;
  monthlyUploadQuotaBytes: number;
  uploadsDisabled: boolean;
};

export type AuthConfig = {
  ownerEmail: string;
  ownerPasswordHash: string;
  sessionSecret: string;
};

/** Camera backup budget, in bytes. Decimal 5,000,000,000 default — matches the user's spec exactly, not GiB. */
export type CameraConfig = {
  budgetBytes: number;
};

export type AppConfig = {
  database: DatabaseConfig;
  r2: R2Config;
  /** Dedicated bucket for KCxCamBridge camera backups. Counts toward the 5 GB camera budget; `r2` never does. Null when the camera token is missing or invalid — camera routes then fail closed. */
  cameraR2: R2Config | null;
  camera: CameraConfig;
  analytics: AnalyticsConfig | null;
  auth: AuthConfig;
  limits: LimitsConfig;
  publicSiteOrigin: string;
};

// ─── Individual loaders ──────────────────────────────────────────────────────
//
// Split so a handler that only needs R2 does not fail because an unrelated
// variable is absent, and so the metrics fetcher can be optional.

export function loadDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const connectionString = read(env, "DATABASE_URL");
  if (connectionString === undefined) throw new ConfigError(["DATABASE_URL"], []);

  // Shape check only — never logs or echoes the value.
  if (!/^postgres(ql)?:\/\//i.test(connectionString)) {
    throw new ConfigError([], ["DATABASE_URL (expected a postgres:// connection string)"]);
  }
  return { connectionString };
}

export function loadR2Config(env: NodeJS.ProcessEnv = process.env): R2Config {
  const missing: string[] = [];
  const accountId = read(env, "R2_ACCOUNT_ID") ?? (missing.push("R2_ACCOUNT_ID"), "");
  const accessKeyId = read(env, "R2_ACCESS_KEY_ID") ?? (missing.push("R2_ACCESS_KEY_ID"), "");
  const secretAccessKey =
    read(env, "R2_SECRET_ACCESS_KEY") ?? (missing.push("R2_SECRET_ACCESS_KEY"), "");
  const bucket = read(env, "R2_BUCKET") ?? "kcxlabs-media";

  if (missing.length > 0) throw new ConfigError(missing, []);

  const publicHostRaw = read(env, "R2_PUBLIC_HOST") ?? null;
  const publicHost =
    publicHostRaw === null ? null : publicHostRaw.replace(/^https?:\/\//i, "").replace(/\/+$/, "");

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    publicHost,
  };
}

/** The only bucket camera backups may ever touch. */
export const CAMERA_R2_BUCKET = "kcxlabs-camera";

/**
 * Camera backups live in their OWN R2 bucket, isolated from the general
 * Media Center bucket on purpose: the 5 GB camera budget must only ever
 * reflect bytes in this bucket.
 *
 * Fails closed. The camera token is required explicitly and NEVER falls back
 * to the general `R2_*` credentials — that token is scoped to other buckets,
 * so a fallback would either fail at runtime or over-privilege this feature.
 * Only the (non-secret) account id may be shared with `R2_ACCOUNT_ID`.
 */
export function loadCameraR2Config(env: NodeJS.ProcessEnv = process.env): R2Config {
  const missing: string[] = [];
  const accountId =
    read(env, "CAMERA_R2_ACCOUNT_ID") ?? read(env, "R2_ACCOUNT_ID") ?? (missing.push("CAMERA_R2_ACCOUNT_ID"), "");
  const accessKeyId = read(env, "CAMERA_R2_ACCESS_KEY_ID") ?? (missing.push("CAMERA_R2_ACCESS_KEY_ID"), "");
  const secretAccessKey =
    read(env, "CAMERA_R2_SECRET_ACCESS_KEY") ?? (missing.push("CAMERA_R2_SECRET_ACCESS_KEY"), "");
  const bucket = read(env, "CAMERA_R2_BUCKET") ?? CAMERA_R2_BUCKET;

  if (missing.length > 0) throw new ConfigError(missing, []);

  // Shape and isolation checks. Names only in errors — never values.
  const invalid: string[] = [];
  if (!/^[0-9a-f]{32}$/i.test(accountId)) invalid.push("CAMERA_R2_ACCOUNT_ID (expected a 32-character account id)");
  if (!/^[0-9a-f]{32}$/i.test(accessKeyId)) invalid.push("CAMERA_R2_ACCESS_KEY_ID (expected a 32-character R2 access key id)");
  if (!/^[0-9a-f]{64}$/i.test(secretAccessKey)) invalid.push("CAMERA_R2_SECRET_ACCESS_KEY (expected a 64-character R2 secret)");
  if (accessKeyId === read(env, "R2_ACCESS_KEY_ID") || secretAccessKey === read(env, "R2_SECRET_ACCESS_KEY")) {
    invalid.push("CAMERA_R2_ACCESS_KEY_ID (must be a dedicated camera token, not the Media Center token)");
  }
  if (bucket !== CAMERA_R2_BUCKET) invalid.push(`CAMERA_R2_BUCKET (must be ${CAMERA_R2_BUCKET})`);
  // Camera footage is private: playback is presigned only, so a public host is a misconfiguration.
  if (read(env, "CAMERA_R2_PUBLIC_HOST") !== undefined) invalid.push("CAMERA_R2_PUBLIC_HOST (must be unset; the camera bucket is private)");
  if (invalid.length > 0) throw new ConfigError([], invalid);

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    publicHost: null,
  };
}

/**
 * Lazy variant used by `loadAppConfig`: a missing or invalid camera token
 * must disable ONLY the camera routes (they answer 503), never Media Center
 * or SnapCal, which share the same config load.
 */
export function loadOptionalCameraR2Config(env: NodeJS.ProcessEnv = process.env): R2Config | null {
  try {
    return loadCameraR2Config(env);
  } catch (error) {
    if (error instanceof ConfigError) return null;
    throw error;
  }
}

/**
 * Shared secret for scheduled maintenance routes. Vercel Cron sends it as
 * `Authorization: Bearer <CRON_SECRET>` when a variable with exactly this
 * name exists. Server-only: never sent to the browser or the desktop client.
 * Null (routes fail closed) when unset or too short to be a real secret.
 */
export function loadCronSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = read(env, "CRON_SECRET");
  return secret !== undefined && secret.length >= 32 ? secret : null;
}

const DECIMAL_GB = 1_000_000_000;

export function loadCameraConfig(env: NodeJS.ProcessEnv = process.env): CameraConfig {
  const raw = read(env, "CAMERA_BUDGET_BYTES");
  if (raw === undefined) return { budgetBytes: 5 * DECIMAL_GB };
  const parsed = Number(raw);
  return { budgetBytes: Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 5 * DECIMAL_GB };
}

/**
 * Analytics is OPTIONAL by design.
 *
 * Returning null when the token is absent is what makes the degraded-metrics
 * policy reachable: no token means no provider measurement, which the storage
 * budget already handles by falling back to the conservative 6 GB automatic
 * upload ceiling. A missing analytics token must never break uploads outright.
 */
export function loadAnalyticsConfig(env: NodeJS.ProcessEnv = process.env): AnalyticsConfig | null {
  const apiToken = read(env, "CLOUDFLARE_ANALYTICS_TOKEN");
  const accountId = read(env, "R2_ACCOUNT_ID");
  if (apiToken === undefined || accountId === undefined) return null;
  return { apiToken, accountId };
}

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const missing: string[] = [];
  const ownerEmail = read(env, "OWNER_EMAIL") ?? (missing.push("OWNER_EMAIL"), "");
  const ownerPasswordHash =
    read(env, "OWNER_PASSWORD_HASH") ?? (missing.push("OWNER_PASSWORD_HASH"), "");
  const sessionSecret = read(env, "SESSION_SECRET") ?? (missing.push("SESSION_SECRET"), "");

  if (missing.length > 0) throw new ConfigError(missing, []);

  const invalid: string[] = [];
  // A short session secret is a real weakness, so it is rejected rather than
  // accepted quietly. The length is checked; the value is never shown.
  if (sessionSecret.length < 32) invalid.push("SESSION_SECRET (must be at least 32 characters)");
  if (!ownerPasswordHash.startsWith("scrypt$")) {
    invalid.push("OWNER_PASSWORD_HASH (expected a scrypt$… hash from npm run auth:hash)");
  }
  if (invalid.length > 0) throw new ConfigError([], invalid);

  return { ownerEmail, ownerPasswordHash, sessionSecret };
}

const GB = 1024 * 1024 * 1024;

export function loadLimitsConfig(env: NodeJS.ProcessEnv = process.env): LimitsConfig {
  const parseBytes = (key: string, fallback: number): number => {
    const raw = read(env, key);
    if (raw === undefined) return fallback;
    const parsed = Number(raw);
    // A malformed limit falls back to the safe default rather than to Infinity.
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
  };

  return {
    maxUploadBytes: parseBytes("MAX_UPLOAD_BYTES", 5 * GB),
    monthlyUploadQuotaBytes: parseBytes("MONTHLY_UPLOAD_QUOTA_BYTES", 200 * GB),
    // Any value other than an explicit "false" leaves uploads disabled once the
    // variable is present at all: the kill switch fails toward "off".
    uploadsDisabled: (read(env, "UPLOADS_DISABLED") ?? "false").toLowerCase() === "true",
  };
}

export function loadPublicSiteOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const raw = read(env, "PUBLIC_SITE_ORIGIN") ?? "https://kcxlabs.org";
  return raw.replace(/\/+$/, "");
}

/** Everything at once. Throws a ConfigError naming what is wrong. */
export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    database: loadDatabaseConfig(env),
    r2: loadR2Config(env),
    cameraR2: loadOptionalCameraR2Config(env),
    camera: loadCameraConfig(env),
    analytics: loadAnalyticsConfig(env),
    auth: loadAuthConfig(env),
    limits: loadLimitsConfig(env),
    publicSiteOrigin: loadPublicSiteOrigin(env),
  };
}

// ─── Safe diagnostics ────────────────────────────────────────────────────────

export type ConfigReport = {
  key: string;
  present: boolean;
  secret: boolean;
  /** Character count only — enough to spot a truncated paste, useless to an attacker. */
  length: number;
  note: string | null;
};

const ALL_KEYS = [
  "DATABASE_URL",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_PUBLIC_HOST",
  "CAMERA_R2_ACCOUNT_ID",
  "CAMERA_R2_ACCESS_KEY_ID",
  "CAMERA_R2_SECRET_ACCESS_KEY",
  "CAMERA_R2_BUCKET",
  "CAMERA_R2_PUBLIC_HOST",
  "CAMERA_BUDGET_BYTES",
  "CLOUDFLARE_ANALYTICS_TOKEN",
  "OWNER_EMAIL",
  "OWNER_PASSWORD_HASH",
  "SESSION_SECRET",
  "MAX_UPLOAD_BYTES",
  "MONTHLY_UPLOAD_QUOTA_BYTES",
  "UPLOADS_DISABLED",
  "PUBLIC_SITE_ORIGIN",
  "CRON_SECRET",
] as const;

const OPTIONAL_KEYS = new Set([
  "R2_PUBLIC_HOST",
  "CLOUDFLARE_ANALYTICS_TOKEN",
  "MAX_UPLOAD_BYTES",
  "MONTHLY_UPLOAD_QUOTA_BYTES",
  "UPLOADS_DISABLED",
  "PUBLIC_SITE_ORIGIN",
  "R2_BUCKET",
  "CAMERA_R2_ACCOUNT_ID",
  "CAMERA_R2_ACCESS_KEY_ID",
  "CAMERA_R2_SECRET_ACCESS_KEY",
  "CAMERA_R2_BUCKET",
  "CAMERA_R2_PUBLIC_HOST",
  "CAMERA_BUDGET_BYTES",
  "CRON_SECRET",
]);

/**
 * Presence report safe to print to a terminal or a log.
 *
 * Deliberately returns no values — only whether each variable is set, whether
 * it is a secret, and how many characters it has. This is what the doctor
 * script prints, so a screenshot of it cannot leak a credential.
 */
export function describeConfig(env: NodeJS.ProcessEnv = process.env): ConfigReport[] {
  return ALL_KEYS.map((key) => {
    const value = read(env, key);
    const secret = (SECRET_KEYS as readonly string[]).includes(key);
    return {
      key,
      present: value !== undefined,
      secret,
      length: value?.length ?? 0,
      note: value === undefined && OPTIONAL_KEYS.has(key) ? "optional" : null,
    };
  });
}

/**
 * Redact anything that looks like a configured secret out of a string before it
 * is logged. Last-resort defence for error messages produced by SDKs we do not
 * control, which sometimes echo credentials back in their own error text.
 */
export function redactSecrets(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let output = text;
  for (const key of SECRET_KEYS) {
    const value = read(env, key);
    // Only redact values long enough that replacement is meaningful.
    if (value !== undefined && value.length >= 8) {
      output = output.split(value).join(`[redacted:${key}]`);
    }
  }
  return output;
}
