export const desktopIpcChannels = {
  getStatus: "desktop:get-status",
  listProjects: "catalog:list-projects",
  addProject: "catalog:add-project",
  chooseArtifact: "release:choose-artifact",
  previewRelease: "release:preview",
} as const;

export type DesktopIpcChannel = (typeof desktopIpcChannels)[keyof typeof desktopIpcChannels];
