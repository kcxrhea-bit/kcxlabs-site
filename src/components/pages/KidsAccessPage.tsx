import { useState, type FormEvent } from "react";

/**
 * Extremely simple code-entry gate for the private family game routes (/kids, /kids-legacy).
 * Middleware (middleware.ts) redirects here when a visitor has no valid access cookie. On a
 * correct code, /api/kids-access sets an HttpOnly session cookie and we send the visitor on to
 * wherever they were originally headed. The code itself never lives in this page's source —
 * it's compared server-side against process.env.KIDS_ACCESS_CODE.
 */
export function KidsAccessPage() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const nextPath = (() => {
    const raw = new URLSearchParams(window.location.search).get("next");
    return raw && raw.startsWith("/") ? raw : "/kids/";
  })();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(false);
    try {
      const res = await fetch("/api/kids-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (res.ok) {
        window.location.href = nextPath;
        return;
      }
      setError(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex min-h-[70vh] flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <p className="text-sm uppercase tracking-[0.2em] text-kcx-ash">Private Family Game</p>
      <form onSubmit={submit} className="flex flex-col items-center gap-4">
        <input
          type="tel"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
          className="w-56 border border-white/20 bg-kcx-forge px-4 py-4 text-center text-3xl tracking-[0.3em] text-kcx-steel focus-ring"
          aria-label="Access code"
        />
        <button type="submit" disabled={busy} className="button-primary px-10 py-4 text-lg">
          {busy ? "…" : "Enter"}
        </button>
        {error && <p className="text-sm text-kcx-red">Not quite — try again.</p>}
      </form>
    </section>
  );
}
