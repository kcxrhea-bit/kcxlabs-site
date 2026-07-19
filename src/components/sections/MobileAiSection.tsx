import { BrainCircuit, Cpu, Network } from "lucide-react";
import { futureInfrastructure } from "../../data/projects";
import { SectionHeader } from "../ui/SectionHeader";

export function MobileAiSection() {
  return (
    <section className="section-shell relative">
      <div className="section-divider top-0" />
      <SectionHeader
        eyebrow="Future infrastructure"
        title="Cortex and Valhalla sit beneath the visible product layer."
        description="The next architecture layer is not another random app list. It is the connected intelligence foundation: runtime orchestration, premium system language, and future infrastructure for the ecosystem."
      />
      <div className="grid gap-4 lg:grid-cols-[0.75fr_1.25fr] lg:items-stretch">
        <div className="system-panel min-h-full">
          <Network className="mb-5 text-kcx-cyan" size={24} />
          <h3 className="text-xl font-semibold text-white">Connected intelligence infrastructure</h3>
          <p className="mt-3 text-sm leading-7 text-kcx-ash">
            KCx Cortex and KCx Valhalla are positioned as deeper ecosystem architecture: the intelligence layer and the
            cinematic interface language that can eventually connect mobile, desktop, messaging, and companion modules.
          </p>
          <div className="mt-6 inline-flex border border-white/10 bg-black/25 px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-kcx-steel">
            Future ecosystem layer
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
        {[
          {
            icon: BrainCircuit,
            project: futureInfrastructure[1],
          },
          {
            icon: Cpu,
            project: futureInfrastructure[0],
          },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.project.name} className="system-panel min-h-full">
              <Icon className="mb-5 text-kcx-cyan" size={24} />
              <p className="text-[0.7rem] uppercase tracking-[0.24em] text-kcx-ash">{item.project.eyebrow}</p>
              <h3 className="mt-3 text-xl font-semibold text-white">{item.project.name}</h3>
              <p className="mt-3 text-sm leading-7 text-kcx-ash">{item.project.summary}</p>
              <div className="mt-6 inline-flex border border-white/10 bg-black/25 px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-kcx-steel">
                {item.project.status}
              </div>
            </div>
          );
        })}
        </div>
      </div>
    </section>
  );
}
