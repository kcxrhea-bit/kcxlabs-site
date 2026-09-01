import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { desktopIpcChannels } from "./ipc";
import type { DesktopStatus, NewCatalogProject, ReleaseDraft, ReleaseStorageProbeResult, ReleaseStorageTestResult } from "../src/shared/desktop";
import { createCatalogService } from "./catalog-service";
import { previewRelease } from "./release-planner";
import { PlatformService } from "./platform-service";
import { scanForProjects } from "./project-discovery";
import { MediaService } from "./media-service";
import { DistributionService } from "./distribution-service";
import type { DistributionTarget } from "../src/shared/desktop";
import { NeonStorageService } from "./neon-storage-service";
import { listArtifacts, recoverStagedArtifact, saveArtifact, stageArtifact, verifyArtifact } from "./artifact-registry";
import { artifactRemoteKey, publishArtifact, reconcilePublishedArtifact } from "./artifact-publisher";
import { createReleaseArtifactProviderFromConfig } from "./r2-release-provider";
import { ReleaseStorageSettingsService } from "./release-storage-settings";
import { currentReleaseStorageFingerprint, getArtifactPublishReadiness } from "./release-certification";

let mainWindow: BrowserWindow | null = null;
let startupLogPath: string | null = null;
const publishingArtifacts = new Set<string>();
let providerProbeActive = false;
function startupLog(message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`;
  const logPath = startupLogPath ?? join(process.env.TEMP || ".", "kcx-labs-startup.log");
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, line, "utf8");
  } catch {
    // Startup diagnostics must never prevent the application from starting.
  }
}
process.on("uncaughtException", (error) => startupLog(`uncaughtException ${error instanceof Error ? error.stack || error.message : String(error)}`));
process.on("unhandledRejection", (reason) => startupLog(`unhandledRejection ${reason instanceof Error ? reason.stack || reason.message : String(reason)}`));
startupLog(`process-start execPath=${process.execPath} packaged=${app.isPackaged} resourcesPath=${process.resourcesPath} dirname=${__dirname}`);

function createWindow(): void {
  const preload = join(__dirname, "preload.cjs");
  const developmentServerUrl = process.env.VITE_DEV_SERVER_URL;
  const websiteEntry = join(app.getAppPath(), "dist", "index.html");
  startupLog(`createWindow preload=${preload} preloadExists=${existsSync(preload)} renderer=${websiteEntry} rendererExists=${existsSync(websiteEntry)} devServer=${Boolean(developmentServerUrl)}`);

  mainWindow = new BrowserWindow({
    minWidth: 1120,
    minHeight: 720,
    width: 1440,
    height: 920,
    backgroundColor: "#050506",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  if (developmentServerUrl) {
    void mainWindow.loadURL(developmentServerUrl).then(() => startupLog("renderer loadURL succeeded"), (error) => startupLog(`renderer loadURL failed ${error instanceof Error ? error.stack || error.message : String(error)}`));
  } else {
    if (!existsSync(websiteEntry)) {
      throw new Error("The website bundle is missing. Run npm run build before launching the packaged app.");
    }
    void mainWindow.loadFile(websiteEntry).then(() => startupLog("renderer loadFile succeeded"), (error) => startupLog(`renderer loadFile failed ${error instanceof Error ? error.stack || error.message : String(error)}`));
  }
}

function getDesktopStatus(): DesktopStatus {
  return {
    applicationVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    platform: process.platform,
  };
}

app.whenReady().then(() => {
  startupLogPath = join(app.getPath("userData"), "logs", "startup.log");
  startupLog(`app.whenReady userData=${app.getPath("userData")} appPath=${app.getAppPath()}`);
  ipcMain.handle(desktopIpcChannels.getStatus, getDesktopStatus);
  const catalog = createCatalogService(app.getPath("userData"));
  const artifactRoot = join(app.getPath("userData"), "artifact-registry");
  const releaseSettings = new ReleaseStorageSettingsService(app.getPath("userData"));
  const artifactRecord = async (id: string) => (await listArtifacts(artifactRoot)).find((record) => record.id === id);
  ipcMain.handle(desktopIpcChannels.listArtifacts, async () => { const records = await listArtifacts(artifactRoot); const settings = await releaseSettings.get(); const secrets = await releaseSettings.getSecrets(); const fingerprint = settings.configured ? currentReleaseStorageFingerprint({ endpoint: settings.endpoint, bucket: settings.bucket, region: settings.region, publicBaseUrl: settings.publicBaseUrl }, secrets) : ""; return records.map((record) => ({ ...record, reconciliationAvailable: record.publicationStatus === "PUBLISHED" && Boolean(record.remoteObjectKey) && (() => { try { return artifactRemoteKey(record) !== record.remoteObjectKey; } catch { return false; } })(), publicationReadiness: getArtifactPublishReadiness(record, settings, fingerprint) })); });
  listArtifacts(artifactRoot).then((records) => startupLog(`artifact-registry root=${artifactRoot} count=${records.length} ids=${records.map((record) => `${record.id}:${record.validationStatus}`).join(",")}`));
  ipcMain.handle(desktopIpcChannels.verifyArtifact, async (_event, id: string) => {
    const record = await artifactRecord(id); if (!record) throw new Error("Artifact record not found.");
    const verified = await verifyArtifact(record); await saveArtifact(verified, artifactRoot); return verified;
  });
  ipcMain.handle(desktopIpcChannels.recoverStagedArtifact, async (_event, id: string) => {
    const record = await artifactRecord(id); if (!record) throw new Error("Artifact record not found.");
    const recovered = await recoverStagedArtifact(record, app.getPath("userData")); await saveArtifact(recovered, artifactRoot); return recovered;
  });
  ipcMain.handle(desktopIpcChannels.stageArtifact, async (_event, id: string) => {
    const record = await artifactRecord(id); if (!record) throw new Error("Artifact record not found.");
    const staged = await stageArtifact(record, app.getPath("userData")); await saveArtifact(staged, artifactRoot); return staged;
  });
  ipcMain.handle(desktopIpcChannels.copyArtifactPath, async (_event, id: string) => { const record = await artifactRecord(id); if (!record) return { ok: false, message: "Artifact record not found." }; clipboard.writeText(record.stagedPath ?? record.sourcePath); return { ok: true, message: "Artifact path copied." }; });
  ipcMain.handle(desktopIpcChannels.openArtifactFolder, async (_event, id: string) => { const record = await artifactRecord(id); if (!record) return { ok: false, message: "Artifact record not found." }; const path = record.stagedPath ?? record.sourcePath; const error = await shell.openPath(dirname(path)); return error ? { ok: false, message: error } : { ok: true, message: "Artifact folder opened." }; });
  ipcMain.handle(desktopIpcChannels.publishArtifact, async (_event, id: string) => { if (publishingArtifacts.has(id)) throw new Error("ALREADY_PUBLISHING"); publishingArtifacts.add(id); try { const record = await artifactRecord(id); if (!record) throw new Error("Artifact record not found."); const settings = await releaseSettings.get(); const secrets = await releaseSettings.getSecrets(); const fingerprint = settings.configured ? currentReleaseStorageFingerprint({ endpoint: settings.endpoint, bucket: settings.bucket, region: settings.region, publicBaseUrl: settings.publicBaseUrl }, secrets) : ""; const readiness = getArtifactPublishReadiness(record, settings, fingerprint); if (!readiness.ready) throw new Error(`Publication rejected: ${readiness.reason}.`); const provider = createReleaseArtifactProviderFromConfig(settings.configured ? { endpoint: settings.endpoint, bucket: settings.bucket, region: settings.region, publicBaseUrl: settings.publicBaseUrl || null, ...secrets } : null, secrets); const published = await publishArtifact(record, provider); await saveArtifact(published, artifactRoot); await platform.record("Artifact published", `${published.projectName} ${published.version ?? "unversioned"}: ${published.target} ${published.platform ?? "inferred platform"} ${published.architecture} ${published.filename} -> ${published.publicationDestination ?? published.remoteObjectKey ?? "published"}`); return published; } finally { publishingArtifacts.delete(id); } });
  ipcMain.handle(desktopIpcChannels.reconcilePublishedArtifact, async (_event, id: string) => { const record = await artifactRecord(id); if (!record) throw new Error("Artifact record not found."); const settings = await releaseSettings.get(); const secrets = await releaseSettings.getSecrets(); const provider = createReleaseArtifactProviderFromConfig(settings.configured ? { endpoint: settings.endpoint, bucket: settings.bucket, region: settings.region, publicBaseUrl: settings.publicBaseUrl || null, ...secrets } : null, secrets); if (!provider) throw new Error("Release storage is not configured."); const reconciled = await reconcilePublishedArtifact(record, provider, settings.publicBaseUrl); await saveArtifact(reconciled, artifactRoot); await platform.record("Published path reconciled", `${reconciled.projectName} ${reconciled.version ?? "unversioned"}: ${reconciled.remoteObjectKey}`); return reconciled; });
  ipcMain.handle(desktopIpcChannels.getReleaseStorageSettings, () => releaseSettings.get());
  ipcMain.handle(desktopIpcChannels.updateReleaseStorageSettings, (_event, input) => releaseSettings.update(input));
  const safeStorageError = (error: unknown) => ({ code: "PROVIDER_ERROR", message: error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, "[redacted-url]") : "Release storage operation failed." });
  ipcMain.handle(desktopIpcChannels.testReleaseStorage, async (): Promise<ReleaseStorageTestResult> => {
    const settings = await releaseSettings.get(); const base = { configured: settings.configured, reachable: false, authenticated: false, bucketAccessible: false, publicBaseConfigured: Boolean(settings.publicBaseUrl), success: false, message: "Release storage is not configured." };
    if (!settings.configured) return { ...base, errorCode: "NOT_CONFIGURED" };
    try { const secrets = await releaseSettings.getSecrets(); const provider = createReleaseArtifactProviderFromConfig({ endpoint: settings.endpoint, bucket: settings.bucket, region: settings.region, publicBaseUrl: settings.publicBaseUrl || null }, secrets); if (!provider) return { ...base, errorCode: "NOT_CONFIGURED" }; await provider.testConnection(); await releaseSettings.certify("connection"); return { ...base, reachable: true, authenticated: true, bucketAccessible: true, success: true, message: "Release storage connection succeeded." }; } catch (error) { const e = safeStorageError(error); return { ...base, errorCode: e.code, message: e.message }; }
  });
  ipcMain.handle(desktopIpcChannels.probeReleaseStorage, async (): Promise<ReleaseStorageProbeResult> => {
    if (providerProbeActive) return { configured: false, reachable: false, authenticated: false, bucketAccessible: false, publicBaseConfigured: false, success: false, publicDownload: "NOT_CONFIGURED", cleanup: "NOT_RUN", errorCode: "BUSY", message: "Provider probe is already running." };
    providerProbeActive = true;
    try {
    const settings = await releaseSettings.get(); const base = { configured: settings.configured, reachable: false, authenticated: false, bucketAccessible: false, publicBaseConfigured: Boolean(settings.publicBaseUrl), success: false, publicDownload: "NOT_CONFIGURED" as const, cleanup: "NOT_RUN" as const, message: "Release storage is not configured." };
    if (!settings.configured) return { ...base, errorCode: "NOT_CONFIGURED" };
    const secrets = await releaseSettings.getSecrets(); const provider = createReleaseArtifactProviderFromConfig({ endpoint: settings.endpoint, bucket: settings.bucket, region: settings.region, publicBaseUrl: settings.publicBaseUrl || null }, secrets); if (!provider) return { ...base, errorCode: "NOT_CONFIGURED" };
    const key = `releases/_kcx-provider-test/${randomUUID()}/probe.txt`; const dir = await mkdtemp(join(tmpdir(), "kcx-provider-probe-")); const path = join(dir, "probe.txt"); const content = `KCx provider probe ${randomUUID()}\n`; await writeFile(path, content, "utf8"); const bytes = Buffer.byteLength(content); const sha256 = createHash("sha256").update(content).digest("hex");
    try { const before = await provider.head(key); if (before.exists) throw new Error("Probe key collision."); const remote = await provider.upload({ key, path, contentType: "text/plain", sha256 }); if (remote.size !== bytes || remote.sha256?.toLowerCase() !== sha256) throw new Error("Probe remote verification failed."); let publicDownload: "PASS" | "FAIL" | "NOT_CONFIGURED" = "NOT_CONFIGURED"; if (settings.publicBaseUrl) { const response = await fetch(`${settings.publicBaseUrl.replace(/\/+$/, "")}/${key}`); const data = Buffer.from(await response.arrayBuffer()); publicDownload = response.ok && data.length === bytes && createHash("sha256").update(data).digest("hex") === sha256 ? "PASS" : "FAIL"; } await provider.delete(key); const after = await provider.head(key); const cleanup = after.exists ? "FAIL" : "PASS"; if (cleanup === "PASS") await releaseSettings.certify("probe"); return { ...base, reachable: true, authenticated: true, bucketAccessible: true, success: cleanup === "PASS" && publicDownload !== "FAIL", probeKey: key, publicDownload, cleanup, message: cleanup === "PASS" ? "Provider probe succeeded." : "Provider probe cleanup failed." }; } catch (error) { const e = safeStorageError(error); return { ...base, probeKey: key, errorCode: e.code, message: e.message }; } finally { await rm(dir, { recursive: true, force: true }); }
    } finally { providerProbeActive = false; }
  });
  const platform = new PlatformService(app.getAppPath(), app.getPath("userData"));
  const media = new MediaService(app.getPath("userData"));
  const distribution = new DistributionService(
    app.getAppPath(),
    app.getPath("userData"),
  );
  ipcMain.handle(desktopIpcChannels.listProjects, () => catalog.list());
  ipcMain.handle(desktopIpcChannels.addProject, (_event, input: NewCatalogProject) => catalog.add(input));
  ipcMain.handle(desktopIpcChannels.chooseProjectFolder, async () => {
    if (!mainWindow) return null;
    const selection = await dialog.showOpenDialog(mainWindow, { title: "Choose project folder", properties: ["openDirectory"] });
    return selection.canceled ? null : selection.filePaths[0];
  });
  ipcMain.handle(desktopIpcChannels.chooseProjectScanRoot, async () => {
    if (!mainWindow) return null;
    const selection = await dialog.showOpenDialog(mainWindow, { title: "Choose a folder to scan for projects", properties: ["openDirectory"] });
    return selection.canceled ? null : selection.filePaths[0];
  });
  ipcMain.handle(desktopIpcChannels.scanProjects, (_event, root: string) => scanForProjects(root));
  ipcMain.handle(desktopIpcChannels.getWebsiteProducts, () => platform.getWebsiteProducts());
  ipcMain.handle(desktopIpcChannels.previewWebsiteChange, (_event, change) => platform.previewWebsiteChange(change));
  ipcMain.handle(desktopIpcChannels.applyWebsiteChange, async (_event, change) => {
    const preview = await platform.previewWebsiteChange(change);
    if (!preview.canApply) return { ok: false, message: preview.warnings.join(" ") || "No changes to apply." };
    const confirmation = await dialog.showMessageBox(mainWindow!, { type: "warning", buttons: ["Cancel", "Approve website changes"], defaultId: 0, cancelId: 0, message: "Apply website changes?", detail: `${preview.additions.length} additions and ${preview.removals.length} removals will be applied. A backup will be created first.` });
    return confirmation.response === 1 ? platform.applyWebsiteChange(change) : { ok: false, message: "Website changes cancelled." };
  });
  ipcMain.handle(desktopIpcChannels.chooseArtifact, async () => {
    if (!mainWindow) return null;
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: "Choose release artifact",
      properties: ["openFile"],
      filters: [{ name: "Release artifacts", extensions: ["exe", "msi", "zip"] }, { name: "All files", extensions: ["*"] }],
    });
    return selection.canceled ? null : selection.filePaths[0];
  });
  ipcMain.handle(desktopIpcChannels.choosePatch, async () => {
    if (!mainWindow) return null;
    const selection = await dialog.showOpenDialog(mainWindow, { title: "Choose patch file", properties: ["openFile"], filters: [{ name: "Patch files", extensions: ["patch", "diff"] }] });
    return selection.canceled ? null : selection.filePaths[0];
  });
  ipcMain.handle(desktopIpcChannels.previewPatch, async (_event, id: string, path: string) => platform.previewPatch((await catalog.list()).find((project) => project.id === id), path));
  ipcMain.handle(desktopIpcChannels.importPatch, async (_event, id: string, path: string) => {
    const project = (await catalog.list()).find((candidate) => candidate.id === id);
    const preview = await platform.previewPatch(project, path);
    if (!preview.isValid) return { ok: false, message: preview.errors.join(" ") };
    const confirmation = await dialog.showMessageBox(mainWindow!, { type: "warning", buttons: ["Cancel", "Import patch"], defaultId: 0, cancelId: 0, message: `Import ${preview.fileName}?`, detail: "The patch is stored separately from release artifacts. An overwrite backup is created first." });
    return confirmation.response === 1 ? platform.importPatch(project, path) : { ok: false, message: "Patch import cancelled." };
  });
  ipcMain.handle(desktopIpcChannels.openProjectFolder, async (_event, id: string) => {
    const project = (await catalog.list()).find((candidate) => candidate.id === id);
    if (!project || project.folderStatus === "missing") return { ok: false, message: "Select a registered project with an available folder." };
    const result = await shell.openPath(project.folder); return result ? { ok: false, message: result } : { ok: true, message: "Project folder opened." };
  });
  ipcMain.handle(desktopIpcChannels.createProjectZip, async (_event, id: string) => platform.createProjectZip((await catalog.list()).find((project) => project.id === id)));
  ipcMain.handle(desktopIpcChannels.buildProjectExecutable, async (_event, id: string) => platform.buildProjectExecutable((await catalog.list()).find((project) => project.id === id)));

  ipcMain.handle(desktopIpcChannels.getDistributionCapabilities, async (_event, id: string) => {
    const project = (await catalog.list()).find((candidate) => candidate.id === id);
    return distribution.capabilities(project);
  });

  ipcMain.handle(
    desktopIpcChannels.previewDistribution,
    async (_event, id: string, target: DistributionTarget) => {
      const project = (await catalog.list()).find((candidate) => candidate.id === id);
      return distribution.preview(project, target);
    },
  );
  const neonStorage = new NeonStorageService(app.getPath("userData"), app.getAppPath());
  ipcMain.handle(desktopIpcChannels.getNeonStorageAnalysis, () => neonStorage.analysis());
  ipcMain.handle(desktopIpcChannels.previewNeonStorageCleanup, () => neonStorage.preview());
  ipcMain.handle(desktopIpcChannels.getNeonStorageSettings, () => neonStorage.getSettings());
  ipcMain.handle(desktopIpcChannels.setNeonStorageSettings, (_event, settings) => neonStorage.setSettings(settings));
  void neonStorage.getSettings().then(async (settings) => {
    if (!settings.autoClean) return;
    const preview = await neonStorage.preview();
    if (preview.canClean) await neonStorage.cleanup();
  }).catch(() => {
    // Startup auto-clean is best effort; the page reports actionable errors when opened.
  });
  ipcMain.handle(desktopIpcChannels.runNeonStorageCleanup, async () => {
    const preview = await neonStorage.preview();
    if (!preview.canClean) return neonStorage.cleanup();
    const confirmation = await dialog.showMessageBox({ type: "warning", buttons: ["Cancel", "Run safe cleanup"], defaultId: 0, cancelId: 0, title: "Clean Neon storage?", message: "Run the predefined safe Neon cleanup policy?", detail: "Only predefined safe operations will run. Protected KCx/SnapCal tables will not be deleted.", noLink: true });
    return confirmation.response === 1 ? neonStorage.cleanup() : { ok: false, message: "Cleanup cancelled. No database changes were made.", analysis: null, reclaimedBytes: 0, candidatesRun: [] };
  });

  ipcMain.handle(
    desktopIpcChannels.runDistribution,
    async (event, id: string, target: DistributionTarget) => {
      const project = (await catalog.list()).find((candidate) => candidate.id === id);

      return distribution.run(project, target, (progress) => {
        event.sender.send(desktopIpcChannels.distributionProgress, progress);
      });
    },
  );
  ipcMain.handle(
    desktopIpcChannels.previewDistributionSetup,
    async (_event, id: string, target: DistributionTarget) => {
      const project = (await catalog.list()).find(
        (candidate) => candidate.id === id,
      );
      return distribution.previewSetup(project, target);
    },
  );
  ipcMain.handle(
    desktopIpcChannels.applyDistributionSetup,
    async (_event, id: string, target: DistributionTarget) => {
      const project = (await catalog.list()).find(
        (candidate) => candidate.id === id,
      );

      if (!project || project.folderStatus === "missing") {
        return {
          ok: false,
          message: "Select a registered project with an available folder.",
          projectId: id,
          target,
          backupPath: null,
        };
      }

      const plan = await distribution.previewSetup(project, target);

      if (!plan.supported) {
        return {
          ok: false,
          message: plan.message,
          projectId: project.id,
          target,
          backupPath: null,
        };
      }

      const confirmation = await dialog.showMessageBox({
        type: "warning",
        buttons: ["Cancel", "Apply setup"],
        defaultId: 0,
        cancelId: 0,
        title: "Apply distribution setup?",
        message: `Configure ${project.name} for ${target}?`,
        detail:
          "KCx Labs will back up every file it modifies before changing the project. Existing scripts and metadata will be preserved.",
        noLink: true,
      });

      if (confirmation.response !== 1) {
        return {
          ok: false,
          message: "Distribution setup cancelled. No project files were modified.",
          projectId: project.id,
          target,
          backupPath: null,
        };
      }

      return distribution.applySetup(project, target);
    },
  );
  ipcMain.handle(
    desktopIpcChannels.getDistributionProjectStatus,
    async (_event, id: string) => {
      const project = (await catalog.list()).find(
        (candidate) => candidate.id === id,
      );
      return distribution.projectStatus(project);
    },
  );

  ipcMain.handle(
    desktopIpcChannels.runDistributionWorkflow,
    async (event, request: import("../src/shared/desktop").DistributionWorkflowRequest) => {
      const project = (await catalog.list()).find(
        (candidate) => candidate.id === request.projectId,
      );

      return distribution.workflow(project, request, (progress) => {
        event.sender.send(
          desktopIpcChannels.distributionProgress,
          progress,
        );
      });
    },
  );
  ipcMain.handle(desktopIpcChannels.previewRelease, async (_event, draft: ReleaseDraft) => {
    const project = (await catalog.list()).find((candidate) => candidate.id === draft.projectId);
    return previewRelease(draft, project);
  });
  ipcMain.handle(desktopIpcChannels.publishRelease, async (_event, draft: ReleaseDraft) => {
    const project = (await catalog.list()).find((candidate) => candidate.id === draft.projectId);
    const preview = await previewRelease(draft, project);
    if (!preview.isValid) return { ok: false, message: preview.errors.join(" ") };
    const confirmation = await dialog.showMessageBox(mainWindow!, { type: "warning", buttons: ["Cancel", "Publish release"], defaultId: 0, cancelId: 0, message: `Publish ${project?.name} ${draft.version}?`, detail: "This copies the artifact and updates website metadata. It does not deploy." });
    return confirmation.response === 1 ? platform.publishRelease(draft, project) : { ok: false, message: "Publishing cancelled." };
  });
  ipcMain.handle(desktopIpcChannels.getActivity, () => platform.getActivity());
  ipcMain.handle(
    desktopIpcChannels.getDeploymentReadiness,
    () => platform.deploymentReadiness(),
  );

  ipcMain.handle(
    desktopIpcChannels.deployWebsite,
    async (event) => {
      const readiness = await platform.deploymentReadiness();

      if (!readiness.deployAllowed) {
        return {
          ok: false,
          message:
            readiness.errors.join(" ") ||
            "Production deployment is not ready.",
          projectName: readiness.projectName ?? "kcxlabs-site",
          productionUrl: readiness.productionUrl,
          deploymentUrl: null,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };
      }

      if (!mainWindow) {
        return {
          ok: false,
          message: "The KCx Labs window is not available.",
          projectName: readiness.projectName ?? "kcxlabs-site",
          productionUrl: readiness.productionUrl,
          deploymentUrl: null,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };
      }

      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        buttons: ["Cancel", "Deploy production"],
        defaultId: 0,
        cancelId: 0,
        title: "Deploy KCx Labs to production?",
        message: "Deploy KCx Labs to production?",
        detail:
          `Target: ${readiness.productionUrl}\n` +
          `Project: ${readiness.projectName ?? "kcxlabs-site"}\n\n` +
          "This updates the live production website.",
        noLink: true,
      });

      if (confirmation.response !== 1) {
        return {
          ok: false,
          message: "Production deployment cancelled. Nothing was deployed.",
          projectName: readiness.projectName ?? "kcxlabs-site",
          productionUrl: readiness.productionUrl,
          deploymentUrl: null,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };
      }

      return platform.deployWebsite((progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(
            desktopIpcChannels.deploymentProgress,
            progress,
          );
        }
      });
    },
  );

  ipcMain.handle(
    desktopIpcChannels.buildWebsite,
    () => platform.buildWebsite(),
  );
  ipcMain.handle(desktopIpcChannels.getPreviewStatus, () => platform.getPreviewStatus());
  ipcMain.handle(desktopIpcChannels.startWebsitePreview, () => platform.startPreview());
  ipcMain.handle(desktopIpcChannels.stopWebsitePreview, () => platform.stopPreview());
  ipcMain.handle(desktopIpcChannels.scanTheme, async (_event, id: string) => platform.scanTheme((await catalog.list()).find((project) => project.id === id)));
  ipcMain.handle(desktopIpcChannels.syncTheme, async (_event, id: string) => platform.syncTheme((await catalog.list()).find((project) => project.id === id)));


  // ─── Media Center ──────────────────────────────────────────────────────────

  ipcMain.handle(desktopIpcChannels.chooseMediaFile, async () => {
    if (!mainWindow) return null;

    const selection = await dialog.showOpenDialog(mainWindow, {
      title: "Choose a video file",
      properties: ["openFile"],
      filters: [
        {
          name: "Video files",
          extensions: ["mp4", "mov", "mkv", "webm", "avi", "m4v"],
        },
        { name: "All files", extensions: ["*"] },
      ],
    });

    return selection.canceled ? null : selection.filePaths[0];
  });

  ipcMain.handle(
    desktopIpcChannels.listPendingMediaUploads,
    () => media.listPending(),
  );

  ipcMain.handle(
    desktopIpcChannels.listUploadedMedia,
    () => media.listUploadedMedia(),
  );

  ipcMain.handle(
    desktopIpcChannels.removeUploadedMedia,
    (_event, id: string) => media.removeUploadedMedia(id),
  );

  ipcMain.handle(
    desktopIpcChannels.startMediaUpload,
    (_event, filePath: string) =>
      media.upload(filePath, (record) =>
        mainWindow?.webContents.send(
          desktopIpcChannels.mediaProgress,
          record,
        ),
      ),
  );

  ipcMain.handle(
    desktopIpcChannels.retryMediaFinalize,
    (_event, id: string) =>
      media.retryFinalize(id, (record) =>
        mainWindow?.webContents.send(
          desktopIpcChannels.mediaProgress,
          record,
        ),
      ),
  );

  ipcMain.handle(
    desktopIpcChannels.getDevicePairingStatus,
    () => media.getPairingStatus(),
  );

  ipcMain.handle(
    desktopIpcChannels.pairDevice,
    (_event, email: string, password: string, deviceName: string) =>
      media.pair(email, password, deviceName),
  );

  ipcMain.handle(
    desktopIpcChannels.unpairDevice,
    () => media.unpair(),
  );

  // Opens a clip's share URL in the OS default browser. Scoped to the public site's own
  // origin — never a general-purpose external-URL opener — so a compromised renderer cannot
  // repurpose this channel to launch an arbitrary link.
  ipcMain.handle(desktopIpcChannels.openMediaShareUrl, async (_event, url: string) => {
    try {
      const parsed = new URL(url);
      if (parsed.origin !== "https://kcxlabs.org") {
        return { ok: false, message: "Refused to open a URL outside kcxlabs.org." };
      }
      await shell.openExternal(parsed.href);
      return { ok: true, message: "Opened in your default browser." };
    } catch {
      return { ok: false, message: "That share URL is not valid." };
    }
  });
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  startupLog("window-all-closed");
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => startupLog("before-quit"));
app.on("will-quit", () => startupLog("will-quit"));
