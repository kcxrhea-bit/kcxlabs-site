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
  openProjectFolder(projectId: string): Promise<OperationResult>;
  createProjectZip(projectId: string): Promise<OperationResult>;
  buildProjectExecutable(projectId: string): Promise<OperationResult>;
  getDistributionCapabilities(projectId: string): Promise<DistributionCapabilities>;
  previewDistribution(projectId: string, target: DistributionTarget): Promise<DistributionPlan>;
  runDistribution(projectId: string, target: DistributionTarget): Promise<DistributionRunResult>;
  onDistributionProgress(listener: (progress: DistributionProgress) => void): () => void;
  getDistributionProjectStatus(projectId: string): Promise<DistributionProjectStatus>;
  runDistributionWorkflow(request: DistributionWorkflowRequest): Promise<DistributionWorkflowResult>;
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
  chooseMediaFile(): Promise<string | null>;
  listPendingMediaUploads(): Promise<MediaUploadRecord[]>;
  listUploadedMedia(): Promise<UploadedMediaItem[]>;
  removeUploadedMedia(id: string): Promise<OperationResult>;
  // No visibility parameter: every Media Center upload is public/shareable by product design
  // (see MediaService's CANONICAL_MEDIA_VISIBILITY). The desktop user never chooses this.
  startMediaUpload(filePath: string): Promise<MediaUploadRecord>;
  retryMediaFinalize(id: string): Promise<MediaUploadRecord>;
  onMediaProgress(listener: (record: MediaUploadRecord) => void): () => void;
  getDevicePairingStatus(): Promise<DevicePairingStatus>;
  pairDevice(email: string, password: string, deviceName: string): Promise<OperationResult>;
  unpairDevice(): Promise<OperationResult>;
  /** Opens a clip's kcxlabs.org share URL in the OS default browser via `shell.openExternal`. Refuses anything off-origin. */
  openMediaShareUrl(url: string): Promise<OperationResult>;
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

export type MediaVisibility = "private" | "unlisted" | "public";
export type UploadedMediaItem = {
  id: string;
  title: string;
  originalFilename: string;
  visibility: MediaVisibility;
  status: string;
  originalOnline: boolean;
  archiveState: string;
};
export type MediaUploadStage = "hashing" | "checking" | "authorizing" | "uploading" | "uploaded" | "finalizing" | "finalized" | "failed";

// Renderer-visible upload state. Never carries the presigned R2 URL, upload headers, the device
// bearer token, or any server credential — those stay inside the main-process MediaService.
export type MediaUploadRecord = {
  id: string;
  fileName: string;
  filePath: string;
  bytes: number;
  sha256: string | null;
  stage: MediaUploadStage;
  progress: number;
  visibility: MediaVisibility;
  mediaId: string | null;
  // True only once the PUT to storage has completed successfully. Retry-finalization must be
  // gated on this, not on mediaId alone — mediaId is assigned before the object upload starts.
  objectUploaded: boolean;
  publicId: string | null;
  shareUrl: string | null;
  duplicate: boolean;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

// Never carries the device bearer token — only whether one is stored, and non-secret metadata.
export type DevicePairingStatus = { paired: boolean; deviceName: string | null; expiresAt: string | null };

export type DistributionTarget =
  | "web"
  | "executable"
  | "installer"
  | "apk"
  | "zip"
  | "source";

export type DistributionCapabilities = {
  projectId: string;
  projectName: string;
  projectFolder: string;
  web: boolean;
  executable: boolean;
  installer: boolean;
  apk: boolean;
  zip: boolean;
  source: boolean;
};

export type DistributionPlan = {
  projectId: string;
  projectName: string;
  target: DistributionTarget;
  supported: boolean;
  workingDirectory: string;
  command: string | null;
  args: string[];
  expectedArtifacts: string[];
  message: string;
};
export type DistributionStage =
  | "queued"
  | "preparing"
  | "building"
  | "collecting"
  | "staging"
  | "complete"
  | "failed";

export type DistributionProgress = {
  projectId: string;
  target: DistributionTarget;
  stage: DistributionStage;
  progress: number;
  message: string;
  output?: string;
};

export type DistributionRunResult = OperationResult & {
  target: DistributionTarget;
  artifactPaths: string[];
};
export type DistributionReadiness =
  | "ready"
  | "needs-setup"
  | "built"
  | "staged"
  | "published"
  | "deployed"
  | "unsupported";

export type DistributionTargetStatus = {
  target: DistributionTarget;
  readiness: DistributionReadiness;
  reason: string;
  canConfigure: boolean;
  canBuild: boolean;
};

export type DistributionProjectStatus = {
  projectId: string;
  projectName: string;
  targets: DistributionTargetStatus[];
};

export type DistributionAction =
  | "configure"
  | "build"
  | "stage"
  | "publish"
  | "deploy";

export type DistributionWorkflowRequest = {
  projectId: string;
  targets: DistributionTarget[];
  actions: DistributionAction[];
};

export type DistributionWorkflowResult = {
  ok: boolean;
  message: string;
  projectId: string;
  completedActions: DistributionAction[];
  artifactPaths: string[];
};
