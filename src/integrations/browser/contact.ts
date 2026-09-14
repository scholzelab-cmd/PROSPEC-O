import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { getEnvironment } from "@/env";
import { Mutex } from "@/lib/mutex";

export type BrowserContactMode = "dry_run" | "live";

export interface BrowserContactInput {
  jobId: string;
  leadId: string;
  profileUrl: string;
  message: string;
  mode: BrowserContactMode;
  operatorAuthorizedAt?: string;
}

export interface BrowserContactResult {
  sent: boolean;
  mode: BrowserContactMode | "fake";
  finalUrl: string;
  accessibilitySnapshot: string;
  diagnosticsDirectory?: string;
}

export class BrowserUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserUnavailableError";
  }
}

export class InstagramRestrictionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstagramRestrictionError";
  }
}

function assertInstagramUrl(value: string): URL {
  const url = new URL(value);

  if (
    url.protocol !== "https:" ||
    !["instagram.com", "www.instagram.com"].includes(url.hostname)
  ) {
    throw new Error("Browser navigation outside Instagram is blocked.");
  }

  return url;
}

function randomInteger(minimum: number, maximum: number): number {
  return minimum + Math.floor(Math.random() * (maximum - minimum + 1));
}

async function detectRestriction(page: Page): Promise<void> {
  const body = (await page.locator("body").innerText()).toLowerCase();
  const restrictionPattern =
    /try again later|tente novamente mais tarde|we restrict certain activity|restringimos determinadas atividades|account suspended|conta suspensa/;

  if (restrictionPattern.test(body)) {
    throw new InstagramRestrictionError(
      "Instagram displayed an account restriction or rate warning."
    );
  }
}

async function diagnostics(
  page: Page,
  input: BrowserContactInput,
  consoleErrors: string[],
  networkErrors: string[]
): Promise<string> {
  const directory = resolve(process.cwd(), "screenshots", input.jobId);
  await mkdir(directory, { recursive: true });

  let snapshot = "";

  try {
    snapshot = await page.locator("body").ariaSnapshot();
  } catch (error) {
    snapshot =
      "Accessibility snapshot failed: " +
      (error instanceof Error ? error.message : String(error));
  }

  await Promise.all([
    page.screenshot({
      path: resolve(directory, "failure.png"),
      fullPage: true
    }),
    writeFile(resolve(directory, "accessibility.yml"), snapshot, "utf8"),
    writeFile(
      resolve(directory, "diagnostics.json"),
      JSON.stringify(
        {
          jobId: input.jobId,
          leadId: input.leadId,
          url: page.url(),
          consoleErrors,
          networkErrors,
          capturedAt: new Date().toISOString()
        },
        null,
        2
      ),
      "utf8"
    )
  ]);

  return directory;
}

const browserMutex = new Mutex();

export class BrowserContactClient {
  async sendFirstContact(
    input: BrowserContactInput
  ): Promise<BrowserContactResult> {
    return browserMutex.runExclusive(() => this.execute(input));
  }

  private async execute(
    input: BrowserContactInput
  ): Promise<BrowserContactResult> {
    const environment = getEnvironment();
    const target = assertInstagramUrl(input.profileUrl);

    if (
      input.mode === "live" &&
      (!environment.BROWSER_SEND_ENABLED || !input.operatorAuthorizedAt)
    ) {
      throw new Error(
        "Live browser send requires BROWSER_SEND_ENABLED=true and recorded operator authorization."
      );
    }

    let page: Page | undefined;
    const consoleErrors: string[] = [];
    const networkErrors: string[] = [];

    try {
      let browser;

      try {
        browser = await chromium.connectOverCDP(environment.CHROME_CDP_URL);
      } catch (error) {
        throw new BrowserUnavailableError(
          error instanceof Error ? error.message : String(error)
        );
      }

      const context = browser.contexts()[0];

      if (!context) {
        throw new BrowserUnavailableError(
          "Connected Chrome has no reusable logged-in context."
        );
      }

      page = await context.newPage();
      page.on("console", (message) => {
        if (message.type() === "error") {
          consoleErrors.push(message.text().slice(0, 1000));
        }
      });
      page.on("requestfailed", (request) => {
        networkErrors.push(
          `${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`.slice(
            0,
            1500
          )
        );
      });

      await page.goto(target.toString(), {
        waitUntil: "domcontentloaded",
        timeout: 30_000
      });
      assertInstagramUrl(page.url());
      await detectRestriction(page);

      const messageButton = page
        .getByRole("button", { name: /^(message|mensagem)$/i })
        .first();
      await messageButton.waitFor({ state: "visible", timeout: 15_000 });
      await messageButton.click();

      const namedTextbox = page.getByRole("textbox", {
        name: /(message|mensagem)/i
      });
      const textbox =
        (await namedTextbox.count()) > 0
          ? namedTextbox.last()
          : page.getByRole("textbox").last();

      await textbox.waitFor({ state: "visible", timeout: 15_000 });
      await textbox.click();
      await textbox.pressSequentially(input.message, {
        delay: randomInteger(45, 95)
      });
      await page.waitForTimeout(randomInteger(900, 1800));
      await detectRestriction(page);

      const accessibilitySnapshot = await page.locator("body").ariaSnapshot();

      if (input.mode === "dry_run") {
        return {
          sent: false,
          mode: input.mode,
          finalUrl: page.url(),
          accessibilitySnapshot
        };
      }

      await textbox.press("Enter");
      await page.waitForTimeout(randomInteger(800, 1400));
      await detectRestriction(page);

      return {
        sent: true,
        mode: input.mode,
        finalUrl: page.url(),
        accessibilitySnapshot
      };
    } catch (error) {
      if (page) {
        try {
          const directory = await diagnostics(
            page,
            input,
            consoleErrors,
            networkErrors
          );

          if (error instanceof Error) {
            Object.assign(error, { diagnosticsDirectory: directory });
          }
        } catch {
          // Preserve the original browser failure when diagnostics also fail.
        }
      }

      throw error;
    } finally {
      await page?.close().catch(() => undefined);
    }
  }
}
