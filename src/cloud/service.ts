import { nexusCloudConfig } from "./config";
import type { NexusCloudConfig, NexusCloudServiceStatus, NexusExecutionMode } from "./types";

/**
 * Static status provider for the NEXUS cloud preview.
 *
 * This is deliberately synchronous. There is no cloud backend in this phase, so
 * a promise-based API would imply a network round trip that never happens.
 * When a real backend exists, add an async provider alongside this one rather
 * than making this function pretend to be remote.
 */

const statusDetail: Record<NexusCloudConfig["status"], string> = {
  disabled: "The NEXUS cloud preview is switched off for this build.",
  preview:
    "Cloud services are under development. This preview does not connect to a production cloud backend.",
  "private-beta": "Cloud services are in private beta and limited to invited devices.",
  available: "Cloud services are available.",
};

/** Only `local` is implemented; cloud routing requires a backend that does not exist yet. */
export function resolveExecutionMode(config: NexusCloudConfig = nexusCloudConfig): NexusExecutionMode {
  if (!config.cloudChatEnabled) return "local";
  return config.syncEnabled || config.deviceSyncEnabled ? "automatic" : "cloud";
}

export function getNexusCloudServiceStatus(
  config: NexusCloudConfig = nexusCloudConfig,
): NexusCloudServiceStatus {
  return {
    status: config.status,
    mode: resolveExecutionMode(config),
    backendConfigured: config.apiBaseUrl !== null,
    cloudChatEnabled: config.cloudChatEnabled,
    syncEnabled: config.syncEnabled,
    deviceSyncEnabled: config.deviceSyncEnabled,
    detail: statusDetail[config.status],
  };
}

/** True only when a real cloud backend is both configured and past preview. */
export function isCloudBackendOperational(config: NexusCloudConfig = nexusCloudConfig): boolean {
  return config.apiBaseUrl !== null && (config.status === "private-beta" || config.status === "available");
}
