import { StatusBadge } from "./StatusBadge";
import { nexusStateLabels } from "../../data/nexus-cloud";
import type { NexusCloudFeature } from "../../cloud/types";

type CapabilityListProps = {
  title: string;
  description: string;
  features: NexusCloudFeature[];
  titleId: string;
};

export function CapabilityList({ title, description, features, titleId }: CapabilityListProps) {
  return (
    <section className="system-panel system-panel-compact" aria-labelledby={titleId}>
      <div className="relative">
        <h2 id={titleId} className="text-xl font-semibold text-white">
          {title}
        </h2>
        <p className="mt-3 text-sm leading-7 text-kcx-ash">{description}</p>

        <ul className="mt-6 grid gap-3">
          {features.map((feature) => {
            const state = nexusStateLabels[feature.state];

            return (
              <li
                key={feature.id}
                className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border border-white/10 bg-black/20 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-kcx-steel">{feature.name}</p>
                  <p className="mt-1 text-xs leading-6 text-kcx-ash">{feature.summary}</p>
                </div>
                <StatusBadge label={state.label} tone={state.tone} size="compact" />
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
