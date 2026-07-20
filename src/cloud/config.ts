import type { NexusCloudConfig, NexusCloudStatus } from "./types";
import { nexusCloudStatusValues } from "./types";

/**
 * Build-time configuration for the NEXUS cloud preview.
 *
 * Every `VITE_*` value is inlined into the public bundle and is readable by any
 * visitor. Never place tokens, credentials, or provider keys in these variables.
 *
 * All variables are optional. A build with none of them set produces the safe
 * defaults below: a visible preview with every cloud capability switched off.
 */

/** Safe defaults used when a variable is missing, empty, or invalid. */
export const nexusCloudDefaults: NexusCloudConfig = {
  status: "preview",
  previewVisible: true,
  portalPreviewVisible: true,
  cloudChatEnabled: false,
  syncEnabled: false,
  deviceSyncEnabled: false,
  apiBaseUrl: null,
};

function readRawEnv(key: string): string | undefined {
  // Indexed access keeps this resilient when a variable is absent entirely.
  const env = import.meta.env as unknown as Record<string, unknown>;
  const value = env[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Unrecognised values fall back rather than throwing, so a bad value cannot break the build. */
export function parseBooleanFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const value = raw.toLowerCase();
  if (value === "true" || value === "1" || value === "on") return true;
  if (value === "false" || value === "0" || value === "off") return false;
  return fallback;
}

/** Unknown status strings degrade to `preview`, never to `available`. */
export function parseCloudStatus(raw: string | undefined): NexusCloudStatus {
  if (raw === undefined) return nexusCloudDefaults.status;
  const value = raw.toLowerCase();
  return (nexusCloudStatusValues as readonly string[]).includes(value)
    ? (value as NexusCloudStatus)
    : nexusCloudDefaults.status;
}

const privateHostPattern =
  /^(localhost|127\.|0\.0\.0\.0$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|.*\.local$)/i;

/**
 * Accepts only an absolute https origin on a public host.
 *
 * Rejecting plain http and private/loopback hosts means this value can never be
 * pointed at the user's LAN Mirror Gateway on a private address, so browser-side
 * code cannot be configured to call the private gateway.
 */
export function parseApiBaseUrl(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (privateHostPattern.test(url.hostname)) return null;
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}`;
}

export function readNexusCloudConfig(): NexusCloudConfig {
  const status = parseCloudStatus(readRawEnv("VITE_NEXUS_CLOUD_STATUS"));
  const apiBaseUrl = parseApiBaseUrl(readRawEnv("VITE_NEXUS_CLOUD_API_BASE_URL"));

  // Cloud capabilities require an explicit opt-in *and* a status that is past
  // preview. A `preview` build therefore cannot enable chat or sync by accident.
  const cloudReady = status === "private-beta" || status === "available";
  const enableIfReady = (key: string) => cloudReady && parseBooleanFlag(readRawEnv(key), false);

  return {
    status,
    previewVisible: parseBooleanFlag(readRawEnv("VITE_NEXUS_CLOUD_PREVIEW"), nexusCloudDefaults.previewVisible),
    portalPreviewVisible: parseBooleanFlag(
      readRawEnv("VITE_NEXUS_CLOUD_PORTAL"),
      nexusCloudDefaults.portalPreviewVisible,
    ),
    cloudChatEnabled: enableIfReady("VITE_NEXUS_CLOUD_CHAT"),
    syncEnabled: enableIfReady("VITE_NEXUS_CLOUD_SYNC"),
    deviceSyncEnabled: enableIfReady("VITE_NEXUS_DEVICE_SYNC"),
    apiBaseUrl,
  };
}

export const nexusCloudConfig: NexusCloudConfig = readNexusCloudConfig();
