import { access, readdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { DiscoveredProject, DistributionCommand, PackagingBackend, ProjectType, ScriptDependencyAnalysis } from "../src/shared/desktop";

const ignored = new Set([".git", ".claude", ".codex", ".venv", ".training", "node_modules", "site-packages", "dist", "build", "out", ".next", ".vite", "coverage", "fixtures"]);
const manifests = ["package.json", "electron-builder.yml", "Cargo.toml", "pyproject.toml", "build.gradle", "build.gradle.kts", ".sln"];
const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
const has = async (path: string) => access(path, constants.R_OK).then(() => true).catch(() => false);
const packageManagers = [{ file: "pnpm-workspace.yaml", name: "pnpm" }, { file: "pnpm-lock.yaml", name: "pnpm" }, { file: "yarn.lock", name: "yarn" }, { file: "bun.lock", name: "bun" }, { file: "bun.lockb", name: "bun" }, { file: "package-lock.json", name: "npm" }];

function managerCommand(manager: string | undefined, script: string, cwd: string): DistributionCommand {
  const command = manager === "pnpm" ? "pnpm.cmd" : manager === "yarn" ? "yarn.cmd" : manager === "bun" ? "bun.exe" : "npm.cmd";
  return { intent: "web", script, command, args: manager === "yarn" ? ["run", script] : manager === "bun" ? ["run", script] : ["run", script], workingDirectory: cwd, evidence: `package.json scripts.${script}` };
}

export function resolveBuildCommands(root: string, pkg: { scripts?: Record<string, string>; packageManager?: string }, manager?: string): DistributionCommand[] {
  const scripts = pkg.scripts || {};
  const result: DistributionCommand[] = [];
  const add = (intent: DistributionCommand["intent"], names: string[]) => {
    const script = names.find((name) => typeof scripts[name] === "string");
    if (script) result.push({ ...managerCommand(manager, script, root), intent, evidence: `package.json scripts.${script}` });
  };
  add("web", ["build:web", "build", "compile"]);
  add("renderer", ["build:renderer", "build:web", "build:electron", "build"]);
  add("main", ["build:main", "build:electron", "electron:build", "build"]);
  add("executable", ["package:win", "package", "make", "dist", "build:win", "electron:build"]);
  add("installer", ["installer", "make", "dist", "build:win", "package:win"]);
  add("apk", ["android:build", "build:android"]);
  add("aab", ["android:bundle", "bundleRelease"]);
  return result;
}

function localScriptReferences(command: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /\b(?:npm\s+(?:run|run-script)|pnpm\s+run|yarn\s+run|bun\s+run)\s+([A-Za-z0-9:_-]+)/g,
    /(?:^|[;&|]\s*)(?:pnpm|yarn|bun)\s+([A-Za-z0-9:_-]+)(?=\s|$)/g,
  ];
  for (const pattern of patterns) for (const match of command.matchAll(pattern)) if (match[1] !== "run") found.add(match[1]);
  return [...found];
}

export function analyzeScriptDependencies(scripts: Record<string, string>, entry: string): ScriptDependencyAnalysis {
  const references: Record<string, string[]> = {};
  for (const [name, command] of Object.entries(scripts)) references[name] = localScriptReferences(command);
  const missing = new Set<string>(); const cycles: string[][] = []; const order: string[] = []; const visiting: string[] = []; const visited = new Set<string>();
  const visit = (name: string) => {
    if (!(name in scripts)) { missing.add(name); return; }
    const cycleAt = visiting.indexOf(name);
    if (cycleAt >= 0) { cycles.push([...visiting.slice(cycleAt), name]); return; }
    if (visited.has(name)) return;
    visiting.push(name);
    for (const dependency of references[name] || []) visit(dependency);
    visiting.pop(); visited.add(name); order.push(name);
  };
  visit(entry);
  return { entry, references, order, missing: [...missing], cycles, valid: missing.size === 0 && cycles.length === 0 };
}

export async function inspectProject(root: string): Promise<DiscoveredProject> {
  const folder = resolve(root); const markers: string[] = []; const types = new Set<ProjectType>(); const backends = new Set<PackagingBackend>();
  const pkgPath = join(folder, "package.json"); let pkg: { name?: string; packageManager?: string; scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; } = {};
  if (await has(pkgPath)) { markers.push("package.json"); try { pkg = JSON.parse(await readFile(pkgPath, "utf8")); } catch { /* reported as an incomplete candidate */ } }
  const files = ["electron-builder.yml", "electron-builder.yaml", "electron-builder.json", "forge.config.js", "forge.config.cjs", "electron-forge.config.js", "electron-packager.json", "vite.config.ts", "vite.config.js", "vite.config.mjs", "next.config.js", "next.config.mjs", "capacitor.config.ts", "capacitor.config.js", "capacitor.config.json", "Cargo.toml", "pyproject.toml", "requirements.txt", "pyinstaller.spec", "gradlew", "gradlew.bat", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts", ".sln"];
  for (const file of files) if (await has(join(folder, file))) markers.push(file);
  if ((await readdir(folder, { withFileTypes: true }).catch(() => [])).some((entry) => entry.isFile() && entry.name.endsWith(".csproj"))) markers.push(".csproj");
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (allDeps.electron || allDeps["electron-vite"] || markers.some((m) => m.startsWith("electron-")) || await has(join(folder, "electron"))) types.add("electron");
  if (allDeps.vite || allDeps.next || await has(join(folder, "vite.config.ts")) || await has(join(folder, "vite.config.js")) || await has(join(folder, "vite.config.mjs")) || await has(join(folder, "next.config.js")) || await has(join(folder, "next.config.mjs")) || Boolean(pkg.scripts?.build) || Boolean(pkg.scripts?.["build:web"])) types.add("web");
  if (allDeps.react) types.add("web");
  if (await has(join(folder, "capacitor.config.ts")) || await has(join(folder, "capacitor.config.js")) || await has(join(folder, "capacitor.config.json"))) { types.add("capacitor"); types.add("android"); }
  if (markers.includes("gradlew") || markers.includes("gradlew.bat") || markers.includes("build.gradle") || markers.includes("build.gradle.kts")) types.add("android");
  if (markers.includes("Cargo.toml")) { types.add("rust"); if (allDeps["@tauri-apps/api"] || await has(join(folder, "src-tauri"))) { types.add("tauri"); backends.add("tauri"); } }
  if (markers.includes("pyproject.toml") || markers.includes("requirements.txt")) types.add("python");
  if (markers.includes(".sln") || markers.some((m) => m.endsWith(".csproj"))) types.add("dotnet");
  const androidWorkspace = join(folder, "apps", "android");
  if (await has(join(androidWorkspace, "capacitor.config.ts")) || await has(join(androidWorkspace, "capacitor.config.js")) || await has(join(androidWorkspace, "android", "gradlew.bat")) || await has(join(androidWorkspace, "gradlew.bat"))) { types.add("android"); if (await has(join(androidWorkspace, "capacitor.config.ts")) || await has(join(androidWorkspace, "capacitor.config.js"))) types.add("capacitor"); backends.add("gradle"); }
  const desktopWorkspace = join(folder, "apps", "desktop");
  if (await has(join(desktopWorkspace, "package.json"))) types.add("electron");
  if (markers.some((m) => m.startsWith("electron-builder")) || allDeps["electron-builder"]) backends.add("electron-builder");
  if (markers.some((m) => m.includes("forge")) || allDeps["@electron-forge/cli"]) backends.add("electron-forge");
  if (markers.includes("electron-packager.json") || allDeps["electron-packager"]) backends.add("electron-packager");
  if (types.has("android")) backends.add("gradle");
  if (types.has("dotnet")) backends.add("dotnet");
  if (allDeps.pyinstaller || await has(join(folder, "pyinstaller.spec"))) backends.add("pyinstaller");
  const declaredManager = pkg.packageManager?.split("@")[0];
  const manager = (["npm", "pnpm", "yarn", "bun"].includes(declaredManager || "") ? declaredManager : undefined) ?? (await Promise.all(packageManagers.map(async (candidate) => await has(join(folder, candidate.file)) ? candidate.name : null))).find(Boolean) ?? (await has(pkgPath) ? "npm" : undefined);
  return { name: pkg.name || basename(folder), slug: slugify(pkg.name || basename(folder)), folder, markers, packageName: pkg.name, projectTypes: [...types], packageManager: manager, backends: [...backends], commands: resolveBuildCommands(folder, pkg, manager) };
}

export async function scanForProjects(root: string, maxDepth = 7): Promise<DiscoveredProject[]> {
  const rootPath = resolve(root); const found: DiscoveredProject[] = [];
  async function visit(folder: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try { entries = await readdir(folder, { withFileTypes: true, encoding: "utf8" }); } catch { return; }
    const markers = entries.filter((entry) => entry.isFile() && (manifests.includes(entry.name) || entry.name.endsWith(".sln"))).map((entry) => entry.name);
    if (markers.length) {
      let packageName: string | undefined;
      if (markers.includes("package.json")) { try { packageName = (JSON.parse(await readFile(join(folder, "package.json"), "utf8")) as { name?: string }).name; } catch { /* Invalid manifests remain candidates for user review. */ } }
      const name = packageName || basename(folder); found.push({ name, slug: slugify(name), folder, markers, packageName });
    }
    await Promise.all(entries.filter((entry) => entry.isDirectory() && !ignored.has(entry.name)).map((entry) => visit(join(folder, entry.name), depth + 1)));
  }
  await visit(rootPath, 0);
  return found.sort((left, right) => left.folder.localeCompare(right.folder));
}
