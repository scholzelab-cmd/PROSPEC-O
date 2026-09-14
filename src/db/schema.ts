import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex
} from "drizzle-orm/sqlite-core";

function auditTimestamps() {
  return {
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
  };
}

export const leads = sqliteTable(
  "leads",
  {
    id: text("id").primaryKey(),
    funnel: text("funnel", { enum: ["client", "affiliate"] }).notNull(),
    pipelineState: text("pipeline_state").notNull().default("discovered"),
    channelState: text("channel_state").notNull().default("browser_contact_pending"),
    instagramUsername: text("instagram_username").notNull(),
    instagramUserId: text("instagram_user_id"),
    displayName: text("display_name"),
    biography: text("biography"),
    category: text("category"),
    location: text("location"),
    language: text("language"),
    niche: text("niche"),
    source: text("source").notNull().default("manual"),
    sourceKeyword: text("source_keyword"),
    profileUrl: text("profile_url").notNull(),
    score: integer("score").notNull().default(0),
    decisionMakerRole: text("decision_maker_role").notNull().default("unknown"),
    profileSignalsJson: text("profile_signals_json").notNull().default("{}"),
    tagsJson: text("tags_json").notNull().default("[]"),
    apiWindowExpiresAt: text("api_window_expires_at"),
    nextActionAt: text("next_action_at"),
    lastInboundAt: text("last_inbound_at"),
    lastOutboundAt: text("last_outbound_at"),
    version: integer("version").notNull().default(1),
    ...auditTimestamps()
  },
  (table) => [
    uniqueIndex("leads_instagram_username_unique").on(table.instagramUsername),
    uniqueIndex("leads_instagram_user_id_unique").on(table.instagramUserId),
    index("leads_funnel_pipeline_idx").on(table.funnel, table.pipelineState),
    index("leads_next_action_idx").on(table.nextActionAt)
  ]
);

export const doNotContact = sqliteTable(
  "do_not_contact",
  {
    id: text("id").primaryKey(),
    identityType: text("identity_type", {
      enum: ["instagram_username", "instagram_user_id", "phone"]
    }).notNull(),
    identityValue: text("identity_value").notNull(),
    reason: text("reason").notNull(),
    sourceLeadId: text("source_lead_id").references(() => leads.id),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [
    uniqueIndex("do_not_contact_identity_unique").on(
      table.identityType,
      table.identityValue
    )
  ]
);

export const channelOwnership = sqliteTable("channel_ownership", {
  leadId: text("lead_id")
    .primaryKey()
    .references(() => leads.id, { onDelete: "cascade" }),
  owner: text("owner", { enum: ["browser", "api", "human", "none"] })
    .notNull()
    .default("none"),
  version: integer("version").notNull().default(1),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
    channel: text("channel", {
      enum: ["browser", "instagram_api", "whatsapp", "system"]
    }).notNull(),
    status: text("status", {
      enum: ["pending", "sent", "delivered", "received", "failed", "blocked"]
    }).notNull(),
    body: text("body").notNull(),
    externalMessageId: text("external_message_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    variantId: text("variant_id"),
    failureReason: text("failure_reason"),
    sentAt: text("sent_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [
    uniqueIndex("messages_idempotency_unique").on(table.idempotencyKey),
    uniqueIndex("messages_external_message_unique").on(table.externalMessageId),
    index("messages_lead_created_idx").on(table.leadId, table.createdAt)
  ]
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    payloadJson: text("payload_json").notNull(),
    status: text("status", {
      enum: ["queued", "running", "completed", "failed", "dead_letter", "paused"]
    }).notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    availableAt: text("available_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lockedAt: text("locked_at"),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    idempotencyKey: text("idempotency_key").notNull(),
    ...auditTimestamps()
  },
  (table) => [
    uniqueIndex("jobs_idempotency_unique").on(table.idempotencyKey),
    index("jobs_claim_idx").on(table.status, table.availableAt)
  ]
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    actor: text("actor").notNull(),
    payloadJson: text("payload_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [index("events_lead_created_idx").on(table.leadId, table.createdAt)]
);

export const webhookEvents = sqliteTable(
  "webhook_events",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    externalEventId: text("external_event_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    status: text("status").notNull().default("received"),
    payloadJson: text("payload_json").notNull(),
    processedAt: text("processed_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [
    uniqueIndex("webhook_provider_event_unique").on(
      table.provider,
      table.externalEventId
    )
  ]
);

export const experiments = sqliteTable("experiments", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  funnel: text("funnel", { enum: ["client", "affiliate"] }).notNull(),
  variable: text("variable").notNull(),
  status: text("status", {
    enum: ["draft", "running", "paused", "completed"]
  }).notNull().default("draft"),
  minimumSampleSize: integer("minimum_sample_size").notNull().default(50),
  explorationPercent: integer("exploration_percent").notNull().default(10),
  startedAt: text("started_at"),
  endedAt: text("ended_at"),
  ...auditTimestamps()
});

export const experimentVariants = sqliteTable(
  "experiment_variants",
  {
    id: text("id").primaryKey(),
    experimentId: text("experiment_id")
      .notNull()
      .references(() => experiments.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isControl: integer("is_control", { mode: "boolean" }).notNull().default(false),
    allocationPercent: integer("allocation_percent").notNull(),
    contentJson: text("content_json").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [
    uniqueIndex("experiment_variant_name_unique").on(
      table.experimentId,
      table.name
    )
  ]
);

export const experimentAssignments = sqliteTable(
  "experiment_assignments",
  {
    id: text("id").primaryKey(),
    experimentId: text("experiment_id")
      .notNull()
      .references(() => experiments.id, { onDelete: "cascade" }),
    variantId: text("variant_id")
      .notNull()
      .references(() => experimentVariants.id, { onDelete: "cascade" }),
    leadId: text("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    outcome: text("outcome"),
    outcomeValue: real("outcome_value"),
    assignedAt: text("assigned_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    convertedAt: text("converted_at")
  },
  (table) => [
    uniqueIndex("experiment_lead_unique").on(table.experimentId, table.leadId)
  ]
);

export const aiCalls = sqliteTable(
  "ai_calls",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
    purpose: text("purpose").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    estimatedCostMicros: integer("estimated_cost_micros").notNull(),
    decisionJson: text("decision_json"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [index("ai_calls_created_idx").on(table.createdAt)]
);

export const systemState = sqliteTable("system_state", {
  id: integer("id").primaryKey(),
  paused: integer("paused", { mode: "boolean" }).notNull().default(true),
  reason: text("reason").notNull().default("initial_setup"),
  updatedBy: text("updated_by").notNull().default("system"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const exceptions = sqliteTable(
  "exceptions",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
    jobId: text("job_id").references(() => jobs.id, { onDelete: "set null" }),
    code: text("code").notNull(),
    message: text("message").notNull(),
    contextJson: text("context_json").notNull().default("{}"),
    status: text("status", {
      enum: ["open", "acknowledged", "resolved"]
    }).notNull().default("open"),
    resolvedAt: text("resolved_at"),
    ...auditTimestamps()
  },
  (table) => [index("exceptions_status_created_idx").on(table.status, table.createdAt)]
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [index("audit_entity_idx").on(table.entityType, table.entityId)]
);

export const circuitBreakers = sqliteTable("circuit_breakers", {
  name: text("name").primaryKey(),
  state: text("state", { enum: ["closed", "open", "half_open"] })
    .notNull().default("closed"),
  failureCount: integer("failure_count").notNull().default(0),
  threshold: integer("threshold").notNull().default(5),
  openedAt: text("opened_at"),
  lastFailureAt: text("last_failure_at"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const dailyCounters = sqliteTable(
  "daily_counters",
  {
    date: text("date").notNull(),
    counter: text("counter").notNull(),
    value: integer("value").notNull().default(0),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [uniqueIndex("daily_counter_unique").on(table.date, table.counter)]
);

export const integrationHealth = sqliteTable("integration_health", {
  integration: text("integration").primaryKey(),
  status: text("status", {
    enum: ["healthy", "degraded", "unavailable", "unconfigured"]
  }).notNull(),
  message: text("message"),
  checkedAt: text("checked_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const browserRuns = sqliteTable(
  "browser_runs",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").references(() => jobs.id, { onDelete: "set null" }),
    leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
    mode: text("mode", { enum: ["fake", "dry_run", "live"] }).notNull(),
    status: text("status", {
      enum: ["started", "sent", "blocked", "failed"]
    }).notNull(),
    url: text("url"),
    message: text("message"),
    variantId: text("variant_id"),
    diagnosticsJson: text("diagnostics_json").notNull().default("{}"),
    finishedAt: text("finished_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [index("browser_runs_job_idx").on(table.jobId)]
);
