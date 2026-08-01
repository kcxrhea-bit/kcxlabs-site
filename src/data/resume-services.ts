import { FileCheck2, FilePlus2, FileText } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { contact } from "../styles/theme";

/**
 * Resume Services content and configuration.
 *
 * Everything configurable lives in the CONFIGURATION block below so links,
 * pricing, and image paths are changed in exactly one place. Page content is
 * kept in typed arrays here rather than inline in JSX, matching the rest of the
 * site.
 */

/* ------------------------------------------------------------------ *
 * CONFIGURATION — edit these values, not the components
 * ------------------------------------------------------------------ */

/**
 * Contra profile/order URL.
 *
 * `null` means not yet configured. While it is null the Contra buttons render
 * disabled and labelled "Contra Link Coming Soon", and "Email Jason" stays the
 * active call to action. Set this to the real profile URL to enable them; no
 * component change is needed.
 *
 * Do not set this to the generic https://contra.com/ homepage — that would send
 * visitors somewhere that cannot take an order.
 */
export const contraOrderUrl: string | null = null;

/** Contact address for the active call to action. Sourced from the shared theme. */
export const resumeContactEmail = contact.email;

/** Canonical route for this page. Used for links and metadata. */
export const resumeCanonicalRoute = "/resume";

/** Alternate address, redirected to the canonical route by vercel.json. */
export const resumeAlternateRoute = "/resume-services";

/** Page metadata. The site has no per-route metadata system beyond title/description. */
export const resumeMetadata = {
  title: "Professional Resume Writing Services | KCx Labs",
  description:
    "Resume writing, ATS optimization, cover letters, and professional job application support from KCx Labs.",
} as const;

/**
 * Folder under public/ for portfolio and before/after images.
 *
 * Image fields below are empty until real files exist. An empty path renders the
 * placeholder frame, so nothing ever points at a missing file.
 */
export const resumeImageBase = "/resume-portfolio";

/** Intended filenames for the headline before/after pair, for reference when adding them. */
export const plannedBeforeAfterImages = {
  before: `${resumeImageBase}/resume-before.png`,
  after: `${resumeImageBase}/resume-after.png`,
} as const;

export const contraIsConfigured = contraOrderUrl !== null;

/* ------------------------------------------------------------------ *
 * SERVICES
 * ------------------------------------------------------------------ */

export type ResumeService = {
  id: string;
  name: string;
  price: string;
  icon: LucideIcon;
  /** Rendered above the bullet list, e.g. to say a tier builds on the previous one. */
  includesLabel: string;
  includes: string[];
};

export const resumeServices: ResumeService[] = [
  {
    id: "rewrite",
    name: "Resume Rewrite",
    price: "$35",
    icon: FileText,
    includesLabel: "Includes",
    includes: [
      "Professional formatting",
      "ATS optimization",
      "Improved bullet points",
      "PDF + Word versions",
    ],
  },
  {
    id: "resume-cover-letter",
    name: "Resume + Cover Letter",
    price: "$50",
    icon: FileCheck2,
    includesLabel: "Everything above, plus",
    includes: ["Custom cover letter", "Professional summary", "Job-specific tailoring"],
  },
  {
    id: "from-scratch",
    name: "Resume From Scratch",
    price: "$60",
    icon: FilePlus2,
    includesLabel: "Includes",
    includes: [
      "Resume built from work history",
      "ATS optimization",
      "Professional formatting",
      "PDF + Word",
    ],
  },
];

/* ------------------------------------------------------------------ *
 * PORTFOLIO
 * ------------------------------------------------------------------ */

/**
 * Portfolio entries.
 *
 * These are demonstration samples, not client work. Every entry carries a
 * disclosure that is rendered on the card, and no client, testimonial, or paid
 * engagement is described anywhere.
 *
 * Image fields are empty until real files are added under public/resume-portfolio/.
 * An empty path renders a placeholder frame rather than a broken image.
 */
export type PortfolioItem = {
  id: string;
  title: string;
  description: string;
  /** Cover image path, or "" to render the placeholder frame. */
  coverImage: string;
  /** Optional before/after pair. Both empty renders placeholders. */
  beforeImage?: string;
  afterImage?: string;
  /** Alt text used for whichever image renders. */
  altText: string;
  skills: string[];
  /** Optional downloadable sample under public/. Omitted until a file exists. */
  sampleDownload?: string;
  /** Rendered on the card so samples are never mistaken for client work. */
  disclosure: string;
};

const SAMPLE_DISCLOSURE = "Portfolio sample created to demonstrate approach. Not client work.";

export const resumePortfolio: PortfolioItem[] = [
  {
    id: "before-after-transformation",
    title: "Before & After Resume Transformation",
    description:
      "A basic resume rewritten and reformatted into a cleaner, ATS-friendly document with stronger organization and more professional wording.",
    coverImage: "",
    beforeImage: "",
    afterImage: "",
    altText: "Resume before and after reformatting, showing clearer structure and stronger bullet points",
    skills: ["Formatting", "ATS optimization", "Bullet point rewriting", "Document structure"],
    disclosure: SAMPLE_DISCLOSURE,
  },
  {
    id: "ats-optimization",
    title: "ATS Resume Optimization",
    description:
      "An example showing how vague job duties can be rewritten using clearer language and relevant, truthful keywords.",
    coverImage: "",
    altText: "Resume section rewritten with clearer wording and relevant keywords",
    skills: ["ATS keywords", "Plain-language rewriting", "Parser-safe layout"],
    disclosure: SAMPLE_DISCLOSURE,
  },
  {
    id: "cover-letter",
    title: "Custom Cover Letter Sample",
    description:
      "A tailored cover letter structured around a specific job posting while preserving accurate applicant information.",
    coverImage: "",
    altText: "Cover letter tailored to a specific job posting",
    skills: ["Cover letters", "Job-specific tailoring", "Professional tone"],
    disclosure: SAMPLE_DISCLOSURE,
  },
  {
    id: "resume-template",
    title: "Professional Resume Template",
    description:
      "A clean, readable resume template designed for straightforward editing and ATS compatibility.",
    coverImage: "",
    altText: "Clean resume template laid out for easy editing and ATS compatibility",
    skills: ["Template design", "Readability", "Word + PDF output"],
    disclosure: SAMPLE_DISCLOSURE,
  },
];

/* ------------------------------------------------------------------ *
 * BEFORE / AFTER
 * ------------------------------------------------------------------ */

export type ShowcaseExample = {
  id: string;
  label: string;
  caption: string;
  beforeImage: string;
  afterImage: string;
  beforeAlt: string;
  afterAlt: string;
};

export const resumeShowcase: ShowcaseExample[] = [
  {
    id: "headline-pair",
    label: "Resume transformation",
    caption:
      "Dense paragraphs replaced with scannable achievement bullets, a clear professional summary added, and section order rebuilt so relevant experience reads first.",
    // Populate with plannedBeforeAfterImages once the files exist under public/.
    beforeImage: "",
    afterImage: "",
    beforeAlt: "Original resume with dense paragraphs and unclear section order",
    afterAlt: "Rewritten resume with clear summary, scannable bullets, and organised sections",
  },
  {
    id: "ats-pair",
    label: "ATS pass",
    caption:
      "Tables and multi-column layout removed so parsers read the document correctly, headings standardised, and wording aligned to the target posting without adding anything untrue.",
    beforeImage: "",
    afterImage: "",
    beforeAlt: "Original resume using tables and columns that parsers misread",
    afterAlt: "Reformatted resume using a single column and standard headings",
  },
];

/** What actually changes between before and after. */
export const improvementSummary: string[] = [
  "Cleaner hierarchy",
  "Improved readability",
  "Stronger bullet points",
  "Better section organization",
  "ATS-aware wording",
  "Truthful content preserved",
];

/* ------------------------------------------------------------------ *
 * TRUST
 * ------------------------------------------------------------------ */

/**
 * What is actually promised.
 *
 * Deliberately excludes certifications, recruiter or career-counsellor status,
 * and any guarantee of interviews or employment. Nothing here is a credential claim.
 */
export const trustPoints: string[] = [
  "ATS-friendly formatting",
  "No invented experience",
  "Human-reviewed final documents",
  "Clear professional writing",
  "Editable Microsoft Word document included",
  "Fast turnaround",
  "Privacy-conscious handling of customer information",
];

/* ------------------------------------------------------------------ *
 * PROCESS AND FAQ
 * ------------------------------------------------------------------ */

export type ProcessStep = {
  order: number;
  detail: string;
};

export const resumeProcess: ProcessStep[] = [
  { order: 1, detail: "Send your current resume and target job posting." },
  { order: 2, detail: "I review and improve formatting, wording, and organization." },
  { order: 3, detail: "I optimize for ATS while keeping every detail truthful." },
  { order: 4, detail: "Receive polished PDF and Word versions." },
];

export type ResumeFaq = {
  question: string;
  answer: string;
};

export const resumeFaqs: ResumeFaq[] = [
  { question: "Do you invent experience?", answer: "No." },
  { question: "Do you guarantee interviews?", answer: "No." },
  { question: "Can you work from an existing resume?", answer: "Yes." },
  { question: "Can you create one from scratch?", answer: "Yes." },
  { question: "Typical turnaround?", answer: "24 hours." },
  {
    question: "Can revisions be requested?",
    answer:
      "Yes. Standard services include one reasonable revision round when requested promptly after delivery.",
  },
];
