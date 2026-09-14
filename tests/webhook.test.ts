import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { DatabaseClient } from "@/db/client";
import {
  extractInboundMessages,
  persistWebhookMessages,
  verifyMetaSignature
} from "@/integrations/instagram/webhook";
import { testDatabase } from "./helpers";

let client: DatabaseClient | undefined;

afterEach(() => {
  client?.close();
  client = undefined;
});

describe("Meta webhook", () => {
  it("verifies SHA-256 signatures and extracts inbound messages", () => {
    const raw = JSON.stringify({
      object: "instagram",
      entry: [
        {
          id: "business",
          messaging: [
            {
              sender: { id: "sender" },
              recipient: { id: "business" },
              timestamp: 1_700_000_000_000,
              message: { mid: "mid-one", text: "Olá" }
            }
          ]
        }
      ]
    });
    const signature =
      "sha256=" +
      createHmac("sha256", "secret").update(raw).digest("hex");

    expect(verifyMetaSignature(raw, signature, "secret")).toBe(true);
    expect(verifyMetaSignature(raw, signature, "wrong")).toBe(false);
    expect(extractInboundMessages(JSON.parse(raw) as unknown)).toHaveLength(1);
  });

  it("persists and queues each event only once", () => {
    client = testDatabase();
    const payload = {
      object: "instagram",
      entry: [
        {
          id: "business",
          messaging: [
            {
              sender: { id: "sender" },
              recipient: { id: "business" },
              timestamp: Date.now(),
              message: { mid: "mid-idempotent", text: "Olá" }
            }
          ]
        }
      ]
    };
    const raw = JSON.stringify(payload);

    expect(persistWebhookMessages(client.sqlite, raw, payload)).toEqual({
      accepted: 1,
      duplicates: 0
    });
    expect(persistWebhookMessages(client.sqlite, raw, payload)).toEqual({
      accepted: 0,
      duplicates: 1
    });
    expect(
      client.sqlite.prepare("SELECT COUNT(*) AS count FROM jobs").get()
    ).toMatchObject({ count: 1 });
  });
});
