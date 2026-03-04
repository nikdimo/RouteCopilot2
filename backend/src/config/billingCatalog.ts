export const ENTITLEMENT_KEYS = [
  "calendar.sync.enabled",
  "calendar.sync.max_calendars",
  "contacts.create.enabled",
  "geocode.provider.premium",
  "routing.traffic.enabled",
  "alerts.running_late.self",
  "routing.optimize.enabled",
  "export.day_plan.enabled",
  "templates.recurring.enabled",
  "assistant.client_notify.enabled",
  "assistant.client_notify.sms",
  "assistant.client_notify.email"
] as const;

export type EntitlementKey = (typeof ENTITLEMENT_KEYS)[number];

export const PLAN_CODES = ["free", "basic", "pro", "premium"] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export const BILLING_INTERVALS = ["monthly", "annual"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired"
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export type PlanLimits = {
  calendars: number | "unlimited";
  trafficRouteLookupsPerMonth: number;
  aiDraftsPerMonth: number;
  smsIncludedPerMonth: number;
  emailIncludedPerMonth: number;
};

export type PlanCatalogItem = {
  code: PlanCode;
  name: string;
  description: string;
  trialDays: number;
  prices: {
    monthly: number;
    annual: number;
  };
  limits: PlanLimits;
  entitlements: Record<EntitlementKey, boolean | number>;
};

export const PLAN_CATALOG: Record<PlanCode, PlanCatalogItem> = {
  free: {
    code: "free",
    name: "Free",
    description: "Plan meetings locally with route view and basic address search.",
    trialDays: 0,
    prices: {
      monthly: 0,
      annual: 0
    },
    limits: {
      calendars: 0,
      trafficRouteLookupsPerMonth: 0,
      aiDraftsPerMonth: 0,
      smsIncludedPerMonth: 0,
      emailIncludedPerMonth: 0
    },
    entitlements: {
      "calendar.sync.enabled": false,
      "calendar.sync.max_calendars": 0,
      "contacts.create.enabled": false,
      "geocode.provider.premium": false,
      "routing.traffic.enabled": false,
      "alerts.running_late.self": false,
      "routing.optimize.enabled": false,
      "export.day_plan.enabled": false,
      "templates.recurring.enabled": false,
      "assistant.client_notify.enabled": false,
      "assistant.client_notify.sms": false,
      "assistant.client_notify.email": false
    }
  },
  basic: {
    code: "basic",
    name: "Basic",
    description: "Sync one calendar and unlock premium geocoding accuracy.",
    trialDays: 14,
    prices: {
      monthly: 12,
      annual: 10
    },
    limits: {
      calendars: 1,
      trafficRouteLookupsPerMonth: 0,
      aiDraftsPerMonth: 0,
      smsIncludedPerMonth: 0,
      emailIncludedPerMonth: 0
    },
    entitlements: {
      "calendar.sync.enabled": true,
      "calendar.sync.max_calendars": 1,
      "contacts.create.enabled": true,
      "geocode.provider.premium": true,
      "routing.traffic.enabled": false,
      "alerts.running_late.self": false,
      "routing.optimize.enabled": false,
      "export.day_plan.enabled": false,
      "templates.recurring.enabled": false,
      "assistant.client_notify.enabled": false,
      "assistant.client_notify.sms": false,
      "assistant.client_notify.email": false
    }
  },
  pro: {
    code: "pro",
    name: "Pro",
    description: "Unlimited calendars, optimization and traffic-aware routing insights.",
    trialDays: 14,
    prices: {
      monthly: 29,
      annual: 24
    },
    limits: {
      calendars: "unlimited",
      trafficRouteLookupsPerMonth: 3000,
      aiDraftsPerMonth: 0,
      smsIncludedPerMonth: 0,
      emailIncludedPerMonth: 0
    },
    entitlements: {
      "calendar.sync.enabled": true,
      "calendar.sync.max_calendars": -1,
      "contacts.create.enabled": true,
      "geocode.provider.premium": true,
      "routing.traffic.enabled": true,
      "alerts.running_late.self": true,
      "routing.optimize.enabled": true,
      "export.day_plan.enabled": true,
      "templates.recurring.enabled": true,
      "assistant.client_notify.enabled": false,
      "assistant.client_notify.sms": false,
      "assistant.client_notify.email": false
    }
  },
  premium: {
    code: "premium",
    name: "Premium",
    description: "Everything in Pro plus client notification assistant (SMS and email).",
    trialDays: 14,
    prices: {
      monthly: 59,
      annual: 49
    },
    limits: {
      calendars: "unlimited",
      trafficRouteLookupsPerMonth: 10000,
      aiDraftsPerMonth: 500,
      smsIncludedPerMonth: 100,
      emailIncludedPerMonth: 2000
    },
    entitlements: {
      "calendar.sync.enabled": true,
      "calendar.sync.max_calendars": -1,
      "contacts.create.enabled": true,
      "geocode.provider.premium": true,
      "routing.traffic.enabled": true,
      "alerts.running_late.self": true,
      "routing.optimize.enabled": true,
      "export.day_plan.enabled": true,
      "templates.recurring.enabled": true,
      "assistant.client_notify.enabled": true,
      "assistant.client_notify.sms": true,
      "assistant.client_notify.email": true
    }
  }
};

export function isPlanCode(value: string): value is PlanCode {
  return (PLAN_CODES as readonly string[]).includes(value);
}

export function isBillingInterval(value: string): value is BillingInterval {
  return (BILLING_INTERVALS as readonly string[]).includes(value);
}

export function isSubscriptionStatus(value: string): value is SubscriptionStatus {
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}
