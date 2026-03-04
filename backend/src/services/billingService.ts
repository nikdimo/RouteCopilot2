import crypto from "node:crypto";
import { env } from "../config/env.js";
import {
  BILLING_INTERVALS,
  ENTITLEMENT_KEYS,
  PLAN_CATALOG,
  PLAN_CODES,
  isBillingInterval,
  isPlanCode,
  isSubscriptionStatus,
  type BillingInterval,
  type EntitlementKey,
  type PlanCode,
  type SubscriptionStatus
} from "../config/billingCatalog.js";
import { pool, query } from "../db/pool.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let catalogSeedPromise: Promise<void> | null = null;

type UserContext = {
  userId: string;
  organizationId: string | null;
  email: string | null;
  displayName: string | null;
};

type SubscriptionRow = {
  id: string;
  organization_id: string | null;
  user_id: string | null;
  provider: string;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  provider_checkout_session_id: string | null;
  status: string;
  plan_code: string;
  billing_interval: string;
  currency: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  trial_start: string | null;
  trial_end: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type PromoRow = {
  id: string;
  code: string;
  discount_type: "percent_off" | "amount_off";
  percent_off: string | null;
  amount_off_cents: number | null;
  currency: string | null;
  redeem_by: string | null;
  max_redemptions: number | null;
  max_redemptions_per_org: number | null;
  exclude_trial: boolean;
  active: boolean;
  allowed_plan_codes: string[] | null;
  allowed_intervals: string[] | null;
  allowed_regions: string[] | null;
};

type PriceMapRow = {
  stripe_price_id: string;
  plan_code: string;
  billing_interval: string;
};

type PromoValidationInput = {
  code: string;
  planCode: PlanCode;
  billingInterval: BillingInterval;
  currency?: string;
  region?: string;
};

export type PromoValidationResult = {
  valid: boolean;
  reason?: string;
  promotion?: {
    code: string;
    discountType: "percent_off" | "amount_off";
    percentOff: number | null;
    amountOffCents: number | null;
    currency: string | null;
  };
  preview: {
    planCode: PlanCode;
    billingInterval: BillingInterval;
    currency: string;
    baseAmountCents: number;
    discountAmountCents: number;
    finalAmountCents: number;
    annualEffectiveMonthlyAmountCents: number | null;
    annualBilledAmountCents: number | null;
  };
};

export type BillingSnapshot = {
  customer: {
    userId: string;
    organizationId: string | null;
    email: string | null;
    displayName: string | null;
  };
  currentPlan: PlanCode;
  currentPlanSource: "free" | "subscription" | "override";
  subscription: {
    id: string;
    provider: string;
    status: SubscriptionStatus;
    planCode: PlanCode;
    billingInterval: BillingInterval;
    currency: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    canceledAt: string | null;
    trialStart: string | null;
    trialEnd: string | null;
    providerCheckoutSessionId: string | null;
    providerSubscriptionId: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  entitlements: Record<EntitlementKey, boolean | number>;
  limits: (typeof PLAN_CATALOG)[PlanCode]["limits"];
  trialDays: number;
  canManageBilling: boolean;
  renewalAt: string | null;
  accessEndsAt: string | null;
  statusBanner: SubscriptionStatus | "free";
};

export type CheckoutSessionInput = {
  planCode: PlanCode;
  billingInterval: BillingInterval;
  currency?: string;
  promoCode?: string;
  idempotencyKey: string;
  source?: string;
  feature?: string;
};

export type CheckoutSessionResult = {
  provider: "mock" | "stripe";
  checkoutUrl: string;
  checkoutSessionId: string;
  planCode: PlanCode;
  billingInterval: BillingInterval;
  currency: string;
  promoCode: string | null;
  amountCents: number;
};

export type PortalSessionResult = {
  provider: "mock" | "stripe";
  portalUrl: string;
};

export type BillingInvoice = {
  id: string;
  status: string;
  amountDueCents: number;
  amountPaidCents: number;
  currency: string;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  dueAt: string | null;
  createdAt: string;
};

export type PublicPlansResponse = {
  currency: string;
  billingIntervals: readonly BillingInterval[];
  featureKeys: readonly EntitlementKey[];
  plans: Array<{
    code: PlanCode;
    name: string;
    description: string;
    trialDays: number;
    prices: {
      monthly: {
        amountCents: number;
      };
      annual: {
        amountCentsBilledYearly: number;
        amountCentsEffectiveMonthly: number;
      };
    };
    limits: (typeof PLAN_CATALOG)[PlanCode]["limits"];
    entitlements: Record<EntitlementKey, boolean | number>;
  }>;
};

type StripeEvent = {
  id: string;
  type: string;
  created?: number;
  data?: {
    object?: Record<string, unknown>;
  };
};

type StripeResponse = {
  id: string;
  url?: string;
  customer?: string | null;
  subscription?: string | null;
  error?: {
    message?: string;
  };
};

class BillingError extends Error {
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(status: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "BillingError";
    this.status = status;
    this.details = details;
  }
}

function toCents(value: number) {
  return Math.max(0, Math.round(value * 100));
}

function normalizeCurrency(value?: string) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return env.BILLING_DEFAULT_CURRENCY;
  return normalized;
}

function normalizePromoCode(value?: string) {
  const normalized = value?.trim();
  if (!normalized) return null;
  return normalized.toUpperCase();
}

function computePrice(planCode: PlanCode, interval: BillingInterval) {
  const item = PLAN_CATALOG[planCode];
  if (interval === "monthly") {
    return {
      amountCents: toCents(item.prices.monthly),
      annualEffectiveMonthlyAmountCents: null,
      annualBilledAmountCents: null
    };
  }
  return {
    amountCents: toCents(item.prices.annual * 12),
    annualEffectiveMonthlyAmountCents: toCents(item.prices.annual),
    annualBilledAmountCents: toCents(item.prices.annual * 12)
  };
}

function sha256Hex(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function randomId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function addPeriod(start: Date, interval: BillingInterval) {
  const next = new Date(start);
  next.setUTCMonth(next.getUTCMonth() + (interval === "annual" ? 12 : 1));
  return next;
}

function fromUnixSeconds(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return new Date(value * 1000).toISOString();
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asOptionalUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return UUID_RE.test(value) ? value : null;
}

function coerceBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function getStripeMetaValue(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const maybe = (metadata as Record<string, unknown>)[key];
  return asString(maybe);
}

function statusGrantsAccess(status: SubscriptionStatus, currentPeriodEnd: string | null) {
  if (status === "trialing" || status === "active" || status === "past_due") {
    return true;
  }
  if (status !== "canceled") return false;
  if (!currentPeriodEnd) return false;
  return new Date(currentPeriodEnd).getTime() > Date.now();
}

function normalizeSubscriptionStatus(value: unknown): SubscriptionStatus | null {
  if (typeof value !== "string") return null;
  if (!isSubscriptionStatus(value)) return null;
  return value;
}

function buildBillingUrl(path: string) {
  const base = env.BILLING_FRONTEND_BASE_URL.replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

async function appendBillingAudit(input: {
  action: string;
  actorUserId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  details?: Record<string, unknown>;
}) {
  await query(
    `INSERT INTO admin_audit_log(admin_user_id, action, target_type, target_id, details)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      input.actorUserId ?? null,
      input.action,
      input.targetType ?? null,
      input.targetId ?? null,
      JSON.stringify(input.details ?? {})
    ]
  );
}

async function getUserContext(userId: string): Promise<UserContext> {
  const found = await query<{
    id: string;
    organization_id: string | null;
    email: string | null;
    display_name: string | null;
  }>(
    `SELECT id, organization_id, email, display_name
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId]
  );

  const row = found.rows[0];
  if (!row) {
    throw new BillingError(404, "User not found");
  }

  return {
    userId: row.id,
    organizationId: row.organization_id,
    email: row.email,
    displayName: row.display_name
  };
}

async function getTierOverride(userId: string): Promise<PlanCode | null> {
  const found = await query<{ subscription_tier: string }>(
    `SELECT subscription_tier
     FROM user_tier_overrides
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );
  const tier = found.rows[0]?.subscription_tier;
  if (!tier || !isPlanCode(tier)) return null;
  return tier;
}

async function getSubscriptionsForContext(context: UserContext): Promise<SubscriptionRow[]> {
  const found = await query<SubscriptionRow>(
    `SELECT
       id,
       organization_id,
       user_id,
       provider,
       provider_customer_id,
       provider_subscription_id,
       provider_checkout_session_id,
       status,
       plan_code,
       billing_interval,
       currency,
       current_period_start,
       current_period_end,
       cancel_at_period_end,
       canceled_at,
       trial_start,
       trial_end,
       metadata,
       created_at,
       updated_at
     FROM subscriptions
     WHERE user_id = $1
       OR ($2::uuid IS NOT NULL AND organization_id = $2::uuid)
     ORDER BY updated_at DESC
     LIMIT 25`,
    [context.userId, context.organizationId]
  );
  return found.rows;
}

function pickCurrentSubscription(rows: SubscriptionRow[]) {
  const now = Date.now();
  const scored = rows
    .map((row) => {
      const status = normalizeSubscriptionStatus(row.status);
      const plan = isPlanCode(row.plan_code) ? row.plan_code : null;
      if (!status || !plan) {
        return { row, score: 10 };
      }

      if (status === "trialing" || status === "active" || status === "past_due") {
        return { row, score: 0 };
      }

      if (
        status === "canceled" &&
        row.current_period_end &&
        new Date(row.current_period_end).getTime() > now
      ) {
        return { row, score: 1 };
      }

      return { row, score: 5 };
    })
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return new Date(b.row.updated_at).getTime() - new Date(a.row.updated_at).getTime();
    });

  return scored[0]?.row ?? null;
}

function resolveEffectivePlan(input: {
  overrideTier: PlanCode | null;
  subscription: SubscriptionRow | null;
}) {
  if (input.overrideTier) {
    return {
      planCode: input.overrideTier,
      source: "override" as const
    };
  }

  if (input.subscription) {
    const status = normalizeSubscriptionStatus(input.subscription.status);
    const planCode = isPlanCode(input.subscription.plan_code)
      ? input.subscription.plan_code
      : null;

    if (status && planCode && statusGrantsAccess(status, input.subscription.current_period_end)) {
      return {
        planCode,
        source: "subscription" as const
      };
    }
  }

  return {
    planCode: "free" as const,
    source: "free" as const
  };
}

async function ensureCatalogSeededInternal() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const planCode of PLAN_CODES) {
      const plan = PLAN_CATALOG[planCode];
      const insertedPlan = await client.query<{ id: string }>(
        `INSERT INTO plans(code, name, description, active, metadata)
         VALUES ($1, $2, $3, true, $4::jsonb)
         ON CONFLICT (code) DO UPDATE
           SET name = EXCLUDED.name,
               description = EXCLUDED.description,
               active = true,
               metadata = EXCLUDED.metadata,
               updated_at = now()
         RETURNING id`,
        [
          plan.code,
          plan.name,
          plan.description,
          JSON.stringify({
            trialDays: plan.trialDays
          })
        ]
      );
      const planId = insertedPlan.rows[0]?.id;
      if (!planId) continue;

      for (const interval of BILLING_INTERVALS) {
        const computed = computePrice(planCode, interval);
        const annualBilledAmountCents = computed.annualBilledAmountCents ?? computed.amountCents;
        const annualEffectiveMonthlyAmountCents =
          computed.annualEffectiveMonthlyAmountCents ?? computed.amountCents;

        await client.query(
          `INSERT INTO plan_prices(
             plan_id,
             billing_interval,
             currency,
             unit_amount_cents,
             trial_days,
             metadata,
             active
           )
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, true)
           ON CONFLICT (plan_id, billing_interval, currency) DO UPDATE
             SET unit_amount_cents = EXCLUDED.unit_amount_cents,
                 trial_days = EXCLUDED.trial_days,
                 metadata = EXCLUDED.metadata,
                 active = true,
                 updated_at = now()`,
          [
            planId,
            interval,
            env.BILLING_DEFAULT_CURRENCY,
            computed.amountCents,
            plan.trialDays,
            JSON.stringify({
              annualBilledAmountCents,
              annualEffectiveMonthlyAmountCents
            })
          ]
        );
      }

      for (const key of ENTITLEMENT_KEYS) {
        await client.query(
          `INSERT INTO plan_entitlements(plan_id, entitlement_key, value_json)
           VALUES ($1, $2, $3::jsonb)
           ON CONFLICT (plan_id, entitlement_key) DO UPDATE
             SET value_json = EXCLUDED.value_json,
                 updated_at = now()`,
          [planId, key, JSON.stringify(plan.entitlements[key])]
        );
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function ensureCatalogSeeded() {
  if (!catalogSeedPromise) {
    catalogSeedPromise = ensureCatalogSeededInternal().catch((error) => {
      catalogSeedPromise = null;
      throw error;
    });
  }
  await catalogSeedPromise;
}

async function loadPromotionByCode(code: string): Promise<PromoRow | null> {
  const found = await query<PromoRow>(
    `SELECT
       id,
       code,
       discount_type,
       percent_off,
       amount_off_cents,
       currency,
       redeem_by,
       max_redemptions,
       max_redemptions_per_org,
       exclude_trial,
       active,
       allowed_plan_codes,
       allowed_intervals,
       allowed_regions
     FROM promotions
     WHERE upper(code) = upper($1)
     LIMIT 1`,
    [code]
  );
  return found.rows[0] ?? null;
}

async function checkPromotionRedemptionCaps(input: {
  promotionId: string;
  organizationId: string | null;
}) {
  const [total, org] = await Promise.all([
    query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM promotion_redemptions
       WHERE promotion_id = $1`,
      [input.promotionId]
    ),
    input.organizationId
      ? query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
           FROM promotion_redemptions
           WHERE promotion_id = $1
             AND organization_id = $2`,
          [input.promotionId, input.organizationId]
        )
      : Promise.resolve({ rows: [{ count: "0" }] } as { rows: Array<{ count: string }> })
  ]);

  return {
    total: Number(total.rows[0]?.count ?? "0"),
    perOrg: Number(org.rows[0]?.count ?? "0")
  };
}

function computePromoDiscount(input: {
  promotion: PromoRow;
  baseAmountCents: number;
}) {
  if (input.promotion.discount_type === "percent_off") {
    const percent = Number(input.promotion.percent_off ?? "0");
    const discount = Math.round((input.baseAmountCents * percent) / 100);
    return Math.max(0, Math.min(input.baseAmountCents, discount));
  }

  const amount = input.promotion.amount_off_cents ?? 0;
  return Math.max(0, Math.min(input.baseAmountCents, amount));
}

async function validatePromoInternal(
  context: UserContext,
  input: PromoValidationInput
): Promise<PromoValidationResult> {
  const basePrice = computePrice(input.planCode, input.billingInterval);
  const baseAmountCents = basePrice.amountCents;
  const currency = normalizeCurrency(input.currency);
  const normalizedCode = normalizePromoCode(input.code);

  if (!normalizedCode) {
    return {
      valid: false,
      reason: "Promo code is required",
      preview: {
        planCode: input.planCode,
        billingInterval: input.billingInterval,
        currency,
        baseAmountCents,
        discountAmountCents: 0,
        finalAmountCents: baseAmountCents,
        annualEffectiveMonthlyAmountCents: basePrice.annualEffectiveMonthlyAmountCents,
        annualBilledAmountCents: basePrice.annualBilledAmountCents
      }
    };
  }

  const promo = await loadPromotionByCode(normalizedCode);
  if (!promo || !promo.active) {
    return {
      valid: false,
      reason: "Promo code not found",
      preview: {
        planCode: input.planCode,
        billingInterval: input.billingInterval,
        currency,
        baseAmountCents,
        discountAmountCents: 0,
        finalAmountCents: baseAmountCents,
        annualEffectiveMonthlyAmountCents: basePrice.annualEffectiveMonthlyAmountCents,
        annualBilledAmountCents: basePrice.annualBilledAmountCents
      }
    };
  }

  if (promo.redeem_by && new Date(promo.redeem_by).getTime() < Date.now()) {
    return {
      valid: false,
      reason: "Promo code expired",
      preview: {
        planCode: input.planCode,
        billingInterval: input.billingInterval,
        currency,
        baseAmountCents,
        discountAmountCents: 0,
        finalAmountCents: baseAmountCents,
        annualEffectiveMonthlyAmountCents: basePrice.annualEffectiveMonthlyAmountCents,
        annualBilledAmountCents: basePrice.annualBilledAmountCents
      }
    };
  }

  if (promo.allowed_plan_codes?.length && !promo.allowed_plan_codes.includes(input.planCode)) {
    return {
      valid: false,
      reason: "Promo code not available for selected plan",
      preview: {
        planCode: input.planCode,
        billingInterval: input.billingInterval,
        currency,
        baseAmountCents,
        discountAmountCents: 0,
        finalAmountCents: baseAmountCents,
        annualEffectiveMonthlyAmountCents: basePrice.annualEffectiveMonthlyAmountCents,
        annualBilledAmountCents: basePrice.annualBilledAmountCents
      }
    };
  }

  if (
    promo.allowed_intervals?.length &&
    !promo.allowed_intervals.includes(input.billingInterval)
  ) {
    return {
      valid: false,
      reason: "Promo code not available for selected billing interval",
      preview: {
        planCode: input.planCode,
        billingInterval: input.billingInterval,
        currency,
        baseAmountCents,
        discountAmountCents: 0,
        finalAmountCents: baseAmountCents,
        annualEffectiveMonthlyAmountCents: basePrice.annualEffectiveMonthlyAmountCents,
        annualBilledAmountCents: basePrice.annualBilledAmountCents
      }
    };
  }

  if (
    promo.allowed_regions?.length &&
    input.region &&
    !promo.allowed_regions.includes(input.region.toLowerCase())
  ) {
    return {
      valid: false,
      reason: "Promo code is not valid in your region",
      preview: {
        planCode: input.planCode,
        billingInterval: input.billingInterval,
        currency,
        baseAmountCents,
        discountAmountCents: 0,
        finalAmountCents: baseAmountCents,
        annualEffectiveMonthlyAmountCents: basePrice.annualEffectiveMonthlyAmountCents,
        annualBilledAmountCents: basePrice.annualBilledAmountCents
      }
    };
  }

  if (
    promo.discount_type === "amount_off" &&
    promo.currency &&
    promo.currency.toLowerCase() !== currency
  ) {
    return {
      valid: false,
      reason: "Promo code currency does not match selected currency",
      preview: {
        planCode: input.planCode,
        billingInterval: input.billingInterval,
        currency,
        baseAmountCents,
        discountAmountCents: 0,
        finalAmountCents: baseAmountCents,
        annualEffectiveMonthlyAmountCents: basePrice.annualEffectiveMonthlyAmountCents,
        annualBilledAmountCents: basePrice.annualBilledAmountCents
      }
    };
  }

  const caps = await checkPromotionRedemptionCaps({
    promotionId: promo.id,
    organizationId: context.organizationId
  });

  if (promo.max_redemptions != null && caps.total >= promo.max_redemptions) {
    return {
      valid: false,
      reason: "Promo code redemption limit reached",
      preview: {
        planCode: input.planCode,
        billingInterval: input.billingInterval,
        currency,
        baseAmountCents,
        discountAmountCents: 0,
        finalAmountCents: baseAmountCents,
        annualEffectiveMonthlyAmountCents: basePrice.annualEffectiveMonthlyAmountCents,
        annualBilledAmountCents: basePrice.annualBilledAmountCents
      }
    };
  }

  if (
    promo.max_redemptions_per_org != null &&
    caps.perOrg >= promo.max_redemptions_per_org
  ) {
    return {
      valid: false,
      reason: "Promo code limit reached for this organization",
      preview: {
        planCode: input.planCode,
        billingInterval: input.billingInterval,
        currency,
        baseAmountCents,
        discountAmountCents: 0,
        finalAmountCents: baseAmountCents,
        annualEffectiveMonthlyAmountCents: basePrice.annualEffectiveMonthlyAmountCents,
        annualBilledAmountCents: basePrice.annualBilledAmountCents
      }
    };
  }

  const discountAmountCents = computePromoDiscount({
    promotion: promo,
    baseAmountCents
  });
  const finalAmountCents = Math.max(0, baseAmountCents - discountAmountCents);

  return {
    valid: true,
    promotion: {
      code: promo.code,
      discountType: promo.discount_type,
      percentOff: promo.percent_off != null ? Number(promo.percent_off) : null,
      amountOffCents: promo.amount_off_cents,
      currency: promo.currency
    },
    preview: {
      planCode: input.planCode,
      billingInterval: input.billingInterval,
      currency,
      baseAmountCents,
      discountAmountCents,
      finalAmountCents,
      annualEffectiveMonthlyAmountCents: basePrice.annualEffectiveMonthlyAmountCents,
      annualBilledAmountCents: basePrice.annualBilledAmountCents
    }
  };
}

async function loadIdempotentResponse(input: {
  scope: string;
  organizationId: string | null;
  idempotencyKey: string;
}) {
  const found = await query<{ request_hash: string; response_json: Record<string, unknown> }>(
    `SELECT request_hash, response_json
     FROM billing_request_idempotency
     WHERE scope = $1
       AND idempotency_key = $2
       AND (
         ($3::uuid IS NULL AND organization_id IS NULL)
         OR organization_id = $3::uuid
       )
     ORDER BY created_at DESC
     LIMIT 1`,
    [input.scope, input.idempotencyKey, input.organizationId]
  );
  return found.rows[0] ?? null;
}

async function storeIdempotentResponse(input: {
  scope: string;
  context: UserContext;
  idempotencyKey: string;
  requestHash: string;
  response: Record<string, unknown>;
}) {
  await query(
    `INSERT INTO billing_request_idempotency(
       scope,
       organization_id,
       user_id,
       idempotency_key,
       request_hash,
       response_json
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      input.scope,
      input.context.organizationId,
      input.context.userId,
      input.idempotencyKey,
      input.requestHash,
      JSON.stringify(input.response)
    ]
  );
}

async function resolvePlanFromStripePriceId(
  stripePriceId: string
): Promise<{ planCode: PlanCode; billingInterval: BillingInterval } | null> {
  const found = await query<PriceMapRow>(
    `SELECT
       pp.stripe_price_id,
       p.code AS plan_code,
       pp.billing_interval
     FROM plan_prices pp
     INNER JOIN plans p ON p.id = pp.plan_id
     WHERE pp.stripe_price_id = $1
     LIMIT 1`,
    [stripePriceId]
  );
  const row = found.rows[0];
  if (!row) return null;
  if (!isPlanCode(row.plan_code)) return null;
  if (!isBillingInterval(row.billing_interval)) return null;
  return {
    planCode: row.plan_code,
    billingInterval: row.billing_interval
  };
}

async function getStripePriceId(input: {
  planCode: PlanCode;
  billingInterval: BillingInterval;
  currency: string;
}) {
  const found = await query<{ stripe_price_id: string | null }>(
    `SELECT pp.stripe_price_id
     FROM plan_prices pp
     INNER JOIN plans p ON p.id = pp.plan_id
     WHERE p.code = $1
       AND pp.billing_interval = $2
       AND pp.currency = $3
     LIMIT 1`,
    [input.planCode, input.billingInterval, input.currency]
  );
  const priceId = found.rows[0]?.stripe_price_id ?? null;
  return priceId;
}

async function stripePostForm(
  path: string,
  form: URLSearchParams,
  idempotencyKey?: string
): Promise<StripeResponse> {
  if (!env.STRIPE_SECRET_KEY) {
    throw new BillingError(500, "Stripe secret key is not configured");
  }

  const res = await fetch(`${env.STRIPE_API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
    },
    body: form.toString()
  });

  const payload = (await res.json().catch(() => null)) as StripeResponse | null;
  if (!res.ok) {
    const message = payload?.error?.message ?? `Stripe API failed (${res.status})`;
    throw new BillingError(res.status >= 500 ? 502 : 400, message);
  }
  return payload ?? ({ id: "" } as StripeResponse);
}

async function insertSubscriptionEvent(input: {
  subscriptionId: string | null;
  providerEventId?: string | null;
  eventType: string;
  payload: Record<string, unknown>;
}) {
  await query(
    `INSERT INTO subscription_events(subscription_id, provider_event_id, event_type, payload)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [
      input.subscriptionId,
      input.providerEventId ?? null,
      input.eventType,
      JSON.stringify(input.payload)
    ]
  );
}

async function recordPromotionRedemptionByCode(input: {
  code: string;
  checkoutSessionId?: string | null;
  providerEventId?: string | null;
  subscriptionId?: string | null;
  organizationId: string | null;
  userId: string | null;
}) {
  const promotion = await loadPromotionByCode(input.code);
  if (!promotion) return;

  await query(
    `INSERT INTO promotion_redemptions(
       promotion_id,
       subscription_id,
       organization_id,
       user_id,
       checkout_session_id,
       provider_event_id,
       amount_off_cents,
       percent_off,
       currency
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT DO NOTHING`,
    [
      promotion.id,
      input.subscriptionId ?? null,
      input.organizationId,
      input.userId,
      input.checkoutSessionId ?? null,
      input.providerEventId ?? null,
      promotion.amount_off_cents,
      promotion.percent_off,
      promotion.currency ?? env.BILLING_DEFAULT_CURRENCY
    ]
  );

  await appendBillingAudit({
    action: "billing.promo.redeemed",
    actorUserId: null,
    targetType: "promotion",
    targetId: promotion.id,
    details: {
      code: promotion.code,
      organizationId: input.organizationId,
      userId: input.userId,
      checkoutSessionId: input.checkoutSessionId ?? null,
      providerEventId: input.providerEventId ?? null
    }
  });
}

async function upsertStripeSubscription(
  object: Record<string, unknown>,
  providerEventId: string
) {
  const providerSubscriptionId = asString(object.id);
  if (!providerSubscriptionId) return null;

  const metadata = (object.metadata as Record<string, unknown> | undefined) ?? {};
  const customerId = asString(object.customer);
  const fallbackPlan = asString(getStripeMetaValue(metadata, "plan_code"));
  const fallbackInterval = asString(getStripeMetaValue(metadata, "billing_interval"));
  const userIdFromMeta = asOptionalUuid(getStripeMetaValue(metadata, "user_id"));
  const organizationIdFromMeta = asOptionalUuid(getStripeMetaValue(metadata, "organization_id"));

  const firstItem = Array.isArray((object.items as Record<string, unknown>)?.data)
    ? (((object.items as Record<string, unknown>).data as unknown[])[0] as
        | Record<string, unknown>
        | undefined)
    : undefined;

  const price = (firstItem?.price as Record<string, unknown> | undefined) ?? undefined;
  const stripePriceId = asString(price?.id);

  let mapped: { planCode: PlanCode; billingInterval: BillingInterval } | null = null;
  if (stripePriceId) {
    mapped = await resolvePlanFromStripePriceId(stripePriceId);
  }

  const existing = await query<{
    id: string;
    user_id: string | null;
    organization_id: string | null;
    plan_code: string;
    billing_interval: string;
  }>(
    `SELECT id, user_id, organization_id, plan_code, billing_interval
     FROM subscriptions
     WHERE provider_subscription_id = $1
     LIMIT 1`,
    [providerSubscriptionId]
  );
  const existingRow = existing.rows[0];

  const planCode = mapped?.planCode
    ?? (fallbackPlan && isPlanCode(fallbackPlan) ? fallbackPlan : null)
    ?? (existingRow?.plan_code && isPlanCode(existingRow.plan_code) ? existingRow.plan_code : null)
    ?? "free";
  const billingInterval = mapped?.billingInterval
    ?? (fallbackInterval && isBillingInterval(fallbackInterval) ? fallbackInterval : null)
    ?? (existingRow?.billing_interval && isBillingInterval(existingRow.billing_interval)
      ? existingRow.billing_interval
      : null)
    ?? "monthly";

  const status =
    normalizeSubscriptionStatus(object.status)
    ?? "incomplete";

  const currency = asString(object.currency)?.toLowerCase() ?? env.BILLING_DEFAULT_CURRENCY;

  const upserted = await query<{ id: string; user_id: string | null; organization_id: string | null }>(
    `INSERT INTO subscriptions(
       organization_id,
       user_id,
       provider,
       provider_customer_id,
       provider_subscription_id,
       status,
       plan_code,
       billing_interval,
       currency,
       current_period_start,
       current_period_end,
       cancel_at_period_end,
       canceled_at,
       trial_start,
       trial_end,
       metadata
     )
     VALUES ($1, $2, 'stripe', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)
     ON CONFLICT (provider_subscription_id) DO UPDATE
       SET organization_id = COALESCE(EXCLUDED.organization_id, subscriptions.organization_id),
           user_id = COALESCE(EXCLUDED.user_id, subscriptions.user_id),
           provider_customer_id = COALESCE(EXCLUDED.provider_customer_id, subscriptions.provider_customer_id),
           status = EXCLUDED.status,
           plan_code = EXCLUDED.plan_code,
           billing_interval = EXCLUDED.billing_interval,
           currency = EXCLUDED.currency,
           current_period_start = EXCLUDED.current_period_start,
           current_period_end = EXCLUDED.current_period_end,
           cancel_at_period_end = EXCLUDED.cancel_at_period_end,
           canceled_at = EXCLUDED.canceled_at,
           trial_start = EXCLUDED.trial_start,
           trial_end = EXCLUDED.trial_end,
           metadata = EXCLUDED.metadata,
           updated_at = now()
     RETURNING id, user_id, organization_id`,
    [
      organizationIdFromMeta ?? existingRow?.organization_id ?? null,
      userIdFromMeta ?? existingRow?.user_id ?? null,
      customerId,
      providerSubscriptionId,
      status,
      planCode,
      billingInterval,
      currency,
      fromUnixSeconds(object.current_period_start),
      fromUnixSeconds(object.current_period_end),
      coerceBoolean(object.cancel_at_period_end),
      fromUnixSeconds(object.canceled_at),
      fromUnixSeconds(object.trial_start),
      fromUnixSeconds(object.trial_end),
      JSON.stringify(object)
    ]
  );

  const row = upserted.rows[0];
  await insertSubscriptionEvent({
    subscriptionId: row?.id ?? null,
    providerEventId,
    eventType: "stripe.subscription.sync",
    payload: object
  });

  await appendBillingAudit({
    action: "billing.subscription.updated",
    targetType: "subscription",
    targetId: row?.id ?? null,
    details: {
      provider: "stripe",
      providerSubscriptionId,
      status,
      planCode,
      billingInterval
    }
  });

  return row ?? null;
}

async function upsertStripeInvoice(
  object: Record<string, unknown>,
  providerEventId: string,
  eventType: string
) {
  const providerInvoiceId = asString(object.id);
  if (!providerInvoiceId) return;

  const subscriptionProviderId = asString(object.subscription);
  const subscription = subscriptionProviderId
    ? await query<{ id: string }>(
        `SELECT id
         FROM subscriptions
         WHERE provider_subscription_id = $1
         LIMIT 1`,
        [subscriptionProviderId]
      )
    : null;
  const subscriptionId = subscription?.rows[0]?.id ?? null;

  const invoice = await query<{ id: string }>(
    `INSERT INTO invoices(
       subscription_id,
       provider_invoice_id,
       status,
       amount_due_cents,
       amount_paid_cents,
       currency,
       hosted_invoice_url,
       invoice_pdf_url,
       period_start,
       period_end,
       due_at,
       metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
     ON CONFLICT (provider_invoice_id) DO UPDATE
       SET subscription_id = COALESCE(EXCLUDED.subscription_id, invoices.subscription_id),
           status = EXCLUDED.status,
           amount_due_cents = EXCLUDED.amount_due_cents,
           amount_paid_cents = EXCLUDED.amount_paid_cents,
           currency = EXCLUDED.currency,
           hosted_invoice_url = EXCLUDED.hosted_invoice_url,
           invoice_pdf_url = EXCLUDED.invoice_pdf_url,
           period_start = EXCLUDED.period_start,
           period_end = EXCLUDED.period_end,
           due_at = EXCLUDED.due_at,
           metadata = EXCLUDED.metadata,
           updated_at = now()
     RETURNING id`,
    [
      subscriptionId,
      providerInvoiceId,
      asString(object.status) ?? "open",
      typeof object.amount_due === "number" ? object.amount_due : 0,
      typeof object.amount_paid === "number" ? object.amount_paid : 0,
      asString(object.currency)?.toLowerCase() ?? env.BILLING_DEFAULT_CURRENCY,
      asString(object.hosted_invoice_url),
      asString(object.invoice_pdf),
      fromUnixSeconds(object.period_start),
      fromUnixSeconds(object.period_end),
      fromUnixSeconds(object.due_date),
      JSON.stringify(object)
    ]
  );

  const paymentIntentId = asString(object.payment_intent);
  if (paymentIntentId) {
    await query(
      `INSERT INTO payments(invoice_id, provider_payment_intent_id, status, amount_cents, currency, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (provider_payment_intent_id) DO UPDATE
         SET invoice_id = COALESCE(EXCLUDED.invoice_id, payments.invoice_id),
             status = EXCLUDED.status,
             amount_cents = EXCLUDED.amount_cents,
             currency = EXCLUDED.currency,
             metadata = EXCLUDED.metadata,
             updated_at = now()`,
      [
        invoice.rows[0]?.id ?? null,
        paymentIntentId,
        asString(object.status) ?? "unknown",
        typeof object.amount_paid === "number" ? object.amount_paid : 0,
        asString(object.currency)?.toLowerCase() ?? env.BILLING_DEFAULT_CURRENCY,
        JSON.stringify(object)
      ]
    );
  }

  if (subscriptionId) {
    if (eventType === "invoice.payment_failed") {
      await query(
        `UPDATE subscriptions
         SET status = 'past_due',
             updated_at = now()
         WHERE id = $1`,
        [subscriptionId]
      );
    }

    if (eventType === "invoice.paid") {
      await query(
        `UPDATE subscriptions
         SET status = CASE
             WHEN status IN ('incomplete', 'past_due', 'unpaid') THEN 'active'
             ELSE status
           END,
           updated_at = now()
         WHERE id = $1`,
        [subscriptionId]
      );
    }
  }

  await insertSubscriptionEvent({
    subscriptionId,
    providerEventId,
    eventType: `stripe.${eventType}`,
    payload: object
  });
}

async function upsertStripeCheckoutSession(
  object: Record<string, unknown>,
  providerEventId: string
) {
  const checkoutSessionId = asString(object.id);
  if (!checkoutSessionId) return null;

  const metadata = (object.metadata as Record<string, unknown> | undefined) ?? {};
  const providerSubscriptionId = asString(object.subscription);
  const customerId = asString(object.customer);
  const status: SubscriptionStatus =
    asString(object.payment_status) === "paid" ? "active" : "incomplete";
  const planCodeRaw = getStripeMetaValue(metadata, "plan_code");
  const billingIntervalRaw = getStripeMetaValue(metadata, "billing_interval");
  const promoCode = getStripeMetaValue(metadata, "promo_code");

  const planCode = planCodeRaw && isPlanCode(planCodeRaw) ? planCodeRaw : "free";
  const billingInterval =
    billingIntervalRaw && isBillingInterval(billingIntervalRaw)
      ? billingIntervalRaw
      : "monthly";
  const currency = asString(object.currency)?.toLowerCase() ?? env.BILLING_DEFAULT_CURRENCY;
  const userId = asOptionalUuid(getStripeMetaValue(metadata, "user_id"));
  const organizationId = asOptionalUuid(getStripeMetaValue(metadata, "organization_id"));

  if (providerSubscriptionId) {
    const updated = await query<{ id: string }>(
      `UPDATE subscriptions
       SET provider_checkout_session_id = $1,
           provider_customer_id = COALESCE($2, provider_customer_id),
           status = CASE WHEN status = 'incomplete' THEN $3 ELSE status END,
           user_id = COALESCE($4, user_id),
           organization_id = COALESCE($5, organization_id),
           plan_code = COALESCE($6, plan_code),
           billing_interval = COALESCE($7, billing_interval),
           currency = COALESCE($8, currency),
           metadata = COALESCE($9::jsonb, metadata),
           updated_at = now()
       WHERE provider_subscription_id = $10
       RETURNING id`,
      [
        checkoutSessionId,
        customerId,
        status,
        userId,
        organizationId,
        planCode,
        billingInterval,
        currency,
        JSON.stringify(object),
        providerSubscriptionId
      ]
    );

    if (updated.rowCount && updated.rowCount > 0) {
      const subscriptionId = updated.rows[0].id;
      await insertSubscriptionEvent({
        subscriptionId,
        providerEventId,
        eventType: "stripe.checkout.completed",
        payload: object
      });
      if (promoCode) {
        await recordPromotionRedemptionByCode({
          code: promoCode,
          checkoutSessionId,
          providerEventId,
          subscriptionId,
          organizationId,
          userId
        });
      }
      return subscriptionId;
    }
  }

  const inserted = await query<{ id: string }>(
    `INSERT INTO subscriptions(
       organization_id,
       user_id,
       provider,
       provider_customer_id,
       provider_subscription_id,
       provider_checkout_session_id,
       status,
       plan_code,
       billing_interval,
       currency,
       metadata
     )
     VALUES ($1, $2, 'stripe', $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     ON CONFLICT (provider_checkout_session_id) DO UPDATE
       SET provider_customer_id = COALESCE(EXCLUDED.provider_customer_id, subscriptions.provider_customer_id),
           provider_subscription_id = COALESCE(EXCLUDED.provider_subscription_id, subscriptions.provider_subscription_id),
           status = EXCLUDED.status,
           plan_code = EXCLUDED.plan_code,
           billing_interval = EXCLUDED.billing_interval,
           currency = EXCLUDED.currency,
           metadata = EXCLUDED.metadata,
           updated_at = now()
     RETURNING id`,
    [
      organizationId,
      userId,
      customerId,
      providerSubscriptionId,
      checkoutSessionId,
      status,
      planCode,
      billingInterval,
      currency,
      JSON.stringify(object)
    ]
  );

  const subscriptionId = inserted.rows[0]?.id ?? null;
  await insertSubscriptionEvent({
    subscriptionId,
    providerEventId,
    eventType: "stripe.checkout.completed",
    payload: object
  });

  if (promoCode) {
    await recordPromotionRedemptionByCode({
      code: promoCode,
      checkoutSessionId,
      providerEventId,
      subscriptionId,
      organizationId,
      userId
    });
  }

  return subscriptionId;
}

function parseStripeSignatureHeader(signature: string) {
  const tokens = signature.split(",").map((part) => part.trim());
  const timestampToken = tokens.find((token) => token.startsWith("t="));
  const signatures = tokens
    .filter((token) => token.startsWith("v1="))
    .map((token) => token.slice(3))
    .filter((token) => token.length > 0);

  const timestampValue = timestampToken?.slice(2) ?? "";
  const timestamp = Number.parseInt(timestampValue, 10);
  if (!Number.isFinite(timestamp) || signatures.length === 0) {
    return null;
  }

  return { timestamp, signatures };
}

function verifyStripeSignature(input: {
  rawBody: Buffer;
  signatureHeader: string;
  secret: string;
}) {
  const parsed = parseStripeSignatureHeader(input.signatureHeader);
  if (!parsed) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - parsed.timestamp) > 300) {
    return false;
  }

  const payloadToSign = `${parsed.timestamp}.${input.rawBody.toString("utf8")}`;
  const expected = crypto
    .createHmac("sha256", input.secret)
    .update(payloadToSign)
    .digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  return parsed.signatures.some((candidate) => {
    if (!/^[0-9a-f]+$/i.test(candidate)) return false;
    const candidateBuffer = Buffer.from(candidate, "hex");
    if (candidateBuffer.length !== expectedBuffer.length) return false;
    return crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
  });
}

async function markWebhookLogStatus(input: {
  provider: string;
  eventId: string;
  status: "processed" | "ignored" | "error";
  error?: string;
}) {
  await query(
    `UPDATE webhook_event_log
     SET status = $3,
         error = $4,
         processed_at = now()
     WHERE provider = $1
       AND event_id = $2`,
    [input.provider, input.eventId, input.status, input.error ?? null]
  );
}

export async function getPublicPlansCatalog(): Promise<PublicPlansResponse> {
  await ensureCatalogSeeded();
  return {
    currency: env.BILLING_DEFAULT_CURRENCY,
    billingIntervals: BILLING_INTERVALS,
    featureKeys: ENTITLEMENT_KEYS,
    plans: PLAN_CODES.map((planCode) => {
      const item = PLAN_CATALOG[planCode];
      const monthly = computePrice(planCode, "monthly");
      const annual = computePrice(planCode, "annual");
      return {
        code: item.code,
        name: item.name,
        description: item.description,
        trialDays: item.trialDays,
        prices: {
          monthly: {
            amountCents: monthly.amountCents
          },
          annual: {
            amountCentsBilledYearly: annual.annualBilledAmountCents ?? annual.amountCents,
            amountCentsEffectiveMonthly:
              annual.annualEffectiveMonthlyAmountCents ?? annual.amountCents
          }
        },
        limits: item.limits,
        entitlements: item.entitlements
      };
    })
  };
}

export async function getBillingSnapshot(userId: string): Promise<BillingSnapshot> {
  await ensureCatalogSeeded();
  const context = await getUserContext(userId);
  const [overrideTier, subscriptions] = await Promise.all([
    getTierOverride(userId),
    getSubscriptionsForContext(context)
  ]);

  const current = pickCurrentSubscription(subscriptions);
  const effective = resolveEffectivePlan({
    overrideTier,
    subscription: current
  });
  const activePlan = PLAN_CATALOG[effective.planCode];

  const status = current?.status && isSubscriptionStatus(current.status) ? current.status : "free";
  const renewalAt = current?.current_period_end ?? null;
  const accessEndsAt =
    status === "canceled" || status === "unpaid" || status === "incomplete_expired"
      ? renewalAt
      : null;

  return {
    customer: {
      userId: context.userId,
      organizationId: context.organizationId,
      email: context.email,
      displayName: context.displayName
    },
    currentPlan: effective.planCode,
    currentPlanSource: effective.source,
    subscription: current
      ? {
          id: current.id,
          provider: current.provider,
          status: isSubscriptionStatus(current.status) ? current.status : "incomplete",
          planCode: isPlanCode(current.plan_code) ? current.plan_code : "free",
          billingInterval: isBillingInterval(current.billing_interval)
            ? current.billing_interval
            : "monthly",
          currency: current.currency,
          currentPeriodStart: current.current_period_start,
          currentPeriodEnd: current.current_period_end,
          cancelAtPeriodEnd: current.cancel_at_period_end,
          canceledAt: current.canceled_at,
          trialStart: current.trial_start,
          trialEnd: current.trial_end,
          providerCheckoutSessionId: current.provider_checkout_session_id,
          providerSubscriptionId: current.provider_subscription_id,
          createdAt: current.created_at,
          updatedAt: current.updated_at
        }
      : null,
    entitlements: activePlan.entitlements,
    limits: activePlan.limits,
    trialDays: activePlan.trialDays,
    canManageBilling: effective.planCode !== "free" || Boolean(current),
    renewalAt,
    accessEndsAt,
    statusBanner: status
  };
}

export async function validatePromotionForUser(
  userId: string,
  input: PromoValidationInput
): Promise<PromoValidationResult> {
  await ensureCatalogSeeded();
  const context = await getUserContext(userId);
  return validatePromoInternal(context, input);
}

export async function createCheckoutSessionForUser(
  userId: string,
  input: CheckoutSessionInput
): Promise<CheckoutSessionResult> {
  await ensureCatalogSeeded();
  const context = await getUserContext(userId);
  const currency = normalizeCurrency(input.currency);
  const promoCode = normalizePromoCode(input.promoCode);

  const requestHash = sha256Hex(
    JSON.stringify({
      planCode: input.planCode,
      billingInterval: input.billingInterval,
      currency,
      promoCode,
      userId: context.userId,
      organizationId: context.organizationId
    })
  );

  const existing = await loadIdempotentResponse({
    scope: "checkout_session",
    organizationId: context.organizationId,
    idempotencyKey: input.idempotencyKey
  });
  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw new BillingError(409, "Idempotency key already used with a different request");
    }
    return existing.response_json as unknown as CheckoutSessionResult;
  }

  let promoResult: PromoValidationResult | null = null;
  if (promoCode) {
    promoResult = await validatePromoInternal(context, {
      code: promoCode,
      planCode: input.planCode,
      billingInterval: input.billingInterval,
      currency
    });
    if (!promoResult.valid) {
      throw new BillingError(400, promoResult.reason ?? "Invalid promo code");
    }
  }

  const basePrice = computePrice(input.planCode, input.billingInterval);
  const amountCents = promoResult?.preview.finalAmountCents ?? basePrice.amountCents;

  let result: CheckoutSessionResult;

  if (env.BILLING_PROVIDER === "mock") {
    const checkoutSessionId = randomId("mock_cs");
    const checkoutUrl = `${buildBillingUrl("/billing/checkout")}?provider=mock&session=${encodeURIComponent(
      checkoutSessionId
    )}`;
    const now = new Date();
    const periodEnd = addPeriod(now, input.billingInterval);

    await query(
      `INSERT INTO subscriptions(
         organization_id,
         user_id,
         provider,
         provider_checkout_session_id,
         status,
         plan_code,
         billing_interval,
         currency,
         current_period_start,
         current_period_end,
         metadata
       )
       VALUES ($1, $2, 'mock', $3, 'incomplete', $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        context.organizationId,
        context.userId,
        checkoutSessionId,
        input.planCode,
        input.billingInterval,
        currency,
        now.toISOString(),
        periodEnd.toISOString(),
        JSON.stringify({
          promoCode,
          source: input.source ?? null,
          feature: input.feature ?? null,
          amountCents,
          baseAmountCents: basePrice.amountCents
        })
      ]
    );

    result = {
      provider: "mock",
      checkoutUrl,
      checkoutSessionId,
      planCode: input.planCode,
      billingInterval: input.billingInterval,
      currency,
      promoCode,
      amountCents
    };
  } else {
    const stripePriceId = await getStripePriceId({
      planCode: input.planCode,
      billingInterval: input.billingInterval,
      currency
    });
    if (!stripePriceId) {
      throw new BillingError(
        409,
        `Stripe price mapping missing for ${input.planCode}/${input.billingInterval}/${currency}`
      );
    }

    const form = new URLSearchParams();
    form.set("mode", "subscription");
    form.set("line_items[0][price]", stripePriceId);
    form.set("line_items[0][quantity]", "1");
    form.set("success_url", `${buildBillingUrl(env.BILLING_SUCCESS_PATH)}?session_id={CHECKOUT_SESSION_ID}`);
    form.set("cancel_url", buildBillingUrl(env.BILLING_CANCEL_PATH));
    form.set("client_reference_id", context.organizationId ?? context.userId);
    form.set("metadata[user_id]", context.userId);
    if (context.organizationId) {
      form.set("metadata[organization_id]", context.organizationId);
    }
    form.set("metadata[plan_code]", input.planCode);
    form.set("metadata[billing_interval]", input.billingInterval);
    if (promoCode) {
      form.set("metadata[promo_code]", promoCode);
    }
    if (input.source) {
      form.set("metadata[source]", input.source);
    }
    if (input.feature) {
      form.set("metadata[feature]", input.feature);
    }

    const plan = PLAN_CATALOG[input.planCode];
    const canUseTrial = !promoResult?.promotion || promoResult.preview.discountAmountCents === 0;
    if (plan.trialDays > 0 && canUseTrial) {
      form.set("subscription_data[trial_period_days]", String(plan.trialDays));
    }

    if (promoCode) {
      const promo = await loadPromotionByCode(promoCode);
      const stripeCoupon = promo ? await query<{ stripe_coupon_id: string | null }>(
        `SELECT stripe_coupon_id
         FROM promotions
         WHERE id = $1
         LIMIT 1`,
        [promo.id]
      ) : null;
      const couponId = stripeCoupon?.rows[0]?.stripe_coupon_id ?? null;
      if (couponId) {
        form.set("discounts[0][coupon]", couponId);
      }
    }

    const stripe = await stripePostForm(
      "/checkout/sessions",
      form,
      input.idempotencyKey
    );
    const checkoutSessionId = stripe.id;
    const checkoutUrl = stripe.url;
    if (!checkoutSessionId || !checkoutUrl) {
      throw new BillingError(502, "Stripe checkout session creation failed");
    }

    await query(
      `INSERT INTO subscriptions(
         organization_id,
         user_id,
         provider,
         provider_customer_id,
         provider_checkout_session_id,
         status,
         plan_code,
         billing_interval,
         currency,
         metadata
       )
       VALUES ($1, $2, 'stripe', $3, $4, 'incomplete', $5, $6, $7, $8::jsonb)
       ON CONFLICT (provider_checkout_session_id) DO UPDATE
         SET provider_customer_id = COALESCE(EXCLUDED.provider_customer_id, subscriptions.provider_customer_id),
             status = EXCLUDED.status,
             plan_code = EXCLUDED.plan_code,
             billing_interval = EXCLUDED.billing_interval,
             currency = EXCLUDED.currency,
             metadata = EXCLUDED.metadata,
             updated_at = now()`,
      [
        context.organizationId,
        context.userId,
        stripe.customer ?? null,
        checkoutSessionId,
        input.planCode,
        input.billingInterval,
        currency,
        JSON.stringify({
          promoCode,
          source: input.source ?? null,
          feature: input.feature ?? null,
          amountCents,
          baseAmountCents: basePrice.amountCents
        })
      ]
    );

    result = {
      provider: "stripe",
      checkoutUrl,
      checkoutSessionId,
      planCode: input.planCode,
      billingInterval: input.billingInterval,
      currency,
      promoCode,
      amountCents
    };
  }

  await storeIdempotentResponse({
    scope: "checkout_session",
    context,
    idempotencyKey: input.idempotencyKey,
    requestHash,
    response: result as unknown as Record<string, unknown>
  });

  await appendBillingAudit({
    action: "billing.checkout.created",
    actorUserId: context.userId,
    targetType: "subscription",
    details: {
      provider: result.provider,
      checkoutSessionId: result.checkoutSessionId,
      planCode: result.planCode,
      billingInterval: result.billingInterval,
      promoCode: result.promoCode
    }
  });

  return result;
}

export async function createPortalSessionForUser(userId: string): Promise<PortalSessionResult> {
  await ensureCatalogSeeded();
  const context = await getUserContext(userId);

  if (env.BILLING_PROVIDER === "mock") {
    return {
      provider: "mock",
      portalUrl: `${buildBillingUrl(env.BILLING_PORTAL_RETURN_PATH)}?portal=mock`
    };
  }

  const subscription = await query<{ provider_customer_id: string | null }>(
    `SELECT provider_customer_id
     FROM subscriptions
     WHERE provider = 'stripe'
       AND (user_id = $1 OR ($2::uuid IS NOT NULL AND organization_id = $2::uuid))
       AND provider_customer_id IS NOT NULL
     ORDER BY updated_at DESC
     LIMIT 1`,
    [context.userId, context.organizationId]
  );
  const customerId = subscription.rows[0]?.provider_customer_id ?? null;
  if (!customerId) {
    throw new BillingError(409, "No Stripe customer profile found");
  }

  const form = new URLSearchParams();
  form.set("customer", customerId);
  form.set("return_url", buildBillingUrl(env.BILLING_PORTAL_RETURN_PATH));
  const session = await stripePostForm("/billing_portal/sessions", form);
  if (!session.url) {
    throw new BillingError(502, "Failed to create billing portal session");
  }

  return {
    provider: "stripe",
    portalUrl: session.url
  };
}

export async function listInvoicesForUser(userId: string, limit = 50): Promise<BillingInvoice[]> {
  await ensureCatalogSeeded();
  const context = await getUserContext(userId);
  const found = await query<{
    id: string;
    status: string;
    amount_due_cents: number;
    amount_paid_cents: number;
    currency: string;
    hosted_invoice_url: string | null;
    invoice_pdf_url: string | null;
    period_start: string | null;
    period_end: string | null;
    due_at: string | null;
    created_at: string;
  }>(
    `SELECT
       i.id,
       i.status,
       i.amount_due_cents,
       i.amount_paid_cents,
       i.currency,
       i.hosted_invoice_url,
       i.invoice_pdf_url,
       i.period_start,
       i.period_end,
       i.due_at,
       i.created_at
     FROM invoices i
     INNER JOIN subscriptions s ON s.id = i.subscription_id
     WHERE s.user_id = $1
       OR ($2::uuid IS NOT NULL AND s.organization_id = $2::uuid)
     ORDER BY i.created_at DESC
     LIMIT $3`,
    [context.userId, context.organizationId, Math.max(1, Math.min(200, limit))]
  );

  return found.rows.map((row) => ({
    id: row.id,
    status: row.status,
    amountDueCents: row.amount_due_cents,
    amountPaidCents: row.amount_paid_cents,
    currency: row.currency,
    hostedInvoiceUrl: row.hosted_invoice_url,
    invoicePdfUrl: row.invoice_pdf_url,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    dueAt: row.due_at,
    createdAt: row.created_at
  }));
}

export async function completeMockCheckoutForUser(
  userId: string,
  checkoutSessionId: string
): Promise<BillingSnapshot> {
  if (env.BILLING_PROVIDER !== "mock") {
    throw new BillingError(400, "Mock checkout completion is only available in mock billing mode");
  }

  const context = await getUserContext(userId);
  const found = await query<{
    id: string;
    plan_code: string;
    billing_interval: string;
    currency: string;
    metadata: Record<string, unknown> | null;
    status: string;
  }>(
    `SELECT id, plan_code, billing_interval, currency, metadata, status
     FROM subscriptions
     WHERE provider = 'mock'
       AND provider_checkout_session_id = $1
       AND (user_id = $2 OR ($3::uuid IS NOT NULL AND organization_id = $3::uuid))
     LIMIT 1`,
    [checkoutSessionId, context.userId, context.organizationId]
  );

  const row = found.rows[0];
  if (!row) {
    throw new BillingError(404, "Mock checkout session not found");
  }

  const planCode = isPlanCode(row.plan_code) ? row.plan_code : "free";
  const interval = isBillingInterval(row.billing_interval) ? row.billing_interval : "monthly";
  const plan = PLAN_CATALOG[planCode];
  const now = new Date();
  const trialDays = plan.trialDays;
  const trialEnd = trialDays > 0 ? new Date(now.getTime() + trialDays * 86400000) : null;
  const status: SubscriptionStatus = trialEnd ? "trialing" : "active";

  await query(
    `UPDATE subscriptions
     SET status = $2,
         current_period_start = $3,
         current_period_end = $4,
         trial_start = $5,
         trial_end = $6,
         updated_at = now()
     WHERE id = $1`,
    [
      row.id,
      status,
      now.toISOString(),
      addPeriod(now, interval).toISOString(),
      trialEnd ? now.toISOString() : null,
      trialEnd ? trialEnd.toISOString() : null
    ]
  );

  const baseAmount = computePrice(planCode, interval).amountCents;
  const finalAmount = Number((row.metadata?.amountCents as number | undefined) ?? baseAmount);

  await query(
    `INSERT INTO invoices(
       subscription_id,
       provider_invoice_id,
       status,
       amount_due_cents,
       amount_paid_cents,
       currency,
       metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (provider_invoice_id) DO NOTHING`,
    [
      row.id,
      `mock_inv_${checkoutSessionId}`,
      trialEnd ? "trialing" : "paid",
      trialEnd ? 0 : finalAmount,
      trialEnd ? 0 : finalAmount,
      row.currency,
      JSON.stringify({
        provider: "mock",
        checkoutSessionId
      })
    ]
  );

  const promoCode =
    typeof row.metadata?.promoCode === "string" ? row.metadata.promoCode : null;
  if (promoCode) {
    await recordPromotionRedemptionByCode({
      code: promoCode,
      checkoutSessionId,
      subscriptionId: row.id,
      organizationId: context.organizationId,
      userId: context.userId
    });
  }

  await insertSubscriptionEvent({
    subscriptionId: row.id,
    eventType: "mock.checkout.completed",
    payload: {
      checkoutSessionId,
      status
    }
  });

  await appendBillingAudit({
    action: "billing.subscription.updated",
    targetType: "subscription",
    targetId: row.id,
    details: {
      provider: "mock",
      checkoutSessionId,
      status
    }
  });

  return getBillingSnapshot(userId);
}

export async function processBillingWebhook(input: {
  rawBody?: Buffer;
  signatureHeader?: string;
  payload?: unknown;
}): Promise<{ ok: true; duplicate?: boolean; status?: "processed" | "ignored" }> {
  await ensureCatalogSeeded();

  const rawBody = input.rawBody;
  const signatureHeader = input.signatureHeader;
  const payload =
    input.payload && typeof input.payload === "object"
      ? (input.payload as Record<string, unknown>)
      : null;

  if (!rawBody || !signatureHeader) {
    throw new BillingError(400, "Missing Stripe webhook payload/signature");
  }

  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new BillingError(500, "Missing STRIPE_WEBHOOK_SECRET");
  }

  const signatureVerified = verifyStripeSignature({
    rawBody,
    signatureHeader,
    secret: env.STRIPE_WEBHOOK_SECRET
  });
  if (!signatureVerified) {
    throw new BillingError(401, "Invalid Stripe webhook signature");
  }

  const event = payload as unknown as StripeEvent;
  if (!event?.id || !event.type) {
    throw new BillingError(400, "Invalid Stripe event payload");
  }

  const inserted = await query(
    `INSERT INTO webhook_event_log(
       provider,
       event_id,
       event_type,
       signature_verified,
       status,
       payload
     )
     VALUES ('stripe', $1, $2, true, 'received', $3::jsonb)
     ON CONFLICT (provider, event_id) DO UPDATE
     SET event_type = EXCLUDED.event_type,
         signature_verified = EXCLUDED.signature_verified,
         payload = EXCLUDED.payload,
         status = 'received',
         error = NULL,
         processed_at = NULL
     WHERE webhook_event_log.status = 'error'
     RETURNING status`,
    [event.id, event.type, JSON.stringify(payload ?? {})]
  );
  if (!inserted.rowCount) {
    return { ok: true, duplicate: true };
  }

  try {
    const object = (event.data?.object ?? {}) as Record<string, unknown>;

    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      await upsertStripeSubscription(object, event.id);
      await markWebhookLogStatus({
        provider: "stripe",
        eventId: event.id,
        status: "processed"
      });
      return { ok: true, status: "processed" };
    }

    if (event.type === "checkout.session.completed") {
      await upsertStripeCheckoutSession(object, event.id);
      await markWebhookLogStatus({
        provider: "stripe",
        eventId: event.id,
        status: "processed"
      });
      return { ok: true, status: "processed" };
    }

    if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
      await upsertStripeInvoice(object, event.id, event.type);
      await markWebhookLogStatus({
        provider: "stripe",
        eventId: event.id,
        status: "processed"
      });
      return { ok: true, status: "processed" };
    }

    await markWebhookLogStatus({
      provider: "stripe",
      eventId: event.id,
      status: "ignored"
    });
    return { ok: true, status: "ignored" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await markWebhookLogStatus({
      provider: "stripe",
      eventId: event.id,
      status: "error",
      error: message
    });
    throw error;
  }
}

export { BillingError };
