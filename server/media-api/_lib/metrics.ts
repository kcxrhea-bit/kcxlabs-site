/**
 * Cloudflare R2 storage metrics via the GraphQL Analytics API.
 *
 * Endpoint: https://api.cloudflare.com/client/v4/graphql
 * Dataset:  r2StorageAdaptiveGroups
 *
 * No dashboard scraping, no browser automation, no Cloudflare login. A single
 * API token with Account Analytics: Read, held server-side only.
 *
 * ── Status: query shape NOT YET VERIFIED against a live account ──────────────
 *
 * The field names below come from Cloudflare's published schema documentation.
 * They have not been confirmed by a successful call. `fetchStorageMetrics`
 * therefore treats ANY failure — network, auth, GraphQL errors, unexpected
 * shape — as "metrics unavailable" and returns null rather than throwing.
 *
 * That is not defensive padding: returning null is a designed, tested state.
 * The storage budget already handles it by dropping to the conservative 6 GB
 * automatic-upload ceiling. A wrong field name degrades the system to caution,
 * never to a crash and never to permissiveness.
 */

import type { AnalyticsConfig } from "./config";
import type { ProviderMetrics } from "../../../src/media/storage-budget";

const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

/**
 * Most recent storage reading for one bucket.
 *
 * `max` is the documented aggregation for this dataset: these are gauge values
 * (how much is stored), not counters, so the maximum within the window is the
 * meaningful figure.
 */
export const STORAGE_QUERY = `
  query R2Storage($accountTag: String!, $bucket: String!, $start: Time!, $end: Time!) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        r2StorageAdaptiveGroups(
          limit: 1
          filter: { datetime_geq: $start, datetime_leq: $end, bucketName: $bucket }
          orderBy: [datetime_DESC]
        ) {
          max {
            payloadSize
            metadataSize
            objectCount
            uploadCount
          }
          dimensions {
            datetime
          }
        }
      }
    }
  }
`;

/**
 * Operation counts (Class A / Class B). Secondary — storage is the concern that
 * actually threatens the $0 target, and this must never block the core path.
 */
export const OPERATIONS_QUERY = `
  query R2Operations($accountTag: String!, $bucket: String!, $start: Time!, $end: Time!) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        r2OperationsAdaptiveGroups(
          limit: 100
          filter: { datetime_geq: $start, datetime_leq: $end, bucketName: $bucket }
        ) {
          sum {
            requests
          }
          dimensions {
            actionType
          }
        }
      }
    }
  }
`;

export type MetricsFetchResult =
  | { ok: true; metrics: ProviderMetrics; rawDatetime: string }
  | { ok: false; reason: string };

type GraphQLResponse = {
  data?: {
    viewer?: {
      accounts?: {
        r2StorageAdaptiveGroups?: {
          max?: {
            payloadSize?: number;
            metadataSize?: number;
            objectCount?: number;
            uploadCount?: number;
          };
          dimensions?: { datetime?: string };
        }[];
      }[];
    };
  };
  errors?: { message?: string }[];
};

/**
 * Fetch the latest storage reading, or a structured failure.
 *
 * Never throws. The caller treats a failure as "provider metrics unavailable",
 * which the budget already models.
 *
 * The lookback window is 24 hours: this dataset is aggregated, so the most
 * recent available row can legitimately be some minutes or hours old. Whether
 * that row is fresh enough is decided by the budget's staleness rule using the
 * returned `measuredAt`, not assumed here.
 */
export async function fetchStorageMetrics(
  config: AnalyticsConfig,
  bucket: string,
  options: { now?: Date; lookbackHours?: number; timeoutMs?: number } = {},
): Promise<MetricsFetchResult> {
  const now = options.now ?? new Date();
  const lookbackHours = options.lookbackHours ?? 24;
  const start = new Date(now.getTime() - lookbackHours * 3600_000).toISOString();
  const end = now.toISOString();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);

  try {
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        // The token is a request header only. It is never logged or returned.
        Authorization: `Bearer ${config.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: STORAGE_QUERY,
        variables: { accountTag: config.accountId, bucket, start, end },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // Status only — the body may echo request details.
      return { ok: false, reason: `Cloudflare analytics returned HTTP ${response.status}` };
    }

    const payload = (await response.json()) as GraphQLResponse;

    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      const first = payload.errors[0]?.message ?? "unknown GraphQL error";
      return { ok: false, reason: `Cloudflare analytics error: ${first}` };
    }

    const group = payload.data?.viewer?.accounts?.[0]?.r2StorageAdaptiveGroups?.[0];
    if (group === undefined) {
      return { ok: false, reason: "Cloudflare analytics returned no storage rows for this bucket" };
    }

    const payloadSize = group.max?.payloadSize;
    const metadataSize = group.max?.metadataSize ?? 0;
    const measuredAt = group.dimensions?.datetime;

    if (typeof payloadSize !== "number" || typeof measuredAt !== "string") {
      return { ok: false, reason: "Cloudflare analytics response was missing expected fields" };
    }

    return {
      ok: true,
      rawDatetime: measuredAt,
      metrics: {
        // Billable storage counts object payload plus metadata.
        storedBytes: payloadSize + metadataSize,
        objectCount: typeof group.max?.objectCount === "number" ? group.max.objectCount : 0,
        pendingUploadCount:
          typeof group.max?.uploadCount === "number" ? group.max.uploadCount : null,
        measuredAt: new Date(measuredAt).toISOString(),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reason =
      (error as { name?: string })?.name === "AbortError"
        ? "Cloudflare analytics request timed out"
        : `Cloudflare analytics request failed: ${message}`;
    return { ok: false, reason };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * What this data is and is not.
 *
 * `storedBytes` is a POINT-IN-TIME measurement of bytes in the bucket. It is
 * NOT billable GB-month, which is an integral of stored bytes over time and is
 * not exposed by this dataset. Nothing in this codebase converts one into the
 * other, and no screen presents this figure as an amount owed.
 */
export const METRICS_PROVENANCE =
  "Point-in-time bucket size reported by Cloudflare's GraphQL Analytics API. " +
  "Not billable GB-month.";
