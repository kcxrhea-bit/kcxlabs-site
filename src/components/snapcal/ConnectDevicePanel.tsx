import { useCallback, useEffect, useRef, useState } from "react";
import { toDataURL } from "qrcode";
import { RefreshCcw, X } from "lucide-react";
import { createPairingSession, getPairingSessionStatus, SnapCalApiError, type PairingSession } from "./snapcalApi";

type PanelStatus = "loading" | "waiting" | "connected" | "expired" | "error";

const POLL_INTERVAL_MS = 2500;

/**
 * "Connect Device" modal: creates a pairing session, renders the QR + short
 * fallback code, and polls status until the Android app redeems it (or it
 * expires). Never renders anything derived from the resulting device
 * token — this panel never sees it; only KsnapCalxBuddy does.
 */
export function ConnectDevicePanel({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<PanelStatus>("loading");
  const [session, setSession] = useState<PairingSession | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = useCallback(() => {
    if (pollTimer.current !== null) clearInterval(pollTimer.current);
    if (countdownTimer.current !== null) clearInterval(countdownTimer.current);
    pollTimer.current = null;
    countdownTimer.current = null;
  }, []);

  const start = useCallback(async () => {
    clearTimers();
    setStatus("loading");
    setErrorMessage(null);
    setQrDataUrl(null);
    try {
      const created = await createPairingSession();
      setSession(created);
      setStatus("waiting");

      const qr = await toDataURL(JSON.stringify(created.qrPayload), { margin: 1, width: 240 });
      setQrDataUrl(qr);

      const tick = () => {
        const secondsLeft = Math.max(0, Math.round((Date.parse(created.expiresAt) - Date.now()) / 1000));
        setRemainingSeconds(secondsLeft);
        if (secondsLeft === 0) {
          setStatus((prev) => (prev === "connected" ? prev : "expired"));
          clearTimers();
        }
      };
      tick();
      countdownTimer.current = setInterval(tick, 1000);

      pollTimer.current = setInterval(async () => {
        try {
          const polled = await getPairingSessionStatus(created.sessionId);
          if (polled.status === "connected") {
            setStatus("connected");
            clearTimers();
          } else if (polled.status === "expired") {
            setStatus("expired");
            clearTimers();
          }
        } catch {
          // A transient poll failure is not fatal — keep polling until expiry.
        }
      }, POLL_INTERVAL_MS);
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof SnapCalApiError ? error.message : "Could not start pairing.");
    }
  }, [clearTimers]);

  useEffect(() => {
    start();
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="connect-device-title">
      <div className="studio-panel w-full max-w-md p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="connect-device-title" className="text-lg font-semibold text-white">
            Connect Device
          </h2>
          <button type="button" onClick={onClose} className="icon-chip focus-ring" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {status === "loading" ? <p className="text-center text-sm text-kcx-ash">Starting pairing session…</p> : null}

        {status === "error" ? (
          <div className="space-y-3 text-center">
            <p className="text-sm text-kcx-steel">{errorMessage}</p>
            <button type="button" onClick={start} className="button-secondary focus-ring mx-auto">
              <RefreshCcw size={15} />
              Try Again
            </button>
          </div>
        ) : null}

        {(status === "waiting" || status === "connected") && session ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-kcx-ash">Open KsnapCalxBuddy on your phone and choose Scan QR Code, or enter the code below.</p>

            <div className="mx-auto flex h-[240px] w-[240px] items-center justify-center bg-white p-2">
              {qrDataUrl ? <img src={qrDataUrl} alt="Pairing QR code" width={224} height={224} /> : null}
            </div>

            <div>
              <div className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-kcx-ash">Fallback code</div>
              <div className="mt-1 text-2xl font-mono font-semibold tracking-[0.3em] text-white">{session.code}</div>
            </div>

            {status === "waiting" ? (
              <p className="text-xs text-kcx-ash">
                Waiting for device… expires in {minutes}:{String(seconds).padStart(2, "0")}
              </p>
            ) : (
              <p className="text-sm font-semibold text-kcx-cyan">Device connected.</p>
            )}

            {status === "connected" ? (
              <button type="button" onClick={onClose} className="button-primary focus-ring mx-auto">
                Done
              </button>
            ) : null}
          </div>
        ) : null}

        {status === "expired" ? (
          <div className="space-y-3 text-center">
            <p className="text-sm text-kcx-steel">This pairing code expired before a device connected.</p>
            <button type="button" onClick={start} className="button-primary focus-ring mx-auto">
              <RefreshCcw size={15} />
              Generate New Code
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
