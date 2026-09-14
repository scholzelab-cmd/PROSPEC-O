import "dotenv/config";
import { createDatabase } from "@/db/client";
import {
  markBrowserFirstContactSent,
  registerInboundMessage,
  reserveBrowserFirstContact,
  sendOfficialApiReply
} from "@/features/conversations/service";
import { assignVariant } from "@/features/experiments/service";
import {
  discoverLead,
  transitionPipeline
} from "@/features/leads/service";
import { InstagramApiClient } from "@/integrations/instagram/api";
import { persistWebhookMessages } from "@/integrations/instagram/webhook";
import { recoverStaleJobs } from "@/worker/queue";

process.env.INSTAGRAM_PAGE_ACCESS_TOKEN ??= "simulation-token";
process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ??= "simulation-account";
process.env.INSTAGRAM_GRAPH_API_VERSION ??= "v99.0";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error("E2E assertion failed: " + message);
  }
}

const business = {
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
    howItWorks: ["Entender", "Receber materiais", "Definir escopo"],
    revenueModel: "Serviço",
    marketJargon: [{ term: "visual", meaning: "material visual" }]
  },
  claims: {
    verified: [
      {
        id: "scope",
        text: "O escopo é confirmado antes do início.",
        source: "https://example.com/official"
      }
    ],
    unverified: [{ id: "guarantee", text: "Resultado garantido" }]
  },
  audiences: {
    icpSegments: ["segmento"],
    icpKeywords: ["palavra"],
    affiliateTopics: ["tópico"],
    geography: ["Brasil"]
  }
};

const client = createDatabase(":memory:");

try {
  const discovered = discoverLead(client.sqlite, {
    funnel: "client",
    instagramUsername: "e2e.profile",
    displayName: "Perfil E2E",
    source: "simulation",
    score: 90
  });
  const duplicate = discoverLead(client.sqlite, {
    funnel: "client",
    instagramUsername: "@E2E.Profile",
    source: "simulation"
  });
  assert(!duplicate.created, "lead deduplication");

  const qualified = transitionPipeline(
    client.sqlite,
    discovered.lead.id,
    "qualified",
    "simulation",
    "score"
  );
  client.sqlite
    .prepare(
      `INSERT INTO experiments (
        id, name, funnel, variable, status, minimum_sample_size
      ) VALUES ('e2e-experiment', 'E2E opening', 'client', 'question', 'running', 30)`
    )
    .run();
  client.sqlite
    .prepare(
      `INSERT INTO experiment_variants (
        id, experiment_id, name, is_control, allocation_percent, content_json
      ) VALUES
        ('e2e-control', 'e2e-experiment', 'Control', 1, 50, '{}'),
        ('e2e-variant', 'e2e-experiment', 'Variant', 0, 50, '{}')`
    )
    .run();
  const variantId = assignVariant(
    client.sqlite,
    "e2e-experiment",
    qualified.id
  );

  const browserMessage = reserveBrowserFirstContact(client.sqlite, {
    leadId: qualified.id,
    body: "Oi! Vi o perfil público. Posso fazer uma pergunta rápida?",
    idempotencyKey: "e2e-browser-message",
    variantId
  });
  markBrowserFirstContactSent(client.sqlite, browserMessage.message.id);

  const webhookPayload = {
    object: "instagram",
    entry: [
      {
        id: "business",
        messaging: [
          {
            sender: { id: "e2e-meta-user" },
            recipient: { id: "business" },
            timestamp: Date.now(),
            message: {
              mid: "e2e-inbound-message",
              text: "Quero entender melhor"
            }
          }
        ]
      }
    ]
  };
  const rawWebhook = JSON.stringify(webhookPayload);
  const firstWebhook = persistWebhookMessages(
    client.sqlite,
    rawWebhook,
    webhookPayload
  );
  const replayedWebhook = persistWebhookMessages(
    client.sqlite,
    rawWebhook,
    webhookPayload
  );
  assert(firstWebhook.accepted === 1, "webhook acceptance");
  assert(replayedWebhook.duplicates === 1, "webhook idempotency");

  const inbound = registerInboundMessage(client.sqlite, {
    externalEventId: "e2e-inbound-message",
    senderId: "e2e-meta-user",
    username: qualified.instagram_username,
    body: "Quero entender melhor",
    timestamp: new Date().toISOString()
  });
  assert(inbound.lead?.channel_state === "api_eligible", "API eligibility");

  let apiRequests = 0;
  const instagram = new InstagramApiClient(
    (async () => {
      apiRequests += 1;
      return new Response(
        JSON.stringify({
          recipient_id: "e2e-meta-user",
          message_id: "e2e-outbound-message"
        }),
        { status: 200 }
      );
    }) as typeof fetch
  );
  const decision = {
    intent: "asked_info" as const,
    action: "introduce" as const,
    reason: "Simulation classified the request.",
    verifiedClaimIds: ["scope"],
    askTopic: "none" as const
  };
  await sendOfficialApiReply(
    client.sqlite,
    instagram,
    business,
    qualified.id,
    decision,
    "e2e-api-reply"
  );
  await sendOfficialApiReply(
    client.sqlite,
    instagram,
    business,
    qualified.id,
    decision,
    "e2e-api-reply"
  );
  assert(apiRequests === 1, "cross-channel duplicate send lock");

  client.sqlite
    .prepare(
      `INSERT INTO jobs (
        id, kind, payload_json, status, attempts, max_attempts,
        available_at, locked_at, locked_by, idempotency_key
      ) VALUES (
        'e2e-stale-job', 'integration_health', '{}', 'running', 1, 3,
        CURRENT_TIMESTAMP, ?, 'crashed-worker', 'e2e-stale'
      )`
    )
    .run(new Date(Date.now() - 60 * 60_000).toISOString());
  assert(recoverStaleJobs(client.sqlite, 15) === 1, "restart recovery");

  const final = client.sqlite
    .prepare(
      `SELECT l.pipeline_state, l.channel_state, o.owner
       FROM leads l
       JOIN channel_ownership o ON o.lead_id = l.id
       WHERE l.id = ?`
    )
    .get(qualified.id) as {
      pipeline_state: string;
      channel_state: string;
      owner: string;
    };
  const evidence = {
    leadDeduplicated: !duplicate.created,
    browserFirstContact: "sent",
    webhookAccepted: firstWebhook.accepted,
    webhookReplayIgnored: replayedWebhook.duplicates,
    channelOwner: final.owner,
    channelState: final.channel_state,
    apiRequests,
    variantAssigned: variantId,
    staleJobsRecovered: 1,
    auditEvents: (
      client.sqlite
        .prepare("SELECT COUNT(*) AS count FROM events")
        .get() as { count: number }
    ).count
  };

  assert(final.owner === "api", "API ownership");
  assert(final.channel_state === "api_active", "API continuation");
  process.stdout.write(JSON.stringify(evidence, null, 2) + "\n");
} finally {
  client.close();
}
