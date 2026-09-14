import { afterEach, describe, expect, it } from "vitest";
import type { DatabaseClient } from "@/db/client";
import {
  claimNextJob,
  enqueueJob,
  recoverStaleJobs
} from "@/worker/queue";
import {
  getSystemStatus,
  recordCircuitFailure,
  setSystemPaused
} from "@/lib/system-control";
import { testDatabase } from "./helpers";

let client: DatabaseClient | undefined;

afterEach(() => {
  client?.close();
  client = undefined;
});

describe("durable worker queue", () => {
  it("enqueues idempotently and claims once", () => {
    client = testDatabase();
    setSystemPaused(client.sqlite, false, "test", "test");
    const first = enqueueJob(client.sqlite, {
      kind: "integration_health",
      payload: {},
      idempotencyKey: "health:one"
    });
    const second = enqueueJob(client.sqlite, {
      kind: "integration_health",
      payload: {},
      idempotencyKey: "health:one"
    });

    expect(second.id).toBe(first.id);
    expect(claimNextJob(client.sqlite, "worker-one")?.id).toBe(first.id);
    expect(claimNextJob(client.sqlite, "worker-two")).toBeNull();
  });

  it("recovers a stale running job after restart", () => {
    client = testDatabase();
    setSystemPaused(client.sqlite, false, "test", "test");
    const job = enqueueJob(client.sqlite, {
      kind: "integration_health",
      payload: {},
      idempotencyKey: "health:stale"
    });
    claimNextJob(client.sqlite, "worker-crashed");
    client.sqlite
      .prepare("UPDATE jobs SET locked_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 60 * 60_000).toISOString(), job.id);

    expect(recoverStaleJobs(client.sqlite, 15)).toBe(1);
    expect(claimNextJob(client.sqlite, "worker-restarted")?.id).toBe(job.id);
  });

  it("opens the circuit breaker and pauses all work", () => {
    client = testDatabase();
    setSystemPaused(client.sqlite, false, "test", "test");

    expect(
      recordCircuitFailure(client.sqlite, "instagram", "first", 2)
    ).toBe(false);
    expect(
      recordCircuitFailure(client.sqlite, "instagram", "second", 2)
    ).toBe(true);
    expect(getSystemStatus(client.sqlite)).toMatchObject({
      paused: true
    });
  });
});
