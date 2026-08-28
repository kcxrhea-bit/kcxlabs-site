import { spawn } from "node:child_process";
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
} from "../src/shared/desktop";

type PackageJson = {
  version?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

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

    const capacitorAndroid =
      capacitorRoot &&
      (await exists(join(root, "android", "gradlew.bat")));

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

    return {
      projectId: project.id,
      projectName: project.name,
      projectFolder: root,
      web: Boolean(webScript),
      executable: electron && Boolean(executableScript),
      installer: electron && Boolean(installerScript),
      apk: capacitorAndroid || nativeAndroid,
      zip: true,
      source: await exists(join(root, ".git")),
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
      message: `${target} is not currently supported for this project.`,
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
        const script = firstScript(pkg, ["build:web", "build"]);
        if (!script) return unsupported();

        return {
          projectId: project.id,
          projectName: project.name,
          target,
          supported: true,
          workingDirectory: root,
          command: "npm.cmd",
          args: ["run", script],
          expectedArtifacts: ["dist/**", "build/**", ".next/**"],
          message: `Run npm run ${script}.`,
        };
      }

      case "executable": {
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

        if (!script) return unsupported();

        return {
          projectId: project.id,
          projectName: project.name,
          target,
          supported: true,
          workingDirectory: rootScript ? root : desktopRoot,
          command: "npm.cmd",
          args: ["run", script],
          expectedArtifacts: [
            "release/**/*.exe",
            "dist/**/*.exe",
            "out/**/*.exe",
          ],
          message: `Run npm run ${script}.`,
        };
      }

      case "installer": {
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

        if (!script) return unsupported();

        return {
          projectId: project.id,
          projectName: project.name,
          target,
          supported: true,
          workingDirectory: rootScript ? root : desktopRoot,
          command: "npm.cmd",
          args: ["run", script],
          expectedArtifacts: [
            "release/**/*Setup*.exe",
            "release/**/*.msi",
            "dist/**/*Setup*.exe",
            "dist/**/*.msi",
          ],
          message: `Run npm run ${script}.`,
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

    const electronRoot =
      Boolean(rootPkg?.dependencies?.electron) ||
      Boolean(rootPkg?.devDependencies?.electron);

    const electronWorkspace =
      Boolean(workspacePkg?.dependencies?.electron) ||
      Boolean(workspacePkg?.devDependencies?.electron);

    if (target === "executable" || target === "installer") {
      if (!electronRoot && !electronWorkspace) {
        return {
          projectId: project.id,
          projectName: project.name,
          target,
          supported: false,
          detectedRoot: root,
          detectedKind: "non-electron",
          changes: [],
          warnings: [
            "No Electron application was detected at the project root or apps/desktop.",
          ],
          message:
            "KCx Labs cannot safely prepare Windows Electron packaging for this project yet.",
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

      const scripts = {
        ...(parsed.scripts ?? {}),
      };

      /*
       * Both targets are configured together. One setup pass should make
       * Windows portable EXE and installer production available.
       */
      scripts["package:win"] =
        "npm run build && electron-builder --win portable";

      scripts["installer"] =
        "npm run build && electron-builder --win nsis";

      parsed.scripts = scripts;

      parsed.productName =
        typeof parsed.productName === "string"
          ? parsed.productName
          : project.name;

      parsed.build = {
        ...(parsed.build ?? {}),
        appId: `org.kcxlabs.${project.slug.replace(/[^a-z0-9]/g, "")}`,
        productName: project.name,
        electronVersion,
        directories: {
          output: "release",
        },
        files: [
          "dist/**/*",
          "package.json",
        ],
        win: {
          target: [
            "portable",
            "nsis",
          ],
        },
        nsis: {
          oneClick: false,
          allowToChangeInstallationDirectory: true,
        },
      };

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
      targets: await Promise.all(
        targets.map(async (target) => {
          const plan = await this.preview(project, target);

          if (capabilities[target] && plan.supported) {
            return {
              target,
              readiness: "ready" as const,
              reason: plan.message,
              canConfigure: false,
              canBuild: true,
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
          };
        }

        artifactPaths.push(...result.artifactPaths);
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

    return matches;
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
          message: error.message,
          output,
        });
      });

      child.on("exit", (code) => {
        if (settled) return;
        settled = true;

        resolveResult({
          ok: code === 0,
          message:
            code === 0
              ? "Completed"
              : `Failed with exit code ${code}`,
          output,
        });
      });
    });
  }
}
