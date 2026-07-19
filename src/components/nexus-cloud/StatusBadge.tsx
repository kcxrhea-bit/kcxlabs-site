import { CircleDashed, CircleDot, Clock, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { NexusStatusTone } from "../../data/nexus-cloud";

type StatusBadgeProps = {
  label: string;
  tone: NexusStatusTone;
  size?: "default" | "compact";
};

/**
 * Status is never communicated by colour alone: every badge carries a text
 * label and a tone-specific icon shape, so it survives greyscale and
 * colour-vision differences.
 */
const toneClass: Record<NexusStatusTone, string> = {
  verified: "border-kcx-cyan/45 bg-kcx-cyan/10 text-kcx-cyan",
  development: "border-kcx-orange/50 bg-kcx-orange/10 text-kcx-orange",
  planned: "border-white/18 bg-white/[0.045] text-kcx-steel",
  future: "border-white/12 bg-white/[0.025] text-kcx-ash",
};

const toneIcon: Record<NexusStatusTone, LucideIcon> = {
  verified: ShieldCheck,
  development: CircleDot,
  planned: Clock,
  future: CircleDashed,
};

export function StatusBadge({ label, tone, size = "default" }: StatusBadgeProps) {
  const Icon = toneIcon[tone];

  return (
    <span
      className={`inline-flex items-center gap-2 border font-bold uppercase ${toneClass[tone]} ${
        size === "compact"
          ? "px-2.5 py-1 text-[0.62rem] tracking-[0.16em]"
          : "px-3 py-2 text-[0.68rem] tracking-[0.2em]"
      }`}
    >
      <Icon size={size === "compact" ? 12 : 14} aria-hidden="true" />
      {label}
    </span>
  );
}
