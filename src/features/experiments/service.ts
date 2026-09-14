import type Database from "better-sqlite3";
import { hashText, newId } from "@/lib/ids";

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

export interface VariantPerformance {
  variantId: string;
  name: string;
  sampleSize: number;
  conversions: number;
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
       WHERE experiment_id = ? AND lead_id = ? AND outcome IS NULL`
    )
    .run(outcome, value, experimentId, leadId);
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
              SUM(CASE WHEN a.outcome IS NOT NULL THEN 1 ELSE 0 END) AS conversions
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
    }>;

  const variants = rows.map((row) => {
    const [confidenceLow, confidenceHigh] = wilsonInterval(
      row.conversions,
      row.sample_size
    );

    return {
      variantId: row.variant_id,
      name: row.name,
      sampleSize: row.sample_size,
      conversions: row.conversions,
      conversionRate:
        row.sample_size === 0 ? 0 : row.conversions / row.sample_size,
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
