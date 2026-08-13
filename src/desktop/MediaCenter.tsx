import { FormEvent, useEffect, useRef, useState } from "react";
import type { DevicePairingStatus, MediaUploadRecord, UploadedMediaItem } from "../shared/desktop";

type MediaView = "upload" | "online" | "recovery";
type Verification = { action: "published" | "removed"; title: string; detail: string; shareUrl: string | null };
type RemovalUpdate = { id: string; title: string; phase: "removing" | "checking" | "confirmed" | "pending" };

const stageLabel: Record<MediaUploadRecord["stage"], string> = {
  hashing: "Hashing",
  checking: "Checking for duplicate",
  authorizing: "Authorizing upload",
  uploading: "Uploading",
  uploaded: "Uploaded",
  finalizing: "Finalizing",
  finalized: "Finalized",
  failed: "Failed",
};

function stageClassName(stage: MediaUploadRecord["stage"]): string {
  if (stage === "finalized") return "healthy";
  if (stage === "failed") return "desktop-error";
  return "neutral";
}

function shareUrlFor(record: MediaUploadRecord): string | null {
  if (record.shareUrl) return record.shareUrl;
  return record.publicId ? `https://kcxlabs.org/c/${record.publicId}` : null;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** exponent).toFixed(exponent ? 1 : 0)} ${units[exponent]}`;
}

// A record is only eligible for "retry finalization" once the object upload itself completed —
// a failure while hashing, checking, or authorizing means the object was never sent to storage,
// so there is nothing for finalize to act on.
function canRetryFinalize(record: MediaUploadRecord): boolean {
  return record.objectUploaded && record.mediaId !== null && record.stage !== "finalized";
}

function Pairing({ status, refresh, setMessage }: { status: DevicePairingStatus; refresh: () => Promise<void>; setMessage: (value: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [busy, setBusy] = useState(false);

  if (status.paired) {
    return (
      <section className="desktop-card desktop-form">
        <h2>Device pairing</h2>
        <p>Paired as <strong>{status.deviceName}</strong>. Credential expires {status.expiresAt}.</p>
        <button
          className="desktop-action"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const result = await window.kcxDesktop!.unpairDevice();
              setMessage(result.message);
              await refresh();
            } finally {
              setBusy(false);
            }
          }}
        >
          Unpair this device
        </button>
      </section>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await window.kcxDesktop!.pairDevice(email, password, deviceName);
      setMessage(result.message);
      if (result.ok) {
        setPassword("");
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="desktop-card desktop-form">
      <h2>Pair this device</h2>
      <p>Uploading requires this desktop app to be paired with your KCx Labs owner account. Your password is used once to obtain a device credential — it is never stored.</p>
      <form onSubmit={submit}>
        <label>
          Owner email
          <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label>
          Owner password
          <input required type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <label>
          Device name
          <input required value={deviceName} placeholder="This PC" onChange={(event) => setDeviceName(event.target.value)} />
        </label>
        <button className="desktop-action" disabled={busy}>{busy ? "Pairing…" : "Pair device"}</button>
      </form>
    </section>
  );
}

export function MediaCenter({ setMessage }: { setMessage: (value: string) => void }) {
  const [pairingStatus, setPairingStatus] = useState<DevicePairingStatus | null>(null);
  const [filePath, setFilePath] = useState("");
  const [active, setActive] = useState<MediaUploadRecord | null>(null);
  const [pending, setPending] = useState<MediaUploadRecord[]>([]);
  const [uploaded, setUploaded] = useState<UploadedMediaItem[]>([]);
  const [uploadedError, setUploadedError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [view, setView] = useState<MediaView>("upload");
  const [verification, setVerification] = useState<Verification | null>(null);
  const [removalUpdate, setRemovalUpdate] = useState<RemovalUpdate | null>(null);
  const [reloadingUploaded, setReloadingUploaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const expectingNewUpload = useRef(false);

  const refreshPending = async () => setPending(await window.kcxDesktop!.listPendingMediaUploads());
  const refreshPairing = async () => setPairingStatus(await window.kcxDesktop!.getDevicePairingStatus());
  const refreshUploaded = async () => {
    try {
      setUploaded(await window.kcxDesktop!.listUploadedMedia());
      setUploadedError(null);
    } catch (error) {
      setUploadedError(error instanceof Error ? error.message : "Could not load uploaded media.");
    }
  };

  useEffect(() => {
    void refreshPairing();
    void refreshPending();
    const unsubscribe = window.kcxDesktop!.onMediaProgress((record) => {
      setActive((current) => (expectingNewUpload.current || current?.id === record.id ? record : current));
      expectingNewUpload.current = false;
      setPending((previous) => {
        const rest = previous.filter((entry) => entry.id !== record.id);
        return canRetryFinalize(record) ? [record, ...rest] : rest;
      });
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (pairingStatus?.paired) void refreshUploaded();
    else if (pairingStatus) {
      setUploaded([]);
      setUploadedError("Pair this device to load online media.");
    }
  }, [pairingStatus?.paired]);

  const chooseFile = async () => {
    const selected = await window.kcxDesktop!.chooseMediaFile();
    if (selected) setFilePath(selected);
  };

  const removeUploaded = async (item: UploadedMediaItem) => {
    if (!window.confirm(`Remove "${item.title || item.originalFilename}" from the website?`)) return;
    setRemovingId(item.id);
    setRemovalUpdate({ id: item.id, title: item.title || item.originalFilename, phase: "removing" });
    try {
      const result = await window.kcxDesktop!.removeUploadedMedia(item.id);
      setMessage(result.message);
      if (result.ok) {
        setUploaded((current) => current.filter((candidate) => candidate.id !== item.id));
        setRemovalUpdate({ id: item.id, title: item.title || item.originalFilename, phase: "checking" });
        setVerification({ action: "removed", title: item.title || item.originalFilename, detail: "The clip no longer appears in Online Media or on the website.", shareUrl: null });
        try {
          const serverItems = await window.kcxDesktop!.listUploadedMedia();
          const stillReported = serverItems.some((candidate) => candidate.id === item.id);
          setUploaded(serverItems.filter((candidate) => candidate.id !== item.id));
          setUploadedError(null);
          setRemovalUpdate({ id: item.id, title: item.title || item.originalFilename, phase: stillReported ? "pending" : "confirmed" });
        } catch (error) {
          setUploadedError(error instanceof Error ? error.message : "Could not reconcile Online Media.");
          setRemovalUpdate({ id: item.id, title: item.title || item.originalFilename, phase: "pending" });
        }
      } else {
        setRemovalUpdate(null);
      }
    } finally {
      setRemovingId(null);
    }
  };

  const reloadUploaded = async () => {
    setReloadingUploaded(true);
    try {
      const serverItems = await window.kcxDesktop!.listUploadedMedia();
      setUploaded(serverItems);
      setUploadedError(null);
      if (removalUpdate) setRemovalUpdate({ ...removalUpdate, phase: serverItems.some((item) => item.id === removalUpdate.id) ? "pending" : "confirmed" });
      setMessage("Online Media reloaded from the server.");
    } catch (error) {
      setUploadedError(error instanceof Error ? error.message : "Could not reload uploaded media.");
    } finally {
      setReloadingUploaded(false);
    }
  };

  const startUpload = async () => {
    if (!filePath) return;
    setBusy(true);
    expectingNewUpload.current = true;
    setActive(null);
    try {
      const result = await window.kcxDesktop!.startMediaUpload(filePath);
      setActive(result);
      if (result.stage === "finalized") {
        const shareUrl = shareUrlFor(result);
        setMessage(result.duplicate ? "Media already published; reusing existing share link" : "Media published");
        setVerification({ action: "published", title: result.fileName, detail: result.duplicate ? "Verified existing clip; its current share link was reused." : "Upload and finalization completed successfully.", shareUrl });
        await refreshUploaded();
      }
      else setMessage(result.error ? `Media upload failed: ${result.error}` : "Media upload needs attention");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Media upload failed");
    } finally {
      setBusy(false);
      expectingNewUpload.current = false;
      await refreshPending();
    }
  };

  const retryFinalize = async (id: string) => {
    setBusy(true);
    try {
      const result = await window.kcxDesktop!.retryMediaFinalize(id);
      setActive((current) => (current?.id === id ? result : current));
      setMessage(result.stage === "finalized" ? "Finalization completed" : `Finalization still pending: ${result.error ?? "no error detail"}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Retry failed");
    } finally {
      setBusy(false);
      await refreshPending();
    }
  };

  const activeShareUrl = active ? shareUrlFor(active) : null;

  return (
    <div className="desktop-panel-grid media-center">
      {pairingStatus && <Pairing status={pairingStatus} refresh={refreshPairing} setMessage={setMessage} />}
      <nav className="media-section-nav" aria-label="Media Center sections">
        <button type="button" className={view === "upload" ? "media-section-active" : ""} onClick={() => setView("upload")}>Upload Clip</button>
        <button type="button" className={view === "online" ? "media-section-active" : ""} onClick={() => setView("online")}>Online Media <span>{uploaded.length}</span></button>
        <button type="button" className={view === "recovery" ? "media-section-active" : ""} onClick={() => setView("recovery")}>Recovery {pending.length > 0 && <span>{pending.length}</span>}</button>
      </nav>
      {verification && <section className="desktop-card media-verification" role="status"><div><p className="desktop-kicker">Action verified</p><h2>{verification.action === "published" ? "Clip published successfully" : "Clip removed successfully"}</h2><p><strong>{verification.title}</strong></p><p>{verification.detail}</p>{verification.shareUrl && <button type="button" className="desktop-link" onClick={() => void window.kcxDesktop!.openMediaShareUrl(verification.shareUrl!)}>Open verified share page</button>}</div><button type="button" className="media-dismiss" aria-label="Dismiss verification" onClick={() => setVerification(null)}>×</button></section>}

      <div className={`media-upload-grid ${view === "upload" ? "" : "media-section-hidden"}`}>
      <section className="desktop-card desktop-form media-workflow-card">
        <h2>Upload a clip</h2>
        <p>SHA-256 and file size are calculated locally. The file uploads directly to a short-lived storage URL — this app never sees or stores R2 bucket credentials.</p>
        <p>Every upload is published to KCx Clips with a public, shareable link — there's no visibility choice to make.</p>
        {pairingStatus && !pairingStatus.paired && <p className="desktop-warning">Pair this device above before uploading.</p>}
        <label>
          Local file
          <button type="button" className="desktop-action" onClick={chooseFile} disabled={busy}>Choose video file</button>
          <small>{filePath || "No file selected"}</small>
        </label>
        <button className="desktop-action" disabled={busy || !filePath || !pairingStatus?.paired} onClick={startUpload}>{busy ? "Working…" : "Upload"}</button>
      </section>

      <section className="desktop-card desktop-primary-card media-workflow-card">
        <div>
          <p className="desktop-kicker">Current upload</p>
          {active ? (
            <>
              <h2>{active.fileName}</h2>
              <p>
                {formatBytes(active.bytes)} · <span className={stageClassName(active.stage)}>{stageLabel[active.stage]}</span>
                {active.stage === "uploading" || active.stage === "hashing" ? ` (${active.progress}%)` : ""}
              </p>
              {(active.stage === "uploading" || active.stage === "hashing") && (
                <div className="media-progress-track"><div className="media-progress-fill" style={{ width: `${active.progress}%` }} /></div>
              )}
              {active.sha256 && <p><small>SHA-256: {active.sha256}</small></p>}
              {active.duplicate && <p className="desktop-warning">Identical file already exists on the server; reusing its share link.</p>}
              {active.error && <p className="desktop-error">{active.error}</p>}
              {activeShareUrl && (
                <p>
                  Clip page: <button type="button" className="desktop-link" onClick={() => void window.kcxDesktop!.openMediaShareUrl(activeShareUrl)}>{activeShareUrl}</button>
                  <br />
                  <small>This is the live kcxlabs.org page for this clip. Opens in your default browser.</small>
                </p>
              )}
              {active.stage === "failed" && canRetryFinalize(active) && (
                <button className="desktop-action" disabled={busy} onClick={() => void retryFinalize(active.id)}>Retry finalization</button>
              )}
            </>
          ) : (
            <p>Choose a video and select Upload to begin.</p>
          )}
        </div>
      </section>
      </div>

      <section className={`desktop-card desktop-form ${view === "recovery" ? "" : "media-section-hidden"}`}>
        <h2>Interrupted uploads</h2>
        <p>Uploads whose object finished sending but never finalized (for example after closing the app) stay here until retried. A failure earlier — hashing, duplicate check, or authorization — never lands here, since nothing was sent to storage yet.</p>
        {pending.length ? <div className="media-recovery-grid">{pending.map((record) => (
          <article className="media-recovery-item" key={record.id}>
            <div><strong>{record.fileName}</strong><p className="media-meta"><span>{formatBytes(record.bytes)}</span><span className={stageClassName(record.stage)}>{stageLabel[record.stage]}</span></p>
            {record.error && <small className="desktop-error">{record.error}</small>}</div>
            <button className="desktop-action" disabled={busy || !canRetryFinalize(record)} onClick={() => void retryFinalize(record.id)}>Retry finalization</button>
          </article>
        ))}</div> : <p>Nothing pending.</p>}
        <details className="media-guide"><summary>Recovery guide</summary><p>Interrupted uploads appear in a responsive card grid. Each card shows the filename, size, stage, failure detail, and retry action. Retry finalization only when the upload reached storage; earlier failures require a new upload from Upload Clip.</p></details>
      </section>

      <section className={`desktop-card desktop-form media-online-section ${view === "online" ? "" : "media-section-hidden"}`}>
        <div className="media-online-heading"><div><h2>Online Media</h2><p>Existing items load from your paired KCx Media account independently of the local upload queue.</p></div><button type="button" className="desktop-action" disabled={reloadingUploaded || removingId !== null || !pairingStatus?.paired} onClick={() => void reloadUploaded()}>{reloadingUploaded ? "Reloading…" : "Reload"}</button></div>
        {removalUpdate && <div className="media-removal-update" role="status"><strong>{removalUpdate.title}</strong><span>{removalUpdate.phase === "removing" ? "Deleting from server…" : removalUpdate.phase === "checking" ? "Deleted. Checking the server list…" : removalUpdate.phase === "confirmed" ? "Gone — server list confirms deletion." : "Delete succeeded, but the latest server list has not confirmed disappearance yet. Use Reload to check again."}</span></div>}
        {uploadedError && <p className="desktop-error">{uploadedError}</p>}
        {!uploadedError && uploaded.length === 0 && <p>No uploaded media found.</p>}
        <div className="media-online-list">{uploaded.map((item) => (
          <article className="media-online-item" key={item.id}>
            <div><strong>{item.title || item.originalFilename}</strong>
            {item.title && item.title !== item.originalFilename && <><br /><small>{item.originalFilename}</small></>}
            <p className="media-meta"><span>{item.visibility}</span><span>{item.status}</span><span>{item.originalOnline ? "online" : item.archiveState}</span></p></div>
            <button className="desktop-action" disabled={removingId !== null} onClick={() => void removeUploaded(item)}>
              {removingId === item.id ? "Removing…" : "Remove from Website"}
            </button>
          </article>
        ))}</div>
        <details className="media-guide"><summary>Online Media guide and recovery</summary><p>Online clips appear in a responsive card grid; each card groups its title, original filename, visibility, server status, online/archive state, and removal action. Reload requests the latest list without restarting the app. Remove from Website asks for confirmation, removes the item from this screen immediately after server success, and shows whether reconciliation confirms it is gone. It never deletes a local recording. Verify the title or filename before removal. If confirmation is pending, use Reload; if loading fails, check pairing and retry. Related features are Upload Clip, Recovery, and KCx Clips share links.</p></details>
      </section>
    </div>
  );
}
