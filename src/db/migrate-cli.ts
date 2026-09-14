import "dotenv/config";
import { createDatabase } from "@/db/client";
import { logger } from "@/lib/logger";

const database = createDatabase();
database.close();
logger.info("database_migrations_applied");
