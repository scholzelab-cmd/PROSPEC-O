import type Database from "better-sqlite3";
import { createDatabase, type DatabaseClient } from "@/db/client";
import type { BusinessConfig } from "@/config/business";
import {
  discoverLead,
  transitionPipeline
} from "@/features/leads/service";

export function testDatabase(): DatabaseClient {
  return createDatabase(":memory:");
}

export const businessFixture: BusinessConfig = {
  owner: { name: "Pessoa Responsável", role: "Direção" },
  company: {
    name: "Empresa Exemplo",
    website: "https://www.instagram.com/empresa.exemplo",
    instagramHandle: "@empresa.exemplo"
  },
  links: {
    whatsapp: "https://example.com/whatsapp",
    affiliateGroup: "https://example.com/affiliates"
  },
  offer: {
    oneLinePitch: "Serviço visual especializado",
    howItWorks: ["Entender a ideia", "Receber materiais", "Definir escopo"],
    revenueModel: "Prestação de serviço",
    marketJargon: [{ term: "visual", meaning: "material visual" }]
  },
  claims: {
    verified: [
      {
        id: "service_scope",
        text: "O escopo é definido antes do início.",
        source: "https://example.com/official"
      }
    ],
    unverified: [
      {
        id: "blocked_result",
        text: "Resultado garantido em sete dias"
      }
    ]
  },
  audiences: {
    icpSegments: ["segmento exemplo"],
    icpKeywords: ["palavra exemplo"],
    affiliateTopics: ["tópico exemplo"],
    geography: ["Brasil"]
  }
};

export function createQualifiedLead(
  database: Database.Database,
  suffix = "one",
  funnel: "client" | "affiliate" = "client"
) {
  const usernameSuffix = suffix.toLowerCase().replace(/[^a-z0-9._]/g, ".");
  const discovered = discoverLead(database, {
    funnel,
    instagramUsername: "example." + usernameSuffix,
    displayName: "Perfil Exemplo",
    source: "test",
    score: 80
  });
  return transitionPipeline(
    database,
    discovered.lead.id,
    "qualified",
    "test",
    "fixture"
  );
}
