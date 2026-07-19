export const desktopIpcChannels = {
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
  syncTheme: "theme:sync",
} as const;

export type DesktopIpcChannel = (typeof desktopIpcChannels)[keyof typeof desktopIpcChannels];
