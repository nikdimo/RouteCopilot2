import type { SubscriptionTier } from '../types';

export type PlanCatalogEntry = {
  label: string;
  monthlyUsd: number;
  annualMonthlyUsd: number;
  trialDays: number;
  limits: {
    calendars: number | 'unlimited';
    trafficRouteLookupsPerMonth: number;
    aiDraftsPerMonth: number;
    smsIncludedPerMonth: number;
    emailIncludedPerMonth: number;
  };
  overage?: {
    smsUsdPerMessage: number;
    emailUsdPerMessage: number;
  };
};

// Product-level defaults for launch. Billing backend should eventually own this catalog.
export const PLAN_CATALOG: Record<SubscriptionTier, PlanCatalogEntry> = {
  free: {
    label: 'Free',
    monthlyUsd: 0,
    annualMonthlyUsd: 0,
    trialDays: 0,
    limits: {
      calendars: 0,
      trafficRouteLookupsPerMonth: 0,
      aiDraftsPerMonth: 0,
      smsIncludedPerMonth: 0,
      emailIncludedPerMonth: 0,
    },
  },
  basic: {
    label: 'Basic',
    monthlyUsd: 12,
    annualMonthlyUsd: 10,
    trialDays: 14,
    limits: {
      calendars: 1,
      trafficRouteLookupsPerMonth: 0,
      aiDraftsPerMonth: 0,
      smsIncludedPerMonth: 0,
      emailIncludedPerMonth: 0,
    },
  },
  pro: {
    label: 'Pro',
    monthlyUsd: 29,
    annualMonthlyUsd: 24,
    trialDays: 14,
    limits: {
      calendars: 'unlimited',
      trafficRouteLookupsPerMonth: 3000,
      aiDraftsPerMonth: 0,
      smsIncludedPerMonth: 0,
      emailIncludedPerMonth: 0,
    },
  },
  premium: {
    label: 'Premium',
    monthlyUsd: 59,
    annualMonthlyUsd: 49,
    trialDays: 14,
    limits: {
      calendars: 'unlimited',
      trafficRouteLookupsPerMonth: 10000,
      aiDraftsPerMonth: 500,
      smsIncludedPerMonth: 100,
      emailIncludedPerMonth: 2000,
    },
    overage: {
      smsUsdPerMessage: 0.05,
      emailUsdPerMessage: 0.002,
    },
  },
};

