import "dotenv/config";
import { createDatabase } from "@/db/client";
import {
  discoverLead,
  transitionPipeline
} from "@/features/leads/service";
import { logger } from "@/lib/logger";

const client = createDatabase();

try {
  const examples = [
    {
      funnel: "client" as const,
      username: "example.client",
      displayName: "Cliente de demonstração"
    },
    {
      funnel: "affiliate" as const,
      username: "example.creator",
      displayName: "Afiliado de demonstração"
    }
  ];

  for (const example of examples) {
    const result = discoverLead(client.sqlite, {
      funnel: example.funnel,
      instagramUsername: example.username,
      displayName: example.displayName,
      source: "demo_seed",
      score: 75
    });

    if (result.created) {
      transitionPipeline(
        client.sqlite,
        result.lead.id,
        "qualified",
        "seed",
        "demo"
      );
    }
  }

  logger.info("demo_seed_completed", { count: examples.length });
} finally {
  client.close();
}
