"use strict";

// electron/main.ts
var import_electron = require("electron");
var import_node_fs3 = require("node:fs");
var import_node_path3 = require("node:path");

// electron/ipc.ts
var desktopIpcChannels = {
  getStatus: "desktop:get-status",
  listProjects: "catalog:list-projects",
  addProject: "catalog:add-project",
  chooseArtifact: "release:choose-artifact",
  previewRelease: "release:preview"
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

// electron/main.ts
var mainWindow = null;
function createWindow() {
  const preload = (0, import_node_path3.join)(__dirname, "preload.cjs");
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
    const websiteEntry = (0, import_node_path3.join)(import_electron.app.getAppPath(), "dist", "index.html");
    if (!(0, import_node_fs3.existsSync)(websiteEntry)) {
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
  createWindow();
  import_electron.app.on("activate", () => {
    if (import_electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
import_electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") import_electron.app.quit();
});
//# sourceMappingURL=main.cjs.map
