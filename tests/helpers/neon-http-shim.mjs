/**
 * Local stand-in for Neon's SQL-over-HTTP endpoint, so the REAL
 * `@neondatabase/serverless` `neon()` driver (as bundled into
 * dist-electron/api-db.cjs — the same code production runs) can be exercised
 * against a local PostgreSQL server.
 *
 * Only the HTTPS hop is replaced. The driver's own query building, parameter
 * encoding, `transaction()` batching and result parsing all run unmodified.
 * The shim follows Neon's documented wire behavior:
 *  - single query: `{ query, params }` -> `{ fields, rows }` (raw text values, array mode)
 *  - batch: `{ queries: [...] }` -> run inside ONE transaction on one
 *    connection (BEGIN … COMMIT, ROLLBACK on error), honoring
 *    `Neon-Batch-Isolation-Level`; -> `{ results: [...] }`
 *  - errors: HTTP 400 with the Postgres error fields
 * Parameters are sent untyped (node-postgres sends OID 0), matching how
 * Neon's proxy forwards the driver's text-encoded params.
 */
import { createRequire } from "node:module";
import { join } from "node:path";

const ERROR_FIELDS = ["severity", "code", "detail", "hint", "position", "schema", "table", "column", "dataType", "constraint", "routine"];

export function installNeonHttpShim({ connectionString, driverDir }) {
  const require = createRequire(join(driverDir, "noop.js"));
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString, max: 12 });
  const raw = { getTypeParser: () => (value) => value };
  const stats = { requests: 0, batches: 0 };

  const run = (client, { query, params }) =>
    client.query({ text: query, values: params, rowMode: "array", types: raw }).then((result) => ({
      fields: result.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
      rows: result.rows,
      command: result.command,
      rowCount: result.rowCount,
    }));

  const errorResponse = (error) =>
    new Response(JSON.stringify(Object.fromEntries([["message", error.message], ...ERROR_FIELDS.map((k) => [k, error[k]])])), {
      status: 400,
      headers: { "content-type": "application/json" },
    });

  async function handle(body, headers) {
    stats.requests += 1;
    const client = await pool.connect();
    try {
      if (Array.isArray(body.queries)) {
        stats.batches += 1;
        const isolation = headers.get("neon-batch-isolation-level");
        const level = { ReadCommitted: "READ COMMITTED", RepeatableRead: "REPEATABLE READ", Serializable: "SERIALIZABLE", ReadUncommitted: "READ UNCOMMITTED" }[isolation];
        await client.query(level ? `BEGIN ISOLATION LEVEL ${level}` : "BEGIN");
        try {
          const results = [];
          for (const q of body.queries) results.push(await run(client, q));
          await client.query("COMMIT");
          return Response.json({ results });
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          return errorResponse(error);
        }
      }
      return Response.json(await run(client, body));
    } catch (error) {
      return errorResponse(error);
    } finally {
      client.release();
    }
  }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init.headers ?? {});
    // Only the driver's own SQL requests are intercepted (they always carry Neon-Connection-String).
    if (headers.has("neon-connection-string") && /\/sql(\?|$)/.test(String(url))) {
      stats.lastUrl = String(url);
      return handle(JSON.parse(init.body), headers);
    }
    return originalFetch(input, init);
  };

  return {
    stats,
    async uninstall() {
      globalThis.fetch = originalFetch;
      await pool.end();
    },
  };
}
