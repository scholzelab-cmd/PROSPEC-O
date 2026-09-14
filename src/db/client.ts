import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { getEnvironment } from "@/env";
import { applyMigrations } from "@/db/migrate";
import * as schema from "@/db/schema";

export interface DatabaseClient {
  sqlite: Database.Database;
  orm: ReturnType<typeof drizzle<typeof schema>>;
  close: () => void;
}

function databasePath(databaseUrl: string): string {
  if (databaseUrl === ":memory:" || databaseUrl === "file::memory:") {
    return ":memory:";
  }

  const rawPath = databaseUrl.startsWith("file:")
    ? databaseUrl.slice("file:".length)
    : databaseUrl;

  return resolve(process.cwd(), rawPath);
}

export function createDatabase(databaseUrl?: string): DatabaseClient {
  const path = databasePath(databaseUrl ?? getEnvironment().DATABASE_URL);

  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const sqlite = new Database(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  if (path !== ":memory:") {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("synchronous = NORMAL");
  }

  applyMigrations(sqlite);

  return {
    sqlite,
    orm: drizzle(sqlite, { schema }),
    close: () => sqlite.close()
  };
}

let singleton: DatabaseClient | undefined;

export function getDatabase(): DatabaseClient {
  singleton ??= createDatabase();
  return singleton;
}
