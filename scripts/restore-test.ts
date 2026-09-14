import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { verifyBackupCopy } from "@/db/backup";
import { logger } from "@/lib/logger";

async function latestBackup(): Promise<string> {
  const directory = resolve(process.cwd(), "backups");
  const files = (await readdir(directory))
    .filter((name) => name.endsWith(".db"))
    .sort()
    .reverse();
  const file = files[0];

  if (!file) {
    throw new Error("No backup file was found.");
  }

  return resolve(directory, file);
}

const path = process.argv[2]
  ? resolve(process.argv[2])
  : await latestBackup();

await verifyBackupCopy(path);
logger.info("backup_restore_test_passed", { path });
