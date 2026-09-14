import "server-only";
import type { LeadRow } from "@/db/records";
import { getDatabase } from "@/db/client";
import { getSystemStatus } from "@/lib/system-control";
import type { Funnel } from "@/lib/states";

interface CountRow {
  count: number;
}

interface CostRow {
  total: number | null;
}

export interface PipelineCount {
  state: string;
  count: number;
}

export interface IntegrationRow {
  integration: string;
  status: string;
  message: string | null;
  checked_at: string;
}

export interface ExceptionRow {
  id: string;
  code: string;
  message: string;
  status: string;
  lead_id: string | null;
  job_id: string | null;
  created_at: string;
}

export interface DashboardSnapshot {
  system: ReturnType<typeof getSystemStatus>;
  totalLeads: number;
  replies: number;
  activeCustomers: number;
  activeAffiliates: number;
  overdueFollowUps: number;
  aiCostMicros: number;
  aiCostPerLeadMicros: number;
  aiCostPerActiveCustomerMicros: number;
  clientPipeline: PipelineCount[];
  affiliatePipeline: PipelineCount[];
  jobCounts: Record<string, number>;
  integrations: IntegrationRow[];
  exceptions: ExceptionRow[];
}

function count(sql: string, parameter?: string): number {
  const database = getDatabase().sqlite;
  const row = (
    parameter
      ? database.prepare(sql).get(parameter)
      : database.prepare(sql).get()
  ) as CountRow;

  return row.count;
}

function pipeline(funnel: Funnel): PipelineCount[] {
  return getDatabase()
    .sqlite.prepare(
      `SELECT pipeline_state AS state, COUNT(*) AS count
       FROM leads WHERE funnel = ?
       GROUP BY pipeline_state`
    )
    .all(funnel) as PipelineCount[];
}

export function dashboardSnapshot(): DashboardSnapshot {
  const database = getDatabase().sqlite;
  const totalLeads = count("SELECT COUNT(*) AS count FROM leads");
  const activeCustomers = count(
    "SELECT COUNT(*) AS count FROM leads WHERE funnel = 'client' AND pipeline_state = 'active_customer'"
  );
  const cost = database
    .prepare(
      `SELECT SUM(estimated_cost_micros) AS total
       FROM ai_calls
       WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`
    )
    .get() as CostRow;
  const aiCostMicros = cost.total ?? 0;
  const jobRows = database
    .prepare("SELECT status, COUNT(*) AS count FROM jobs GROUP BY status")
    .all() as Array<{ status: string; count: number }>;

  return {
    system: getSystemStatus(database),
    totalLeads,
    replies: count(
      "SELECT COUNT(*) AS count FROM leads WHERE pipeline_state IN ('replied', 'interested', 'whatsapp_handoff', 'registered', 'active_customer', 'joined_affiliate_group', 'active_affiliate', 'generated_customer')"
    ),
    activeCustomers,
    activeAffiliates: count(
      "SELECT COUNT(*) AS count FROM leads WHERE funnel = 'affiliate' AND pipeline_state IN ('active_affiliate', 'generated_customer')"
    ),
    overdueFollowUps: count(
      "SELECT COUNT(*) AS count FROM leads WHERE next_action_at IS NOT NULL AND next_action_at < ?",
      new Date().toISOString()
    ),
    aiCostMicros,
    aiCostPerLeadMicros:
      totalLeads === 0 ? 0 : Math.round(aiCostMicros / totalLeads),
    aiCostPerActiveCustomerMicros:
      activeCustomers === 0 ? 0 : Math.round(aiCostMicros / activeCustomers),
    clientPipeline: pipeline("client"),
    affiliatePipeline: pipeline("affiliate"),
    jobCounts: Object.fromEntries(
      jobRows.map((row) => [row.status, row.count])
    ),
    integrations: database
      .prepare(
        "SELECT * FROM integration_health ORDER BY integration ASC"
      )
      .all() as IntegrationRow[],
    exceptions: database
      .prepare(
        `SELECT id, code, message, status, lead_id, job_id, created_at
         FROM exceptions WHERE status = 'open'
         ORDER BY created_at DESC LIMIT 10`
      )
      .all() as ExceptionRow[]
  };
}

export function pipelineLeads(funnel: Funnel): LeadRow[] {
  return getDatabase()
    .sqlite.prepare(
      "SELECT * FROM leads WHERE funnel = ? ORDER BY score DESC, updated_at DESC"
    )
    .all(funnel) as LeadRow[];
}

export function leadDetails(leadId: string): {
  lead: LeadRow | null;
  messages: Array<Record<string, string | null>>;
  events: Array<Record<string, string | null>>;
  aiCalls: Array<Record<string, string | number | null>>;
} {
  const database = getDatabase().sqlite;
  const lead = (database.prepare("SELECT * FROM leads WHERE id = ?").get(leadId) ??
    null) as LeadRow | null;

  return {
    lead,
    messages: database
      .prepare(
        `SELECT id, direction, channel, status, body, sent_at, created_at
         FROM messages WHERE lead_id = ? ORDER BY created_at DESC`
      )
      .all(leadId) as Array<Record<string, string | null>>,
    events: database
      .prepare(
        `SELECT id, type, actor, payload_json, created_at
         FROM events WHERE lead_id = ? ORDER BY created_at DESC`
      )
      .all(leadId) as Array<Record<string, string | null>>,
    aiCalls: database
      .prepare(
        `SELECT id, purpose, model, input_tokens, output_tokens,
                estimated_cost_micros, decision_json, created_at
         FROM ai_calls WHERE lead_id = ? ORDER BY created_at DESC`
      )
      .all(leadId) as Array<Record<string, string | number | null>>
  };
}

export function recentJobs(): Array<Record<string, string | number | null>> {
  return getDatabase()
    .sqlite.prepare(
      `SELECT id, kind, status, attempts, max_attempts, available_at,
              last_error, created_at
       FROM jobs ORDER BY created_at DESC LIMIT 200`
    )
    .all() as Array<Record<string, string | number | null>>;
}

export function experimentRows(): Array<Record<string, string | number | null>> {
  return getDatabase()
    .sqlite.prepare(
      `SELECT e.id, e.name, e.funnel, e.variable, e.status,
              e.minimum_sample_size, e.exploration_percent,
              COUNT(DISTINCT a.id) AS sample_size,
              SUM(CASE WHEN a.outcome IS NOT NULL THEN 1 ELSE 0 END) AS conversions
       FROM experiments e
       LEFT JOIN experiment_assignments a ON a.experiment_id = e.id
       GROUP BY e.id
       ORDER BY e.created_at DESC`
    )
    .all() as Array<Record<string, string | number | null>>;
}
