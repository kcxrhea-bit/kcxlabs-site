import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { IpcRendererEvent } from "electron";
import { desktopIpcChannels } from "./ipc";
import type { DesktopApi, MediaUploadRecord } from "../src/shared/desktop";

const desktopApi: DesktopApi = {
  getStatus: () => ipcRenderer.invoke(desktopIpcChannels.getStatus),
  listProjects: () => ipcRenderer.invoke(desktopIpcChannels.listProjects),
  addProject: (input) => ipcRenderer.invoke(desktopIpcChannels.addProject, input),
  chooseProjectFolder: () => ipcRenderer.invoke(desktopIpcChannels.chooseProjectFolder),
  getDroppedPath: (file) => webUtils.getPathForFile(file),
  chooseProjectScanRoot: () => ipcRenderer.invoke(desktopIpcChannels.chooseProjectScanRoot),
  scanProjects: (root) => ipcRenderer.invoke(desktopIpcChannels.scanProjects, root),
  getWebsiteProducts: () => ipcRenderer.invoke(desktopIpcChannels.getWebsiteProducts),
  previewWebsiteChange: (change) => ipcRenderer.invoke(desktopIpcChannels.previewWebsiteChange, change),
  applyWebsiteChange: (change) => ipcRenderer.invoke(desktopIpcChannels.applyWebsiteChange, change),
  chooseArtifact: () => ipcRenderer.invoke(desktopIpcChannels.chooseArtifact),
  choosePatch: () => ipcRenderer.invoke(desktopIpcChannels.choosePatch),
  previewPatch: (projectId, patchPath) => ipcRenderer.invoke(desktopIpcChannels.previewPatch, projectId, patchPath),
  importPatch: (projectId, patchPath) => ipcRenderer.invoke(desktopIpcChannels.importPatch, projectId, patchPath),
  openProjectFolder: (projectId) => ipcRenderer.invoke(desktopIpcChannels.openProjectFolder, projectId),
  createProjectZip: (projectId) => ipcRenderer.invoke(desktopIpcChannels.createProjectZip, projectId),
  buildProjectExecutable: (projectId) => ipcRenderer.invoke(desktopIpcChannels.buildProjectExecutable, projectId),
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
  chooseMediaFile: () => ipcRenderer.invoke(desktopIpcChannels.chooseMediaFile),
  listPendingMediaUploads: () => ipcRenderer.invoke(desktopIpcChannels.listPendingMediaUploads),
  listUploadedMedia: () => ipcRenderer.invoke(desktopIpcChannels.listUploadedMedia),
  removeUploadedMedia: (id: string) => ipcRenderer.invoke(desktopIpcChannels.removeUploadedMedia, id),
  startMediaUpload: (filePath: string) => ipcRenderer.invoke(desktopIpcChannels.startMediaUpload, filePath),
  retryMediaFinalize: (id: string) => ipcRenderer.invoke(desktopIpcChannels.retryMediaFinalize, id),
  onMediaProgress: (listener: (record: MediaUploadRecord) => void) => {
    const handler = (_event: IpcRendererEvent, record: MediaUploadRecord) => listener(record);
    ipcRenderer.on(desktopIpcChannels.mediaProgress, handler);
    return () => ipcRenderer.removeListener(desktopIpcChannels.mediaProgress, handler);
  },
  getDevicePairingStatus: () => ipcRenderer.invoke(desktopIpcChannels.getDevicePairingStatus),
  pairDevice: (email: string, password: string, deviceName: string) => ipcRenderer.invoke(desktopIpcChannels.pairDevice, email, password, deviceName),
  unpairDevice: () => ipcRenderer.invoke(desktopIpcChannels.unpairDevice),
  openMediaShareUrl: (url: string) => ipcRenderer.invoke(desktopIpcChannels.openMediaShareUrl, url),
};

contextBridge.exposeInMainWorld("kcxDesktop", desktopApi);
