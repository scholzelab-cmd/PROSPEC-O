import "dotenv/config";
import { createBackup, verifyBackupCopy } from "@/db/backup";
import { createDatabase } from "@/db/client";
import { logger } from "@/lib/logger";

const database = createDatabase();

try {
  const backup = await createBackup(database.sqlite);
  await verifyBackupCopy(backup.path);
  logger.info("backup_created_and_verified", backup);
} finally {
  database.close();
}
