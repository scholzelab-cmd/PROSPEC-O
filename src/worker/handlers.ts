import type Database from "better-sqlite3";
import { z } from "zod";
import type { BusinessConfig } from "@/config/business";
import {
  conversationHistory,
  markBrowserFirstContactSent,
  markBrowserFollowUpSent,
  markMessageFailed,
  registerInboundMessage,
  reserveBrowserFirstContact,
  reserveBrowserFollowUp,
  sendOfficialApiReply
} from "@/features/conversations/service";
import {
  buildFirstContact,
  conversationDecisionSchema
} from "@/features/conversations/policy";
import {
  adaptExperimentAllocation
} from "@/features/experiments/service";
import {
  scoreProfile
} from "@/features/leads/domain";
import {
  discoverLead,
  findLeadForInbound,
  getLead,
  markDoNotContact,
  transitionPipeline
} from "@/features/leads/service";
import {
  evaluateContactPacing,
  incrementBrowserDmCounter
} from "@/features/campaigns/pacing";
import type { BrowserContactInput } from "@/integrations/browser/contact";
import {
  BrowserUnavailableError,
  InstagramRestrictionError
} from "@/integrations/browser/contact";
import type { InstagramApiClient } from "@/integrations/instagram/api";
import type { ConversationEngine } from "@/integrations/openai/client";
import type { RuntimeEnvironment } from "@/env";
import type { JobRow } from "@/db/records";
import { createBackup, verifyBackupCopy } from "@/db/backup";
import { newId } from "@/lib/ids";
import { setSystemPaused } from "@/lib/system-control";
import { utcNow } from "@/lib/time";
import { enqueueJob } from "@/worker/queue";

const discoverPayloadSchema = z.object({
  funnel: z.enum(["client", "affiliate"]),
  instagramUsername: z.string(),
  instagramUserId: z.string().optional(),
  displayName: z.string().optional(),
  biography: z.string().optional(),
  category: z.string().optional(),
  location: z.string().optional(),
  language: z.string().optional(),
  niche: z.string().optional(),
  source: z.string(),
  sourceKeyword: z.string().optional(),
  publicReference: z.string().optional(),
  signals: z.object({
    segmentMatch: z.boolean(),
    keywordMatches: z.number().int().nonnegative(),
    relevantPosts: z.number().int().nonnegative(),
    decisionMakerEvidence: z.boolean(),
    localGeography: z.boolean(),
    authenticEngagement: z.boolean()
  }),
  contactMode: z.enum(["dry_run", "live"]).default("dry_run"),
  operatorAuthorizedAt: z.string().optional()
});

const browserPayloadSchema = z.object({
  leadId: z.string(),
  mode: z.enum(["dry_run", "live"]),
  publicReference: z.string().nullable().default(null),
  variantId: z.string().optional(),
  operatorAuthorizedAt: z.string().optional()
});

const inboundPayloadSchema = z.object({
  externalEventId: z.string(),
  senderId: z.string(),
  recipientId: z.string(),
  body: z.string(),
  timestamp: z.string()
});

const apiReplyPayloadSchema = z.object({
  leadId: z.string(),
  inboundEventId: z.string(),
  decision: conversationDecisionSchema
});

const optimizePayloadSchema = z.object({
  experimentId: z.string()
});

export interface BrowserSender {
  sendFirstContact(input: BrowserContactInput): Promise<{
    sent: boolean;
    mode: "dry_run" | "live" | "fake";
    finalUrl: string;
    accessibilitySnapshot: string;
    diagnosticsDirectory?: string;
  }>;
}

export interface HandlerDependencies {
  database: Database.Database;
  business: BusinessConfig;
  environment: RuntimeEnvironment;
  browser: BrowserSender;
  instagramApi: InstagramApiClient;
  conversationEngine: ConversationEngine | null;
}

export type JobOutcome = "completed" | "rescheduled";

function payload(job: JobRow): unknown {
  return JSON.parse(job.payload_json) as unknown;
}

function safeObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function addException(
  database: Database.Database,
  input: {
    leadId?: string;
    jobId?: string;
    code: string;
    message: string;
    context?: Record<string, unknown>;
  }
): void {
  const now = utcNow();
  database
    .prepare(
      `INSERT INTO exceptions (
        id, lead_id, job_id, code, message, context_json,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`
    )
    .run(
      newId("exception"),
      input.leadId ?? null,
      input.jobId ?? null,
      input.code,
      input.message.slice(0, 2000),
      JSON.stringify(input.context ?? {}),
      now,
      now
    );
}

function reschedule(
  database: Database.Database,
  jobId: string,
  availableAt: string,
  reason: string
): void {
  database
    .prepare(
      `UPDATE jobs
       SET status = 'queued', available_at = ?, locked_at = NULL,
           locked_by = NULL, last_error = ?, updated_at = ?
       WHERE id = ? AND status = 'running'`
    )
    .run(availableAt, reason, utcNow(), jobId);
}

function browserRunStarted(
  database: Database.Database,
  job: JobRow,
  leadId: string,
  mode: "dry_run" | "live",
  url: string,
  message: string,
  variantId?: string
): string {
  const runId = newId("browser_run");
  database
    .prepare(
      `INSERT INTO browser_runs (
        id, job_id, lead_id, mode, status, url, message, variant_id
      ) VALUES (?, ?, ?, ?, 'started', ?, ?, ?)`
    )
    .run(runId, job.id, leadId, mode, url, message, variantId ?? null);
  return runId;
}

function browserRunFinished(
  database: Database.Database,
  runId: string,
  status: "sent" | "blocked" | "failed",
  url: string,
  diagnostics: Record<string, unknown>
): void {
  database
    .prepare(
      `UPDATE browser_runs
       SET status = ?, url = ?, diagnostics_json = ?, finished_at = ?
       WHERE id = ?`
    )
    .run(status, url, JSON.stringify(diagnostics), utcNow(), runId);
}

async function handleDiscover(
  job: JobRow,
  dependencies: HandlerDependencies
): Promise<JobOutcome> {
  const input = discoverPayloadSchema.parse(payload(job));
  const score = scoreProfile(input.signals);
  const result = discoverLead(dependencies.database, {
    funnel: input.funnel,
    instagramUsername: input.instagramUsername,
    instagramUserId: input.instagramUserId,
    displayName: input.displayName,
    biography: input.biography,
    category: input.category,
    location: input.location,
    language: input.language,
    niche: input.niche,
    source: input.source,
    sourceKeyword: input.sourceKeyword,
    score,
    decisionMakerRole: input.signals.decisionMakerEvidence
      ? "decision_maker"
      : "unknown",
    profileSignals: input.signals
  });

  if (!result.created || score < 60) {
    return "completed";
  }

  transitionPipeline(
    dependencies.database,
    result.lead.id,
    "qualified",
    "worker",
    `profile_score:${score}`
  );
  enqueueJob(dependencies.database, {
    kind: "browser_first_contact",
    payload: {
      leadId: result.lead.id,
      mode: input.contactMode,
      publicReference: input.publicReference ?? null,
      operatorAuthorizedAt: input.operatorAuthorizedAt
    },
    idempotencyKey: `first_contact:${result.lead.id}:${input.contactMode}`
  });

  return "completed";
}

async function handleBrowserContact(
  job: JobRow,
  dependencies: HandlerDependencies,
  followUp: boolean
): Promise<JobOutcome> {
  const input = browserPayloadSchema.parse(payload(job));
  const lead = getLead(dependencies.database, input.leadId);

  if (!lead) {
    throw new Error(`Lead not found: ${input.leadId}`);
  }

  if (input.mode === "live") {
    const pacing = evaluateContactPacing(
      dependencies.database,
      dependencies.environment,
      job.id
    );

    if (!pacing.allowed && pacing.retryAt) {
      reschedule(dependencies.database, job.id, pacing.retryAt, pacing.reason);
      return "rescheduled";
    }
  }

  const message = followUp
    ? "Oi! Passando apenas para confirmar se faz sentido conversarmos. Se preferir, não volto a chamar."
    : buildFirstContact(dependencies.business, {
        funnel: lead.funnel,
        displayName: lead.display_name,
        publicReference: input.publicReference
      });
  const runId = browserRunStarted(
    dependencies.database,
    job,
    lead.id,
    input.mode,
    lead.profile_url,
    message,
    input.variantId
  );
  let reservedMessageId: string | undefined;

  try {
    if (input.mode === "live") {
      const reservation = followUp
        ? reserveBrowserFollowUp(dependencies.database, {
            leadId: lead.id,
            body: message,
            idempotencyKey: `browser_follow_up:${lead.id}:1`,
            variantId: input.variantId
          })
        : reserveBrowserFirstContact(dependencies.database, {
            leadId: lead.id,
            body: message,
            idempotencyKey: `browser_first_contact:${lead.id}`,
            variantId: input.variantId
          });

      if (reservation.alreadySent) {
        browserRunFinished(
          dependencies.database,
          runId,
          "sent",
          lead.profile_url,
          { idempotentReplay: true }
        );
        return "completed";
      }

      reservedMessageId = reservation.message.id;
    }

    const result = await dependencies.browser.sendFirstContact({
      jobId: job.id,
      leadId: lead.id,
      profileUrl: lead.profile_url,
      message,
      mode: input.mode,
      operatorAuthorizedAt: input.operatorAuthorizedAt
    });

    if (input.mode === "dry_run") {
      browserRunFinished(
        dependencies.database,
        runId,
        "blocked",
        result.finalUrl,
        {
          finalSendBlocked: true,
          accessibilitySnapshot: result.accessibilitySnapshot
        }
      );
      return "completed";
    }

    if (!result.sent || !reservedMessageId) {
      throw new Error("Browser did not confirm the structured send action.");
    }

    if (followUp) {
      markBrowserFollowUpSent(dependencies.database, reservedMessageId);
    } else {
      markBrowserFirstContactSent(dependencies.database, reservedMessageId);
      const nextActionAt = new Date(Date.now() + 72 * 60 * 60_000).toISOString();
      enqueueJob(dependencies.database, {
        kind: "browser_follow_up",
        payload: {
          leadId: lead.id,
          mode: "live",
          publicReference: null,
          operatorAuthorizedAt: input.operatorAuthorizedAt
        },
        availableAt: nextActionAt,
        idempotencyKey: `follow_up:${lead.id}:1`
      });
      dependencies.database
        .prepare("UPDATE leads SET next_action_at = ? WHERE id = ?")
        .run(nextActionAt, lead.id);
    }

    incrementBrowserDmCounter(
      dependencies.database,
      dependencies.environment.OPERATING_TIMEZONE
    );
    browserRunFinished(
      dependencies.database,
      runId,
      "sent",
      result.finalUrl,
      { accessibilitySnapshot: result.accessibilitySnapshot }
    );
    return "completed";
  } catch (error) {
    if (reservedMessageId) {
      markMessageFailed(
        dependencies.database,
        reservedMessageId,
        error instanceof Error ? error.message : String(error)
      );
    }

    const errorRecord =
      error && typeof error === "object"
        ? (error as { diagnosticsDirectory?: unknown })
        : {};
    browserRunFinished(
      dependencies.database,
      runId,
      "failed",
      lead.profile_url,
      {
        error: error instanceof Error ? error.message : String(error),
        diagnosticsDirectory:
          typeof errorRecord.diagnosticsDirectory === "string"
            ? errorRecord.diagnosticsDirectory
            : null
      }
    );

    if (
      error instanceof BrowserUnavailableError ||
      error instanceof InstagramRestrictionError
    ) {
      const code =
        error instanceof BrowserUnavailableError
          ? "browser_unavailable"
          : "instagram_restriction";
      setSystemPaused(dependencies.database, true, code, "worker");
      addException(dependencies.database, {
        leadId: lead.id,
        jobId: job.id,
        code,
        message: error.message
      });
      dependencies.database
        .prepare(
          `INSERT INTO integration_health
           (integration, status, message, checked_at)
           VALUES ('browser', 'unavailable', ?, ?)
           ON CONFLICT(integration) DO UPDATE SET
             status = excluded.status,
             message = excluded.message,
             checked_at = excluded.checked_at`
        )
        .run(error.message, utcNow());
    }

    throw error;
  }
}

function escalateToHuman(
  database: Database.Database,
  leadId: string,
  jobId: string,
  reason: string
): void {
  database.transaction(() => {
    database
      .prepare(
        `UPDATE leads
         SET channel_state = 'human_review_required',
             version = version + 1, updated_at = ?
         WHERE id = ?`
      )
      .run(utcNow(), leadId);
    database
      .prepare(
        `UPDATE channel_ownership
         SET owner = 'human', version = version + 1, updated_at = ?
         WHERE lead_id = ?`
      )
      .run(utcNow(), leadId);
    addException(database, {
      leadId,
      jobId,
      code: "human_review_required",
      message: reason
    });
  })();
}

async function handleInbound(
  job: JobRow,
  dependencies: HandlerDependencies
): Promise<JobOutcome> {
  const input = inboundPayloadSchema.parse(payload(job));
  let username: string | undefined;
  const known = findLeadForInbound(dependencies.database, input.senderId);

  if (!known) {
    const profile = await dependencies.instagramApi.getProfile(input.senderId);
    username = profile.username;
  }

  const inbound = registerInboundMessage(dependencies.database, {
    externalEventId: input.externalEventId,
    senderId: input.senderId,
    username,
    body: input.body,
    timestamp: input.timestamp
  });

  if (!inbound.lead || inbound.duplicate || inbound.optedOut) {
    return "completed";
  }

  const assignments = dependencies.database
    .prepare(
      `SELECT e.name, v.name AS variant
       FROM experiment_assignments a
       JOIN experiments e ON e.id = a.experiment_id
       JOIN experiment_variants v ON v.id = a.variant_id
       WHERE a.lead_id = ?`
    )
    .all(inbound.lead.id) as Array<{ name: string; variant: string }>;
  if (!dependencies.conversationEngine) {
    escalateToHuman(
      dependencies.database,
      inbound.lead.id,
      job.id,
      "OpenAI is not configured."
    );
    return "completed";
  }

  const decision = await dependencies.conversationEngine.decide({
    leadId: inbound.lead.id,
    funnel: inbound.lead.funnel,
    profile: {
      username: inbound.lead.instagram_username,
      displayName: inbound.lead.display_name,
      biography: inbound.lead.biography,
      category: inbound.lead.category,
      niche: inbound.lead.niche,
      publicSignals: safeObject(inbound.lead.profile_signals_json)
    },
    pipelineState: inbound.lead.pipeline_state,
    history: conversationHistory(dependencies.database, inbound.lead.id),
    experiments: assignments
  });

  if (decision.intent === "opt_out") {
    markDoNotContact(
      dependencies.database,
      inbound.lead.id,
      "classified_opt_out",
      "conversation_engine"
    );
    return "completed";
  }

  if (
    decision.intent === "needs_human" ||
    decision.action === "escalate_human"
  ) {
    escalateToHuman(
      dependencies.database,
      inbound.lead.id,
      job.id,
      decision.reason
    );
    return "completed";
  }

  enqueueJob(dependencies.database, {
    kind: "api_reply",
    payload: {
      leadId: inbound.lead.id,
      inboundEventId: input.externalEventId,
      decision
    },
    idempotencyKey: `api_reply:${input.externalEventId}`
  });

  return "completed";
}

async function handleApiReply(
  job: JobRow,
  dependencies: HandlerDependencies
): Promise<JobOutcome> {
  const input = apiReplyPayloadSchema.parse(payload(job));
  const result = await sendOfficialApiReply(
    dependencies.database,
    dependencies.instagramApi,
    dependencies.business,
    input.leadId,
    input.decision,
    `api_reply:${input.inboundEventId}`
  );

  if (!result.sent) {
    escalateToHuman(
      dependencies.database,
      input.leadId,
      job.id,
      "Conversation decision produced no automatic response."
    );
    return "completed";
  }

  let lead = getLead(dependencies.database, input.leadId);

  if (!lead) {
    return "completed";
  }

  if (
    ["interested", "wants_whatsapp"].includes(input.decision.intent) &&
    lead.pipeline_state === "replied"
  ) {
    lead = transitionPipeline(
      dependencies.database,
      lead.id,
      "interested",
      "worker",
      `intent:${input.decision.intent}`
    );
  }

  if (
    input.decision.intent === "wants_whatsapp" &&
    lead.funnel === "client" &&
    lead.pipeline_state === "interested"
  ) {
    transitionPipeline(
      dependencies.database,
      lead.id,
      "whatsapp_handoff",
      "worker",
      "whatsapp_link_sent"
    );
  }

  if (
    input.decision.intent === "not_interested" &&
    ["replied", "interested"].includes(lead.pipeline_state)
  ) {
    transitionPipeline(
      dependencies.database,
      lead.id,
      "closed",
      "worker",
      "not_interested"
    );
  }

  return "completed";
}

async function handleOptimize(
  job: JobRow,
  dependencies: HandlerDependencies
): Promise<JobOutcome> {
  const input = optimizePayloadSchema.parse(payload(job));
  adaptExperimentAllocation(
    dependencies.database,
    input.experimentId,
    20
  );
  return "completed";
}

async function handleIntegrationHealth(
  dependencies: HandlerDependencies
): Promise<JobOutcome> {
  const checks = [
    {
      name: "openai",
      configured: Boolean(
        dependencies.environment.OPENAI_API_KEY &&
          dependencies.environment.OPENAI_MODEL &&
          dependencies.environment.OPENAI_MODEL_FAST
      )
    },
    {
      name: "instagram_api",
      configured: Boolean(
        dependencies.environment.INSTAGRAM_PAGE_ACCESS_TOKEN &&
          dependencies.environment.INSTAGRAM_BUSINESS_ACCOUNT_ID &&
          dependencies.environment.INSTAGRAM_GRAPH_API_VERSION
      )
    },
    {
      name: "instagram_webhook",
      configured: Boolean(
        dependencies.environment.INSTAGRAM_APP_SECRET &&
          dependencies.environment.INSTAGRAM_WEBHOOK_VERIFY_TOKEN
      )
    }
  ];

  const statement = dependencies.database.prepare(
    `INSERT INTO integration_health
     (integration, status, message, checked_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(integration) DO UPDATE SET
       status = excluded.status,
       message = excluded.message,
       checked_at = excluded.checked_at`
  );

  for (const check of checks) {
    statement.run(
      check.name,
      check.configured ? "healthy" : "unconfigured",
      check.configured ? null : "Required environment variables are missing.",
      utcNow()
    );
  }

  return "completed";
}

async function handleBackup(
  dependencies: HandlerDependencies
): Promise<JobOutcome> {
  const backup = await createBackup(dependencies.database);
  await verifyBackupCopy(backup.path);
  const nextRun = new Date(Date.now() + 24 * 60 * 60_000);

  enqueueJob(dependencies.database, {
    kind: "backup",
    payload: {},
    availableAt: nextRun.toISOString(),
    idempotencyKey: "backup:" + nextRun.toISOString().slice(0, 10)
  });

  return "completed";
}

export async function handleJob(
  job: JobRow,
  dependencies: HandlerDependencies
): Promise<JobOutcome> {
  switch (job.kind) {
    case "discover_profile":
      return handleDiscover(job, dependencies);
    case "browser_first_contact":
      return handleBrowserContact(job, dependencies, false);
    case "browser_follow_up":
    case "follow_up":
      return handleBrowserContact(job, dependencies, true);
    case "process_inbound":
      return handleInbound(job, dependencies);
    case "api_reply":
      return handleApiReply(job, dependencies);
    case "optimize_experiment":
      return handleOptimize(job, dependencies);
    case "integration_health":
      return handleIntegrationHealth(dependencies);
    case "backup":
      return handleBackup(dependencies);
    default:
      throw new Error(`Unknown job kind: ${job.kind}`);
  }
}
