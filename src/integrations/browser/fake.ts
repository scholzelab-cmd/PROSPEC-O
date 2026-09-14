import type {
  BrowserContactInput,
  BrowserContactResult
} from "@/integrations/browser/contact";

export class FakeBrowserContactClient {
  readonly calls: BrowserContactInput[] = [];

  constructor(private readonly shouldFail = false) {}

  async sendFirstContact(
    input: BrowserContactInput
  ): Promise<BrowserContactResult> {
    this.calls.push(input);

    if (this.shouldFail) {
      throw new Error("Simulated browser failure.");
    }

    return {
      sent: input.mode === "live",
      mode: "fake",
      finalUrl: input.profileUrl,
      accessibilitySnapshot:
        "- document\n  - button \"Mensagem\"\n  - textbox \"Mensagem\""
    };
  }
}
