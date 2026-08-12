import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { desktopIpcChannels } from "./ipc";
import type { DesktopStatus, NewCatalogProject, ReleaseDraft } from "../src/shared/desktop";
import { createCatalogService } from "./catalog-service";
import { previewRelease } from "./release-planner";
import { PlatformService } from "./platform-service";
import { scanForProjects } from "./project-discovery";
import { MediaService } from "./media-service";

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const preload = join(__dirname, "preload.cjs");
  const developmentServerUrl = process.env.VITE_DEV_SERVER_URL;

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
    void mainWindow.loadURL(developmentServerUrl);
  } else {
    const websiteEntry = join(app.getAppPath(), "dist", "index.html");
    if (!existsSync(websiteEntry)) {
      throw new Error("The website bundle is missing. Run npm run build before launching the packaged app.");
    }
    void mainWindow.loadFile(websiteEntry);
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
  ipcMain.handle(desktopIpcChannels.getStatus, getDesktopStatus);
  const catalog = createCatalogService(app.getPath("userData"));
  const platform = new PlatformService(app.getAppPath(), app.getPath("userData"));
  const media = new MediaService(app.getPath("userData"));
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
  ipcMain.handle(desktopIpcChannels.getDeploymentReadiness, () => platform.deploymentReadiness());
  ipcMain.handle(desktopIpcChannels.buildWebsite, () => platform.buildWebsite());
  ipcMain.handle(desktopIpcChannels.getPreviewStatus, () => platform.getPreviewStatus());
  ipcMain.handle(desktopIpcChannels.startWebsitePreview, () => platform.startPreview());
  ipcMain.handle(desktopIpcChannels.stopWebsitePreview, () => platform.stopPreview());
  ipcMain.handle(desktopIpcChannels.scanTheme, async (_event, id: string) => platform.scanTheme((await catalog.list()).find((project) => project.id === id)));
  ipcMain.handle(desktopIpcChannels.syncTheme, async (_event, id: string) => platform.syncTheme((await catalog.list()).find((project) => project.id === id)));


  // ─── Media Center ──────────────────────────────────────────────────────────

  ipcMain.handle(desktopIpcChannels.chooseMediaFiles, async () => {
    if (!mainWindow) return [];

    const selection = await dialog.showOpenDialog(mainWindow, {
      title: "Add videos to the Media Center queue",
      defaultPath: media.recordingInbox,
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Video files",
          extensions: ["mp4", "mov", "mkv", "webm", "avi", "m4v"],
        },
        { name: "All files", extensions: ["*"] },
      ],
    });

    return selection.canceled ? [] : media.describeFiles(selection.filePaths);
  });

  ipcMain.handle(desktopIpcChannels.scanMediaInbox, () => media.scanInbox());

  ipcMain.handle(
    desktopIpcChannels.listPendingMediaUploads,
    () => media.listPending(),
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
  if (process.platform !== "darwin") app.quit();
});
