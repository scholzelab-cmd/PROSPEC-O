import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type Database from "better-sqlite3";

interface AppliedMigration {
  name: string;
}

export function applyMigrations(
  database: Database.Database,
  migrationsDirectory = resolve(process.cwd(), "drizzle")
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  if (!existsSync(migrationsDirectory)) {
    throw new Error(`Migration directory not found: ${migrationsDirectory}`);
  }

  const applied = new Set(
    database
      .prepare("SELECT name FROM schema_migrations")
      .all()
      .map((row) => (row as AppliedMigration).name)
  );

  const files = readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const executeMigration = database.transaction((name: string, sql: string) => {
    database.exec(sql);
    database
      .prepare("INSERT INTO schema_migrations (name) VALUES (?)")
      .run(name);
  });

  for (const name of files) {
    if (applied.has(name)) {
      continue;
    }

    const sql = readFileSync(resolve(migrationsDirectory, name), "utf8");
    executeMigration(name, sql);
  }
}
