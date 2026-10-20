import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, Camera, Download, Loader2, LogIn, LogOut, RefreshCw, Shield, ShieldAlert, ShieldOff, SkipBack, SkipForward, Video } from "lucide-react";
import { SectionHeader } from "../ui/SectionHeader";

type FetchResult<T> = { ok: true; body: T } | { ok: false; status: number };

async function fetchJson<T>(path: string, init?: RequestInit): Promise<FetchResult<T>> {
  const response = await fetch(`/api/camera/${path}`, { credentials: "same-origin", ...init });
  if (!response.ok) return { ok: false, status: response.status };
  return { ok: true, body: (await response.json()) as T };
}

/** Matches the sanitized shape server/media-api/routes/camera/archive/list.ts actually returns — never a raw storage key, hash, or owner id. */
type ArchiveItem = {
  id: string;
  camera: string;
  cameraName: string;
  recordedStartAt: string;
  recordedEndAt: string;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  sizeBytes: number;
  protected: boolean;
};

type Budget = {
  budgetBytes: number;
  totalBytes: number;
  protectedBytes: number;
  unprotectedBytes: number;
  reservedBytes: number;
  availableBytes: number;
  storageFull: boolean;
  // Cleanup health; optional so an older API response still renders.
  pendingDeleteBytes?: number;
  pendingDeleteCount?: number;
  stuckDeleteCount?: number;
  stuckLateUploadCheckCount?: number;
};

// Only Living Room is authorized for cloud backup today — Kitchen stays local-DVR-only
// (see the KCxCamBridge schedule restriction). Kept as a disabled option rather than
// removed, so the UI doesn't silently imply Kitchen footage could ever appear here.
const CAMERAS: { value: string; label: string; disabled?: boolean }[] = [
  { value: "", label: "All cameras" },
  { value: "living-room", label: "Living Room" },
  { value: "kitchen", label: "Kitchen (local DVR only — never backed up)", disabled: true },
];

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "Unknown length";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatStamp(item: ArchiveItem): string {
  const parsed = new Date(item.recordedStartAt);
  if (Number.isNaN(parsed.getTime())) return "Unknown time";
  return parsed.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
}

// ─── Login ───────────────────────────────────────────────────────────────

function LoginForm({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await fetchJson<{ ok: true }>("auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (result.ok) onSignedIn();
      else setError(result.status === 401 ? "Incorrect email or password." : "Sign-in failed. Try again.");
    } catch {
      setError("Sign-in failed. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="studio-panel p-6 sm:p-8">
        <div className="mb-5 inline-flex items-center gap-2 border border-kcx-cyan/30 bg-kcx-cyan/10 px-3 py-2 text-[0.7rem] font-bold uppercase tracking-[0.2em] text-kcx-cyan">
          <LogIn size={15} />
          Owner Sign-In
        </div>
        <h1 className="text-2xl font-semibold text-white">Camera Archive</h1>
        <p className="mt-2 text-sm leading-6 text-kcx-ash">Sign in with the KCx Labs owner account to browse private KCxCamBridge recordings.</p>

        <form onSubmit={handleSubmit} className="mt-6 grid gap-4" noValidate>
          <label className="grid gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-kcx-ash">
            Email
            <input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} className="snapcal-input focus-ring" />
          </label>
          <label className="grid gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-kcx-ash">
            Password
            <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="snapcal-input focus-ring" />
          </label>

          {error ? (
            <div className="flex items-start gap-2 border border-kcx-red/40 bg-kcx-red/10 p-3 text-sm text-kcx-steel">
              <ShieldAlert className="mt-0.5 shrink-0 text-kcx-red" size={16} />
              <span>{error}</span>
            </div>
          ) : null}

          <button type="submit" disabled={submitting} className="button-primary focus-ring disabled:opacity-60">
            {submitting ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Budget panel ──────────────────────────────────────────────────────────

function BudgetPanel({ budget }: { budget: Budget | null }) {
  if (!budget) return null;
  const pct = budget.budgetBytes > 0 ? Math.min(100, (budget.totalBytes / budget.budgetBytes) * 100) : 0;
  return (
    <div className="mb-5 border border-white/10 bg-black/25 p-4">
      <div className="flex items-center justify-between text-xs font-bold uppercase tracking-[0.14em] text-kcx-ash">
        <span>Cloud storage</span>
        <span>
          {formatBytes(budget.totalBytes)} / {formatBytes(budget.budgetBytes)}
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden bg-white/10">
        <div className={`h-full ${budget.storageFull ? "bg-kcx-red" : "bg-kcx-orange"}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-kcx-ash">
        Protected {formatBytes(budget.protectedBytes)} · Unprotected {formatBytes(budget.unprotectedBytes)} · Reserved {formatBytes(budget.reservedBytes)}
        {budget.storageFull ? " · Storage full: protected recordings are blocking automatic rotation." : ""}
      </p>
      {budget.pendingDeleteCount ? (
        <p className="mt-1 text-xs text-kcx-ash">
          Removing {budget.pendingDeleteCount} old {budget.pendingDeleteCount === 1 ? "recording" : "recordings"} ({formatBytes(budget.pendingDeleteBytes ?? 0)}) — space frees once cloud deletion is confirmed.
        </p>
      ) : null}
      {budget.stuckDeleteCount || budget.stuckLateUploadCheckCount ? (
        <div className="mt-2 flex items-start gap-2 border border-kcx-red/40 bg-kcx-red/10 p-2 text-xs text-kcx-steel">
          <ShieldAlert className="mt-0.5 shrink-0 text-kcx-red" size={14} />
          <span>
            Cloud cleanup needs attention: {(budget.stuckDeleteCount ?? 0) + (budget.stuckLateUploadCheckCount ?? 0)} item(s) could not be removed after repeated retries. They still count toward storage.
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ─── Archive ─────────────────────────────────────────────────────────────

type ListState = { status: "loading" } | { status: "error" } | { status: "ready"; items: ArchiveItem[] };

export function CameraArchivePage() {
  const [authed, setAuthed] = useState<"checking" | "no" | "yes">("checking");
  const [camera, setCamera] = useState("");
  const [date, setDate] = useState("");
  const [timeQuery, setTimeQuery] = useState("");
  const [protectedOnly, setProtectedOnly] = useState(false);
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [budget, setBudget] = useState<Budget | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [loadingPlayback, setLoadingPlayback] = useState(false);
  const [protectBusyId, setProtectBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    const params = new URLSearchParams();
    if (camera) params.set("camera", camera);
    if (date) params.set("date", date);
    const [listResult, budgetResult] = await Promise.all([
      fetchJson<{ items: ArchiveItem[] }>(`archive/list?${params.toString()}`, { cache: "no-store" }),
      fetchJson<Budget>("archive/budget", { cache: "no-store" }),
    ]);
    if (!listResult.ok) {
      if (listResult.status === 401) setAuthed("no");
      else setState({ status: "error" });
      return;
    }
    setAuthed("yes");
    setState({ status: "ready", items: listResult.body.items });
    if (budgetResult.ok) setBudget(budgetResult.body);
  }, [camera, date]);

  useEffect(() => {
    void load();
  }, [load]);

  const items = state.status === "ready" ? state.items : [];
  const filtered = useMemo(() => (protectedOnly ? items.filter((item) => item.protected) : items), [items, protectedOnly]);

  // Chronological, oldest first within the filtered set, so prev/next feels like scrubbing a timeline.
  const ordered = useMemo(() => {
    return [...filtered].sort((a, b) => new Date(a.recordedStartAt).getTime() - new Date(b.recordedStartAt).getTime());
  }, [filtered]);

  // Exact-time search: jump to the recording closest to the requested local
  // time. Never fabricates a match when nothing is close — same "never
  // invent footage" principle KCxCamBridge's own timeline search follows.
  useEffect(() => {
    if (!timeQuery || ordered.length === 0) return;
    const [h, m] = timeQuery.split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return;
    let best: ArchiveItem | null = null;
    let bestDelta = Infinity;
    for (const item of ordered) {
      const d = new Date(item.recordedStartAt);
      const minutesOfDay = d.getHours() * 60 + d.getMinutes();
      const delta = Math.abs(minutesOfDay - (h * 60 + m));
      if (delta < bestDelta) {
        bestDelta = delta;
        best = item;
      }
    }
    if (best) setSelectedId(best.id);
    // Only re-run when the user changes the time query itself, not on every list refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeQuery]);

  const selectedIndex = ordered.findIndex((item) => item.id === selectedId);
  const selected = selectedIndex >= 0 ? ordered[selectedIndex] : null;

  const openItem = useCallback(async (item: ArchiveItem) => {
    setSelectedId(item.id);
    setPlaybackUrl(null);
    setPlaybackError(null);
    setLoadingPlayback(true);
    try {
      const result = await fetchJson<{ url: string }>(`archive/${item.id}/play`);
      if (result.ok) setPlaybackUrl(result.body.url);
      else setPlaybackError("Couldn't get a playback link. Try again.");
    } catch {
      setPlaybackError("Couldn't get a playback link. Try again.");
    } finally {
      setLoadingPlayback(false);
    }
  }, []);

  const downloadItem = useCallback(async (item: ArchiveItem) => {
    const result = await fetchJson<{ url: string }>(`archive/${item.id}/download`);
    if (result.ok) window.location.assign(result.body.url);
  }, []);

  const toggleProtected = useCallback(
    async (item: ArchiveItem) => {
      setProtectBusyId(item.id);
      try {
        const action = item.protected ? "unprotect" : "protect";
        const result = await fetchJson<{ item: { id: string; protected: boolean } }>(`archive/${item.id}/${action}`, { method: "POST" });
        if (result.ok) await load();
      } finally {
        setProtectBusyId(null);
      }
    },
    [load],
  );

  function step(delta: number) {
    if (ordered.length === 0) return;
    const next = selectedIndex < 0 ? 0 : Math.min(ordered.length - 1, Math.max(0, selectedIndex + delta));
    void openItem(ordered[next]);
  }

  async function signOut() {
    await fetchJson("auth/logout", { method: "POST" });
    setAuthed("no");
    setPlaybackUrl(null);
    setSelectedId(null);
  }

  if (authed === "checking" && state.status === "loading") {
    return (
      <section className="section-shell pt-32 lg:pt-36">
        <div className="flex items-center justify-center gap-3 py-24 text-kcx-ash">
          <Loader2 size={20} className="animate-spin text-kcx-orange" aria-hidden="true" />
          Checking sign-in…
        </div>
      </section>
    );
  }

  if (authed === "no") {
    return (
      <section className="section-shell pt-32 lg:pt-36">
        <LoginForm onSignedIn={() => void load()} />
      </section>
    );
  }

  return (
    <section className="section-shell pt-32 lg:pt-36" aria-labelledby="camera-archive-title">
      <SectionHeader eyebrow="KCx Media — Owner Only" title="Camera Archive" description="Private KCxCamBridge recordings backed up from the Living Room camera. Visible only to you, signed in." />

      <div className="mx-auto max-w-6xl">
        <BudgetPanel budget={budget} />

        <div className="mb-5 grid gap-3 border border-white/10 bg-black/25 p-4 sm:grid-cols-[1fr_1fr_1fr_auto_auto_auto] sm:items-end">
          <label className="grid gap-1 text-xs font-bold uppercase tracking-[0.14em] text-kcx-ash">
            Camera
            <select value={camera} onChange={(event) => setCamera(event.target.value)} className="snapcal-input focus-ring">
              {CAMERAS.map((c) => (
                <option key={c.value} value={c.value} disabled={c.disabled}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-bold uppercase tracking-[0.14em] text-kcx-ash">
            Date
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="snapcal-input focus-ring" />
          </label>
          <label className="grid gap-1 text-xs font-bold uppercase tracking-[0.14em] text-kcx-ash">
            Jump to time
            <input type="time" step={1} value={timeQuery} onChange={(event) => setTimeQuery(event.target.value)} className="snapcal-input focus-ring" />
          </label>
          <label className="flex items-center gap-2 pb-2 text-xs font-bold uppercase tracking-[0.14em] text-kcx-ash">
            <input type="checkbox" checked={protectedOnly} onChange={(event) => setProtectedOnly(event.target.checked)} />
            Protected only
          </label>
          <button type="button" onClick={() => void load()} className="button-secondary focus-ring">
            <RefreshCw size={15} aria-hidden="true" />
            Refresh
          </button>
          <button type="button" onClick={() => void signOut()} className="button-secondary focus-ring">
            <LogOut size={15} aria-hidden="true" />
            Sign out
          </button>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
          <div className="max-h-[70vh] overflow-y-auto border border-white/10 bg-black/20">
            {state.status === "loading" && (
              <div className="flex items-center justify-center gap-3 py-12 text-kcx-ash">
                <Loader2 size={18} className="animate-spin text-kcx-orange" aria-hidden="true" />
                Loading recordings…
              </div>
            )}
            {state.status === "error" && (
              <div className="flex flex-col items-center gap-2 py-12 text-center text-kcx-ash">
                <AlertTriangle size={20} className="text-kcx-orange" aria-hidden="true" />
                Couldn't load recordings.
              </div>
            )}
            {state.status === "ready" && ordered.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-12 text-center text-kcx-ash">
                <Video size={20} className="text-kcx-cyan" aria-hidden="true" />
                No recordings for this filter.
              </div>
            )}
            {ordered.map((item) => (
              <div key={item.id} className={`block w-full border-b border-white/5 px-4 py-3 text-left transition-colors hover:bg-white/5 ${item.id === selectedId ? "bg-kcx-orange/10" : ""}`}>
                <button type="button" onClick={() => void openItem(item)} className="block w-full text-left focus-ring">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-kcx-cyan">
                      <Camera size={13} aria-hidden="true" />
                      {item.cameraName}
                    </span>
                    {item.protected && <span className="inline-flex items-center gap-1 text-[0.65rem] uppercase tracking-[0.14em] text-kcx-orange"><Shield size={11} aria-hidden="true" />Protected</span>}
                  </div>
                  <p className="mt-1 text-sm text-white">{formatStamp(item)}</p>
                  <p className="mt-0.5 text-xs text-kcx-ash">
                    {formatDuration(item.durationSeconds)} · {item.width && item.height ? `${item.width}×${item.height}` : "Unknown resolution"} · {formatBytes(item.sizeBytes)}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => void toggleProtected(item)}
                  disabled={protectBusyId === item.id}
                  className="button-secondary focus-ring mt-2 py-1 text-xs disabled:opacity-50"
                >
                  {item.protected ? (
                    <>
                      <ShieldOff size={13} aria-hidden="true" />
                      Unprotect
                    </>
                  ) : (
                    <>
                      <Shield size={13} aria-hidden="true" />
                      Protect
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>

          <div className="studio-panel p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-2">
              <button type="button" onClick={() => step(-1)} disabled={selectedIndex <= 0} className="button-secondary focus-ring disabled:opacity-40">
                <SkipBack size={15} aria-hidden="true" />
                Previous
              </button>
              <button type="button" onClick={() => step(1)} disabled={selectedIndex < 0 || selectedIndex >= ordered.length - 1} className="button-secondary focus-ring disabled:opacity-40">
                Next
                <SkipForward size={15} aria-hidden="true" />
              </button>
            </div>

            {!selected && <p className="py-16 text-center text-sm text-kcx-ash">Select a recording from the list.</p>}

            {selected && (
              <>
                <h2 className="text-lg font-semibold text-white">
                  {selected.cameraName} — {formatStamp(selected)}
                </h2>
                <p className="mt-1 text-xs text-kcx-ash">
                  {formatDuration(selected.durationSeconds)} · {selected.width && selected.height ? `${selected.width}×${selected.height}` : "Unknown resolution"} · {formatBytes(selected.sizeBytes)}
                </p>

                <div className="mt-4 overflow-hidden border border-white/10 bg-black">
                  {loadingPlayback && (
                    <div className="flex items-center justify-center gap-3 py-16 text-kcx-ash">
                      <Loader2 size={20} className="animate-spin text-kcx-orange" aria-hidden="true" />
                      Loading playback…
                    </div>
                  )}
                  {!loadingPlayback && playbackError && (
                    <div className="flex flex-col items-center gap-2 px-6 py-16 text-center text-kcx-ash">
                      <AlertTriangle size={20} className="text-kcx-orange" aria-hidden="true" />
                      {playbackError}
                    </div>
                  )}
                  {!loadingPlayback && !playbackError && playbackUrl && (
                    <video key={playbackUrl} controls className="aspect-video w-full bg-black">
                      <source src={playbackUrl} type="video/mp4" />
                    </video>
                  )}
                </div>

                <button type="button" onClick={() => void downloadItem(selected)} className="button-secondary focus-ring mt-4">
                  <Download size={15} aria-hidden="true" />
                  Download
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
