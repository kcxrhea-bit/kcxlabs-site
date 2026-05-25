import { Bot, Orbit, Waves } from "lucide-react";

export function RoboticsSection() {
  return (
    <section id="robotics" className="section-shell relative">
      <div className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-center">
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.28em] text-kcx-orange">Robotics / Companion AI</p>
          <h2 className="text-3xl font-semibold leading-tight text-white sm:text-4xl lg:text-5xl">Companion systems with presence, not noise.</h2>
          <p className="mt-5 text-base leading-8 text-kcx-ash">
            KCx Labs includes a research/prototype lane for companion AI: embodied interfaces, expressive signals,
            spatial context, and assistive behavior that earns attention instead of demanding it.
          </p>
          <div className="mt-6 inline-flex border border-white/10 bg-black/25 px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-kcx-steel">
            Research / Prototype
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { icon: Bot, label: "Embodiment" },
            { icon: Orbit, label: "Spatial context" },
            { icon: Waves, label: "Expressive signals" },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="system-panel min-h-44">
                <Icon className="mb-8 text-kcx-orange" size={26} />
                <p className="text-sm uppercase tracking-[0.2em] text-kcx-steel">{item.label}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
