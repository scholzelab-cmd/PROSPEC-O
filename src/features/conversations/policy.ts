import { z } from "zod";
import type { BusinessConfig } from "@/config/business";
import {
  conversationActions,
  conversationIntents,
  type Funnel
} from "@/lib/states";

export const conversationDecisionSchema = z.object({
  intent: z.enum(conversationIntents),
  action: z.enum(conversationActions),
  reason: z.string().min(1).max(500),
  verifiedClaimIds: z.array(z.string()).max(3).default([]),
  askTopic: z
    .enum(["need", "current_process", "timing", "decision_maker", "none"])
    .default("none")
});

export type ConversationDecision = z.infer<typeof conversationDecisionSchema>;

export class OutboundPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundPolicyError";
  }
}

function normalized(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function detectImmediateOptOut(text: string): boolean {
  const value = normalized(text);
  return [
    "pare",
    "parar",
    "nao me chame",
    "nao quero contato",
    "remova meu contato",
    "sair",
    "stop",
    "unsubscribe"
  ].some((phrase) => value === phrase || value.includes(phrase));
}

export function verifiedClaimTexts(
  config: BusinessConfig,
  requestedIds: readonly string[]
): string[] {
  const claims = new Map(
    config.claims.verified.map((claim) => [claim.id, claim.text])
  );

  return requestedIds.map((id) => {
    const claim = claims.get(id);

    if (!claim) {
      throw new OutboundPolicyError(
        `Model selected a claim that is not verified: ${id}`
      );
    }

    return claim;
  });
}

export function normalizeExperimentQuestion(value: string): string {
  const question = value.replace(/\s+/g, " ").trim();

  if (
    question.length < 8 ||
    question.length > 180 ||
    !question.endsWith("?") ||
    /[.!\n]/.test(question.slice(0, -1)) ||
    /https?:\/\/|www\.|R\$|\d|garant|melhor|unico|lider|aprovac|resultado financeiro|taxa|preco|preço|valor/i.test(
      normalized(question)
    )
  ) {
    throw new OutboundPolicyError(
      "Experiment content must be one short, factual question without a commercial claim."
    );
  }

  return question;
}

export function assertNoBlockedClaim(
  config: BusinessConfig,
  message: string
): void {
  const candidate = normalized(message);

  for (const claim of config.claims.unverified) {
    if (candidate.includes(normalized(claim.text))) {
      throw new OutboundPolicyError(
        `Message contains blocked claim: ${claim.id}`
      );
    }
  }
}

function greeting(displayName: string | null): string {
  const firstName = displayName?.trim().split(/\s+/)[0];
  return firstName ? `Oi, ${firstName}!` : "Oi!";
}

export function buildFirstContact(
  config: BusinessConfig,
  input: {
    funnel: Funnel;
    displayName: string | null;
    publicReference: string | null;
    experimentQuestion?: string | null;
  }
): string {
  const reference = input.publicReference?.trim()
    ? ` Vi ${input.publicReference.trim()} no perfil.`
    : " Encontrei o perfil de vocês no Instagram.";
  const question = input.experimentQuestion
    ? ` ${normalizeExperimentQuestion(input.experimentQuestion)}`
    : input.funnel === "client"
      ? " Posso fazer uma pergunta rápida sobre como vocês apresentam os projetos?"
      : " Posso fazer uma pergunta rápida sobre o conteúdo que vocês produzem?";
  const message = `${greeting(input.displayName)}${reference} Sou ${config.owner.name}, da ${config.company.name}.${question}`;

  assertNoBlockedClaim(config, message);
  return message;
}

function informationMessage(
  config: BusinessConfig,
  claims: readonly string[]
): string {
  const parts = [
    `Sou ${config.owner.name}, ${config.owner.role} da ${config.company.name}.`,
    ...claims
  ];

  return parts.join(" ");
}

export function renderDecision(
  config: BusinessConfig,
  funnel: Funnel,
  decision: ConversationDecision
): { message: string | null; closeConversation: boolean } {
  const claims = verifiedClaimTexts(config, decision.verifiedClaimIds);
  let message: string | null = null;
  let closeConversation = false;

  switch (decision.intent) {
    case "opt_out":
      message = "Entendido. Não entraremos mais em contato.";
      closeConversation = true;
      break;
    case "not_interested":
      message = "Tudo bem, obrigado pela resposta.";
      closeConversation = true;
      break;
    case "wants_whatsapp":
      if (funnel === "affiliate" && !config.links.affiliateGroup) {
        throw new OutboundPolicyError(
          "Affiliate handoff is blocked because the group link is not configured."
        );
      }
      message =
        funnel === "client"
          ? `Perfeito. Você pode continuar por aqui: ${config.links.whatsapp}`
          : `Perfeito. O grupo de afiliados está aqui: ${config.links.affiliateGroup}`;
      break;
    case "asked_pricing":
      message =
        "Não vou informar preço automaticamente. Vou encaminhar sua dúvida para uma análise humana.";
      break;
    case "asked_info":
    case "interested":
      message = informationMessage(config, claims);
      break;
    case "not_the_owner":
      message = "Obrigado por avisar. Quem é a pessoa certa para falar sobre isso?";
      break;
    case "will_forward":
      message = "Obrigado. Fico à disposição se a pessoa responsável quiser conversar.";
      break;
    case "objection":
      message =
        claims.length > 0
          ? `${claims.join(" ")} Faz sentido eu entender melhor a sua dúvida?`
          : "Entendi a preocupação. Pode me dizer qual ponto pesa mais na decisão?";
      break;
    case "needs_human":
      message = null;
      break;
    case "ambiguous":
      message = "Só para eu entender corretamente: qual é a principal dúvida agora?";
      break;
  }

  if (message) {
    assertNoBlockedClaim(config, message);
  }

  return { message, closeConversation };
}
