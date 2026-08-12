import { FormEvent, useEffect, useState } from "react";
import type { DevicePairingStatus, MediaLocalFile, MediaUploadRecord } from "../shared/desktop";
import { appendUniqueMediaFiles, mediaPathKey, processMediaQueueSequentially, type MediaQueueItem } from "./media-queue";

const RECORDING_INBOX = "D:\\Fortnite screen recordings\\Recorded-to-send";
const SENT_MEDIA_FOLDER = "D:\\Fortnite screen recordings\\Sent-to-Website";

const stageLabel: Record<MediaUploadRecord["stage"], string> = {
  hashing: "Hashing", checking: "Checking for duplicate", authorizing: "Preparing upload",
  uploading: "Uploading", uploaded: "Upload complete", finalizing: "Publishing",
  finalized: "Published", moving: "Moving local file", moved: "Published and moved", failed: "Failed",
};

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** exponent).toFixed(exponent ? 1 : 0)} ${units[exponent]}`;
}

function shareUrlFor(record: MediaUploadRecord): string | null {
  return record.shareUrl ?? (record.publicId ? `https://kcxlabs.org/c/${record.publicId}` : null);
}

function canRetryFinalize(record: MediaUploadRecord): boolean {
  return record.objectUploaded && record.mediaId !== null && record.stage === "failed";
}

function Pairing({ status, refresh, setMessage }: { status: DevicePairingStatus; refresh: () => Promise<void>; setMessage: (value: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [busy, setBusy] = useState(false);
  if (status.paired) return <section className="desktop-card desktop-form"><h2>Device pairing</h2><p>Paired as <strong>{status.deviceName}</strong>. Credential expires {status.expiresAt}.</p><button className="desktop-action" disabled={busy} onClick={async () => { setBusy(true); try { const result = await window.kcxDesktop!.unpairDevice(); setMessage(result.message); await refresh(); } finally { setBusy(false); } }}>Unpair this device</button></section>;
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); try { const result = await window.kcxDesktop!.pairDevice(email, password, deviceName); setMessage(result.message); if (result.ok) { setPassword(""); await refresh(); } } finally { setBusy(false); } };
  return <section className="desktop-card desktop-form"><h2>Pair this device</h2><p>Uploading requires this desktop app to be paired with your KCx Labs owner account. Your password is used once to obtain a device credential — it is never stored.</p><form onSubmit={submit}><label>Owner email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Owner password<input required type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><label>Device name<input required value={deviceName} placeholder="This PC" onChange={(event) => setDeviceName(event.target.value)} /></label><button className="desktop-action" disabled={busy}>{busy ? "Pairing…" : "Pair device"}</button></form></section>;
}

export function MediaCenter({ setMessage }: { setMessage: (value: string) => void }) {
  const [pairingStatus, setPairingStatus] = useState<DevicePairingStatus | null>(null);
  const [queue, setQueue] = useState<MediaQueueItem[]>([]);
  const [pending, setPending] = useState<MediaUploadRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const refreshPending = async () => setPending(await window.kcxDesktop!.listPendingMediaUploads());
  const refreshPairing = async () => setPairingStatus(await window.kcxDesktop!.getDevicePairingStatus());
  const patchItem = (filePath: string, patch: Partial<MediaQueueItem>) => setQueue((current) => current.map((item) => mediaPathKey(item.filePath) === mediaPathKey(filePath) ? { ...item, ...patch } : item));
  const addFiles = (files: MediaLocalFile[], source: string) => {
    setQueue((current) => appendUniqueMediaFiles(current, files));
    setMessage(`${files.length} supported video(s) found in ${source}; paths already in the queue were skipped.`);
  };
  const loadFiles = async (source: string, loader: () => Promise<MediaLocalFile[]>) => {
    try { addFiles(await loader(), source); }
    catch (error) { setMessage(error instanceof Error ? error.message : `Could not load videos from ${source}.`); }
  };

  useEffect(() => {
    void refreshPairing(); void refreshPending();
    return window.kcxDesktop!.onMediaProgress((record) => patchItem(record.filePath, { record }));
  }, []);

  const uploadAll = async () => {
    setBusy(true);
    const snapshot = queue;
    try {
      await processMediaQueueSequentially(snapshot, (filePath) => window.kcxDesktop!.startMediaUpload(filePath), patchItem);
      setMessage("Queue processing finished. Review any failed or published-but-not-moved items.");
    } finally { setBusy(false); await refreshPending(); }
  };

  const retryFinalize = async (record: MediaUploadRecord) => {
    setBusy(true);
    try { const result = await window.kcxDesktop!.retryMediaFinalize(record.id); patchItem(record.filePath, { record: result, status: result.stage === "moved" || (result.stage === "finalized" && !!result.moveError) ? "complete" : "failed" }); setMessage(result.stage === "moved" ? "Finalization completed and local file moved" : result.moveError ? "Published, but the local file could not be moved" : "Finalization still needs attention"); }
    finally { setBusy(false); await refreshPending(); }
  };

  return <div className="desktop-panel-grid">
    {pairingStatus && <Pairing status={pairingStatus} refresh={refreshPairing} setMessage={setMessage} />}
    <section className="desktop-card desktop-form media-inbox"><h2>Recording Inbox</h2><p>Choose videos or load supported files from the configured NVIDIA recording inbox. Upload All processes them one at a time.</p><small>{RECORDING_INBOX}</small>{pairingStatus && !pairingStatus.paired && <p className="desktop-warning">Pair this device before uploading.</p>}<div className="media-actions"><button className="desktop-action" disabled={busy} onClick={() => void loadFiles("the file picker", () => window.kcxDesktop!.chooseMediaFiles())}>Add Videos</button><button className="desktop-action" disabled={busy} onClick={() => void loadFiles("Recorded-to-send", () => window.kcxDesktop!.scanMediaInbox())}>Load Recorded-to-send</button><button className="desktop-action" disabled={busy || !pairingStatus?.paired || !queue.some((item) => item.status === "queued")} onClick={() => void uploadAll()}>{busy ? "Processing…" : "Upload All"}</button></div></section>
    <section className="desktop-card desktop-form media-queue"><h2>Queue</h2>{queue.length === 0 ? <p>No videos queued.</p> : queue.map((item) => {
      const record = item.record; const shareUrl = record ? shareUrlFor(record) : null; const active = record?.stage === "hashing" || record?.stage === "uploading";
      return <article className="media-queue-item" key={mediaPathKey(item.filePath)}><div><strong>{item.fileName}</strong><p>{formatBytes(record?.bytes ?? item.bytes)} · <span className={item.status === "failed" ? "desktop-error" : item.status === "complete" ? "healthy" : "neutral"}>{record ? stageLabel[record.stage] : item.status === "processing" ? "Starting" : "Ready"}{active ? ` ${record.progress}%` : ""}</span></p>{active && <div className="media-progress-track"><div className="media-progress-fill" style={{ width: `${record.progress}%` }} /></div>}{record?.sha256 && <small>SHA-256: {record.sha256}</small>}{record?.duplicate && <p className="desktop-warning">Already published; reused the existing share link.</p>}{record?.stage === "moved" && <p className="healthy">Moved to {record.movedTo}</p>}{record?.moveError && <p className="desktop-warning">Published, but local move failed: {record.moveError}<br />The source file remains at {item.filePath}.</p>}{(item.error || record?.error) && <p className="desktop-error">{item.error ?? record?.error}</p>}{shareUrl && <p>Clip page: <button className="desktop-link" onClick={() => void window.kcxDesktop!.openMediaShareUrl(shareUrl)}>{shareUrl}</button></p>}</div><div className="media-item-actions">{item.status === "failed" && !record?.objectUploaded && <button className="desktop-action" disabled={busy} onClick={() => patchItem(item.filePath, { status: "queued", error: null, record: null })}>Retry</button>}{record && canRetryFinalize(record) && <button className="desktop-action" disabled={busy} onClick={() => void retryFinalize(record)}>Retry finalization</button>}{item.status === "queued" && <button className="desktop-action" disabled={busy} onClick={() => setQueue((current) => current.filter((entry) => mediaPathKey(entry.filePath) !== mediaPathKey(item.filePath)))}>Remove</button>}</div></article>;
    })}</section>
    <section className="desktop-card desktop-form"><h2>Interrupted uploads</h2><p>Only uploads whose bytes reached storage but did not finalize appear here. Retrying finalization publishes first, then moves the local file.</p>{pending.length ? pending.map((record) => <p key={record.id}><strong>{record.fileName}</strong> · {formatBytes(record.bytes)} · <span className="desktop-error">{stageLabel[record.stage]}</span><br /><small>{record.error}</small><br /><button className="desktop-action" disabled={busy || !canRetryFinalize(record)} onClick={() => void retryFinalize(record)}>Retry finalization</button></p>) : <p>Nothing pending.</p>}</section>
    <section className="desktop-card desktop-form media-guide"><h2>Media Center Guide</h2><p>This offline guide covers the recording queue workflow.</p><h3>What it does and when to use it</h3><p>Add several finished recordings, publish them sequentially to public KCx Clips, and archive each local source only after verified publication.</p><h3>Setup, configuration, and defaults</h3><p>Pair the desktop once. NVIDIA writes to <code>{RECORDING_INBOX}</code>; successful clips move to <code>{SENT_MEDIA_FOLDER}</code>. Supported formats are MP4, MOV, MKV, WebM, AVI, and M4V. Uploads are public/shareable by default.</p><h3>How to use it</h3><ol><li>Select Add Videos or Load Recorded-to-send.</li><li>Review the queue, then select Upload All.</li><li>Open each share link or review failures. Failed items stay at their source path.</li></ol><h3>Permissions and risks</h3><p>The main process reads selected files, creates the destination folder, and moves published files without overwriting existing names. The renderer receives no storage credentials. Moving changes the local path but never permanently deletes a clip.</p><h3>Failures, troubleshooting, and recovery</h3><p>A failed upload does not stop later items. Retry ordinary failures from the queue. If bytes uploaded but finalize failed, use Retry finalization. If publishing succeeded but moving failed, the share link remains valid and the source remains in place; correct folder permissions or close programs using the file, then process it again. Expired pairing requires pairing again.</p><h3>Examples and related behavior</h3><p>A server duplicate reuses its existing share link and still moves locally. Name collisions become “filename (1).mp4”, then higher numbers. Related features are device pairing, Clips at /clips, and direct share pages at /c/&lt;publicId&gt;.</p></section>
  </div>;
}
