export type DesktopStatus = {
  applicationVersion: string;
  electronVersion: string;
  platform: string;
};

export type DesktopApi = {
  getStatus(): Promise<DesktopStatus>;
  listArtifacts(): Promise<ArtifactRecord[]>;
  verifyArtifact(id: string): Promise<ArtifactRecord>;
  recoverStagedArtifact(id: string): Promise<ArtifactRecord>;
  stageArtifact(id: string): Promise<ArtifactRecord>;
  openArtifactFolder(id: string): Promise<OperationResult>;
  copyArtifactPath(id: string): Promise<OperationResult>;
  publishArtifact(id: string): Promise<ArtifactRecord>;
  reconcilePublishedArtifact(id: string): Promise<ArtifactRecord>;
  getReleaseStorageSettings(): Promise<ReleaseStorageSettings>;
  updateReleaseStorageSettings(settings: { endpoint: string; bucket: string; region: string; publicBaseUrl?: string; accessKeyId?: string; secretAccessKey?: string }): Promise<ReleaseStorageSettings>;
  testReleaseStorage(): Promise<ReleaseStorageTestResult>;
  probeReleaseStorage(): Promise<ReleaseStorageProbeResult>;
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
  previewDistributionSetup(projectId: string, target: DistributionTarget): Promise<DistributionSetupPlan>;
  applyDistributionSetup(projectId: string, target: DistributionTarget): Promise<DistributionSetupResult>;
  previewRelease(draft: ReleaseDraft): Promise<ReleasePreview>;
  publishRelease(draft: ReleaseDraft): Promise<OperationResult>;
  getActivity(): Promise<ActivityEntry[]>;
  getDeploymentReadiness(): Promise<DeploymentReadiness>;
  deployWebsite(): Promise<DeploymentResult>;
  onDeploymentProgress(listener: (progress: DeploymentProgress) => void): () => void;
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
  getNeonStorageAnalysis(): Promise<NeonStorageAnalysis>;
  previewNeonStorageCleanup(): Promise<NeonCleanupPreview>;
  runNeonStorageCleanup(): Promise<NeonCleanupResult>;
  getNeonStorageSettings(): Promise<NeonStorageSettings>;
  setNeonStorageSettings(settings: NeonStorageSettings): Promise<NeonStorageSettings>;
};
export type ArtifactRecord = {
  id: string; projectId: string; projectName: string; target: string; platform?: string; architecture: string; filename: string;
  sourcePath: string; stagedPath?: string; bytes: number; sha256: string; builtAt: string; validatedAt?: string;
  validationStatus: "BUILT" | "VALIDATING" | "VALIDATED" | "STAGED" | "PUBLISHED" | "DEPLOYED" | "FAILED";
  validationEvidence: string[]; backend?: string; version?: string;
  publicationStatus: "NOT_PUBLISHED" | "PUBLISHING" | "PUBLISHED" | "DEPLOYED"; publicationDestination?: string; publicationReadiness?: { ready: boolean; reason: string }; reconciliationAvailable?: boolean;
};
export type ReleaseStorageSettings = { endpoint: string; bucket: string; region: string; publicBaseUrl: string; hasAccessKey: boolean; hasSecretKey: boolean; configured: boolean; providerCertified: boolean; configurationFingerprint?: string; certificationState?: "NOT_CERTIFIED" | "CERTIFIED" | "STALE" | "FAILED"; lastConnectionTestAt?: string; lastConnectionTestSucceeded?: boolean; lastProbeAt?: string; lastProbeSucceeded?: boolean; lastPublicDownloadResult?: "PASS" | "FAIL" | "NOT_CONFIGURED" };
export type ReleaseStorageTestResult = { configured: boolean; reachable: boolean; authenticated: boolean; bucketAccessible: boolean; publicBaseConfigured: boolean; success: boolean; errorCode?: string; message: string };
export type ReleaseStorageProbeResult = ReleaseStorageTestResult & { probeKey?: string; publicDownload: "PASS" | "FAIL" | "NOT_CONFIGURED"; cleanup: "PASS" | "FAIL" | "NOT_RUN" };

export type NeonStorageTable = { schema: string; tableName: string; totalBytes: number; tableBytes: number; indexBytes: number; approximateRowCount: number; protected: boolean };
export type NeonStorageAnalysis = { databaseName: string; totalBytes: number; totalMb: number; freeTierLimitBytes: number; freeTierLimitMb: number; cleanupThresholdBytes: number; cleanupThresholdMb: number; usedPercent: number; remainingBytes: number; remainingMb: number; thresholdReached: boolean; schemaMigrations: number; tables: NeonStorageTable[] };
export type NeonCleanupCandidate = { id: string; label: string; estimatedReclaimBytes: number; protected: false };
export type NeonCleanupPreview = { databaseName: string; currentBytes: number; thresholdBytes: number; candidates: NeonCleanupCandidate[]; estimatedReclaimBytes: number; protectedTables: string[]; warnings: string[]; canClean: boolean; explanation: string };
export type NeonCleanupResult = { ok: boolean; message: string; analysis: NeonStorageAnalysis | null; reclaimedBytes: number; candidatesRun: string[] };
export type NeonStorageSettings = { autoClean: boolean };

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
export type ProjectType = "web" | "electron" | "android" | "capacitor" | "tauri" | "rust" | "python" | "dotnet" | "static";
export type PackagingBackend = "electron-builder" | "electron-forge" | "electron-packager" | "tauri" | "gradle" | "dotnet" | "pyinstaller" | "web-script" | "archive" | "none";
export type DiscoveredProject = { name: string; slug: string; folder: string; markers: string[]; packageName?: string; projectTypes?: ProjectType[]; packageManager?: string; backends?: PackagingBackend[] };
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
export type DeploymentReadiness = {
  branch: string;
  gitStatus: string[];
  websiteBuildReady: boolean;
  vercelCliAvailable: boolean;
  vercelVersion: string | null;
  authenticated: boolean;
  account: string | null;
  team: string | null;
  projectResolved: boolean;
  projectName: string | null;
  projectId: string | null;
  productionUrl: string;
  publishedReleaseCount: number;
  publishedReleaseFilesReady: boolean;
  errors: string[];
  deployAllowed: boolean;
};

export type DeploymentStage =
  | "checking"
  | "building"
  | "deploying"
  | "verifying"
  | "complete"
  | "failed";

export type DeploymentProgress = {
  stage: DeploymentStage;
  progress: number;
  message: string;
  output?: string;
};

export type DeploymentResult = OperationResult & {
  projectName: string;
  productionUrl: string;
  deploymentUrl: string | null;
  startedAt: string;
  completedAt: string;
};
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
  projectTypes?: ProjectType[];
  backends?: Partial<Record<DistributionTarget, PackagingBackend>>;
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
  | "preparable"
  | "needs-input"
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
  projectTypes?: ProjectType[];
  backends?: Partial<Record<DistributionTarget, PackagingBackend>>;
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
export type DistributionSetupChange = {
  kind: "create" | "modify" | "install";
  path: string;
  description: string;
};

export type DistributionSetupPlan = {
  projectId: string;
  projectName: string;
  target: DistributionTarget;
  supported: boolean;
  detectedRoot: string;
  detectedKind: string;
  changes: DistributionSetupChange[];
  warnings: string[];
  message: string;
};
export type DistributionSetupResult = OperationResult & {
  projectId: string;
  target: DistributionTarget;
  backupPath: string | null;
};
