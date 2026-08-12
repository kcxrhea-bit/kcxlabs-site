import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { basename, dirname, extname, join, parse } from "node:path";
import type { DevicePairingStatus, MediaLocalFile, MediaUploadRecord, MediaVisibility, OperationResult } from "../src/shared/desktop";

const API_BASE = "https://kcxlabs.org/api";
export const RECORDING_INBOX = "D:\\Fortnite screen recordings\\Recorded-to-send";
export const SENT_MEDIA_FOLDER = "D:\\Fortnite screen recordings\\Sent-to-Website";
export const SUPPORTED_VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"]);

// KCx Media Center is one publishing pipeline: every desktop upload becomes a public,
// shareable KCx Clip. The server still models private/unlisted/public for API compatibility
// (see src/media/types.ts), so this is the one canonical value the desktop ever sends — the
// user is never asked to choose.
const CANONICAL_MEDIA_VISIBILITY: MediaVisibility = "public";

// Matches api/media/check-hash.ts's response shape on the server.
type CheckHashResponse = { duplicate: boolean; media: { id: string; publicId: string } | null };
// Matches api/media/upload-authorize.ts. The "duplicate" branch can happen even here (a race
// against another upload of the same file), so both shapes must be handled.
type AuthorizeResponse =
  | { duplicate: true; mediaId: string; publicId: string; shareUrl: string }
  | { duplicate: false; mediaId: string; publicId: string; authorization: { url: string; method: "PUT"; headers: Record<string, string> } };
// Matches api/media/finalize.ts.
type FinalizeResponse = { item: { publicId: string }; shareUrl: string; idempotent: boolean };
// Matches api/auth/pair.ts.
type PairResponse = { token: string; expiresAt: string };

type ProgressCallback = (record: MediaUploadRecord) => void;
type StoredDeviceToken = { token: string; deviceName: string; expiresAt: string };

// Handles the whole hash → check-hash → upload-authorize → R2 PUT → finalize flow from the
// Electron main process, authenticated as a paired device against the real KCx media API
// (api/media/*.ts, api/auth/pair.ts in this repo). The renderer only ever sees MediaUploadRecord
// and DevicePairingStatus snapshots: it never receives the presigned upload URL, the upload
// headers, or the device bearer token.
export class MediaService {
  private readonly recordsFile: string;
  private readonly deviceTokenFile: string;

  constructor(userData: string) {
    this.recordsFile = join(userData, "media-uploads.json");
    this.deviceTokenFile = join(userData, "media-device.json");
  }

  get recordingInbox(): string {
    return RECORDING_INBOX;
  }

  async describeFiles(filePaths: string[]): Promise<MediaLocalFile[]> {
    const described = await Promise.all(filePaths.map(async (filePath) => {
      if (!SUPPORTED_VIDEO_EXTENSIONS.has(extname(filePath).toLowerCase())) return null;
      const info = await stat(filePath);
      return info.isFile() ? { filePath, fileName: basename(filePath), bytes: info.size } : null;
    }));
    return described.filter((file): file is MediaLocalFile => file !== null);
  }

  async scanInbox(): Promise<MediaLocalFile[]> {
    try {
      const entries = await readdir(RECORDING_INBOX, { withFileTypes: true });
      return this.describeFiles(entries.filter((entry) => entry.isFile()).map((entry) => join(RECORDING_INBOX, entry.name)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  // ─── Device pairing ──────────────────────────────────────────────────────

  async getPairingStatus(): Promise<DevicePairingStatus> {
    const stored = await this.readDeviceToken();
    return stored ? { paired: true, deviceName: stored.deviceName, expiresAt: stored.expiresAt } : { paired: false, deviceName: null, expiresAt: null };
  }

  async pair(email: string, password: string, deviceName: string): Promise<OperationResult> {
    try {
      const response = await this.postJson<PairResponse>(`${API_BASE}/auth/pair`, { email, password, deviceName }, null);
      await this.writeDeviceToken({ token: response.token, deviceName, expiresAt: response.expiresAt });
      return { ok: true, message: `Paired as "${deviceName}". Token expires ${response.expiresAt}.` };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  // The server has no self-revoke route reachable without a device-token id the pairing
  // response never returns, so this forgets the credential locally. The token itself remains
  // valid server-side until it expires; revoking it server-side requires the admin session.
  async unpair(): Promise<OperationResult> {
    await this.writeDeviceToken(null);
    return { ok: true, message: "Device credential removed from this machine. It remains valid on the server until it expires." };
  }

  // ─── Upload flow ─────────────────────────────────────────────────────────

  async listPending(): Promise<MediaUploadRecord[]> {
    const records = await this.readRecords();
    return records.filter((record) => record.objectUploaded && record.stage === "failed");
  }

  async upload(filePath: string, onProgress: ProgressCallback): Promise<MediaUploadRecord> {
    const id = randomUUID();
    let record: MediaUploadRecord = {
      id,
      fileName: basename(filePath),
      filePath,
      bytes: 0,
      sha256: null,
      stage: "hashing",
      progress: 0,
      visibility: CANONICAL_MEDIA_VISIBILITY,
      mediaId: null,
      objectUploaded: false,
      publicId: null,
      shareUrl: null,
      duplicate: false,
      error: null,
      moveError: null,
      movedTo: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const emit = async (patch: Partial<MediaUploadRecord>) => {
      record = { ...record, ...patch, updatedAt: new Date().toISOString() };
      onProgress(record);
      await this.saveRecord(record);
      return record;
    };

    try {
      const token = await this.requireToken();

      const info = await stat(filePath);
      if (!info.isFile()) throw new Error("The selected path is not a file.");
      if (info.size === 0) throw new Error("The selected file is empty.");
      await emit({ bytes: info.size, stage: "hashing" });

      const sha256 = await this.sha256File(filePath, info.size, (progress) => onProgress({ ...record, progress }));
      await emit({ sha256, stage: "checking", progress: 0 });

      const check = await this.postJson<CheckHashResponse>(`${API_BASE}/media/check-hash`, { sha256 }, token);
      if (check.duplicate && check.media) {
        const published = await emit({ stage: "finalized", duplicate: true, mediaId: check.media.id, publicId: check.media.publicId });
        return this.movePublishedFile(published, onProgress);
      }

      await emit({ stage: "authorizing" });
      const authorize = await this.postJson<AuthorizeResponse>(
        `${API_BASE}/media/upload-authorize`,
        { filename: record.fileName, sizeBytes: info.size, sha256, visibility: record.visibility },
        token,
      );
      if (authorize.duplicate) {
        const published = await emit({ stage: "finalized", duplicate: true, mediaId: authorize.mediaId, publicId: authorize.publicId, shareUrl: authorize.shareUrl });
        return this.movePublishedFile(published, onProgress);
      }
      await emit({ stage: "uploading", mediaId: authorize.mediaId, publicId: authorize.publicId, progress: 0 });

      await this.putFile(authorize.authorization.url, filePath, info.size, authorize.authorization.headers, (progress) => onProgress({ ...record, progress }));
      await emit({ stage: "uploaded", objectUploaded: true, progress: 100 });

      const published = await this.finalize(id, onProgress);
      return published.stage === "finalized" ? this.movePublishedFile(published, onProgress) : published;
    } catch (error) {
      return emit({ stage: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  }

  async retryFinalize(id: string, onProgress: ProgressCallback): Promise<MediaUploadRecord> {
    const records = await this.readRecords();
    const existing = records.find((candidate) => candidate.id === id);
    if (!existing) throw new Error("No pending upload was found for that id.");
    if (!existing.objectUploaded) throw new Error("The file upload did not complete, so there is nothing to finalize. Start a new upload instead.");
    onProgress(existing);
    const published = await this.finalize(id, onProgress);
    return published.stage === "finalized" ? this.movePublishedFile(published, onProgress) : published;
  }

  async movePublishedFile(record: MediaUploadRecord, onProgress: ProgressCallback, destinationFolder = SENT_MEDIA_FOLDER): Promise<MediaUploadRecord> {
    if (record.stage !== "finalized") throw new Error("A clip can only move after it is finalized or verified as an existing duplicate.");
    const emit = async (patch: Partial<MediaUploadRecord>) => {
      const next = { ...record, ...patch, updatedAt: new Date().toISOString() };
      record = next;
      onProgress(next);
      await this.saveRecord(next);
      return next;
    };
    try {
      await emit({ stage: "moving", moveError: null });
      await mkdir(destinationFolder, { recursive: true });
      const target = await this.availableMovePath(destinationFolder, record.fileName);
      await rename(record.filePath, target);
      return emit({ stage: "moved", movedTo: target });
    } catch (error) {
      return emit({ stage: "finalized", moveError: error instanceof Error ? error.message : String(error) });
    }
  }

  private async availableMovePath(destinationFolder: string, fileName: string): Promise<string> {
    const parts = parse(fileName);
    for (let suffix = 0; ; suffix += 1) {
      const candidate = join(destinationFolder, suffix === 0 ? fileName : `${parts.name} (${suffix})${parts.ext}`);
      try {
        await stat(candidate);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return candidate;
        throw error;
      }
    }
  }

  private async finalize(id: string, onProgress: ProgressCallback): Promise<MediaUploadRecord> {
    const records = await this.readRecords();
    let record = records.find((candidate) => candidate.id === id);
    if (!record) throw new Error("No pending upload was found for that id.");
    if (!record.objectUploaded || !record.mediaId) throw new Error("The file upload did not complete; retry the upload instead of finalizing.");
    const emit = async (patch: Partial<MediaUploadRecord>) => {
      record = { ...(record as MediaUploadRecord), ...patch, updatedAt: new Date().toISOString() };
      onProgress(record);
      await this.saveRecord(record);
      return record;
    };

    try {
      const token = await this.requireToken();
      await emit({ stage: "finalizing", error: null });
      const result = await this.postJson<FinalizeResponse>(`${API_BASE}/media/finalize`, { mediaId: record.mediaId }, token);
      return await emit({ stage: "finalized", publicId: result.item.publicId, shareUrl: result.shareUrl });
    } catch (error) {
      return emit({ stage: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async requireToken(): Promise<string> {
    const stored = await this.readDeviceToken();
    if (!stored) throw new Error("This device is not paired. Pair it with your KCx Labs owner account before uploading.");
    if (new Date(stored.expiresAt).getTime() <= Date.now()) throw new Error("The device pairing has expired. Pair this device again.");
    return stored.token;
  }

  private sha256File(filePath: string, totalBytes: number, onProgress: (percent: number) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash("sha256");
      const stream = createReadStream(filePath);
      let read = 0;
      stream.on("error", reject);
      stream.on("data", (chunk) => {
        hash.update(chunk);
        read += chunk.length;
        onProgress(totalBytes ? Math.round((read / totalBytes) * 100) : 0);
      });
      stream.on("end", () => resolve(hash.digest("hex")));
    });
  }

  private putFile(url: string, filePath: string, totalBytes: number, headers: Record<string, string>, onProgress: (percent: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const target = new URL(url);
      const requestFn = target.protocol === "http:" ? httpRequest : httpsRequest;
      // `headers` comes straight from the server's presigned authorization and must be sent
      // exactly as given — R2 signs against it, so adding or altering a header breaks the signature.
      const req = requestFn(target, { method: "PUT", headers }, (res) => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          let body = "";
          res.on("data", (chunk) => (body += String(chunk)));
          res.on("end", () => reject(new Error(`Upload to storage failed: ${res.statusCode} ${body}`.trim())));
          return;
        }
        res.resume();
        res.on("end", () => resolve());
      });
      req.on("error", reject);
      const stream = createReadStream(filePath);
      let written = 0;
      stream.on("error", reject);
      stream.on("data", (chunk) => {
        written += chunk.length;
        onProgress(totalBytes ? Math.round((written / totalBytes) * 100) : 0);
      });
      stream.pipe(req);
    });
  }

  private async postJson<T>(url: string, body: unknown, token: string | null): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new Error(`${url} failed: ${response.status} ${detail}`.trim());
    }
    return (await response.json()) as T;
  }

  private async readDeviceToken(): Promise<StoredDeviceToken | null> {
    try {
      return JSON.parse(await readFile(this.deviceTokenFile, "utf8")) as StoredDeviceToken;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async writeDeviceToken(value: StoredDeviceToken | null): Promise<void> {
    await mkdir(dirname(this.deviceTokenFile), { recursive: true });
    if (value === null) {
      await writeFile(this.deviceTokenFile, "null", "utf8");
      return;
    }
    const temp = `${this.deviceTokenFile}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(value), "utf8");
    await rename(temp, this.deviceTokenFile);
  }

  private async readRecords(): Promise<MediaUploadRecord[]> {
    try {
      return JSON.parse(await readFile(this.recordsFile, "utf8")) as MediaUploadRecord[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async saveRecord(record: MediaUploadRecord): Promise<void> {
    const records = await this.readRecords();
    const next = [record, ...records.filter((candidate) => candidate.id !== record.id)].slice(0, 100);
    await mkdir(dirname(this.recordsFile), { recursive: true });
    const temp = `${this.recordsFile}.${randomUUID()}.tmp`;
    await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await rename(temp, this.recordsFile);
  }
}
