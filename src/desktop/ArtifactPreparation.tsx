import { useEffect, useMemo, useState } from "react";
import type {
  CatalogProject,
  DistributionPlan,
  DistributionProgress,
  DistributionProjectStatus,
  DistributionSetupPlan,
  DistributionTarget,
  DistributionWorkflowResult,
} from "../shared/desktop";

const targetInfo: Record<
  DistributionTarget,
  { label: string; description: string }
> = {
  web: {
    label: "Web",
    description: "Build the project's web application or static site.",
  },
  executable: {
    label: "EXE",
    description: "Build a Windows executable.",
  },
  installer: {
    label: "Installer",
    description: "Build a Windows installer.",
  },
  apk: {
    label: "APK",
    description: "Build an Android application package.",
  },
  zip: {
    label: "ZIP",
    description: "Create a clean staged project archive.",
  },
  source: {
    label: "Source",
    description: "Create a source archive from committed Git HEAD.",
  },
};

export function ArtifactPreparation({
  projects,
  setMessage,
}: {
  projects: CatalogProject[];
  setMessage: (message: string) => void;
}) {
  const [projectId, setProjectId] = useState("");
  const [status, setStatus] =
    useState<DistributionProjectStatus | null>(null);
  const [selected, setSelected] =
    useState<DistributionTarget[]>([]);
  const [plan, setPlan] =
    useState<DistributionPlan | null>(null);
  const [progress, setProgress] =
    useState<DistributionProgress | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] =
    useState<DistributionWorkflowResult | null>(null);
  const [setupPlan, setSetupPlan] =
    useState<DistributionSetupPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [applyingSetup, setApplyingSetup] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readyTargets = useMemo(
    () =>
      status?.targets
        .filter((target) => target.canBuild)
        .map((target) => target.target) ?? [],
    [status],
  );

  useEffect(() => {
    if (!window.kcxDesktop) return;

    return window.kcxDesktop.onDistributionProgress((update) => {
      setProgress(update);

      const output = update.output;

      if (output) {
        setLogs((current) => [
          ...current,
          ...output
            .split(/\r?\n/)
            .filter((line) => line.trim().length > 0),
        ]);
      }
    });
  }, []);

  useEffect(() => {
    setStatus(null);
    setSelected([]);
    setPlan(null);
    setProgress(null);
    setLogs([]);
    setResult(null);
    setSetupPlan(null);
    setError(null);

    if (!projectId) return;

    let cancelled = false;

    const load = async () => {
      setLoading(true);

      try {
        const next =
          await window.kcxDesktop!.getDistributionProjectStatus(
            projectId,
          );

        if (!cancelled) {
          setStatus(next);

          setSelected(
            next.targets
              .filter((target) => target.canBuild)
              .map((target) => target.target),
          );

          setMessage(
            `Distribution status loaded for ${next.projectName}`,
          );
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error
              ? err.message
              : "Unable to inspect project distribution status.";

          setError(message);
          setMessage(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [projectId, setMessage]);

  const toggleTarget = (target: DistributionTarget) => {
    setSelected((current) =>
      current.includes(target)
        ? current.filter((item) => item !== target)
        : [...current, target],
    );
  };

  const previewTarget = async (target: DistributionTarget) => {
    if (!projectId) return;

    setError(null);

    try {
      const next =
        await window.kcxDesktop!.previewDistribution(
          projectId,
          target,
        );

      setPlan(next);
      setMessage(`${targetInfo[target].label} build plan ready`);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Unable to prepare build plan.";

      setError(message);
      setMessage(message);
    }
  };

  const buildTargets = async (targets: DistributionTarget[]) => {
    if (!projectId || targets.length === 0 || building) return;

    setBuilding(true);
    setError(null);
    setResult(null);
    setProgress(null);
    setLogs([]);

    try {
      const next =
        await window.kcxDesktop!.runDistributionWorkflow({
          projectId,
          targets,
          actions: ["build", "stage"],
        });

      setResult(next);
      setMessage(next.message);

      if (!next.ok) {
        setError(next.message);
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Distribution workflow failed.";

      setError(message);
      setMessage(message);
    } finally {
      setBuilding(false);
    }
  };

  const refreshDistributionStatus = async () => {
    if (!projectId) return;

    const next =
      await window.kcxDesktop!.getDistributionProjectStatus(
        projectId,
      );

    setStatus(next);

    setSelected(
      next.targets
        .filter((target) => target.canBuild)
        .map((target) => target.target),
    );
  };
  const previewSetup = async (target: DistributionTarget) => {
    if (!projectId || building) return;

    setError(null);
    setSetupPlan(null);

    try {
      const next =
        await window.kcxDesktop!.previewDistributionSetup(
          projectId,
          target,
        );

      setSetupPlan(next);
      setMessage(next.message);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Unable to prepare setup preview.";

      setError(message);
      setMessage(message);
    }
  };
  const applySetup = async () => {
    if (!projectId || !setupPlan || applyingSetup || building) return;

    setApplyingSetup(true);
    setError(null);

    try {
      const response =
        await window.kcxDesktop!.applyDistributionSetup(
          projectId,
          setupPlan.target,
        );

      setMessage(response.message);

      if (!response.ok) {
        setError(response.message);
        return;
      }

      setSetupPlan(null);
      await refreshDistributionStatus();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Unable to apply distribution setup.";

      setError(message);
      setMessage(message);
    } finally {
      setApplyingSetup(false);
    }
  };
  const openFolder = async () => {
    if (!projectId) return;

    const response =
      await window.kcxDesktop!.openProjectFolder(projectId);

    setMessage(response.message);
  };

  return (
    <section className="desktop-card" style={{ padding: "1.25rem" }}>
      <p className="desktop-kicker">Distribution Center</p>
      <h2>Build, package, stage, and publish projects</h2>

      <p>
        Select a registered project. KCx Labs determines what is ready
        now and what still needs packaging setup.
      </p>

      <div
        style={{
          marginTop: "1rem",
          maxWidth: "420px",
        }}
      >
        <label
          htmlFor="distribution-project"
          style={{
            display: "block",
            marginBottom: "0.4rem",
            fontSize: "0.8rem",
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            opacity: 0.75,
          }}
        >
          Registered project
        </label>

        <select
          id="distribution-project"
          value={projectId}
          disabled={building}
          onChange={(event) => setProjectId(event.target.value)}
          style={{
            width: "100%",
            padding: "0.75rem 2.5rem 0.75rem 0.85rem",
            border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: "6px",
            background: "rgba(10,10,10,0.95)",
            color: "inherit",
            fontSize: "0.95rem",
            cursor: building ? "not-allowed" : "pointer",
          }}
        >
          <option value="">Select registered project</option>

          {projects.map((project) => (
            <option
              key={project.id}
              value={project.id}
              disabled={project.folderStatus === "missing"}
            >
              {project.name} ({project.folderStatus})
            </option>
          ))}
        </select>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem",
          marginTop: "1rem",
        }}
      >
        <button
          type="button"
          disabled={!projectId || building}
          onClick={() => void openFolder()}
        >
          Open project folder
        </button>

        <button
          type="button"
          disabled={
            readyTargets.length === 0 ||
            building
          }
          onClick={() => setSelected(readyTargets)}
        >
          Select all ready
        </button>

        <button
          type="button"
          className="desktop-action"
          disabled={
            selected.length === 0 ||
            building
          }
          onClick={() => void buildTargets(selected)}
        >
          {building
            ? "Building…"
            : `Build selected (${selected.length})`}
        </button>

        <button
          type="button"
          disabled={
            readyTargets.length === 0 ||
            building
          }
          onClick={() => void buildTargets(readyTargets)}
        >
          Build all ready
        </button>
      </div>

      {loading && (
        <p style={{ marginTop: "1rem" }}>
          Inspecting project distribution status…
        </p>
      )}

      {error && (
        <p
          className="desktop-error"
          style={{ marginTop: "1rem" }}
        >
          {error}
        </p>
      )}

      {status && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "0.75rem",
              marginTop: "1.25rem",
            }}
          >
            {status.targets.map((target) => {
              const info = targetInfo[target.target];
              const checked =
                selected.includes(target.target);

              return (
                <article
                  key={target.target}
                  className="desktop-card"
                  style={{ padding: "1rem" }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "0.75rem",
                      alignItems: "flex-start",
                    }}
                  >
                    <div>
                      <p className="desktop-kicker">
                        {info.label}
                      </p>

                      <strong>
                        {target.readiness
                          .replace("-", " ")
                          .toUpperCase()}
                      </strong>
                    </div>

                    {target.canBuild && (
                      <input
                        type="checkbox"
                        aria-label={`Select ${info.label}`}
                        checked={checked}
                        disabled={building}
                        onChange={() =>
                          toggleTarget(target.target)
                        }
                      />
                    )}
                  </div>

                  <p style={{ fontSize: "0.82rem" }}>
                    {info.description}
                  </p>

                  <p style={{ fontSize: "0.8rem" }}>
                    {target.reason}
                  </p>

                  {target.canBuild && (
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "0.5rem",
                      }}
                    >
                      <button
                        type="button"
                        disabled={building}
                        onClick={() =>
                          void previewTarget(target.target)
                        }
                      >
                        Preview
                      </button>

                      <button
                        type="button"
                        className="desktop-action"
                        disabled={building}
                        onClick={() =>
                          void buildTargets([target.target])
                        }
                      >
                        Build
                      </button>
                    </div>
                  )}

                  {target.canConfigure && (
                    <button
                      type="button"
                      className="desktop-action"
                      disabled={building}
                      onClick={() =>
                        void previewSetup(target.target)
                      }
                    >
                      Preview setup
                    </button>
                  )}
                </article>
              );
            })}
          </div>

          <div
            className="desktop-card"
            style={{
              marginTop: "1.25rem",
              padding: "1rem",
            }}
          >
            <p className="desktop-kicker">
              Selected project
            </p>
            <strong>{status.projectName}</strong>
          </div>
        </>
      )}

      {setupPlan && (
        <div
          className="desktop-card"
          style={{
            marginTop: "1.25rem",
            padding: "1rem",
          }}
        >
          <p className="desktop-kicker">
            Setup preview
          </p>

          <h3>
            {setupPlan.projectName} —{" "}
            {targetInfo[setupPlan.target].label}
          </h3>

          <p>
            <strong>
              {setupPlan.supported
                ? "KCx Labs can prepare this target"
                : "Automatic setup is not available"}
            </strong>
          </p>

          <p>{setupPlan.message}</p>

          <p>
            <strong>Detected type</strong>
            <br />
            <code>{setupPlan.detectedKind}</code>
          </p>

          <p>
            <strong>Configuration root</strong>
            <br />
            <code>{setupPlan.detectedRoot}</code>
          </p>

          <h4>Proposed changes</h4>

          {setupPlan.changes.length ? (
            <ul>
              {setupPlan.changes.map((change, index) => (
                <li key={`${change.kind}-${change.path}-${index}`}>
                  <strong>
                    {change.kind.toUpperCase()}
                  </strong>{" "}
                  <code>{change.path}</code>
                  <br />
                  {change.description}
                </li>
              ))}
            </ul>
          ) : (
            <p>No project changes proposed.</p>
          )}

          {setupPlan.warnings.length > 0 && (
            <>
              <h4>Before applying</h4>
              <ul>
                {setupPlan.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </>
          )}

          {setupPlan.supported && (
            <>
              <p style={{ fontSize: "0.8rem", opacity: 0.8 }}>
                Preview only. No project files have been modified yet.
                Applying this setup requires explicit approval.
              </p>

              <button
                type="button"
                className="desktop-action"
                disabled={applyingSetup || building}
                onClick={() => void applySetup()}
              >
                {applyingSetup ? "Applying setup…" : "Apply setup"}
              </button>
            </>
          )}
        </div>
      )}
      {plan && (
        <div
          className="desktop-card"
          style={{
            marginTop: "1.25rem",
            padding: "1rem",
          }}
        >
          <p className="desktop-kicker">
            Build plan preview
          </p>

          <h3>
            {plan.projectName} —{" "}
            {targetInfo[plan.target].label}
          </h3>

          <p>{plan.message}</p>

          <p>
            <strong>Working directory</strong>
            <br />
            <code>{plan.workingDirectory}</code>
          </p>

          <p>
            <strong>Command</strong>
            <br />
            <code>
              {plan.command
                ? [plan.command, ...plan.args].join(" ")
                : "No command"}
            </code>
          </p>

          <p>
            <strong>Expected artifacts</strong>
          </p>

          {plan.expectedArtifacts.length ? (
            <ul>
              {plan.expectedArtifacts.map((artifact) => (
                <li key={artifact}>
                  <code>{artifact}</code>
                </li>
              ))}
            </ul>
          ) : (
            <p>None configured.</p>
          )}
        </div>
      )}

      {(building || progress) && (
        <div
          className="desktop-card"
          style={{
            marginTop: "1.25rem",
            padding: "1rem",
          }}
        >
          <p className="desktop-kicker">
            Build progress
          </p>

          <h3>
            {progress
              ? `${targetInfo[progress.target].label} — ${progress.stage}`
              : "Starting…"}
          </h3>

          <progress
            value={progress?.progress ?? 0}
            max={100}
            style={{ width: "100%" }}
          />

          <p>
            <strong>
              {progress?.progress ?? 0}%
            </strong>{" "}
            {progress?.message ?? "Preparing workflow…"}
          </p>
        </div>
      )}

      {logs.length > 0 && (
        <div
          className="desktop-card"
          style={{
            marginTop: "1.25rem",
            padding: "1rem",
          }}
        >
          <p className="desktop-kicker">
            Build output
          </p>

          <pre
            style={{
              maxHeight: "300px",
              overflow: "auto",
              whiteSpace: "pre-wrap",
              fontSize: "0.75rem",
            }}
          >
            {logs.join("\n")}
          </pre>
        </div>
      )}

      {result && (
        <div
          className="desktop-card"
          style={{
            marginTop: "1.25rem",
            padding: "1rem",
          }}
        >
          <p className="desktop-kicker">
            Distribution result
          </p>

          <h3>
            {result.ok
              ? "Workflow completed"
              : "Workflow failed"}
          </h3>

          <p>{result.message}</p>

          <p>
            <strong>Completed actions:</strong>{" "}
            {result.completedActions.length
              ? result.completedActions.join(", ")
              : "None"}
          </p>

          <p>
            <strong>Artifacts</strong>
          </p>

          {result.artifactPaths.length ? (
            <ul>
              {result.artifactPaths.map((artifact) => (
                <li key={artifact}>
                  <code>{artifact}</code>
                </li>
              ))}
            </ul>
          ) : (
            <p>No artifact files were returned.</p>
          )}

          {result.artifactPaths.length > 0 && (
            <p style={{ fontSize: "0.8rem", opacity: 0.8 }}>
              Artifacts are staged. Website/release publication remains
              approval-gated.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
