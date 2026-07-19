import { architectureNodes } from "../../data/nexus-cloud";

/**
 * Semantic architecture view.
 *
 * Rendered as a nested-looking list rather than an image so screen readers and
 * small viewports both get the full structure. Indentation is presentational;
 * the "Working today" / "Not implemented" text carries the real distinction.
 */
export function ArchitectureDiagram() {
  return (
    <div className="studio-panel p-6 md:p-8">
      <ul className="grid gap-2.5" aria-label="KCx NEXUS request paths">
        {architectureNodes.map((node) => {
          const Icon = node.icon;
          const isFuture = node.availability === "future";

          return (
            <li key={node.id} style={{ marginInlineStart: `${node.depth * 1.25}rem` }}>
              <div
                className={`flex flex-wrap items-center gap-x-3 gap-y-2 border px-4 py-3 ${
                  isFuture
                    ? "border-dashed border-white/15 bg-white/[0.015]"
                    : "border-white/12 bg-black/25"
                }`}
              >
                <Icon
                  size={17}
                  className={isFuture ? "shrink-0 text-kcx-ash" : "shrink-0 text-kcx-orange"}
                  aria-hidden="true"
                />
                <span
                  className={`font-mono text-sm ${isFuture ? "text-kcx-ash" : "text-kcx-steel"}`}
                >
                  {node.label}
                </span>
                <span
                  className={`ms-auto text-[0.62rem] font-bold uppercase tracking-[0.16em] ${
                    isFuture ? "text-kcx-ash" : "text-kcx-cyan"
                  }`}
                >
                  {isFuture ? "Planned" : "Working today"}
                </span>
                <span className="w-full text-xs leading-6 text-kcx-ash">{node.detail}</span>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-6 text-xs leading-6 text-kcx-ash">
        Solid borders mark the path that works today. Dashed borders mark planned components that do not
        exist yet.
      </p>
    </div>
  );
}
