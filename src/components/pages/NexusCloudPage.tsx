import { ArrowUpRight, Cpu, Info, LayoutDashboard, Lock, ShieldCheck } from "lucide-react";
import { ArchitectureDiagram } from "../nexus-cloud/ArchitectureDiagram";
import { ModeCard } from "../nexus-cloud/ModeCard";
import { RoadmapList } from "../nexus-cloud/RoadmapList";
import { StatusBadge } from "../nexus-cloud/StatusBadge";
import { SectionHeader } from "../ui/SectionHeader";
import { nexusModes, privacyBoundaries, verifiedGatewayBuild } from "../../data/nexus-cloud";
import { getNexusCloudServiceStatus } from "../../cloud";
import { publicRoutePaths } from "../../routes";

export function NexusCloudPage() {
  const service = getNexusCloudServiceStatus();

  return (
    <>
      <section className="section-shell pt-32 lg:pt-36" aria-labelledby="nexus-cloud-title">
        <div className="mx-auto max-w-4xl">
          <div className="mb-6 flex flex-wrap gap-3">
            <StatusBadge label="Local Mode Available On Your Network" tone="verified" />
            <StatusBadge label="Remote Access Not Available" tone="planned" />
            <StatusBadge label="Cloud Preview" tone="development" />
            <StatusBadge label="Hybrid Mode Planned" tone="planned" />
          </div>

          <h1
            id="nexus-cloud-title"
            className="text-4xl font-semibold leading-tight text-white sm:text-5xl lg:text-6xl"
          >
            KCx NEXUS
          </h1>

          <p className="mt-6 max-w-2xl text-base leading-8 text-kcx-ash sm:text-lg">
            Local intelligence works today. The Android companion connects to your own machine over your
            private network, runs models through your KCxLocalAI installation, and answers questions about
            projects you have approved — all without leaving hardware you control.
          </p>
          <p className="mt-4 max-w-2xl text-base leading-8 text-kcx-ash">
            That is a local-network client, not remote access. It needs KCx NEXUS running on your PC and
            your phone on the same private network. Reaching NEXUS over the public internet is a separate,
            unbuilt capability.
          </p>

          <div className="mt-6 flex items-start gap-3 border border-kcx-cyan/30 bg-kcx-cyan/10 p-4" role="note">
            <Info className="mt-1 shrink-0 text-kcx-cyan" size={20} aria-hidden="true" />
            <p className="text-sm leading-7 text-kcx-steel">
              This page is informational. It is not a control surface, it does not connect to any PC, and it
              shows no live NEXUS data. Nothing here reads or exposes local projects.
            </p>
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <a href="#operating-modes" className="button-primary focus-ring">
              <Cpu size={18} aria-hidden="true" />
              Explore Local Mode
            </a>
            <a href={publicRoutePaths["nexus-portal"]} className="button-secondary focus-ring">
              <LayoutDashboard size={18} aria-hidden="true" />
              View Portal Preview
            </a>
            <a href="#roadmap" className="button-secondary focus-ring">
              <ArrowUpRight size={18} aria-hidden="true" />
              Follow Development
            </a>
          </div>

          <p className="telemetry-line mt-8 text-xs leading-6 text-kcx-steel">{service.detail}</p>
        </div>
      </section>

      <section id="operating-modes" className="section-shell relative pt-0" aria-label="Operating modes">
        <div className="section-divider top-0" />
        <SectionHeader
          eyebrow="Operating modes"
          title="Three modes, one honest status each."
          description="Only Local Mode is implemented. The other two describe intended behaviour and are labelled accordingly."
        />
        <div className="grid gap-4 lg:grid-cols-3">
          {nexusModes.map((mode) => (
            <ModeCard key={mode.id} mode={mode} />
          ))}
        </div>
      </section>

      <section className="section-shell relative pt-0" aria-label="Architecture overview">
        <div className="section-divider top-0" />
        <SectionHeader
          eyebrow="Architecture"
          title="How a request travels."
          description="The local path is live and physically validated. The cloud path is drawn for planning purposes only."
        />
        <ArchitectureDiagram />
      </section>

      <section className="section-shell relative pt-0" aria-labelledby="privacy-title">
        <div className="section-divider top-0" />
        <div className="studio-panel p-6 md:p-8">
          <div className="mb-6 flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center border border-kcx-orange/45 bg-black/35 text-kcx-orange">
              <Lock size={19} aria-hidden="true" />
            </span>
            <h2 id="privacy-title" className="text-2xl font-semibold text-white sm:text-3xl">
              Privacy boundary
            </h2>
          </div>

          <ul className="grid gap-3 sm:grid-cols-2">
            {privacyBoundaries.map((rule) => (
              <li key={rule} className="flex gap-3 border-l border-kcx-orange/40 bg-black/20 px-4 py-3">
                <ShieldCheck size={16} className="mt-0.5 shrink-0 text-kcx-cyan" aria-hidden="true" />
                <span className="text-sm leading-6 text-kcx-ash">{rule}</span>
              </li>
            ))}
          </ul>

          <p className="mt-6 text-xs leading-6 text-kcx-ash">
            These are design commitments for the system as built and as planned. They are not claims about
            certification, encryption standards, or regulatory status.
          </p>
        </div>
      </section>

      <section id="roadmap" className="section-shell relative pt-0 pb-28" aria-label="Roadmap">
        <div className="section-divider top-0" />
        <SectionHeader
          eyebrow="Roadmap"
          title="Sequence, not schedule."
          description="Stages are ordered by dependency. No dates are published, and nothing planned is presented as active."
        />
        <div className="studio-panel p-6 md:p-8">
          <RoadmapList />
          <p className="mt-6 text-xs leading-6 text-kcx-ash">
            Local Mode was validated end to end on a physical Android device against gateway build{" "}
            <span className="font-mono text-kcx-steel">{verifiedGatewayBuild}</span>.
          </p>
        </div>
      </section>
    </>
  );
}
