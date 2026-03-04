import "dotenv/config";
import { z } from "zod";

const optionalText = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}, z.string().optional());

const optionalUrl = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}, z.string().url().optional());

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return value;
}, z.boolean());

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  API_BASE_PATH: z.string().default("/api"),
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default(
      [
        "https://wiseplan.dk",
        "https://www.wiseplan.dk",
        "https://admin.wiseplan.dk",
        "http://localhost:8081",
        "http://127.0.0.1:8081",
        "http://localhost:8088",
        "http://127.0.0.1:8088",
        "http://localhost:8090",
        "http://127.0.0.1:8090"
      ].join(",")
    ),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_BILLING_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_WEBHOOK_MAX: z.coerce.number().int().positive().default(300),
  DATABASE_URL: z.string().min(1),
  AUTH_MODE: z.enum(["azure", "dev", "magic"]).default("dev"),
  DEV_AUTH_AAD_OID: z.string().default("dev-local-user"),
  DEV_AUTH_TENANT_ID: z.string().default("dev-local-tenant"),
  AZURE_TENANT_ID: optionalText,
  AZURE_AUDIENCE: optionalText,
  AZURE_ISSUER: optionalUrl,
  AZURE_JWKS_URI: optionalUrl,
  MAGIC_LINK_JWT_SECRET: optionalText,
  MAGIC_LINK_TOKEN_ISSUER: z.string().default("wiseplan-auth"),
  MAGIC_LINK_TOKEN_AUDIENCE: z.string().default("wiseplan-app"),
  // Allow long-lived web sessions (up to 90 days) for magic-link auth.
  MAGIC_LINK_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().max(90 * 24 * 60).default(30),
  MAGIC_LINK_WEB_URL: z.string().url().default("https://wiseplan.dk/app/"),
  MAGIC_LINK_FROM_NAME: z.string().default("WisePlan"),
  MAGIC_LINK_FROM_EMAIL: z.string().email().default("hello@wiseplan.dk"),
  MAGIC_LINK_REPLY_TO: optionalText,
  MAGIC_LINK_SMTP_HOST: optionalText,
  MAGIC_LINK_SMTP_PORT: z.coerce.number().int().positive().default(465),
  MAGIC_LINK_SMTP_SECURE: booleanFromEnv.default(true),
  MAGIC_LINK_SMTP_USER: optionalText,
  MAGIC_LINK_SMTP_PASS: optionalText,
  GEOCODE_CACHE_TTL_DAYS: z.coerce.number().int().positive().default(90),
  ROUTE_CACHE_TTL_DAYS: z.coerce.number().int().positive().default(30),
  GEOCODE_USER_AGENT: z.string().default("WisePlanBackend/1.0"),
  OSRM_BASE_URL: z.string().url().default("https://router.project-osrm.org"),
  GOOGLE_MAPS_API_KEY: optionalText,
  GOOGLE_GEOCODING_API_KEY: optionalText,
  TRAFFIC_PROVIDER: z.enum(["osrm", "google"]).default("osrm"),
  BILLING_UPGRADE_URL: z.string().url().default("https://www.wiseplan.dk/billing"),
  BILLING_PROVIDER: z.enum(["mock", "stripe"]).default("mock"),
  BILLING_DEFAULT_CURRENCY: z.string().trim().toLowerCase().default("usd"),
  BILLING_FRONTEND_BASE_URL: z.string().url().default("https://www.wiseplan.dk"),
  BILLING_SUCCESS_PATH: z.string().default("/billing/success"),
  BILLING_CANCEL_PATH: z.string().default("/billing/cancel"),
  BILLING_PORTAL_RETURN_PATH: z.string().default("/account/billing"),
  STRIPE_API_BASE_URL: z.string().url().default("https://api.stripe.com/v1"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional()
});

export const env = EnvSchema.parse(process.env);
export const corsAllowedOrigins = env.CORS_ALLOWED_ORIGINS
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

if (env.AUTH_MODE === "azure") {
  const missing = [
    ["AZURE_TENANT_ID", env.AZURE_TENANT_ID],
    ["AZURE_AUDIENCE", env.AZURE_AUDIENCE]
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new Error(
      `Missing required Azure auth env vars: ${missing.map(([key]) => key).join(", ")}`
    );
  }
}

if (env.AUTH_MODE === "magic" && !env.MAGIC_LINK_JWT_SECRET) {
  throw new Error("Missing required auth env var: MAGIC_LINK_JWT_SECRET (AUTH_MODE=magic)");
}

const smtpConfiguredPartially =
  Boolean(env.MAGIC_LINK_SMTP_HOST) ||
  Boolean(env.MAGIC_LINK_SMTP_USER) ||
  Boolean(env.MAGIC_LINK_SMTP_PASS);

if (smtpConfiguredPartially) {
  const missingSmtp = [
    ["MAGIC_LINK_SMTP_HOST", env.MAGIC_LINK_SMTP_HOST],
    ["MAGIC_LINK_SMTP_USER", env.MAGIC_LINK_SMTP_USER],
    ["MAGIC_LINK_SMTP_PASS", env.MAGIC_LINK_SMTP_PASS]
  ].filter(([, value]) => !value);
  if (missingSmtp.length > 0) {
    throw new Error(
      `Missing required SMTP env vars: ${missingSmtp.map(([key]) => key).join(", ")}`
    );
  }
}

if (env.BILLING_PROVIDER === "stripe" && !env.STRIPE_SECRET_KEY) {
  throw new Error("Missing required billing env var: STRIPE_SECRET_KEY (BILLING_PROVIDER=stripe)");
}

export const azureIssuer =
  env.AZURE_ISSUER ?? `https://login.microsoftonline.com/${env.AZURE_TENANT_ID}/v2.0`;
export const azureJwksUri =
  env.AZURE_JWKS_URI ??
  `https://login.microsoftonline.com/${env.AZURE_TENANT_ID}/discovery/v2.0/keys`;
