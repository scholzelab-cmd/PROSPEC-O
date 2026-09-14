"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDatabase } from "@/db/client";
import {
  discoverLead,
  getLead,
  markDoNotContact,
  transitionPipeline
} from "@/features/leads/service";
import { getEnvironment } from "@/env";
import { normalizeExperimentQuestion } from "@/features/conversations/policy";
import { runningExperimentIdsForLead, recordPipelineExperimentOutcome } from "@/features/experiments/service";
import { isPipelineStateForFunnel } from "@/features/leads/domain";
import { newId } from "@/lib/ids";
import { setSystemPaused } from "@/lib/system-control";
import { enqueueJob } from "@/worker/queue";

const leadFormSchema = z.object({
  funnel: z.enum(["client", "affiliate"]),
  instagramUsername: z.string().min(1),
  displayName: z.string().optional(),
  niche: z.string().optional(),
  sourceKeyword: z.string().optional(),
  publicReference: z.string().optional(),
  score: z.coerce.number().int().min(0).max(100).default(60)
});

function text(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}

export async function createLeadAction(formData: FormData): Promise<void> {
  const parsed = leadFormSchema.parse({
    funnel: text(formData, "funnel"),
    instagramUsername: text(formData, "instagramUsername"),
    displayName: text(formData, "displayName"),
    niche: text(formData, "niche"),
    sourceKeyword: text(formData, "sourceKeyword"),
    publicReference: text(formData, "publicReference"),
    score: text(formData, "score")
  });
  const database = getDatabase().sqlite;
  const result = discoverLead(
    database,
    {
      funnel: parsed.funnel,
      instagramUsername: parsed.instagramUsername,
      displayName: parsed.displayName,
      niche: parsed.niche,
      source: "operator",
      sourceKeyword: parsed.sourceKeyword,
      score: parsed.score,
      profileSignals: {
        publicReference: parsed.publicReference ?? null,
        operatorEntered: true
      }
    },
    "operator"
  );

  if (result.created && parsed.score >= 60) {
    transitionPipeline(
      database,
      result.lead.id,
      "qualified",
      "operator",
      "manual_score"
    );
  }

  revalidatePath("/");
  revalidatePath("/leads");
  revalidatePath("/funnels/clients");
  revalidatePath("/funnels/affiliates");
  redirect(`/leads/${result.lead.id}`);
}

export async function setPauseAction(formData: FormData): Promise<void> {
  const paused = text(formData, "paused") === "true";
  setSystemPaused(
    getDatabase().sqlite,
    paused,
    paused ? "operator_pause" : "operator_resume",
    "operator"
  );
  revalidatePath("/");
  revalidatePath("/settings");
}

export async function queueDryRunAction(formData: FormData): Promise<void> {
  const leadId = z.string().min(1).parse(text(formData, "leadId"));
  const database = getDatabase().sqlite;
  const lead = getLead(database, leadId);

  if (!lead || lead.pipeline_state !== "qualified") {
    throw new Error("Somente leads qualificados podem entrar no teste sem envio.");
  }

  enqueueJob(database, {
    kind: "browser_first_contact",
    payload: {
      leadId,
      mode: "dry_run",
      publicReference: text(formData, "publicReference") ?? null
    },
    idempotencyKey: `browser_dry_run:${leadId}:${Date.now()}`
  });
  revalidatePath("/jobs");
  revalidatePath(`/leads/${leadId}`);
}

export async function queuePilotAction(formData: FormData): Promise<void> {
  const leadId = z.string().min(1).parse(text(formData, "leadId"));
  const confirmation = text(formData, "confirmation");

  if (confirmation !== "AUTORIZAR PILOTO") {
    throw new Error("Digite AUTORIZAR PILOTO para confirmar o envio real.");
  }

  if (!getEnvironment().BROWSER_SEND_ENABLED) {
    throw new Error(
      "O envio real está bloqueado. Defina BROWSER_SEND_ENABLED=true no .env e reinicie."
    );
  }

  const database = getDatabase().sqlite;
  const lead = getLead(database, leadId);

  if (!lead || lead.pipeline_state !== "qualified") {
    throw new Error("Somente leads qualificados podem entrar no piloto.");
  }

  enqueueJob(database, {
    kind: "browser_first_contact",
    payload: {
      leadId,
      mode: "live",
      publicReference: text(formData, "publicReference") ?? null,
      operatorAuthorizedAt: new Date().toISOString()
    },
    idempotencyKey: `browser_first_contact:${leadId}`
  });
  revalidatePath("/jobs");
  revalidatePath(`/leads/${leadId}`);
}

export async function doNotContactAction(formData: FormData): Promise<void> {
  const leadId = z.string().min(1).parse(text(formData, "leadId"));
  markDoNotContact(
    getDatabase().sqlite,
    leadId,
    "operator_request",
    "operator"
  );
  revalidatePath("/");
  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
}

export async function resolveExceptionAction(
  formData: FormData
): Promise<void> {
  const exceptionId = z.string().min(1).parse(text(formData, "exceptionId"));
  getDatabase()
    .sqlite.prepare(
      `UPDATE exceptions
       SET status = 'resolved', resolved_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(new Date().toISOString(), new Date().toISOString(), exceptionId);
  revalidatePath("/");
  revalidatePath("/exceptions");
}

export async function createExperimentAction(
  formData: FormData
): Promise<void> {
  const name = z.string().min(3).parse(text(formData, "name"));
  const funnel = z
    .enum(["client", "affiliate"])
    .parse(text(formData, "funnel"));
  const variable = z.string().min(2).parse(text(formData, "variable"));
  const control = normalizeExperimentQuestion(text(formData, "control"));
  const variant = normalizeExperimentQuestion(text(formData, "variant"));
  const database = getDatabase().sqlite;
  const runningExperiment = database
    .prepare("SELECT id FROM experiments WHERE funnel = ? AND status = 'running' LIMIT 1")
    .get(funnel) as { id: string } | undefined;

  if (runningExperiment) {
    throw new Error("Já existe um experimento em execução neste funil.");
  }

  const experimentId = newId("experiment");

  database.transaction(() => {
    database
      .prepare(
        `INSERT INTO experiments (
          id, name, funnel, variable, status, minimum_sample_size,
          exploration_percent, started_at
        ) VALUES (?, ?, ?, ?, 'running', 30, 10, ?)`
      )
      .run(experimentId, name, funnel, variable, new Date().toISOString());
    const statement = database.prepare(
      `INSERT INTO experiment_variants (
        id, experiment_id, name, is_control, allocation_percent, content_json
      ) VALUES (?, ?, ?, ?, 50, ?)`
    );
    statement.run(
      newId("variant"),
      experimentId,
      "Controle",
      1,
      JSON.stringify({ content: control })
    );
    statement.run(
      newId("variant"),
      experimentId,
      "Variante",
      0,
      JSON.stringify({ content: variant })
    );
  })();

  revalidatePath("/experiments");
}

export async function transitionLeadAction(formData: FormData): Promise<void> {
  const leadId = z.string().min(1).parse(text(formData, "leadId"));
  const requestedState = z.string().min(1).parse(text(formData, "pipelineState"));
  const database = getDatabase().sqlite;
  const lead = getLead(database, leadId);

  if (!lead || !isPipelineStateForFunnel(lead.funnel, requestedState)) {
    throw new Error("A etapa escolhida não pertence ao funil deste lead.");
  }

  transitionPipeline(
    database,
    lead.id,
    requestedState,
    "operator",
    "operator_pipeline_update"
  );
  recordPipelineExperimentOutcome(database, lead.id, requestedState);
  for (const experimentId of runningExperimentIdsForLead(database, lead.id)) {
    enqueueJob(database, {
      kind: "optimize_experiment",
      payload: { experimentId },
      idempotencyKey: `optimize:${experimentId}:${lead.id}:${requestedState}`
    });
  }

  revalidatePath("/");
  revalidatePath("/leads");
  revalidatePath("/funnels/clients");
  revalidatePath("/funnels/affiliates");
  revalidatePath(`/leads/${leadId}`);
}
