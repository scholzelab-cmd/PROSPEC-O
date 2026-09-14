import { describe, expect, it } from "vitest";
import {
  assertNoBlockedClaim,
  buildFirstContact,
  detectImmediateOptOut,
  OutboundPolicyError,
  renderDecision
} from "@/features/conversations/policy";
import { businessFixture } from "./helpers";

describe("outbound safety policy", () => {
  it("detects explicit removal requests before an AI call", () => {
    expect(detectImmediateOptOut("Por favor, não me chame novamente")).toBe(true);
    expect(detectImmediateOptOut("Pode me explicar melhor?")).toBe(false);
  });

  it("blocks configured unverified claims", () => {
    expect(() =>
      assertNoBlockedClaim(
        businessFixture,
        "Nós temos resultado garantido em sete dias."
      )
    ).toThrow(OutboundPolicyError);
  });

  it("builds a truthful contextual first contact", () => {
    const message = buildFirstContact(businessFixture, {
      funnel: "client",
      displayName: "Ana Exemplo",
      publicReference: "o projeto residencial publicado ontem"
    });

    expect(message).toContain("Ana");
    expect(message).toContain("projeto residencial publicado ontem");
    expect(message).not.toContain("Resultado garantido");
  });

  it("renders only claims selected from the verified list", () => {
    const rendered = renderDecision(businessFixture, "client", {
      intent: "asked_info",
      action: "introduce",
      reason: "asked",
      verifiedClaimIds: ["service_scope"],
      askTopic: "none"
    });

    expect(rendered.message).toContain(
      "O escopo é definido antes do início."
    );
    expect(() =>
      renderDecision(businessFixture, "client", {
        intent: "asked_info",
        action: "introduce",
        reason: "asked",
        verifiedClaimIds: ["unknown_claim"],
        askTopic: "none"
      })
    ).toThrow(OutboundPolicyError);
  });
});
