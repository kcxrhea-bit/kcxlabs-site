import { ArrowUpRight, Download, FileText, GitBranch } from "lucide-react";
import { futureSystems } from "../../data/projects";

export function FuturePreviewSection() {
  return (
    <section id="devlogs" className="section-shell relative pb-28">
      <div className="section-divider top-0" />
      <div className="studio-panel p-6 md:p-8">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.28em] text-kcx-orange">Devlog / future systems</p>
            <h2 className="text-3xl font-semibold leading-tight text-white sm:text-4xl">Planned surfaces, staged carefully.</h2>
          </div>
          <div className="flex flex-wrap gap-3">
            <a href="/beta" className="icon-chip scroll-mt-28">
              <Download size={16} />
              Beta Download
            </a>
            <span id="downloads" className="icon-chip scroll-mt-28">
              <Download size={16} />
              Downloads
            </span>
            <span id="docs" className="icon-chip scroll-mt-28">
              <FileText size={16} />
              Docs
            </span>
          </div>
        </div>

        <div className="mb-6 rounded-xl border border-kcx-orange/40 bg-kcx-orange/10 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-kcx-orange">Private Beta Available</p>
          <h3 className="mt-2 text-xl font-semibold text-white">KCx Studio Companion v0.9.0 Beta 1</h3>
          <p className="mt-2 text-sm leading-6 text-kcx-ash">
            Invited testers can download the Windows beta package, including installer, portable build, license, privacy notes,
            installation guide, quick start guide, known limitations, and release notes.
          </p>
          <a href="/beta" className="mt-4 inline-flex items-center gap-2 rounded-md border border-kcx-orange/60 bg-kcx-orange px-4 py-2 text-sm font-bold uppercase tracking-[0.18em] text-black transition hover:brightness-110">
            <Download size={16} />
            Open Beta Page
          </a>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {futureSystems.map((system) => (
            <div key={system.route} className="future-card" aria-label={`${system.name} future page teaser`}>
              <div className="flex items-start justify-between gap-4">
                <GitBranch size={17} className="mt-1 text-kcx-cyan" aria-hidden="true" />
                <span className="text-xs uppercase tracking-[0.18em] text-kcx-ash">{system.status}</span>
              </div>
              <h3 className="mt-5 text-lg font-semibold text-white">{system.name}</h3>
              <p className="mt-2 text-sm leading-6 text-kcx-ash">{system.note}</p>
              <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/10 pt-4">
                <span className="font-mono text-sm text-kcx-steel">{system.route}</span>
                <ArrowUpRight size={16} className="text-kcx-orange" aria-hidden="true" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}