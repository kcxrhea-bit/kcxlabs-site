import { API_ORIGIN, authorizeUpload, checkHash, finalizeUpload, type FinalizeResponse, type Visibility } from "./api";
import type { DeviceCredential } from "./secure";

export type UploadPhase = "hashing" | "checking" | "authorizing" | "uploading" | "finalizing" | "published" | "failed";
export type PendingFinalize = { mediaId: string; filename: string; createdAt: string };

export async function hashFile(file: File): Promise<string> { const data = await crypto.subtle.digest("SHA-256", await file.arrayBuffer()); return [...new Uint8Array(data)].map((part) => part.toString(16).padStart(2, "0")).join(""); }

function putFile(url: string, file: File, headers: Record<string, string>, onProgress: (value: number) => void): Promise<void> { return new Promise((resolve, reject) => { const xhr = new XMLHttpRequest(); xhr.open("PUT", url); Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value)); xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)); }; xhr.onerror = () => reject(new Error("Upload to storage failed. Check your connection and retry.")); xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload to storage failed: ${xhr.status}`)); xhr.send(file); }); }

export async function uploadFile(file: File, visibility: Visibility, credential: DeviceCredential, onUpdate: (phase: UploadPhase, progress: number, detail?: string) => void, savePending: (pending: PendingFinalize) => Promise<void>, clearPending: (mediaId: string) => Promise<void>): Promise<{ duplicate: boolean; shareUrl: string; publicId: string }> {
  try {
    onUpdate("hashing", 0, "Calculating SHA-256 on this device"); const sha256 = await hashFile(file);
    onUpdate("checking", 0, "Checking whether this clip already exists"); const check = await checkHash(sha256, credential);
    if (check.duplicate && check.media) return { duplicate: true, publicId: check.media.publicId, shareUrl: `${API_ORIGIN}/c/${check.media.publicId}` };
    onUpdate("authorizing", 0, "Requesting a short-lived upload authorization"); const authorization = await authorizeUpload({ filename: file.name, sizeBytes: file.size, sha256, visibility, mimeType: file.type || "application/octet-stream" }, credential);
    if (authorization.duplicate) return { duplicate: true, publicId: authorization.publicId, shareUrl: authorization.shareUrl };
    onUpdate("uploading", 0, "Uploading directly to secure storage"); await putFile(authorization.authorization.url, file, authorization.authorization.headers, (progress) => onUpdate("uploading", progress));
    await savePending({ mediaId: authorization.mediaId, filename: file.name, createdAt: new Date().toISOString() }); onUpdate("finalizing", 100, "Verifying and publishing the uploaded clip");
    const finalized = await finalizeUpload(authorization.mediaId, credential); await clearPending(authorization.mediaId); return { duplicate: false, publicId: finalized.item.publicId, shareUrl: finalized.shareUrl };
  } catch (error) { onUpdate("failed", 0, error instanceof Error ? error.message : "Upload failed."); throw error; }
}

export async function retryFinalize(pending: PendingFinalize, credential: DeviceCredential, clearPending: (mediaId: string) => Promise<void>): Promise<FinalizeResponse> { const result = await finalizeUpload(pending.mediaId, credential); await clearPending(pending.mediaId); return result; }
