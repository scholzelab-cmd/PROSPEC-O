import { z } from "zod";

const optionalText = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional()
);

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional()
);

const booleanText = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    OPENAI_API_KEY: optionalText,
    OPENAI_MODEL: optionalText,
    OPENAI_MODEL_FAST: optionalText,
    OPENAI_MONTHLY_BUDGET_USD: z.coerce.number().positive().default(25),
    AI_PRICE_INPUT_PER_MILLION_USD: z.coerce.number().nonnegative().optional(),
    AI_PRICE_OUTPUT_PER_MILLION_USD: z.coerce.number().nonnegative().optional(),
    CHROME_CDP_URL: optionalUrl.default("http://127.0.0.1:9222"),
    CHROME_PROFILE_DIR: z.string().min(1).default(".chrome-profile"),
    BROWSER_SEND_ENABLED: booleanText,
    INSTAGRAM_APP_SECRET: optionalText,
    INSTAGRAM_PAGE_ACCESS_TOKEN: optionalText,
    INSTAGRAM_WEBHOOK_VERIFY_TOKEN: optionalText,
    INSTAGRAM_BUSINESS_ACCOUNT_ID: optionalText,
    INSTAGRAM_GRAPH_API_VERSION: optionalText,
    DATABASE_URL: z.string().min(1).default("file:./data/prospecto.db"),
    MAX_DMS_PER_DAY: z.coerce.number().int().positive().max(100).default(30),
    MIN_SECONDS_BETWEEN_DMS: z.coerce.number().int().positive().default(90),
    MAX_SECONDS_BETWEEN_DMS: z.coerce.number().int().positive().default(240),
    OPERATING_HOURS: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/)
      .default("09:00-20:00"),
    OPERATING_TIMEZONE: z.string().min(1).default("America/Sao_Paulo"),
    APP_BASE_URL: z.string().url().default("http://localhost:3000"),
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).default(2000),
    STALE_JOB_MINUTES: z.coerce.number().int().min(1).default(15)
  })
  .superRefine((value, context) => {
    if (value.MIN_SECONDS_BETWEEN_DMS > value.MAX_SECONDS_BETWEEN_DMS) {
      context.addIssue({
        code: "custom",
        path: ["MAX_SECONDS_BETWEEN_DMS"],
        message: "Must be greater than or equal to MIN_SECONDS_BETWEEN_DMS."
      });
    }
  });

export type RuntimeEnvironment = z.infer<typeof environmentSchema>;

let cachedEnvironment: RuntimeEnvironment | undefined;

export function getEnvironment(
  source: NodeJS.ProcessEnv = process.env
): RuntimeEnvironment {
  if (source === process.env && cachedEnvironment) {
    return cachedEnvironment;
  }

  const parsed = environmentSchema.parse(source);

  if (source === process.env) {
    cachedEnvironment = parsed;
  }

  return parsed;
}

export function validateIntegrationEnvironment(
  integration: "openai" | "instagram_api" | "instagram_webhook"
): string[] {
  const environment = getEnvironment();
  const required: Record<typeof integration, Array<keyof RuntimeEnvironment>> = {
    openai: ["OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_MODEL_FAST"],
    instagram_api: [
      "INSTAGRAM_PAGE_ACCESS_TOKEN",
      "INSTAGRAM_BUSINESS_ACCOUNT_ID",
      "INSTAGRAM_GRAPH_API_VERSION"
    ],
    instagram_webhook: [
      "INSTAGRAM_APP_SECRET",
      "INSTAGRAM_WEBHOOK_VERIFY_TOKEN"
    ]
  };

  return required[integration].filter((key) => !environment[key]).map(String);
}
