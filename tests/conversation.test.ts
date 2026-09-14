import { afterEach, describe, expect, it } from "vitest";
import type { DatabaseClient } from "@/db/client";
import {
  MessagingWindowClosedError,
  markBrowserFirstContactSent,
  registerInboundMessage,
  reserveBrowserFirstContact,
  sendOfficialApiReply
} from "@/features/conversations/service";
import { InstagramApiClient } from "@/integrations/instagram/api";
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

describe("channel handoff", () => {
  it("moves browser ownership to the API on the first inbound reply", () => {
    client = testDatabase();
    const lead = createQualifiedLead(client.sqlite, "handoff");
    const reservation = reserveBrowserFirstContact(client.sqlite, {
      leadId: lead.id,
      body: "Mensagem inicial segura",
      idempotencyKey: "browser:first"
    });

    markBrowserFirstContactSent(client.sqlite, reservation.message.id);
    const waiting = client.sqlite
      .prepare(
        `SELECT l.pipeline_state, l.channel_state, o.owner
         FROM leads l JOIN channel_ownership o ON o.lead_id = l.id
         WHERE l.id = ?`
      )
      .get(lead.id);
    expect(waiting).toMatchObject({
      pipeline_state: "contacted",
      channel_state: "waiting_inbound_reply",
      owner: "browser"
    });

    const inbound = registerInboundMessage(client.sqlite, {
      externalEventId: "mid-handoff-1",
      senderId: "meta-user-1",
      username: lead.instagram_username,
      body: "Quero entender melhor",
      timestamp: new Date().toISOString()
    });

    expect(inbound.duplicate).toBe(false);
    const handedOff = client.sqlite
      .prepare(
        `SELECT l.pipeline_state, l.channel_state, o.owner
         FROM leads l JOIN channel_ownership o ON o.lead_id = l.id
         WHERE l.id = ?`
      )
      .get(lead.id);
    expect(handedOff).toMatchObject({
      pipeline_state: "replied",
      channel_state: "api_eligible",
      owner: "api"
    });

    const duplicate = registerInboundMessage(client.sqlite, {
      externalEventId: "mid-handoff-1",
      senderId: "meta-user-1",
      username: lead.instagram_username,
      body: "Quero entender melhor",
      timestamp: new Date().toISOString()
    });
    expect(duplicate.duplicate).toBe(true);
    expect(
      client.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM messages WHERE external_message_id = ?"
        )
        .get("mid-handoff-1")
    ).toMatchObject({ count: 1 });
  });

  it("prevents duplicate official API sends", async () => {
    client = testDatabase();
    const lead = createQualifiedLead(client.sqlite, "api-send");
    const reservation = reserveBrowserFirstContact(client.sqlite, {
      leadId: lead.id,
      body: "Mensagem inicial segura",
      idempotencyKey: "browser:api-send"
    });
    markBrowserFirstContactSent(client.sqlite, reservation.message.id);
    registerInboundMessage(client.sqlite, {
      externalEventId: "mid-api-inbound",
      senderId: "meta-user-api",
      username: lead.instagram_username,
      body: "Pode explicar?",
      timestamp: new Date().toISOString()
    });

    let requestCount = 0;
    const request = (async () => {
      requestCount += 1;
      return new Response(
        JSON.stringify({
          recipient_id: "meta-user-api",
          message_id: "mid-api-outbound"
        }),
        { status: 200 }
      );
    }) as typeof fetch;
    const instagram = new InstagramApiClient(request);
    const decision = {
      intent: "asked_info" as const,
      action: "introduce" as const,
      reason: "requested information",
      verifiedClaimIds: ["service_scope"],
      askTopic: "none" as const
    };

    const first = await sendOfficialApiReply(
      client.sqlite,
      instagram,
      businessFixture,
      lead.id,
      decision,
      "reply:mid-api-inbound"
    );
    const second = await sendOfficialApiReply(
      client.sqlite,
      instagram,
      businessFixture,
      lead.id,
      decision,
      "reply:mid-api-inbound"
    );

    expect(first.sent).toBe(true);
    expect(second.sent).toBe(true);
    expect(requestCount).toBe(1);
    expect(
      client.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM messages WHERE idempotency_key = ?"
        )
        .get("reply:mid-api-inbound")
    ).toMatchObject({ count: 1 });
  });

  it("closes the API state when the messaging window has expired", async () => {
    client = testDatabase();
    const lead = createQualifiedLead(client.sqlite, "expired");
    const reservation = reserveBrowserFirstContact(client.sqlite, {
      leadId: lead.id,
      body: "Mensagem inicial segura",
      idempotencyKey: "browser:expired"
    });
    markBrowserFirstContactSent(client.sqlite, reservation.message.id);
    registerInboundMessage(client.sqlite, {
      externalEventId: "mid-expired-inbound",
      senderId: "meta-user-expired",
      username: lead.instagram_username,
      body: "Olá",
      timestamp: new Date(Date.now() - 48 * 60 * 60_000).toISOString()
    });

    const instagram = new InstagramApiClient(
      (async () =>
        new Response(JSON.stringify({ message_id: "never" }), {
          status: 200
        })) as typeof fetch
    );

    await expect(
      sendOfficialApiReply(
        client.sqlite,
        instagram,
        businessFixture,
        lead.id,
        {
          intent: "asked_info",
          action: "reply",
          reason: "test",
          verifiedClaimIds: [],
          askTopic: "none"
        },
        "reply:expired"
      )
    ).rejects.toBeInstanceOf(MessagingWindowClosedError);
    expect(
      client.sqlite
        .prepare("SELECT channel_state FROM leads WHERE id = ?")
        .get(lead.id)
    ).toMatchObject({ channel_state: "api_window_closed" });
  });

  it("applies opt-out immediately and transfers no future send", () => {
    client = testDatabase();
    const lead = createQualifiedLead(client.sqlite, "optout");
    const reservation = reserveBrowserFirstContact(client.sqlite, {
      leadId: lead.id,
      body: "Mensagem inicial segura",
      idempotencyKey: "browser:optout"
    });
    markBrowserFirstContactSent(client.sqlite, reservation.message.id);

    const inbound = registerInboundMessage(client.sqlite, {
      externalEventId: "mid-optout",
      senderId: "meta-user-optout",
      username: lead.instagram_username,
      body: "Por favor, não quero contato. Pare.",
      timestamp: new Date().toISOString()
    });

    expect(inbound.optedOut).toBe(true);
    expect(inbound.lead?.channel_state).toBe("do_not_contact");
    expect(
      client.sqlite
        .prepare("SELECT owner FROM channel_ownership WHERE lead_id = ?")
        .get(lead.id)
    ).toMatchObject({ owner: "none" });
  });
});
