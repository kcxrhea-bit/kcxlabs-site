import type { Project } from "../../data/projects";

type SystemPanelProps = {
  project: Project;
  density?: "default" | "compact";
};

const signalClass = {
  orange: "border-kcx-orange/45 text-kcx-orange shadow-[0_0_32px_rgba(255,122,26,0.12)]",
  cyan: "border-kcx-cyan/35 text-kcx-cyan shadow-[0_0_32px_rgba(55,213,255,0.08)]",
  red: "border-kcx-red/40 text-kcx-red shadow-[0_0_32px_rgba(227,49,23,0.1)]",
};

export function SystemPanel({ project, density = "default" }: SystemPanelProps) {
  const Icon = project.icon;

  return (
    <article className={`system-panel group ${density === "compact" ? "system-panel-compact" : ""}`}>
      <div className={`${density === "compact" ? "mb-5" : "mb-6"} flex items-start justify-between gap-4`}>
        <div>
          <p className="text-[0.7rem] uppercase tracking-[0.24em] text-kcx-ash">{project.eyebrow}</p>
          <h3 className="mt-3 text-xl font-semibold text-white">{project.name}</h3>
        </div>
        <div className={`grid size-11 shrink-0 place-items-center border bg-black/30 ${signalClass[project.signal]}`}>
          <Icon size={20} />
        </div>
      </div>
      <div className="mb-5 h-px bg-gradient-to-r from-kcx-orange/30 via-white/10 to-transparent" />
      <p className="text-sm leading-7 text-kcx-ash">{project.summary}</p>
      <div className="mt-6 inline-flex border border-white/10 bg-black/25 px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-kcx-steel">
        {project.status}
      </div>
    </article>
  );
}
