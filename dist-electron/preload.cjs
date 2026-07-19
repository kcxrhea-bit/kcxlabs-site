"use strict";

// electron/preload.ts
var import_electron = require("electron");

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

// electron/preload.ts
var desktopApi = {
  getStatus: () => import_electron.ipcRenderer.invoke(desktopIpcChannels.getStatus),
  listProjects: () => import_electron.ipcRenderer.invoke(desktopIpcChannels.listProjects),
  addProject: (input) => import_electron.ipcRenderer.invoke(desktopIpcChannels.addProject, input),
  chooseArtifact: () => import_electron.ipcRenderer.invoke(desktopIpcChannels.chooseArtifact),
  previewRelease: (draft) => import_electron.ipcRenderer.invoke(desktopIpcChannels.previewRelease, draft),
  publishRelease: (draft) => import_electron.ipcRenderer.invoke(desktopIpcChannels.publishRelease, draft),
  getActivity: () => import_electron.ipcRenderer.invoke(desktopIpcChannels.getActivity),
  getDeploymentReadiness: () => import_electron.ipcRenderer.invoke(desktopIpcChannels.getDeploymentReadiness),
  buildWebsite: () => import_electron.ipcRenderer.invoke(desktopIpcChannels.buildWebsite),
  getPreviewStatus: () => import_electron.ipcRenderer.invoke(desktopIpcChannels.getPreviewStatus),
  startWebsitePreview: () => import_electron.ipcRenderer.invoke(desktopIpcChannels.startWebsitePreview),
  stopWebsitePreview: () => import_electron.ipcRenderer.invoke(desktopIpcChannels.stopWebsitePreview),
  scanTheme: (projectId) => import_electron.ipcRenderer.invoke(desktopIpcChannels.scanTheme, projectId),
  syncTheme: (projectId) => import_electron.ipcRenderer.invoke(desktopIpcChannels.syncTheme, projectId)
};
import_electron.contextBridge.exposeInMainWorld("kcxDesktop", desktopApi);
//# sourceMappingURL=preload.cjs.map
