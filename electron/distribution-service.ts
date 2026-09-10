import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import type {
  CatalogProject,
  DistributionCapabilities,
  DistributionPlan,
  DistributionProgress,
  DistributionRunResult,
  DistributionTarget,
  DistributionDiagnostic,
  DistributionArtifactMetadata,
  ArtifactKind,
} from "../src/shared/desktop";
import { analyzeScriptDependencies, inspectProject } from "./project-discovery";

type PackageJson = {
  [key: string]: unknown;
  version?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export function mergeElectronBuilderPackage(
  existing: Record<string, unknown>,
  projectName: string,
  projectSlug: string,
  electronVersion: string,
): { packageJson: Record<string, unknown>; conflicts: string[] } {
  const packageJson: Record<string, unknown> = structuredClone(existing);
  const conflicts: string[] = [];
  const scripts = { ...(isRecord(packageJson.scripts) ? packageJson.scripts : {}) } as Record<string, string>;
  const requiredScripts: Record<string, string> = {
    "package:win": "npm run build:electron && electron-builder --win portable",
    installer: "npm run build:electron && electron-builder --win nsis",
  };
  for (const [name, command] of Object.entries(requiredScripts)) {
    if (typeof scripts[name] === "string" && scripts[name] !== command) conflicts.push(`scripts.${name}`);
    else if (!(name in scripts)) scripts[name] = command;
  }
  packageJson.scripts = scripts;
  const devDependencies = { ...(isRecord(packageJson.devDependencies) ? packageJson.devDependencies : {}) } as Record<string, string>;
  if (!devDependencies["electron-builder"] && !(isRecord(packageJson.dependencies) && "electron-builder" in packageJson.dependencies)) devDependencies["electron-builder"] = "^26.15.3";
  packageJson.devDependencies = devDependencies;
  if (typeof packageJson.productName !== "string") packageJson.productName = projectName;
  const build = isRecord(packageJson.build) ? { ...packageJson.build } : {};
  const required: Record<string, unknown> = { productName: projectName, electronVersion, directories: { output: "release" }, files: ["dist/**/*", "dist-electron/**/*", "package.json"], win: { target: ["portable", "nsis"] }, nsis: { oneClick: false, allowToChangeInstallationDirectory: true } };
  for (const [key, value] of Object.entries(required)) {
    if (key in build && JSON.stringify(build[key]) !== JSON.stringify(value)) conflicts.push(`build.${key}`);
    else if (!(key in build)) build[key] = value;
  }
  packageJson.build = build;
  return { packageJson, conflicts };
}

export function createPackagingWorkspace(userData?: string): string {
  return join(userData || tmpdir(), "kcx-packaging", randomUUID());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

type ProgressCallback = (progress: DistributionProgress) => void;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function readPackageJson(root: string): Promise<PackageJson | null> {
  try {
    return JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    ) as PackageJson;
  } catch {
    return null;
  }
}

function extractExactVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const match = value.match(
    /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/,
  );

  return match?.[0] ?? null;
}
async function readAndroidVersion(
  root: string,
): Promise<string | null> {
  const candidates = [
    join(root, "app", "build.gradle.kts"),
    join(root, "app", "build.gradle"),
    join(root, "android", "app", "build.gradle.kts"),
    join(root, "android", "app", "build.gradle"),
  ];

  for (const candidate of candidates) {
    if (!(await exists(candidate))) continue;

    try {
      const text = await readFile(candidate, "utf8");

      const versionName =
        text.match(
          /versionName\s*(?:=)?\s*["']([^"']+)["']/,
        )?.[1];

      if (versionName) {
        return versionName.trim();
      }

      const versionCode =
        text.match(
          /versionCode\s*(?:=)?\s*(\d+)/,
        )?.[1];

      if (versionCode) {
        return `code-${versionCode}`;
      }
    } catch {
      // Try the next Gradle file.
    }
  }

  return null;
}
function hasScript(pkg: PackageJson | null, name: string): boolean {
  return Boolean(pkg?.scripts?.[name]);
}

function firstScript(
  pkg: PackageJson | null,
  names: string[],
): string | null {
  for (const name of names) {
    if (hasScript(pkg, name)) return name;
  }
  return null;
}

function packageRunner(manager: string | undefined): string {
  return manager === "pnpm" ? "pnpm.cmd" : manager === "yarn" ? "yarn.cmd" : manager === "bun" ? "bun.exe" : "npm.cmd";
}

function packageArgs(manager: string | undefined, script: string): string[] {
  return ["run", script];
}

function redactOutput(value: string): string {
  return value.replace(/(DATABASE_URL|API_KEY|TOKEN|SECRET|PASSWORD|ACCESS_KEY)\s*[=:]\s*[^\s]+/gi, "$1=[REDACTED]").replace(/https?:\/\/[^\s]*([?&](?:token|key|secret|password)=[^\s&]*)/gi, "[REDACTED_URL]");
}

export function artifactKind(target: DistributionTarget): ArtifactKind {
  if (target === "zip") return "project-archive";
  if (target === "source") return "source-archive";
  if (target === "installer") return "installer";
  return "application-binary";
}

export function artifactMetadata(project: CatalogProject, target: DistributionTarget, path: string, stagedPath?: string, backend?: string): DistributionArtifactMetadata {
  return { path, stagedPath, filename: basename(path), projectId: project.id, projectName: project.name, target, kind: artifactKind(target), runnable: !["zip", "source"].includes(target), platform: target === "apk" ? "android" : ["executable", "installer"].includes(target) ? "windows" : undefined, architecture: "unknown", backend, provenance: target === "zip" ? "project-archive" : target === "source" ? "git-archive" : backend ? "detected-backend" : "distribution-center" };
}

function scriptBlockReason(scripts: Record<string, string> | undefined, entry: string): string | null {
  if (!scripts) return null;
  const analysis = analyzeScriptDependencies(scripts, entry);
  if (analysis.missing.length) return `Missing local package script: ${analysis.missing.join(", ")}`;
  if (analysis.cycles.length) return `Circular package-script dependency: ${analysis.cycles[0].join(" -> ")}`;
  return null;
}

function safeElectronRepair(
  pkg: PackageJson | null,
  manager: string | undefined,
  target: DistributionTarget,
): { script: string; command: string; evidence: string[] } | null {
  if (!pkg?.scripts || !pkg.scripts[target === "installer" ? "installer" : "package:win"]) return null;
  const entry = pkg.scripts[target === "installer" ? "installer" : "package:win"];
  const missing = analyzeScriptDependencies(pkg.scripts, target === "installer" ? "installer" : "package:win").missing;
  if (!missing.includes("build:electron")) return null;
  const hasRenderer = typeof pkg.scripts["build:renderer"] === "string";
  const hasMain = typeof pkg.scripts["build:main"] === "string";
  if (!hasRenderer || !hasMain) return null;
  const runner = packageRunner(manager);
  return {
    script: "build:electron",
    command: `${runner} run build:renderer && ${runner} run build:main`,
    evidence: [
      `${target === "installer" ? "installer" : "package:win"} references build:electron`,
      "build:renderer exists",
      "build:main exists",
      `package manager detected as ${manager || "unknown"}`,
    ],
  };
}

export function scriptDiagnostic(
  target: DistributionTarget,
  scripts: Record<string, string>,
  entry: string,
  problem: string,
  architecture: string[],
): DistributionDiagnostic {
  const analysis = analyzeScriptDependencies(scripts, entry);
  const candidates = [] as DistributionDiagnostic["candidates"];
  if (analysis.missing.includes("build:electron") && scripts["build:renderer"] && scripts["build:main"]) {
    candidates.push({ id: "compose-existing-electron-builds", description: "Add the missing local script by composing the existing renderer and main/preload build scripts.", confidence: "high", evidence: ["build:renderer exists", "build:main exists"], assumptions: [], requiredChanges: ["Add build:electron without changing existing scripts"], filesAffected: ["package.json"], packagesRequired: [], commands: ["run build:renderer", "run build:main"], safeToApply: true, rejectionReasons: [] });
  }
  for (const name of ["build", "compile", "build:desktop"]) if (scripts[name] && !candidates.some((candidate) => candidate.id === name)) candidates.push({ id: `existing-${name}`, description: `Use existing ${name} as the missing Electron build dependency.`, confidence: "medium", evidence: [`scripts.${name} exists`], assumptions: ["The script produces the packaging backend's required Electron outputs"], requiredChanges: [`Wire ${name} into the broken command chain`], filesAffected: ["package.json"], packagesRequired: [], commands: ["run " + name], safeToApply: false, rejectionReasons: ["Output relationship is not proven from project metadata"] });
  const chain = [entry];
  const walk = (name: string, seen: Set<string>) => { for (const dep of analysis.references[name] || []) { chain.push(dep); if (!seen.has(dep)) { seen.add(dep); walk(dep, seen); } } };
  walk(entry, new Set([entry]));
  if (analysis.missing.length) chain.push("MISSING: " + analysis.missing.join(", "));
  if (analysis.cycles.length) chain.push("CYCLE: " + analysis.cycles[0].join(" -> "));
  return { target, problemType: analysis.cycles.length ? "SCRIPT_DEPENDENCY_CYCLE" : "MISSING_SCRIPT_DEPENDENCY", summary: problem, dependencyChain: chain, evidence: [`package.json scripts.${entry}`, ...analysis.missing.map((name) => `Referenced script ${name} is absent`)], detectedArchitecture: architecture, candidates, ambiguityReasons: candidates.length > 1 ? ["Multiple plausible build paths were found; output ownership is not proven."] : [], missingEvidence: candidates.length ? ["Proof that the candidate produces the packaging backend's expected output"] : ["A project-native command that proves the missing dependency's output"], recommendedNextStep: candidates.some((candidate) => candidate.safeToApply) ? "Preview the high-confidence repair before applying it." : "Clarify or configure the project's build pipeline manually." };
}

async function walkFiles(root: string): Promise<string[]> {
  if (!(await exists(root))) return [];

  const result: string[] = [];

  async function visit(folder: string) {
    const entries = await readdir(folder, { withFileTypes: true });

    for (const entry of entries) {
      const full = join(folder, entry.name);

      if (entry.isDirectory()) {
        await visit(full);
      } else if (entry.isFile()) {
        result.push(full);
      }
    }
  }

  await visit(root);
  return result;
}

export class DistributionService {
  constructor(
    private readonly appRoot: string,
    private readonly userData: string,
  ) {}

  async capabilities(
    project: CatalogProject | undefined,
  ): Promise<DistributionCapabilities> {
    if (!project || project.folderStatus === "missing") {
      throw new Error(
        "Select a registered project with an available folder.",
      );
    }

    const root = resolve(project.folder);
    const inspection = await inspectProject(root);
    const pkg = await readPackageJson(root);

    const desktopRoot = join(root, "apps", "desktop");
    const desktopPkg = await readPackageJson(desktopRoot);

    const electron =
      Boolean(pkg?.dependencies?.electron) ||
      Boolean(pkg?.devDependencies?.electron) ||
      Boolean(desktopPkg?.dependencies?.electron) ||
      Boolean(desktopPkg?.devDependencies?.electron) ||
      (await exists(join(root, "electron-builder.yml"))) ||
      (await exists(join(root, "electron-builder.yaml"))) ||
      (await exists(join(root, "electron-builder.json"))) ||
      (await exists(join(desktopRoot, "electron-builder.yml"))) ||
      (await exists(join(desktopRoot, "electron-builder.yaml"))) ||
      (await exists(join(desktopRoot, "electron-builder.json")));

    const capacitorRoot =
      (await exists(join(root, "capacitor.config.ts"))) ||
      (await exists(join(root, "capacitor.config.js"))) ||
      (await exists(join(root, "capacitor.config.json")));
    const androidWorkspace = join(root, "apps", "android");
    const workspaceCapacitor =
      (await exists(join(androidWorkspace, "capacitor.config.ts"))) ||
      (await exists(join(androidWorkspace, "capacitor.config.js"))) ||
      (await exists(join(androidWorkspace, "capacitor.config.json")));

    const capacitorAndroid =
      (capacitorRoot && (await exists(join(root, "android", "gradlew.bat")))) ||
      (workspaceCapacitor && (await exists(join(androidWorkspace, "android", "gradlew.bat"))));

    const nativeAndroid =
      (await exists(join(root, "gradlew.bat"))) &&
      (
        (await exists(join(root, "settings.gradle"))) ||
        (await exists(join(root, "settings.gradle.kts"))) ||
        (await exists(join(root, "build.gradle"))) ||
        (await exists(join(root, "build.gradle.kts")))
      );

    const webScript = firstScript(pkg, ["build:web", "build"]);

    const executableScript =
      firstScript(pkg, [
        "package",
        "make",
        "dist",
        "build:win",
        "electron:build",
        "package:win",
      ]) ??
      firstScript(desktopPkg, [
        "package",
        "make",
        "dist",
        "build:win",
        "electron:build",
        "package:win",
      ]);

    const installerScript =
      firstScript(pkg, [
        "dist",
        "make",
        "build:win",
        "installer",
        "package:win",
      ]) ??
      firstScript(desktopPkg, [
        "dist",
        "make",
        "build:win",
        "installer",
        "package:win",
      ]);

    const electronBackend = inspection.backends?.find((backend) => ["electron-builder", "electron-forge", "electron-packager"].includes(backend));
    const nativeExecutableBackend = inspection.backends?.find((backend) => ["tauri", "dotnet", "pyinstaller"].includes(backend));
    const installerBackend = electronBackend || (inspection.backends?.includes("tauri") ? "tauri" : undefined);
    return {
      projectId: project.id,
      projectName: project.name,
      projectFolder: root,
      web: Boolean(webScript),
      executable: (electron && (Boolean(executableScript) || Boolean(electronBackend))) || Boolean(nativeExecutableBackend),
      installer: (electron && (Boolean(installerScript) || Boolean(electronBackend))) || Boolean(installerBackend),
      apk: capacitorAndroid || nativeAndroid,
      zip: true,
      source: await exists(join(root, ".git")),
      projectTypes: inspection.projectTypes,
      backends: {
        web: webScript ? "web-script" : undefined,
        executable: (electronBackend || nativeExecutableBackend) as any,
        installer: installerBackend as any,
        apk: capacitorAndroid || nativeAndroid ? "gradle" : undefined,
        zip: "archive",
        source: "archive",
      },
    };
  }

  async preview(
    project: CatalogProject | undefined,
    target: DistributionTarget,
  ): Promise<DistributionPlan> {
    if (!project || project.folderStatus === "missing") {
      throw new Error(
        "Select a registered project with an available folder.",
      );
    }

    const root = resolve(project.folder);
    const inspection = await inspectProject(root);
    const electron = inspection.projectTypes?.includes("electron") ?? false;
    const pkg = await readPackageJson(root);
    const desktopRoot = join(root, "apps", "desktop");
    const desktopPkg = await readPackageJson(desktopRoot);
    const caps = await this.capabilities(project);

    const unsupported = (): DistributionPlan => ({
      projectId: project.id,
      projectName: project.name,
      target,
      supported: false,
      workingDirectory: root,
      command: null,
      args: [],
      expectedArtifacts: [],
      message: target === "web"
        ? "Web packaging is unsupported because no supported Web build command was detected in the inspected project evidence."
        : `${target} is not currently supported for this project because no supported packaging backend was detected.`,
      readiness: "unsupported",
      diagnostic: {
        target,
        problemType: "UNSUPPORTED_PROJECT_STRUCTURE",
        summary: target === "web"
          ? "No supported Web build command was detected."
          : `No supported ${target} packaging path was detected.`,
        dependencyChain: [],
        evidence: [
          `Detected project types: ${(inspection.projectTypes || []).join(", ") || "none"}`,
          `Detected packaging backends: ${(inspection.backends || []).join(", ") || "none"}`,
          `Package manager: ${inspection.packageManager || "unknown"}`,
          target === "web" ? "No build:web, build, or compile script was found." : `No backend for target ${target} was found.`,
        ],
        detectedArchitecture: inspection.projectTypes || [],
        candidates: [],
        ambiguityReasons: [],
        missingEvidence: target === "web" ? ["A deterministic Web build script and its output directory"] : [`A supported ${target} backend and deterministic output contract`],
        recommendedNextStep: target === "web" ? "Add or document a deterministic Web build command and output directory, then refresh inspection." : "Review the detected architecture and configure its native packaging tool manually, then refresh inspection.",
      },
    });
    const blocked = (message: string, command: string, args: string[], workingDirectory: string, diagnostic?: DistributionDiagnostic): DistributionPlan => ({
      projectId: project.id, projectName: project.name, target, supported: false, workingDirectory, command, args, expectedArtifacts: [], message, readiness: "blocked", blockedBy: message, diagnostic,
    });

    if (!caps[target]) return unsupported();

    switch (target) {
      case "zip":
        return {
          projectId: project.id,
          projectName: project.name,
          target,
          supported: true,
          workingDirectory: root,
          command: "tar.exe",
          args: ["clean-project-archive"],
          expectedArtifacts: [
            `public/downloads/staged/${project.slug}/${project.slug}-project.zip`,
          ],
          message:
            "Create a staged project ZIP excluding dependency, Git, cache, and build-output folders.",
        };

      case "source":
        return {
          projectId: project.id,
          projectName: project.name,
          target,
          supported: true,
          workingDirectory: root,
          command: "git",
          args: ["archive", "--format=zip", "HEAD"],
          expectedArtifacts: [
            `public/downloads/staged/${project.slug}/${project.slug}-git-source.zip`,
          ],
          message:
            "Create a clean source archive from committed Git HEAD. Uncommitted changes are not included.",
        };

      case "web": {
        const script = firstScript(pkg, ["build:web", "build", "compile"]);
        if (!script) return unsupported();
        const scriptProblem = scriptBlockReason(pkg?.scripts, script);
        if (scriptProblem) return blocked(scriptProblem, packageRunner(inspection.packageManager), packageArgs(inspection.packageManager, script), root, scriptDiagnostic(target, pkg?.scripts || {}, script, scriptProblem, inspection.projectTypes || []));

        return {
          projectId: project.id,
          projectName: project.name,
          target,
          supported: true,
          workingDirectory: root,
          command: packageRunner(inspection.packageManager),
          args: packageArgs(inspection.packageManager, script),
          expectedArtifacts: ["dist/**", "build/**", ".next/**"],
          message: `Run ${packageRunner(inspection.packageManager)} ${packageArgs(inspection.packageManager, script).join(" ")}.`,
          commandSource: "project-script",
        };
      }

      case "executable": {
        if (!electron) {
          const backend = inspection.backends?.find((value) => ["tauri", "dotnet", "pyinstaller"].includes(value));
          if (backend === "tauri") return { projectId: project.id, projectName: project.name, target, supported: true, workingDirectory: root, command: "cargo.exe", args: ["tauri", "build"], expectedArtifacts: ["src-tauri/target/release/bundle/**/*", "target/release/**/*"], message: "Run the existing Tauri packaging backend.", commandSource: "detected-backend" };
          if (backend === "dotnet") return { projectId: project.id, projectName: project.name, target, supported: true, workingDirectory: root, command: "dotnet.exe", args: ["publish"], expectedArtifacts: ["bin/**/publish/**/*"], message: "Run the detected .NET publish backend.", commandSource: "detected-backend" };
          if (backend === "pyinstaller") return { projectId: project.id, projectName: project.name, target, supported: true, workingDirectory: root, command: "pyinstaller.exe", args: ["pyinstaller.spec"], expectedArtifacts: ["dist/**/*.exe"], message: "Run the existing PyInstaller specification.", commandSource: "detected-backend" };
          return unsupported();
        }
        const rootScript = firstScript(pkg, [
          "package",
          "make",
          "dist",
          "build:win",
          "electron:build",
          "package:win",
        ]);

        const workspaceScript = firstScript(desktopPkg, [
          "package",
          "make",
          "dist",
          "build:win",
          "electron:build",
          "package:win",
        ]);

        const script = rootScript ?? workspaceScript;

        if (!script) {
          const backend = inspection.backends?.find((value) => ["electron-builder", "electron-forge", "electron-packager"].includes(value));
          if (!backend) return unsupported();
          const backendCommand = backend === "electron-forge" ? "make" : backend === "electron-packager" ? "package" : "build";
          return { projectId: project.id, projectName: project.name, target, supported: true, workingDirectory: rootScript ? root : desktopRoot, command: packageRunner(inspection.packageManager), args: packageArgs(inspection.packageManager, backendCommand), expectedArtifacts: ["release/**/*", "dist/**/*", "out/**/*"], message: `Run the detected ${backend} packaging backend.`, commandSource: "detected-backend" };
        }
        const scriptPackage = rootScript ? pkg : desktopPkg;
        const scriptProblem = scriptBlockReason(scriptPackage?.scripts, script);
        if (scriptProblem) return blocked(scriptProblem, packageRunner(inspection.packageManager), packageArgs(inspection.packageManager, script), rootScript ? root : desktopRoot, scriptDiagnostic(target, scriptPackage?.scripts || {}, script, scriptProblem, inspection.projectTypes || []));

        return {
          projectId: project.id,
          projectName: project.name,
          target,
          supported: true,
          workingDirectory: rootScript ? root : desktopRoot,
          command: packageRunner(inspection.packageManager),
          args: packageArgs(inspection.packageManager, script),
          expectedArtifacts: [
            "release/**/*.exe",
            "dist/**/*.exe",
            "out/**/*.exe",
          ],
          message: `Run ${packageRunner(inspection.packageManager)} ${packageArgs(inspection.packageManager, script).join(" ")}.`,
          commandSource: "project-script",
        };
      }

      case "installer": {
        if (!electron && inspection.backends?.includes("tauri")) return { projectId: project.id, projectName: project.name, target, supported: true, workingDirectory: root, command: "cargo.exe", args: ["tauri", "build"], expectedArtifacts: ["src-tauri/target/release/bundle/**/*"], message: "Run the existing Tauri installer backend.", commandSource: "detected-backend" };
        if (!electron) return unsupported();
        const rootScript = firstScript(pkg, [
          "installer",
          "dist",
          "make",
          "build:win",
          "package:win",
        ]);

        const workspaceScript = firstScript(desktopPkg, [
          "installer",
          "dist",
          "make",
          "build:win",
          "package:win",
        ]);

        const script = rootScript ?? workspaceScript;

        if (!script) {
          const backend = inspection.backends?.find((value) => ["electron-builder", "electron-forge"].includes(value));
          if (!backend) return unsupported();
          return { projectId: project.id, projectName: project.name, target, supported: true, workingDirectory: rootScript ? root : desktopRoot, command: packageRunner(inspection.packageManager), args: packageArgs(inspection.packageManager, backend === "electron-forge" ? "make" : "dist"), expectedArtifacts: ["release/**/*Setup*.exe", "release/**/*.msi", "dist/**/*Setup*.exe", "dist/**/*.msi"], message: `Run the detected ${backend} installer backend.`, commandSource: "detected-backend" };
        }
        const scriptPackage = rootScript ? pkg : desktopPkg;
        const scriptProblem = scriptBlockReason(scriptPackage?.scripts, script);
        if (scriptProblem) return blocked(scriptProblem, packageRunner(inspection.packageManager), packageArgs(inspection.packageManager, script), rootScript ? root : desktopRoot, scriptDiagnostic(target, scriptPackage?.scripts || {}, script, scriptProblem, inspection.projectTypes || []));

        return {
          projectId: project.id,
          projectName: project.name,
          target,
          supported: true,
          workingDirectory: rootScript ? root : desktopRoot,
          command: packageRunner(inspection.packageManager),
          args: packageArgs(inspection.packageManager, script),
          expectedArtifacts: [
            "release/**/*Setup*.exe",
            "release/**/*.msi",
            "dist/**/*Setup*.exe",
            "dist/**/*.msi",
          ],
          message: `Run ${packageRunner(inspection.packageManager)} ${packageArgs(inspection.packageManager, script).join(" ")}.`,
          commandSource: "project-script",
        };
      }

      case "apk":
        if (await exists(join(root, "android", "gradlew.bat"))) {
          return {
            projectId: project.id,
            projectName: project.name,
            target,
            supported: true,
            workingDirectory: join(root, "android"),
            command: "gradlew.bat",
            args: ["assembleDebug"],
            expectedArtifacts: ["app/build/outputs/apk/**/*.apk"],
            message: "Run Android Gradle assembleDebug.",
          };
        }

        if (await exists(join(root, "apps", "android", "android", "gradlew.bat"))) {
          return {
            projectId: project.id, projectName: project.name, target, supported: true,
            workingDirectory: join(root, "apps", "android", "android"),
            command: "gradlew.bat", args: ["assembleDebug"],
            expectedArtifacts: ["app/build/outputs/apk/**/*.apk"],
            message: "Run Android Gradle assembleDebug for apps/android.",
          };
        }

        if (await exists(join(root, "gradlew.bat"))) {
          return {
            projectId: project.id,
            projectName: project.name,
            target,
            supported: true,
            workingDirectory: root,
            command: "gradlew.bat",
            args: ["assembleDebug"],
            expectedArtifacts: ["app/build/outputs/apk/**/*.apk"],
            message: "Run Android Gradle assembleDebug.",
          };
        }

        return unsupported();
    }
  }

  async run(
    project: CatalogProject | undefined,
    target: DistributionTarget,
    onProgress: ProgressCallback,
  ): Promise<DistributionRunResult> {
    if (!project || project.folderStatus === "missing") {
      throw new Error(
        "Select a registered project with an available folder.",
      );
    }

    const plan = await this.preview(project, target);

    if (!plan.supported || !plan.command) {
      return {
        ok: false,
        message: plan.message,
        target,
        artifactPaths: [],
      };
    }

    const emit = (
      stage: DistributionProgress["stage"],
      progress: number,
      message: string,
      output?: string,
    ) => {
      onProgress({
        projectId: project.id,
        target,
        stage,
        progress,
        message,
        output,
      });
    };

    emit("queued", 5, `${target} build queued.`);
    emit("preparing", 15, "Preparing build environment.");

    const stagingRoot = join(
      this.appRoot,
      "public",
      "downloads",
      "staged",
      project.slug,
    );

    await mkdir(stagingRoot, { recursive: true });

    try {
      if (target === "zip") {
        const output = join(
          stagingRoot,
          `${project.slug}-project.zip`,
        );

        emit("building", 30, "Creating clean project ZIP.");

        const result = await this.runCommand(
          "tar.exe",
          [
            "-a",
            "-c",
            "-f",
            output,
            "--exclude=.git",
            "--exclude=node_modules",
            "--exclude=.venv",
            "--exclude=dist",
            "--exclude=build",
            "--exclude=out",
            "--exclude=coverage",
            "--exclude=.next",
            "--exclude=.vite",
            "-C",
            dirname(project.folder),
            basename(project.folder),
          ],
          this.appRoot,
          (outputText) =>
            emit("building", 50, "Creating clean project ZIP.", outputText),
        );

        if (!result.ok) {
          emit("failed", 100, result.message, result.output);
          return {
            ...result,
            target,
            artifactPaths: [],
          };
        }

        emit("staging", 85, "ZIP created in the staging area.");
        emit("complete", 100, "Project ZIP complete.");

        return {
          ok: true,
          message: `ZIP staged at ${output}`,
          output: result.output,
          target,
          artifactPaths: [output],
          artifacts: [artifactMetadata(project, target, output)],
        };
      }

      if (target === "source") {
        const output = join(
          stagingRoot,
          `${project.slug}-git-source.zip`,
        );

        emit("building", 30, "Creating source archive from Git HEAD.");

        const result = await this.runCommand(
          "git",
          [
            "archive",
            "--format=zip",
            `--output=${output}`,
            "HEAD",
          ],
          project.folder,
          (outputText) =>
            emit(
              "building",
              50,
              "Creating source archive from Git HEAD.",
              outputText,
            ),
        );

        if (!result.ok) {
          emit("failed", 100, result.message, result.output);

          return {
            ...result,
            target,
            artifactPaths: [],
          };
        }

        emit("staging", 85, "Source archive created in staging.");
        emit("complete", 100, "Source archive complete.");

        return {
          ok: true,
          message: `Source archive staged at ${output}`,
          output: result.output,
          target,
          artifactPaths: [output],
          artifacts: [artifactMetadata(project, target, output)],
        };
      }

      const startedAt = Date.now();

      emit(
        "building",
        25,
        `Running ${plan.command} ${plan.args.join(" ")}`,
      );

      const result = await this.runCommand(
        plan.command,
        plan.args,
        plan.workingDirectory,
        (outputText) =>
          emit(
            "building",
            55,
            `Running ${plan.command} ${plan.args.join(" ")}`,
            outputText,
          ),
      );

      if (!result.ok) {
        emit("failed", 100, result.message, result.output);

        return {
          ...result,
          target,
          artifactPaths: [],
        };
      }

      emit("collecting", 75, "Locating generated artifacts.");

      const generated = await this.collectArtifacts(
        plan.workingDirectory,
        target,
        startedAt,
      );

      const staged: string[] = [];

      if (
        target === "executable" ||
        target === "installer" ||
        target === "apk"
      ) {
        emit(
          "staging",
          85,
          "Replacing the staged artifact for this target and version.",
        );

        const buildPackage =
          await readPackageJson(plan.workingDirectory);

        const projectPackage =
          await readPackageJson(project.folder);

        const androidVersion =
          target === "apk"
            ? await readAndroidVersion(
                plan.workingDirectory,
              )
            : null;

        const version =
          androidVersion ??
          buildPackage?.version ??
          projectPackage?.version ??
          "unversioned";

        const versionStagingRoot = join(
          stagingRoot,
          target,
          version,
        );

        /*
         * Remove only the previous staged copy of this exact
         * project + target + version. Different versions and
         * different targets are preserved.
         */
        await rm(versionStagingRoot, {
          recursive: true,
          force: true,
        });

        await mkdir(versionStagingRoot, {
          recursive: true,
        });

        for (const source of generated) {
          const destination = join(
            versionStagingRoot,
            basename(source),
          );

          await copyFile(source, destination);
          staged.push(destination);
        }
      } else {
        staged.push(...generated);
      }

      emit(
        "complete",
        100,
        staged.length > 0
          ? `Build complete. ${staged.length} artifact(s) found.`
          : "Build complete. No concrete artifact file was automatically located.",
      );

      return {
        ...result,
        message:
          staged.length > 0
            ? `Build completed with ${staged.length} artifact(s).`
            : "Build completed successfully.",
        target,
        artifactPaths: staged,
        artifacts: staged.map((path) => artifactMetadata(project, target, path, path)),
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Distribution build failed.";

      emit("failed", 100, message);

      return {
        ok: false,
        message,
        target,
        artifactPaths: [],
      };
    }
  }

  async previewSetup(
    project: CatalogProject | undefined,
    target: DistributionTarget,
  ): Promise<import("../src/shared/desktop").DistributionSetupPlan> {
    if (!project || project.folderStatus === "missing") {
      throw new Error("Select a registered project with an available folder.");
    }

    const root = resolve(project.folder);
    const inspection = await inspectProject(root);

    if (!["executable", "installer", "apk"].includes(target)) {
      return {
        projectId: project.id,
        projectName: project.name,
        target,
        supported: false,
        detectedRoot: root,
        detectedKind: "not-configurable",
        changes: [],
        warnings: [],
        message: `${target} does not require setup planning.`,
      };
    }

    const workspaceRoot = join(root, "apps", "desktop");
    const workspacePkg = await readPackageJson(workspaceRoot);
    const rootPkg = await readPackageJson(root);

    if (target === "executable" || target === "installer") {
      const blockedPlan = await this.preview(project, target);
      const repairPackage = rootPkg?.scripts?.[target === "installer" ? "installer" : "package:win"] ? rootPkg : workspacePkg;
      const repair = safeElectronRepair(repairPackage, inspection.packageManager, target);
      if (blockedPlan.readiness === "blocked" && repair) {
        const packageRoot = repairPackage === workspacePkg ? workspaceRoot : root;
        return {
          projectId: project.id,
          projectName: project.name,
          target,
          supported: true,
          detectedRoot: packageRoot,
          detectedKind: "electron-repair-missing-script",
          changes: [{ kind: "modify", path: join(packageRoot, "package.json"), description: `Add the missing build:electron script as \\"${repair.command}\\" without changing the existing ${target} script.` }],
          warnings: ["Repair is based only on two existing, named build scripts.", "No existing script or packaging configuration will be overwritten.", "A backup is created before applying the repair."],
          message: `Repair available: ${blockedPlan.message}`,
          problem: blockedPlan.message,
          confidence: "high",
          evidence: repair.evidence,
          automaticSafe: true,
        };
      }
      if (blockedPlan.readiness === "blocked") {
        return {
          projectId: project.id, projectName: project.name, target, supported: false, detectedRoot: root, detectedKind: "ambiguous-electron-repair", changes: [],
          warnings: ["KCx Labs found no single unambiguous existing compilation pipeline."],
          message: `Manual action required: ${blockedPlan.message}`, problem: blockedPlan.message, confidence: "low", evidence: [], automaticSafe: false,
        };
      }
    }

    const electronRoot =
      Boolean(rootPkg?.dependencies?.electron) ||
      Boolean(rootPkg?.devDependencies?.electron);

    const electronWorkspace =
      Boolean(workspacePkg?.dependencies?.electron) ||
      Boolean(workspacePkg?.devDependencies?.electron);

    if (target === "executable" || target === "installer") {
      if (!electronRoot && !electronWorkspace) {
        const nativeBackend = inspection.backends?.find((backend) => ["tauri", "dotnet", "pyinstaller"].includes(backend));
        return {
          projectId: project.id,
          projectName: project.name,
          target,
          supported: false,
          detectedRoot: root,
          detectedKind: nativeBackend ? `native-${nativeBackend}` : "non-electron",
          changes: [],
          warnings: [
            nativeBackend ? `Existing ${nativeBackend} evidence is present, but no additional setup is required.` : "No supported Windows packaging backend was detected for this project architecture.",
          ],
          message:
            "KCx Labs will not convert this project to Electron. Use an existing supported backend or configure packaging manually.",
        };
      }

      const existingBackend = inspection.backends?.find((backend) => ["electron-builder", "electron-forge", "electron-packager"].includes(backend));
      if (existingBackend) {
        return {
          projectId: project.id, projectName: project.name, target, supported: false,
          detectedRoot: root, detectedKind: `electron-${existingBackend}`,
          changes: [], warnings: [],
          message: `Existing ${existingBackend} packaging backend detected. KCx Labs will use the project's configuration; no setup is required.`,
        };
      }

      const packageRoot = electronWorkspace ? workspaceRoot : root;

      return {
        projectId: project.id,
        projectName: project.name,
        target,
        supported: true,
        detectedRoot: packageRoot,
        detectedKind: electronWorkspace
          ? "electron-workspace"
          : "electron-project",
        changes: [
          {
            kind: "install",
            path: packageRoot,
            description:
              "Add electron-builder as a development packaging dependency.",
          },
          {
            kind: "modify",
            path: join(packageRoot, "package.json"),
            description:
              target === "installer"
                ? "Add Windows installer packaging scripts and electron-builder configuration."
                : "Add Windows executable packaging scripts and electron-builder configuration.",
          },
          {
            kind: "create",
            path: join(packageRoot, "release"),
            description:
              "Use a dedicated release output directory for generated Windows artifacts.",
          },
        ],
        warnings: [
          "Setup would modify the selected project's package configuration.",
          "Existing scripts and package metadata must be preserved.",
          "KCx Labs must create a backup before applying changes.",
        ],
        message:
          target === "installer"
            ? "Electron detected. KCx Labs can prepare Windows installer packaging."
            : "Electron detected. KCx Labs can prepare Windows executable packaging.",
      };
    }

    const capacitorConfig =
      (await exists(join(root, "capacitor.config.ts"))) ||
      (await exists(join(root, "capacitor.config.js"))) ||
      (await exists(join(root, "capacitor.config.json")));

    const nativeAndroid =
      (await exists(join(root, "gradlew.bat"))) ||
      (await exists(join(root, "android", "gradlew.bat")));

    if (nativeAndroid || capacitorConfig) {
      return {
        projectId: project.id,
        projectName: project.name,
        target,
        supported: true,
        detectedRoot: root,
        detectedKind: nativeAndroid
          ? "android-project"
          : "capacitor-project",
        changes: [
          {
            kind: "modify",
            path: root,
            description:
              "Complete or normalize the existing Android packaging configuration.",
          },
        ],
        warnings: [
          "Existing Android configuration must be preserved.",
        ],
        message:
          "Existing Android packaging evidence was detected and can be prepared.",
      };
    }

    return {
      projectId: project.id,
      projectName: project.name,
      target,
      supported: true,
      detectedRoot: root,
      detectedKind: "web-or-electron-without-android",
      changes: [
        {
          kind: "install",
          path: root,
          description:
            "Add Capacitor tooling required to create an Android application target.",
        },
        {
          kind: "create",
          path: join(root, "capacitor.config.ts"),
          description:
            "Create Capacitor application configuration.",
        },
        {
          kind: "create",
          path: join(root, "android"),
          description:
            "Generate the Android project and Gradle wrapper.",
        },
        {
          kind: "modify",
          path: join(root, "package.json"),
          description:
            "Add Android sync/build scripts without removing existing scripts.",
        },
      ],
      warnings: [
        "Android setup would add a new platform directory to the selected project.",
        "Application ID/package name must be chosen before setup is applied.",
        "The project's web build output must be identified before Capacitor can be finalized.",
        "KCx Labs must create a backup before applying changes.",
      ],
      message:
        "No Android target exists yet. KCx Labs can prepare a Capacitor Android target after review.",
    };
  }
  async applySetup(
    project: CatalogProject,
    target: DistributionTarget,
  ): Promise<import("../src/shared/desktop").DistributionSetupResult> {
    if (target !== "executable" && target !== "installer") {
      return {
        ok: false,
        message:
          "Automatic setup is currently implemented for Windows EXE/Installer targets only.",
        projectId: project.id,
        target,
        backupPath: null,
      };
    }

    const root = resolve(project.folder);
    const desktopRoot = join(root, "apps", "desktop");
    const inspection = await inspectProject(root);

    const desktopPkgPath = join(desktopRoot, "package.json");
    const rootPkgPath = join(root, "package.json");
    const lockPath = join(root, "package-lock.json");

    const desktopPkg = await readPackageJson(desktopRoot);
    const rootPkg = await readPackageJson(root);

    const electronWorkspace =
      Boolean(desktopPkg?.dependencies?.electron) ||
      Boolean(desktopPkg?.devDependencies?.electron);

    const electronRoot =
      Boolean(rootPkg?.dependencies?.electron) ||
      Boolean(rootPkg?.devDependencies?.electron);

    if (!electronWorkspace && !electronRoot) {
      return {
        ok: false,
        message: "No Electron project or Electron desktop workspace was detected.",
        projectId: project.id,
        target,
        backupPath: null,
      };
    }

    const packageRoot = electronWorkspace ? desktopRoot : root;
    const packagePath = electronWorkspace
      ? desktopPkgPath
      : rootPkgPath;

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-");

    const backupRoot = join(
      this.userData,
      "distribution-backups",
      timestamp,
      project.slug,
    );

    await mkdir(backupRoot, { recursive: true });

    const packageBackup = join(
      backupRoot,
      electronWorkspace
        ? "apps-desktop-package.json"
        : "package.json",
    );

    await copyFile(packagePath, packageBackup);

    if (await exists(lockPath)) {
      await copyFile(
        lockPath,
        join(backupRoot, "package-lock.json"),
      );
    }

    try {
      const parsed = JSON.parse(
        await readFile(packagePath, "utf8"),
      ) as Record<string, unknown> & {
        scripts?: Record<string, string>;
        build?: Record<string, unknown>;
      };

      const repair = safeElectronRepair(parsed, inspection.packageManager, target);
      if (repair) {
        parsed.scripts = { ...(parsed.scripts || {}), [repair.script]: repair.command };
      }

      const declaredElectron =
        (
          parsed.devDependencies as
            | Record<string, string>
            | undefined
        )?.electron ??
        (
          parsed.dependencies as
            | Record<string, string>
            | undefined
        )?.electron;

      const localInstalledElectron =
        await readPackageJson(
          join(packageRoot, "node_modules", "electron"),
        );

      const workspaceInstalledElectron =
        packageRoot !== root
          ? await readPackageJson(
              join(root, "node_modules", "electron"),
            )
          : null;

      const electronVersion =
        localInstalledElectron?.version ??
        workspaceInstalledElectron?.version ??
        extractExactVersion(declaredElectron);

      if (!electronVersion) {
        throw new Error(
          "KCx Labs could not determine an exact Electron version for packaging.",
        );
      }

      const merged = mergeElectronBuilderPackage(parsed, project.name, project.slug, electronVersion);
      if (merged.conflicts.length > 0) {
        throw new Error(`Existing packaging configuration conflicts with the proposed setup: ${merged.conflicts.join(", ")}`);
      }
      Object.keys(parsed).forEach((key) => delete parsed[key]);
      Object.assign(parsed, merged.packageJson);

      await writeFile(
        packagePath,
        `${JSON.stringify(parsed, null, 2)}\n`,
        "utf8",
      );

      const installArgs = electronWorkspace
        ? [
            "install",
            "--save-dev",
            "electron-builder",
            "-w",
            "apps/desktop",
          ]
        : [
            "install",
            "--save-dev",
            "electron-builder",
          ];

      const install = await this.runCommand(
        "npm.cmd",
        installArgs,
        root,
      );

      if (!install.ok) {
        await copyFile(packageBackup, packagePath);

        if (
          (await exists(join(backupRoot, "package-lock.json"))) &&
          (await exists(lockPath))
        ) {
          await copyFile(
            join(backupRoot, "package-lock.json"),
            lockPath,
          );
        }

        return {
          ok: false,
          message:
            `Packaging dependency installation failed. KCx Labs restored the modified package files. ${install.message}`,
          output: install.output,
          projectId: project.id,
          target,
          backupPath: backupRoot,
        };
      }

      /*
       * Validate the existing application build before reporting setup
       * successful. This does not package yet.
       */
      const build = await this.runCommand(
        "npm.cmd",
        ["run", "build"],
        root,
      );

      if (!build.ok) {
        return {
          ok: false,
          message:
            "Windows packaging was configured, but the project build failed. Review build output before packaging.",
          output: build.output,
          projectId: project.id,
          target,
          backupPath: backupRoot,
        };
      }

      return {
        ok: true,
        message:
          "Windows packaging configured successfully. EXE and Installer targets are ready to build.",
        output: build.output,
        projectId: project.id,
        target,
        backupPath: backupRoot,
      };
    } catch (error) {
      try {
        await copyFile(packageBackup, packagePath);

        const lockBackup = join(
          backupRoot,
          "package-lock.json",
        );

        if (
          (await exists(lockBackup)) &&
          (await exists(lockPath))
        ) {
          await copyFile(lockBackup, lockPath);
        }
      } catch {
        // Preserve the original setup failure below.
      }

      return {
        ok: false,
        message:
          error instanceof Error
            ? `Setup failed: ${error.message}`
            : "Windows packaging setup failed.",
        projectId: project.id,
        target,
        backupPath: backupRoot,
      };
    }
  }
  async projectStatus(
    project: CatalogProject | undefined,
  ): Promise<import("../src/shared/desktop").DistributionProjectStatus> {
    if (!project || project.folderStatus === "missing") {
      throw new Error("Select a registered project with an available folder.");
    }

    const capabilities = await this.capabilities(project);
    const inspection = await inspectProject(project.folder);
    const targets: DistributionTarget[] = [
      "web",
      "executable",
      "installer",
      "apk",
      "zip",
      "source",
    ];

    const configurable = new Set<DistributionTarget>([
      "executable",
      "installer",
      "apk",
    ]);

    return {
      projectId: project.id,
      projectName: project.name,
      projectTypes: inspection.projectTypes,
      backends: capabilities.backends,
      targets: await Promise.all(
        targets.map(async (target) => {
          const plan = await this.preview(project, target);

          if (capabilities[target] && plan.supported) {
            return {
              target,
              readiness: "ready" as const,
              reason: `${plan.message}${plan.command ? ` Command: ${plan.command} ${plan.args.join(" ")} (cwd: ${plan.workingDirectory})` : ""}`,
              canConfigure: false,
              canBuild: true,
            };
          }

          if (plan.readiness === "blocked") {
            const setup = await this.previewSetup(project, target);
            return {
              target,
              readiness: "blocked" as const,
              reason: `${plan.message}${setup.supported ? " Repair available after review." : " Manual action required."}`,
              canConfigure: setup.supported,
              canBuild: false,
              diagnostic: plan.diagnostic,
            };
          }

          if (configurable.has(target) && (target === "executable" || target === "installer") && inspection.projectTypes?.includes("electron") && !(inspection.backends?.some((backend) => ["electron-builder", "electron-forge", "electron-packager"].includes(backend)))) {
            return {
              target,
              readiness: "preparable" as const,
              reason: `Electron detected. No Windows packaging backend is configured. Recommended backend: electron-builder.`,
              canConfigure: true,
              canBuild: false,
            };
          }

          if (configurable.has(target)) {
            return {
              target,
              readiness: "needs-setup" as const,
              reason:
                target === "apk"
                  ? "Android packaging is not configured for this project yet."
                  : `${target} packaging is not configured for this project yet.`,
              canConfigure: true,
              canBuild: false,
            };
          }

          return {
            target,
            readiness: "unsupported" as const,
              reason: plan.message,
              canConfigure: false,
              canBuild: false,
              diagnostic: plan.diagnostic,
          };
        }),
      ),
    };
  }

  async workflow(
    project: CatalogProject | undefined,
    request: import("../src/shared/desktop").DistributionWorkflowRequest,
    onProgress: ProgressCallback,
  ): Promise<import("../src/shared/desktop").DistributionWorkflowResult> {
    if (!project || project.folderStatus === "missing") {
      return {
        ok: false,
        message: "Select a registered project with an available folder.",
        projectId: request.projectId,
        completedActions: [],
        artifactPaths: [],
      };
    }

    if (project.id !== request.projectId) {
      return {
        ok: false,
        message: "Distribution request does not match the selected project.",
        projectId: request.projectId,
        completedActions: [],
        artifactPaths: [],
      };
    }

    const completedActions: import("../src/shared/desktop").DistributionAction[] = [];
    const artifactPaths: string[] = [];
    const artifacts: DistributionArtifactMetadata[] = [];

    /*
     * Configuration, release publication, and deployment remain explicit
     * approval-gated operations. The orchestrator currently executes only
     * trusted build/stage operations.
     */
    if (request.actions.includes("configure")) {
      return {
        ok: false,
        message:
          "One or more selected targets need setup. Automatic project modification is not enabled yet.",
        projectId: project.id,
        completedActions,
        artifactPaths,
      };
    }

    if (request.actions.includes("build") || request.actions.includes("stage")) {
      for (const target of request.targets) {
        const result = await this.run(project, target, onProgress);

        if (!result.ok) {
          return {
            ok: false,
            message: `${target}: ${result.message}`,
            projectId: project.id,
            completedActions,
            artifactPaths,
            artifacts,
          };
        }

        artifactPaths.push(...result.artifactPaths);
        artifacts.push(...(result.artifacts || []));
      }

      if (request.actions.includes("build")) {
        completedActions.push("build");
      }

      if (request.actions.includes("stage")) {
        completedActions.push("stage");
      }
    }

    if (request.actions.includes("publish")) {
      return {
        ok: false,
        message:
          "Artifacts are ready for Release Publisher. Publishing still requires release metadata and explicit confirmation.",
        projectId: project.id,
        completedActions,
        artifactPaths,
      };
    }

    if (request.actions.includes("deploy")) {
      return {
        ok: false,
        message:
          "Deployment is not enabled yet. KCx Labs currently provides deployment readiness checks only.",
        projectId: project.id,
        completedActions,
        artifactPaths,
      };
    }

    return {
      ok: true,
      message: artifactPaths.length
        ? `Distribution workflow completed with ${artifactPaths.length} artifact(s).`
        : "Distribution workflow completed.",
      projectId: project.id,
      completedActions,
      artifactPaths,
      artifacts,
    };
  }
  private async collectArtifacts(
    root: string,
    target: DistributionTarget,
    startedAt: number,
  ): Promise<string[]> {
    if (target === "web") {
      const candidates = [
        join(root, "dist"),
        join(root, "build"),
        join(root, ".next"),
      ];

      const found: string[] = [];

      for (const candidate of candidates) {
        if (await exists(candidate)) found.push(candidate);
      }

      return found;
    }

    const roots =
      target === "apk"
        ? [
            join(root, "android", "app", "build", "outputs", "apk"),
            join(root, "app", "build", "outputs", "apk"),
          ]
        : [
            join(root, "release"),
            join(root, "dist"),
          join(root, "out"),
        ];

    // Monorepos and native backends commonly place output below a workspace.
    // Discover only shallow, named build roots so collection never walks
    // dependency trees or an entire registered project.
    const ignoredOutputFolders = new Set([".git", "node_modules", ".venv", "coverage", ".next", ".vite", "cache", "tmp"]);
    const outputNames = new Set(["release", "dist", "build", "out", "target", "outputs"]);
    const discoverRoots = async (folder: string, depth: number): Promise<void> => {
      if (depth > 3) return;
      const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory() || ignoredOutputFolders.has(entry.name)) continue;
        const child = join(folder, entry.name);
        if (outputNames.has(entry.name)) roots.push(child);
        else if (depth < 3 && (entry.name === "apps" || entry.name === "packages" || entry.name === "android" || entry.name === "desktop" || entry.name === "src-tauri")) await discoverRoots(child, depth + 1);
      }
    };
    await discoverRoots(root, 0);

    const allowedExtensions =
      target === "apk"
        ? new Set([".apk"])
        : target === "installer"
          ? new Set([".exe", ".msi"])
          : new Set([".exe"]);

    const matches: string[] = [];

    for (const candidateRoot of roots) {
      for (const file of await walkFiles(candidateRoot)) {
        if (!allowedExtensions.has(extname(file).toLowerCase())) continue;

        const normalizedFile = file.toLowerCase();
        const fileName = basename(file).toLowerCase();

        if (
          target === "executable" &&
          (
            normalizedFile.includes("win-unpacked") ||
            normalizedFile.includes("win-ia32-unpacked") ||
            normalizedFile.includes("win-arm64-unpacked") ||
            fileName === "elevate.exe"
          )
        ) {
          continue;
        }

        if (
          target === "installer" &&
          extname(file).toLowerCase() === ".exe" &&
          !fileName.includes("setup") &&
          !fileName.includes("installer")
        ) {
          continue;
        }

        const info = await stat(file);

        if (
          target === "apk" ||
          info.mtimeMs >= startedAt - 2000
        ) {
          matches.push(file);
        }
      }
    }

    return [...new Set(matches)];
  }

  private runCommand(
    command: string,
    args: string[],
    cwd: string,
    onOutput?: (output: string) => void,
  ): Promise<{
    ok: boolean;
    message: string;
    output?: string;
  }> {
    return new Promise((resolveResult) => {
      const child = spawn(command, args, {
        cwd,
        shell:
          process.platform === "win32" &&
          (
            command.toLowerCase().endsWith(".cmd") ||
            command.toLowerCase().endsWith(".bat")
          ),
        windowsHide: true,
      });

      let output = "";
      let settled = false;

      const append = (chunk: unknown) => {
        const text = String(chunk);
        output += text;
        onOutput?.(text);
      };

      child.stdout?.on("data", append);
      child.stderr?.on("data", append);

      child.on("error", (error) => {
        if (settled) return;
        settled = true;

        resolveResult({
          ok: false,
          message: `Command failed to start: ${command} ${args.join(" ")} (cwd: ${cwd}): ${error.message}`,
          output: redactOutput(output),
        });
      });

      child.on("exit", (code) => {
        if (settled) return;
        settled = true;

        const safeOutput = redactOutput(output);
        resolveResult({
          ok: code === 0,
          message:
            code === 0
              ? "Completed"
              : `Command failed: ${command} ${args.join(" ")} (cwd: ${cwd}), exit code ${code}. Relevant output: ${safeOutput.slice(-4000)}`,
          output: safeOutput,
        });
      });
    });
  }
}
