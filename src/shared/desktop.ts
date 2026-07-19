export type DesktopStatus = {
  applicationVersion: string;
  electronVersion: string;
  platform: string;
};

export type DesktopApi = {
  getStatus(): Promise<DesktopStatus>;
  listProjects(): Promise<CatalogProject[]>;
  addProject(input: NewCatalogProject): Promise<CatalogProject>;
  chooseProjectFolder(): Promise<string | null>;
  getDroppedPath(file: File): string;
  chooseProjectScanRoot(): Promise<string | null>;
  scanProjects(root: string): Promise<DiscoveredProject[]>;
  getWebsiteProducts(): Promise<WebsiteProduct[]>;
  previewWebsiteChange(change: WebsiteChangeRequest): Promise<WebsiteChangePreview>;
  applyWebsiteChange(change: WebsiteChangeRequest): Promise<OperationResult>;
  chooseArtifact(): Promise<string | null>;
  choosePatch(): Promise<string | null>;
  previewPatch(projectId: string, patchPath: string): Promise<PatchPreview>;
  importPatch(projectId: string, patchPath: string): Promise<OperationResult>;
  previewRelease(draft: ReleaseDraft): Promise<ReleasePreview>;
  publishRelease(draft: ReleaseDraft): Promise<OperationResult>;
  getActivity(): Promise<ActivityEntry[]>;
  getDeploymentReadiness(): Promise<DeploymentReadiness>;
  buildWebsite(): Promise<OperationResult>;
  getPreviewStatus(): Promise<PreviewStatus>;
  startWebsitePreview(): Promise<PreviewStatus>;
  stopWebsitePreview(): Promise<PreviewStatus>;
  scanTheme(projectId: string): Promise<ThemeScan>;
  syncTheme(projectId: string): Promise<OperationResult>;
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
export type DiscoveredProject = { name: string; slug: string; folder: string; markers: string[]; packageName?: string };
export type WebsiteProduct = { name: string; slug: string; folder: string; description: string; category: string; source: "scan" | "catalog"; addedAt: string };
export type WebsiteChangeRequest = { additions: Omit<WebsiteProduct, "addedAt">[]; removalSlugs: string[] };
export type WebsiteChangePreview = { additions: WebsiteProduct[]; removals: WebsiteProduct[]; warnings: string[]; canApply: boolean };

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
export type PatchPreview = { isValid: boolean; errors: string[]; fileName: string | null; bytes: number | null; operations: string[] };

export type ActivityEntry = { id: string; at: string; level: "info" | "warning" | "error"; action: string; detail: string };
export type OperationResult = { ok: boolean; message: string; output?: string };
export type DeploymentReadiness = { branch: string; gitStatus: string[]; websiteBuildReady: boolean; vercelCliAvailable: boolean; deployAllowed: false };
export type PreviewStatus = { running: boolean; url: string | null; stdout: string[]; stderr: string[] };
export type ThemeFileState = { source: string; destination: string; status: "current" | "outdated" | "missing" };
export type ThemeScan = { projectId: string; projectName: string; files: ThemeFileState[]; ready: boolean };
