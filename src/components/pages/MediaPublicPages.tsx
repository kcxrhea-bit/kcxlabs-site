import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, Calendar, Clapperboard, HardDrive, Loader2, PlayCircle, RefreshCw } from "lucide-react";
import { SectionHeader } from "../ui/SectionHeader";
import type { PublicMediaItem, SharePageMode } from "../../media/types";

type FetchResult<T> = { ok: true; body: T } | { ok: false; status: number };

async function fetchJson<T>(path: string, init?: RequestInit): Promise<FetchResult<T>> {
  const response = await fetch(`/api/${path}`, init);
  if (!response.ok) return { ok: false, status: response.status };
  return { ok: true, body: (await response.json()) as T };
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function StatePanel({ icon: Icon, tone, title, description, action }: { icon: typeof AlertTriangle; tone: "orange" | "cyan"; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="system-panel system-panel-compact flex flex-col items-center gap-3 py-14 text-center">
      <Icon size={24} className={tone === "orange" ? "text-kcx-orange" : "text-kcx-cyan"} aria-hidden="true" />
      <p className="text-lg font-semibold text-white">{title}</p>
      <p className="max-w-md text-sm text-kcx-ash">{description}</p>
      {action}
    </div>
  );
}

// ─── /clips ──────────────────────────────────────────────────────────────

type ClipsState = { status: "loading" } | { status: "error" } | { status: "ready"; items: PublicMediaItem[] };

export function ClipsPage() {
  const [state, setState] = useState<ClipsState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const mounted = useRef(true);
  const lastRefreshStarted = useRef(0);

  const loadClips = useCallback(async (showInitialLoading = false) => {
    if (showInitialLoading) setState({ status: "loading" });
    else setRefreshing(true);
    try {
      const result = await fetchJson<{ items: PublicMediaItem[] }>("clips", { cache: "no-store" });
      if (!mounted.current) return;
      setState((current) => result.ok ? { status: "ready", items: result.body.items } : current.status === "ready" ? current : { status: "error" });
      if (result.ok) setLastUpdated(new Date());
    } catch {
      if (mounted.current) setState((current) => current.status === "ready" ? current : { status: "error" });
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    lastRefreshStarted.current = Date.now();
    void loadClips(true);
    const refreshAfterReturn = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRefreshStarted.current < 750) return;
      lastRefreshStarted.current = now;
      void loadClips();
    };
    window.addEventListener("focus", refreshAfterReturn);
    document.addEventListener("visibilitychange", refreshAfterReturn);
    return () => {
      mounted.current = false;
      window.removeEventListener("focus", refreshAfterReturn);
      document.removeEventListener("visibilitychange", refreshAfterReturn);
    };
  }, [loadClips]);

  return (
    <section className="section-shell pt-32 lg:pt-36" aria-labelledby="clips-title">
      <SectionHeader
        eyebrow="KCx Media"
        title="Clips"
        description="Public clips published from the KCx Media Center — every desktop upload lands here automatically, no redeploy required."
      />
      <div className="mx-auto max-w-6xl">
        <div className="mb-5 grid gap-3 border border-white/10 bg-black/25 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <p className="text-sm font-semibold text-white">Public clip gallery</p>
            <p className="mt-1 text-xs text-kcx-ash">{state.status === "ready" ? `${state.items.length} clip${state.items.length === 1 ? "" : "s"}` : "Checking clips"}{lastUpdated ? ` · Updated ${lastUpdated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</p>
          </div>
          <button type="button" onClick={() => void loadClips()} disabled={refreshing} className="button-secondary focus-ring justify-self-start sm:justify-self-end">
            <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} aria-hidden="true" />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {state.status === "loading" && (
          <div className="flex items-center justify-center gap-3 py-16 text-kcx-ash">
            <Loader2 size={20} className="animate-spin text-kcx-orange" aria-hidden="true" />
            Loading clips…
          </div>
        )}
        {state.status === "error" && (
          <StatePanel icon={AlertTriangle} tone="orange" title="Clips couldn't be loaded" description="The clips API didn't respond. Check your connection and try again." />
        )}
        {state.status === "ready" && state.items.length === 0 && (
          <StatePanel icon={Clapperboard} tone="cyan" title="No clips yet" description="Clips published from the KCx Media Center will show up here automatically." />
        )}
        {state.status === "ready" && state.items.length > 0 && (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {state.items.map((item) => (
              <a key={item.publicId} href={`/c/${item.publicId}`} className="project-preview-card block focus-ring">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <span className="grid size-11 place-items-center border border-kcx-orange/35 bg-black/35 text-kcx-orange">
                    <Clapperboard size={20} aria-hidden="true" />
                  </span>
                  <span className="border border-white/10 bg-black/30 px-2.5 py-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-kcx-ash">
                    {item.kind}
                  </span>
                </div>
                <h3 className="line-clamp-2 text-lg font-semibold leading-snug text-white">{item.title || item.originalFilename}</h3>
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-kcx-ash">
                  {formatDate(item.uploadedAt) && (
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar size={13} aria-hidden="true" />
                      {formatDate(item.uploadedAt)}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5">
                    <HardDrive size={13} aria-hidden="true" />
                    {formatBytes(item.sizeBytes)}
                  </span>
                </div>
                {!item.originalOnline && <p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-kcx-ash">Archived</p>}
              </a>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ─── /c/<publicId> ───────────────────────────────────────────────────────

type ShareResponse = { media: PublicMediaItem; mode: SharePageMode; deliveryUrl: string | null; thumbnailUrl: string | null };
type ShareState = { status: "loading" } | { status: "not-found" } | { status: "error" } | { status: "ready"; data: ShareResponse };

export function SharePage() {
  const publicId = window.location.pathname.split("/").pop() ?? "";
  const [state, setState] = useState<ShareState>({ status: "loading" });
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    setPlaybackFailed(false);
    fetchJson<ShareResponse>(`media/public/${publicId}`)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setState({ status: "ready", data: result.body });
        else setState(result.status === 404 ? { status: "not-found" } : { status: "error" });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
    // `reloadToken` intentionally re-runs this effect: retrying after an error or an expired
    // playback link re-fetches the share endpoint, which mints a fresh presigned deliveryUrl.
  }, [publicId, reloadToken]);

  const retry = () => setReloadToken((value) => value + 1);

  return (
    <section className="section-shell pt-32 lg:pt-36" aria-labelledby="clip-title">
      <div className="mx-auto max-w-4xl">
        <a href="/clips" className="mb-8 inline-flex items-center gap-2 text-sm text-kcx-ash transition-colors hover:text-kcx-orange focus-ring">
          <ArrowLeft size={15} aria-hidden="true" />
          Back to Clips
        </a>

        {state.status === "loading" && (
          <div className="flex items-center justify-center gap-3 py-24 text-kcx-ash">
            <Loader2 size={20} className="animate-spin text-kcx-orange" aria-hidden="true" />
            Loading clip…
          </div>
        )}

        {state.status === "not-found" && (
          <StatePanel icon={AlertTriangle} tone="orange" title="Clip not found" description="This share link is invalid, private, or no longer available." />
        )}

        {state.status === "error" && (
          <StatePanel
            icon={AlertTriangle}
            tone="orange"
            title="Couldn't load this clip"
            description="The clip API didn't respond. Check your connection and try again."
            action={
              <button type="button" onClick={retry} className="button-secondary focus-ring mt-2">
                <RefreshCw size={15} aria-hidden="true" />
                Try again
              </button>
            }
          />
        )}

        {state.status === "ready" &&
          (() => {
            const { media, mode, deliveryUrl, thumbnailUrl } = state.data;
            return (
              <div className="studio-panel p-5 sm:p-8">
                <p className="text-[0.7rem] uppercase tracking-[0.24em] text-kcx-orange">KCx Media</p>
                <h1 id="clip-title" className="mt-3 text-2xl font-semibold leading-tight text-white sm:text-3xl">
                  {media.title || media.originalFilename}
                </h1>

                <div className="mt-6 overflow-hidden border border-white/10 bg-black">
                  {mode === "archived" ? (
                    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                      {thumbnailUrl && <img src={thumbnailUrl} alt="" className="mb-2 max-h-64 w-full object-cover opacity-60" />}
                      <p className="font-semibold text-white">This clip is archived</p>
                      <p className="max-w-sm text-sm text-kcx-ash">The original is safely stored on the owner's PC and isn't currently online for playback.</p>
                    </div>
                  ) : mode === "playable" && media.kind === "video" && deliveryUrl && !playbackFailed ? (
                    <video key={`${deliveryUrl}-${reloadToken}`} controls className="aspect-video w-full bg-black" poster={thumbnailUrl ?? undefined} onError={() => setPlaybackFailed(true)}>
                      <source src={deliveryUrl} type={media.mimeType} />
                    </video>
                  ) : mode === "playable" && media.kind === "video" && playbackFailed ? (
                    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                      <AlertTriangle size={22} className="text-kcx-orange" aria-hidden="true" />
                      <p className="font-semibold text-white">Playback failed</p>
                      <p className="max-w-sm text-sm text-kcx-ash">The playback link may have expired. Try loading it again.</p>
                      <button type="button" onClick={retry} className="button-secondary focus-ring mt-2">
                        <RefreshCw size={15} aria-hidden="true" />
                        Try again
                      </button>
                    </div>
                  ) : mode === "playable" && media.kind === "image" && deliveryUrl ? (
                    <img src={deliveryUrl} alt={media.title || media.originalFilename} className="w-full object-contain" />
                  ) : (
                    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                      <PlayCircle size={22} className="text-kcx-cyan" aria-hidden="true" />
                      <p className="font-semibold text-white">Preview isn't available for this file type.</p>
                      {deliveryUrl && (
                        <a href={deliveryUrl} className="button-secondary focus-ring mt-2">
                          Download file
                        </a>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-kcx-ash">
                  <span className="inline-flex items-center gap-1.5">
                    <HardDrive size={13} aria-hidden="true" />
                    {formatBytes(media.sizeBytes)}
                  </span>
                  {formatDate(media.uploadedAt) && (
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar size={13} aria-hidden="true" />
                      {formatDate(media.uploadedAt)}
                    </span>
                  )}
                  {media.game && <span>{media.game}</span>}
                  {media.eventType && <span>{media.eventType}</span>}
                </div>

                {media.description && <p className="mt-5 text-sm leading-7 text-kcx-ash">{media.description}</p>}
              </div>
            );
          })()}
      </div>
    </section>
  );
}
