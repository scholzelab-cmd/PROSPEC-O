import type Database from "better-sqlite3";
import { newId } from "@/lib/ids";
import { utcNow } from "@/lib/time";

export interface SystemStatus {
  paused: boolean;
  reason: string;
  updatedBy: string;
  updatedAt: string;
}

interface SystemStateRow {
  paused: number;
  reason: string;
  updated_by: string;
  updated_at: string;
}

export function getSystemStatus(database: Database.Database): SystemStatus {
  const row = database
    .prepare(
      "SELECT paused, reason, updated_by, updated_at FROM system_state WHERE id = 1"
    )
    .get() as SystemStateRow | undefined;

  if (!row) {
    throw new Error("System state is unavailable.");
  }

  return {
    paused: row.paused === 1,
    reason: row.reason,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at
  };
}

export function setSystemPaused(
  database: Database.Database,
  paused: boolean,
  reason: string,
  actor: string
): SystemStatus {
  return database.transaction(() => {
    const before = getSystemStatus(database);
    const now = utcNow();

    database
      .prepare(
        `UPDATE system_state
         SET paused = ?, reason = ?, updated_by = ?, updated_at = ?
         WHERE id = 1`
      )
      .run(paused ? 1 : 0, reason, actor, now);
    database
      .prepare(
        `INSERT INTO audit_log
         (id, actor, action, entity_type, entity_id, before_json, after_json)
         VALUES (?, ?, ?, 'system', 'singleton', ?, ?)`
      )
      .run(
        newId("audit"),
        actor,
        paused ? "pause" : "resume",
        JSON.stringify(before),
        JSON.stringify({ paused, reason })
      );

    return getSystemStatus(database);
  })();
}

export function recordCircuitFailure(
  database: Database.Database,
  name: string,
  message: string,
  threshold = 5
): boolean {
  return database.transaction(() => {
    const now = utcNow();
    database
      .prepare(
        `INSERT INTO circuit_breakers
         (name, state, failure_count, threshold, last_failure_at, updated_at)
         VALUES (?, 'closed', 1, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           failure_count = failure_count + 1,
           last_failure_at = excluded.last_failure_at,
           updated_at = excluded.updated_at`
      )
      .run(name, threshold, now, now);

    const row = database
      .prepare(
        "SELECT failure_count, threshold FROM circuit_breakers WHERE name = ?"
      )
      .get(name) as { failure_count: number; threshold: number };

    if (row.failure_count < row.threshold) {
      return false;
    }

    database
      .prepare(
        `UPDATE circuit_breakers
         SET state = 'open', opened_at = ?, updated_at = ?
         WHERE name = ?`
      )
      .run(now, now, name);
    setSystemPaused(database, true, `circuit_breaker:${name}:${message}`, "system");
    return true;
  })();
}

export function resetCircuitBreaker(
  database: Database.Database,
  name: string,
  actor: string
): void {
  database.transaction(() => {
    database
      .prepare(
        `UPDATE circuit_breakers
         SET state = 'closed', failure_count = 0, opened_at = NULL, updated_at = ?
         WHERE name = ?`
      )
      .run(utcNow(), name);
    database
      .prepare(
        `INSERT INTO audit_log
         (id, actor, action, entity_type, entity_id, after_json)
         VALUES (?, ?, 'reset_circuit_breaker', 'circuit_breaker', ?, '{}')`
      )
      .run(newId("audit"), actor, name);
  })();
}
