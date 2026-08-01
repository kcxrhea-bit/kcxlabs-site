import { Apple, ExternalLink, ShieldCheck, Smartphone } from "lucide-react";
import { SectionHeader } from "../ui/SectionHeader";

const CONVOY_WEB_URL = "https://convoy.kcxlabs.org";

export function ConvoyDownloadsSection() {
  return (
    <section id="downloads" className="section-shell relative scroll-mt-28">
      <div className="section-divider top-0" />
      <SectionHeader
        eyebrow="Downloads"
        title="Convoy"
        description="Keep your group connected through the hosted web app today. Native mobile packages appear here only after their release artifacts are independently verified."
      />

      <article className="studio-panel overflow-hidden p-6 md:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-5 flex items-center gap-4">
              <div className="grid size-12 place-items-center border border-kcx-orange/35 bg-black/35 text-kcx-orange shadow-[0_0_34px_rgba(255,122,26,0.1)]">
                <Smartphone size={23} aria-hidden="true" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-kcx-orange">Development Preview</p>
                <h3 className="mt-1 text-2xl font-semibold text-white">Convoy v1.0.0</h3>
              </div>
            </div>
            <p className="text-sm leading-7 text-kcx-ash">
              Convoy coordinates private trip groups with member presence, shared events, vehicle status, and foreground web location.
              The hosted PWA is the current cross-platform testing option.
            </p>
          </div>

          <a href={CONVOY_WEB_URL} target="_blank" rel="noreferrer" className="button-secondary focus-ring inline-flex shrink-0 items-center justify-center gap-2">
            <ExternalLink size={17} aria-hidden="true" />
            Open Web App
          </a>
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-2">
          <div className="project-preview-card">
            <div className="flex items-start justify-between gap-4">
              <Smartphone size={20} className="text-kcx-cyan" aria-hidden="true" />
              <span className="border border-white/10 bg-black/30 px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-kcx-steel">Development Preview</span>
            </div>
            <h4 className="mt-5 text-xl font-semibold text-white">Android</h4>
            <p className="mt-3 text-sm leading-6 text-kcx-ash">A public Android download will appear only after a signed APK is verified. No APK is currently published.</p>
            <dl className="mt-5 space-y-2 border-t border-white/10 pt-4 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-kcx-ash">Version</dt><dd className="font-mono text-kcx-steel">1.0.0</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-kcx-ash">File size</dt><dd className="font-mono text-kcx-steel">Pending verified APK</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-kcx-ash">SHA-256</dt><dd className="font-mono text-kcx-steel">Pending verification</dd></div>
            </dl>
            <p className="mt-5 text-sm leading-6 text-kcx-steel">Android: download and sideload the signed APK once it is published.</p>
          </div>

          <div className="project-preview-card">
            <div className="flex items-start justify-between gap-4">
              <Apple size={20} className="text-kcx-cyan" aria-hidden="true" />
              <span className="border border-white/10 bg-black/30 px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-kcx-steel">Coming Soon</span>
            </div>
            <h4 className="mt-5 text-xl font-semibold text-white">iPhone</h4>
            <p className="mt-3 text-sm font-semibold text-kcx-orange">iPhone beta coming soon</p>
            <p className="mt-3 text-sm leading-6 text-kcx-ash">No direct IPA is offered. A TestFlight button will appear only after Apple beta review and a real public invitation URL are ready.</p>
            <p className="mt-5 border-t border-white/10 pt-4 text-sm leading-6 text-kcx-steel">iPhone: install TestFlight, open the invitation link, then install Convoy when the beta becomes available.</p>
          </div>
        </div>

        <div className="mt-6 flex items-start gap-3 rounded-xl border border-kcx-cyan/30 bg-kcx-cyan/5 p-5">
          <ShieldCheck size={19} className="mt-0.5 shrink-0 text-kcx-cyan" aria-hidden="true" />
          <p className="text-sm leading-6 text-kcx-ash">The Convoy web app is available now as the installation-free alternative for Android and iPhone. Web testing remains foreground-only and does not claim native push, background GPS, or screen-off tracking.</p>
        </div>
      </article>
    </section>
  );
}
