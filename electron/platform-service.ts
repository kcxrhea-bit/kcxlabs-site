import { ChildProcess, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { ActivityEntry, DeploymentProgress, DeploymentReadiness, DeploymentResult, OperationResult, PatchPreview, PreviewStatus, ReleaseDraft, ThemeFileState, ThemeScan, WebsiteChangePreview, WebsiteChangeRequest, WebsiteProduct } from "../src/shared/desktop";
import type { CatalogProject } from "../src/shared/desktop";

const themeFiles = [
  ["src/kcxThemeTypes.ts", "src/renderer/theme/kcxThemeTypes.ts"],
  ["src/kcxPalette.ts", "src/renderer/theme/kcxPalette.ts"],
  ["styles/kcx-theme.css", "src/renderer/styles/kcx-theme.css"],
  ["styles/kcx-glow-utils.css", "src/renderer/styles/kcx-glow-utils.css"],
] as const;

const isInside = (base: string, candidate: string) => { const rel = relative(base, candidate); return rel && !rel.startsWith("..") && !resolve(candidate).includes("..") || resolve(base) === resolve(candidate); };
const digest = async (file: string) => createHash("sha256").update(await readFile(file)).digest("hex");

export class PlatformService {
  private preview: ChildProcess | null = null;
  private previewStatus: PreviewStatus = { running: false, url: null, stdout: [], stderr: [] };
  private readonly activityFile: string;
  constructor(private readonly appRoot: string, private readonly userData: string) { this.activityFile = join(userData, "activity.json"); }

  async getActivity(): Promise<ActivityEntry[]> { try { return JSON.parse(await readFile(this.activityFile, "utf8")) as ActivityEntry[]; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; } }
  async record(action: string, detail: string, level: ActivityEntry["level"] = "info"): Promise<void> { const next = [{ id: randomUUID(), at: new Date().toISOString(), level, action, detail }, ...(await this.getActivity())].slice(0, 250); await this.atomicJson(this.activityFile, next); }
  async buildWebsite(): Promise<OperationResult> { const result = await this.run("npm.cmd", ["run", "build"], this.appRoot); await this.record("Website build", result.ok ? "Website build succeeded" : "Website build failed", result.ok ? "info" : "error"); return result; }
  async deploymentReadiness(): Promise<DeploymentReadiness> {
    const expectedProjectName = "kcxlabs-site";
    const expectedProjectId = "prj_48w3bet6EUcLRHsH2FykHduTNFmT";
    const productionUrl = "https://kcxlabs.org";
    const vercelCommand = this.vercelCommand();
    const errors: string[] = [];

    const git = await this.run(
      "git",
      ["status", "--short", "--branch"],
      this.appRoot,
    );

    const vercel = await this.run(
      vercelCommand,
      ["--version"],
      this.appRoot,
    );

    const auth = vercel.ok
      ? await this.run(vercelCommand, ["whoami"], this.appRoot)
      : { ok: false, message: "Vercel CLI unavailable", output: "" };

    const project = vercel.ok
      ? await this.run(
          vercelCommand,
          ["project", "inspect", "--non-interactive", "--no-color"],
          this.appRoot,
        )
      : { ok: false, message: "Vercel CLI unavailable", output: "" };

    const websiteBuild = await this.run(
      "npm.cmd",
      ["run", "build"],
      this.appRoot,
    );

    const authOutput = auth.output || "";
    const projectOutput = project.output || "";

    const account =
      authOutput.match(/Logged in as\s+([^\r\n]+)/i)?.[1]?.trim() ?? null;

    const team =
      authOutput.match(/Active team:\s+([^\s(\r\n]+)/i)?.[1]?.trim() ?? null;

    const projectName =
      projectOutput.match(/Name\s+([^\r\n]+)/)?.[1]?.trim() ?? null;

    const projectId =
      projectOutput.match(/ID\s+(prj_[A-Za-z0-9]+)/)?.[1]?.trim() ?? null;

    const releaseCheck = await this.checkPublishedReleaseFiles();

    if (!git.ok) {
      errors.push("Git repository status could not be read.");
    }

    if (!vercel.ok) {
      errors.push("Repo-local Vercel CLI is unavailable.");
    }

    if (!auth.ok) {
      errors.push("Vercel authentication check failed.");
    }

    if (!project.ok) {
      errors.push("Vercel project resolution failed.");
    }

    if (projectName !== expectedProjectName) {
      errors.push(
        `Resolved Vercel project is '${projectName ?? "unknown"}', expected '${expectedProjectName}'.`,
      );
    }

    if (projectId !== expectedProjectId) {
      errors.push(
        `Resolved Vercel project ID is '${projectId ?? "unknown"}', expected '${expectedProjectId}'.`,
      );
    }

    if (!websiteBuild.ok) {
      errors.push("Website production build failed.");
    }

    if (!releaseCheck.ready) {
      errors.push(
        releaseCheck.errors.length > 0
          ? releaseCheck.errors.join(" ")
          : "One or more published release files are missing.",
      );
    }

    return {
      branch: git.output?.split(/\r?\n/)[0] || "unavailable",
      gitStatus: (git.output || "")
        .split(/\r?\n/)
        .slice(1)
        .filter(Boolean),
      websiteBuildReady: websiteBuild.ok,
      vercelCliAvailable: vercel.ok,
      vercelVersion:
        vercel.output?.match(
          /(?:Vercel CLI\s+)?([0-9]+\.[0-9]+\.[0-9]+)/,
        )?.[1] ?? null,
      authenticated: auth.ok,
      account,
      team,
      projectResolved:
        project.ok &&
        projectName === expectedProjectName &&
        projectId === expectedProjectId,
      projectName,
      projectId,
      productionUrl,
      publishedReleaseCount: releaseCheck.count,
      publishedReleaseFilesReady: releaseCheck.ready,
      errors,
      deployAllowed: errors.length === 0,
    };
  }

  async deployWebsite(
    onProgress?: (progress: DeploymentProgress) => void,
  ): Promise<DeploymentResult> {
    const startedAt = new Date().toISOString();
    const projectName = "kcxlabs-site";
    const productionUrl = "https://kcxlabs.org";

    const emit = (
      stage: DeploymentProgress["stage"],
      progress: number,
      message: string,
      output?: string,
    ) => {
      onProgress?.({ stage, progress, message, output });
    };

    emit("checking", 5, "Checking production deployment readiness.");

    const readiness = await this.deploymentReadiness();

    if (!readiness.deployAllowed) {
      const message =
        readiness.errors.join(" ") ||
        "Production deployment is not ready.";

      await this.record("Production deployment", message, "error");
      emit("failed", 100, message);

      return {
        ok: false,
        message,
        projectName,
        productionUrl,
        deploymentUrl: null,
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }

    emit("building", 25, "Production website build passed.");

    emit(
      "deploying",
      45,
      "Deploying kcxlabs-site to Vercel production.",
    );

    const result = await this.run(
      this.vercelCommand(),
      [
        "deploy",
        "--prod",
        "--yes",
        "--project",
        projectName,
        "--no-color",
        "--non-interactive",
      ],
      this.appRoot,
    );

    const output = result.output || "";

    const urls = [...output.matchAll(/https:\/\/[^\s]+/g)].map(
      (match) => match[0].replace(/[),.;]+$/, ""),
    );

    const deploymentUrl =
      urls.find((url) => url.includes("vercel.app")) ??
      urls.find((url) => url.startsWith("https://")) ??
      null;

    if (!result.ok) {
      const message =
        `Production deployment failed: ${result.message}`;

      await this.record("Production deployment", message, "error");
      emit("failed", 100, message, output);

      return {
        ok: false,
        message,
        output,
        projectName,
        productionUrl,
        deploymentUrl,
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }

    emit(
      "verifying",
      90,
      "Vercel production deployment completed.",
    );

    await this.record(
      "Production deployment",
      `${projectName} deployed to ${productionUrl}${
        deploymentUrl ? ` via ${deploymentUrl}` : ""
      }`,
      "info",
    );

    const message =
      `Production deployment completed for ${productionUrl}.`;

    emit("complete", 100, message, output);

    return {
      ok: true,
      message,
      output,
      projectName,
      productionUrl,
      deploymentUrl,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }
  getPreviewStatus(): PreviewStatus { return { ...this.previewStatus, stdout: [...this.previewStatus.stdout], stderr: [...this.previewStatus.stderr] }; }
  async startPreview(): Promise<PreviewStatus> { if (this.preview) return this.getPreviewStatus(); const port = 5180 + Math.floor(Math.random() * 200); const child = spawn(process.execPath, [join(this.appRoot, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: this.appRoot }); this.preview = child; this.previewStatus = { running: true, url: `http://127.0.0.1:${port}`, stdout: [], stderr: [] }; child.stdout?.on("data", (chunk) => { this.previewStatus.stdout = [...this.previewStatus.stdout, String(chunk).trim()].slice(-100); }); child.stderr?.on("data", (chunk) => { this.previewStatus.stderr = [...this.previewStatus.stderr, String(chunk).trim()].slice(-100); }); child.on("exit", () => { this.preview = null; this.previewStatus.running = false; }); await this.record("Website preview", `Started ${this.previewStatus.url}`); return this.getPreviewStatus(); }
  async stopPreview(): Promise<PreviewStatus> { this.preview?.kill(); this.preview = null; this.previewStatus.running = false; await this.record("Website preview", "Stopped"); return this.getPreviewStatus(); }
  async getWebsiteProducts(): Promise<WebsiteProduct[]> { const catalog = await this.readWebsiteCatalog(); return catalog.products; }
  async previewWebsiteChange(change: WebsiteChangeRequest): Promise<WebsiteChangePreview> { const catalog = await this.readWebsiteCatalog(); const existing = new Map(catalog.products.map((product) => [product.slug, product])); const warnings: string[] = []; const additions = change.additions.filter((candidate) => { if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate.slug)) { warnings.push(`Invalid slug: ${candidate.slug}`); return false; } if (existing.has(candidate.slug)) { warnings.push(`${candidate.name} is already on the website.`); return false; } return true; }).map((candidate) => ({ ...candidate, addedAt: new Date().toISOString() })); const removals = change.removalSlugs.flatMap((slug) => { const product = existing.get(slug); if (!product) { warnings.push(`No website product with slug '${slug}'.`); return []; } return [product]; }); return { additions, removals, warnings, canApply: additions.length > 0 || removals.length > 0 }; }
  async applyWebsiteChange(change: WebsiteChangeRequest): Promise<OperationResult> { const preview = await this.previewWebsiteChange(change); if (!preview.canApply) return { ok: false, message: preview.warnings.join(" ") || "No website changes to apply." }; const catalog = await this.readWebsiteCatalog(); const backup = join(this.userData, "website-catalog-backups", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`); await mkdir(dirname(backup), { recursive: true }); await copyFile(this.websiteCatalogPath(), backup); const removalSet = new Set(preview.removals.map((product) => product.slug)); catalog.products = [...catalog.products.filter((product) => !removalSet.has(product.slug)), ...preview.additions]; await this.atomicJson(this.websiteCatalogPath(), catalog); await this.record("Website catalog updated", `${preview.additions.length} added, ${preview.removals.length} removed`); return { ok: true, message: `Website metadata updated. Backup: ${backup}` }; }
  async previewPatch(project: CatalogProject | undefined, patchPath: string): Promise<PatchPreview> { const errors: string[] = []; if (!project) errors.push("Select a registered project."); if (!/\.(patch|diff)$/i.test(patchPath)) errors.push("Choose a .patch or .diff file."); try { const info = await stat(resolve(patchPath)); if (!info.isFile()) errors.push("Patch selection is not a file."); return { isValid: errors.length === 0, errors, fileName: basename(patchPath), bytes: info.size, operations: project ? [`Import ${basename(patchPath)} into the separate patch archive`, "Create backup before overwrite"] : [] }; } catch { errors.push("Patch file is unavailable or unreadable."); return { isValid: false, errors, fileName: null, bytes: null, operations: [] }; } }
  async importPatch(project: CatalogProject | undefined, patchPath: string): Promise<OperationResult> { const preview = await this.previewPatch(project, patchPath); if (!preview.isValid || !project) return { ok: false, message: preview.errors.join(" ") }; const destination = join(this.appRoot, "public", "patches", project.slug, preview.fileName!); const root = join(this.appRoot, "public", "patches", project.slug); if (!isInside(root, destination)) return { ok: false, message: "Invalid patch destination." }; await mkdir(root, { recursive: true }); try { await access(destination, constants.R_OK); const backup = join(this.userData, "patch-backups", new Date().toISOString().replace(/[:.]/g, "-"), project.slug, preview.fileName!); await mkdir(dirname(backup), { recursive: true }); await copyFile(destination, backup); } catch { /* New patch. */ } await copyFile(resolve(patchPath), destination); await this.record("Patch imported", `${project.name}: ${preview.fileName}`); return { ok: true, message: `Patch imported separately at ${destination}` }; }
  async createProjectZip(project: CatalogProject | undefined): Promise<OperationResult> { if (!project || project.folderStatus === "missing") return { ok: false, message: "Select a registered project with an available folder." }; const outputRoot = join(this.appRoot, "public", "downloads", "staged", project.slug); const output = join(outputRoot, `${project.slug}-source.zip`); await mkdir(outputRoot, { recursive: true }); const result = await this.run("tar.exe", ["-a", "-c", "-f", output, "-C", dirname(project.folder), basename(project.folder)], this.appRoot); await this.record("Project ZIP", result.ok ? `${project.name}: ${output}` : `${project.name}: ZIP creation failed`, result.ok ? "info" : "error"); return { ...result, message: result.ok ? `ZIP staged at ${output}. Select it in Release Publisher to publish.` : result.message }; }
  async buildProjectExecutable(project: CatalogProject | undefined): Promise<OperationResult> { if (!project || project.folderStatus === "missing") return { ok: false, message: "Select a registered project with an available folder." }; try { const manifest = JSON.parse(await readFile(join(project.folder, "package.json"), "utf8")) as { scripts?: Record<string, string> }; const script = ["package", "make", "dist"].find((name) => manifest.scripts?.[name]); if (!script) return { ok: false, message: "No package, make, or dist script is configured for this project." }; const result = await this.run("npm.cmd", ["run", script], project.folder); await this.record("Executable build", result.ok ? `${project.name}: npm run ${script}` : `${project.name}: executable build failed`, result.ok ? "info" : "error"); return { ...result, message: result.ok ? `Packaging command npm run ${script} completed. Choose the generated EXE in Release Publisher.` : result.message }; } catch { return { ok: false, message: "No readable package.json was found. Configure a packaging script to build an executable." }; } }
  async publishRelease(draft: ReleaseDraft, project: CatalogProject | undefined): Promise<OperationResult> { if (!project) return { ok: false, message: "Select a registered project." }; const artifact = resolve(draft.artifactPath); try { const info = await stat(artifact); if (!info.isFile()) return { ok: false, message: "Artifact is not a file." }; const releaseRoot = join(this.appRoot, "public", "downloads", "releases", project.slug); const destination = join(releaseRoot, artifact.split(/[\\/]/).pop()!); if (!isInside(releaseRoot, destination)) return { ok: false, message: "Invalid artifact destination." }; await mkdir(releaseRoot, { recursive: true }); try { await access(destination, constants.R_OK); const backup = join(this.userData, "release-backups", new Date().toISOString().replace(/[:.]/g, "-"), project.slug, artifact.split(/[\\/]/).pop()!); await mkdir(dirname(backup), { recursive: true }); await copyFile(destination, backup); } catch { /* New artifact. */ } await copyFile(artifact, destination); const metadataPath = join(this.appRoot, "src", "data", "publishing-catalog.json"); const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as { releases: unknown[] }; metadata.releases.push({ projectSlug: project.slug, version: draft.version, title: draft.title, channel: draft.channel, file: `downloads/releases/${project.slug}/${artifact.split(/[\\/]/).pop()}`, bytes: info.size, sha256: await digest(artifact), publishedAt: new Date().toISOString() }); await this.atomicJson(metadataPath, metadata); await this.record("Release created", `${project.name} ${draft.version}`); return { ok: true, message: "Release copied with backup and website metadata updated. Deployment remains manual." }; } catch (error) { await this.record("Release publish", String(error), "error"); return { ok: false, message: String(error) }; } }
  async scanTheme(project: CatalogProject | undefined): Promise<ThemeScan> { if (!project) throw new Error("Select a registered project."); const sourceRoot = join(this.appRoot, "theme-engine"); const files: ThemeFileState[] = await Promise.all(themeFiles.map(async ([source, destination]) => { const sourcePath = join(sourceRoot, source); const destinationPath = resolve(project.folder, destination); if (!isInside(resolve(project.folder), destinationPath)) throw new Error("Theme destination escaped the project folder."); try { await access(destinationPath, constants.R_OK); return { source, destination, status: await digest(sourcePath) === await digest(destinationPath) ? "current" : "outdated" }; } catch { return { source, destination, status: "missing" }; } })); return { projectId: project.id, projectName: project.name, files, ready: files.every((file) => file.status === "current") }; }
  async syncTheme(project: CatalogProject | undefined): Promise<OperationResult> { if (!project) return { ok: false, message: "Select a registered project." }; const scan = await this.scanTheme(project); const sourceRoot = join(this.appRoot, "theme-engine"); const backupRoot = join(project.folder, ".kcx-theme-backups", new Date().toISOString().replace(/[:.]/g, "-")); try { for (const [source, destination] of themeFiles) { const from = join(sourceRoot, source); const to = resolve(project.folder, destination); if (!isInside(resolve(project.folder), to)) throw new Error("Theme destination escaped the project folder."); try { await access(to, constants.R_OK); const backup = join(backupRoot, destination); await mkdir(dirname(backup), { recursive: true }); await copyFile(to, backup); } catch { /* New files do not need backups. */ } await mkdir(dirname(to), { recursive: true }); await copyFile(from, to); } await this.record("Theme sync", `${project.name}: ${scan.files.length} files synchronized`); return { ok: true, message: `Synchronized ${scan.files.length} theme files. Backup: ${backupRoot}` }; } catch (error) { await this.record("Theme sync", `${project.name}: ${String(error)}`, "error"); return { ok: false, message: String(error) }; } }
  private vercelCommand(): string {
    return join(
      this.appRoot,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "vercel.cmd" : "vercel",
    );
  }

  private async checkPublishedReleaseFiles(): Promise<{
    count: number;
    ready: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];

    try {
      const catalog = JSON.parse(
        await readFile(this.websiteCatalogPath(), "utf8"),
      ) as {
        releases?: Array<{
          file?: string;
          bytes?: number;
        }>;
      };

      const releases = Array.isArray(catalog.releases)
        ? catalog.releases
        : [];

      if (releases.length === 0) {
        return {
          count: 0,
          ready: false,
          errors: ["No published releases are present."],
        };
      }

      const releaseRoot = resolve(
        this.appRoot,
        "public",
        "downloads",
        "releases",
      );

      for (const release of releases) {
        if (!release.file) {
          errors.push("A published release has no file path.");
          continue;
        }

        const destination = resolve(
          this.appRoot,
          "public",
          ...release.file.split("/"),
        );

        if (!isInside(releaseRoot, destination)) {
          errors.push(
            `Published release path escapes the release directory: ${release.file}`,
          );
          continue;
        }

        try {
          const info = await stat(destination);

          if (!info.isFile()) {
            errors.push(
              `Published release is not a file: ${release.file}`,
            );
            continue;
          }

          if (info.size === 0) {
            errors.push(
              `Published release is empty: ${release.file}`,
            );
            continue;
          }

          if (
            typeof release.bytes === "number" &&
            info.size !== release.bytes
          ) {
            errors.push(
              `Published release size mismatch: ${release.file}`,
            );
          }
        } catch {
          errors.push(
            `Published release file is missing: ${release.file}`,
          );
        }
      }

      return {
        count: releases.length,
        ready: errors.length === 0,
        errors,
      };
    } catch (error) {
      return {
        count: 0,
        ready: false,
        errors: [
          `Publishing catalog could not be read: ${String(error)}`,
        ],
      };
    }
  }

  private async atomicJson(path: string, value: unknown): Promise<void> { await mkdir(dirname(path), { recursive: true }); const temp = `${path}.${randomUUID()}.tmp`; await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8"); await rename(temp, path); }
  private websiteCatalogPath(): string { return join(this.appRoot, "src", "data", "publishing-catalog.json"); }
  private async readWebsiteCatalog(): Promise<{ schemaVersion: number; products: WebsiteProduct[]; releases: unknown[]; categories: unknown[]; featuredProjectSlugs: string[]; archivedProjectSlugs: string[] }> { return JSON.parse(await readFile(this.websiteCatalogPath(), "utf8")) as { schemaVersion: number; products: WebsiteProduct[]; releases: unknown[]; categories: unknown[]; featuredProjectSlugs: string[]; archivedProjectSlugs: string[] }; }
  private run(command: string, args: string[], cwd: string): Promise<OperationResult> { return new Promise((resolveResult) => { const child = spawn(command, args, { cwd, shell: process.platform === "win32" && command.toLowerCase().endsWith(".cmd"), windowsHide: true }); let output = ""; child.stdout?.on("data", (chunk) => output += String(chunk)); child.stderr?.on("data", (chunk) => output += String(chunk)); child.on("error", (error) => resolveResult({ ok: false, message: error.message, output })); child.on("exit", (code) => resolveResult({ ok: code === 0, message: code === 0 ? "Completed" : `Failed with exit code ${code}`, output })); }); }
}
