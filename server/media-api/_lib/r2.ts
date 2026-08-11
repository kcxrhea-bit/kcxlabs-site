/**
 * Cloudflare R2 client, via the S3-compatible API.
 *
 * Only the operations the product actually needs are exposed. In particular
 * there is deliberately NO general bucket listing: nothing in the design needs
 * to enumerate the bucket, and not having the capability means a compromised
 * handler cannot use it to inventory the account.
 *
 * Credentials are bucket-scoped and live only in server-side environment
 * variables. They are never sent to the renderer, the desktop, or the browser —
 * the desktop receives short-lived presigned URLs scoped to a single key.
 *
 * NOT YET VERIFIED against a live bucket at the time of writing.
 */

import {
  S3Client,
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { R2Config } from "./config.js";

/**
 * R2 requires region "auto". The S3 SDK insists on a region being set, and any
 * other value is rejected by R2.
 */
export function createR2Client(config: R2Config): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

/**
 * Presigned URL lifetime. Short by design: long enough for a slow first byte,
 * short enough that a leaked URL is near-worthless. Individual parts of a large
 * multipart upload each get their own URL, so this does not limit total upload
 * time — only the time before a given part starts.
 */
export const PRESIGN_TTL_SECONDS = 15 * 60;

export type R2Context = {
  client: S3Client;
  bucket: string;
};

export function r2Context(config: R2Config): R2Context {
  return { client: createR2Client(config), bucket: config.bucket };
}

// ─── Object inspection ───────────────────────────────────────────────────────

export type ObjectHead = {
  exists: boolean;
  sizeBytes: number | null;
  sha256: string | null;
  etag: string | null;
  contentType: string | null;
  lastModified: string | null;
};

/**
 * HEAD an object. A missing object is reported as `exists: false` rather than
 * throwing, because "is it there?" is a normal question during finalize.
 */
export async function headObject(context: R2Context, key: string): Promise<ObjectHead> {
  try {
    const response = await context.client.send(
      new HeadObjectCommand({ Bucket: context.bucket, Key: key }),
    );
    return {
      exists: true,
      sizeBytes: typeof response.ContentLength === "number" ? response.ContentLength : null,
      sha256: response.Metadata?.sha256?.toLowerCase() ?? null,
      etag: response.ETag ?? null,
      contentType: response.ContentType ?? null,
      lastModified: response.LastModified?.toISOString() ?? null,
    };
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    const name = (error as { name?: string })?.name;
    if (status === 404 || name === "NotFound" || name === "NoSuchKey") {
      return { exists: false, sizeBytes: null, sha256: null, etag: null, contentType: null, lastModified: null };
    }
    throw error;
  }
}

// ─── Single-shot upload authorization ────────────────────────────────────────

export type PresignedUpload = {
  url: string;
  method: "PUT";
  /** Headers the client MUST send, or the signature will not match. */
  headers: Record<string, string>;
  key: string;
  expiresInSeconds: number;
};

/**
 * Presign a PUT for exactly one key.
 *
 * `ContentLength` and `ContentType` are part of the signature, so the resulting
 * URL cannot be reused to upload a different size or a different content type,
 * and cannot be pointed at another key. This is what keeps the authorization
 * narrow rather than a general write capability.
 */
export async function presignUpload(
  context: R2Context,
  input: { key: string; contentType: string; sizeBytes: number; sha256?: string },
): Promise<PresignedUpload> {
  const command = new PutObjectCommand({
    Bucket: context.bucket,
    Key: input.key,
    ContentType: input.contentType,
    ContentLength: input.sizeBytes,
    ...(input.sha256 ? { Metadata: { sha256: input.sha256.toLowerCase() } } : {}),
  });

  const url = await getSignedUrl(context.client, command, {
    expiresIn: PRESIGN_TTL_SECONDS,
    ...(input.sha256 ? { unhoistableHeaders: new Set(["x-amz-meta-sha256"]) } : {}),
  });

  return {
    url,
    method: "PUT",
    headers: {
      "Content-Type": input.contentType,
      "Content-Length": String(input.sizeBytes),
      ...(input.sha256 ? { "x-amz-meta-sha256": input.sha256.toLowerCase() } : {}),
    },
    key: input.key,
    expiresInSeconds: PRESIGN_TTL_SECONDS,
  };
}

// ─── Multipart upload ────────────────────────────────────────────────────────

/**
 * Threshold above which multipart is used. Gameplay clips routinely exceed
 * this, and multipart is what makes a failure at 95% retry one part rather
 * than the whole file.
 */
export const MULTIPART_THRESHOLD_BYTES = 100 * 1024 * 1024;
export const MULTIPART_PART_SIZE_BYTES = 32 * 1024 * 1024;

export function shouldUseMultipart(sizeBytes: number): boolean {
  return sizeBytes > MULTIPART_THRESHOLD_BYTES;
}

export function partCountFor(sizeBytes: number, partSize = MULTIPART_PART_SIZE_BYTES): number {
  return Math.max(1, Math.ceil(sizeBytes / partSize));
}

export type MultipartAuthorization = {
  uploadId: string;
  key: string;
  partSizeBytes: number;
  parts: { partNumber: number; url: string }[];
  expiresInSeconds: number;
};

export async function createMultipartUpload(
  context: R2Context,
  input: { key: string; contentType: string; sizeBytes: number },
): Promise<MultipartAuthorization> {
  const created = await context.client.send(
    new CreateMultipartUploadCommand({
      Bucket: context.bucket,
      Key: input.key,
      ContentType: input.contentType,
    }),
  );

  const uploadId = created.UploadId;
  if (typeof uploadId !== "string") {
    throw new Error("R2 did not return an upload id for the multipart upload.");
  }

  const total = partCountFor(input.sizeBytes);
  const parts: { partNumber: number; url: string }[] = [];

  for (let partNumber = 1; partNumber <= total; partNumber += 1) {
    const url = await getSignedUrl(
      context.client,
      new UploadPartCommand({
        Bucket: context.bucket,
        Key: input.key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: PRESIGN_TTL_SECONDS },
    );
    parts.push({ partNumber, url });
  }

  return {
    uploadId,
    key: input.key,
    partSizeBytes: MULTIPART_PART_SIZE_BYTES,
    parts,
    expiresInSeconds: PRESIGN_TTL_SECONDS,
  };
}

export async function completeMultipartUpload(
  context: R2Context,
  input: { key: string; uploadId: string; parts: { partNumber: number; etag: string }[] },
): Promise<void> {
  await context.client.send(
    new CompleteMultipartUploadCommand({
      Bucket: context.bucket,
      Key: input.key,
      UploadId: input.uploadId,
      MultipartUpload: {
        // R2, like S3, requires parts in ascending order.
        Parts: [...input.parts]
          .sort((a, b) => a.partNumber - b.partNumber)
          .map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
      },
    }),
  );
}

/**
 * Abort a multipart upload, discarding any parts already stored.
 *
 * Worth calling on failure: abandoned parts still occupy bucket storage and are
 * exactly the kind of untracked bytes the local estimate cannot see.
 */
export async function abortMultipartUpload(
  context: R2Context,
  input: { key: string; uploadId: string },
): Promise<void> {
  await context.client.send(
    new AbortMultipartUploadCommand({
      Bucket: context.bucket,
      Key: input.key,
      UploadId: input.uploadId,
    }),
  );
}

// ─── Download and delete ─────────────────────────────────────────────────────

/**
 * Presigned GET, used by the desktop to download an original for archiving and
 * by the share page for media delivery when no custom domain is configured.
 *
 * `disposition` forces a download for content types that must never render
 * inline under the site origin.
 */
export async function presignDownload(
  context: R2Context,
  input: { key: string; disposition?: "inline" | "attachment"; filename?: string },
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: context.bucket,
    Key: input.key,
    ...(input.disposition
      ? {
          ResponseContentDisposition: input.filename
            ? `${input.disposition}; filename="${input.filename.replace(/"/g, "")}"`
            : input.disposition,
        }
      : {}),
  });
  return getSignedUrl(context.client, command, { expiresIn: PRESIGN_TTL_SECONDS });
}

/**
 * Delete one object.
 *
 * This function is intentionally dumb: it deletes what it is told to. Every
 * safety decision — verified local archive, Keep Online, archive state — is
 * made by the caller before it gets here, and is enforced independently by the
 * database CHECK constraints. Do not add a "convenience" caller that skips them.
 */
export async function deleteObject(context: R2Context, key: string): Promise<void> {
  await context.client.send(new DeleteObjectCommand({ Bucket: context.bucket, Key: key }));
}
