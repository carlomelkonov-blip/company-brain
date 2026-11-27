import { z } from "zod";

const schema = z.object({
  CONTROL_DATABASE_URL: z.string().url(),
  TENANT_DATABASE_URL_TEMPLATE: z.string().includes("{db}"),
  DEFAULT_TENANT: z.string().optional().default(""),
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 characters"),
  ALLOW_DEV_LOGIN: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v === "true"),
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  ANTHROPIC_MODEL: z.string().optional().default("claude-sonnet-5-5"),
  API_PORT: z.coerce.number().int().positive().default(8787),
});

export type Config = z.infer<typeof schema>;

let cached: Config | undefined;

export function config(): Config {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
      throw new Error(`Invalid configuration. Copy .env.example to .env and fix:\n  ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** For tests: override configuration values. */
export function setConfigForTests(overrides: Partial<Record<keyof Config, string>>): void {
  Object.assign(process.env, overrides);
  cached = undefined;
}
