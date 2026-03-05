import { BACKEND_API_BASE_URL, BACKEND_API_ENABLED } from '../config/backend';

export type BackendGeocodeResponse = {
  source: 'cache' | 'live';
  normalizedQuery: string;
  lat: number;
  lon: number;
  provider: string;
  advancedGeocodingEnabled?: boolean;
};

export type BackendAddressSuggestResponse = {
  suggestions: Array<{
    displayName: string;
    lat?: number;
    lon?: number;
    placeId?: string;
  }>;
  source: 'google_places' | 'nominatim';
  advancedGeocodingEnabled?: boolean;
};

export type BackendRouteResponse = {
  source: 'cache' | 'live';
  routeKey: string;
  profile: string;
  provider?: string;
  trafficAware?: boolean;
  coordinates: Array<[number, number]>;
  distanceM: number;
  durationS: number;
  legs: Array<{ distanceM: number; durationS: number }>;
};

export type BackendUserStateResponse = {
  dayKey: string;
  completedEventIds: string[];
  dayOrder: string[];
  updatedAt: string | null;
};

export type BackendFeatureAccessResponse = {
  subscriptionTier: 'free' | 'basic' | 'pro' | 'premium';
  entitlements: {
    canSyncCalendar: boolean;
    canCreateContacts: boolean;
    canUseBetterGeocoding: boolean;
    canUseTrafficAwareRouting: boolean;
    canOptimizeRoute: boolean;
    canUseClientNotifications: boolean;
  };
  preferences: {
    useAdvancedGeocoding: boolean;
    useTrafficRouting: boolean;
    updatedAt: string | null;
  };
  effective: {
    advancedGeocodingEnabled: boolean;
    trafficRoutingEnabled: boolean;
  };
  access?: {
    source: 'free' | 'subscription' | 'override' | 'trial' | 'signed_in';
    canEditSettings: boolean;
    lockReason: 'requires_active_plan_or_trial' | null;
    subscriptionStatus: string | null;
    subscriptionCurrentPeriodEnd: string | null;
    trialStartedAt: string | null;
    trialEndsAt: string | null;
    trialPlanCode: 'free' | 'basic' | 'pro' | 'premium' | null;
  };
  upgradeUrl: string;
};

export type BackendFeatureAccessResult =
  | { ok: true; data: BackendFeatureAccessResponse }
  | {
      ok: false;
      status: number;
      error: string;
      featureKey?: string;
      minimumTier?: string;
      upgradeUrl?: string;
    };

export type BackendBillingSnapshot = {
  currentPlan: 'free' | 'basic' | 'pro' | 'premium';
  canManageBilling: boolean;
  statusBanner: string;
  renewalAt: string | null;
  accessEndsAt: string | null;
  subscription: {
    status: string;
    billingInterval: 'monthly' | 'annual';
    currentPeriodEnd: string | null;
  } | null;
};

export type BackendBillingPortalResult =
  | {
      ok: true;
      portalUrl: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

export type BackendDeleteAccountResult =
  | {
      ok: true;
      deletedUserId: string;
      deletedEmail: string | null;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

export type BackendProfileSettingsResponse = {
  settings: {
    workingHours: {
      start: string;
      end: string;
    };
    preMeetingBuffer: number;
    postMeetingBuffer: number;
    homeBase: {
      lat: number;
      lon: number;
    };
    homeBaseLabel: string;
    workingDays: [boolean, boolean, boolean, boolean, boolean, boolean, boolean];
    distanceThresholdKm: number;
    alwaysStartFromHomeBase: boolean;
    useGoogleGeocoding: boolean;
    useTrafficAwareRouting: boolean;
    googleMapsApiKey: string | null;
    calendarConnected: boolean;
    calendarProvider: 'outlook' | null;
    lastCalendarSyncAt: string | null;
    updatedAt: string | null;
  };
  access: {
    subscriptionTier: 'free' | 'basic' | 'pro' | 'premium';
    source: 'free' | 'subscription' | 'override' | 'trial' | 'signed_in';
    canEditSettings: boolean;
    lockReason: 'requires_active_plan_or_trial' | null;
    subscriptionStatus: string | null;
    subscriptionCurrentPeriodEnd: string | null;
    trialStartedAt: string | null;
    trialEndsAt: string | null;
    trialPlanCode: 'free' | 'basic' | 'pro' | 'premium' | null;
  };
  entitlements: {
    canSyncCalendar: boolean;
    canCreateContacts: boolean;
    canUseBetterGeocoding: boolean;
    canUseTrafficAwareRouting: boolean;
    canOptimizeRoute: boolean;
    canUseClientNotifications: boolean;
  };
  upgradeUrl: string;
};

export type BackendProfileSettingsPatch = {
  workingHours?: { start?: string; end?: string };
  preMeetingBuffer?: number;
  postMeetingBuffer?: number;
  homeBase?: { lat: number; lon: number } | null;
  homeBaseLabel?: string | null;
  workingDays?: [boolean, boolean, boolean, boolean, boolean, boolean, boolean];
  distanceThresholdKm?: number;
  alwaysStartFromHomeBase?: boolean;
  useGoogleGeocoding?: boolean;
  useTrafficAwareRouting?: boolean;
  googleMapsApiKey?: string | null;
  calendarConnected?: boolean;
  calendarProvider?: 'outlook' | null;
};

export type BackendProfileSettingsUpdateResult =
  | { ok: true; data: BackendProfileSettingsResponse }
  | {
      ok: false;
      status: number;
      error: string;
      featureKey?: string;
      minimumTier?: string;
      upgradeUrl?: string;
      lockReason?: string;
    };

export type BackendUpgradeInterestResult = {
  ok: true;
  emailed: boolean;
  email: string | null;
  requiredPlan: 'basic' | 'pro' | 'premium';
  featureName: string | null;
  featureKey: string | null;
};

type RequestOptions = {
  path: string;
  method: 'GET' | 'POST' | 'PATCH';
  authToken: string;
  body?: unknown;
};

function buildUrl(path: string) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${BACKEND_API_BASE_URL}${normalized}`;
}

async function requestJson<T>(options: RequestOptions): Promise<T | null> {
  if (!BACKEND_API_ENABLED) return null;
  if (!options.authToken) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(buildUrl(options.path), {
      method: options.method,
      headers: {
        Authorization: `Bearer ${options.authToken}`,
        ...(options.body != null ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body != null ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestJsonResult(
  options: RequestOptions
): Promise<BackendFeatureAccessResult | null> {
  if (!BACKEND_API_ENABLED) return null;
  if (!options.authToken) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(buildUrl(options.path), {
      method: options.method,
      headers: {
        Authorization: `Bearer ${options.authToken}`,
        ...(options.body != null ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body != null ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    const payload = await res.json().catch(() => null);
    if (res.ok) {
      return { ok: true, data: payload as BackendFeatureAccessResponse };
    }

    return {
      ok: false,
      status: res.status,
      error: typeof payload?.error === 'string' ? payload.error : `Request failed (${res.status})`,
      featureKey: typeof payload?.featureKey === 'string' ? payload.featureKey : undefined,
      minimumTier: typeof payload?.minimumTier === 'string' ? payload.minimumTier : undefined,
      upgradeUrl: typeof payload?.upgradeUrl === 'string' ? payload.upgradeUrl : undefined,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function backendGeocode(
  input: { address: string; countryCode?: string },
  authToken: string
) {
  return requestJson<BackendGeocodeResponse>({
    path: '/api/geocode',
    method: 'POST',
    authToken,
    body: input,
  });
}

export async function backendAddressSuggest(
  input: { query: string; countryCode?: string },
  authToken: string
) {
  return requestJson<BackendAddressSuggestResponse>({
    path: '/api/geocode/suggest',
    method: 'POST',
    authToken,
    body: input,
  });
}

export async function backendRoute(
  input: { profile: string; waypoints: Array<{ lat: number; lon: number }> },
  authToken: string
) {
  return requestJson<BackendRouteResponse>({
    path: '/api/route',
    method: 'POST',
    authToken,
    body: input,
  });
}

export async function backendGetUserState(dayKey: string, authToken: string) {
  return requestJson<BackendUserStateResponse>({
    path: `/api/user/state?dayKey=${encodeURIComponent(dayKey)}`,
    method: 'GET',
    authToken,
  });
}

export async function backendUpsertUserState(
  input: { dayKey: string; completedEventIds: string[]; dayOrder: string[] },
  authToken: string
) {
  return requestJson<BackendUserStateResponse>({
    path: '/api/user/state',
    method: 'POST',
    authToken,
    body: input,
  });
}

export async function backendGetFeatureAccess(authToken: string) {
  const result = await requestJsonResult({
    path: '/api/me/features',
    method: 'GET',
    authToken,
  });
  if (!result || !result.ok) return null;
  return result.data;
}

export async function backendUpdateFeatureAccess(
  input: { useAdvancedGeocoding?: boolean; useTrafficRouting?: boolean },
  authToken: string
) {
  return requestJsonResult({
    path: '/api/me/features',
    method: 'PATCH',
    authToken,
    body: input,
  });
}

export async function backendGetBillingSnapshot(authToken: string) {
  return requestJson<BackendBillingSnapshot>({
    path: '/api/billing/me',
    method: 'GET',
    authToken,
  });
}

export async function backendCreateBillingPortalSession(
  authToken: string
): Promise<BackendBillingPortalResult | null> {
  if (!BACKEND_API_ENABLED) return null;
  if (!authToken) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(buildUrl('/api/billing/customer-portal-session'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      signal: controller.signal,
    });

    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error:
          typeof payload?.error === 'string' ? payload.error : `Request failed (${res.status})`,
      };
    }

    const portalUrl = typeof payload?.portalUrl === 'string' ? payload.portalUrl : '';
    if (!portalUrl) {
      return {
        ok: false,
        status: 502,
        error: 'Billing portal URL missing from server response',
      };
    }

    return {
      ok: true,
      portalUrl,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function backendDeleteMyAccount(
  authToken: string
): Promise<BackendDeleteAccountResult | null> {
  if (!BACKEND_API_ENABLED) return null;
  if (!authToken) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(buildUrl('/api/me/account'), {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      signal: controller.signal,
    });

    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error:
          typeof payload?.error === 'string' ? payload.error : `Request failed (${res.status})`,
      };
    }

    return {
      ok: true,
      deletedUserId: typeof payload?.deletedUserId === 'string' ? payload.deletedUserId : '',
      deletedEmail: typeof payload?.deletedEmail === 'string' ? payload.deletedEmail : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function backendGetProfileSettings(authToken: string) {
  return requestJson<BackendProfileSettingsResponse>({
    path: '/api/me/profile-settings',
    method: 'GET',
    authToken,
  });
}

export async function backendUpdateProfileSettings(
  input: BackendProfileSettingsPatch,
  authToken: string
): Promise<BackendProfileSettingsUpdateResult | null> {
  if (!BACKEND_API_ENABLED) return null;
  if (!authToken) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(buildUrl('/api/me/profile-settings'), {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
      signal: controller.signal,
    });

    const payload = await res.json().catch(() => null);
    if (res.ok) {
      return { ok: true, data: payload as BackendProfileSettingsResponse };
    }

    return {
      ok: false,
      status: res.status,
      error: typeof payload?.error === 'string' ? payload.error : `Request failed (${res.status})`,
      featureKey: typeof payload?.featureKey === 'string' ? payload.featureKey : undefined,
      minimumTier: typeof payload?.minimumTier === 'string' ? payload.minimumTier : undefined,
      upgradeUrl: typeof payload?.upgradeUrl === 'string' ? payload.upgradeUrl : undefined,
      lockReason: typeof payload?.lockReason === 'string' ? payload.lockReason : undefined,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function backendRequestUpgradeInterest(
  input: { requiredPlan: 'basic' | 'pro' | 'premium'; featureName?: string; featureKey?: string },
  authToken: string
) {
  return requestJson<BackendUpgradeInterestResult>({
    path: '/api/me/upgrade-interest',
    method: 'POST',
    authToken,
    body: input,
  });
}
