import { motion } from "framer-motion";
import { Braces, Layers3, MonitorCog } from "lucide-react";

export function StudioSpotlight() {
  return (
    <section className="section-shell relative">
      <div className="absolute inset-x-8 top-1/2 -z-10 h-52 bg-kcx-orange/10 blur-3xl" />
      <div id="studio" className="studio-panel grid gap-8 p-6 md:p-8 lg:grid-cols-[0.85fr_1.15fr] lg:gap-10">
        <motion.div initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.28em] text-kcx-orange">Studio spotlight</p>
          <h2 className="text-3xl font-semibold leading-tight text-white sm:text-4xl lg:text-5xl">KCx Studio Companion</h2>
          <p className="mt-6 text-base leading-8 text-kcx-ash">
            The desktop center of gravity for KCx Labs: part creator workbench, part AI session companion, part project
            memory surface. It is being built to support real founder workflows without pretending to be a finished suite.
          </p>
          <div className="mt-8 grid gap-3 font-mono text-[0.72rem] uppercase tracking-[0.16em] text-kcx-ash sm:grid-cols-2">
            <span className="telemetry-line">Status: In Development</span>
            <span className="telemetry-line">Surface: desktop</span>
            <span className="telemetry-line">Mode: companion</span>
            <span className="telemetry-line">Signal: local-first</span>
          </div>
        </motion.div>
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { icon: MonitorCog, label: "Command", text: "A focused control surface for active projects, tools, and build context." },
            { icon: Braces, label: "Runtime", text: "AI session wiring for local-first memory, actions, and model-aware assistance." },
            { icon: Layers3, label: "Interface", text: "Premium cinematic panels shaped for clarity, not spectacle." },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="runtime-tile">
                <Icon className="mb-8 text-kcx-orange" size={24} />
                <h3 className="text-lg font-semibold text-white">{item.label}</h3>
                <p className="mt-3 text-sm leading-6 text-kcx-ash">{item.text}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
