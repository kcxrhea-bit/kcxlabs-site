import { StatusBadge } from "./StatusBadge";
import { nexusStateLabels, roadmapStages } from "../../data/nexus-cloud";
import type { NexusStatusTone } from "../../data/nexus-cloud";

/** The in-flight phase gets its own label so it is never confused with a shipped one. */
const currentStage = { label: "Current Phase", tone: "development" as NexusStatusTone };

export function RoadmapList() {
  return (
    <ol className="grid gap-3">
      {roadmapStages.map((stage) => {
        const state = stage.state === "current" ? currentStage : nexusStateLabels[stage.state];

        return (
          <li
            key={stage.order}
            className="flex flex-wrap items-start gap-x-4 gap-y-3 border border-white/10 bg-black/20 px-4 py-4"
          >
            <span className="grid size-8 shrink-0 place-items-center border border-kcx-orange/40 bg-black/35 font-mono text-xs font-bold text-kcx-orange">
              {stage.order}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-kcx-steel">{stage.name}</p>
              <p className="mt-1 text-xs leading-6 text-kcx-ash">{stage.detail}</p>
            </div>
            <StatusBadge label={state.label} tone={state.tone} size="compact" />
          </li>
        );
      })}
    </ol>
  );
}
