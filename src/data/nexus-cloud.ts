import { Cloud, Cpu, Radio, Shield, Smartphone, Split } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { NexusCloudFeature, NexusExecutionMode, NexusFeatureState } from "../cloud/types";

/**
 * Content for the NEXUS Hybrid Cloud pages.
 *
 * Accuracy rule for this file: only Local Mode capabilities may carry the
 * `verified` state, and only because they were physically validated on real
 * hardware against gateway build `20260719-project-path-validation-03`.
 * Everything cloud-related is `in-development`, `planned`, or `future`.
 */

export const verifiedGatewayBuild = "20260719-project-path-validation-03";

export type NexusStatusTone = "verified" | "development" | "planned" | "future";

/** Label + tone for a status badge. Tone drives colour only; the label always carries the meaning. */
export const nexusStateLabels: Record<NexusFeatureState, { label: string; tone: NexusStatusTone }> = {
  verified: { label: "Verified", tone: "verified" },
  "in-development": { label: "In Development", tone: "development" },
  planned: { label: "Planned", tone: "planned" },
  future: { label: "Future", tone: "future" },
};

export type NexusMode = {
  id: NexusExecutionMode;
  name: string;
  badge: string;
  state: NexusFeatureState;
  icon: LucideIcon;
  summary: string;
  points: string[];
  /** Honest caveat rendered in a distinct block. */
  caveat: string;
};

export const nexusModes: NexusMode[] = [
  {
    id: "local",
    name: "Local Mode",
    badge: "Available Today",
    state: "verified",
    icon: Cpu,
    summary:
      "The Android companion talks to your own machine over your private network. Model execution and project files stay on hardware you control.",
    points: [
      "Runs through your own KCxLocalAI installation.",
      "Phone and PC must be on the same private network — this is a LAN client, not remote access.",
      "Connects over the private NEXUS Mirror gateway after a secure one-time pairing. The gateway is never exposed to the public internet.",
      "Reads only projects you have explicitly approved, from a path-validated registry.",
      "Model execution and project files remain on your machine.",
      "Project-aware chat answers questions against the approved project set.",
    ],
    caveat:
      `Requires your PC and gateway to be running and reachable. Physically validated end to end on a real Android device against gateway build ${verifiedGatewayBuild}.`,
  },
  {
    id: "cloud",
    name: "Cloud Mode",
    badge: "In Development",
    state: "in-development",
    icon: Cloud,
    summary:
      "Intended to answer general NEXUS questions when your home PC is offline. Not yet active.",
    points: [
      "General NEXUS chat while the home PC is offline.",
      "Cloud-hosted inference or approved external providers.",
      "No provider secrets embedded in the Android application.",
      "No automatic access to local projects.",
      "No ability to read files that exist only on an offline PC.",
      "Any cloud-stored data only through explicit future approval.",
    ],
    caveat:
      "Cloud Mode is not yet active. There is no cloud backend, no relay, no account system, and no way to switch it on today.",
  },
  {
    id: "automatic",
    name: "Automatic Hybrid Mode",
    badge: "Planned",
    state: "planned",
    icon: Split,
    summary:
      "Intended to prefer your local machine and fall back to cloud only when you have enabled it. Not yet built.",
    points: [
      "Prefer a healthy local connection whenever one is available.",
      "Fall back to Cloud Mode only when cloud is both enabled and reachable.",
      "Show clearly which execution path handled each request.",
      "Never silently upload project data.",
      "Keep Local Mode fully usable regardless of cloud availability.",
    ],
    caveat: "Hybrid routing is a design target. It depends on Cloud Mode, which does not exist yet.",
  },
];

export type ArchitectureNode = {
  id: string;
  label: string;
  detail: string;
  availability: "current" | "future";
  depth: number;
  icon: LucideIcon;
};

/**
 * Architecture rendered as a semantic list rather than an image, so it stays
 * readable by assistive technology and scales on small screens.
 */
export const architectureNodes: ArchitectureNode[] = [
  {
    id: "android",
    label: "Android KCx NEXUS",
    detail: "Companion application on your phone.",
    availability: "current",
    depth: 0,
    icon: Smartphone,
  },
  {
    id: "local-route",
    label: "Local route (private network)",
    detail: "Working today, phone and PC on the same network.",
    availability: "current",
    depth: 1,
    icon: Radio,
  },
  {
    id: "gateway",
    label: "Mirror Gateway",
    detail: "Authenticated private gateway on your own network.",
    availability: "current",
    depth: 2,
    icon: Shield,
  },
  {
    id: "localai",
    label: "KCxLocalAI",
    detail: "Local model execution on your machine.",
    availability: "current",
    depth: 3,
    icon: Cpu,
  },
  {
    id: "cloud-route",
    label: "Future remote route",
    detail: "Not implemented. No relay, no authenticated session, no public-internet path exists.",
    availability: "future",
    depth: 1,
    icon: Cloud,
  },
  {
    id: "cloud-api",
    label: "KCx NEXUS Cloud API",
    detail: "Planned service. No endpoint exists yet.",
    availability: "future",
    depth: 2,
    icon: Cloud,
  },
  {
    id: "cloud-provider",
    label: "Approved cloud provider or KCx-hosted inference",
    detail: "Planned. Provider selection is undecided.",
    availability: "future",
    depth: 3,
    icon: Cpu,
  },
];

export const privacyBoundaries: string[] = [
  "Local projects are not uploaded automatically.",
  "Project synchronization will be opt-in when it exists.",
  "Cloud Mode cannot read files stored only on an offline PC.",
  "Local filesystem paths are not exposed publicly.",
  "Provider API secrets are not placed in the Android application.",
  "Local Mode remains usable without a cloud subscription or cloud connection.",
  "The private gateway is not exposed directly to the public internet.",
  "Reaching NEXUS from outside your network is not available; no relay or authenticated session exists yet.",
  "The public website pages are informational and never connect to your PC.",
];

export type RoadmapStage = {
  order: number;
  name: string;
  state: NexusFeatureState | "current";
  detail: string;
};

/** No dates. Order communicates sequence; state communicates reality. */
export const roadmapStages: RoadmapStage[] = [
  {
    order: 1,
    name: "Local Android Companion",
    state: "verified",
    detail: "Pairing, gateway, approved projects, and project-aware chat validated on a physical device.",
  },
  {
    order: 2,
    name: "Website Foundation",
    state: "current",
    detail: "This phase. Public preview pages and typed frontend boundaries for future cloud work.",
  },
  {
    order: 3,
    name: "Remote Local Relay and Authenticated Portal",
    state: "planned",
    detail:
      "Reaching your own PC from outside your network, behind a sign-in. Not built: no relay, no session, no device registration.",
  },
  {
    order: 4,
    name: "Private Cloud Preview",
    state: "planned",
    detail: "A closed preview of cloud-hosted inference, limited to invited devices.",
  },
  {
    order: 5,
    name: "Cloud Accounts and Device Registration",
    state: "planned",
    detail: "Identity and device pairing for cloud sessions.",
  },
  {
    order: 6,
    name: "General Cloud Chat",
    state: "planned",
    detail: "NEXUS chat that works while the home PC is offline.",
  },
  {
    order: 7,
    name: "Automatic Local/Cloud Selection",
    state: "planned",
    detail: "Hybrid routing with a visible indicator of which path answered.",
  },
  {
    order: 8,
    name: "Explicit Approved Project Snapshots",
    state: "future",
    detail: "Opt-in, per-project snapshots. Never automatic.",
  },
  {
    order: 9,
    name: "Broader Device Synchronization",
    state: "future",
    detail: "Multi-device continuity, subject to the same explicit-approval rules.",
  },
];

/** Portal capability lists. Verified entries are Local Mode only. */
export const verifiedCapabilities: NexusCloudFeature[] = [
  {
    id: "android-companion",
    name: "Local Android Companion",
    summary: "Android application validated against a real device.",
    state: "verified",
    mode: "local",
  },
  {
    id: "secure-pairing",
    name: "Secure Pairing",
    summary: "One-time pairing establishes an authenticated session.",
    state: "verified",
    mode: "local",
  },
  {
    id: "private-gateway",
    name: "Private Gateway",
    summary: "Authenticated Mirror Gateway on your own network.",
    state: "verified",
    mode: "local",
  },
  {
    id: "approved-projects",
    name: "Approved Project Selection",
    summary: "Path-validated registry limited to projects you approve.",
    state: "verified",
    mode: "local",
  },
  {
    id: "local-chat",
    name: "Project-Aware Local Chat",
    summary: "Answers grounded in the approved local project set.",
    state: "verified",
    mode: "local",
  },
];

export const plannedCloudCapabilities: NexusCloudFeature[] = [
  {
    id: "cloud-chat",
    name: "Cloud Chat",
    summary: "General NEXUS chat without the home PC online.",
    state: "planned",
    mode: "cloud",
  },
  {
    id: "device-registration",
    name: "Device Registration",
    summary: "Register and manage devices for cloud sessions.",
    state: "planned",
    mode: "cloud",
  },
  {
    id: "hybrid-routing",
    name: "Hybrid Routing",
    summary: "Automatic local-first selection with a visible execution path.",
    state: "planned",
    mode: "automatic",
  },
  {
    id: "project-snapshots",
    name: "Explicit Project Snapshots",
    summary: "Opt-in snapshots of approved projects. Never automatic.",
    state: "future",
    mode: "cloud",
  },
  {
    id: "cloud-memory",
    name: "Cloud Memory Controls",
    summary: "Inspect and clear anything retained by a future cloud service.",
    state: "future",
    mode: "cloud",
  },
];
