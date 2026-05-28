import { AlertTriangle, Download, Mail, ShieldAlert, Sparkles, Cpu, GitBranch, Zap } from "lucide-react";

const downloadHref = "https://github.com/kcxrhea-bit/KCxStudioCompanion/releases/download/v0.9.5-beta/KCxStudioCompanion-v0.9.5-beta.zip";

const installSteps = [
  "Download the ZIP",
  "Extract it",
  "Run the installer or portable executable",
  'If Windows SmartScreen appears, click "More info" then "Run anyway"',
  "Launch KCx Studio Companion — Ollama starts automatically if installed",
];

const betaNotes = [
  "This build is unsigned — SmartScreen warning is expected",
  "Ollama required for local AI inference (phi3:latest recommended)",
  "Windows 10/11 x64 only — no Mac/Linux yet",
  "Features may change before public release",
  "Build loop and spec intake require a project to be selected",
  "Feedback welcomed at beta@kcxlabs.org",
];

const features = [
  {
    icon: Cpu,
    title: "Cortex Runtime",
    description: "Local AI orchestration brain with sandboxed execution, manual approval queue, and SERA policy enforcement.",
  },
  {
    icon: Zap,
    title: "Autonomous Build Loop",
    description: "Cortex watches for build failures, summarizes via Ollama/phi3, and auto-queues a fix prompt for your review.",
  },
  {
    icon: GitBranch,
    title: "Spec Intake",
    description: "Describe a feature in plain language — Cortex reads your project structure and generates a Claude Code implementation prompt.",
  },
  {
    icon: Sparkles,
    title: "Smart Brain Normalizer",
    description: "Classifies task type, detects rewrite risk, sanitizes vague prompts, and produces structured safe implementation guidance.",
  },
];

export function BetaPage() {
  return (
    <section className="section-shell pt-32 lg:pt-36" aria-labelledby="beta-title">
      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
        <div>
          <div className="mb-5 inline-flex items-center gap-2 border border-kcx-cyan/30 bg-kcx-cyan/10 px-3 py-2 text-[0.7rem] font-bold uppercase tracking-[0.2em] text-kcx-cyan">
            <Sparkles size={15} />
            Private Beta — Post-SERA Milestone
          </div>
          <h1 id="beta-title" className="max-w-4xl text-4xl font-semibold leading-tight text-white sm:text-5xl lg:text-6xl">
            KCx Studio Companion — Private Beta
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-kcx-ash sm:text-lg">
            Early access build for invited KCx Labs testers on Windows 10/11 x64. This milestone includes
            the full Cortex runtime, autonomous build loop, spec intake, and Smart Brain intelligence layer —
            running entirely local-first with no cloud dependencies required.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <div className="micro-panel">
              <span className="block text-kcx-ash">Version</span>
              <span className="mt-2 block font-mono text-kcx-steel">0.9.5-beta</span>
            </div>
            <div className="micro-panel">
              <span className="block text-kcx-ash">Platform</span>
              <span className="mt-2 block font-mono text-kcx-steel">Windows 10/11 x64</span>
            </div>
            <div className="micro-panel">
              <span className="block text-kcx-ash">Tests</span>
              <span className="mt-2 block font-mono text-kcx-steel">263 passing</span>
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a href={downloadHref} className="button-primary focus-ring">
              <Download size={18} />
              Download ZIP
            </a>
            <a href="mailto:beta@kcxlabs.org" className="button-secondary focus-ring">
              <Mail size={18} />
              beta@kcxlabs.org
            </a>
          </div>

          <div className="mt-6 flex items-start gap-3 border border-kcx-orange/35 bg-kcx-orange/10 p-4 text-sm leading-7 text-kcx-steel">
            <ShieldAlert className="mt-1 shrink-0 text-kcx-orange" size={20} />
            <p>
              Invited testers only. Do not redistribute this private beta build, installer, ZIP contents, or download link.
            </p>
          </div>
        </div>

        <div className="studio-panel p-5 sm:p-6">
          <h2 className="text-xl font-semibold text-white">Installation</h2>
          <ol className="mt-6 grid gap-4">
            {installSteps.map((step, index) => (
              <li key={step} className="flex gap-4 text-sm leading-7 text-kcx-ash">
                <span className="grid size-8 shrink-0 place-items-center border border-kcx-cyan/35 bg-kcx-cyan/10 font-mono text-xs font-bold text-kcx-cyan">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <div className="mt-6 border-t border-white/10 pt-5 text-xs text-kcx-ash">
            Ollama is free and runs locally at <span className="font-mono text-kcx-steel">127.0.0.1:11434</span>.
            Download at <span className="font-mono text-kcx-steel">ollama.com</span>
          </div>
        </div>
      </div>

      <div className="mx-auto mt-10 max-w-6xl">
        <h2 className="mb-6 text-xl font-semibold text-white">What's in this build</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div key={f.title} className="studio-panel p-5">
              <f.icon size={20} className="text-kcx-cyan" />
              <h3 className="mt-3 font-semibold text-white">{f.title}</h3>
              <p className="mt-2 text-sm leading-6 text-kcx-ash">{f.description}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mx-auto mt-8 max-w-6xl">
        <div className="system-panel system-panel-compact">
          <div className="relative">
            <div className="mb-5 flex items-center gap-3">
              <AlertTriangle size={20} className="text-kcx-orange" />
              <h2 className="text-xl font-semibold text-white">Known Beta Notes</h2>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {betaNotes.map((note) => (
                <li key={note} className="border-l border-kcx-orange/40 bg-black/20 px-4 py-3 text-sm text-kcx-ash">
                  {note}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
