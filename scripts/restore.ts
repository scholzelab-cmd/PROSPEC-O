import "dotenv/config";
import {
  copyFile,
  mkdir,
  rename,
  stat
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { verifyBackup } from "@/db/backup";
import { getEnvironment } from "@/env";
import { logger } from "@/lib/logger";

const sourceArgument = process.argv[2];
const confirmation = process.argv[3];

if (!sourceArgument || confirmation !== "RESTORE") {
  throw new Error(
    "Usage: pnpm restore <backup.db> RESTORE. Stop the app before restoring."
  );
}

const source = resolve(sourceArgument);
verifyBackup(source);
const databaseUrl = getEnvironment().DATABASE_URL;
const rawTarget = databaseUrl.startsWith("file:")
  ? databaseUrl.slice("file:".length)
  : databaseUrl;
const target = resolve(process.cwd(), rawTarget);
const recovery = target + ".before-restore-" + Date.now();

await mkdir(dirname(target), { recursive: true });

try {
  await stat(target);
  await rename(target, recovery);
} catch (error) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";

  if (code !== "ENOENT") {
    throw error;
  }
}

await copyFile(source, target);
verifyBackup(target);
logger.info("database_restored", { source, target, recovery });
