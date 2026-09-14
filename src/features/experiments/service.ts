import type Database from "better-sqlite3";
import { hashText, newId } from "@/lib/ids";
import type { Funnel, PipelineState } from "@/lib/states";

interface VariantRow {
  id: string;
  name: string;
  allocation_percent: number;
  is_control: number;
}

interface ExistingAssignment {
  id: string;
  variant_id: string;
}

interface ActiveExperimentRow {
  id: string;
}

interface AssignedVariantRow {
  experiment_id: string;
  variant_id: string;
  content_json: string;
}

interface AssignmentOutcomeRow {
  experiment_id: string;
  outcome_value: number | null;
}

export interface ActiveVariantAssignment {
  experimentId: string;
  variantId: string;
  content: string;
}

export interface VariantPerformance {
  variantId: string;
  name: string;
  sampleSize: number;
  conversions: number;
  outcomeScore: number;
  conversionRate: number;
  confidenceLow: number;
  confidenceHigh: number;
  isControl: boolean;
}

export interface ExperimentEvaluation {
  ready: boolean;
  reason: string;
  variants: VariantPerformance[];
  winnerVariantId: string | null;
}

const pipelineOutcomes = {
  discovered: null,
  qualified: null,
  contacted: null,
  replied: { outcome: "reply", value: 0.15 },
  interested: { outcome: "interest", value: 0.3 },
  whatsapp_handoff: { outcome: "qualified_handoff", value: 0.45 },
  registered: { outcome: "registration", value: 0.7 },
  active_customer: { outcome: "active_customer", value: 1 },
  joined_affiliate_group: { outcome: "joined_affiliate_group", value: 0.45 },
  active_affiliate: { outcome: "active_affiliate", value: 0.7 },
  generated_customer: { outcome: "generated_customer", value: 1 },
  closed: null
} satisfies Record<
  PipelineState,
  { outcome: string; value: number } | null
>;

function wilsonInterval(
  conversions: number,
  sampleSize: number,
  z = 1.96
): [number, number] {
  if (sampleSize === 0) {
    return [0, 1];
  }

  const rate = conversions / sampleSize;
  const denominator = 1 + (z * z) / sampleSize;
  const center = rate + (z * z) / (2 * sampleSize);
  const margin =
    z *
    Math.sqrt(
      (rate * (1 - rate) + (z * z) / (4 * sampleSize)) / sampleSize
    );

  return [
    Math.max(0, (center - margin) / denominator),
    Math.min(1, (center + margin) / denominator)
  ];
}

function variantContent(value: string): string {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("Experiment variant content is invalid JSON.");
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    typeof (parsed as Record<string, unknown>).content !== "string"
  ) {
    throw new Error("Experiment variant must contain string content.");
  }

  return (parsed as { content: string }).content;
}

export function assignVariant(
  database: Database.Database,
  experimentId: string,
  leadId: string
): string {
  return database.transaction(() => {
    const existing = database
      .prepare(
        `SELECT id, variant_id FROM experiment_assignments
         WHERE experiment_id = ? AND lead_id = ?`
      )
      .get(experimentId, leadId) as ExistingAssignment | undefined;

    if (existing) {
      return existing.variant_id;
    }

    const experiment = database
      .prepare(
        "SELECT status FROM experiments WHERE id = ? AND status = 'running'"
      )
      .get(experimentId);

    if (!experiment) {
      throw new Error("Experiment is not running.");
    }

    const variants = database
      .prepare(
        `SELECT id, name, allocation_percent, is_control
         FROM experiment_variants
         WHERE experiment_id = ?
         ORDER BY is_control DESC, id ASC`
      )
      .all(experimentId) as VariantRow[];

    if (variants.length < 2) {
      throw new Error("A running experiment needs at least two variants.");
    }

    const allocation = variants.reduce(
      (total, variant) => total + variant.allocation_percent,
      0
    );

    if (allocation !== 100) {
      throw new Error("Experiment allocation must total 100 percent.");
    }

    const bucket =
      Number.parseInt(hashText(`${experimentId}:${leadId}`).slice(0, 8), 16) %
      100;
    let cumulative = 0;
    const selected =
      variants.find((variant) => {
        cumulative += variant.allocation_percent;
        return bucket < cumulative;
      }) ?? variants[variants.length - 1];

    if (!selected) {
      throw new Error("Unable to assign experiment variant.");
    }

    database
      .prepare(
        `INSERT INTO experiment_assignments
         (id, experiment_id, variant_id, lead_id)
         VALUES (?, ?, ?, ?)`
      )
      .run(newId("assignment"), experimentId, selected.id, leadId);

    return selected.id;
  })();
}

export function assignActiveVariant(
  database: Database.Database,
  funnel: Funnel,
  leadId: string
): ActiveVariantAssignment | null {
  const active = database
    .prepare(
      `SELECT id FROM experiments
       WHERE funnel = ? AND status = 'running'
       ORDER BY started_at ASC, created_at ASC
       LIMIT 2`
    )
    .all(funnel) as ActiveExperimentRow[];

  if (active.length > 1) {
    throw new Error("Only one running experiment is allowed per funnel.");
  }

  const experiment = active[0];

  if (!experiment) {
    return null;
  }

  const variantId = assignVariant(database, experiment.id, leadId);
  const assigned = database
    .prepare(
      `SELECT experiment_id, id AS variant_id, content_json
       FROM experiment_variants
       WHERE experiment_id = ? AND id = ?`
    )
    .get(experiment.id, variantId) as AssignedVariantRow | undefined;

  if (!assigned) {
    throw new Error("Assigned experiment variant was not found.");
  }

  return {
    experimentId: assigned.experiment_id,
    variantId: assigned.variant_id,
    content: variantContent(assigned.content_json)
  };
}

export function runningExperimentIdsForLead(
  database: Database.Database,
  leadId: string
): string[] {
  const rows = database
    .prepare(
      `SELECT a.experiment_id
       FROM experiment_assignments a
       JOIN experiments e ON e.id = a.experiment_id
       WHERE a.lead_id = ? AND e.status = 'running'`
    )
    .all(leadId) as Array<{ experiment_id: string }>;

  return rows.map((row) => row.experiment_id);
}

export function recordExperimentOutcome(
  database: Database.Database,
  experimentId: string,
  leadId: string,
  outcome: string,
  value = 1
): void {
  database
    .prepare(
      `UPDATE experiment_assignments
       SET outcome = ?, outcome_value = ?, converted_at = CURRENT_TIMESTAMP
       WHERE experiment_id = ? AND lead_id = ?
         AND (outcome_value IS NULL OR outcome_value < ?)`
    )
    .run(outcome, value, experimentId, leadId, value);
}

export function recordLeadExperimentOutcome(
  database: Database.Database,
  leadId: string,
  outcome: string,
  value: number
): string[] {
  if (value <= 0 || value > 1) {
    throw new Error("Experiment outcome value must be greater than 0 and at most 1.");
  }

  const assignments = database
    .prepare(
      `SELECT a.experiment_id, a.outcome_value
       FROM experiment_assignments a
       JOIN experiments e ON e.id = a.experiment_id
       WHERE a.lead_id = ? AND e.status = 'running'`
    )
    .all(leadId) as AssignmentOutcomeRow[];
  const updated: string[] = [];

  database.transaction(() => {
    for (const assignment of assignments) {
      if (
        assignment.outcome_value !== null &&
        assignment.outcome_value >= value
      ) {
        continue;
      }

      recordExperimentOutcome(
        database,
        assignment.experiment_id,
        leadId,
        outcome,
        value
      );
      updated.push(assignment.experiment_id);
    }
  })();

  return updated;
}

export function recordPipelineExperimentOutcome(
  database: Database.Database,
  leadId: string,
  state: PipelineState
): string[] {
  const outcome = pipelineOutcomes[state];

  return outcome
    ? recordLeadExperimentOutcome(
        database,
        leadId,
        outcome.outcome,
        outcome.value
      )
    : [];
}

export function evaluateExperiment(
  database: Database.Database,
  experimentId: string
): ExperimentEvaluation {
  const experiment = database
    .prepare(
      "SELECT minimum_sample_size FROM experiments WHERE id = ?"
    )
    .get(experimentId) as { minimum_sample_size: number } | undefined;

  if (!experiment) {
    throw new Error("Experiment not found.");
  }

  const rows = database
    .prepare(
      `SELECT v.id AS variant_id, v.name, v.is_control,
              COUNT(a.id) AS sample_size,
              SUM(CASE WHEN a.outcome IS NOT NULL THEN 1 ELSE 0 END) AS conversions,
              SUM(
                CASE
                  WHEN a.outcome_value IS NOT NULL THEN a.outcome_value
                  WHEN a.outcome IS NOT NULL THEN 1
                  ELSE 0
                END
              ) AS outcome_score
       FROM experiment_variants v
       LEFT JOIN experiment_assignments a ON a.variant_id = v.id
       WHERE v.experiment_id = ?
       GROUP BY v.id, v.name, v.is_control
       ORDER BY v.is_control DESC, v.id ASC`
    )
    .all(experimentId) as Array<{
      variant_id: string;
      name: string;
      is_control: number;
      sample_size: number;
      conversions: number;
      outcome_score: number;
    }>;

  const variants = rows.map((row) => {
    const outcomeScore = row.outcome_score ?? 0;
    const [confidenceLow, confidenceHigh] = wilsonInterval(
      outcomeScore,
      row.sample_size
    );

    return {
      variantId: row.variant_id,
      name: row.name,
      sampleSize: row.sample_size,
      conversions: row.conversions,
      outcomeScore,
      conversionRate:
        row.sample_size === 0 ? 0 : outcomeScore / row.sample_size,
      confidenceLow,
      confidenceHigh,
      isControl: row.is_control === 1
    };
  });

  if (
    variants.length < 2 ||
    variants.some(
      (variant) => variant.sampleSize < experiment.minimum_sample_size
    )
  ) {
    return {
      ready: false,
      reason: "minimum_sample_not_reached",
      variants,
      winnerVariantId: null
    };
  }

  const ranked = [...variants].sort(
    (left, right) => right.conversionRate - left.conversionRate
  );
  const winner = ranked[0];
  const runnerUp = ranked[1];

  if (
    !winner ||
    !runnerUp ||
    winner.confidenceLow <= runnerUp.confidenceHigh
  ) {
    return {
      ready: false,
      reason: "confidence_intervals_overlap",
      variants,
      winnerVariantId: null
    };
  }

  return {
    ready: true,
    reason: "statistically_separated",
    variants,
    winnerVariantId: winner.variantId
  };
}

export function adaptExperimentAllocation(
  database: Database.Database,
  experimentId: string,
  explorationPercent = 20
): ExperimentEvaluation {
  const evaluation = evaluateExperiment(database, experimentId);

  if (!evaluation.ready || !evaluation.winnerVariantId) {
    return evaluation;
  }

  const variants = evaluation.variants;
  const remaining = Math.max(explorationPercent, 10);
  const otherCount = variants.length - 1;
  const baseOther = Math.floor(remaining / otherCount);
  let remainder = remaining - baseOther * otherCount;

  database.transaction(() => {
    for (const variant of variants) {
      let allocation = 100 - remaining;

      if (variant.variantId !== evaluation.winnerVariantId) {
        allocation = baseOther + (remainder > 0 ? 1 : 0);
        remainder = Math.max(0, remainder - 1);
      }

      database
        .prepare(
          `UPDATE experiment_variants
           SET allocation_percent = ?
           WHERE id = ? AND experiment_id = ?`
        )
        .run(allocation, variant.variantId, experimentId);
    }

    database
      .prepare(
        `INSERT INTO audit_log (
          id, actor, action, entity_type, entity_id, after_json
        ) VALUES (?, 'optimizer', 'adapt_allocation', 'experiment', ?, ?)`
      )
      .run(
        newId("audit"),
        experimentId,
        JSON.stringify({
          winnerVariantId: evaluation.winnerVariantId,
          explorationPercent: remaining
        })
      );
  })();

  return evaluation;
}
