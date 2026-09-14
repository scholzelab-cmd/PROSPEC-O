import "dotenv/config";
import { loadBusinessConfig } from "@/config/business";
import { createDatabase } from "@/db/client";
import { getEnvironment } from "@/env";
import { BrowserContactClient } from "@/integrations/browser/contact";
import { InstagramApiClient } from "@/integrations/instagram/api";
import { createConversationEngine } from "@/integrations/openai/client";
import { newId } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { getSystemStatus, setSystemPaused } from "@/lib/system-control";
import { handleJob, type HandlerDependencies } from "@/worker/handlers";
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  failJob,
  recoverStaleJobs
} from "@/worker/queue";

const environment = getEnvironment();
const client = createDatabase();
const workerId = newId("worker");
const browser = new BrowserContactClient();
const instagramApi = new InstagramApiClient();
let stopping = false;
let configurationWarningLogged = false;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function dependencies(): HandlerDependencies | null {
  const loaded = loadBusinessConfig();

  if (!loaded.ready || !loaded.config) {
    if (!configurationWarningLogged) {
      logger.warn("business_configuration_not_ready", {
        errors: loaded.errors,
        warnings: loaded.warnings
      });
      configurationWarningLogged = true;
    }

    const status = getSystemStatus(client.sqlite);

    if (!status.paused || status.reason !== "business_configuration_not_ready") {
      setSystemPaused(
        client.sqlite,
        true,
        "business_configuration_not_ready",
        "worker"
      );
    }

    return null;
  }

  configurationWarningLogged = false;
  let conversationEngine = null;

  if (
    environment.OPENAI_API_KEY &&
    environment.OPENAI_MODEL &&
    environment.OPENAI_MODEL_FAST
  ) {
    conversationEngine = createConversationEngine(client.sqlite, loaded.config);
  }

  return {
    database: client.sqlite,
    business: loaded.config,
    environment,
    browser,
    instagramApi,
    conversationEngine
  };
}

async function run(): Promise<void> {
  const recovered = recoverStaleJobs(
    client.sqlite,
    environment.STALE_JOB_MINUTES
  );
  enqueueJob(client.sqlite, {
    kind: "integration_health",
    payload: {},
    idempotencyKey: `integration_health:${new Date().toISOString().slice(0, 10)}`
  });
  enqueueJob(client.sqlite, {
    kind: "backup",
    payload: {},
    idempotencyKey: "backup:" + new Date().toISOString().slice(0, 10)
  });

  logger.info("worker_started", { workerId, recovered });

  while (!stopping) {
    const currentDependencies = dependencies();

    if (!currentDependencies) {
      await wait(environment.WORKER_POLL_INTERVAL_MS);
      continue;
    }

    const job = claimNextJob(client.sqlite, workerId);

    if (!job) {
      await wait(environment.WORKER_POLL_INTERVAL_MS);
      continue;
    }

    try {
      const outcome = await handleJob(job, currentDependencies);

      if (outcome === "completed") {
        completeJob(client.sqlite, job.id);
      }

      logger.info("job_processed", {
        jobId: job.id,
        kind: job.kind,
        outcome
      });
    } catch (error) {
      const status = failJob(client.sqlite, job, error);
      logger.error("job_failed", {
        jobId: job.id,
        kind: job.kind,
        status,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

function stop(signal: string): void {
  stopping = true;
  logger.info("worker_stopping", { workerId, signal });
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

run()
  .catch((error: unknown) => {
    logger.error("worker_crashed", {
      error: error instanceof Error ? error.message : String(error)
    });
    process.exitCode = 1;
  })
  .finally(() => {
    client.close();
  });
