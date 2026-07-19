import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { primarySystems } from "../../data/projects";
import { SectionHeader } from "../ui/SectionHeader";

export function ProjectsPreviewSection() {
  return (
    <section id="projects" className="section-shell relative">
      <div className="section-divider top-0" />
      <SectionHeader
        eyebrow="Projects preview"
        title="Flagship pages are staged, not faked."
        description="These previews bridge the homepage to future project pages while keeping the current site honest: no routing, no pretend downloads, and no empty product claims."
      />
      <div className="grid gap-5 lg:grid-cols-3">
        {primarySystems.map((project, index) => {
          const Icon = project.icon;

          return (
            <motion.article
              key={project.name}
              className="project-preview-card"
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.22 }}
              transition={{ duration: 0.45, delay: index * 0.06 }}
            >
              <div className="mb-8 flex items-start justify-between gap-5">
                <div className="grid size-12 place-items-center border border-kcx-orange/35 bg-black/35 text-kcx-orange shadow-[0_0_34px_rgba(255,122,26,0.1)]">
                  <Icon size={22} />
                </div>
                <span className="border border-white/10 bg-black/30 px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-kcx-steel">
                  {project.status}
                </span>
              </div>
              <p className="text-[0.7rem] uppercase tracking-[0.24em] text-kcx-ash">{project.eyebrow}</p>
              <h3 className="mt-3 text-2xl font-semibold leading-tight text-white">{project.name}</h3>
              <p className="mt-4 text-sm leading-7 text-kcx-ash">{project.summary}</p>
              <div className="mt-7 flex items-center justify-between gap-4 border-t border-white/10 pt-5">
                <span className="font-mono text-sm text-kcx-steel">Future page: {project.futurePath}</span>
                <ArrowRight size={16} className="text-kcx-cyan" aria-hidden="true" />
              </div>
              <button className="preview-disabled-button mt-6 w-full" type="button" disabled>
                Page Coming Soon
              </button>
            </motion.article>
          );
        })}
      </div>
    </section>
  );
}
