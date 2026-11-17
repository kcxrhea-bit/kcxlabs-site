import { ArrowUpRight, Clapperboard, Film, Gamepad2, Music2, Youtube } from "lucide-react";

const channelUrl = "https://www.youtube.com/@TannerKCxProductions";

const projects = [
  {
    icon: Gamepad2,
    eyebrow: "Gaming",
    title: "Gaming & Fortnite",
    description: "Gaming content and Fortnite moments brought together for creative entertainment.",
    accent: "border-cyan-300/25 from-cyan-300/10",
    iconTone: "text-cyan-300",
  },
  {
    icon: Music2,
    eyebrow: "Original audio",
    title: "KCx music & music videos",
    description: "Original KCx music paired with visual ideas developed for each music video.",
    accent: "border-fuchsia-300/25 from-fuchsia-300/10",
    iconTone: "text-fuchsia-300",
  },
  {
    icon: Clapperboard,
    eyebrow: "Visual storytelling",
    title: "3D animation",
    description: "Animated music videos and 3D work that bring original stories and sounds to the screen.",
    accent: "border-cyan-300/25 from-cyan-300/10",
    iconTone: "text-cyan-300",
  },
  {
    icon: Film,
    eyebrow: "Production",
    title: "Cinematic projects",
    description: "Cinematic productions and creative entertainment projects powered by imagination and KCxLabs tools.",
    accent: "border-fuchsia-300/25 from-fuchsia-300/10",
    iconTone: "text-fuchsia-300",
  },
];

export function ProductionsPage() {
  return (
    <>
      <section className="relative overflow-hidden px-4 pb-16 pt-32 sm:px-6 sm:pb-20 lg:px-8 lg:pb-24 lg:pt-40">
        <div className="pointer-events-none absolute inset-x-0 top-16 -z-10 mx-auto h-80 max-w-5xl bg-[radial-gradient(ellipse_at_center,rgba(34,211,238,0.12),rgba(217,70,239,0.07)_42%,transparent_72%)] blur-2xl" />
        <div className="mx-auto max-w-7xl">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">KCx creative project</p>
          <h1 className="max-w-5xl text-4xl font-semibold leading-[1.04] text-white sm:text-5xl md:text-6xl lg:text-7xl">
            Tanner <span className="text-cyan-200">&amp;</span> KCx Productions
          </h1>
          <div className="mt-7 grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
            <div>
              <p className="max-w-3xl text-base leading-8 text-kcx-ash sm:text-lg sm:leading-9">
                An independent creative media project featuring original music, gaming content, animated music videos, and cinematic productions.
              </p>
              <p className="mt-5 text-xl font-medium text-fuchsia-200 sm:text-2xl">Two generations. One creative vision.</p>
              <p className="mt-3 text-sm leading-7 text-kcx-ash sm:text-base">Powered by creativity and KCxLabs technology.</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
              <a className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-cyan-200/50 bg-cyan-300 px-6 py-3.5 text-sm font-bold text-[#081014] transition hover:bg-cyan-200 focus-ring" href={channelUrl} target="_blank" rel="noopener noreferrer">
                <Youtube size={19} /> Visit our YouTube channel <ArrowUpRight size={17} />
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="section-shell relative pt-8" aria-labelledby="productions-work-title">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8 max-w-2xl">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.26em] text-fuchsia-200">A creative mix</p>
            <h2 id="productions-work-title" className="text-3xl font-semibold text-white sm:text-4xl">Music, play, and visual storytelling</h2>
            <p className="mt-4 text-sm leading-7 text-kcx-ash sm:text-base">Explore the kinds of projects the channel brings together. New releases and videos live on the official YouTube channel.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {projects.map(({ icon: Icon, eyebrow, title, description, accent, iconTone }) => (
              <article key={title} className={`group relative overflow-hidden rounded-xl border bg-gradient-to-br ${accent} to-transparent p-5 transition duration-300 hover:-translate-y-1 hover:border-white/25 sm:p-6`}>
                <div className="pointer-events-none absolute -right-12 -top-12 size-36 rounded-full bg-white/[0.035] blur-2xl transition group-hover:bg-white/[0.07]" />
                <Icon size={25} className={iconTone} aria-hidden="true" />
                <p className="mt-8 text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-kcx-ash">{eyebrow}</p>
                <h3 className="mt-2 text-xl font-semibold leading-snug text-white">{title}</h3>
                <p className="mt-3 text-sm leading-7 text-kcx-ash">{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section-shell pt-0" aria-label="Visit the official channel">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 rounded-xl border border-fuchsia-300/20 bg-[linear-gradient(110deg,rgba(217,70,239,0.09),rgba(34,211,238,0.07),rgba(18,18,20,0.8))] p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-fuchsia-200">Watch on YouTube</p>
            <p className="mt-2 text-sm leading-7 text-kcx-ash">Visit the official channel for music videos, gaming, animation, and cinematic projects.</p>
          </div>
          <a className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-full border border-cyan-200/50 bg-cyan-300 px-6 py-3 text-sm font-bold text-[#081014] transition hover:bg-cyan-200 focus-ring" href={channelUrl} target="_blank" rel="noopener noreferrer">
            <Youtube size={18} /> Tanner &amp; KCx Productions <ArrowUpRight size={16} />
          </a>
        </div>
      </section>
    </>
  );
}
