import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

export type ArtifactState = "BUILT" | "VALIDATING" | "VALIDATED" | "STAGED" | "PUBLISHED" | "DEPLOYED" | "FAILED";
export type ArtifactRecord = {
  id: string; projectId: string; projectName: string; target: string; platform?: string; architecture: string;
  filename: string; sourcePath: string; stagedPath?: string; bytes: number; sha256: string;
  builtAt: string; validatedAt?: string; validationStatus: ArtifactState; validationEvidence: string[];
  backend?: string; version?: string; publicationStatus: "NOT_PUBLISHED" | "PUBLISHING" | "PUBLISHED" | "DEPLOYED"; publicationDestination?: string; publicationReadiness?: { ready: boolean; reason: string }; reconciliationAvailable?: boolean; remoteObjectKey?: string; remoteSize?: number; remoteSha256?: string; remoteEtag?: string; publishedAt?: string;
};

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(path));
  return hash.digest("hex").toUpperCase();
}

export async function verifyArtifact(record: ArtifactRecord): Promise<ArtifactRecord> {
  const info = await stat(record.sourcePath).catch(() => null);
  if (!info?.isFile()) throw new Error(`Artifact is missing: ${record.sourcePath}`);
  if (info.size !== record.bytes) throw new Error(`Artifact size changed: expected ${record.bytes}, found ${info.size}`);
  const actual = await sha256(record.sourcePath);
  if (actual !== record.sha256.toUpperCase()) throw new Error(`Artifact hash mismatch: expected ${record.sha256}, found ${actual}`);
  const validationStatus = record.validationStatus === "BUILT" || record.validationStatus === "VALIDATING" ? "VALIDATED" : record.validationStatus;
  return { ...record, validationStatus, validatedAt: new Date().toISOString(), validationEvidence: [...record.validationEvidence, "file exists", "size matches", "SHA-256 matches"] };
}

export async function recoverStagedArtifact(record: ArtifactRecord, storageRoot: string): Promise<ArtifactRecord> {
  if (record.validationStatus !== "VALIDATED") throw new Error("Only a VALIDATED artifact may be recovered to STAGED.");
  if (!record.stagedPath) throw new Error("Artifact has no recorded staged path.");
  const expected = join(resolve(storageRoot), "artifacts", record.projectId, record.version ?? "unversioned", record.architecture, record.target, record.filename);
  const samePath = resolve(record.stagedPath).toLowerCase() === expected.toLowerCase();
  if (!samePath) throw new Error("Recorded staged path is not the canonical artifact location.");
  const verified = await verifyArtifact({ ...record, sourcePath: expected });
  return { ...verified, sourcePath: record.sourcePath, stagedPath: expected, validationStatus: "STAGED" };
}

export async function registerArtifact(input: Omit<ArtifactRecord, "id" | "bytes" | "sha256" | "validationStatus" | "publicationStatus" | "validationEvidence">): Promise<ArtifactRecord> {
  const info = await stat(input.sourcePath);
  const record: ArtifactRecord = { ...input, id: `${input.projectId}:${input.version ?? "unversioned"}:${input.target}:${input.architecture}:${basename(input.sourcePath)}`, bytes: info.size, sha256: await sha256(input.sourcePath), validationStatus: "VALIDATING", validationEvidence: [], publicationStatus: "NOT_PUBLISHED" };
  return verifyArtifact(record);
}

export async function stageArtifact(record: ArtifactRecord, storageRoot: string): Promise<ArtifactRecord> {
  if (record.validationStatus !== "VALIDATED") throw new Error("Only a VALIDATED artifact may be staged.");
  const stableRoot = resolve(storageRoot);
  const destination = join(stableRoot, "artifacts", record.projectId, record.version ?? "unversioned", record.architecture, record.target, record.filename);
  await mkdir(join(stableRoot, "artifacts", record.projectId, record.version ?? "unversioned", record.architecture, record.target), { recursive: true });
  try { await stat(destination); throw new Error(`Artifact already staged: ${destination}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await copyFile(record.sourcePath, destination);
  const staged = await verifyArtifact({ ...record, sourcePath: destination, stagedPath: destination, validationStatus: "VALIDATING" });
  return { ...staged, sourcePath: record.sourcePath, stagedPath: destination, validationStatus: "STAGED" };
}

export async function saveArtifact(record: ArtifactRecord, storageRoot: string): Promise<void> {
  await mkdir(storageRoot, { recursive: true });
  await writeFile(join(storageRoot, `${record.id.replace(/[^a-zA-Z0-9_.-]/g, "_")}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

export async function listArtifacts(storageRoot: string): Promise<ArtifactRecord[]> {
  const files = await readdir(storageRoot).catch(() => [] as string[]);
  const records: ArtifactRecord[] = [];
  for (const file of files.filter((name) => name.endsWith(".json"))) {
    try { records.push(JSON.parse(await readFile(join(storageRoot, file), "utf8")) as ArtifactRecord); } catch { /* Ignore incomplete registry records. */ }
  }
  return records;
}
