import { createHash } from "node:crypto";

export function releaseStorageFingerprint(input: { endpoint: string; bucket: string; region: string; publicBaseUrl: string; accessKeyId: string; secretAccessKey: string }): string {
  const canonical = [input.endpoint.trim().replace(/\/$/, "").toLowerCase(), input.bucket.trim(), input.region.trim().toLowerCase(), input.accessKeyId, input.secretAccessKey, input.publicBaseUrl.trim().replace(/\/$/, "").toLowerCase()].join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
