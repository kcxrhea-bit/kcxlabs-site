/**
 * Applies db/migrations/*.sql to the configured Neon database, in order, once.
 *
 *   npm run db:migrate           apply pending migrations
 *   npm run db:migrate -- --dry  list what would be applied, touch nothing
 *
 * Design notes:
 *   * Each migration file is executed as a single statement batch and already
 *     wraps itself in BEGIN/COMMIT, so a failure rolls back rather than leaving
 *     a half-applied schema.
 *   * `schema_migrations` records what has run. A file whose version is already
 *     recorded is skipped, which makes re-running safe.
 *   * Errors print the failing FILE and the database's message. The connection
 *     string is never printed.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env.mjs";
import { splitSqlStatements, withoutTransactionControls } from "./sql-statements.mjs";

loadEnvLocal();

const dryRun = process.argv.includes("--dry");
const migrationsDir = join(process.cwd(), "db", "migrations");

if (!existsSync(migrationsDir)) {
  console.error(`No migrations directory at db/migrations`);
  process.exit(1);
}

const files = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.log("No migration files found.");
  process.exit(0);
}

const connectionString = process.env.DATABASE_URL;
if (typeof connectionString !== "string" || connectionString.trim() === "") {
  console.error("DATABASE_URL is not set. Add it to .env.local (gitignored). See .env.example.");
  process.exit(1);
}

if (dryRun) {
  console.log("Dry run — nothing will be executed.\n");
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    console.log(`  ${version}`);
  }
  process.exit(0);
}

// Imported lazily so --dry works without the dependency resolving.
const { neon } = await import("@neondatabase/serverless");
const sql = neon(connectionString);

async function appliedVersions() {
  try {
    const rows = await sql`SELECT version FROM schema_migrations`;
    return new Set(rows.map((row) => row.version));
  } catch (error) {
    // The very first run has no schema_migrations table yet, which is expected.
    if (/relation .*schema_migrations.* does not exist/i.test(String(error?.message))) {
      return new Set();
    }
    throw error;
  }
}

const already = await appliedVersions();
let appliedCount = 0;

for (const file of files) {
  const version = file.replace(/\.sql$/, "");

  if (already.has(version)) {
    console.log(`  skip     ${version} (already applied)`);
    continue;
  }

  const source = readFileSync(join(migrationsDir, file), "utf8");
  const statements = withoutTransactionControls(splitSqlStatements(source));
  process.stdout.write(`  applying ${version} ... `);

  try {
    // Neon HTTP accepts one prepared statement per query. Submit all migration
    // statements as its documented atomic batch instead; the SQL file's own
    // BEGIN/COMMIT controls are omitted because this call owns the transaction.
    await sql.transaction(statements.map((statement) => sql.query(statement)));
    console.log("done");
    appliedCount += 1;
  } catch (error) {
    console.log("FAILED");
    // File name and database message only — never the connection string.
    console.error(`\nMigration ${file} failed:`);
    console.error(`  ${error?.message ?? error}`);
    if (error?.position) console.error(`  at character position ${error.position}`);
    process.exit(1);
  }
}

console.log(
  appliedCount === 0
    ? "\nNothing to apply — database is up to date."
    : `\nApplied ${appliedCount} migration(s).`,
);
