import { Github, Mail, RadioTower } from "lucide-react";
import { contact } from "../../styles/theme";

const ecosystemMap = [
  "KCxMode",
  "KCx Messenger",
  "KCx Studio Companion",
  "KCx Valhalla",
  "KCx Cortex",
  "Robotics",
] as const;

const futureInfrastructure = ["cortex.kcxlabs.org", "docs.kcxlabs.org", "api.kcxlabs.org"] as const;

export function Footer() {
  return (
    <footer className="kcx-footer relative border-t border-white/10 px-4 py-12 sm:px-6 lg:px-8">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-kcx-orange/45 to-transparent" />
      <div className="absolute inset-x-10 top-0 h-20 bg-kcx-orange/10 blur-3xl" />
      <div className="relative mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1.35fr_0.85fr_0.85fr_1fr]">
        <div className="max-w-xl">
          <div className="mb-5 flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.22em] text-white">
            <span className="grid size-9 place-items-center border border-kcx-orange/45 bg-black/35 shadow-[0_0_28px_rgba(255,122,26,0.1)]">
              <RadioTower size={18} className="text-kcx-orange" />
            </span>
            KCx Labs
          </div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-kcx-steel">
            Founder-built AI-assisted software ecosystem
          </p>
          <p className="mt-4 text-sm leading-7 text-kcx-ash">
            KCx Labs develops a connected software runtime across mobile systems, desktop creator tools, local-first AI
            infrastructure, and companion robotics research.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <span className="footer-link">{contact.domain}</span>
            <a className="footer-link focus-ring" href={`mailto:${contact.email}`}>
              <Mail size={16} />
              {contact.email}
            </a>
          </div>
        </div>

        <div>
          <h2 className="footer-heading">Ecosystem Map</h2>
          <ul className="mt-4 grid gap-3">
            {ecosystemMap.map((item) => (
              <li key={item} className="footer-list-item">
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="footer-heading">Future Infrastructure</h2>
          <ul className="mt-4 grid gap-3">
            {futureInfrastructure.map((item) => (
              <li key={item} className="footer-list-item font-mono">
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="footer-heading">Contact</h2>
          <div className="mt-4 grid gap-2.5">
            <a className="footer-link justify-start focus-ring" href={`mailto:${contact.email}`}>
              <Mail size={16} />
              {contact.email}
            </a>
            <a className="footer-link justify-start focus-ring" href="https://github.com" target="_blank" rel="noreferrer">
              <Github size={16} />
              {contact.githubLabel}
            </a>
            <span className="footer-link justify-start">{contact.domain}</span>
          </div>
          <p className="mt-5 text-xs leading-6 text-kcx-ash">
            No contact form or backend is attached to this homepage. Email is the current official contact path.
          </p>
        </div>
      </div>
    </footer>
  );
}
