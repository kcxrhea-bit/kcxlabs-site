import { access, readdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { DiscoveredProject, PackagingBackend, ProjectType } from "../src/shared/desktop";

const ignored = new Set([".git", ".claude", ".codex", ".venv", ".training", "node_modules", "site-packages", "dist", "build", "out", ".next", ".vite", "coverage", "fixtures"]);
const manifests = ["package.json", "electron-builder.yml", "Cargo.toml", "pyproject.toml", "build.gradle", "build.gradle.kts", ".sln"];
const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
const has = async (path: string) => access(path, constants.R_OK).then(() => true).catch(() => false);
const packageManagers = [{ file: "pnpm-lock.yaml", name: "pnpm" }, { file: "yarn.lock", name: "yarn" }, { file: "bun.lockb", name: "bun" }, { file: "package-lock.json", name: "npm" }];

export async function inspectProject(root: string): Promise<DiscoveredProject> {
  const folder = resolve(root); const markers: string[] = []; const types = new Set<ProjectType>(); const backends = new Set<PackagingBackend>();
  const pkgPath = join(folder, "package.json"); let pkg: { name?: string; scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; } = {};
  if (await has(pkgPath)) { markers.push("package.json"); try { pkg = JSON.parse(await readFile(pkgPath, "utf8")); } catch { /* reported as an incomplete candidate */ } }
  const files = ["electron-builder.yml", "electron-builder.yaml", "electron-builder.json", "forge.config.js", "forge.config.cjs", "electron-forge.config.js", "electron-packager.json", "vite.config.ts", "vite.config.js", "capacitor.config.ts", "capacitor.config.js", "Cargo.toml", "pyproject.toml", "gradlew", "gradlew.bat", "build.gradle", "build.gradle.kts", ".sln"];
  for (const file of files) if (await has(join(folder, file))) markers.push(file);
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (allDeps.electron || markers.some((m) => m.startsWith("electron-")) || await has(join(folder, "electron"))) types.add("electron");
  if (allDeps.vite || await has(join(folder, "vite.config.ts")) || await has(join(folder, "vite.config.js"))) types.add("web");
  if (allDeps.react || await has(join(folder, "src"))) types.add("web");
  if (await has(join(folder, "capacitor.config.ts")) || await has(join(folder, "capacitor.config.js")) || await has(join(folder, "capacitor.config.json"))) { types.add("capacitor"); types.add("android"); }
  if (markers.includes("gradlew") || markers.includes("gradlew.bat") || markers.includes("build.gradle") || markers.includes("build.gradle.kts")) types.add("android");
  if (markers.includes("Cargo.toml")) { types.add("rust"); if (allDeps["@tauri-apps/api"] || await has(join(folder, "src-tauri"))) { types.add("tauri"); backends.add("tauri"); } }
  if (markers.includes("pyproject.toml")) types.add("python");
  if (markers.includes(".sln")) types.add("dotnet");
  const androidWorkspace = join(folder, "apps", "android");
  if (await has(join(androidWorkspace, "capacitor.config.ts")) || await has(join(androidWorkspace, "capacitor.config.js")) || await has(join(androidWorkspace, "android", "gradlew.bat")) || await has(join(androidWorkspace, "gradlew.bat"))) { types.add("android"); if (await has(join(androidWorkspace, "capacitor.config.ts")) || await has(join(androidWorkspace, "capacitor.config.js"))) types.add("capacitor"); backends.add("gradle"); }
  const desktopWorkspace = join(folder, "apps", "desktop");
  if (await has(join(desktopWorkspace, "package.json"))) types.add("electron");
  if (markers.some((m) => m.startsWith("electron-builder")) || allDeps["electron-builder"]) backends.add("electron-builder");
  if (markers.some((m) => m.includes("forge")) || allDeps["@electron-forge/cli"]) backends.add("electron-forge");
  if (markers.includes("electron-packager.json") || allDeps["electron-packager"]) backends.add("electron-packager");
  if (types.has("android")) backends.add("gradle");
  if (allDeps.pyinstaller || await has(join(folder, "pyinstaller.spec"))) backends.add("pyinstaller");
  const manager = (await Promise.all(packageManagers.map(async (candidate) => await has(join(folder, candidate.file)) ? candidate.name : null))).find(Boolean) ?? (await has(pkgPath) ? "npm" : undefined);
  return { name: pkg.name || basename(folder), slug: slugify(pkg.name || basename(folder)), folder, markers, packageName: pkg.name, projectTypes: [...types], packageManager: manager, backends: [...backends] };
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
