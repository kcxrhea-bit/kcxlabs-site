/// <reference types="vite/client" />

/**
 * Public build-time configuration for the NEXUS cloud preview.
 *
 * Every value here is inlined into the client bundle and is readable by anyone
 * who visits the site. Never declare a secret, token, or provider API key here.
 * All entries are optional; see src/cloud/config.ts for the safe defaults.
 */
interface ImportMetaEnv {
  /** disabled | preview | private-beta | available. Unknown values fall back to preview. */
  readonly VITE_NEXUS_CLOUD_STATUS?: string;
  /** Show the public Hybrid Cloud product page. Defaults to true. */
  readonly VITE_NEXUS_CLOUD_PREVIEW?: string;
  /** Show the portal preview page. Defaults to true. */
  readonly VITE_NEXUS_CLOUD_PORTAL?: string;
  /** Cloud chat. Defaults to false and is ignored while status is preview. */
  readonly VITE_NEXUS_CLOUD_CHAT?: string;
  /** Project synchronization. Defaults to false and is ignored while status is preview. */
  readonly VITE_NEXUS_CLOUD_SYNC?: string;
  /** Device synchronization. Defaults to false and is ignored while status is preview. */
  readonly VITE_NEXUS_DEVICE_SYNC?: string;
  /** Absolute https origin of a future cloud API. Non-https and private hosts are rejected. */
  readonly VITE_NEXUS_CLOUD_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
