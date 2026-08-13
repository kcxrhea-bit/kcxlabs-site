import type { DeviceCredential } from "./secure";

export const API_ORIGIN = "https://kcxlabs.org";
export type Visibility = "private" | "unlisted" | "public";
export type MediaItem = { id: string; publicId: string; title: string; originalFilename: string; visibility: Visibility; status: string; originalOnline: boolean; archiveState: string; sizeBytes: number; uploadedAt: string | null };
export type PairResponse = DeviceCredential;
export type CheckHashResponse = { duplicate: boolean; media: { id: string; publicId: string } | null };
export type UploadAuthorizeResponse = { duplicate: true; mediaId: string; publicId: string; shareUrl: string } | { duplicate: false; mediaId: string; publicId: string; authorization: { url: string; method: "PUT"; headers: Record<string, string> } };
export type FinalizeResponse = { item: { publicId: string }; shareUrl: string; idempotent: boolean };

async function request<T>(path: string, init: RequestInit = {}, credential?: DeviceCredential): Promise<T> {
  const headers = new Headers(init.headers);
  if (credential) headers.set("Authorization", `Bearer ${credential.token}`);
  const response = await fetch(`${API_ORIGIN}/api/${path}`, { ...init, headers, cache: "no-store" });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`${response.status}: ${detail || response.statusText}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function pairDevice(email: string, password: string, deviceName: string): Promise<PairResponse> { return request("auth/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, deviceName }) }); }
export function listMedia(credential: DeviceCredential): Promise<{ items: MediaItem[] }> { return request("media?limit=100", {}, credential); }
export function removeMedia(id: string, credential: DeviceCredential): Promise<void> { return request(`media/${encodeURIComponent(id)}`, { method: "DELETE" }, credential); }
export function checkHash(sha256: string, credential: DeviceCredential): Promise<CheckHashResponse> { return request("media/check-hash", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sha256 }) }, credential); }
export function authorizeUpload(input: { filename: string; sizeBytes: number; sha256: string; visibility: Visibility; mimeType: string }, credential: DeviceCredential): Promise<UploadAuthorizeResponse> { return request("media/upload-authorize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }, credential); }
export function finalizeUpload(mediaId: string, credential: DeviceCredential): Promise<FinalizeResponse> { return request("media/finalize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mediaId }) }, credential); }
