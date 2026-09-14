import type Database from "better-sqlite3";
import type { LeadRow } from "@/db/records";
import {
  assertChannelTransition,
  assertPipelineTransition
} from "@/features/leads/domain";
import { newId } from "@/lib/ids";
import type {
  ChannelOwner,
  ChannelState,
  Funnel,
  PipelineState
} from "@/lib/states";
import { utcNow } from "@/lib/time";

export interface DiscoverLeadInput {
  funnel: Funnel;
  instagramUsername: string;
  instagramUserId?: string;
  displayName?: string;
  biography?: string;
  category?: string;
  location?: string;
  language?: string;
  niche?: string;
  source: string;
  sourceKeyword?: string;
  score?: number;
  decisionMakerRole?: "store" | "employee" | "owner" | "decision_maker" | "unknown";
  profileSignals?: Record<string, unknown>;
  tags?: string[];
}

export interface DiscoverLeadResult {
  lead: LeadRow;
  created: boolean;
}

export class DoNotContactError extends Error {
  constructor(identity: string) {
    super(`Identity is permanently blocked from contact: ${identity}`);
    this.name = "DoNotContactError";
  }
}

export class ConcurrentStateChangeError extends Error {
  constructor(leadId: string) {
    super(`Lead changed concurrently: ${leadId}`);
    this.name = "ConcurrentStateChangeError";
  }
}

export function normalizeInstagramUsername(value: string): string {
  const username = value.trim().replace(/^@/, "").toLowerCase();

  if (!/^[a-z0-9._]{1,30}$/.test(username)) {
    throw new Error("Invalid Instagram username.");
  }

  return username;
}

function readLead(database: Database.Database, leadId: string): LeadRow {
  const row = database.prepare("SELECT * FROM leads WHERE id = ?").get(leadId);

  if (!row) {
    throw new Error(`Lead not found: ${leadId}`);
  }

  return row as LeadRow;
}

export function getLead(
  database: Database.Database,
  leadId: string
): LeadRow | null {
  return (database.prepare("SELECT * FROM leads WHERE id = ?").get(leadId) ??
    null) as LeadRow | null;
}

export function findLeadForInbound(
  database: Database.Database,
  instagramUserId: string,
  instagramUsername?: string
): LeadRow | null {
  const normalizedUsername = instagramUsername
    ? normalizeInstagramUsername(instagramUsername)
    : null;
  const row = database
    .prepare(
      `SELECT * FROM leads
       WHERE instagram_user_id = ?
          OR (? IS NOT NULL AND instagram_username = ?)
       LIMIT 1`
    )
    .get(instagramUserId, normalizedUsername, normalizedUsername);

  return (row ?? null) as LeadRow | null;
}

export function listLeads(
  database: Database.Database,
  funnel?: Funnel,
  limit = 200
): LeadRow[] {
  const safeLimit = Math.max(1, Math.min(limit, 1000));
  const rows = funnel
    ? database
        .prepare(
          "SELECT * FROM leads WHERE funnel = ? ORDER BY updated_at DESC LIMIT ?"
        )
        .all(funnel, safeLimit)
    : database
        .prepare("SELECT * FROM leads ORDER BY updated_at DESC LIMIT ?")
        .all(safeLimit);

  return rows as LeadRow[];
}

function assertContactAllowed(
  database: Database.Database,
  username: string,
  userId: string | null
): void {
  const blocked = database
    .prepare(
      `SELECT identity_value FROM do_not_contact
       WHERE (identity_type = 'instagram_username' AND identity_value = ?)
          OR (? IS NOT NULL AND identity_type = 'instagram_user_id' AND identity_value = ?)
       LIMIT 1`
    )
    .get(username, userId, userId) as { identity_value: string } | undefined;

  if (blocked) {
    throw new DoNotContactError(blocked.identity_value);
  }
}

function insertAudit(
  database: Database.Database,
  actor: string,
  action: string,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown
): void {
  database
    .prepare(
      `INSERT INTO audit_log
       (id, actor, action, entity_type, entity_id, before_json, after_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      newId("audit"),
      actor,
      action,
      entityType,
      entityId,
      before === undefined ? null : JSON.stringify(before),
      after === undefined ? null : JSON.stringify(after)
    );
}

function insertEvent(
  database: Database.Database,
  leadId: string,
  type: string,
  actor: string,
  payload: unknown
): void {
  database
    .prepare(
      `INSERT INTO events (id, lead_id, type, actor, payload_json)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(newId("event"), leadId, type, actor, JSON.stringify(payload));
}

export function discoverLead(
  database: Database.Database,
  input: DiscoverLeadInput,
  actor = "system"
): DiscoverLeadResult {
  const username = normalizeInstagramUsername(input.instagramUsername);
  const userId = input.instagramUserId?.trim() || null;
  const profileUrl = `https://www.instagram.com/${username}/`;

  return database.transaction(() => {
    assertContactAllowed(database, username, userId);

    const existing = database
      .prepare(
        `SELECT * FROM leads
         WHERE instagram_username = ?
            OR (? IS NOT NULL AND instagram_user_id = ?)
         LIMIT 1`
      )
      .get(username, userId, userId) as LeadRow | undefined;

    if (existing) {
      return { lead: existing, created: false };
    }

    const leadId = newId("lead");
    const now = utcNow();

    database
      .prepare(
        `INSERT INTO leads (
          id, funnel, pipeline_state, channel_state, instagram_username,
          instagram_user_id, display_name, biography, category, location,
          language, niche, source, source_keyword, profile_url, score,
          decision_maker_role, profile_signals_json, tags_json, created_at, updated_at
        ) VALUES (
          @id, @funnel, 'discovered', 'browser_contact_pending', @username,
          @userId, @displayName, @biography, @category, @location,
          @language, @niche, @source, @sourceKeyword, @profileUrl, @score,
          @decisionMakerRole, @profileSignalsJson, @tagsJson, @now, @now
        )`
      )
      .run({
        id: leadId,
        funnel: input.funnel,
        username,
        userId,
        displayName: input.displayName ?? null,
        biography: input.biography ?? null,
        category: input.category ?? null,
        location: input.location ?? null,
        language: input.language ?? null,
        niche: input.niche ?? null,
        source: input.source,
        sourceKeyword: input.sourceKeyword ?? null,
        profileUrl,
        score: Math.min(100, Math.max(0, input.score ?? 0)),
        decisionMakerRole: input.decisionMakerRole ?? "unknown",
        profileSignalsJson: JSON.stringify(input.profileSignals ?? {}),
        tagsJson: JSON.stringify(input.tags ?? []),
        now
      });

    database
      .prepare(
        `INSERT INTO channel_ownership (lead_id, owner, version, updated_at)
         VALUES (?, 'browser', 1, ?)`
      )
      .run(leadId, now);

    insertEvent(database, leadId, "lead_discovered", actor, {
      source: input.source,
      sourceKeyword: input.sourceKeyword ?? null,
      score: input.score ?? 0
    });
    insertAudit(database, actor, "create", "lead", leadId, undefined, {
      funnel: input.funnel,
      instagramUsername: username
    });

    return { lead: readLead(database, leadId), created: true };
  })();
}

export function transitionPipeline(
  database: Database.Database,
  leadId: string,
  nextState: PipelineState,
  actor: string,
  reason: string
): LeadRow {
  return database.transaction(() => {
    const before = readLead(database, leadId);

    if (before.pipeline_state === nextState) {
      return before;
    }

    assertPipelineTransition(before.funnel, before.pipeline_state, nextState);
    const now = utcNow();
    const update = database
      .prepare(
        `UPDATE leads
         SET pipeline_state = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND version = ?`
      )
      .run(nextState, now, leadId, before.version);

    if (update.changes !== 1) {
      throw new ConcurrentStateChangeError(leadId);
    }

    const after = readLead(database, leadId);
    insertEvent(database, leadId, "pipeline_transitioned", actor, {
      from: before.pipeline_state,
      to: nextState,
      reason
    });
    insertAudit(
      database,
      actor,
      "transition_pipeline",
      "lead",
      leadId,
      { pipelineState: before.pipeline_state },
      { pipelineState: nextState, reason }
    );

    return after;
  })();
}

export function transitionChannel(
  database: Database.Database,
  leadId: string,
  nextState: ChannelState,
  actor: string,
  reason: string
): LeadRow {
  return database.transaction(() => {
    const before = readLead(database, leadId);

    if (before.channel_state === nextState) {
      return before;
    }

    assertChannelTransition(before.channel_state, nextState);
    const now = utcNow();
    const update = database
      .prepare(
        `UPDATE leads
         SET channel_state = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND version = ?`
      )
      .run(nextState, now, leadId, before.version);

    if (update.changes !== 1) {
      throw new ConcurrentStateChangeError(leadId);
    }

    const after = readLead(database, leadId);
    insertEvent(database, leadId, "channel_transitioned", actor, {
      from: before.channel_state,
      to: nextState,
      reason
    });
    insertAudit(
      database,
      actor,
      "transition_channel",
      "lead",
      leadId,
      { channelState: before.channel_state },
      { channelState: nextState, reason }
    );

    return after;
  })();
}

export function transferChannelOwnership(
  database: Database.Database,
  leadId: string,
  expectedOwner: ChannelOwner,
  nextOwner: ChannelOwner,
  actor: string
): void {
  database.transaction(() => {
    const update = database
      .prepare(
        `UPDATE channel_ownership
         SET owner = ?, version = version + 1, updated_at = ?
         WHERE lead_id = ? AND owner = ?`
      )
      .run(nextOwner, utcNow(), leadId, expectedOwner);

    if (update.changes !== 1) {
      throw new ConcurrentStateChangeError(leadId);
    }

    insertAudit(
      database,
      actor,
      "transfer_channel",
      "lead",
      leadId,
      { owner: expectedOwner },
      { owner: nextOwner }
    );
  })();
}

export function markDoNotContact(
  database: Database.Database,
  leadId: string,
  reason: string,
  actor: string
): LeadRow {
  return database.transaction(() => {
    const before = readLead(database, leadId);
    const identities: Array<["instagram_username" | "instagram_user_id", string]> = [
      ["instagram_username", before.instagram_username]
    ];

    if (before.instagram_user_id) {
      identities.push(["instagram_user_id", before.instagram_user_id]);
    }

    const insert = database.prepare(
      `INSERT OR IGNORE INTO do_not_contact
       (id, identity_type, identity_value, reason, source_lead_id)
       VALUES (?, ?, ?, ?, ?)`
    );

    for (const [type, value] of identities) {
      insert.run(newId("dnc"), type, value, reason, leadId);
    }

    const now = utcNow();
    database
      .prepare(
        `UPDATE leads
         SET channel_state = 'do_not_contact', next_action_at = NULL,
             version = version + 1, updated_at = ?
         WHERE id = ?`
      )
      .run(now, leadId);
    database
      .prepare(
        `UPDATE channel_ownership
         SET owner = 'none', version = version + 1, updated_at = ?
         WHERE lead_id = ?`
      )
      .run(now, leadId);
    database
      .prepare(
        `UPDATE jobs
         SET status = 'paused', locked_at = NULL, locked_by = NULL, updated_at = ?
         WHERE status IN ('queued', 'running')
           AND json_extract(payload_json, '$.leadId') = ?`
      )
      .run(now, leadId);

    insertEvent(database, leadId, "do_not_contact_added", actor, { reason });
    insertAudit(
      database,
      actor,
      "do_not_contact",
      "lead",
      leadId,
      { channelState: before.channel_state },
      { channelState: "do_not_contact", reason }
    );

    return readLead(database, leadId);
  })();
}

export function updateInboundIdentity(
  database: Database.Database,
  leadId: string,
  instagramUserId: string,
  inboundAt: string,
  apiWindowExpiresAt: string
): void {
  database
    .prepare(
      `UPDATE leads
       SET instagram_user_id = COALESCE(instagram_user_id, ?),
           last_inbound_at = ?, api_window_expires_at = ?,
           version = version + 1, updated_at = ?
       WHERE id = ?`
    )
    .run(instagramUserId, inboundAt, apiWindowExpiresAt, utcNow(), leadId);
}
