import { DragEvent, useState } from "react";
import type { CatalogProject, NewCatalogProject, PatchPreview, ReleasePreview } from "../shared/desktop";

function DropZone({ accept, label, onPath }: { accept: string; label: string; onPath: (path: string) => void }) { const drop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); const file = event.dataTransfer.files.item(0); if (file) onPath(window.kcxDesktop!.getDroppedPath(file)); }; return <div className="desktop-drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={drop}><strong>{label}</strong><small>Drag a {accept} here from File Explorer, or use the browse action.</small></div>; }
function Result({ children, bad = false }: { children: string; bad?: boolean }) { return <p className={bad ? "desktop-result desktop-error" : "desktop-result"}>{children}</p>; }

export function ProjectFolderRegistration({ refresh, setMessage }: { refresh: () => Promise<void>; setMessage: (message: string) => void }) {
  const [folder, setFolder] = useState(""); const [busy, setBusy] = useState(false);
  const register = async () => { if (!folder) return; const name = folder.split(/[\\/]/).filter(Boolean).pop() || "project"; const draft: NewCatalogProject = { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project", folder, description: "Registered from folder selection", category: "Uncategorized", currentVersion: "Unreleased", releaseChannel: "stable", websiteVisible: true, downloadVisible: true }; setBusy(true); try { await window.kcxDesktop!.addProject(draft); await refresh(); setMessage("Project folder registered"); setFolder(""); } catch (error) { setMessage(error instanceof Error ? error.message : "Project registration failed"); } finally { setBusy(false); } };
  return <section className="desktop-card desktop-task-card desktop-registration"><div><p className="desktop-kicker">Quick start</p><h3>Register a project folder</h3><p>Choose a local folder you trust. Registering only adds it to this desktop workspace; it does not scan, modify, or publish the project.</p></div><div className="desktop-action-row"><button className="desktop-action" disabled={busy} onClick={async () => { const selected = await window.kcxDesktop!.chooseProjectFolder(); if (selected) setFolder(selected); }}>Choose project folder</button><button className="desktop-action desktop-action-secondary" disabled={busy || !folder} onClick={register}>{busy ? "Registering…" : "Register selected folder"}</button></div><small className="desktop-path">{folder || "No folder selected yet"}</small><DropZone accept="project folder" label="Drop a project folder" onPath={setFolder} /></section>;
}

export function ReleaseWizard({
  projects,
  setMessage,
  initialDraft,
  onPublished,
}: {
  projects: CatalogProject[];
  setMessage: (message: string) => void;
  initialDraft?: {
    projectId: string;
    artifactPath: string;
    version: string;
    title: string;
  } | null;
  onPublished?: () => void;
}) {
  const [step, setStep] = useState(initialDraft ? 2 : 1);
  const [projectId, setProjectId] = useState(
    initialDraft?.projectId ?? "",
  );
  const [artifactPath, setArtifactPath] = useState(
    initialDraft?.artifactPath ?? "",
  );
  const [version, setVersion] = useState(
    initialDraft?.version ?? "",
  );
  const [title, setTitle] = useState(
    initialDraft?.title ?? "",
  );
  const [preview, setPreview] =
    useState<ReleasePreview | null>(null);

  const draft = {
    projectId,
    artifactPath,
    version,
    title,
    notes: "",
    channel: "stable" as const,
  };

  const validate = async () => {
    const result =
      await window.kcxDesktop!.previewRelease(draft);

    setPreview(result);
    setStep(3);

    setMessage(
      result.isValid
        ? "Release preview ready"
        : "Release validation needs attention",
    );
  };

  if (!projects.length) {
    return (
      <section className="desktop-card desktop-empty-state">
        <h3>Register a project first</h3>
        <p>
          Release publishing needs a trusted registered
          project and a prepared artifact.
        </p>
      </section>
    );
  }

  return (
    <section className="desktop-card desktop-wizard">
      <div className="desktop-wizard-header">
        <div>
          <p className="desktop-kicker">
            Release workflow
          </p>

          <h3>
            {step === 1
              ? "1. Choose a project"
              : step === 2
                ? "2. Choose an artifact"
                : "3. Review before creating"}
          </h3>

          <p>
            This workflow creates a local release with a backup.
            It does not deploy the website.
          </p>
        </div>

        <span className="desktop-badge">
          Step {step} of 3
        </span>
      </div>

      {step === 1 && (
        <div className="desktop-wizard-body">
          <label>
            Registered project

            <select
              value={projectId}
              onChange={(event) =>
                setProjectId(event.target.value)
              }
            >
              <option value="">
                Select a project
              </option>

              {projects.map((project) => (
                <option
                  value={project.id}
                  key={project.id}
                >
                  {project.name}
                </option>
              ))}
            </select>
          </label>

          <button
            className="desktop-action"
            disabled={!projectId}
            onClick={() => setStep(2)}
          >
            Continue to artifact
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="desktop-wizard-body">
          {initialDraft && (
            <p className="desktop-warning">
              Staged artifact loaded from Artifact Preparation.
              Review the release details before continuing.
            </p>
          )}

          <div className="desktop-task-grid">
            <label>
              Version

              <input
                value={version}
                placeholder="1.2.3"
                onChange={(event) =>
                  setVersion(event.target.value)
                }
              />
            </label>

            <label>
              Release title

              <input
                value={title}
                onChange={(event) =>
                  setTitle(event.target.value)
                }
              />
            </label>
          </div>

          <button
            className="desktop-action desktop-action-secondary"
            onClick={async () => {
              const selected =
                await window.kcxDesktop!.chooseArtifact();

              if (selected) {
                setArtifactPath(selected);
              }
            }}
          >
            Choose ZIP, EXE, MSI, or APK
          </button>

          <small className="desktop-path">
            {artifactPath || "No artifact selected yet"}
          </small>

          <DropZone
            accept="ZIP, EXE, MSI, or APK artifact"
            label="Drop a release artifact"
            onPath={setArtifactPath}
          />

          <div className="desktop-action-row">
            <button
              className="desktop-action desktop-action-secondary"
              onClick={() => setStep(1)}
            >
              Back
            </button>

            <button
              className="desktop-action"
              disabled={
                !artifactPath ||
                !version ||
                !title
              }
              onClick={validate}
            >
              Review release
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="desktop-wizard-body">
          <p>
            {preview?.artifact
              ? `Selected: ${preview.artifact.name}`
              : "No artifact preview available."}
          </p>

          {preview?.artifact && (
            <small className="desktop-path">
              SHA-256: {preview.artifact.sha256}
            </small>
          )}

          {preview?.errors.map((error) => (
            <Result bad key={error}>
              {error}
            </Result>
          ))}

          {preview?.warnings.map((warning) => (
            <p
              className="desktop-warning"
              key={warning}
            >
              {warning}
            </p>
          ))}

          {preview?.operations.length ? (
            <ul className="desktop-check-list">
              {preview.operations.map((operation) => (
                <li key={operation}>
                  {operation}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="desktop-action-row">
            <button
              className="desktop-action desktop-action-secondary"
              onClick={() => setStep(2)}
            >
              Back to artifact
            </button>

            <button
              className="desktop-action"
              disabled={!preview?.isValid}
              onClick={async () => {
                const result =
                  await window.kcxDesktop!.publishRelease(
                    draft,
                  );

                setMessage(result.message);

                if (result.ok) {
                  onPublished?.();
                }
              }}
            >
              Create local release
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
export function PatchImport({ projects, setMessage }: { projects: CatalogProject[]; setMessage: (message: string) => void }) {
  const [projectId, setProjectId] = useState(""); const [patchPath, setPatchPath] = useState(""); const [preview, setPreview] = useState<PatchPreview | null>(null); const check = async () => { const result = await window.kcxDesktop!.previewPatch(projectId, patchPath); setPreview(result); setMessage(result.isValid ? "Patch preview ready" : "Patch preview needs attention"); };
  return <section className="desktop-card desktop-task-card"><p className="desktop-kicker">Separate patch workflow</p><h3>Review, then import a patch</h3><p>Patch files are stored separately from release artifacts. Existing files are backed up before replacement.</p><div className="desktop-task-grid"><label>Registered project<select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Select a project</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label><div><button className="desktop-action desktop-action-secondary" onClick={async () => { const selected = await window.kcxDesktop!.choosePatch(); if (selected) setPatchPath(selected); }}>Choose .patch or .diff</button><small className="desktop-path">{patchPath || "No patch selected yet"}</small></div></div><DropZone accept=".patch or .diff file" label="Drop a patch file" onPath={setPatchPath} /><button className="desktop-action" disabled={!projectId || !patchPath} onClick={check}>Preview patch import</button>{preview && <div className="desktop-review-panel"><p><strong>{preview.fileName ?? "Patch"}</strong> · {preview.bytes ?? 0} bytes</p>{preview.errors.map((error) => <Result bad key={error}>{error}</Result>)}<ul className="desktop-check-list">{preview.operations.map((operation) => <li key={operation}>{operation}</li>)}</ul><button className="desktop-action" disabled={!preview.isValid} onClick={async () => { const result = await window.kcxDesktop!.importPatch(projectId, patchPath); setMessage(result.message); }}>Import reviewed patch</button></div>}</section>;
}
