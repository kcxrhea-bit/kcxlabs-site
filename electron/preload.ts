import { contextBridge, ipcRenderer } from "electron";
import { desktopIpcChannels } from "./ipc";
import type { DesktopApi } from "../src/shared/desktop";

const desktopApi: DesktopApi = {
  getStatus: () => ipcRenderer.invoke(desktopIpcChannels.getStatus),
  listProjects: () => ipcRenderer.invoke(desktopIpcChannels.listProjects),
  addProject: (input) => ipcRenderer.invoke(desktopIpcChannels.addProject, input),
  chooseArtifact: () => ipcRenderer.invoke(desktopIpcChannels.chooseArtifact),
  previewRelease: (draft) => ipcRenderer.invoke(desktopIpcChannels.previewRelease, draft),
  publishRelease: (draft) => ipcRenderer.invoke(desktopIpcChannels.publishRelease, draft),
  getActivity: () => ipcRenderer.invoke(desktopIpcChannels.getActivity),
  getDeploymentReadiness: () => ipcRenderer.invoke(desktopIpcChannels.getDeploymentReadiness),
  buildWebsite: () => ipcRenderer.invoke(desktopIpcChannels.buildWebsite),
  getPreviewStatus: () => ipcRenderer.invoke(desktopIpcChannels.getPreviewStatus),
  startWebsitePreview: () => ipcRenderer.invoke(desktopIpcChannels.startWebsitePreview),
  stopWebsitePreview: () => ipcRenderer.invoke(desktopIpcChannels.stopWebsitePreview),
  scanTheme: (projectId) => ipcRenderer.invoke(desktopIpcChannels.scanTheme, projectId),
  syncTheme: (projectId) => ipcRenderer.invoke(desktopIpcChannels.syncTheme, projectId),
};

contextBridge.exposeInMainWorld("kcxDesktop", desktopApi);
