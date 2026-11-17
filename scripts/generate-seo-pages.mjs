import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = join(root, "dist", "index.html");

export const pageMetadata = {
  beta: {
    path: "/beta",
    title: "KCx Studio Companion Beta | KCx Labs",
    description: "Explore the KCx Studio Companion beta: a local-first desktop workspace for AI-assisted development, project awareness, and controlled execution.",
  },
  downloads: {
    path: "/downloads",
    title: "KCx Labs Downloads | Verified Releases",
    description: "Browse verified KCx Labs software releases with version, channel, file size, publication date, and SHA-256 details.",
  },
  nexus: {
    path: "/nexus",
    title: "KCx NEXUS | Local AI Companion Platform | KCx Labs",
    description: "Learn about KCx NEXUS, a local-network Android companion for your own PC and KCxLocalAI installation, with clear privacy boundaries.",
  },
  "nexus-portal": {
    path: "/nexus/portal",
    title: "KCx NEXUS Portal Preview | KCx Labs",
    description: "View the informational preview of the planned KCx NEXUS portal, its verified local capabilities, and features that are not yet available.",
  },
  clips: {
    path: "/clips",
    title: "Public Clips | KCx Media | KCx Labs",
    description: "Browse public clips shared through KCx Media. Individual share pages are public by link and are excluded from search indexing.",
  },
  productions: {
    path: "/productions",
    title: "Tanner & KCx Productions | Music, Gaming & Animation | KCx Labs",
    description: "An independent creative media project featuring original music, gaming content, animated music videos, and cinematic productions.",
    structuredData: {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Organization",
          "@id": "https://kcxlabs.org/#organization",
          name: "KCx Labs",
          url: "https://kcxlabs.org/",
        },
        {
          "@type": "Organization",
          "@id": "https://kcxlabs.org/productions#organization",
          name: "Tanner & KCx Productions",
          url: "https://kcxlabs.org/productions",
          description: "An independent creative media project featuring original music, gaming content, animated music videos, and cinematic productions.",
          parentOrganization: { "@id": "https://kcxlabs.org/#organization" },
          sameAs: ["https://www.youtube.com/@TannerKCxProductions"],
        },
      ],
    },
  },
  snapcal: {
    path: "/snapcal/",
    title: "SnapCal Private Calendar | KCx Labs",
    description: "Private SnapCal calendar access for authenticated KCx Labs users.",
    noindex: true,
  },
  "camera-archive": {
    path: "/camera-archive",
    title: "Private Camera Archive | KCx Labs",
    description: "Private KCxCamBridge camera recordings for authenticated owners.",
    noindex: true,
  },
};

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function renderSeoHtml(template, page) {
  const canonical = `https://kcxlabs.org${page.path}`;
  const description = escapeHtml(page.description);
  const title = escapeHtml(page.title);
  const robots = page.noindex ? '<meta name="robots" content="noindex, nofollow, noarchive" />' : "";
  const replacements = [
    [/<title>[^<]*<\/title>/i, `<title>${title}</title>`],
    [/<meta\s+name="description"\s+content="[^"]*"\s*\/>/i, `<meta name="description" content="${description}" />`],
    [/<link\s+rel="canonical"\s+href="[^"]*"\s*\/>/i, `<link rel="canonical" href="${canonical}" />`],
    [/<meta\s+property="og:title"\s+content="[^"]*"\s*\/>/i, `<meta property="og:title" content="${title}" />`],
    [/<meta\s+property="og:description"\s+content="[^"]*"\s*\/>/i, `<meta property="og:description" content="${description}" />`],
    [/<meta\s+property="og:url"\s+content="[^"]*"\s*\/>/i, `<meta property="og:url" content="${canonical}" />`],
  ];
  let html = template;
  for (const [pattern, replacement] of replacements) {
    if (!pattern.test(html)) throw new Error(`SEO template is missing required tag matching ${pattern}`);
    html = html.replace(pattern, replacement);
  }
  if (page.noindex) html = html.replace("</head>", `    ${robots}\n  </head>`);
  if (page.structuredData) {
    const jsonLd = JSON.stringify(page.structuredData).replaceAll("<", "\\u003c");
    html = html.replace("</head>", `    <script type="application/ld+json">${jsonLd}</script>\n  </head>`);
  }
  return html;
}

async function main() {
  const template = await readFile(indexPath, "utf8");
  for (const [key, page] of Object.entries(pageMetadata)) {
    const output = join(root, "dist", "seo", `${key}.html`);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, renderSeoHtml(template, page));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
