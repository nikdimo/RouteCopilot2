export type SubscriptionTier = "free" | "basic" | "pro" | "premium";

const TIER_ORDER: Record<SubscriptionTier, number> = {
  free: 0,
  basic: 1,
  pro: 2,
  premium: 3
};

export type TierEntitlements = {
  canSyncCalendar: boolean;
  canCreateContacts: boolean;
  canUseBetterGeocoding: boolean;
  canUseTrafficAwareRouting: boolean;
  canOptimizeRoute: boolean;
  canUseClientNotifications: boolean;
};

export function sanitizeSubscriptionTier(value: unknown): SubscriptionTier {
  if (value === "free" || value === "basic" || value === "pro" || value === "premium") {
    return value;
  }
  return "free";
}

function isTierAtLeast(current: SubscriptionTier, minimum: SubscriptionTier) {
  return TIER_ORDER[current] >= TIER_ORDER[minimum];
}

export function getTierEntitlements(tier: SubscriptionTier): TierEntitlements {
  return {
    canSyncCalendar: isTierAtLeast(tier, "basic"),
    canCreateContacts: isTierAtLeast(tier, "basic"),
    canUseBetterGeocoding: isTierAtLeast(tier, "basic"),
    canUseTrafficAwareRouting: isTierAtLeast(tier, "pro"),
    canOptimizeRoute: isTierAtLeast(tier, "pro"),
    canUseClientNotifications: isTierAtLeast(tier, "premium")
  };
}
