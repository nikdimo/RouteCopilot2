import { env } from "../config/env.js";
import { query } from "../db/pool.js";
import {
  getTierEntitlements,
  sanitizeSubscriptionTier,
  type SubscriptionTier,
  type TierEntitlements
} from "./subscriptionTierService.js";

type FeatureAccessRow = {
  id: string;
  subscription_tier: string | null;
  subscription_plan_code: string | null;
  subscription_status: string | null;
  subscription_current_period_end: string | null;
  app_trial_started_at: string | null;
  app_trial_ends_at: string | null;
  app_trial_plan_code: string | null;
  use_advanced_geocoding: boolean | null;
  use_traffic_routing: boolean | null;
  updated_at: string | null;
};

export type UserFeaturePreferences = {
  useAdvancedGeocoding: boolean;
  useTrafficRouting: boolean;
  updatedAt: string | null;
};

export type EffectiveFeatureFlags = {
  advancedGeocodingEnabled: boolean;
  trafficRoutingEnabled: boolean;
};

export type FeatureAccessSource =
  | "free"
  | "subscription"
  | "override"
  | "trial"
  | "signed_in";

export type UserFeatureAccessState = {
  source: FeatureAccessSource;
  canEditSettings: boolean;
  lockReason: "requires_active_plan_or_trial" | null;
  subscriptionStatus: string | null;
  subscriptionCurrentPeriodEnd: string | null;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  trialPlanCode: SubscriptionTier | null;
};

export type UserFeatureAccess = {
  subscriptionTier: SubscriptionTier;
  entitlements: TierEntitlements;
  preferences: UserFeaturePreferences;
  effective: EffectiveFeatureFlags;
  access: UserFeatureAccessState;
  upgradeUrl: string;
};

export class FeatureNotIncludedError extends Error {
  readonly featureKey: string;
  readonly minimumTier: SubscriptionTier;
  readonly upgradeUrl: string;

  constructor(message: string, input: { featureKey: string; minimumTier: SubscriptionTier }) {
    super(message);
    this.name = "FeatureNotIncludedError";
    this.featureKey = input.featureKey;
    this.minimumTier = input.minimumTier;
    this.upgradeUrl = buildFeatureUpgradeUrl(input.featureKey);
  }
}

export class SettingsAccessLockedError extends Error {
  readonly lockReason: "requires_active_plan_or_trial";
  readonly upgradeUrl: string;

  constructor(message: string) {
    super(message);
    this.name = "SettingsAccessLockedError";
    this.lockReason = "requires_active_plan_or_trial";
    this.upgradeUrl = buildFeatureUpgradeUrl("profile.settings");
  }
}

function buildFeatureUpgradeUrl(featureKey: string) {
  try {
    const url = new URL(env.BILLING_UPGRADE_URL);
    url.searchParams.set("source", "app");
    url.searchParams.set("feature", featureKey);
    return url.toString();
  } catch {
    return env.BILLING_UPGRADE_URL;
  }
}

function statusGrantsPaidAccess(status: string, currentPeriodEnd: string | null) {
  if (status === "trialing" || status === "active" || status === "past_due") {
    return true;
  }
  if (status !== "canceled") return false;
  if (!currentPeriodEnd) return false;
  return new Date(currentPeriodEnd).getTime() > Date.now();
}

function toOptionalTier(value: string | null): SubscriptionTier | null {
  if (!value) return null;
  if (value === "free" || value === "basic" || value === "pro" || value === "premium") {
    return value;
  }
  return null;
}

function trialGrantsPaidAccess(planCode: SubscriptionTier | null, trialEndsAt: string | null) {
  if (!planCode || planCode === "free" || !trialEndsAt) return false;
  return new Date(trialEndsAt).getTime() > Date.now();
}

function resolveEffectiveTier(row: FeatureAccessRow): {
  tier: SubscriptionTier;
  source: FeatureAccessSource;
} {
  if (row.subscription_tier) {
    return {
      tier: sanitizeSubscriptionTier(row.subscription_tier),
      source: "override"
    };
  }

  const plan = toOptionalTier(row.subscription_plan_code);
  const status = row.subscription_status;
  if (plan && status && statusGrantsPaidAccess(status, row.subscription_current_period_end)) {
    return {
      tier: plan,
      source: "subscription"
    };
  }

  const trialPlanCode = toOptionalTier(row.app_trial_plan_code);
  if (trialGrantsPaidAccess(trialPlanCode, row.app_trial_ends_at)) {
    return {
      tier: trialPlanCode!,
      source: "trial"
    };
  }

  return {
    tier: "basic",
    source: "signed_in"
  };
}

function buildFeatureAccessFromRow(row: FeatureAccessRow): UserFeatureAccess {
  const resolved = resolveEffectiveTier(row);
  const subscriptionTier = resolved.tier;
  const entitlements = getTierEntitlements(subscriptionTier);
  const defaultAdvancedGeocodingPreference = entitlements.canUseBetterGeocoding;
  const forceAdvancedGeocodingForSignedInBasic =
    resolved.source === "signed_in" && entitlements.canUseBetterGeocoding;

  const preferences: UserFeaturePreferences = {
    useAdvancedGeocoding: forceAdvancedGeocodingForSignedInBasic
      ? true
      :
      row.use_advanced_geocoding == null
        ? defaultAdvancedGeocodingPreference
        : Boolean(row.use_advanced_geocoding),
    useTrafficRouting: Boolean(row.use_traffic_routing),
    updatedAt: row.updated_at
  };

  return {
    subscriptionTier,
    entitlements,
    preferences,
    effective: {
      advancedGeocodingEnabled:
        entitlements.canUseBetterGeocoding && preferences.useAdvancedGeocoding,
      trafficRoutingEnabled:
        entitlements.canUseTrafficAwareRouting && preferences.useTrafficRouting
    },
    access: {
      source: resolved.source,
      canEditSettings: subscriptionTier !== "free",
      lockReason: subscriptionTier === "free" ? "requires_active_plan_or_trial" : null,
      subscriptionStatus: row.subscription_status,
      subscriptionCurrentPeriodEnd: row.subscription_current_period_end,
      trialStartedAt: row.app_trial_started_at,
      trialEndsAt: row.app_trial_ends_at,
      trialPlanCode: toOptionalTier(row.app_trial_plan_code)
    },
    upgradeUrl: env.BILLING_UPGRADE_URL
  };
}

async function getFeatureAccessRow(userId: string) {
  const found = await query<FeatureAccessRow>(
    `SELECT
       u.id,
       t.subscription_tier,
       s.plan_code AS subscription_plan_code,
       s.status AS subscription_status,
       s.current_period_end AS subscription_current_period_end,
       u.app_trial_started_at,
       u.app_trial_ends_at,
       u.app_trial_plan_code,
       COALESCE(ps.use_advanced_geocoding, p.use_advanced_geocoding) AS use_advanced_geocoding,
       COALESCE(ps.use_traffic_routing, p.use_traffic_routing) AS use_traffic_routing,
       COALESCE(ps.updated_at, p.updated_at) AS updated_at
     FROM users u
     LEFT JOIN user_tier_overrides t ON t.user_id = u.id
     LEFT JOIN LATERAL (
       SELECT
         s.plan_code,
         s.status,
         s.current_period_end
       FROM subscriptions s
       WHERE s.user_id = u.id
          OR (u.organization_id IS NOT NULL AND s.organization_id = u.organization_id)
       ORDER BY
         CASE
           WHEN s.status IN ('trialing', 'active', 'past_due') THEN 0
           WHEN s.status = 'canceled' AND s.current_period_end > now() THEN 1
           ELSE 2
         END,
         s.updated_at DESC
       LIMIT 1
     ) s ON TRUE
     LEFT JOIN user_feature_preferences p ON p.user_id = u.id
     LEFT JOIN user_profile_settings ps ON ps.user_id = u.id
     WHERE u.id = $1
     LIMIT 1`,
    [userId]
  );
  return found.rows[0] ?? null;
}

export async function getUserFeatureAccess(userId: string): Promise<UserFeatureAccess> {
  const row = await getFeatureAccessRow(userId);
  if (!row) {
    throw new Error("User not found");
  }
  return buildFeatureAccessFromRow(row);
}

type UpdateFeaturePreferencesInput = {
  useAdvancedGeocoding?: boolean;
  useTrafficRouting?: boolean;
};

export async function updateUserFeaturePreferences(
  userId: string,
  patch: UpdateFeaturePreferencesInput
): Promise<UserFeatureAccess> {
  const current = await getUserFeatureAccess(userId);
  if (!current.access.canEditSettings) {
    throw new SettingsAccessLockedError(
      "Profile settings are locked. Start or reactivate a paid plan to edit settings."
    );
  }

  const nextPreferences: UserFeaturePreferences = {
    useAdvancedGeocoding:
      patch.useAdvancedGeocoding ?? current.preferences.useAdvancedGeocoding,
    useTrafficRouting: patch.useTrafficRouting ?? current.preferences.useTrafficRouting,
    updatedAt: current.preferences.updatedAt
  };

  if (patch.useAdvancedGeocoding === true && !current.entitlements.canUseBetterGeocoding) {
    throw new FeatureNotIncludedError(
      "Advanced geocoding is not included in the current subscription tier",
      {
        featureKey: "geocode.provider.premium",
        minimumTier: "basic"
      }
    );
  }

  if (patch.useTrafficRouting === true && !current.entitlements.canUseTrafficAwareRouting) {
    throw new FeatureNotIncludedError(
      "Traffic-aware routing is not included in the current subscription tier",
      {
        featureKey: "routing.traffic.enabled",
        minimumTier: "pro"
      }
    );
  }

  await query(
    `INSERT INTO user_feature_preferences(user_id, use_advanced_geocoding, use_traffic_routing)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE
       SET use_advanced_geocoding = EXCLUDED.use_advanced_geocoding,
           use_traffic_routing = EXCLUDED.use_traffic_routing,
           updated_at = now()`,
    [userId, nextPreferences.useAdvancedGeocoding, nextPreferences.useTrafficRouting]
  );
  await query(
    `INSERT INTO user_profile_settings(
       user_id,
       use_advanced_geocoding,
       use_traffic_routing,
       updated_by_source
     )
     VALUES ($1, $2, $3, 'app')
     ON CONFLICT (user_id) DO UPDATE
       SET use_advanced_geocoding = EXCLUDED.use_advanced_geocoding,
           use_traffic_routing = EXCLUDED.use_traffic_routing,
           updated_by_source = EXCLUDED.updated_by_source,
           updated_at = now()`,
    [userId, nextPreferences.useAdvancedGeocoding, nextPreferences.useTrafficRouting]
  );

  return getUserFeatureAccess(userId);
}
