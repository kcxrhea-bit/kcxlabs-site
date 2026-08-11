import assert from "node:assert/strict";
import test from "node:test";
import { splitSqlStatements, withoutTransactionControls } from "../scripts/sql-statements.mjs";

test("SQL splitter preserves PostgreSQL dollar blocks, strings, and comments", () => {
  const statements = splitSqlStatements(`
    -- migration wrapper
    BEGIN;
    CREATE TABLE sample (value TEXT DEFAULT 'semi;colon');
    DO $$ BEGIN
      PERFORM 'inside; block';
    END $$;
    /* a ; comment */ INSERT INTO sample VALUES ('ok');
    COMMIT;
  `);

  assert.equal(statements.length, 5);
  assert.match(statements[2], /PERFORM 'inside; block'/);
  assert.deepEqual(withoutTransactionControls(statements).map((statement) => statement.replace(/\s+/g, " ").trim()), [
    "CREATE TABLE sample (value TEXT DEFAULT 'semi;colon')",
    "DO $$ BEGIN PERFORM 'inside; block'; END $$",
    "/* a ; comment */ INSERT INTO sample VALUES ('ok')",
  ]);
});
