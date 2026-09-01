import { basename } from "node:path";
import { stat } from "node:fs/promises";
import { ArtifactRecord, verifyArtifact } from "./artifact-registry";

export type RemoteArtifact = { objectKey: string; publicUrl?: string; size: number; sha256?: string; etag?: string };
export type ArtifactPublisher = { upload(input: { key: string; path: string; contentType: string; sha256: string }): Promise<RemoteArtifact> };
export type ReleaseObjectProvider = { copyObject(sourceKey: string, destinationKey: string, expected: { size: number; sha256: string }): Promise<RemoteArtifact> };

const platformAliases: Record<string, string> = { win: "windows", win32: "windows", windows: "windows", android: "android", linux: "linux", ubuntu: "linux", mac: "macos", macos: "macos", darwin: "macos", osx: "macos" };
export function normalizeArtifactPlatform(platform?: string | null): string | undefined { const value = platform?.trim().toLowerCase(); return value ? platformAliases[value] : undefined; }
export function resolveArtifactPlatform(record: ArtifactRecord): string | undefined { const explicit = normalizeArtifactPlatform(record.platform); if (explicit) return explicit; const extension = basename(record.filename).toLowerCase().match(/\.[^.]+$/)?.[0]; return extension === ".exe" || extension === ".msi" ? "windows" : extension === ".apk" ? "android" : extension === ".appimage" ? "linux" : extension === ".dmg" ? "macos" : undefined; }

export function artifactRemoteKey(record: ArtifactRecord): string {
  const safe = basename(record.filename).replace(/[^a-zA-Z0-9._-]/g, "-");
  const platform = resolveArtifactPlatform(record); if (!platform) throw new Error("Artifact platform is unresolved; publication is refused.");
  return `releases/${record.projectId}/${record.version ?? "unversioned"}/${platform}/${record.architecture.toLowerCase().replace(/[^a-z0-9-]/g, "-")}/${record.target.toLowerCase().replace(/[^a-z0-9-]/g, "-")}/${safe}`;
}

export async function reconcilePublishedArtifact(record: ArtifactRecord, provider: ReleaseObjectProvider, publicBaseUrl: string, fetchImpl: typeof fetch = globalThis.fetch): Promise<ArtifactRecord> {
  if (record.publicationStatus !== "PUBLISHED") throw new Error("Only a PUBLISHED artifact can be reconciled.");
  if (!record.remoteObjectKey) throw new Error("Published artifact has no recorded remote object key.");
  const destinationKey = artifactRemoteKey(record);
  if (destinationKey === record.remoteObjectKey) throw new Error("Published artifact already uses its canonical remote key.");
  if (!publicBaseUrl) throw new Error("Public release base URL is not configured.");
  const result = await provider.copyObject(record.remoteObjectKey, destinationKey, { size: record.bytes, sha256: record.sha256 });
  const response = await fetchImpl(`${publicBaseUrl.replace(/\/+$/, "")}/${destinationKey}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (!response.ok || data.length !== record.bytes) throw new Error("Canonical public release URL verification failed.");
  return { ...record, platform: resolveArtifactPlatform(record), remoteObjectKey: result.objectKey, publicationDestination: result.publicUrl, remoteSize: result.size, remoteSha256: result.sha256, remoteEtag: result.etag };
}

export async function publishArtifact(record: ArtifactRecord, publisher: ArtifactPublisher | undefined): Promise<ArtifactRecord> {
  if (record.validationStatus !== "STAGED") throw new Error("Only a STAGED artifact can be published.");
  if (!publisher) throw new Error("No artifact publishing backend is configured.");
  const verified = await verifyArtifact(record);
  const platform = resolveArtifactPlatform(verified);
  if (!platform) throw new Error("Artifact platform is unresolved; publication is refused.");
  const result = await publisher.upload({ key: artifactRemoteKey(verified), path: verified.stagedPath ?? verified.sourcePath, sha256: verified.sha256, contentType: record.filename.toLowerCase().endsWith(".exe") ? "application/vnd.microsoft.portable-executable" : "application/octet-stream" });
  const info = await stat(verified.stagedPath ?? verified.sourcePath);
  if (result.size !== info.size) throw new Error(`Remote artifact size mismatch: expected ${info.size}, found ${result.size}`);
  if (result.sha256 && result.sha256.toUpperCase() !== verified.sha256.toUpperCase()) throw new Error("Remote artifact SHA-256 mismatch.");
  return { ...verified, platform, publicationStatus: "PUBLISHED", publicationDestination: result.publicUrl, remoteObjectKey: result.objectKey, remoteSize: result.size, remoteSha256: result.sha256, remoteEtag: result.etag, publishedAt: new Date().toISOString() };
}
