import { afterEach, describe, expect, it } from "vitest";
import type { DatabaseClient } from "@/db/client";
import {
  adaptExperimentAllocation,
  assignVariant,
  evaluateExperiment
} from "@/features/experiments/service";
import { newId } from "@/lib/ids";
import { discoverLead } from "@/features/leads/service";
import { testDatabase } from "./helpers";

let client: DatabaseClient | undefined;

afterEach(() => {
  client?.close();
  client = undefined;
});

describe("controlled experiments", () => {
  it("assigns a lead deterministically and only once", () => {
    client = testDatabase();
    const database = client.sqlite;
    database
      .prepare(
        `INSERT INTO experiments (
          id, name, funnel, variable, status, minimum_sample_size
        ) VALUES ('experiment-one', 'Opening', 'client', 'cta', 'running', 5)`
      )
      .run();
    database
      .prepare(
        `INSERT INTO experiment_variants (
          id, experiment_id, name, is_control, allocation_percent, content_json
        ) VALUES
          ('control', 'experiment-one', 'Control', 1, 50, '{}'),
          ('variant', 'experiment-one', 'Variant', 0, 50, '{}')`
      )
      .run();
    const lead = discoverLead(database, {
      funnel: "client",
      instagramUsername: "experiment.once",
      source: "test"
    }).lead;

    const first = assignVariant(database, "experiment-one", lead.id);
    const second = assignVariant(database, "experiment-one", lead.id);

    expect(second).toBe(first);
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM experiment_assignments WHERE lead_id = ?"
        )
        .get(lead.id)
    ).toMatchObject({ count: 1 });
  });

  it("does not choose early and keeps exploration after a clear winner", () => {
    client = testDatabase();
    const database = client.sqlite;
    database
      .prepare(
        `INSERT INTO experiments (
          id, name, funnel, variable, status, minimum_sample_size
        ) VALUES ('experiment-two', 'Question', 'client', 'question', 'running', 10)`
      )
      .run();
    database
      .prepare(
        `INSERT INTO experiment_variants (
          id, experiment_id, name, is_control, allocation_percent, content_json
        ) VALUES
          ('control-two', 'experiment-two', 'Control', 1, 50, '{}'),
          ('winner-two', 'experiment-two', 'Variant', 0, 50, '{}')`
      )
      .run();

    expect(evaluateExperiment(database, "experiment-two")).toMatchObject({
      ready: false,
      winnerVariantId: null
    });

    for (let index = 0; index < 20; index += 1) {
      const lead = discoverLead(database, {
        funnel: "client",
        instagramUsername: "sample." + index,
        source: "test"
      }).lead;
      const winner = index >= 10;
      database
        .prepare(
          `INSERT INTO experiment_assignments (
            id, experiment_id, variant_id, lead_id, outcome, converted_at
          ) VALUES (?, 'experiment-two', ?, ?, ?, ?)`
        )
        .run(
          newId("assignment"),
          winner ? "winner-two" : "control-two",
          lead.id,
          winner ? "reply" : null,
          winner ? new Date().toISOString() : null
        );
    }

    const evaluation = adaptExperimentAllocation(database, "experiment-two", 20);
    expect(evaluation.ready).toBe(true);
    expect(evaluation.winnerVariantId).toBe("winner-two");
    expect(
      database
        .prepare(
          "SELECT allocation_percent FROM experiment_variants WHERE id = 'winner-two'"
        )
        .get()
    ).toMatchObject({ allocation_percent: 80 });
    expect(
      database
        .prepare(
          "SELECT allocation_percent FROM experiment_variants WHERE id = 'control-two'"
        )
        .get()
    ).toMatchObject({ allocation_percent: 20 });
  });
});
