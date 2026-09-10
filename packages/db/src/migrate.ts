import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

function drizzleDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "../drizzle"),
    join(here, "../../drizzle"),
    join(process.cwd(), "packages/db/drizzle"),
  ];
  const path = candidates.find((item) => existsSync(item));
  if (!path) {
    throw new Error("Could not find packages/db/drizzle");
  }
  return path;
}

export async function migrate(url: string) {
  const sql = postgres(url, { max: 1 });
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const dir = drizzleDir();
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const applied = await sql<{ id: string }[]>`
      SELECT id FROM schema_migrations WHERE id = ${file}
    `;
    if (applied[0]) {
      continue;
    }
    const migration = readFileSync(join(dir, file), "utf8")
      .replace(/^\s*BEGIN\s*;/i, "")
      .replace(/\bCOMMIT\s*;\s*$/i, "");
    await sql.begin(async (tx) => {
      await tx.unsafe(migration);
      await tx`INSERT INTO schema_migrations (id) VALUES (${file})`;
    });
  }
  await sql.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.RIDDLR_DATABASE_URL;
  if (!url) {
    throw new Error("RIDDLR_DATABASE_URL required");
  }
  await migrate(url);
}
