import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { neon } from "@neondatabase/serverless";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const result = {};

  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) continue;

    const equals = line.indexOf("=");
    if (equals <= 0) continue;

    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

function formatBytes(bytes) {
  const value = Number(bytes);

  if (!Number.isFinite(value)) return "unknown";
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(2)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(2)} MB`;

  return `${(value / 1024 ** 3).toFixed(3)} GB`;
}

const envPath = path.resolve(process.cwd(), ".env.local");
const fileEnv = loadEnvFile(envPath);

const databaseUrl =
  process.env.DATABASE_URL ||
  fileEnv.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL was not found in the process environment or .env.local."
  );
}

const sql = neon(databaseUrl);

  const [database] = await sql`
    SELECT
      current_database() AS database_name,
      pg_database_size(current_database())::bigint AS total_bytes
  `;

  const tables = await sql`
    SELECT
      schemaname,
      relname AS table_name,
      n_live_tup::bigint AS estimated_rows,
      pg_relation_size(
        quote_ident(schemaname) || '.' || quote_ident(relname)
      )::bigint AS table_bytes,
      pg_indexes_size(
        quote_ident(schemaname) || '.' || quote_ident(relname)
      )::bigint AS index_bytes,
      pg_total_relation_size(
        quote_ident(schemaname) || '.' || quote_ident(relname)
      )::bigint AS total_bytes
    FROM pg_stat_user_tables
    ORDER BY total_bytes DESC, relname ASC
  `;

  const columns = await sql`
    SELECT
      table_schema,
      table_name,
      column_name,
      data_type,
      is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `;

  const thresholdBytes = 400 * 1024 * 1024;
  const warningBytes = 300 * 1024 * 1024;
  const cleanupRecommendBytes = 350 * 1024 * 1024;

  const expectedDatabase = "neondb";

  if (database.database_name !== expectedDatabase) {
    throw new Error(
      `SAFETY STOP: Expected Neon database "${expectedDatabase}" but connected to "${database.database_name}". No cleanup operations are allowed against this database.`
    );
  }

  const totalBytes = Number(database.total_bytes);

  let status = "NORMAL";

  if (totalBytes >= thresholdBytes) {
    status = "AUTO CLEANUP THRESHOLD";
  } else if (totalBytes >= cleanupRecommendBytes) {
    status = "SAFE CLEANUP RECOMMENDED";
  } else if (totalBytes >= warningBytes) {
    status = "WARNING";
  }

  console.log("");
  console.log("=== NEON STORAGE ===");
  console.log(`Database:   ${database.database_name}`);
  console.log(`Size:       ${formatBytes(totalBytes)}`);
  console.log(`Threshold:  ${formatBytes(thresholdBytes)}`);
  console.log(`Status:     ${status}`);
  console.log("");

  console.log("=== TABLE SIZES ===");

  for (const row of tables) {
    console.log(
      [
        row.table_name.padEnd(34),
        formatBytes(row.total_bytes).padStart(12),
        `rows≈${String(row.estimated_rows).padStart(8)}`,
      ].join("  ")
    );
  }

  console.log("");
  console.log("=== PUBLIC TABLE COLUMNS ===");

  let lastTable = null;

  for (const row of columns) {
    if (row.table_name !== lastTable) {
      console.log("");
      console.log(`[${row.table_name}]`);
      lastTable = row.table_name;
    }

    console.log(
      `  ${row.column_name} :: ${row.data_type} :: nullable=${row.is_nullable}`
    );
  }

  console.log("");
  console.log("READ-ONLY ANALYSIS COMPLETE.");
  console.log("No rows were deleted or modified.");
