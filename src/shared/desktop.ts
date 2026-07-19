export type DesktopStatus = {
  applicationVersion: string;
  electronVersion: string;
  platform: string;
};

export type DesktopApi = {
  getStatus(): Promise<DesktopStatus>;
  listProjects(): Promise<CatalogProject[]>;
  addProject(input: NewCatalogProject): Promise<CatalogProject>;
  chooseArtifact(): Promise<string | null>;
  previewRelease(draft: ReleaseDraft): Promise<ReleasePreview>;
};

export type ReleaseChannel = "stable" | "beta" | "alpha" | "experimental";

export type CatalogProject = {
  id: string;
  name: string;
  slug: string;
  folder: string;
  description: string;
  category: string;
  currentVersion: string;
  releaseChannel: ReleaseChannel;
  websiteVisible: boolean;
  downloadVisible: boolean;
  folderStatus: "available" | "missing";
  createdAt: string;
};

export type NewCatalogProject = Omit<CatalogProject, "id" | "folderStatus" | "createdAt">;

export type ReleaseDraft = {
  projectId: string;
  artifactPath: string;
  version: string;
  title: string;
  notes: string;
  channel: ReleaseChannel;
};

export type ReleasePreview = {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  artifact: { name: string; path: string; bytes: number; sha256: string } | null;
  operations: string[];
};
