import { afterEach, describe, expect, it } from "vitest";
import type { DatabaseClient } from "@/db/client";
import {
  DoNotContactError,
  discoverLead,
  markDoNotContact,
  transitionPipeline
} from "@/features/leads/service";
import { InvalidStateTransitionError } from "@/features/leads/domain";
import { testDatabase } from "./helpers";

let client: DatabaseClient | undefined;

afterEach(() => {
  client?.close();
  client = undefined;
});

describe("lead lifecycle", () => {
  it("deduplicates profiles by normalized Instagram username", () => {
    client = testDatabase();
    const first = discoverLead(client.sqlite, {
      funnel: "client",
      instagramUsername: "@Example.Profile",
      source: "test"
    });
    const second = discoverLead(client.sqlite, {
      funnel: "affiliate",
      instagramUsername: "example.profile",
      source: "another_source"
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.lead.id).toBe(first.lead.id);
    expect(
      client.sqlite.prepare("SELECT COUNT(*) AS count FROM leads").get()
    ).toMatchObject({ count: 1 });
  });

  it("enforces funnel transitions atomically", () => {
    client = testDatabase();
    const result = discoverLead(client.sqlite, {
      funnel: "client",
      instagramUsername: "transition.test",
      source: "test"
    });

    expect(() =>
      transitionPipeline(
        client!.sqlite,
        result.lead.id,
        "active_customer",
        "test",
        "invalid_skip"
      )
    ).toThrow(InvalidStateTransitionError);

    const qualified = transitionPipeline(
      client.sqlite,
      result.lead.id,
      "qualified",
      "test",
      "score"
    );
    expect(qualified.pipeline_state).toBe("qualified");
  });

  it("makes do-not-contact permanent across campaigns", () => {
    client = testDatabase();
    const result = discoverLead(client.sqlite, {
      funnel: "client",
      instagramUsername: "privacy.test",
      source: "test"
    });
    const blocked = markDoNotContact(
      client.sqlite,
      result.lead.id,
      "explicit_request",
      "test"
    );

    expect(blocked.channel_state).toBe("do_not_contact");
    expect(() =>
      discoverLead(client!.sqlite, {
        funnel: "affiliate",
        instagramUsername: "privacy.test",
        source: "new_campaign"
      })
    ).toThrow(DoNotContactError);
  });
});
