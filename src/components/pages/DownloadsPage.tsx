import { Download, FileArchive, ShieldCheck } from "lucide-react";
import publishingCatalog from "../../data/publishing-catalog.json";

type PublishedRelease = {
  projectSlug: string;
  version: string;
  title: string;
  channel: string;
  file: string;
  bytes: number;
  sha256: string;
  publishedAt: string;
};

const releases = publishingCatalog.releases as PublishedRelease[];

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "Unknown size";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function artifactLabel(file: string): string {
  const lower = file.toLowerCase();

  if (lower.endsWith(".apk")) return "Android APK";
  if (lower.endsWith(".msi")) return "Windows Installer";
  if (lower.endsWith(".exe")) {
    return lower.includes("setup")
      ? "Windows Installer"
      : "Windows Executable";
  }
  if (lower.endsWith(".zip")) return "ZIP Archive";

  return "Release Artifact";
}

function releaseUrl(file: string): string {
  return `/${file
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

export function DownloadsPage() {
  const sortedReleases = [...releases].sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() -
      new Date(a.publishedAt).getTime(),
  );

  return (
    <section
      className="section-shell relative pb-28 pt-32 lg:pt-36"
      aria-labelledby="downloads-title"
    >
      <div className="section-divider top-0" />

      <div className="mx-auto max-w-6xl">
        <div className="mb-10 max-w-3xl">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.28em] text-kcx-orange">
            Published software
          </p>

          <h1
            id="downloads-title"
            className="text-4xl font-semibold leading-tight text-white sm:text-5xl"
          >
            KCx Labs Downloads
          </h1>

          <p className="mt-5 text-base leading-8 text-kcx-ash sm:text-lg">
            Verified release artifacts published through KCx Labs.
            Each entry includes its version, channel, file size,
            publication time, and SHA-256 digest.
          </p>
        </div>

        {sortedReleases.length === 0 ? (
          <div className="studio-panel p-6 md:p-8">
            <FileArchive
              size={24}
              className="text-kcx-orange"
              aria-hidden="true"
            />
            <h2 className="mt-4 text-xl font-semibold text-white">
              No public releases yet
            </h2>
            <p className="mt-2 text-sm leading-7 text-kcx-ash">
              Releases published through KCx Labs will appear here.
            </p>
          </div>
        ) : (
          <div className="grid gap-5">
            {sortedReleases.map((release) => (
              <article
                key={`${release.projectSlug}-${release.version}-${release.file}`}
                className="studio-panel p-6 md:p-8"
              >
                <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-xs font-semibold uppercase tracking-[0.2em] text-kcx-orange">
                        {release.channel}
                      </span>

                      <span className="text-xs uppercase tracking-[0.16em] text-kcx-ash">
                        Version {release.version}
                      </span>
                    </div>

                    <h2 className="mt-3 text-2xl font-semibold text-white">
                      {release.title}
                    </h2>

                    <div className="mt-5 flex flex-wrap gap-3">
                      <span className="icon-chip">
                        <FileArchive size={16} aria-hidden="true" />
                        {artifactLabel(release.file)}
                      </span>

                      <span className="icon-chip">
                        {formatBytes(release.bytes)}
                      </span>
                    </div>
                  </div>

                  <a
                    href={releaseUrl(release.file)}
                    className="button-primary focus-ring shrink-0"
                    download
                  >
                    <Download size={18} aria-hidden="true" />
                    Download
                  </a>
                </div>

                <div className="mt-7 border-t border-white/10 pt-5">
                  <div className="flex items-start gap-3">
                    <ShieldCheck
                      size={18}
                      className="mt-1 shrink-0 text-kcx-cyan"
                      aria-hidden="true"
                    />

                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-kcx-steel">
                        SHA-256
                      </p>

                      <code className="mt-2 block break-all text-xs leading-6 text-kcx-ash">
                        {release.sha256}
                      </code>
                    </div>
                  </div>

                  <p className="mt-4 text-xs text-kcx-ash">
                    Published{" "}
                    {new Date(release.publishedAt).toLocaleString()}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
