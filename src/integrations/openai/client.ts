import OpenAI from "openai";
import type Database from "better-sqlite3";
import type { BusinessConfig } from "@/config/business";
import {
  conversationDecisionSchema,
  type ConversationDecision
} from "@/features/conversations/policy";
import { getEnvironment } from "@/env";
import { newId } from "@/lib/ids";
import { setSystemPaused } from "@/lib/system-control";

export interface ConversationContext {
  leadId: string;
  funnel: "client" | "affiliate";
  profile: {
    username: string;
    displayName: string | null;
    biography: string | null;
    category: string | null;
    niche: string | null;
    publicSignals: Record<string, unknown>;
  };
  pipelineState: string;
  history: Array<{
    direction: "inbound" | "outbound";
    body: string;
    createdAt: string;
  }>;
  experiments: Array<{
    name: string;
    variant: string;
  }>;
}

export class OpenAiBudgetExceededError extends Error {
  constructor() {
    super("OpenAI monthly budget reached.");
    this.name = "OpenAiBudgetExceededError";
  }
}

interface SpendRow {
  total: number | null;
}

export function currentMonthAiCostMicros(
  database: Database.Database
): number {
  const row = database
    .prepare(
      `SELECT SUM(estimated_cost_micros) AS total
       FROM ai_calls
       WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`
    )
    .get() as SpendRow;

  return row.total ?? 0;
}

function estimateCostMicros(
  inputTokens: number,
  outputTokens: number
): number {
  const environment = getEnvironment();
  const inputPrice = environment.AI_PRICE_INPUT_PER_MILLION_USD ?? 0;
  const outputPrice = environment.AI_PRICE_OUTPUT_PER_MILLION_USD ?? 0;

  return Math.round(inputTokens * inputPrice + outputTokens * outputPrice);
}

function systemPrompt(config: BusinessConfig): string {
  return [
    "Classify the latest inbound Instagram message and choose one safe next action.",
    "Return JSON only.",
    "Never write an outbound message.",
    "Never invent price, rate, condition, guarantee, relationship, approval, financial result, or superlative.",
    "Only select claim IDs from VERIFIED_CLAIMS.",
    "If the person asks to stop, select intent opt_out and action close.",
    "If certainty is low, select needs_human and escalate_human.",
    `Company: ${config.company.name}`,
    `Owner: ${config.owner.name}, ${config.owner.role}`,
    `Offer identity: ${config.offer.oneLinePitch}`,
    `VERIFIED_CLAIMS: ${JSON.stringify(config.claims.verified)}`,
    `BLOCKED_UNVERIFIED_CLAIMS: ${JSON.stringify(config.claims.unverified)}`,
    "Required keys: intent, action, reason, verifiedClaimIds, askTopic."
  ].join("\n");
}

function recordCall(
  database: Database.Database,
  input: {
    leadId: string;
    purpose: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    content: string | null;
  }
): void {
  database
    .prepare(
      `INSERT INTO ai_calls (
        id, lead_id, purpose, model, input_tokens, output_tokens,
        estimated_cost_micros, decision_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      newId("ai"),
      input.leadId,
      input.purpose,
      input.model,
      input.inputTokens,
      input.outputTokens,
      estimateCostMicros(input.inputTokens, input.outputTokens),
      input.content
    );
}

export class ConversationEngine {
  constructor(
    private readonly database: Database.Database,
    private readonly business: BusinessConfig,
    private readonly client: OpenAI
  ) {}

  async decide(
    context: ConversationContext,
    useFastModel = true
  ): Promise<ConversationDecision> {
    const environment = getEnvironment();
    const budgetMicros = Math.round(
      environment.OPENAI_MONTHLY_BUDGET_USD * 1_000_000
    );

    if (currentMonthAiCostMicros(this.database) >= budgetMicros) {
      setSystemPaused(
        this.database,
        true,
        "openai_monthly_budget_reached",
        "system"
      );
      throw new OpenAiBudgetExceededError();
    }

    const model = useFastModel
      ? environment.OPENAI_MODEL_FAST
      : environment.OPENAI_MODEL;

    if (!model) {
      throw new Error("Required OpenAI model is not configured.");
    }

    const response = await this.client.chat.completions.create({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt(this.business) },
        {
          role: "user",
          content: JSON.stringify({
            funnel: context.funnel,
            profile: context.profile,
            pipelineState: context.pipelineState,
            history: context.history,
            experiments: context.experiments,
            latestInbound: context.history
              .filter((message) => message.direction === "inbound")
              .at(-1)?.body
          })
        }
      ]
    });

    const content = response.choices[0]?.message.content ?? null;
    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;

    recordCall(this.database, {
      leadId: context.leadId,
      purpose: "conversation_decision",
      model,
      inputTokens,
      outputTokens,
      content
    });

    if (!content) {
      throw new Error("OpenAI returned an empty decision.");
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(content) as unknown;
    } catch {
      throw new Error("OpenAI returned invalid JSON.");
    }

    return conversationDecisionSchema.parse(parsed);
  }
}

export function createConversationEngine(
  database: Database.Database,
  business: BusinessConfig
): ConversationEngine {
  const apiKey = getEnvironment().OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  return new ConversationEngine(database, business, new OpenAI({ apiKey }));
}
