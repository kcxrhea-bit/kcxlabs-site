import { motion } from "framer-motion";
import { primarySystems } from "../../data/projects";
import { SectionHeader } from "../ui/SectionHeader";
import { SystemPanel } from "../ui/SystemPanel";

export function EcosystemSection() {
  return (
    <section id="ecosystem" className="section-shell relative">
      <div className="section-divider top-0" />
      <SectionHeader
        eyebrow="Primary systems"
        title="Three flagship surfaces define the KCx ecosystem runtime."
        description="KCxMode, KCx Studio Companion, and KCx Messenger form the top-level loop: mobile control, desktop creation, and communication continuity. Everything else supports or extends that runtime."
      />
      <motion.div
        className="grid gap-4 lg:grid-cols-3"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
        variants={{ visible: { transition: { staggerChildren: 0.07 } } }}
      >
        {primarySystems.map((project) => (
          <motion.div
            key={project.name}
            variants={{ hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } }}
            transition={{ duration: 0.45 }}
          >
            <SystemPanel project={project} />
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
