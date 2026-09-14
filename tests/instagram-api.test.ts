import { afterEach, describe, expect, it } from "vitest";
import { InstagramApiClient } from "@/integrations/instagram/api";

afterEach(() => {
  delete process.env.INSTAGRAM_PAGE_ACCESS_TOKEN;
  process.env.INSTAGRAM_PAGE_ACCESS_TOKEN = "test-page-token";
});

describe("Instagram API client", () => {
  it("keeps the page token out of URLs", async () => {
    let capturedUrl = "";
    let capturedHeaders: Headers | undefined;

    const request: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      return new Response(
        JSON.stringify({ id: "profile-id", username: "profile" }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    const client = new InstagramApiClient(request);
    await client.getProfile("profile-id");

    expect(capturedUrl).not.toContain("access_token");
    expect(capturedHeaders?.get("authorization")).toBe(
      "Bearer test-page-token"
    );
  });
});
