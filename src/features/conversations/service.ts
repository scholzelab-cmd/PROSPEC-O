import type Database from "better-sqlite3";
import type {
  ChannelOwnershipRow,
  LeadRow,
  MessageRow
} from "@/db/records";
import type { BusinessConfig } from "@/config/business";
import {
  detectImmediateOptOut,
  renderDecision,
  type ConversationDecision
} from "@/features/conversations/policy";
import {
  findLeadForInbound,
  getLead,
  markDoNotContact,
  normalizeInstagramUsername
} from "@/features/leads/service";
import type { InstagramApiClient } from "@/integrations/instagram/api";
import { newId } from "@/lib/ids";
import { apiWindowExpiry, isApiWindowOpen, utcNow } from "@/lib/time";

export class ChannelOwnershipError extends Error {
  constructor(leadId: string, expected: string) {
    super(`Lead ${leadId} is not owned by ${expected}.`);
    this.name = "ChannelOwnershipError";
  }
}

export class DeliveryUncertainError extends Error {
  constructor(messageId: string) {
    super(
      `Message ${messageId} is pending from an earlier attempt; automatic resend is blocked.`
    );
    this.name = "DeliveryUncertainError";
  }
}

export class MessagingWindowClosedError extends Error {
  constructor(leadId: string) {
    super(`Official API messaging window is closed for lead ${leadId}.`);
    this.name = "MessagingWindowClosedError";
  }
}

interface InboundInput {
  externalEventId: string;
  senderId: string;
  username?: string;
  body: string;
  timestamp: string;
}

interface InboundResult {
  lead: LeadRow | null;
  duplicate: boolean;
  optedOut: boolean;
}

function ownership(
  database: Database.Database,
  leadId: string
): ChannelOwnershipRow {
  const row = database
    .prepare("SELECT * FROM channel_ownership WHERE lead_id = ?")
    .get(leadId);

  if (!row) {
    throw new Error(`Channel ownership missing for lead ${leadId}.`);
  }

  return row as ChannelOwnershipRow;
}

function isBlocked(
  database: Database.Database,
  lead: LeadRow
): boolean {
  const row = database
    .prepare(
      `SELECT 1 FROM do_not_contact
       WHERE (identity_type = 'instagram_username' AND identity_value = ?)
          OR (? IS NOT NULL AND identity_type = 'instagram_user_id' AND identity_value = ?)
       LIMIT 1`
    )
    .get(
      lead.instagram_username,
      lead.instagram_user_id,
      lead.instagram_user_id
    );

  return Boolean(row);
}

function readMessage(
  database: Database.Database,
  idempotencyKey: string
): MessageRow | null {
  return (database
    .prepare("SELECT * FROM messages WHERE idempotency_key = ?")
    .get(idempotencyKey) ?? null) as MessageRow | null;
}

function reserveMessage(
  database: Database.Database,
  input: {
    lead: LeadRow;
    channel: "browser" | "instagram_api";
    owner: "browser" | "api";
    body: string;
    idempotencyKey: string;
    variantId?: string;
  }
): { message: MessageRow; alreadySent: boolean } {
  if (isBlocked(database, input.lead)) {
    throw new Error("Outbound message blocked by do_not_contact.");
  }

  const lock = ownership(database, input.lead.id);

  if (lock.owner !== input.owner) {
    throw new ChannelOwnershipError(input.lead.id, input.owner);
  }

  const existing = readMessage(database, input.idempotencyKey);

  if (existing) {
    if (existing.status === "sent" || existing.status === "delivered") {
      return { message: existing, alreadySent: true };
    }

    throw new DeliveryUncertainError(existing.id);
  }

  const id = newId("message");
  database
    .prepare(
      `INSERT INTO messages (
        id, lead_id, direction, channel, status, body,
        idempotency_key, variant_id
      ) VALUES (?, ?, 'outbound', ?, 'pending', ?, ?, ?)`
    )
    .run(
      id,
      input.lead.id,
      input.channel,
      input.body,
      input.idempotencyKey,
      input.variantId ?? null
    );

  const created = readMessage(database, input.idempotencyKey);

  if (!created) {
    throw new Error("Unable to reserve outbound message.");
  }

  return { message: created, alreadySent: false };
}

export function reserveBrowserFirstContact(
  database: Database.Database,
  input: {
    leadId: string;
    body: string;
    idempotencyKey: string;
    variantId?: string;
  }
): { message: MessageRow; alreadySent: boolean } {
  const lead = getLead(database, input.leadId);

  if (!lead) {
    throw new Error(`Lead not found: ${input.leadId}`);
  }

  if (
    lead.pipeline_state !== "qualified" ||
    lead.channel_state !== "browser_contact_pending"
  ) {
    throw new Error("Lead is not eligible for browser first contact.");
  }

  return reserveMessage(database, {
    lead,
    channel: "browser",
    owner: "browser",
    body: input.body,
    idempotencyKey: input.idempotencyKey,
    variantId: input.variantId
  });
}

export function reserveBrowserFollowUp(
  database: Database.Database,
  input: {
    leadId: string;
    body: string;
    idempotencyKey: string;
    variantId?: string;
  }
): { message: MessageRow; alreadySent: boolean } {
  const lead = getLead(database, input.leadId);

  if (!lead) {
    throw new Error(`Lead not found: ${input.leadId}`);
  }

  if (
    lead.pipeline_state !== "contacted" ||
    lead.channel_state !== "waiting_inbound_reply"
  ) {
    throw new Error("Lead is not eligible for an automated follow-up.");
  }

  return reserveMessage(database, {
    lead,
    channel: "browser",
    owner: "browser",
    body: input.body,
    idempotencyKey: input.idempotencyKey,
    variantId: input.variantId
  });
}

export function markBrowserFollowUpSent(
  database: Database.Database,
  messageId: string
): void {
  database.transaction(() => {
    const message = database
      .prepare("SELECT * FROM messages WHERE id = ?")
      .get(messageId) as MessageRow | undefined;

    if (!message || message.channel !== "browser") {
      throw new Error("Browser follow-up reservation not found.");
    }

    const lead = getLead(database, message.lead_id);

    if (
      !lead ||
      lead.pipeline_state !== "contacted" ||
      lead.channel_state !== "waiting_inbound_reply" ||
      ownership(database, lead.id).owner !== "browser"
    ) {
      throw new Error("Follow-up send conflicts with current CRM state.");
    }

    const now = utcNow();
    database
      .prepare(
        `UPDATE messages
         SET status = 'sent', sent_at = ?, failure_reason = NULL
         WHERE id = ? AND status = 'pending'`
      )
      .run(now, messageId);
    database
      .prepare(
        `UPDATE leads
         SET last_outbound_at = ?, next_action_at = NULL,
             version = version + 1, updated_at = ?
         WHERE id = ?`
      )
      .run(now, now, lead.id);
    database
      .prepare(
        `INSERT INTO events (id, lead_id, type, actor, payload_json)
         VALUES (?, ?, 'browser_follow_up_sent', 'worker', ?)`
      )
      .run(newId("event"), lead.id, JSON.stringify({ messageId }));
  })();
}

export function markBrowserFirstContactSent(
  database: Database.Database,
  messageId: string
): void {
  database.transaction(() => {
    const message = database
      .prepare("SELECT * FROM messages WHERE id = ?")
      .get(messageId) as MessageRow | undefined;

    if (!message || message.channel !== "browser") {
      throw new Error("Browser message reservation not found.");
    }

    const lead = getLead(database, message.lead_id);

    if (!lead) {
      throw new Error("Lead not found for browser message.");
    }

    if (
      lead.pipeline_state !== "qualified" ||
      lead.channel_state !== "browser_contact_pending" ||
      ownership(database, lead.id).owner !== "browser"
    ) {
      throw new Error("Browser send result conflicts with current CRM state.");
    }

    const now = utcNow();
    database
      .prepare(
        `UPDATE messages
         SET status = 'sent', sent_at = ?, failure_reason = NULL
         WHERE id = ? AND status = 'pending'`
      )
      .run(now, messageId);
    database
      .prepare(
        `UPDATE leads
         SET pipeline_state = 'contacted',
             channel_state = 'waiting_inbound_reply',
             last_outbound_at = ?, version = version + 1, updated_at = ?
         WHERE id = ?`
      )
      .run(now, now, lead.id);
    database
      .prepare(
        `INSERT INTO events (id, lead_id, type, actor, payload_json)
         VALUES (?, ?, 'browser_first_contact_sent', 'worker', ?)`
      )
      .run(
        newId("event"),
        lead.id,
        JSON.stringify({ messageId, variantId: message.variant_id })
      );
  })();
}

export function markMessageFailed(
  database: Database.Database,
  messageId: string,
  reason: string
): void {
  database
    .prepare(
      `UPDATE messages
       SET status = 'failed', failure_reason = ?
       WHERE id = ? AND status = 'pending'`
    )
    .run(reason.slice(0, 2000), messageId);
}

export function registerInboundMessage(
  database: Database.Database,
  input: InboundInput
): InboundResult {
  const existing = database
    .prepare("SELECT lead_id FROM messages WHERE external_message_id = ?")
    .get(input.externalEventId) as { lead_id: string } | undefined;

  if (existing) {
    return {
      lead: getLead(database, existing.lead_id),
      duplicate: true,
      optedOut: false
    };
  }

  const username = input.username
    ? normalizeInstagramUsername(input.username)
    : undefined;
  const lead = findLeadForInbound(database, input.senderId, username);

  if (!lead) {
    const now = utcNow();
    database
      .prepare(
        `INSERT INTO exceptions (
          id, code, message, context_json, status, created_at, updated_at
        ) VALUES (?, 'unmatched_inbound', ?, ?, 'open', ?, ?)`
      )
      .run(
        newId("exception"),
        "Inbound Instagram message could not be matched to a lead.",
        JSON.stringify({
          externalEventId: input.externalEventId,
          senderId: input.senderId,
          username: username ?? null
        }),
        now,
        now
      );
    return { lead: null, duplicate: false, optedOut: false };
  }

  database.transaction(() => {
    const windowExpiresAt = apiWindowExpiry(new Date(input.timestamp));

    database
      .prepare(
        `INSERT INTO messages (
          id, lead_id, direction, channel, status, body,
          external_message_id, idempotency_key, sent_at
        ) VALUES (?, ?, 'inbound', 'instagram_api', 'received', ?, ?, ?, ?)`
      )
      .run(
        newId("message"),
        lead.id,
        input.body,
        input.externalEventId,
        `inbound:${input.externalEventId}`,
        input.timestamp
      );

    const nextPipeline =
      lead.pipeline_state === "contacted" ? "replied" : lead.pipeline_state;
    const currentOwner = ownership(database, lead.id).owner;
    const eligible =
      ["waiting_inbound_reply", "browser_contact_sent"].includes(
        lead.channel_state
      ) && currentOwner === "browser";
    const nextChannel = eligible ? "api_eligible" : lead.channel_state;

    database
      .prepare(
        `UPDATE leads
         SET instagram_user_id = COALESCE(instagram_user_id, ?),
             pipeline_state = ?, channel_state = ?,
             last_inbound_at = ?, api_window_expires_at = ?,
             version = version + 1, updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.senderId,
        nextPipeline,
        nextChannel,
        input.timestamp,
        windowExpiresAt,
        utcNow(),
        lead.id
      );

    if (eligible) {
      database
        .prepare(
          `UPDATE channel_ownership
           SET owner = 'api', version = version + 1, updated_at = ?
           WHERE lead_id = ? AND owner = 'browser'`
        )
        .run(utcNow(), lead.id);
    }

    database
      .prepare(
        `UPDATE webhook_events
         SET status = 'processed', processed_at = ?
         WHERE provider = 'meta_instagram' AND external_event_id = ?`
      )
      .run(utcNow(), input.externalEventId);
    database
      .prepare(
        `INSERT INTO events (id, lead_id, type, actor, payload_json)
         VALUES (?, ?, 'inbound_received', 'meta_webhook', ?)`
      )
      .run(
        newId("event"),
        lead.id,
        JSON.stringify({
          externalEventId: input.externalEventId,
          handoffToApi: eligible
        })
      );
  })();

  if (detectImmediateOptOut(input.body)) {
    return {
      lead: markDoNotContact(
        database,
        lead.id,
        "explicit_inbound_opt_out",
        "conversation_policy"
      ),
      duplicate: false,
      optedOut: true
    };
  }

  return {
    lead: getLead(database, lead.id),
    duplicate: false,
    optedOut: false
  };
}

export function conversationHistory(
  database: Database.Database,
  leadId: string
): Array<{
  direction: "inbound" | "outbound";
  body: string;
  createdAt: string;
}> {
  const rows = database
    .prepare(
      `SELECT direction, body, created_at
       FROM messages WHERE lead_id = ?
       ORDER BY created_at ASC, id ASC`
    )
    .all(leadId) as Array<{
      direction: "inbound" | "outbound";
      body: string;
      created_at: string;
    }>;

  return rows.map((row) => ({
    direction: row.direction,
    body: row.body,
    createdAt: row.created_at
  }));
}

export async function sendOfficialApiReply(
  database: Database.Database,
  client: InstagramApiClient,
  config: BusinessConfig,
  leadId: string,
  decision: ConversationDecision,
  idempotencyKey: string
): Promise<{ sent: boolean; messageId?: string }> {
  const lead = getLead(database, leadId);

  if (!lead || !lead.instagram_user_id) {
    throw new Error("Lead is missing the official Instagram user ID.");
  }

  if (ownership(database, lead.id).owner !== "api") {
    throw new ChannelOwnershipError(lead.id, "api");
  }

  if (
    !["api_eligible", "api_active"].includes(lead.channel_state) ||
    !isApiWindowOpen(lead.api_window_expires_at)
  ) {
    if (lead.channel_state === "api_eligible" || lead.channel_state === "api_active") {
      database
        .prepare(
          `UPDATE leads
           SET channel_state = 'api_window_closed',
               version = version + 1, updated_at = ?
           WHERE id = ?`
        )
        .run(utcNow(), lead.id);
    }
    throw new MessagingWindowClosedError(lead.id);
  }

  const rendered = renderDecision(config, lead.funnel, decision);

  if (!rendered.message) {
    return { sent: false };
  }

  const reservation = reserveMessage(database, {
    lead,
    channel: "instagram_api",
    owner: "api",
    body: rendered.message,
    idempotencyKey
  });

  if (reservation.alreadySent) {
    return {
      sent: true,
      messageId: reservation.message.external_message_id ?? undefined
    };
  }

  try {
    const sent = await client.sendText(
      lead.instagram_user_id,
      rendered.message
    );
    const now = utcNow();

    database.transaction(() => {
      database
        .prepare(
          `UPDATE messages
           SET status = 'sent', external_message_id = ?, sent_at = ?
           WHERE id = ? AND status = 'pending'`
        )
        .run(sent.messageId, now, reservation.message.id);
      database
        .prepare(
          `UPDATE leads
           SET channel_state = ?, last_outbound_at = ?,
               version = version + 1, updated_at = ?
           WHERE id = ?`
        )
        .run(
          rendered.closeConversation ? "completed" : "api_active",
          now,
          now,
          lead.id
        );
      database
        .prepare(
          `INSERT INTO events (id, lead_id, type, actor, payload_json)
           VALUES (?, ?, 'api_reply_sent', 'worker', ?)`
        )
        .run(
          newId("event"),
          lead.id,
          JSON.stringify({
            messageId: sent.messageId,
            intent: decision.intent,
            action: decision.action
          })
        );
    })();

    return { sent: true, messageId: sent.messageId };
  } catch (error) {
    markMessageFailed(
      database,
      reservation.message.id,
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }
}
