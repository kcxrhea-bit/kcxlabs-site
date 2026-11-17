import { ArrowUpRight, Clapperboard, Gamepad2, Music2, Youtube } from "lucide-react";

const channelUrl = "https://www.youtube.com/@TannerKCxProductions";

const highlights = [
  { icon: Gamepad2, label: "Gaming & Fortnite", tone: "text-cyan-300" },
  { icon: Music2, label: "Original KCx music", tone: "text-fuchsia-300" },
  { icon: Clapperboard, label: "Animation & cinema", tone: "text-cyan-300" },
];

export function ProductionsSection() {
  return (
    <section className="section-shell relative" aria-labelledby="productions-home-title">
      <div className="pointer-events-none absolute inset-x-8 top-1/3 -z-10 h-56 bg-gradient-to-r from-cyan-400/10 via-fuchsia-500/10 to-transparent blur-3xl" />
      <div className="overflow-hidden rounded-2xl border border-cyan-300/20 bg-[linear-gradient(125deg,rgba(17,29,36,0.92),rgba(20,15,25,0.94)_58%,rgba(18,18,20,0.98))] p-6 shadow-[0_30px_100px_rgba(0,0,0,0.28)] sm:p-9 lg:p-12">
        <div className="grid gap-9 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">KCx creative project</p>
            <h2 id="productions-home-title" className="text-3xl font-semibold leading-tight text-white sm:text-4xl">
              Tanner &amp; KCx Productions
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-8 text-kcx-ash">
              An independent creative media project featuring original music, gaming content, animated music videos, and cinematic productions.
            </p>
            <p className="mt-4 text-lg font-medium tracking-wide text-fuchsia-200">Two generations. One creative vision.</p>
            <p className="mt-2 text-sm leading-7 text-kcx-ash">Powered by creativity and KCxLabs technology.</p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <a className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-cyan-200/50 bg-cyan-300 px-6 py-3 text-sm font-bold text-[#081014] transition hover:bg-cyan-200 focus-ring" href={channelUrl} target="_blank" rel="noopener noreferrer">
                <Youtube size={18} /> Visit our YouTube channel <ArrowUpRight size={16} />
              </a>
              <a className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-fuchsia-300/35 bg-fuchsia-300/10 px-6 py-3 text-sm font-semibold text-fuchsia-100 transition hover:bg-fuchsia-300/15 focus-ring" href="/productions">
                Explore Productions <ArrowUpRight size={16} />
              </a>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            {highlights.map(({ icon: Icon, label, tone }) => (
              <div key={label} className="flex min-h-16 items-center gap-4 rounded-xl border border-white/10 bg-black/25 px-4 py-3">
                <Icon size={21} className={tone} aria-hidden="true" />
                <span className="text-sm font-medium text-white">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
