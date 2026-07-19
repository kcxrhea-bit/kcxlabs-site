import { Check, Info } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { nexusStateLabels } from "../../data/nexus-cloud";
import type { NexusMode } from "../../data/nexus-cloud";

type ModeCardProps = {
  mode: NexusMode;
};

export function ModeCard({ mode }: ModeCardProps) {
  const Icon = mode.icon;
  const state = nexusStateLabels[mode.state];
  const headingId = `mode-${mode.id}-title`;

  return (
    <article className="system-panel" aria-labelledby={headingId}>
      <div className="relative">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-[0.7rem] uppercase tracking-[0.24em] text-kcx-ash">{mode.badge}</p>
            <h3 id={headingId} className="mt-3 text-xl font-semibold text-white">
              {mode.name}
            </h3>
          </div>
          <div className="grid size-11 shrink-0 place-items-center border border-white/12 bg-black/30 text-kcx-orange">
            <Icon size={20} aria-hidden="true" />
          </div>
        </div>

        <div className="mb-5">
          <StatusBadge label={state.label} tone={state.tone} size="compact" />
        </div>

        <div className="mb-5 h-px bg-gradient-to-r from-kcx-orange/30 via-white/10 to-transparent" />

        <p className="text-sm leading-7 text-kcx-ash">{mode.summary}</p>

        <ul className="mt-6 grid gap-3">
          {mode.points.map((point) => (
            <li key={point} className="flex gap-3 text-sm leading-6 text-kcx-ash">
              <Check size={15} className="mt-1 shrink-0 text-kcx-cyan" aria-hidden="true" />
              <span>{point}</span>
            </li>
          ))}
        </ul>

        <p className="telemetry-line mt-6 flex gap-3 text-xs leading-6 text-kcx-steel">
          <Info size={15} className="mt-0.5 shrink-0 text-kcx-orange" aria-hidden="true" />
          <span>{mode.caveat}</span>
        </p>
      </div>
    </article>
  );
}
