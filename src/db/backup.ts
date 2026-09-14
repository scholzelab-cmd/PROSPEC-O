import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import Database from "better-sqlite3";

export interface BackupResult {
  path: string;
  size: number;
  pages: number;
}

export async function createBackup(
  database: Database.Database,
  directory = resolve(process.cwd(), "backups")
): Promise<BackupResult> {
  await mkdir(directory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = resolve(directory, "prospecto-" + timestamp + ".db");
  const result = await database.backup(path);
  const file = await stat(path);

  return {
    path,
    size: file.size,
    pages: result.totalPages
  };
}

export function verifyBackup(path: string): void {
  const database = new Database(resolve(path), {
    readonly: true,
    fileMustExist: true
  });

  try {
    const integrity = database.pragma("integrity_check", {
      simple: true
    });

    if (integrity !== "ok") {
      throw new Error(
        "SQLite integrity check failed for backup " + basename(path)
      );
    }

    const migrationTable = database
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name = 'schema_migrations'`
      )
      .get();

    if (!migrationTable) {
      throw new Error("Backup does not contain the migration ledger.");
    }
  } finally {
    database.close();
  }
}

export async function verifyBackupCopy(path: string): Promise<void> {
  const directory = await mkdtemp(resolve(tmpdir(), "prospecto-restore-test-"));

  try {
    const temporaryPath = resolve(directory, basename(path));
    const source = new Database(resolve(path), {
      readonly: true,
      fileMustExist: true
    });

    try {
      await source.backup(temporaryPath);
    } finally {
      source.close();
    }

    verifyBackup(temporaryPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
