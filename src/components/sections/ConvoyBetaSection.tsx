import { Apple, Download, ExternalLink, Globe, ShieldCheck, Smartphone } from "lucide-react";
import { SectionHeader } from "../ui/SectionHeader";

/**
 * Convoy mobile beta block for /beta.
 *
 * Availability is expressed as data, not as markup, so the page cannot drift
 * into advertising a build that does not exist. Both native artifacts default
 * to unavailable; publishing one is a single edit here, and until that edit is
 * made the buttons render disabled. There is deliberately no code path that
 * produces an enabled button without a concrete, verified URL.
 *
 * Rules this section exists to enforce:
 *   - Android links only ever point at a signed `.apk`. Never `.aab` (Play
 *     Store upload format — not installable), never Metro/localhost/Expo
 *     tunnel/preview URLs, which are development-only and die with the session.
 *   - iPhone gets TestFlight or nothing. A bare `.ipa` is useless without an
 *     Ad Hoc provisioning profile listing the tester's device UDID.
 */

const CONVOY_WEB_URL = "https://convoy.kcxlabs.org";

type AndroidArtifact = {
  /** Absolute https URL to a signed .apk. Never .aab, never a dev server. */
  url: string;
  version: string;
  fileSize: string;
  sha256: string;
};

type IphoneArtifact = {
  /** Real public TestFlight invitation URL issued by App Store Connect. */
  testFlightUrl: string;
};

/**
 * No signed APK has been produced for Convoy yet — no release build has been
 * run and no artifact is published. Set this to a real object only when a
 * signed APK is hosted and its SHA-256 has been verified against the file.
 */
const androidArtifact: AndroidArtifact | null = null;

/**
 * No TestFlight build exists yet: Convoy has not been submitted for Apple beta
 * review. Set this only once a real public invitation URL is live.
 */
const iphoneArtifact: IphoneArtifact | null = null;

/** Shown regardless of artifact state so testers know what the build targets. */
const ANDROID_REQUIREMENT = "Android 7.0 (API 24) or newer, 64-bit";

const releaseNotes = [
  "Create and join private convoys with a 6-character invite code",
  "Live member list with presence, vehicle status, and last-seen age",
  "Foreground location sharing while the app is open",
  "Owner controls — regenerate invite code, end convoy",
  "Location freshness is shown explicitly; stale positions are never drawn as live",
];

export function ConvoyBetaSection() {
  return (
    <section id="convoy-beta" className="section-shell relative scroll-mt-28" aria-labelledby="convoy-beta-title">
      <div className="section-divider top-0" />
      <SectionHeader
        eyebrow="Private Beta — Development Preview"
        title="Convoy Mobile Beta"
        description="Convoy keeps a group of vehicles together on a trip. The hosted web app is available now and needs no installation. Native Android and iPhone packages are built and distributed separately from the web app, and appear here only once a real signed artifact exists."
      />

      <article className="studio-panel overflow-hidden p-6 md:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-5 flex items-center gap-4">
              <div className="grid size-12 place-items-center border border-kcx-orange/35 bg-black/35 text-kcx-orange shadow-[0_0_34px_rgba(255,122,26,0.1)]">
                <Smartphone size={23} aria-hidden="true" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-kcx-orange">
                  Development Preview
                </p>
                <h3 id="convoy-beta-title" className="mt-1 text-2xl font-semibold text-white">
                  Convoy v1.0.0
                </h3>
              </div>
            </div>
            <p className="text-sm leading-7 text-kcx-ash">
              Split up without losing the group. Convoy shares live position, presence, and vehicle status
              between members of a private trip group. The web app runs on both Android and iPhone browsers
              today — the native packages below are a separate distribution, not a wrapper around the hosted
              site.
            </p>
          </div>

          <a
            href={CONVOY_WEB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="button-primary focus-ring inline-flex shrink-0 items-center justify-center gap-2"
          >
            <Globe size={17} aria-hidden="true" />
            Open Convoy Web App
          </a>
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {/* ── Android ─────────────────────────────────────────────────── */}
          <div className="project-preview-card">
            <div className="flex items-start justify-between gap-4">
              <Smartphone size={20} className="text-kcx-cyan" aria-hidden="true" />
              <span className="border border-white/10 bg-black/30 px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-kcx-steel">
                {androidArtifact ? "Signed APK" : "Not Yet Published"}
              </span>
            </div>
            <h4 className="mt-5 text-xl font-semibold text-white">Android</h4>

            <dl className="mt-5 space-y-2 border-t border-white/10 pt-4 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-kcx-ash">Version</dt>
                <dd className="font-mono text-kcx-steel">{androidArtifact?.version ?? "1.0.0 (unreleased)"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-kcx-ash">File size</dt>
                <dd className="font-mono text-kcx-steel">{androidArtifact?.fileSize ?? "Pending signed build"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-kcx-ash">SHA-256</dt>
                <dd className="max-w-[60%] break-all text-right font-mono text-xs text-kcx-steel">
                  {androidArtifact?.sha256 ?? "Published with the signed APK"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-kcx-ash">Requires</dt>
                <dd className="max-w-[60%] text-right font-mono text-xs text-kcx-steel">{ANDROID_REQUIREMENT}</dd>
              </div>
            </dl>

            <div className="mt-5">
              {androidArtifact ? (
                <a
                  href={androidArtifact.url}
                  className="button-primary focus-ring inline-flex w-full items-center justify-center gap-2"
                >
                  <Download size={17} aria-hidden="true" />
                  Download Android Beta
                </a>
              ) : (
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  className="button-secondary inline-flex w-full cursor-not-allowed items-center justify-center gap-2 opacity-45"
                >
                  <Download size={17} aria-hidden="true" />
                  Android APK coming soon
                </button>
              )}
            </div>

            <p className="mt-4 text-sm leading-6 text-kcx-ash">
              Sideload note: Android blocks installs from outside the Play Store by default. When the APK is
              published you will need to allow installation from your browser or file manager, then open the
              downloaded file. Verify the SHA-256 above before installing.
            </p>
          </div>

          {/* ── iPhone ──────────────────────────────────────────────────── */}
          <div className="project-preview-card">
            <div className="flex items-start justify-between gap-4">
              <Apple size={20} className="text-kcx-cyan" aria-hidden="true" />
              <span className="border border-white/10 bg-black/30 px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-kcx-steel">
                {iphoneArtifact ? "TestFlight" : "Not Yet Published"}
              </span>
            </div>
            <h4 className="mt-5 text-xl font-semibold text-white">iPhone</h4>

            <p className="mt-3 text-sm leading-6 text-kcx-ash">
              iPhone beta access goes through Apple TestFlight. No direct download is offered: an unsigned
              build cannot be installed on iOS, and a direct package only works for devices individually
              registered on an Ad Hoc provisioning profile.
            </p>

            <div className="mt-5">
              {iphoneArtifact ? (
                <a
                  href={iphoneArtifact.testFlightUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="button-primary focus-ring inline-flex w-full items-center justify-center gap-2"
                >
                  <ExternalLink size={17} aria-hidden="true" />
                  Install with TestFlight
                </a>
              ) : (
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  className="button-secondary inline-flex w-full cursor-not-allowed items-center justify-center gap-2 opacity-45"
                >
                  <Apple size={17} aria-hidden="true" />
                  iPhone TestFlight coming soon
                </button>
              )}
            </div>

            <p className="mt-4 border-t border-white/10 pt-4 text-sm leading-6 text-kcx-steel">
              When the beta opens: install TestFlight from the App Store, open the invitation link, then
              install Convoy from inside TestFlight.
            </p>
          </div>
        </div>

        {/* ── Release notes ─────────────────────────────────────────────── */}
        <div className="mt-8 border-t border-white/10 pt-6">
          <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-kcx-steel">
            Release notes — v1.0.0 development preview
          </h4>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {releaseNotes.map((note) => (
              <li key={note} className="border-l border-kcx-cyan/40 bg-black/20 px-4 py-3 text-sm leading-6 text-kcx-ash">
                {note}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 flex items-start gap-3 border border-kcx-cyan/30 bg-kcx-cyan/5 p-5">
          <ShieldCheck size={19} className="mt-0.5 shrink-0 text-kcx-cyan" aria-hidden="true" />
          <p className="text-sm leading-6 text-kcx-ash">
            The Convoy web app is available now and is the installation-free way to test on either platform.
            It is a separate deployment from the native packages: web testing is foreground-only and makes no
            claim to native push notifications, background GPS, or screen-off tracking.
          </p>
        </div>
      </article>
    </section>
  );
}
