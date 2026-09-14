import { afterEach, describe, expect, it } from "vitest";
import type { DatabaseClient } from "@/db/client";
import { getEnvironment } from "@/env";
import { FakeBrowserContactClient } from "@/integrations/browser/fake";
import { InstagramApiClient } from "@/integrations/instagram/api";
import { setSystemPaused } from "@/lib/system-control";
import { handleJob } from "@/worker/handlers";
import {
  claimNextJob,
  completeJob,
  enqueueJob
} from "@/worker/queue";
import {
  businessFixture,
  createQualifiedLead,
  testDatabase
} from "./helpers";

let client: DatabaseClient | undefined;

afterEach(() => {
  client?.close();
  client = undefined;
});

describe("browser first contact", () => {
  it("runs a simulated live send in an isolated structured client", async () => {
    client = testDatabase();
    const lead = createQualifiedLead(client.sqlite, "browser");
    const fakeBrowser = new FakeBrowserContactClient();
    setSystemPaused(client.sqlite, false, "test", "test");
    enqueueJob(client.sqlite, {
      kind: "browser_first_contact",
      payload: {
        leadId: lead.id,
        mode: "live",
        publicReference: "a publicação pública do projeto",
        operatorAuthorizedAt: new Date().toISOString()
      },
      idempotencyKey: "browser:test:live"
    });
    const job = claimNextJob(client.sqlite, "test-worker");

    expect(job).not.toBeNull();

    const outcome = await handleJob(job!, {
      database: client.sqlite,
      business: businessFixture,
      environment: getEnvironment(),
      browser: fakeBrowser,
      instagramApi: new InstagramApiClient(),
      conversationEngine: null
    });
    completeJob(client.sqlite, job!.id);

    expect(outcome).toBe("completed");
    expect(fakeBrowser.calls).toHaveLength(1);
    expect(fakeBrowser.calls[0]?.profileUrl).toContain("instagram.com");
    expect(
      client.sqlite
        .prepare("SELECT pipeline_state, channel_state FROM leads WHERE id = ?")
        .get(lead.id)
    ).toMatchObject({
      pipeline_state: "contacted",
      channel_state: "waiting_inbound_reply"
    });
    expect(
      client.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM jobs WHERE kind = 'browser_follow_up'"
        )
        .get()
    ).toMatchObject({ count: 1 });
  });

  it("blocks the final action in dry-run mode", async () => {
    client = testDatabase();
    const lead = createQualifiedLead(client.sqlite, "dry-run");
    const fakeBrowser = new FakeBrowserContactClient();
    const job = enqueueJob(client.sqlite, {
      kind: "browser_first_contact",
      payload: {
        leadId: lead.id,
        mode: "dry_run",
        publicReference: null
      },
      idempotencyKey: "browser:test:dry"
    });
    client.sqlite
      .prepare(
        "UPDATE jobs SET status = 'running', attempts = 1 WHERE id = ?"
      )
      .run(job.id);
    const running = client.sqlite
      .prepare("SELECT * FROM jobs WHERE id = ?")
      .get(job.id);

    const outcome = await handleJob(running as typeof job, {
      database: client.sqlite,
      business: businessFixture,
      environment: getEnvironment(),
      browser: fakeBrowser,
      instagramApi: new InstagramApiClient(),
      conversationEngine: null
    });

    expect(outcome).toBe("completed");
    expect(
      client.sqlite.prepare("SELECT COUNT(*) AS count FROM messages").get()
    ).toMatchObject({ count: 0 });
    expect(
      client.sqlite
        .prepare("SELECT status FROM browser_runs WHERE job_id = ?")
        .get(job.id)
    ).toMatchObject({ status: "blocked" });
  });
});
