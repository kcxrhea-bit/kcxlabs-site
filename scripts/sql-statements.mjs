/**
 * Split PostgreSQL source only at top-level semicolons.
 *
 * Migrations contain quoted strings, comments, and DO $$ ... $$ blocks, so a
 * regular-expression split would corrupt valid statements.
 */
export function splitSqlStatements(source) {
  const statements = [];
  let start = 0;
  let state = "normal";
  let dollarTag = "";

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (state === "line-comment") {
      if (char === "\n") state = "normal";
      continue;
    }

    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        index += 1;
        state = "normal";
      }
      continue;
    }

    if (state === "single-quote") {
      if (char === "'" && next === "'") {
        index += 1;
      } else if (char === "'") {
        state = "normal";
      }
      continue;
    }

    if (state === "double-quote") {
      if (char === '"' && next === '"') {
        index += 1;
      } else if (char === '"') {
        state = "normal";
      }
      continue;
    }

    if (state === "dollar-quote") {
      if (source.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        state = "normal";
      }
      continue;
    }

    if (char === "-" && next === "-") {
      index += 1;
      state = "line-comment";
      continue;
    }
    if (char === "/" && next === "*") {
      index += 1;
      state = "block-comment";
      continue;
    }
    if (char === "'") {
      state = "single-quote";
      continue;
    }
    if (char === '"') {
      state = "double-quote";
      continue;
    }
    if (char === "$") {
      const match = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) {
        dollarTag = match[0];
        index += dollarTag.length - 1;
        state = "dollar-quote";
        continue;
      }
    }
    if (char === ";") {
      const statement = source.slice(start, index).trim();
      if (statement !== "") statements.push(statement);
      start = index + 1;
    }
  }

  const trailing = source.slice(start).trim();
  if (trailing !== "") statements.push(trailing);
  return statements;
}

function withoutComments(statement) {
  return statement.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "").trim();
}

/** Remove migration-owned transaction controls; Neon owns the outer transaction. */
export function withoutTransactionControls(statements) {
  return statements.filter((statement) => !/^(BEGIN|COMMIT)$/i.test(withoutComments(statement)));
}
