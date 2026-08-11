import { FormEvent, useEffect, useRef, useState } from "react";
import type { DevicePairingStatus, MediaUploadRecord, MediaVisibility } from "../shared/desktop";

const visibilityOptions: { value: MediaVisibility; label: string }[] = [
  { value: "private", label: "Private" },
  { value: "unlisted", label: "Unlisted" },
  { value: "public", label: "Public" },
];

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
  const [visibility, setVisibility] = useState<MediaVisibility>("private");
  const [active, setActive] = useState<MediaUploadRecord | null>(null);
  const [pending, setPending] = useState<MediaUploadRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const expectingNewUpload = useRef(false);

  const refreshPending = async () => setPending(await window.kcxDesktop!.listPendingMediaUploads());
  const refreshPairing = async () => setPairingStatus(await window.kcxDesktop!.getDevicePairingStatus());

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

  const chooseFile = async () => {
    const selected = await window.kcxDesktop!.chooseMediaFile();
    if (selected) setFilePath(selected);
  };

  const startUpload = async () => {
    if (!filePath) return;
    setBusy(true);
    expectingNewUpload.current = true;
    setActive(null);
    try {
      const result = await window.kcxDesktop!.startMediaUpload(filePath, visibility);
      setActive(result);
      if (result.stage === "finalized") setMessage(result.duplicate ? "Media already published; reusing existing share link" : "Media published");
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
    <div className="desktop-panel-grid">
      {pairingStatus && <Pairing status={pairingStatus} refresh={refreshPairing} setMessage={setMessage} />}

      <section className="desktop-card desktop-form">
        <h2>Upload a video</h2>
        <p>SHA-256 and file size are calculated locally. The file uploads directly to a short-lived storage URL — this app never sees or stores R2 bucket credentials.</p>
        {pairingStatus && !pairingStatus.paired && <p className="desktop-warning">Pair this device above before uploading.</p>}
        <label>
          Local file
          <button type="button" className="desktop-action" onClick={chooseFile} disabled={busy}>Choose video file</button>
          <small>{filePath || "No file selected"}</small>
        </label>
        <label>
          Visibility
          <select value={visibility} onChange={(event) => setVisibility(event.target.value as MediaVisibility)} disabled={busy}>
            {visibilityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <button className="desktop-action" disabled={busy || !filePath || !pairingStatus?.paired} onClick={startUpload}>{busy ? "Working…" : "Upload"}</button>
      </section>

      <section className="desktop-card desktop-primary-card">
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
                  Share URL: <a href={activeShareUrl} target="_blank" rel="noopener noreferrer">{activeShareUrl}</a>
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

      <section className="desktop-card desktop-form">
        <h2>Interrupted uploads</h2>
        <p>Uploads whose object finished sending but never finalized (for example after closing the app) stay here until retried. A failure earlier — hashing, duplicate check, or authorization — never lands here, since nothing was sent to storage yet.</p>
        {pending.length ? pending.map((record) => (
          <p key={record.id}>
            <strong>{record.fileName}</strong> · {formatBytes(record.bytes)} · <span className={stageClassName(record.stage)}>{stageLabel[record.stage]}</span>
            {record.error && <><br /><small className="desktop-error">{record.error}</small></>}
            <br />
            <button className="desktop-action" disabled={busy || !canRetryFinalize(record)} onClick={() => void retryFinalize(record.id)}>Retry finalization</button>
          </p>
        )) : <p>Nothing pending.</p>}
      </section>
    </div>
  );
}
