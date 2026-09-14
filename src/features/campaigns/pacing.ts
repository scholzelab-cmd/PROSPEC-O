import type Database from "better-sqlite3";
import type { RuntimeEnvironment } from "@/env";
import { hashText } from "@/lib/ids";
import {
  isWithinOperatingHours,
  randomDelayMilliseconds,
  warmupDailyLimit
} from "@/lib/time";

export interface PacingDecision {
  allowed: boolean;
  reason: string;
  retryAt: string | null;
  dailyCount: number;
  dailyLimit: number;
}

function localDateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;

  return `${value("year")}-${value("month")}-${value("day")}`;
}

function deterministicDelay(
  seed: string,
  minimumSeconds: number,
  maximumSeconds: number
): number {
  const value = Number.parseInt(hashText(seed).slice(0, 8), 16) / 0xffffffff;
  return randomDelayMilliseconds(minimumSeconds, maximumSeconds, () => value);
}

export function evaluateContactPacing(
  database: Database.Database,
  environment: RuntimeEnvironment,
  seed: string,
  now = new Date()
): PacingDecision {
  const dateKey = localDateKey(now, environment.OPERATING_TIMEZONE);
  const countRow = database
    .prepare(
      `SELECT value FROM daily_counters
       WHERE date = ? AND counter = 'browser_dm_sent'`
    )
    .get(dateKey) as { value: number } | undefined;
  const dailyCount = countRow?.value ?? 0;
  const firstRow = database
    .prepare(
      `SELECT MIN(sent_at) AS first_sent_at
       FROM messages
       WHERE channel = 'browser' AND status = 'sent'`
    )
    .get() as { first_sent_at: string | null };
  const firstDate = firstRow.first_sent_at
    ? new Date(firstRow.first_sent_at)
    : now;
  const dailyLimit = warmupDailyLimit(
    firstDate,
    now,
    environment.MAX_DMS_PER_DAY
  );

  if (
    !isWithinOperatingHours(
      now,
      environment.OPERATING_TIMEZONE,
      environment.OPERATING_HOURS
    )
  ) {
    return {
      allowed: false,
      reason: "outside_operating_hours",
      retryAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
      dailyCount,
      dailyLimit
    };
  }

  if (dailyCount >= dailyLimit) {
    return {
      allowed: false,
      reason: "daily_limit_reached",
      retryAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
      dailyCount,
      dailyLimit
    };
  }

  const latest = database
    .prepare(
      `SELECT MAX(sent_at) AS last_sent_at
       FROM messages
       WHERE channel = 'browser' AND status = 'sent'`
    )
    .get() as { last_sent_at: string | null };

  if (latest.last_sent_at) {
    const delay = deterministicDelay(
      seed,
      environment.MIN_SECONDS_BETWEEN_DMS,
      environment.MAX_SECONDS_BETWEEN_DMS
    );
    const next = new Date(new Date(latest.last_sent_at).getTime() + delay);

    if (next.getTime() > now.getTime()) {
      return {
        allowed: false,
        reason: "minimum_interval",
        retryAt: next.toISOString(),
        dailyCount,
        dailyLimit
      };
    }
  }

  return {
    allowed: true,
    reason: "allowed",
    retryAt: null,
    dailyCount,
    dailyLimit
  };
}

export function incrementBrowserDmCounter(
  database: Database.Database,
  timeZone: string,
  now = new Date()
): void {
  const dateKey = localDateKey(now, timeZone);
  database
    .prepare(
      `INSERT INTO daily_counters (date, counter, value, updated_at)
       VALUES (?, 'browser_dm_sent', 1, ?)
       ON CONFLICT(date, counter) DO UPDATE SET
         value = value + 1,
         updated_at = excluded.updated_at`
    )
    .run(dateKey, now.toISOString());
}
