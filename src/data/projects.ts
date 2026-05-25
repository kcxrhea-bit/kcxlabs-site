import {
  Bot,
  BrainCircuit,
  Eye,
  HeartPulse,
  Cpu,
  Gamepad2,
  MonitorCog,
  NotebookPen,
  RadioTower,
  ScanEye,
  Smartphone,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type Project = {
  name: string;
  eyebrow: string;
  summary: string;
  status: "Active Build" | "In Development" | "Planned Layer" | "Research / Prototype";
  signal: "orange" | "cyan" | "red";
  icon: LucideIcon;
  futurePath?: string;
};

export const primarySystems: Project[] = [
  {
    name: "KCxMode",
    eyebrow: "Mobile systems",
    summary: "The Android command layer for modes, device context, assistant handoff, and mobile control across the KCx ecosystem.",
    status: "Active Build",
    signal: "orange",
    icon: Smartphone,
    futurePath: "/kcxmode",
  },
  {
    name: "KCx Messenger",
    eyebrow: "Continuity layer",
    summary: "The planned communication surface for local identity, AI-assisted conversation tools, and continuity between mobile, desktop, and companion systems.",
    status: "Planned Layer",
    signal: "cyan",
    icon: RadioTower,
    futurePath: "/messenger",
  },
  {
    name: "KCx Studio Companion",
    eyebrow: "Desktop creator tools",
    summary: "The desktop command environment for project memory, creator workflows, AI agent coordination, and founder-built software sessions.",
    status: "In Development",
    signal: "orange",
    icon: MonitorCog,
    futurePath: "/studio",
  },
];

export const futureInfrastructure: Project[] = [
  {
    name: "KCx Valhalla",
    eyebrow: "Future ecosystem architecture",
    summary: "The premium interface architecture layer for cinematic surfaces, system language, experimental control panels, and connected UX direction.",
    status: "Research / Prototype",
    signal: "red",
    icon: Cpu,
  },
  {
    name: "KCx Cortex",
    eyebrow: "AI runtime orchestration",
    summary: "The local-first intelligence infrastructure for assistant memory, model routing, private automation, and cross-system runtime behavior.",
    status: "In Development",
    signal: "cyan",
    icon: BrainCircuit,
  },
];

export const subsystemModules: Project[] = [
  {
    name: "KCxRobotBuddy",
    eyebrow: "Companion robotics module",
    summary: "A supporting companion AI module for expressive presence, robotics behavior experiments, and embodied ecosystem interactions.",
    status: "Research / Prototype",
    signal: "orange",
    icon: Bot,
  },
  {
    name: "KCxViewer",
    eyebrow: "Visual inspection module",
    summary: "A lightweight viewing surface for media, references, project assets, and future visual context inside KCx workflows.",
    status: "Planned Layer",
    signal: "cyan",
    icon: Eye,
  },
  {
    name: "KCxWatcher",
    eyebrow: "Runtime observation module",
    summary: "A watcher layer for local signals, project changes, task context, and future automation triggers across the ecosystem.",
    status: "Planned Layer",
    signal: "cyan",
    icon: ScanEye,
  },
  {
    name: "KCxHealth",
    eyebrow: "Personal systems module",
    summary: "An experimental layer for wellness-aware routines, daily-state context, and personal operating patterns.",
    status: "Research / Prototype",
    signal: "red",
    icon: HeartPulse,
  },
  {
    name: "KCxNotes",
    eyebrow: "Memory capture module",
    summary: "A focused notes and memory capture surface for ideas, project fragments, system planning, and assistant recall.",
    status: "Planned Layer",
    signal: "orange",
    icon: NotebookPen,
  },
  {
    name: "KCx Core WoW addon",
    eyebrow: "Experimental runtime addon",
    summary: "A game-adjacent addon concept for testing interface discipline, runtime overlays, and focused companion tooling.",
    status: "Research / Prototype",
    signal: "orange",
    icon: Gamepad2,
  },
];

export const coreProjects: Project[] = [...primarySystems, ...futureInfrastructure];

export const futureSystems = [
  { name: "KCxMode", route: "/kcxmode", note: "Dedicated Android systems page", status: "Active Build" },
  { name: "KCx Messenger", route: "/messenger", note: "Future communication layer page", status: "Planned Layer" },
  { name: "KCx Studio Companion", route: "/studio", note: "Desktop creator tools page", status: "In Development" },
  { name: "KCx Valhalla", route: "/valhalla", note: "Premium interface lab page", status: "Research / Prototype" },
  { name: "Robotics", route: "/robotics", note: "Companion AI research page", status: "Research / Prototype" },
  { name: "Devlog", route: "/devlog", note: "Build notes and progress page", status: "Planned Layer" },
] as const;
