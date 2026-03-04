import type { SubscriptionTier, UserPreferences } from '../types';

export const SUBSCRIPTION_TIERS: readonly SubscriptionTier[] = [
  'free',
  'basic',
  'pro',
  'premium',
];

const TIER_RANK: Record<SubscriptionTier, number> = {
  free: 0,
  basic: 1,
  pro: 2,
  premium: 3,
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
  if (value === 'free' || value === 'basic' || value === 'pro' || value === 'premium') {
    return value;
  }
  return 'free';
}

export function getSubscriptionTier(preferences: Partial<UserPreferences> | null | undefined): SubscriptionTier {
  return sanitizeSubscriptionTier(preferences?.subscriptionTier);
}

export function getEffectiveSubscriptionTier(
  preferences: Partial<UserPreferences> | null | undefined,
  isAuthenticated: boolean
): SubscriptionTier {
  const tier = getSubscriptionTier(preferences);
  return isAuthenticated ? tier : 'free';
}

export function isTierAtLeast(current: SubscriptionTier, minimum: SubscriptionTier): boolean {
  return TIER_RANK[current] >= TIER_RANK[minimum];
}

export function getTierEntitlements(tier: SubscriptionTier): TierEntitlements {
  return {
    canSyncCalendar: isTierAtLeast(tier, 'basic'),
    canCreateContacts: isTierAtLeast(tier, 'basic'),
    canUseBetterGeocoding: isTierAtLeast(tier, 'basic'),
    canUseTrafficAwareRouting: isTierAtLeast(tier, 'pro'),
    canOptimizeRoute: isTierAtLeast(tier, 'pro'),
    canUseClientNotifications: isTierAtLeast(tier, 'premium'),
  };
}
