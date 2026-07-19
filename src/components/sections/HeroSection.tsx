import { motion } from "framer-motion";
import { ArrowRight, Cpu, Sparkles } from "lucide-react";

export function HeroSection() {
  return (
    <section id="home" className="relative px-4 pb-24 pt-32 sm:px-6 lg:px-8 lg:pb-32 lg:pt-44">
      <motion.div
        className="ambient-orbit left-[8%] top-28 h-56 w-56 bg-kcx-orange/18"
        animate={{ opacity: [0.28, 0.48, 0.28], scale: [1, 1.06, 1] }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="ambient-orbit right-[10%] top-40 h-48 w-48 bg-kcx-cyan/10"
        animate={{ opacity: [0.18, 0.34, 0.18], scale: [1, 1.04, 1] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="section-divider top-0" />
      <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[1.04fr_0.96fr] lg:items-center">
        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
          <div className="mb-7 inline-flex items-center gap-2 border border-kcx-orange/25 bg-black/35 px-3 py-2 text-xs uppercase tracking-[0.24em] text-kcx-orange shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur">
            <Sparkles size={14} />
            kcxlabs.org
          </div>
          <p className="mb-4 max-w-2xl text-sm uppercase tracking-[0.32em] text-kcx-ash">AI-assisted ecosystem runtime</p>
          <h1 className="max-w-4xl text-5xl font-semibold leading-[0.98] text-white sm:text-6xl lg:text-7xl xl:text-8xl">
            KCx Labs
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-kcx-ash sm:text-xl sm:leading-9">
            A founder-built AI software ecosystem for Android modes, desktop creator tools, local-first runtime layers,
            robotics companions, and cinematic interfaces that feel engineered instead of inflated.
          </p>
          <div className="mt-8 grid max-w-2xl gap-3 sm:grid-cols-3">
            {["Active mobile build", "Desktop companion", "Cortex runtime"].map((label) => (
              <div key={label} className="micro-panel">
                {label}
              </div>
            ))}
          </div>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <a href="#ecosystem" className="button-primary">
              Explore ecosystem
              <ArrowRight size={18} />
            </a>
            <a href="mailto:jason@kcxlabs.org" className="button-secondary">
              Contact
            </a>
          </div>
        </motion.div>
        <motion.div
          className="runtime-frame relative min-h-[430px] p-3 sm:p-4"
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.1 }}
        >
          <div className="relative grid h-full min-h-[400px] place-items-center overflow-hidden border border-white/10 bg-black/45">
            <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(255,122,26,0.12),transparent_34%),radial-gradient(circle_at_75%_20%,rgba(55,213,255,0.11),transparent_28%)]" />
            <div className="absolute left-5 top-5 flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-kcx-ash">
              <Cpu size={16} className="text-kcx-cyan" />
              runtime mesh
            </div>
            <div className="hero-core">
              <span />
              <span />
              <span />
            </div>
            <div className="absolute right-5 top-5 hidden text-right font-mono text-[0.66rem] uppercase leading-5 tracking-[0.16em] text-kcx-ash sm:block">
              ACTIVE BUILD<br />
              FORGE ONLINE
            </div>
            <div className="absolute bottom-5 left-5 right-5 grid gap-3 sm:grid-cols-3">
              {["KCxMode", "Studio", "Cortex"].map((label) => (
                <div key={label} className="border border-white/10 bg-black/55 px-4 py-3 text-xs uppercase tracking-[0.2em] text-kcx-steel shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur">
                  {label}
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
