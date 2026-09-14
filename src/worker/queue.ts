import type Database from "better-sqlite3";
import type { JobRow } from "@/db/records";
import { newId } from "@/lib/ids";
import { getSystemStatus } from "@/lib/system-control";
import { utcNow } from "@/lib/time";

export const jobKinds = [
  "discover_profile",
  "browser_first_contact",
  "browser_follow_up",
  "process_inbound",
  "api_reply",
  "follow_up",
  "optimize_experiment",
  "integration_health",
  "backup"
] as const;

export type JobKind = (typeof jobKinds)[number];

export interface EnqueueJobInput {
  kind: JobKind;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  availableAt?: string;
  maxAttempts?: number;
}

export function enqueueJob(
  database: Database.Database,
  input: EnqueueJobInput
): JobRow {
  const id = newId("job");
  const now = utcNow();

  database
    .prepare(
      `INSERT OR IGNORE INTO jobs (
        id, kind, payload_json, status, attempts, max_attempts, available_at,
        idempotency_key, created_at, updated_at
      ) VALUES (?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.kind,
      JSON.stringify(input.payload),
      input.maxAttempts ?? 3,
      input.availableAt ?? now,
      input.idempotencyKey,
      now,
      now
    );

  const row = database
    .prepare("SELECT * FROM jobs WHERE idempotency_key = ?")
    .get(input.idempotencyKey);

  if (!row) {
    throw new Error("Failed to enqueue durable job.");
  }

  return row as JobRow;
}

export function claimNextJob(
  database: Database.Database,
  workerId: string
): JobRow | null {
  if (getSystemStatus(database).paused) {
    return null;
  }

  return database.transaction(() => {
    const candidate = database
      .prepare(
        `SELECT * FROM jobs
         WHERE status = 'queued' AND available_at <= ?
         ORDER BY available_at ASC, created_at ASC
         LIMIT 1`
      )
      .get(utcNow()) as JobRow | undefined;

    if (!candidate) {
      return null;
    }

    const now = utcNow();
    const update = database
      .prepare(
        `UPDATE jobs
         SET status = 'running', attempts = attempts + 1,
             locked_at = ?, locked_by = ?, updated_at = ?
         WHERE id = ? AND status = 'queued'`
      )
      .run(now, workerId, now, candidate.id);

    if (update.changes !== 1) {
      return null;
    }

    return database
      .prepare("SELECT * FROM jobs WHERE id = ?")
      .get(candidate.id) as JobRow;
  })();
}

export function completeJob(
  database: Database.Database,
  jobId: string
): void {
  database
    .prepare(
      `UPDATE jobs
       SET status = 'completed', locked_at = NULL, locked_by = NULL,
           last_error = NULL, updated_at = ?
       WHERE id = ? AND status = 'running'`
    )
    .run(utcNow(), jobId);
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 2000);
}

export function failJob(
  database: Database.Database,
  job: JobRow,
  error: unknown
): "queued" | "dead_letter" {
  const message = safeErrorMessage(error);
  const exhausted = job.attempts >= job.max_attempts;
  const status = exhausted ? "dead_letter" : "queued";
  const delaySeconds = Math.min(3600, 30 * 2 ** Math.max(0, job.attempts - 1));
  const availableAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
  const now = utcNow();

  database.transaction(() => {
    database
      .prepare(
        `UPDATE jobs
         SET status = ?, available_at = ?, locked_at = NULL, locked_by = NULL,
             last_error = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(status, availableAt, message, now, job.id);

    if (!exhausted) {
      return;
    }

    database
      .prepare(
        `INSERT INTO exceptions
         (id, job_id, code, message, context_json, status, created_at, updated_at)
         VALUES (?, ?, 'job_dead_letter', ?, ?, 'open', ?, ?)`
      )
      .run(
        newId("exception"),
        job.id,
        message,
        JSON.stringify({ kind: job.kind, attempts: job.attempts }),
        now,
        now
      );
  })();

  return status;
}

export function recoverStaleJobs(
  database: Database.Database,
  staleMinutes: number
): number {
  const cutoff = new Date(Date.now() - staleMinutes * 60_000).toISOString();
  const now = utcNow();
  const result = database
    .prepare(
      `UPDATE jobs
       SET status = CASE
           WHEN attempts >= max_attempts THEN 'dead_letter'
           ELSE 'queued'
         END,
         locked_at = NULL,
         locked_by = NULL,
         last_error = 'Recovered after interrupted worker',
         available_at = ?,
         updated_at = ?
       WHERE status = 'running' AND locked_at < ?`
    )
    .run(now, now, cutoff);

  return result.changes;
}

export function pendingJobCounts(
  database: Database.Database
): Record<string, number> {
  const rows = database
    .prepare("SELECT status, COUNT(*) AS count FROM jobs GROUP BY status")
    .all() as Array<{ status: string; count: number }>;

  return Object.fromEntries(rows.map((row) => [row.status, row.count]));
}
