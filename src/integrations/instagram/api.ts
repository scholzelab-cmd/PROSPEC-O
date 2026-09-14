import { z } from "zod";
import { getEnvironment } from "@/env";

const profileSchema = z.object({
  id: z.string(),
  username: z.string().optional(),
  name: z.string().optional()
});

const sendResponseSchema = z.object({
  recipient_id: z.string().optional(),
  message_id: z.string()
});

export type InstagramProfile = z.infer<typeof profileSchema>;

export class InstagramApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseBody: string
  ) {
    super(message);
    this.name = "InstagramApiError";
  }
}

export class InstagramApiClient {
  constructor(private readonly request: typeof fetch = fetch) {}

  private credentials(): {
    token: string;
    accountId: string;
    version: string;
  } {
    const environment = getEnvironment();

    if (
      !environment.INSTAGRAM_PAGE_ACCESS_TOKEN ||
      !environment.INSTAGRAM_BUSINESS_ACCOUNT_ID ||
      !environment.INSTAGRAM_GRAPH_API_VERSION
    ) {
      throw new Error("Instagram API credentials are incomplete.");
    }

    return {
      token: environment.INSTAGRAM_PAGE_ACCESS_TOKEN,
      accountId: environment.INSTAGRAM_BUSINESS_ACCOUNT_ID,
      version: environment.INSTAGRAM_GRAPH_API_VERSION
    };
  }

  async getProfile(userId: string): Promise<InstagramProfile> {
    const { token, version } = this.credentials();
    const url = new URL(
      `https://graph.facebook.com/${version}/${encodeURIComponent(userId)}`
    );
    url.searchParams.set("fields", "id,username,name");
    url.searchParams.set("access_token", token);

    const response = await this.request(url, { method: "GET" });
    const body = await response.text();

    if (!response.ok) {
      throw new InstagramApiError(
        "Instagram profile lookup failed.",
        response.status,
        body.slice(0, 1000)
      );
    }

    return profileSchema.parse(JSON.parse(body) as unknown);
  }

  async sendText(
    recipientId: string,
    message: string
  ): Promise<{ messageId: string }> {
    const { token, accountId, version } = this.credentials();
    const url = new URL(
      `https://graph.facebook.com/${version}/${encodeURIComponent(accountId)}/messages`
    );
    url.searchParams.set("access_token", token);

    const response = await this.request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: message }
      })
    });
    const body = await response.text();

    if (!response.ok) {
      throw new InstagramApiError(
        "Instagram message send failed.",
        response.status,
        body.slice(0, 1000)
      );
    }

    const parsed = sendResponseSchema.parse(JSON.parse(body) as unknown);
    return { messageId: parsed.message_id };
  }
}
