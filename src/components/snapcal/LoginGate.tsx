import { useState, type FormEvent } from "react";
import { LogIn, ShieldAlert } from "lucide-react";
import { login, SnapCalApiError } from "./snapcalApi";

type LoginGateProps = {
  onSignedIn: () => void;
};

export function LoginGate({ onSignedIn }: LoginGateProps) {
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
      await login(email.trim(), password);
      onSignedIn();
    } catch (err) {
      setError(err instanceof SnapCalApiError ? err.message : "Sign-in failed. Try again.");
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
        <h1 className="text-2xl font-semibold text-white">SnapCal</h1>
        <p className="mt-2 text-sm leading-6 text-kcx-ash">
          Sign in with the KCx Labs owner account to view and manage the hosted calendar.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 grid gap-4" noValidate>
          <label className="grid gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-kcx-ash">
            Email
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="snapcal-input focus-ring"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-kcx-ash">
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="snapcal-input focus-ring"
            />
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
