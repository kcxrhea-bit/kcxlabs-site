import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { basename, resolve } from "node:path";
import type { CatalogProject, ReleaseDraft, ReleasePreview } from "../src/shared/desktop";

async function sha256(filePath: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

export async function previewRelease(draft: ReleaseDraft, project: CatalogProject | undefined): Promise<ReleasePreview> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const artifactPath = resolve(draft.artifactPath);
  if (!project) errors.push("Select a registered project.");
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(draft.version.trim())) {
    errors.push("Version must use semantic version format, for example 1.2.3.");
  }
  if (!draft.title.trim()) errors.push("Release title is required.");
  if (!artifactPath) errors.push("Choose a release artifact.");

  try {
    const file = await stat(artifactPath);
    if (!file.isFile()) errors.push("The selected artifact is not a file.");
    if (file.size === 0) errors.push("The selected artifact is empty.");
    const hash = await sha256(artifactPath);
    if (!/\.(exe|msi|zip)$/i.test(artifactPath)) warnings.push("Artifact is not an installer or ZIP archive.");
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      artifact: { name: basename(artifactPath), path: artifactPath, bytes: file.size, sha256: hash },
      operations: project ? [
        `Validate ${basename(artifactPath)} for ${project.name}`,
        "Generate website metadata preview",
        "Build the website before an explicit future publish confirmation",
      ] : [],
    };
  } catch {
    errors.push("The selected artifact is unavailable or unreadable.");
    return { isValid: false, errors, warnings, artifact: null, operations: [] };
  }
}
