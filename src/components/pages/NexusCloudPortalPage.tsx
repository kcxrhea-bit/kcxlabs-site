import { AlertTriangle, ArrowLeft, Home } from "lucide-react";
import { CapabilityList } from "../nexus-cloud/CapabilityList";
import { StatusBadge } from "../nexus-cloud/StatusBadge";
import { plannedCloudCapabilities, verifiedCapabilities } from "../../data/nexus-cloud";
import { getNexusCloudServiceStatus } from "../../cloud";
import { publicRoutePaths } from "../../routes";

/**
 * Preview of a future portal.
 *
 * This page renders capability lists and configuration state only. It shows no
 * devices, projects, sessions, usage, billing, or account data — none of that
 * exists, and inventing it would misrepresent the product.
 */
export function NexusCloudPortalPage() {
  const service = getNexusCloudServiceStatus();

  return (
    <section className="section-shell pt-32 lg:pt-36" aria-labelledby="portal-title">
      <div className="mx-auto max-w-5xl">
        <nav aria-label="Breadcrumb" className="mb-6">
          <a href={publicRoutePaths["nexus-cloud"]} className="footer-link justify-start focus-ring">
            <ArrowLeft size={16} aria-hidden="true" />
            Back to KCx NEXUS Hybrid Cloud
          </a>
        </nav>

        <div className="mb-6 flex flex-wrap gap-3">
          <StatusBadge label="Preview / Not Yet Available" tone="development" />
        </div>

        <h1
          id="portal-title"
          className="text-4xl font-semibold leading-tight text-white sm:text-5xl"
        >
          KCx NEXUS Cloud Portal
        </h1>

        <p className="mt-6 max-w-2xl text-base leading-8 text-kcx-ash">
          A preview of the portal that will manage cloud sessions once cloud services exist. It is a
          description of planned surface area, not a live console.
        </p>

        <div
          className="mt-8 flex items-start gap-3 border border-kcx-orange/35 bg-kcx-orange/10 p-4"
          role="note"
        >
          <AlertTriangle className="mt-1 shrink-0 text-kcx-orange" size={20} aria-hidden="true" />
          <p className="text-sm leading-7 text-kcx-steel">
            Cloud services are currently under development. This preview does not connect to a production
            cloud backend.
          </p>
        </div>

        <dl className="mt-8 grid gap-3 sm:grid-cols-3">
          <div className="micro-panel">
            <dt className="block text-kcx-ash">Service status</dt>
            <dd className="mt-2 block font-mono text-kcx-steel">{service.status}</dd>
          </div>
          <div className="micro-panel">
            <dt className="block text-kcx-ash">Execution path</dt>
            <dd className="mt-2 block font-mono text-kcx-steel">{service.mode}</dd>
          </div>
          <div className="micro-panel">
            <dt className="block text-kcx-ash">Cloud backend</dt>
            <dd className="mt-2 block font-mono text-kcx-steel">
              {service.backendConfigured ? "configured" : "not configured"}
            </dd>
          </div>
        </dl>

        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          <CapabilityList
            titleId="portal-verified-title"
            title="Current verified capabilities"
            description="Local Mode features validated on real hardware. These work today and do not depend on any cloud service."
            features={verifiedCapabilities}
          />
          <CapabilityList
            titleId="portal-planned-title"
            title="Planned cloud capabilities"
            description="Design targets for future phases. None of these are implemented, and none can be switched on today."
            features={plannedCloudCapabilities}
          />
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <a href={publicRoutePaths["nexus-cloud"]} className="button-secondary focus-ring">
            <ArrowLeft size={18} aria-hidden="true" />
            Hybrid Cloud Overview
          </a>
          <a href="/" className="button-secondary focus-ring">
            <Home size={18} aria-hidden="true" />
            KCx Labs Home
          </a>
        </div>
      </div>
    </section>
  );
}
