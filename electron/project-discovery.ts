import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { DiscoveredProject } from "../src/shared/desktop";

const ignored = new Set([".git", ".claude", ".codex", ".venv", ".training", "node_modules", "site-packages", "dist", "build", "out", ".next", ".vite", "coverage", "fixtures"]);
const manifests = ["package.json", "electron-builder.yml", "Cargo.toml", "pyproject.toml", "build.gradle", "build.gradle.kts", ".sln"];
const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";

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
