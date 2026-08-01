import { motion } from "framer-motion";
import { ArrowDown, ArrowUpRight, Check, Download, ImageIcon, Mail, ShieldCheck } from "lucide-react";
import { SectionHeader } from "../ui/SectionHeader";
import { useDocumentMetadata } from "../../hooks/useDocumentMetadata";
import {
  contraIsConfigured,
  contraOrderUrl,
  improvementSummary,
  resumeContactEmail,
  resumeFaqs,
  resumeMetadata,
  resumePortfolio,
  resumeProcess,
  resumeServices,
  resumeShowcase,
  trustPoints,
} from "../../data/resume-services";

/**
 * Contra call to action.
 *
 * While no Contra URL is configured this renders the site's existing disabled
 * button style rather than a live link, so it can never send anyone to a page
 * that cannot take an order. Setting contraOrderUrl enables it with no change here.
 */
function ContraButton({ label, className = "" }: { label: string; className?: string }) {
  if (!contraIsConfigured || contraOrderUrl === null) {
    return (
      <button className={`preview-disabled-button ${className}`} type="button" disabled>
        Contra Link Coming Soon
      </button>
    );
  }

  return (
    <a
      href={contraOrderUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`button-primary focus-ring ${className}`}
    >
      <ArrowUpRight size={18} aria-hidden="true" />
      {label}
    </a>
  );
}

function EmailButton({ variant = "secondary" }: { variant?: "primary" | "secondary" }) {
  return (
    <a
      href={`mailto:${resumeContactEmail}`}
      className={`${variant === "primary" ? "button-primary" : "button-secondary"} focus-ring`}
    >
      <Mail size={18} aria-hidden="true" />
      Email Jason
    </a>
  );
}

/**
 * Image frame that falls back to a placeholder when no path is set.
 *
 * Rendering a frame rather than an <img> with an empty src avoids a broken-image
 * icon and any request for a file that does not exist.
 */
function ImageFrame({
  caption,
  src,
  alt,
  ratio = "aspect-[3/4]",
}: {
  caption: string;
  src: string;
  alt: string;
  ratio?: string;
}) {
  return (
    <figure className="m-0">
      <figcaption className="mb-3 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-kcx-ash">
        {caption}
      </figcaption>
      {src ? (
        <img src={src} alt={alt} className="w-full border border-white/10" loading="lazy" />
      ) : (
        <div className={`grid ${ratio} w-full place-items-center border border-dashed border-white/15 bg-black/25`}>
          <div className="flex flex-col items-center gap-3 px-4 text-center">
            <ImageIcon size={22} className="text-kcx-ash" aria-hidden="true" />
            <span className="text-xs leading-6 text-kcx-ash">{caption} example</span>
          </div>
        </div>
      )}
    </figure>
  );
}

export function ResumeServicesPage() {
  useDocumentMetadata(resumeMetadata.title, resumeMetadata.description);

  return (
    <>
      <section className="section-shell pt-32 lg:pt-36" aria-labelledby="resume-title">
        <div className="mx-auto max-w-4xl">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.3em] text-kcx-orange">
            KCx Labs services
          </p>

          <h1
            id="resume-title"
            className="text-4xl font-semibold leading-tight text-white sm:text-5xl lg:text-6xl"
          >
            Professional Resume Writing Services
          </h1>

          <p className="mt-6 max-w-2xl text-base leading-8 text-kcx-ash sm:text-lg">
            Professional resumes, ATS optimization, and custom cover letters designed to help job
            seekers present their experience clearly and professionally.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            {/* Email is the primary action while Contra is unconfigured. */}
            <EmailButton variant={contraIsConfigured ? "secondary" : "primary"} />
            <ContraButton label="Order on Contra" />
          </div>

          {!contraIsConfigured && (
            <p className="telemetry-line mt-8 text-xs leading-6 text-kcx-steel">
              Contra ordering is not connected yet. Email is the fastest way to start in the meantime.
            </p>
          )}
        </div>
      </section>

      <section className="section-shell relative pt-0" aria-label="Introduction">
        <div className="section-divider top-0" />
        <div className="studio-panel p-6 md:p-8">
          <div className="mb-6 flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center border border-kcx-orange/45 bg-black/35 text-kcx-orange">
              <ShieldCheck size={19} aria-hidden="true" />
            </span>
            <h2 className="text-2xl font-semibold text-white sm:text-3xl">Honest work, clearly written</h2>
          </div>
          <p className="max-w-3xl text-sm leading-7 text-kcx-ash">
            I help job seekers improve existing resumes, tailor them for specific job postings, and
            create professional cover letters.
          </p>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-kcx-ash">
            Every resume is reviewed for formatting, grammar, readability, and ATS compatibility while
            remaining completely truthful. I never invent experience, certifications, education, or
            employment history.
          </p>
        </div>
      </section>

      <section id="resume-services" className="section-shell relative pt-0" aria-label="Services">
        <div className="section-divider top-0" />
        <SectionHeader
          eyebrow="Services"
          title="Three ways to work together."
          description="Fixed pricing, no subscriptions, and the same review standard applied to every tier."
        />
        <div className="grid gap-5 lg:grid-cols-3">
          {resumeServices.map((service, index) => {
            const Icon = service.icon;

            return (
              <motion.article
                key={service.id}
                className="project-preview-card"
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.22 }}
                transition={{ duration: 0.45, delay: index * 0.06 }}
              >
                <div className="mb-8 flex items-start justify-between gap-5">
                  <div className="grid size-12 place-items-center border border-kcx-orange/35 bg-black/35 text-kcx-orange shadow-[0_0_34px_rgba(255,122,26,0.1)]">
                    <Icon size={22} aria-hidden="true" />
                  </div>
                  <span className="border border-white/10 bg-black/30 px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-kcx-steel">
                    {service.price}
                  </span>
                </div>
                <h3 className="text-2xl font-semibold leading-tight text-white">{service.name}</h3>
                <p className="mt-4 text-[0.7rem] uppercase tracking-[0.24em] text-kcx-ash">
                  {service.includesLabel}
                </p>
                <ul className="mt-4 grid gap-3">
                  {service.includes.map((item) => (
                    <li key={item} className="flex gap-3 text-sm leading-6 text-kcx-ash">
                      <Check size={15} className="mt-1 shrink-0 text-kcx-cyan" aria-hidden="true" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <ContraButton label="Order on Contra" className="mt-7 w-full" />
              </motion.article>
            );
          })}
        </div>
      </section>

      <section className="section-shell relative pt-0" aria-label="Portfolio samples">
        <div className="section-divider top-0" />
        <SectionHeader
          eyebrow="Portfolio"
          title="Samples of the work."
          description="Demonstration pieces showing formatting, structure, and wording. These are portfolio samples rather than client documents."
        />
        <div className="grid gap-5 sm:grid-cols-2">
          {resumePortfolio.map((item, index) => (
            <motion.article
              key={item.id}
              className="project-preview-card"
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.45, delay: index * 0.05 }}
            >
              <ImageFrame caption="Sample" src={item.coverImage} alt={item.altText} ratio="aspect-[4/3]" />
              <h3 className="mt-6 text-xl font-semibold leading-tight text-white">{item.title}</h3>
              <p className="mt-3 text-sm leading-7 text-kcx-ash">{item.description}</p>
              <ul className="mt-5 flex flex-wrap gap-2">
                {item.skills.map((skill) => (
                  <li
                    key={skill}
                    className="border border-white/10 bg-black/30 px-3 py-2 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-kcx-steel"
                  >
                    {skill}
                  </li>
                ))}
              </ul>
              {item.sampleDownload && (
                <a href={item.sampleDownload} className="button-secondary focus-ring mt-6 w-full" download>
                  <Download size={16} aria-hidden="true" />
                  Download sample
                </a>
              )}
              <p className="telemetry-line mt-6 text-xs leading-6 text-kcx-steel">{item.disclosure}</p>
            </motion.article>
          ))}
        </div>
      </section>

      <section className="section-shell relative pt-0" aria-label="Before and after examples">
        <div className="section-divider top-0" />
        <SectionHeader
          eyebrow="Before / after"
          title="What changes, and why."
          description="Formatting and structure improvements shown side by side. Content stays truthful — only clarity, order, and readability change."
        />
        <div className="grid gap-5 lg:grid-cols-2">
          {resumeShowcase.map((example, index) => (
            <motion.article
              key={example.id}
              className="system-panel"
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.45, delay: index * 0.06 }}
            >
              <div className="relative">
                <p className="text-[0.7rem] uppercase tracking-[0.24em] text-kcx-ash">{example.label}</p>
                <div className="mt-6 grid items-start gap-5 sm:grid-cols-[1fr_auto_1fr]">
                  <ImageFrame caption="Before" src={example.beforeImage} alt={example.beforeAlt} />
                  <div className="grid place-items-center py-2 sm:py-16">
                    <ArrowDown size={20} className="text-kcx-orange sm:-rotate-90" aria-hidden="true" />
                  </div>
                  <ImageFrame caption="After" src={example.afterImage} alt={example.afterAlt} />
                </div>
                <p className="telemetry-line mt-6 text-xs leading-6 text-kcx-steel">{example.caption}</p>
              </div>
            </motion.article>
          ))}
        </div>

        <div className="studio-panel mt-5 p-6 md:p-8">
          <h3 className="text-xl font-semibold text-white">What improves</h3>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {improvementSummary.map((item) => (
              <li key={item} className="flex gap-3 border-l border-kcx-orange/40 bg-black/20 px-4 py-3">
                <Check size={16} className="mt-0.5 shrink-0 text-kcx-cyan" aria-hidden="true" />
                <span className="text-sm leading-6 text-kcx-ash">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section-shell relative pt-0" aria-label="What you get">
        <div className="section-divider top-0" />
        <SectionHeader
          eyebrow="What you get"
          title="What is actually promised."
          description="A short, honest list. No certifications, recruiter status, or guarantees of interviews or employment are claimed."
        />
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {trustPoints.map((point) => (
            <li key={point} className="system-panel system-panel-compact">
              <div className="relative flex gap-3">
                <ShieldCheck size={16} className="mt-0.5 shrink-0 text-kcx-cyan" aria-hidden="true" />
                <span className="text-sm leading-6 text-kcx-ash">{point}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="section-shell relative pt-0" aria-label="Process">
        <div className="section-divider top-0" />
        <SectionHeader
          eyebrow="Process"
          title="Four steps, start to finish."
          description="Straightforward and quick. You stay in control of every detail that goes on the page."
        />
        <div className="studio-panel p-6 md:p-8">
          <ol className="grid gap-3">
            {resumeProcess.map((step, index) => (
              <li key={step.order}>
                <div className="flex flex-wrap items-start gap-x-4 gap-y-3 border border-white/10 bg-black/20 px-4 py-4">
                  <span className="grid size-8 shrink-0 place-items-center border border-kcx-orange/40 bg-black/35 font-mono text-xs font-bold text-kcx-orange">
                    {step.order}
                  </span>
                  <p className="min-w-0 flex-1 text-sm leading-7 text-kcx-ash">{step.detail}</p>
                </div>
                {index < resumeProcess.length - 1 && (
                  <div className="grid place-items-center py-2">
                    <ArrowDown size={16} className="text-kcx-orange/70" aria-hidden="true" />
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section-shell relative pt-0" aria-label="Frequently asked questions">
        <div className="section-divider top-0" />
        <SectionHeader
          eyebrow="FAQ"
          title="Straight answers."
          description="The questions that matter most, answered plainly."
        />
        <dl className="grid gap-3 sm:grid-cols-2">
          {resumeFaqs.map((faq) => (
            <div key={faq.question} className="system-panel system-panel-compact">
              <div className="relative">
                <dt className="text-sm font-semibold text-kcx-steel">{faq.question}</dt>
                <dd className="mt-2 text-sm leading-6 text-kcx-ash">{faq.answer}</dd>
              </div>
            </div>
          ))}
        </dl>
      </section>

      <section className="section-shell relative pt-0 pb-28" aria-label="Get started">
        <div className="section-divider top-0" />
        <div className="studio-panel p-8 text-center md:p-12">
          <h2 className="text-3xl font-semibold leading-tight text-white sm:text-4xl">
            Need a stronger resume?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-8 text-kcx-ash">
            Let&rsquo;s build one together.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <EmailButton variant={contraIsConfigured ? "secondary" : "primary"} />
            <ContraButton label="Hire Me on Contra" />
          </div>
        </div>
      </section>
    </>
  );
}
