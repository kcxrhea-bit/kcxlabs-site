/** Single source of truth for the SnapCal API version. Kept in its own file so route modules stay default-export-only (mixing named and default exports in an esbuild-bundled route trips a real Node CJS/ESM interop quirk where the default import resolves to the whole module object instead of the unwrapped default). */
export const SNAPCAL_API_VERSION = 1;
