import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { NeonCleanupPreview, NeonCleanupResult, NeonStorageAnalysis, NeonStorageSettings, NeonStorageTable } from "../src/shared/desktop";

export const NEON_DATABASE = "neondb";
export const FREE_TIER_LIMIT_MB = 512;
export const CLEANUP_THRESHOLD_MB = 400;
export const PROTECTED_TABLES = ["owners", "schema_migrations", "snapcal_calendars", "snapcal_events", "media"] as const;
type Query = NeonQueryFunction<false, false>;
type Row = Record<string, unknown>;
const number = (value: unknown) => Number(value ?? 0) || 0;

function resolveDatabaseUrl(appRoot: string): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const envFile = readFileSync(join(appRoot, ".env.local"), "utf8");
    for (const line of envFile.split(/\r?\n/)) {
      const match = line.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const value = match[1].trim().replace(/^(["'])(.*)\1$/, "$2");
      return value || undefined;
    }
  } catch {
    // Packaged apps may not have a project-root .env.local. Fail closed below.
  }
  return undefined;
}

export class NeonStorageService {
  private readonly settingsPath: string;
  private readonly queryFactory: () => Query;
  constructor(userDataPath: string, appRoot: string, queryFactory?: () => Query) {
    this.settingsPath = join(userDataPath, "neon-storage-settings.json");
    this.queryFactory = queryFactory ?? (() => {
    const url = resolveDatabaseUrl(appRoot);
    if (!url) throw new Error("Neon storage is not configured.");
    return neon(url);
    });
  }

  async analysis(): Promise<NeonStorageAnalysis> {
    const sql = this.queryFactory();
    const db = await sql`SELECT current_database() AS database_name`;
    if (db[0]?.database_name !== NEON_DATABASE) throw new Error("Neon storage is connected to an unexpected database.");
    const [size, tables, migrations] = await Promise.all([
      sql`SELECT pg_database_size(current_database()) AS total_bytes`,
      sql`SELECT schemaname AS schema, relname AS table_name, pg_total_relation_size(relid) AS total_bytes, pg_relation_size(relid) AS table_bytes, pg_indexes_size(relid) AS index_bytes, n_live_tup AS approximate_row_count FROM pg_catalog.pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC`,
      sql`SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schema_migrations'`,
    ]);
    const totalBytes = number((size[0] as Row)?.total_bytes);
    const limit = FREE_TIER_LIMIT_MB * 1024 * 1024;
    const threshold = CLEANUP_THRESHOLD_MB * 1024 * 1024;
    const mapped: NeonStorageTable[] = (tables as Row[]).map((row) => ({ schema: String(row.schema), tableName: String(row.table_name), totalBytes: number(row.total_bytes), tableBytes: number(row.table_bytes), indexBytes: number(row.index_bytes), approximateRowCount: number(row.approximate_row_count), protected: PROTECTED_TABLES.includes(String(row.table_name) as typeof PROTECTED_TABLES[number]) }));
    return { databaseName: NEON_DATABASE, totalBytes, totalMb: totalBytes / 1024 / 1024, freeTierLimitBytes: limit, freeTierLimitMb: FREE_TIER_LIMIT_MB, cleanupThresholdBytes: threshold, cleanupThresholdMb: CLEANUP_THRESHOLD_MB, usedPercent: (totalBytes / limit) * 100, remainingBytes: Math.max(0, limit - totalBytes), remainingMb: Math.max(0, limit - totalBytes) / 1024 / 1024, thresholdReached: totalBytes >= threshold, schemaMigrations: number((migrations[0] as Row)?.count), tables: mapped };
  }
  async preview(): Promise<NeonCleanupPreview> { const a = await this.analysis(); return { databaseName: a.databaseName, currentBytes: a.totalBytes, thresholdBytes: a.cleanupThresholdBytes, candidates: [], estimatedReclaimBytes: 0, protectedTables: [...PROTECTED_TABLES], warnings: ["No predefined safe cleanup operation is currently available."], canClean: false, explanation: "No safe cleanup is currently available." }; }
  async cleanup(): Promise<NeonCleanupResult> { const preview = await this.preview(); return { ok: false, message: preview.explanation, analysis: await this.analysis(), reclaimedBytes: 0, candidatesRun: [] }; }
  async getSettings(): Promise<NeonStorageSettings> { try { const value = JSON.parse(await readFile(this.settingsPath, "utf8")) as Partial<NeonStorageSettings>; return { autoClean: value.autoClean === true }; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { autoClean: false }; throw new Error("Neon storage settings could not be read."); } }
  async setSettings(settings: NeonStorageSettings): Promise<NeonStorageSettings> { const value = { autoClean: settings.autoClean === true }; try { await mkdir(dirname(this.settingsPath), { recursive: true }); await writeFile(this.settingsPath, `${JSON.stringify(value)}\n`, "utf8"); return value; } catch { throw new Error("Neon storage settings could not be saved."); } }
}
