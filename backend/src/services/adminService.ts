import type { QueryResultRow } from "pg";
import { query } from "../db/pool.js";
import type { AdminRole } from "../middleware/types.js";
import {
  getTierEntitlements,
  sanitizeSubscriptionTier
} from "./subscriptionTierService.js";

type ListOptions = {
  search?: string;
  limit: number;
};

type DayStateOptions = ListOptions & {
  dayKey?: string;
};

function normalizeSearch(search?: string) {
  const value = search?.trim();
  if (!value) return null;
  return `%${value}%`;
}

export async function insertAdminAudit(input: {
  adminUserId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
}) {
  await query(
    `INSERT INTO admin_audit_log(admin_user_id, action, target_type, target_id, details)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      input.adminUserId,
      input.action,
      input.targetType ?? null,
      input.targetId ?? null,
      JSON.stringify(input.details ?? {})
    ]
  );
}

type MeRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  tenant_id: string;
};

export async function getAdminMe(userId: string) {
  const found = await query<MeRow>(
    `SELECT id, email, display_name, tenant_id
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId]
  );
  return found.rows[0] ?? null;
}

type AdminAllowlistRow = {
  user_id: string;
  role: AdminRole;
  created_at: string;
  email: string | null;
  display_name: string | null;
};

export async function listAdminAllowlist() {
  const found = await query<AdminAllowlistRow>(
    `SELECT a.user_id, a.role, a.created_at, u.email, u.display_name
     FROM admin_allowlist a
     LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.created_at DESC`
  );
  return found.rows.map((row) => ({
    userId: row.user_id,
    role: row.role,
    createdAt: row.created_at,
    email: row.email,
    displayName: row.display_name
  }));
}

type AdminAllowlistUpsertRow = {
  user_id: string;
  role: AdminRole;
  created_at: string;
};

export async function upsertAdminAllowlist(input: {
  userId: string;
  role: AdminRole;
}) {
  const updated = await query<AdminAllowlistUpsertRow>(
    `INSERT INTO admin_allowlist(user_id, role)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE
       SET role = EXCLUDED.role
     RETURNING user_id, role, created_at`,
    [input.userId, input.role]
  );
  const row = updated.rows[0];
  return {
    userId: row.user_id,
    role: row.role,
    createdAt: row.created_at
  };
}

export async function removeAdminAllowlist(userId: string) {
  const deleted = await query(
    `DELETE FROM admin_allowlist
     WHERE user_id = $1`,
    [userId]
  );
  return (deleted.rowCount ?? 0) > 0;
}

type UserRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  aad_oid: string;
  tenant_id: string;
  created_at: string;
  last_seen_at: string;
  organization_name: string | null;
  tier_override: string | null;
  subscription_plan_code: string | null;
  subscription_status: string | null;
  subscription_current_period_end: string | null;
  app_trial_plan_code: string | null;
  app_trial_started_at: string | null;
  app_trial_ends_at: string | null;
  use_advanced_geocoding: boolean | null;
  use_traffic_routing: boolean | null;
  calendar_connected: boolean | null;
  calendar_provider: string | null;
  settings_updated_at: string | null;
};

function statusGrantsPaidAccess(status: string, currentPeriodEnd: string | null) {
  if (status === "trialing" || status === "active" || status === "past_due") {
    return true;
  }
  if (status !== "canceled") return false;
  if (!currentPeriodEnd) return false;
  return new Date(currentPeriodEnd).getTime() > Date.now();
}

function trialGrantsPaidAccess(planCode: string | null, trialEndsAt: string | null) {
  if (!planCode || planCode === "free" || !trialEndsAt) return false;
  return new Date(trialEndsAt).getTime() > Date.now();
}

function resolveEffectiveTier(input: {
  overrideTier: string | null;
  subscriptionPlanCode: string | null;
  subscriptionStatus: string | null;
  subscriptionCurrentPeriodEnd: string | null;
  trialPlanCode: string | null;
  trialEndsAt: string | null;
}) {
  if (input.overrideTier) {
    return {
      tier: sanitizeSubscriptionTier(input.overrideTier),
      source: "override" as const
    };
  }

  if (
    input.subscriptionPlanCode &&
    input.subscriptionStatus &&
    statusGrantsPaidAccess(input.subscriptionStatus, input.subscriptionCurrentPeriodEnd)
  ) {
    return {
      tier: sanitizeSubscriptionTier(input.subscriptionPlanCode),
      source: "subscription" as const
    };
  }

  if (trialGrantsPaidAccess(input.trialPlanCode, input.trialEndsAt)) {
    return {
      tier: sanitizeSubscriptionTier(input.trialPlanCode),
      source: "trial" as const
    };
  }

  return {
    tier: "basic" as const,
    source: "signed_in" as const
  };
}

export async function listUsers(options: ListOptions) {
  const searchPattern = normalizeSearch(options.search);
  const found = await query<UserRow>(
    `SELECT
       u.id,
       u.email,
       u.display_name,
       u.aad_oid,
       u.tenant_id,
       u.created_at,
       u.last_seen_at,
       o.name AS organization_name,
       t.subscription_tier AS tier_override,
       s.plan_code AS subscription_plan_code,
       s.status AS subscription_status,
       s.current_period_end AS subscription_current_period_end,
       u.app_trial_plan_code,
       u.app_trial_started_at,
       u.app_trial_ends_at,
       COALESCE(ps.use_advanced_geocoding, p.use_advanced_geocoding) AS use_advanced_geocoding,
       COALESCE(ps.use_traffic_routing, p.use_traffic_routing) AS use_traffic_routing,
       ps.calendar_connected,
       ps.calendar_provider,
       ps.updated_at AS settings_updated_at
     FROM users u
     LEFT JOIN organizations o ON o.id = u.organization_id
     LEFT JOIN user_tier_overrides t ON t.user_id = u.id
     LEFT JOIN user_feature_preferences p ON p.user_id = u.id
     LEFT JOIN user_profile_settings ps ON ps.user_id = u.id
     LEFT JOIN LATERAL (
       SELECT plan_code, status, current_period_end
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
     WHERE (
       $1::text IS NULL
       OR u.email ILIKE $1
       OR u.display_name ILIKE $1
       OR u.aad_oid ILIKE $1
     )
     ORDER BY u.created_at DESC
     LIMIT $2`,
    [searchPattern, options.limit]
  );

  return found.rows.map((row) => {
    const resolved = resolveEffectiveTier({
      overrideTier: row.tier_override,
      subscriptionPlanCode: row.subscription_plan_code,
      subscriptionStatus: row.subscription_status,
      subscriptionCurrentPeriodEnd: row.subscription_current_period_end,
      trialPlanCode: row.app_trial_plan_code,
      trialEndsAt: row.app_trial_ends_at
    });
    const effectiveTier = resolved.tier;
    const entitlements = getTierEntitlements(effectiveTier);
    const featurePreferences = {
      useAdvancedGeocoding: Boolean(row.use_advanced_geocoding),
      useTrafficRouting: Boolean(row.use_traffic_routing)
    };

    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      aadOid: row.aad_oid,
      tenantId: row.tenant_id,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      organizationName: row.organization_name,
      tierOverride: row.tier_override,
      effectiveTier,
      effectiveTierSource: resolved.source,
      entitlements,
      access: {
        canEditSettings: resolved.tier !== "free",
        subscriptionStatus: row.subscription_status,
        subscriptionPlanCode: row.subscription_plan_code,
        subscriptionCurrentPeriodEnd: row.subscription_current_period_end,
        trialPlanCode: row.app_trial_plan_code,
        trialStartedAt: row.app_trial_started_at,
        trialEndsAt: row.app_trial_ends_at
      },
      featurePreferences,
      activeFeatures: {
        advancedGeocodingEnabled:
          entitlements.canUseBetterGeocoding && featurePreferences.useAdvancedGeocoding,
        trafficRoutingEnabled:
          entitlements.canUseTrafficAwareRouting && featurePreferences.useTrafficRouting
      },
      profileSettings: {
        calendarConnected: Boolean(row.calendar_connected),
        calendarProvider: row.calendar_provider,
        updatedAt: row.settings_updated_at
      }
    };
  });
}

type OrganizationRow = {
  id: string;
  slug: string;
  name: string;
  created_at: string;
  user_count: string;
};

export async function listOrganizations(options: ListOptions) {
  const searchPattern = normalizeSearch(options.search);
  const found = await query<OrganizationRow>(
    `SELECT
       o.id,
       o.slug,
       o.name,
       o.created_at,
       COUNT(u.id)::text AS user_count
     FROM organizations o
     LEFT JOIN users u ON u.organization_id = o.id
     WHERE (
       $1::text IS NULL
       OR o.name ILIKE $1
       OR o.slug ILIKE $1
     )
     GROUP BY o.id
     ORDER BY o.created_at DESC
     LIMIT $2`,
    [searchPattern, options.limit]
  );

  return found.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    createdAt: row.created_at,
    userCount: Number(row.user_count) || 0
  }));
}

type TierOverrideRow = {
  user_id: string;
  subscription_tier: string;
  reason: string | null;
  updated_at: string;
  updated_by_admin_user_id: string | null;
  email: string | null;
  display_name: string | null;
};

export async function listTierOverrides(options: ListOptions) {
  const searchPattern = normalizeSearch(options.search);
  const found = await query<TierOverrideRow>(
    `SELECT
       t.user_id,
       t.subscription_tier,
       t.reason,
       t.updated_at,
       t.updated_by_admin_user_id,
       u.email,
       u.display_name
     FROM user_tier_overrides t
     LEFT JOIN users u ON u.id = t.user_id
     WHERE (
       $1::text IS NULL
       OR u.email ILIKE $1
       OR u.display_name ILIKE $1
     )
     ORDER BY t.updated_at DESC
     LIMIT $2`,
    [searchPattern, options.limit]
  );

  return found.rows.map((row) => ({
    userId: row.user_id,
    subscriptionTier: row.subscription_tier,
    reason: row.reason,
    updatedAt: row.updated_at,
    updatedByAdminUserId: row.updated_by_admin_user_id,
    email: row.email,
    displayName: row.display_name
  }));
}

type TierOverrideUpsertRow = {
  user_id: string;
  subscription_tier: string;
  reason: string | null;
  updated_at: string;
  updated_by_admin_user_id: string | null;
};

export async function upsertTierOverride(input: {
  userId: string;
  subscriptionTier: "free" | "basic" | "pro" | "premium";
  reason?: string;
  adminUserId: string;
}) {
  const updated = await query<TierOverrideUpsertRow>(
    `INSERT INTO user_tier_overrides(user_id, subscription_tier, reason, updated_by_admin_user_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE
       SET subscription_tier = EXCLUDED.subscription_tier,
           reason = EXCLUDED.reason,
           updated_by_admin_user_id = EXCLUDED.updated_by_admin_user_id,
           updated_at = now()
     RETURNING user_id, subscription_tier, reason, updated_at, updated_by_admin_user_id`,
    [input.userId, input.subscriptionTier, input.reason ?? null, input.adminUserId]
  );

  const row = updated.rows[0];
  return {
    userId: row.user_id,
    subscriptionTier: row.subscription_tier,
    reason: row.reason,
    updatedAt: row.updated_at,
    updatedByAdminUserId: row.updated_by_admin_user_id
  };
}

export async function removeTierOverride(userId: string) {
  const deleted = await query(
    `DELETE FROM user_tier_overrides
     WHERE user_id = $1`,
    [userId]
  );
  return (deleted.rowCount ?? 0) > 0;
}

type UserStateRow = {
  user_id: string;
  day_key: string;
  completed_count: string;
  order_count: string;
  updated_at: string;
  email: string | null;
  display_name: string | null;
};

export async function listUserState(options: DayStateOptions) {
  const searchPattern = normalizeSearch(options.search);
  const found = await query<UserStateRow>(
    `SELECT
       s.user_id,
       s.day_key::text AS day_key,
       jsonb_array_length(s.completed_event_ids)::text AS completed_count,
       jsonb_array_length(s.day_order)::text AS order_count,
       s.updated_at,
       u.email,
       u.display_name
     FROM user_app_state_daily s
     LEFT JOIN users u ON u.id = s.user_id
     WHERE (
       $1::date IS NULL
       OR s.day_key = $1::date
     )
     AND (
       $2::text IS NULL
       OR u.email ILIKE $2
       OR u.display_name ILIKE $2
     )
     ORDER BY s.updated_at DESC
     LIMIT $3`,
    [options.dayKey ?? null, searchPattern, options.limit]
  );

  return found.rows.map((row) => ({
    userId: row.user_id,
    dayKey: row.day_key,
    completedCount: Number(row.completed_count) || 0,
    orderCount: Number(row.order_count) || 0,
    updatedAt: row.updated_at,
    email: row.email,
    displayName: row.display_name
  }));
}

type AuditRow = QueryResultRow & {
  id: number;
  admin_user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
  admin_email: string | null;
  admin_display_name: string | null;
};

export async function listAdminAudit(limit: number) {
  const found = await query<AuditRow>(
    `SELECT
       a.id,
       a.admin_user_id,
       a.action,
       a.target_type,
       a.target_id,
       a.details,
       a.created_at,
       u.email AS admin_email,
       u.display_name AS admin_display_name
     FROM admin_audit_log a
     LEFT JOIN users u ON u.id = a.admin_user_id
     ORDER BY a.created_at DESC
     LIMIT $1`,
    [limit]
  );

  return found.rows.map((row) => ({
    id: row.id,
    adminUserId: row.admin_user_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    details: row.details ?? {},
    createdAt: row.created_at,
    adminEmail: row.admin_email,
    adminDisplayName: row.admin_display_name
  }));
}
