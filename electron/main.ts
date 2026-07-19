import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { desktopIpcChannels } from "./ipc";
import type { DesktopStatus, NewCatalogProject, ReleaseDraft } from "../src/shared/desktop";
import { createCatalogService } from "./catalog-service";
import { previewRelease } from "./release-planner";
import { PlatformService } from "./platform-service";

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
  ipcMain.handle(desktopIpcChannels.listProjects, () => catalog.list());
  ipcMain.handle(desktopIpcChannels.addProject, (_event, input: NewCatalogProject) => catalog.add(input));
  ipcMain.handle(desktopIpcChannels.chooseArtifact, async () => {
    if (!mainWindow) return null;
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: "Choose release artifact",
      properties: ["openFile"],
      filters: [{ name: "Release artifacts", extensions: ["exe", "msi", "zip"] }, { name: "All files", extensions: ["*"] }],
    });
    return selection.canceled ? null : selection.filePaths[0];
  });
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
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
