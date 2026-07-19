import { contextBridge, ipcRenderer } from "electron";
import { desktopIpcChannels } from "./ipc";
import type { DesktopApi } from "../src/shared/desktop";

const desktopApi: DesktopApi = {
  getStatus: () => ipcRenderer.invoke(desktopIpcChannels.getStatus),
  listProjects: () => ipcRenderer.invoke(desktopIpcChannels.listProjects),
  addProject: (input) => ipcRenderer.invoke(desktopIpcChannels.addProject, input),
  chooseArtifact: () => ipcRenderer.invoke(desktopIpcChannels.chooseArtifact),
  previewRelease: (draft) => ipcRenderer.invoke(desktopIpcChannels.previewRelease, draft),
};

contextBridge.exposeInMainWorld("kcxDesktop", desktopApi);
