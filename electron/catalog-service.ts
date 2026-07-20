import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import type { CatalogProject, NewCatalogProject } from "../src/shared/desktop";

type CatalogDocument = { schemaVersion: 1; projects: CatalogProject[] };

const emptyCatalog = (): CatalogDocument => ({ schemaVersion: 1, projects: [] });

export class CatalogService {
  constructor(private readonly filePath: string) {}

  async list(): Promise<CatalogProject[]> {
    const document = await this.read();
    return Promise.all(document.projects.map(async (project) => ({
      ...project,
      folderStatus: await this.folderStatus(project.folder),
    })));
  }

  async add(input: NewCatalogProject): Promise<CatalogProject> {
    const name = input.name.trim();
    const slug = input.slug.trim().toLowerCase();
    const folder = input.folder.trim();
    if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !folder) {
      throw new Error("Project name, a lowercase slug, and a folder path are required.");
    }

    const document = await this.read();
    if (document.projects.some((project) => project.slug === slug)) {
      throw new Error(`A project with slug '${slug}' is already registered.`);
    }

    const project: CatalogProject = {
      id: crypto.randomUUID(),
      name,
      slug,
      folder,
      description: input.description.trim(),
      category: input.category.trim() || "Uncategorized",
      currentVersion: input.currentVersion.trim() || "Unreleased",
      releaseChannel: input.releaseChannel,
      websiteVisible: input.websiteVisible,
      downloadVisible: input.downloadVisible,
      folderStatus: await this.folderStatus(folder),
      createdAt: new Date().toISOString(),
    };
    document.projects.push(project);
    await this.write(document);
    return project;
  }

  private async read(): Promise<CatalogDocument> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const document = JSON.parse(raw) as CatalogDocument;
      if (document.schemaVersion !== 1 || !Array.isArray(document.projects)) throw new Error("Unsupported catalog format.");
      return document;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyCatalog();
      throw error;
    }
  }

  private async write(document: CatalogDocument): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.filePath);
  }

  private async folderStatus(folder: string): Promise<CatalogProject["folderStatus"]> {
    try {
      await access(folder, constants.R_OK);
      return "available";
    } catch {
      return "missing";
    }
  }
}

export function createCatalogService(userDataPath: string): CatalogService {
  return new CatalogService(join(userDataPath, "catalog.json"));
}
