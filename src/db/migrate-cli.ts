import "dotenv/config";
import { createDatabase } from "@/db/client";
import { log } from "@/lib/logger";

const database = createDatabase();
database.close();
log("info", "database_migrations_applied");
