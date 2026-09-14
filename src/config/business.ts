import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const claimSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  source: z.string().url().optional()
});

const businessConfigSchema = z.object({
  owner: z.object({
    name: z.string().min(1),
    role: z.string().min(1)
  }),
  company: z.object({
    name: z.string().min(1),
    website: z.string().url(),
    instagramHandle: z.string().regex(/^@[A-Za-z0-9._]+$/)
  }),
  links: z.object({
    whatsapp: z.string().url(),
    affiliateGroup: z.string().url().or(z.literal(""))
  }),
  offer: z.object({
    oneLinePitch: z.string().min(1),
    howItWorks: z.array(z.string().min(1)).min(1),
    revenueModel: z.string().min(1),
    marketJargon: z.array(
      z.object({
        term: z.string().min(1),
        meaning: z.string().min(1)
      })
    )
  }),
  claims: z.object({
    verified: z.array(claimSchema),
    unverified: z.array(claimSchema.omit({ source: true }))
  }),
  audiences: z.object({
    icpSegments: z.array(z.string().min(1)).min(1),
    icpKeywords: z.array(z.string().min(1)).min(1),
    affiliateTopics: z.array(z.string().min(1)).min(1),
    geography: z.array(z.string().min(1)).min(1)
  })
});

export type BusinessConfig = z.infer<typeof businessConfigSchema>;

export interface BusinessConfigResult {
  config: BusinessConfig | null;
  ready: boolean;
  errors: string[];
  warnings: string[];
}

function containsPlaceholder(value: unknown): boolean {
  if (typeof value === "string") {
    return value.includes("{{") || value.includes("}}");
  }

  if (Array.isArray(value)) {
    return value.some(containsPlaceholder);
  }

  if (value && typeof value === "object") {
    return Object.values(value).some(containsPlaceholder);
  }

  return false;
}

export function loadBusinessConfig(
  filePath = resolve(process.cwd(), "config/business.json")
): BusinessConfigResult {
  let raw: unknown;

  try {
    raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown configuration error.";

    return {
      config: null,
      ready: false,
      errors: ["config/business.json is missing or unreadable: " + message],
      warnings: []
    };
  }

  const parsed = businessConfigSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      config: null,
      ready: false,
      errors: parsed.error.issues.map(
        (issue) => issue.path.join(".") + ": " + issue.message
      ),
      warnings: []
    };
  }

  const errors = containsPlaceholder(parsed.data)
    ? ["Business configuration still contains placeholders."]
    : [];
  const warnings: string[] = [];

  if (parsed.data.claims.verified.length === 0) {
    warnings.push(
      "No verified commercial claims are configured. Promotional statements remain blocked."
    );
  }

  if (!parsed.data.links.affiliateGroup) {
    warnings.push(
      "Affiliate group link is missing. Affiliate handoff remains blocked."
    );
  }

  return {
    config: parsed.data,
    ready: errors.length === 0,
    errors,
    warnings
  };
}

export function requireBusinessConfig(): BusinessConfig {
  const result = loadBusinessConfig();

  if (!result.ready || !result.config) {
    throw new Error(result.errors.join(" "));
  }

  return result.config;
}
