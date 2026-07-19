/**
 * Typed models for the KCx NEXUS Hybrid Cloud frontend foundation.
 *
 * These describe the *shape* of a future cloud integration. No cloud backend
 * exists yet: nothing in this module performs network access.
 */

export const nexusCloudStatusValues = ["disabled", "preview", "private-beta", "available"] as const;

/** Lifecycle state of the NEXUS cloud service as a whole. */
export type NexusCloudStatus = (typeof nexusCloudStatusValues)[number];

export const nexusExecutionModes = ["local", "cloud", "automatic"] as const;

/** Which execution path handles a NEXUS request. Only `local` is implemented. */
export type NexusExecutionMode = (typeof nexusExecutionModes)[number];

/**
 * Implementation state of an individual capability.
 * `verified` is reserved for capabilities physically validated on real hardware.
 */
export type NexusFeatureState = "verified" | "in-development" | "planned" | "future";

/** A single NEXUS capability and its honest implementation state. */
export type NexusCloudFeature = {
  id: string;
  name: string;
  summary: string;
  state: NexusFeatureState;
  mode: NexusExecutionMode;
};

/**
 * Public, build-time frontend configuration.
 *
 * Every field is derived from `VITE_*` variables, which are inlined into the
 * public bundle. Secrets must never appear here.
 */
export type NexusCloudConfig = {
  status: NexusCloudStatus;
  previewVisible: boolean;
  portalPreviewVisible: boolean;
  cloudChatEnabled: boolean;
  syncEnabled: boolean;
  deviceSyncEnabled: boolean;
  /** Absolute https origin of a future cloud API, or null when unset/rejected. */
  apiBaseUrl: string | null;
};

/**
 * Resolved service status for display.
 *
 * `backendConfigured` reports whether an API base URL is configured — never
 * whether a backend responded, because this phase makes no requests.
 */
export type NexusCloudServiceStatus = {
  status: NexusCloudStatus;
  mode: NexusExecutionMode;
  backendConfigured: boolean;
  cloudChatEnabled: boolean;
  syncEnabled: boolean;
  deviceSyncEnabled: boolean;
  /** Human-readable explanation of the current state. */
  detail: string;
};
