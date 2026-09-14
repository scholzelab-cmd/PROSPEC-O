import { createHmac, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import { enqueueJob } from "@/worker/queue";
import { hashText, newId } from "@/lib/ids";

const webhookPayloadSchema = z.object({
  object: z.string().optional(),
  entry: z.array(
    z.object({
      id: z.string(),
      time: z.number().optional(),
      messaging: z
        .array(
          z.object({
            sender: z.object({ id: z.string() }),
            recipient: z.object({ id: z.string() }),
            timestamp: z.number(),
            message: z
              .object({
                mid: z.string(),
                text: z.string().optional(),
                is_echo: z.boolean().optional()
              })
              .optional()
          })
        )
        .optional()
    })
  )
});

export interface InboundWebhookMessage {
  externalEventId: string;
  senderId: string;
  recipientId: string;
  body: string;
  timestamp: string;
}

export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) {
    return false;
  }

  const suppliedHex = signatureHeader.slice("sha256=".length);
  const expectedHex = createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");

  if (
    suppliedHex.length !== expectedHex.length ||
    !/^[a-f0-9]+$/i.test(suppliedHex)
  ) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(suppliedHex, "hex"),
    Buffer.from(expectedHex, "hex")
  );
}

export function extractInboundMessages(
  payload: unknown
): InboundWebhookMessage[] {
  const parsed = webhookPayloadSchema.parse(payload);
  const messages: InboundWebhookMessage[] = [];

  for (const entry of parsed.entry) {
    for (const event of entry.messaging ?? []) {
      if (!event.message || event.message.is_echo) {
        continue;
      }

      messages.push({
        externalEventId: event.message.mid,
        senderId: event.sender.id,
        recipientId: event.recipient.id,
        body: event.message.text ?? "",
        timestamp: new Date(event.timestamp).toISOString()
      });
    }
  }

  return messages;
}

export function persistWebhookMessages(
  database: Database.Database,
  rawBody: string,
  payload: unknown
): { accepted: number; duplicates: number } {
  const inbound = extractInboundMessages(payload);
  let accepted = 0;
  let duplicates = 0;

  database.transaction(() => {
    for (const message of inbound) {
      const result = database
        .prepare(
          `INSERT OR IGNORE INTO webhook_events (
            id, provider, external_event_id, payload_hash, status, payload_json
          ) VALUES (?, 'meta_instagram', ?, ?, 'received', ?)`
        )
        .run(
          newId("webhook"),
          message.externalEventId,
          hashText(rawBody),
          JSON.stringify(message)
        );

      if (result.changes === 0) {
        duplicates += 1;
        continue;
      }

      enqueueJob(database, {
        kind: "process_inbound",
        payload: message,
        idempotencyKey: `webhook:${message.externalEventId}`
      });
      accepted += 1;
    }
  })();

  return { accepted, duplicates };
}
