import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { CopyObjectCommand, DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { headObject } from "../server/media-api/_lib/r2";
import type { ArtifactPublisher, RemoteArtifact } from "./artifact-publisher";

export type ReleaseStorageConfig = { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string; publicBaseUrl: string | null };

export function loadReleaseStorageConfig(env: NodeJS.ProcessEnv = process.env): ReleaseStorageConfig | null {
  const endpoint = env.RELEASE_R2_ENDPOINT?.trim(); const bucket = env.RELEASE_R2_BUCKET?.trim(); const accessKeyId = env.RELEASE_R2_ACCESS_KEY_ID?.trim(); const secretAccessKey = env.RELEASE_R2_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, bucket, region: env.RELEASE_R2_REGION?.trim() || "auto", accessKeyId, secretAccessKey, publicBaseUrl: env.RELEASE_R2_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "") || null };
}

export class R2ReleaseArtifactProvider implements ArtifactPublisher {
  private readonly client: S3Client;
  constructor(private readonly config: ReleaseStorageConfig) { this.client = new S3Client({ endpoint: config.endpoint, region: config.region, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }); }
  async testConnection(): Promise<void> { await headObject({ client: this.client, bucket: this.config.bucket }, "releases/_kcx-provider-test/nonexistent/connection-check"); }
  async head(key: string) { if (!key.startsWith("releases/_kcx-provider-test/")) throw new Error("Provider head is restricted to the probe namespace."); return headObject({ client: this.client, bucket: this.config.bucket }, key); }
  async copyObject(sourceKey: string, destinationKey: string, expected: { size: number; sha256: string }): Promise<RemoteArtifact> {
    if (!sourceKey.startsWith("releases/") || !destinationKey.startsWith("releases/") || sourceKey.includes("..") || destinationKey.includes("..")) throw new Error("Release object key is outside the allowed namespace.");
    const source = await headObject({ client: this.client, bucket: this.config.bucket }, sourceKey);
    if (!source.exists || source.sizeBytes !== expected.size || source.sha256?.toUpperCase() !== expected.sha256.toUpperCase()) throw new Error("Source release object verification failed.");
    const existing = await headObject({ client: this.client, bucket: this.config.bucket }, destinationKey);
    if (existing.exists && (existing.sizeBytes !== expected.size || existing.sha256?.toUpperCase() !== expected.sha256.toUpperCase())) throw new Error("Canonical release object collision.");
    if (!existing.exists) await this.client.send(new CopyObjectCommand({ Bucket: this.config.bucket, Key: destinationKey, CopySource: encodeURIComponent(`${this.config.bucket}/${sourceKey}`) }));
    const verified = await headObject({ client: this.client, bucket: this.config.bucket }, destinationKey);
    if (!verified.exists || verified.sizeBytes !== expected.size || verified.sha256?.toUpperCase() !== expected.sha256.toUpperCase()) throw new Error("Canonical release object verification failed.");
    return { objectKey: destinationKey, publicUrl: this.config.publicBaseUrl ? `${this.config.publicBaseUrl}/${destinationKey}` : undefined, size: verified.sizeBytes, sha256: verified.sha256 ?? undefined, etag: verified.etag ?? undefined };
  }
  async delete(key: string): Promise<void> { if (!key.startsWith("releases/_kcx-provider-test/")) throw new Error("Provider delete is restricted to the probe namespace."); await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key })); }
  async upload(input: { key: string; path: string; contentType: string; sha256?: string }): Promise<RemoteArtifact> {
    const existing = await headObject({ client: this.client, bucket: this.config.bucket }, input.key);
    const info = await stat(input.path);
    if (existing.exists) { if (existing.sizeBytes === info.size && (!input.sha256 || existing.sha256?.toUpperCase() === input.sha256.toUpperCase())) return { objectKey: input.key, publicUrl: this.config.publicBaseUrl ? `${this.config.publicBaseUrl}/${input.key}` : undefined, size: existing.sizeBytes ?? 0, sha256: existing.sha256 ?? undefined, etag: existing.etag ?? undefined }; throw new Error(`Release object collision at ${input.key}.`); }
    await this.client.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: input.key, Body: createReadStream(input.path), ContentLength: info.size, ContentType: input.contentType, Metadata: input.sha256 ? { sha256: input.sha256.toLowerCase() } : undefined }));
    const verified = await headObject({ client: this.client, bucket: this.config.bucket }, input.key);
    if (!verified.exists || verified.sizeBytes !== info.size || (input.sha256 && verified.sha256?.toUpperCase() !== input.sha256.toUpperCase())) throw new Error("Remote release object verification failed.");
    return { objectKey: input.key, publicUrl: this.config.publicBaseUrl ? `${this.config.publicBaseUrl}/${input.key}` : undefined, size: verified.sizeBytes, sha256: verified.sha256 ?? undefined, etag: verified.etag ?? undefined };
  }
}

export function createReleaseArtifactProvider(env: NodeJS.ProcessEnv = process.env): R2ReleaseArtifactProvider | undefined { const config = loadReleaseStorageConfig(env); return config ? new R2ReleaseArtifactProvider(config) : undefined; }
export function createReleaseArtifactProviderFromConfig(config: Omit<ReleaseStorageConfig, "accessKeyId" | "secretAccessKey"> | null, secrets: { accessKeyId: string; secretAccessKey: string }): R2ReleaseArtifactProvider | undefined { return config?.endpoint && config.bucket && secrets.accessKeyId && secrets.secretAccessKey ? new R2ReleaseArtifactProvider({ ...config, ...secrets }) : undefined; }
