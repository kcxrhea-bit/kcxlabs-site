import { FormEvent, useEffect, useState, type ReactNode } from "react";
import { Activity, Boxes, CloudUpload, Database, FileText, Film, FolderKanban, Gauge, History, HelpCircle, MonitorPlay, Palette, Rocket, Settings, Wrench } from "lucide-react";
import type { ActivityEntry, CatalogProject, DeploymentProgress, DeploymentReadiness, DeploymentResult, DesktopStatus, DiscoveredProject, NewCatalogProject, PreviewStatus, ThemeScan, WebsiteChangePreview, WebsiteChangeRequest } from "../shared/desktop";
import { PatchImport, ProjectFolderRegistration, ReleaseWizard } from "./WorkflowComponents";
import { ArtifactPreparation } from "./ArtifactPreparation";
import { MediaCenter } from "./MediaCenter";
import { NeonStorage } from "./NeonStorage";
import "./desktop.css";

type PageName = "Dashboard" | "Media Center" | "Projects" | "Artifacts" | "Release Publisher" | "Patch Import" | "Website" | "Website Preview" | "Deployment" | "Theme Sync" | "Release History" | "Activity" | "Settings" | "Neon Storage" | "Help & Guide";
type ReleaseHandoff = {
  projectId: string;
  artifactPath: string;
  version: string;
  title: string;
};
const navigation: Array<{ label: PageName; icon: typeof Gauge; group: string; description: string }> = [
  { label: "Dashboard", icon: Gauge, group: "Home", description: "Start here" },
  { label: "Media Center", icon: Film, group: "Home", description: "Publish and manage clips" },
  { label: "Projects", icon: FolderKanban, group: "Manage", description: "Register local projects" },
  { label: "Artifacts", icon: FileText, group: "Manage", description: "Prepare project files" },
  { label: "Release Publisher", icon: Rocket, group: "Publish", description: "Create a local release" },
  { label: "Patch Import", icon: FileText, group: "Publish", description: "Archive a patch" },
  { label: "Website", icon: Wrench, group: "Publish", description: "Build the website locally" },
  { label: "Website Preview", icon: MonitorPlay, group: "Publish", description: "Preview before deployment" },
  { label: "Deployment", icon: CloudUpload, group: "Publish", description: "Deploy kcxlabs.org" },
  { label: "Theme Sync", icon: Palette, group: "Manage", description: "Copy the KCx theme safely" },
  { label: "Release History", icon: History, group: "System", description: "Review local release activity" },
  { label: "Activity", icon: Activity, group: "System", description: "Review recent actions" },
  { label: "Settings", icon: Settings, group: "System", description: "Understand local settings" },
  { label: "Neon Storage", icon: Database, group: "System", description: "Monitor Neon database storage" },
  { label: "Help & Guide", icon: HelpCircle, group: "System", description: "Learn every available workflow" },
];
const initialProject: NewCatalogProject = { name: "", slug: "", folder: "", description: "", category: "", currentVersion: "", releaseChannel: "stable", websiteVisible: true, downloadVisible: true };

function PageIntro({ eyebrow, title, children, action }: { eyebrow: string; title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="desktop-page-intro"><div><p className="desktop-kicker">{eyebrow}</p><h2>{title}</h2><p>{children}</p></div>{action && <div className="desktop-page-intro-action">{action}</div>}</div>;
}
function Panel({ title, children, tone = "default" }: { title: string; children: ReactNode; tone?: "default" | "accent" }) { return <section className={`desktop-card desktop-task-card ${tone === "accent" ? "desktop-task-card-accent" : ""}`}><h3>{title}</h3>{children}</section>; }
function Status({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warning" }) { return <span className={`desktop-badge desktop-badge-${tone}`}>{children}</span>; }

export function DesktopApp() {
  const [page, setPage] = useState<PageName>("Dashboard"); const [status, setStatus] = useState<DesktopStatus | null>(null); const [projects, setProjects] = useState<CatalogProject[]>([]); const [message, setMessage] = useState("Ready");
  const [releaseHandoff, setReleaseHandoff] =
    useState<ReleaseHandoff | null>(null);
  const refreshProjects = async () => setProjects(await window.kcxDesktop!.listProjects());
  useEffect(() => { void window.kcxDesktop?.getStatus().then(setStatus); void refreshProjects(); }, []);
  const groups = [...new Set(navigation.map((entry) => entry.group))];
  return <main className="desktop-app"><aside className="desktop-nav"><div className="desktop-brand"><Boxes size={20} /> KCx Labs</div><p className="desktop-kicker">Desktop workspace</p><nav aria-label="Application navigation">{groups.map((group) => <div className="desktop-nav-group" key={group}><p>{group}</p>{navigation.filter((entry) => entry.group === group).map(({ label, icon: Icon, description }) => <button key={label} type="button" title={description} onClick={() => setPage(label)} className={page === label ? "desktop-nav-item desktop-nav-item-active" : "desktop-nav-item"}><Icon size={17} /><span>{label}</span></button>)}</div>)}</nav><div className="desktop-nav-footer"><span>{status ? "Desktop ready" : "Connecting"}</span><small>{message}</small></div></aside><section className="desktop-workspace"><div className="desktop-art" aria-hidden="true" /><header className="desktop-header"><div><p className="desktop-kicker">KCx Labs desktop</p><h1>{page}</h1></div><span className="desktop-status"><i /> {status ? "Connected" : "Connecting"}</span></header><Page
  page={page}
  projects={projects}
  refreshProjects={refreshProjects}
  setMessage={setMessage}
  navigate={setPage}
  releaseHandoff={releaseHandoff}
  setReleaseHandoff={setReleaseHandoff}
/></section></main>;
}

function Page({
  page,
  projects,
  refreshProjects,
  setMessage,
  navigate,
  releaseHandoff,
  setReleaseHandoff,
}: {
  page: PageName;
  projects: CatalogProject[];
  refreshProjects: () => Promise<void>;
  setMessage: (value: string) => void;
  navigate: (page: PageName) => void;
  releaseHandoff: ReleaseHandoff | null;
  setReleaseHandoff: (value: ReleaseHandoff | null) => void;
}) {
  if (page === "Dashboard") return <Dashboard projects={projects} navigate={navigate} />;
  if (page === "Media Center") return <><PageIntro eyebrow="Media" title="Publish and manage clips">Upload a video, find existing online clips, or recover an interrupted publication. Files and website actions remain clearly separated.</PageIntro><MediaCenter setMessage={setMessage} /></>;
  if (page === "Projects") return <><PageIntro eyebrow="Local projects" title="Register projects you trust">Add a real local project folder before preparing files, publishing a release, or syncing the KCx theme.</PageIntro><ProjectFolderRegistration refresh={refreshProjects} setMessage={setMessage} /><Projects projects={projects} refresh={refreshProjects} setMessage={setMessage} /></>;
  if (page === "Artifacts") return <><PageIntro eyebrow="Project files" title="Prepare artifacts safely">Open a project, make a staged ZIP, or run its own configured packaging command. Nothing deploys from this page.</PageIntro><ArtifactPreparation
  projects={projects}
  setMessage={setMessage}
  onPrepareRelease={(draft) => {
    setReleaseHandoff(draft);
    navigate("Release Publisher");
  }}
/></>;
  if (page === "Release Publisher") return <><PageIntro eyebrow="Releases" title="Create a release from a reviewed artifact">This copies a selected artifact and updates local website metadata. Deployment remains a separate manual choice.</PageIntro><ReleaseWizard
  projects={projects}
  setMessage={setMessage}
  initialDraft={releaseHandoff}
  onPublished={() => setReleaseHandoff(null)}
/></>;
  if (page === "Patch Import") return <><PageIntro eyebrow="Patches" title="Import a patch with a preview">Patches are stored separately from releases. Review the destination before importing.</PageIntro><PatchImport projects={projects} setMessage={setMessage} /></>;
  if (page === "Website") return <Website setMessage={setMessage} />;
  if (page === "Website Preview") return <Preview setMessage={setMessage} />;
  if (page === "Deployment") return <Deployment setMessage={setMessage} />;
  if (page === "Theme Sync") return <Theme projects={projects} setMessage={setMessage} />;
  if (page === "Activity" || page === "Release History") return <Log releaseOnly={page === "Release History"} setMessage={setMessage} />;
  if (page === "Settings") return <SettingsPage />;
  if (page === "Neon Storage") return <NeonStorage />;
  return <Guide navigate={navigate} />;
}

function Dashboard({ projects, navigate }: { projects: CatalogProject[]; navigate: (page: PageName) => void }) { const available = projects.filter((project) => project.folderStatus === "available").length; return <><PageIntro eyebrow="Overview" title="Your KCx Labs workspace">Start with the task you need. KCx Labs keeps project work local and makes publishing/deployment choices explicit.</PageIntro><div className="desktop-summary-grid"><Panel title="Media Center" tone="accent"><p>Upload clips, manage what appears on the website, and recover interrupted finalizations.</p><Status tone="good">Available</Status><button className="desktop-action" onClick={() => navigate("Media Center")}>Open Media Center</button></Panel><Panel title="Projects"><p>{projects.length ? `${available} of ${projects.length} registered project folders are available.` : "No projects are registered yet."}</p><Status tone={projects.length ? "good" : "warning"}>{projects.length ? "Projects registered" : "Setup needed"}</Status><button className="desktop-action desktop-action-secondary" onClick={() => navigate("Projects")}>{projects.length ? "Manage projects" : "Register a project"}</button></Panel><Panel title="Website workflow"><p>Build and preview the website locally before you make any separate manual deployment decision.</p><Status>Manual deployment</Status><button className="desktop-action desktop-action-secondary" onClick={() => navigate("Website Preview")}>Open website preview</button></Panel><Panel title="Need guidance?"><p>Use the offline guide for step-by-step instructions, safety notes, recovery, and every current feature.</p><Status>Offline help</Status><button className="desktop-action desktop-action-secondary" onClick={() => navigate("Help & Guide")}>Open Help & Guide</button></Panel></div></>;
}

function Projects({ projects, refresh, setMessage }: { projects: CatalogProject[]; refresh: () => Promise<void>; setMessage: (value: string) => void }) { const [draft, setDraft] = useState(initialProject); const [busy, setBusy] = useState(false); const [root, setRoot] = useState(""); const [found, setFound] = useState<DiscoveredProject[]>([]); const [selected, setSelected] = useState<Set<string>>(new Set()); const [preview, setPreview] = useState<WebsiteChangePreview | null>(null); const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); try { await window.kcxDesktop!.addProject(draft); await refresh(); setDraft(initialProject); setMessage("Project registered"); } catch (error) { setMessage(error instanceof Error ? error.message : "Project registration failed"); } finally { setBusy(false); } }; const scan = async () => { if (!root) return; setBusy(true); try { const candidates = await window.kcxDesktop!.scanProjects(root); setFound(candidates); setSelected(new Set()); setPreview(null); setMessage(`${candidates.length} project candidates found`); } finally { setBusy(false); } }; const websiteChange = (candidates: DiscoveredProject[]): WebsiteChangeRequest => ({ additions: candidates.map((candidate) => ({ name: candidate.name, slug: candidate.slug, folder: candidate.folder, description: `Discovered from ${candidate.markers.join(", ")}`, category: "Discovered project", source: "scan" as const })), removalSlugs: [] }); const showPreview = async (candidates: DiscoveredProject[]) => { const result = await window.kcxDesktop!.previewWebsiteChange(websiteChange(candidates)); setPreview(result); setMessage("Website change preview ready for review"); };
  return <div className="desktop-panel-grid"><div className="desktop-task-grid"><form onSubmit={submit} className="desktop-card desktop-form desktop-task-card"><h3>Register project details</h3><p>Use a real local folder you trust. Missing folders are shown clearly and are never scanned automatically.</p><label>Name<input required value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label><label>Website identifier<input required pattern="[a-z0-9]+(-[a-z0-9]+)*" value={draft.slug} onChange={e => setDraft({ ...draft, slug: e.target.value })} /><small>Lowercase words separated by hyphens.</small></label><label>Trusted folder<input required value={draft.folder} onChange={e => setDraft({ ...draft, folder: e.target.value })} /></label><label>Description<textarea value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label><button className="desktop-action" disabled={busy}>{busy ? "Registering…" : "Register project"}</button></form><Panel title="Find projects in a folder"><p>Choose a folder, scan its subfolders, then decide which discovered projects deserve a website preview.</p><button className="desktop-action desktop-action-secondary" disabled={busy} onClick={async () => { const selectedRoot = await window.kcxDesktop!.chooseProjectScanRoot(); if (selectedRoot) { setRoot(selectedRoot); setFound([]); setPreview(null); setMessage("Scan folder selected"); } }}>Choose folder to scan</button><small className="desktop-path">{root || "No scan folder selected"}</small><button className="desktop-action" disabled={busy || !root} onClick={scan}>Scan subfolders</button>{found.length > 0 && <div className="desktop-choice-grid">{found.map(candidate => <label className="desktop-choice-card" key={candidate.folder}><input type="checkbox" checked={selected.has(candidate.folder)} onChange={() => setSelected(previous => { const next = new Set(previous); next.has(candidate.folder) ? next.delete(candidate.folder) : next.add(candidate.folder); return next; })} /><span><strong>{candidate.name}</strong><small>{candidate.markers.join(", ")}</small></span><button type="button" className="desktop-link" onClick={() => setDraft({ ...initialProject, name: candidate.name, slug: candidate.slug, folder: candidate.folder })}>Use details</button></label>)}</div>}{found.length > 0 && <div className="desktop-action-row"><button className="desktop-action desktop-action-secondary" onClick={() => void showPreview(found)}>Preview all</button><button className="desktop-action" disabled={selected.size === 0} onClick={() => void showPreview(found.filter(candidate => selected.has(candidate.folder)))}>Preview selected</button></div>}</Panel></div><Panel title="Website change preview" tone="accent">{preview ? <><p>Add: {preview.additions.map(product => product.name).join(", ") || "nothing"}</p><p>Remove: {preview.removals.map(product => product.name).join(", ") || "nothing"}</p>{preview.warnings.map(warning => <p className="desktop-warning" key={warning}>{warning}</p>)}<button className="desktop-action" disabled={!preview.canApply} onClick={async () => { const change: WebsiteChangeRequest = { additions: preview.additions.map(({ addedAt, ...product }) => product), removalSlugs: preview.removals.map(product => product.slug) }; const result = await window.kcxDesktop!.applyWebsiteChange(change); setMessage(result.message); if (result.ok) { setPreview(null); setSelected(new Set()); } }}>Apply reviewed website changes</button></> : <p>Nothing changes until you select discovered projects and review a preview.</p>}</Panel><Panel title="Registered projects">{projects.length ? <div className="desktop-project-grid">{projects.map(project => <article className="desktop-project-card" key={project.id}><strong>{project.name}</strong><Status tone={project.folderStatus === "available" ? "good" : "warning"}>{project.folderStatus === "available" ? "Folder available" : "Folder missing"}</Status><small className="desktop-path">{project.folder}</small></article>)}</div> : <p>No projects yet. Register a trusted local folder above to begin.</p>}</Panel></div>; }

function Website({ setMessage }: { setMessage: (value: string) => void }) { const [result, setResult] = useState(""); return <><PageIntro eyebrow="Website" title="Build the public site locally">Build checks the current website bundle. It does not publish, deploy, or change the live site.</PageIntro><Panel title="Local website build" tone="accent"><p>Use this before previewing or preparing a manual deployment.</p><button className="desktop-action" onClick={async () => { setResult("Building locally…"); const r = await window.kcxDesktop!.buildWebsite(); setResult(r.message); setMessage(r.message); }}>Build website locally</button>{result && <pre className="desktop-result">{result}</pre>}</Panel></>; }
function Preview({ setMessage }: { setMessage: (value: string) => void }) { const [status, setStatus] = useState<PreviewStatus | null>(null); const refresh = async () => setStatus(await window.kcxDesktop!.getPreviewStatus()); useEffect(() => { void refresh(); }, []); return <><PageIntro eyebrow="Website" title="Preview before any deployment">Start a local-only website preview to inspect the current build in your browser. It never makes the site public.</PageIntro><Panel title="Local preview" tone="accent"><Status tone={status?.running ? "good" : "neutral"}>{status?.running ? "Preview running" : "Preview stopped"}</Status><p>{status?.running ? `Available locally at ${status.url}` : "Start the preview, then open the local address shown here."}</p><button className="desktop-action" onClick={async () => { const r = status?.running ? await window.kcxDesktop!.stopWebsitePreview() : await window.kcxDesktop!.startWebsitePreview(); setStatus(r); setMessage(r.running ? "Website preview started" : "Website preview stopped"); }}>{status?.running ? "Stop local preview" : "Start local preview"}</button>{status && <pre className="desktop-result">{[...status.stdout, ...status.stderr].join("\n") || "No preview output yet."}</pre>}</Panel></>; }
function Deployment({ setMessage }: { setMessage: (value: string) => void }) {
  const [state, setState] = useState<DeploymentReadiness | null>(null);
  const [progress, setProgress] = useState<DeploymentProgress | null>(null);
  const [result, setResult] = useState<DeploymentResult | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      const readiness = await window.kcxDesktop!.getDeploymentReadiness();
      setState(readiness);
      setMessage(readiness.deployAllowed ? "Production deployment is ready" : "Deployment readiness needs attention");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Deployment readiness check failed");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const unsubscribe = window.kcxDesktop!.onDeploymentProgress((nextProgress) => {
      setProgress(nextProgress);
    });
    return unsubscribe;
  }, []);

  const deploy = async () => {
    setBusy(true);
    setResult(null);
    setProgress({
      stage: "checking",
      progress: 0,
      message: "Preparing production deployment confirmation.",
    });

    try {
      const deploymentResult = await window.kcxDesktop!.deployWebsite();
      setResult(deploymentResult);
      setMessage(deploymentResult.message);
      setState(await window.kcxDesktop!.getDeploymentReadiness());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Production deployment failed";
      setMessage(message);
      setProgress({ stage: "failed", progress: 100, message });
    } finally {
      setBusy(false);
    }
  };

  return <>
    <PageIntro eyebrow="Deployment" title="Deploy KCx Labs to production">
      Verify the production target, website build, Vercel authentication, project identity, and published release files before updating the live website. Deployment always requires a native confirmation.
    </PageIntro>

    <div className="desktop-panel-grid">
      <Panel title="Production readiness" tone="accent">
        <div className="desktop-action-row">
          <button className="desktop-action desktop-action-secondary" disabled={busy} onClick={() => void refresh()}>
            {busy ? "Checking…" : "Check readiness"}
          </button>
          <button className="desktop-action" disabled={busy || !state?.deployAllowed} onClick={() => void deploy()}>
            {busy ? "Working…" : "Deploy kcxlabs.org"}
          </button>
        </div>

        {!state ? <p>Check readiness before enabling production deployment.</p> : <>
          <Status tone={state.deployAllowed ? "good" : "warning"}>
            {state.deployAllowed ? "Production readiness READY" : "Production readiness BLOCKED"}
          </Status>

          <dl className="desktop-status-list">
            <div><dt>Target</dt><dd>{state.productionUrl}</dd></div>
            <div><dt>Vercel project</dt><dd>{state.projectResolved ? (state.projectName + " — verified") : (state.projectName || "Not resolved")}</dd></div>
            <div><dt>Project ID</dt><dd>{state.projectId || "Not resolved"}</dd></div>
            <div><dt>Website build</dt><dd>{state.websiteBuildReady ? "PASS" : "FAIL"}</dd></div>
            <div><dt>Vercel CLI</dt><dd>{state.vercelCliAvailable ? (state.vercelVersion ? ("PASS — " + state.vercelVersion) : "PASS") : "FAIL"}</dd></div>
            <div><dt>Authentication</dt><dd>{state.authenticated ? ("PASS" + (state.account ? " — " + state.account : "")) : "FAIL"}</dd></div>
            <div><dt>Team</dt><dd>{state.team || "Not resolved"}</dd></div>
            <div><dt>Published releases</dt><dd>{state.publishedReleaseFilesReady ? ("PASS — " + state.publishedReleaseCount) : ("FAIL — " + state.publishedReleaseCount)}</dd></div>
            <div><dt>Current branch</dt><dd>{state.branch}</dd></div>
            <div><dt>Uncommitted changes</dt><dd>{state.gitStatus.join(", ") || "None"}</dd></div>
          </dl>

          {state.errors.length > 0 && <div className="desktop-result">
            {state.errors.map((error) => <p key={error}>{error}</p>)}
          </div>}
        </>}
      </Panel>

      <Panel title="Deployment progress">
        {progress ? <>
          <Status tone={progress.stage === "complete" ? "good" : progress.stage === "failed" ? "warning" : "neutral"}>
            {progress.stage}
          </Status>
          <p>{progress.progress}% — {progress.message}</p>
          <progress value={progress.progress} max={100} style={{ width: "100%" }} />
          {progress.output && <pre className="desktop-result">{progress.output}</pre>}
        </> : <p>No production deployment is running.</p>}

        {result && <div className="desktop-result">
          <strong>{result.ok ? "Production deployment completed" : "Deployment did not complete"}</strong>
          <p>{result.message}</p>
          <p>Target: {result.productionUrl}</p>
          <p>Project: {result.projectName}</p>
          {result.deploymentUrl && <p>Deployment: {result.deploymentUrl}</p>}
        </div>}
      </Panel>
    </div>
  </>;
}

function Theme({ projects, setMessage }: { projects: CatalogProject[]; setMessage: (value: string) => void }) { const [id, setId] = useState(""); const [scan, setScan] = useState<ThemeScan | null>(null); return <><PageIntro eyebrow="Theme" title="Synchronize the KCx theme safely">Compare a registered project with the KCx theme, then copy files only after you review the result. Existing files are backed up first.</PageIntro><Panel title="Theme synchronization"><label>Registered project<select value={id} onChange={e => setId(e.target.value)}><option value="">Select a project</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><div className="desktop-action-row"><button className="desktop-action desktop-action-secondary" disabled={!id} onClick={async () => { const r = await window.kcxDesktop!.scanTheme(id); setScan(r); setMessage("Theme comparison complete"); }}>Compare theme files</button><button className="desktop-action" disabled={!scan?.ready} onClick={async () => { if (!window.confirm("Copy the KCx theme files to this project? Existing files will be backed up first.")) return; const r = await window.kcxDesktop!.syncTheme(id); setMessage(r.message); setScan(await window.kcxDesktop!.scanTheme(id)); }}>Copy theme with backup</button></div>{scan ? <div className="desktop-choice-grid">{scan.files.map(file => <article className="desktop-choice-card" key={file.destination}><strong>{file.destination}</strong><Status tone={file.status === "current" ? "good" : "warning"}>{file.status}</Status></article>)}</div> : <p>Select a project and compare its theme files first.</p>}</Panel></>; }
function Log({ releaseOnly, setMessage }: { releaseOnly: boolean; setMessage: (value: string) => void }) { const [entries, setEntries] = useState<ActivityEntry[]>([]); const refresh = async () => { const all = await window.kcxDesktop!.getActivity(); setEntries(releaseOnly ? all.filter(e => e.action.toLowerCase().includes("release")) : all); setMessage("Activity refreshed"); }; useEffect(() => { void refresh(); }, []); return <><PageIntro eyebrow="History" title={releaseOnly ? "Release history" : "Recent activity"}>{releaseOnly ? "Review local release actions recorded by this desktop app." : "Review recent desktop actions. This is an activity record, not live cloud monitoring."}</PageIntro><Panel title={releaseOnly ? "Recorded releases" : "Recorded activity"}><button className="desktop-action desktop-action-secondary" onClick={refresh}>Refresh activity</button>{entries.length ? <div className="desktop-activity-list">{entries.map(e => <article key={e.id}><Status tone={e.level === "error" ? "warning" : e.level === "info" ? "good" : "neutral"}>{e.level}</Status><div><strong>{e.action}</strong><p>{e.detail}</p><small>{e.at}</small></div></article>)}</div> : <p>{releaseOnly ? "No local release actions have been recorded." : "No local activity has been recorded yet."}</p>}</Panel></>; }
function SettingsPage() { return <><PageIntro eyebrow="Settings" title="Local desktop settings">KCx Labs keeps these app settings locally on this computer. Website deployment and publication are always separate, explicit actions.</PageIntro><div className="desktop-summary-grid"><Panel title="Local storage"><p>Project catalog data, activity history, and preview state are stored in the desktop app’s local data folder.</p><Status>Local only</Status></Panel><Panel title="Media access"><p>Media Center uses a paired device credential. Storage credentials are never exposed to the desktop screen.</p><Status>Paired in Media Center</Status></Panel><Panel title="Deployment"><p>This desktop app can build and preview. It does not automatically deploy a website.</p><Status tone="warning">Manual action required</Status></Panel></div></>; }
function Guide({ navigate }: { navigate: (page: PageName) => void }) {
  const [open, setOpen] = useState("Getting started");
  const sections: Array<[string, ReactNode]> = [
    [
      "Getting started",
      <>
        <p>KCx Labs Desktop is the local build, packaging, publishing, website, and deployment workspace for KCx projects. Start with a trusted local project, inspect what the app can do for it, then move through only the steps that project supports.</p>
        <ol className="guide-steps">
          <li>Register project -&gt; inspect capabilities -&gt; prepare missing setup when available.</li>
          <li>Build -&gt; package -&gt; verify -&gt; stage an artifact.</li>
          <li>Prepare release -&gt; publish release -&gt; update website metadata.</li>
          <li>Check deployment readiness -&gt; deploy only after explicit native confirmation -&gt; review the deployment result.</li>
        </ol>
        <p>Individual projects may support only some targets. Use the page status messages and target cards as the source of truth before running a build or publish step.</p>
      </>,
    ],
    [
      "Projects & capabilities",
      <>
        <p><button className="desktop-link" onClick={() => navigate("Projects")}>Projects</button> registers trusted local folders and can scan a chosen parent folder for project candidates. Registration stores the folder in this desktop workspace; it does not silently scan, modify, publish, or deploy the project.</p>
        <p>Capability inspection checks the selected project for supported distribution targets and setup requirements. READY means the target can be built now. NEEDS SETUP means KCx Labs can preview missing packaging setup for supported targets. UNSUPPORTED means the current implementation does not know how to build that target for the selected project.</p>
        <p>BUILT, STAGED, PUBLISHED, and DEPLOYED describe later workflow milestones: a command completed, an artifact was prepared locally, a release was copied into the public release area, or website/release content completed the production deployment workflow.</p>
      </>,
    ],
    [
      "Build & package",
      <>
        <p><button className="desktop-link" onClick={() => navigate("Artifacts")}>Artifacts</button> supports Web, EXE, Windows installer, APK, ZIP, and Source targets when the selected project exposes the required scripts or platform files. The target cards show whether each target is ready, needs setup, or is unsupported.</p>
        <p>Preview shows the working directory, command, and expected output before you build. Preview setup shows proposed project changes for configurable targets; applying setup is separate and approval-gated where implemented.</p>
        <p>Builds show live progress and output. ZIP and Source archives are created in the local staging area. EXE, installer, and APK outputs are collected after the project build and staged for release preparation.</p>
      </>,
    ],
    [
      "Artifacts & staging",
      <>
        <p>STAGED means KCx Labs prepared a local artifact for the workflow. A staged artifact is not yet a public release and does not update production.</p>
        <p>For the same project, target, and version, KCx Labs replaces the newest successful staged copy instead of intentionally accumulating duplicate successful artifacts. Different versions and different targets stay distinct.</p>
        <p>Use Prepare Release from the artifact result or choose a ZIP, EXE, MSI, or APK manually in Release Publisher when you are ready to validate release metadata.</p>
      </>,
    ],
    [
      "Release Publisher",
      <>
        <p><button className="desktop-link" onClick={() => navigate("Release Publisher")}>Release Publisher</button> validates a selected project, artifact, version, title, and stable release channel before creating a local release. The preview reports file size, SHA-256, warnings, errors, and the planned operations.</p>
        <p>Publishing requires explicit confirmation in the workflow. It copies the validated artifact into the public release area, creates a backup when replacing an existing file, and records release/catalog metadata.</p>
        <p>PUBLISHING A RELEASE DOES NOT DEPLOY THE WEBSITE. Published releases feed the public Downloads page/catalog; production deployment remains a separate manual action.</p>
      </>,
    ],
    [
      "Downloads",
      <>
        <p>Published software releases can appear on the KCx Labs public Downloads page at https://kcxlabs.org/downloads. The system is generic across registered projects, not limited to one application.</p>
        <p>Entries can show release title, version, channel, artifact type, file size, SHA-256, publication time, and a Download action. Windows installers, APKs, ZIPs, and other supported artifacts can be published when the project target and release validation allow it.</p>
        <p>Unsigned or new Windows installers may trigger browser or Windows reputation warnings. Do not disable security protections; code signing and reputation are separate distribution concerns.</p>
      </>,
    ],
    [
      "Website & preview",
      <>
        <p><button className="desktop-link" onClick={() => navigate("Website")}>Website</button> runs the local production build for the current website bundle. It does not publish, deploy, or change the live site.</p>
        <p><button className="desktop-link" onClick={() => navigate("Website Preview")}>Website Preview</button> starts and stops a local-only Vite preview and shows the local address and output. Preview is for inspection on this machine and never modifies production.</p>
        <p>Public downloads integration comes from the local publishing catalog and release files. Build and preview let you inspect that state before making any deployment decision.</p>
      </>,
    ],
    [
      "Production deployment",
      <>
        <p><button className="desktop-link" onClick={() => navigate("Deployment")}>Deployment</button> can deploy production, but only after readiness passes and you explicitly approve a native Electron confirmation. Cancel means nothing is deployed.</p>
        <ol className="guide-steps">
          <li>Check readiness verifies the production target, website build, Vercel CLI, authentication, exact Vercel project identity, and published release files.</li>
          <li>The verified production target is https://kcxlabs.org.</li>
          <li>The verified Vercel project is kcxlabs-site, project ID prj_48w3bet6EUcLRHsH2FykHduTNFmT.</li>
          <li>Deploy is enabled only when readiness passes. You must choose Deploy production in the native confirmation.</li>
          <li>Progress and the deployment URL are displayed after Vercel completes.</li>
        </ol>
        <p>The desktop app verifies successful Vercel completion. It does not claim a separate live HTTP site check unless that is added to the implementation.</p>
      </>,
    ],
    [
      "Media Center",
      <>
        <p><button className="desktop-link" onClick={() => navigate("Media Center")}>Media Center</button> publishes and manages KCx Clips through a paired device credential. The owner password is used only for pairing and is not stored. Server and storage credentials are not exposed to the renderer.</p>
        <p>Upload Clip computes SHA-256 and file size locally, checks for duplicates, receives upload authorization, uploads directly to a short-lived storage URL, finalizes the clip, and shows a success verification screen with the share page when available. Every desktop upload is public/shareable by product design.</p>
        <p>Online Media loads existing server-backed clips separately from the local upload queue. Reload fetches the latest list. Remove from Website confirms first, removes the card after server success, reconciles with the server list, and never deletes your local recording.</p>
        <p>Recovery lists uploads whose storage object finished but finalization did not. Retry finalization only applies to those records; failures before storage upload must be uploaded again from Upload Clip.</p>
      </>,
    ],
    [
      "Patch Import",
      <>
        <p><button className="desktop-link" onClick={() => navigate("Patch Import")}>Patch Import</button> is a separate patch workflow. Choose a registered project and a .patch or .diff file, preview the import, then import only after the preview is valid.</p>
        <p>Patch files are stored separately from release artifacts. Existing destination files are backed up before replacement. Invalid file types, missing projects, and unreadable files block import until corrected.</p>
      </>,
    ],
    [
      "Theme Sync",
      <>
        <p><button className="desktop-link" onClick={() => navigate("Theme Sync")}>Theme Sync</button> compares a registered project against the KCx theme files. Each file is shown as current, outdated, or missing.</p>
        <p>Copy theme requires confirmation and creates a timestamped backup for existing files before overwriting. Destination paths are checked so theme files stay inside the selected project folder.</p>
      </>,
    ],
    [
      "Activity & Release History",
      <>
        <p><button className="desktop-link" onClick={() => navigate("Activity")}>Activity</button> shows recent actions recorded locally by this desktop app. <button className="desktop-link" onClick={() => navigate("Release History")}>Release History</button> filters that local record to release-related actions.</p>
        <p>These pages are not cloud audit logs or live production monitors. Use Refresh to reload the local activity file.</p>
      </>,
    ],
    [
      "Neon Storage",
      <>
        <p><button className="desktop-link" onClick={() => navigate("Neon Storage")}>Neon Storage</button> reads storage usage from the fixed <strong>neondb</strong> database through the Electron main process. It shows database size, the 512 MB free-tier limit, the 400 MB cleanup threshold, remaining space, and the largest tables.</p>
        <p>Analyze storage for read-only current values. Preview safe cleanup is also read-only. Run safe cleanup is disabled unless a predefined safe candidate exists, and any future candidate will be checked against the protected tables: owners, schema_migrations, snapcal_calendars, snapcal_events, and media.</p>
        <p>Auto-clean is off by default and is stored only in this desktop app's local user data. Enabling it allows the same predefined policy to be checked at startup and after relevant operations; it never sends credentials to the renderer or accepts SQL/table names from the UI.</p>
        <p>If DATABASE_URL is missing, Neon is unreachable, the wrong database is selected, a query fails, or local settings cannot be saved, the page reports a safe error without exposing credentials. No safe cleanup available means no database writes occur. Related features: Media Center and local desktop Settings.</p>
      </>,
    ],
    [
      "Troubleshooting & safety",
      <>
        <p>If a project shows NEEDS SETUP, open the setup preview and review the proposed changes and warnings before applying anything. If a build or package step fails, read the build output and fix the project command or dependencies before retrying.</p>
        <p>If an artifact is missing, confirm the project produced one of the expected outputs and that the version/target staging area matches the current build. If release validation fails, correct the selected artifact, title, version, or readable file path before publishing.</p>
        <p>If website preview fails, run a local website build and review preview output. If deployment readiness fails, resolve the listed Vercel CLI, authentication, project identity, build, or published release file issue before trying production deployment.</p>
        <p>Production and destructive actions use explicit confirmation where implemented. Publishing does not deploy as a side effect, setup changes should be previewed first, backups are created where implemented, and existing project changes are not silently discarded.</p>
      </>,
    ],
  ];

  return <><PageIntro eyebrow="Offline help" title="Help & Getting Started">This guide ships in the desktop app and describes only the features available here today. Use it whenever you need a reminder or recovery path.</PageIntro><section className="desktop-card desktop-guide-card">{sections.map(([title, body]) => <section className="guide-section" key={title}><button className="guide-section-header" aria-expanded={open === title} onClick={() => setOpen(open === title ? "" : title)}>{title}<span>{open === title ? "-" : "+"}</span></button>{open === title && <div className="guide-section-body guide-content">{body}</div>}</section>)}</section></>;
}
