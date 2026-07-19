import { motion } from "framer-motion";
import { subsystemModules } from "../../data/projects";
import { SectionHeader } from "../ui/SectionHeader";
import { SystemPanel } from "../ui/SystemPanel";

export function SubsystemModulesSection() {
  return (
    <section className="section-shell relative">
      <div className="section-divider top-0" />
      <SectionHeader
        eyebrow="Subsystem modules"
        title="Supporting tools orbit the primary runtime."
        description="These modules are lower-level ecosystem surfaces: experiments, utilities, companion layers, and runtime helpers that can expand around the flagship KCx systems over time."
      />
      <motion.div
        className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.18 }}
        variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
      >
        {subsystemModules.map((project) => (
          <motion.div
            key={project.name}
            variants={{ hidden: { opacity: 0, y: 14 }, visible: { opacity: 1, y: 0 } }}
            transition={{ duration: 0.42 }}
          >
            <SystemPanel project={project} density="compact" />
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
