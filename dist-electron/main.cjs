"use strict";

// electron/main.ts
var import_electron = require("electron");
var import_node_fs4 = require("node:fs");
var import_node_path4 = require("node:path");

// electron/ipc.ts
var desktopIpcChannels = {
  getStatus: "desktop:get-status",
  listProjects: "catalog:list-projects",
  addProject: "catalog:add-project",
  chooseArtifact: "release:choose-artifact",
  previewRelease: "release:preview",
  publishRelease: "release:publish",
  getActivity: "activity:list",
  getDeploymentReadiness: "deployment:readiness",
  buildWebsite: "website:build",
  getPreviewStatus: "website-preview:status",
  startWebsitePreview: "website-preview:start",
  stopWebsitePreview: "website-preview:stop",
  scanTheme: "theme:scan",
  syncTheme: "theme:sync"
};

// electron/catalog-service.ts
var import_promises = require("node:fs/promises");
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var emptyCatalog = () => ({ schemaVersion: 1, projects: [] });
var CatalogService = class {
  constructor(filePath) {
    this.filePath = filePath;
  }
  filePath;
  async list() {
    const document = await this.read();
    return Promise.all(document.projects.map(async (project) => ({
      ...project,
      folderStatus: await this.folderStatus(project.folder)
    })));
  }
  async add(input) {
    const name = input.name.trim();
    const slug = input.slug.trim().toLowerCase();
    const folder = input.folder.trim();
    if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !folder) {
      throw new Error("Project name, a lowercase slug, and a folder path are required.");
    }
    const document = await this.read();
    if (document.projects.some((project2) => project2.slug === slug)) {
      throw new Error(`A project with slug '${slug}' is already registered.`);
    }
    const project = {
      id: crypto.randomUUID(),
      name,
      slug,
      folder,
      description: input.description.trim(),
      category: input.category.trim() || "Uncategorized",
      currentVersion: input.currentVersion.trim() || "Unreleased",
      releaseChannel: input.releaseChannel,
      websiteVisible: input.websiteVisible,
      downloadVisible: input.downloadVisible,
      folderStatus: await this.folderStatus(folder),
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    document.projects.push(project);
    await this.write(document);
    return project;
  }
  async read() {
    try {
      const raw = await (0, import_promises.readFile)(this.filePath, "utf8");
      const document = JSON.parse(raw);
      if (document.schemaVersion !== 1 || !Array.isArray(document.projects)) throw new Error("Unsupported catalog format.");
      return document;
    } catch (error) {
      if (error.code === "ENOENT") return emptyCatalog();
      throw error;
    }
  }
  async write(document) {
    await (0, import_promises.mkdir)((0, import_node_path.dirname)(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${crypto.randomUUID()}.tmp`;
    await (0, import_promises.writeFile)(temporaryPath, `${JSON.stringify(document, null, 2)}
`, "utf8");
    await (0, import_promises.rename)(temporaryPath, this.filePath);
  }
  async folderStatus(folder) {
    try {
      await (0, import_promises.access)(folder, import_node_fs.constants.R_OK);
      return "available";
    } catch {
      return "missing";
    }
  }
};
function createCatalogService(userDataPath) {
  return new CatalogService((0, import_node_path.join)(userDataPath, "catalog.json"));
}

// electron/release-planner.ts
var import_promises2 = require("node:fs/promises");
var import_node_crypto = require("node:crypto");
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");
async function sha256(filePath) {
  return new Promise((resolveHash, reject) => {
    const hash = (0, import_node_crypto.createHash)("sha256");
    const stream = (0, import_node_fs2.createReadStream)(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}
async function previewRelease(draft, project) {
  const errors = [];
  const warnings = [];
  const artifactPath = (0, import_node_path2.resolve)(draft.artifactPath);
  if (!project) errors.push("Select a registered project.");
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(draft.version.trim())) {
    errors.push("Version must use semantic version format, for example 1.2.3.");
  }
  if (!draft.title.trim()) errors.push("Release title is required.");
  if (!artifactPath) errors.push("Choose a release artifact.");
  try {
    const file = await (0, import_promises2.stat)(artifactPath);
    if (!file.isFile()) errors.push("The selected artifact is not a file.");
    if (file.size === 0) errors.push("The selected artifact is empty.");
    const hash = await sha256(artifactPath);
    if (!/\.(exe|msi|zip)$/i.test(artifactPath)) warnings.push("Artifact is not an installer or ZIP archive.");
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      artifact: { name: (0, import_node_path2.basename)(artifactPath), path: artifactPath, bytes: file.size, sha256: hash },
      operations: project ? [
        `Validate ${(0, import_node_path2.basename)(artifactPath)} for ${project.name}`,
        "Generate website metadata preview",
        "Build the website before an explicit future publish confirmation"
      ] : []
    };
  } catch {
    errors.push("The selected artifact is unavailable or unreadable.");
    return { isValid: false, errors, warnings, artifact: null, operations: [] };
  }
}

// electron/platform-service.ts
var import_node_child_process = require("node:child_process");
var import_node_crypto2 = require("node:crypto");
var import_promises3 = require("node:fs/promises");
var import_node_fs3 = require("node:fs");
var import_node_path3 = require("node:path");
var themeFiles = [
  ["src/kcxThemeTypes.ts", "src/renderer/theme/kcxThemeTypes.ts"],
  ["src/kcxPalette.ts", "src/renderer/theme/kcxPalette.ts"],
  ["styles/kcx-theme.css", "src/renderer/styles/kcx-theme.css"],
  ["styles/kcx-glow-utils.css", "src/renderer/styles/kcx-glow-utils.css"]
];
var isInside = (base, candidate) => {
  const rel = (0, import_node_path3.relative)(base, candidate);
  return rel && !rel.startsWith("..") && !(0, import_node_path3.resolve)(candidate).includes("..") || (0, import_node_path3.resolve)(base) === (0, import_node_path3.resolve)(candidate);
};
var digest = async (file) => (0, import_node_crypto2.createHash)("sha256").update(await (0, import_promises3.readFile)(file)).digest("hex");
var PlatformService = class {
  constructor(appRoot, userData) {
    this.appRoot = appRoot;
    this.userData = userData;
    this.activityFile = (0, import_node_path3.join)(userData, "activity.json");
  }
  appRoot;
  userData;
  preview = null;
  previewStatus = { running: false, url: null, stdout: [], stderr: [] };
  activityFile;
  async getActivity() {
    try {
      return JSON.parse(await (0, import_promises3.readFile)(this.activityFile, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }
  async record(action, detail, level = "info") {
    const next = [{ id: (0, import_node_crypto2.randomUUID)(), at: (/* @__PURE__ */ new Date()).toISOString(), level, action, detail }, ...await this.getActivity()].slice(0, 250);
    await this.atomicJson(this.activityFile, next);
  }
  async buildWebsite() {
    const result = await this.run("npm.cmd", ["run", "build"], this.appRoot);
    await this.record("Website build", result.ok ? "Website build succeeded" : "Website build failed", result.ok ? "info" : "error");
    return result;
  }
  async deploymentReadiness() {
    const git = await this.run("git", ["status", "--short", "--branch"], this.appRoot);
    const vercel = await this.run("vercel", ["--version"], this.appRoot);
    return { branch: git.output?.split(/\r?\n/)[0] || "unavailable", gitStatus: (git.output || "").split(/\r?\n/).slice(1).filter(Boolean), websiteBuildReady: (await this.run("npm.cmd", ["run", "build"], this.appRoot)).ok, vercelCliAvailable: vercel.ok, deployAllowed: false };
  }
  getPreviewStatus() {
    return { ...this.previewStatus, stdout: [...this.previewStatus.stdout], stderr: [...this.previewStatus.stderr] };
  }
  async startPreview() {
    if (this.preview) return this.getPreviewStatus();
    const port = 5180 + Math.floor(Math.random() * 200);
    const child = (0, import_node_child_process.spawn)(process.execPath, [(0, import_node_path3.join)(this.appRoot, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: this.appRoot });
    this.preview = child;
    this.previewStatus = { running: true, url: `http://127.0.0.1:${port}`, stdout: [], stderr: [] };
    child.stdout?.on("data", (chunk) => {
      this.previewStatus.stdout = [...this.previewStatus.stdout, String(chunk).trim()].slice(-100);
    });
    child.stderr?.on("data", (chunk) => {
      this.previewStatus.stderr = [...this.previewStatus.stderr, String(chunk).trim()].slice(-100);
    });
    child.on("exit", () => {
      this.preview = null;
      this.previewStatus.running = false;
    });
    await this.record("Website preview", `Started ${this.previewStatus.url}`);
    return this.getPreviewStatus();
  }
  async stopPreview() {
    this.preview?.kill();
    this.preview = null;
    this.previewStatus.running = false;
    await this.record("Website preview", "Stopped");
    return this.getPreviewStatus();
  }
  async publishRelease(draft, project) {
    if (!project) return { ok: false, message: "Select a registered project." };
    const artifact = (0, import_node_path3.resolve)(draft.artifactPath);
    try {
      const info = await (0, import_promises3.stat)(artifact);
      if (!info.isFile()) return { ok: false, message: "Artifact is not a file." };
      const releaseRoot = (0, import_node_path3.join)(this.appRoot, "public", "downloads", "releases", project.slug);
      const destination = (0, import_node_path3.join)(releaseRoot, artifact.split(/[\\/]/).pop());
      if (!isInside(releaseRoot, destination)) return { ok: false, message: "Invalid artifact destination." };
      await (0, import_promises3.mkdir)(releaseRoot, { recursive: true });
      try {
        await (0, import_promises3.access)(destination, import_node_fs3.constants.R_OK);
        const backup = (0, import_node_path3.join)(this.userData, "release-backups", (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-"), project.slug, artifact.split(/[\\/]/).pop());
        await (0, import_promises3.mkdir)((0, import_node_path3.dirname)(backup), { recursive: true });
        await (0, import_promises3.copyFile)(destination, backup);
      } catch {
      }
      await (0, import_promises3.copyFile)(artifact, destination);
      const metadataPath = (0, import_node_path3.join)(this.appRoot, "src", "data", "publishing-catalog.json");
      const metadata = JSON.parse(await (0, import_promises3.readFile)(metadataPath, "utf8"));
      metadata.releases.push({ projectSlug: project.slug, version: draft.version, title: draft.title, channel: draft.channel, file: `downloads/releases/${project.slug}/${artifact.split(/[\\/]/).pop()}`, bytes: info.size, sha256: await digest(artifact), publishedAt: (/* @__PURE__ */ new Date()).toISOString() });
      await this.atomicJson(metadataPath, metadata);
      await this.record("Release created", `${project.name} ${draft.version}`);
      return { ok: true, message: "Release copied with backup and website metadata updated. Deployment remains manual." };
    } catch (error) {
      await this.record("Release publish", String(error), "error");
      return { ok: false, message: String(error) };
    }
  }
  async scanTheme(project) {
    if (!project) throw new Error("Select a registered project.");
    const sourceRoot = (0, import_node_path3.join)(this.appRoot, "theme-engine");
    const files = await Promise.all(themeFiles.map(async ([source, destination]) => {
      const sourcePath = (0, import_node_path3.join)(sourceRoot, source);
      const destinationPath = (0, import_node_path3.resolve)(project.folder, destination);
      if (!isInside((0, import_node_path3.resolve)(project.folder), destinationPath)) throw new Error("Theme destination escaped the project folder.");
      try {
        await (0, import_promises3.access)(destinationPath, import_node_fs3.constants.R_OK);
        return { source, destination, status: await digest(sourcePath) === await digest(destinationPath) ? "current" : "outdated" };
      } catch {
        return { source, destination, status: "missing" };
      }
    }));
    return { projectId: project.id, projectName: project.name, files, ready: files.every((file) => file.status === "current") };
  }
  async syncTheme(project) {
    if (!project) return { ok: false, message: "Select a registered project." };
    const scan = await this.scanTheme(project);
    const sourceRoot = (0, import_node_path3.join)(this.appRoot, "theme-engine");
    const backupRoot = (0, import_node_path3.join)(project.folder, ".kcx-theme-backups", (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-"));
    try {
      for (const [source, destination] of themeFiles) {
        const from = (0, import_node_path3.join)(sourceRoot, source);
        const to = (0, import_node_path3.resolve)(project.folder, destination);
        if (!isInside((0, import_node_path3.resolve)(project.folder), to)) throw new Error("Theme destination escaped the project folder.");
        try {
          await (0, import_promises3.access)(to, import_node_fs3.constants.R_OK);
          const backup = (0, import_node_path3.join)(backupRoot, destination);
          await (0, import_promises3.mkdir)((0, import_node_path3.dirname)(backup), { recursive: true });
          await (0, import_promises3.copyFile)(to, backup);
        } catch {
        }
        await (0, import_promises3.mkdir)((0, import_node_path3.dirname)(to), { recursive: true });
        await (0, import_promises3.copyFile)(from, to);
      }
      await this.record("Theme sync", `${project.name}: ${scan.files.length} files synchronized`);
      return { ok: true, message: `Synchronized ${scan.files.length} theme files. Backup: ${backupRoot}` };
    } catch (error) {
      await this.record("Theme sync", `${project.name}: ${String(error)}`, "error");
      return { ok: false, message: String(error) };
    }
  }
  async atomicJson(path, value) {
    await (0, import_promises3.mkdir)((0, import_node_path3.dirname)(path), { recursive: true });
    const temp = `${path}.${(0, import_node_crypto2.randomUUID)()}.tmp`;
    await (0, import_promises3.writeFile)(temp, `${JSON.stringify(value, null, 2)}
`, "utf8");
    await (0, import_promises3.rename)(temp, path);
  }
  run(command, args, cwd) {
    return new Promise((resolveResult) => {
      const child = (0, import_node_child_process.spawn)(command, args, { cwd, shell: process.platform === "win32", windowsHide: true });
      let output = "";
      child.stdout?.on("data", (chunk) => output += String(chunk));
      child.stderr?.on("data", (chunk) => output += String(chunk));
      child.on("error", (error) => resolveResult({ ok: false, message: error.message, output }));
      child.on("exit", (code) => resolveResult({ ok: code === 0, message: code === 0 ? "Completed" : `Failed with exit code ${code}`, output }));
    });
  }
};

// electron/main.ts
var mainWindow = null;
function createWindow() {
  const preload = (0, import_node_path4.join)(__dirname, "preload.cjs");
  const developmentServerUrl = process.env.VITE_DEV_SERVER_URL;
  mainWindow = new import_electron.BrowserWindow({
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
      preload
    }
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  if (developmentServerUrl) {
    void mainWindow.loadURL(developmentServerUrl);
  } else {
    const websiteEntry = (0, import_node_path4.join)(import_electron.app.getAppPath(), "dist", "index.html");
    if (!(0, import_node_fs4.existsSync)(websiteEntry)) {
      throw new Error("The website bundle is missing. Run npm run build before launching the packaged app.");
    }
    void mainWindow.loadFile(websiteEntry);
  }
}
function getDesktopStatus() {
  return {
    applicationVersion: import_electron.app.getVersion(),
    electronVersion: process.versions.electron,
    platform: process.platform
  };
}
import_electron.app.whenReady().then(() => {
  import_electron.ipcMain.handle(desktopIpcChannels.getStatus, getDesktopStatus);
  const catalog = createCatalogService(import_electron.app.getPath("userData"));
  const platform = new PlatformService(import_electron.app.getAppPath(), import_electron.app.getPath("userData"));
  import_electron.ipcMain.handle(desktopIpcChannels.listProjects, () => catalog.list());
  import_electron.ipcMain.handle(desktopIpcChannels.addProject, (_event, input) => catalog.add(input));
  import_electron.ipcMain.handle(desktopIpcChannels.chooseArtifact, async () => {
    if (!mainWindow) return null;
    const selection = await import_electron.dialog.showOpenDialog(mainWindow, {
      title: "Choose release artifact",
      properties: ["openFile"],
      filters: [{ name: "Release artifacts", extensions: ["exe", "msi", "zip"] }, { name: "All files", extensions: ["*"] }]
    });
    return selection.canceled ? null : selection.filePaths[0];
  });
  import_electron.ipcMain.handle(desktopIpcChannels.previewRelease, async (_event, draft) => {
    const project = (await catalog.list()).find((candidate) => candidate.id === draft.projectId);
    return previewRelease(draft, project);
  });
  import_electron.ipcMain.handle(desktopIpcChannels.publishRelease, async (_event, draft) => {
    const project = (await catalog.list()).find((candidate) => candidate.id === draft.projectId);
    const preview = await previewRelease(draft, project);
    if (!preview.isValid) return { ok: false, message: preview.errors.join(" ") };
    const confirmation = await import_electron.dialog.showMessageBox(mainWindow, { type: "warning", buttons: ["Cancel", "Publish release"], defaultId: 0, cancelId: 0, message: `Publish ${project?.name} ${draft.version}?`, detail: "This copies the artifact and updates website metadata. It does not deploy." });
    return confirmation.response === 1 ? platform.publishRelease(draft, project) : { ok: false, message: "Publishing cancelled." };
  });
  import_electron.ipcMain.handle(desktopIpcChannels.getActivity, () => platform.getActivity());
  import_electron.ipcMain.handle(desktopIpcChannels.getDeploymentReadiness, () => platform.deploymentReadiness());
  import_electron.ipcMain.handle(desktopIpcChannels.buildWebsite, () => platform.buildWebsite());
  import_electron.ipcMain.handle(desktopIpcChannels.getPreviewStatus, () => platform.getPreviewStatus());
  import_electron.ipcMain.handle(desktopIpcChannels.startWebsitePreview, () => platform.startPreview());
  import_electron.ipcMain.handle(desktopIpcChannels.stopWebsitePreview, () => platform.stopPreview());
  import_electron.ipcMain.handle(desktopIpcChannels.scanTheme, async (_event, id) => platform.scanTheme((await catalog.list()).find((project) => project.id === id)));
  import_electron.ipcMain.handle(desktopIpcChannels.syncTheme, async (_event, id) => platform.syncTheme((await catalog.list()).find((project) => project.id === id)));
  createWindow();
  import_electron.app.on("activate", () => {
    if (import_electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
import_electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") import_electron.app.quit();
});
//# sourceMappingURL=main.cjs.map
