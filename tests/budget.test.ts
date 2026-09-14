import type OpenAI from "openai";
import { afterEach, describe, expect, it } from "vitest";
import type { DatabaseClient } from "@/db/client";
import {
  ConversationEngine,
  OpenAiBudgetExceededError
} from "@/integrations/openai/client";
import {
  getSystemStatus,
  setSystemPaused
} from "@/lib/system-control";
import { businessFixture, createQualifiedLead, testDatabase } from "./helpers";

let client: DatabaseClient | undefined;

afterEach(() => {
  client?.close();
  client = undefined;
});

describe("OpenAI budget guard", () => {
  it("pauses before calling the model after the monthly ceiling", async () => {
    client = testDatabase();
    const lead = createQualifiedLead(client.sqlite, "budget");
    setSystemPaused(client.sqlite, false, "test", "test");
    client.sqlite
      .prepare(
        `INSERT INTO ai_calls (
          id, lead_id, purpose, model, input_tokens, output_tokens,
          estimated_cost_micros
        ) VALUES ('ai-budget', ?, 'test', 'fixed-model', 1, 1, 2)`
      )
      .run(lead.id);
    let called = false;
    const fake = {
      chat: {
        completions: {
          create: async () => {
            called = true;
            throw new Error("The API must not be called.");
          }
        }
      }
    } as unknown as OpenAI;
    const engine = new ConversationEngine(
      client.sqlite,
      businessFixture,
      fake
    );

    await expect(
      engine.decide({
        leadId: lead.id,
        funnel: "client",
        profile: {
          username: lead.instagram_username,
          displayName: null,
          biography: null,
          category: null,
          niche: null,
          publicSignals: {}
        },
        pipelineState: "qualified",
        history: [],
        experiments: []
      })
    ).rejects.toBeInstanceOf(OpenAiBudgetExceededError);
    expect(called).toBe(false);
    expect(getSystemStatus(client.sqlite).paused).toBe(true);
  });
});
