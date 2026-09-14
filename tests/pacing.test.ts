import { afterEach, describe, expect, it } from "vitest";
import type { DatabaseClient } from "@/db/client";
import { getEnvironment } from "@/env";
import {
  evaluateContactPacing,
  incrementBrowserDmCounter
} from "@/features/campaigns/pacing";
import { testDatabase } from "./helpers";

let client: DatabaseClient | undefined;

afterEach(() => {
  client?.close();
  client = undefined;
});

describe("account-health pacing", () => {
  it("starts with the five-message warm-up ceiling", () => {
    client = testDatabase();
    const environment = getEnvironment();
    const now = new Date("2026-01-05T12:00:00.000Z");

    for (let index = 0; index < 5; index += 1) {
      incrementBrowserDmCounter(client.sqlite, "UTC", now);
    }

    expect(
      evaluateContactPacing(client.sqlite, environment, "seed", now)
    ).toMatchObject({
      allowed: false,
      reason: "daily_limit_reached",
      dailyLimit: 5,
      dailyCount: 5
    });
  });
});
