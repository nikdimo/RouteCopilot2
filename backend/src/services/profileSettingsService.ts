import { query } from "../db/pool.js";
import {
  FeatureNotIncludedError,
  SettingsAccessLockedError,
  getUserFeatureAccess,
  type UserFeatureAccess
} from "./featureAccessService.js";
import type { SubscriptionTier, TierEntitlements } from "./subscriptionTierService.js";

type WorkingDaysTuple = [boolean, boolean, boolean, boolean, boolean, boolean, boolean];

const DEFAULT_WORKING_DAYS: WorkingDaysTuple = [
  false,
  true,
  true,
  true,
  true,
  true,
  false
];

const DEFAULT_PROFILE_SETTINGS = {
  workingHoursStart: "08:00",
  workingHoursEnd: "17:00",
  preMeetingBuffer: 15,
  postMeetingBuffer: 15,
  homeBaseLat: 55.6761,
  homeBaseLon: 12.5683,
  homeBaseLabel: "Copenhagen",
  workingDays: DEFAULT_WORKING_DAYS,
  distanceThresholdKm: 30,
  alwaysStartFromHomeBase: true,
  useGoogleGeocoding: false,
  useTrafficAwareRouting: false,
  googleMapsApiKey: null as string | null,
  calendarConnected: false,
  calendarProvider: null as "outlook" | null
};

type ProfileSettingsRow = {
  user_id: string;
  working_hours_start: string | null;
  working_hours_end: string | null;
  pre_meeting_buffer_minutes: number | null;
  post_meeting_buffer_minutes: number | null;
  home_base_lat: number | null;
  home_base_lon: number | null;
  home_base_label: string | null;
  working_days: unknown;
  distance_threshold_km: number | string | null;
  always_start_from_home_base: boolean | null;
  use_advanced_geocoding: boolean | null;
  use_traffic_routing: boolean | null;
  google_maps_api_key: string | null;
  calendar_connected: boolean | null;
  calendar_provider: "outlook" | null;
  last_calendar_sync_at: string | null;
  updated_at: string | null;
};

export type UserProfileSettings = {
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
  workingDays: WorkingDaysTuple;
  distanceThresholdKm: number;
  alwaysStartFromHomeBase: boolean;
  useGoogleGeocoding: boolean;
  useTrafficAwareRouting: boolean;
  googleMapsApiKey: string | null;
  calendarConnected: boolean;
  calendarProvider: "outlook" | null;
  lastCalendarSyncAt: string | null;
  updatedAt: string | null;
};

export type UserProfileSettingsAccess = {
  subscriptionTier: SubscriptionTier;
  source: UserFeatureAccess["access"]["source"];
  canEditSettings: boolean;
  lockReason: UserFeatureAccess["access"]["lockReason"];
  subscriptionStatus: string | null;
  subscriptionCurrentPeriodEnd: string | null;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  trialPlanCode: SubscriptionTier | null;
  trialDaysTotal: number | null;
  trialDaysLeft: number | null;
  trialActive: boolean;
  trialExpired: boolean;
};

export type UserProfileSettingsResponse = {
  settings: UserProfileSettings;
  access: UserProfileSettingsAccess;
  entitlements: TierEntitlements;
  upgradeUrl: string;
};

export type UpdateUserProfileSettingsInput = {
  workingHours?: {
    start?: string;
    end?: string;
  };
  preMeetingBuffer?: number;
  postMeetingBuffer?: number;
  homeBase?: {
    lat: number;
    lon: number;
  } | null;
  homeBaseLabel?: string | null;
  workingDays?: WorkingDaysTuple;
  distanceThresholdKm?: number;
  alwaysStartFromHomeBase?: boolean;
  useGoogleGeocoding?: boolean;
  useTrafficAwareRouting?: boolean;
  googleMapsApiKey?: string | null;
  calendarConnected?: boolean;
  calendarProvider?: "outlook" | null;
};

function normalizeWorkingDays(value: unknown): WorkingDaysTuple {
  if (
    Array.isArray(value) &&
    value.length === 7 &&
    value.every((item) => typeof item === "boolean")
  ) {
    return [
      value[0],
      value[1],
      value[2],
      value[3],
      value[4],
      value[5],
      value[6]
    ];
  }
  return DEFAULT_WORKING_DAYS;
}

function toFiniteNumber(value: number | string | null, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

async function getProfileSettingsRow(userId: string): Promise<ProfileSettingsRow | null> {
  const found = await query<ProfileSettingsRow>(
    `SELECT
       u.id AS user_id,
       p.working_hours_start,
       p.working_hours_end,
       p.pre_meeting_buffer_minutes,
       p.post_meeting_buffer_minutes,
       p.home_base_lat,
       p.home_base_lon,
       p.home_base_label,
       p.working_days,
       p.distance_threshold_km,
       p.always_start_from_home_base,
       p.use_advanced_geocoding,
       p.use_traffic_routing,
       p.google_maps_api_key,
       p.calendar_connected,
       p.calendar_provider,
       p.last_calendar_sync_at,
       p.updated_at
     FROM users u
     LEFT JOIN user_profile_settings p ON p.user_id = u.id
     WHERE u.id = $1
     LIMIT 1`,
    [userId]
  );

  return found.rows[0] ?? null;
}

function buildSettings(
  row: ProfileSettingsRow,
  featureAccess: UserFeatureAccess
): UserProfileSettings {
  const workingDays = normalizeWorkingDays(row.working_days);
  const forceAdvancedGeocodingForSignedInBasic =
    featureAccess.access.source === "signed_in" &&
    featureAccess.entitlements.canUseBetterGeocoding;
  const hasHomeBaseCoordinates =
    typeof row.home_base_lat === "number" &&
    Number.isFinite(row.home_base_lat) &&
    typeof row.home_base_lon === "number" &&
    Number.isFinite(row.home_base_lon);

  return {
    workingHours: {
      start: row.working_hours_start ?? DEFAULT_PROFILE_SETTINGS.workingHoursStart,
      end: row.working_hours_end ?? DEFAULT_PROFILE_SETTINGS.workingHoursEnd
    },
    preMeetingBuffer: row.pre_meeting_buffer_minutes ?? DEFAULT_PROFILE_SETTINGS.preMeetingBuffer,
    postMeetingBuffer:
      row.post_meeting_buffer_minutes ?? DEFAULT_PROFILE_SETTINGS.postMeetingBuffer,
    homeBase: hasHomeBaseCoordinates
      ? {
          lat: row.home_base_lat!,
          lon: row.home_base_lon!
        }
      : {
          lat: DEFAULT_PROFILE_SETTINGS.homeBaseLat,
          lon: DEFAULT_PROFILE_SETTINGS.homeBaseLon
        },
    homeBaseLabel: row.home_base_label ?? DEFAULT_PROFILE_SETTINGS.homeBaseLabel,
    workingDays,
    distanceThresholdKm: toFiniteNumber(
      row.distance_threshold_km,
      DEFAULT_PROFILE_SETTINGS.distanceThresholdKm
    ),
    alwaysStartFromHomeBase:
      row.always_start_from_home_base ?? DEFAULT_PROFILE_SETTINGS.alwaysStartFromHomeBase,
    useGoogleGeocoding: forceAdvancedGeocodingForSignedInBasic
      ? true
      : row.use_advanced_geocoding ?? featureAccess.preferences.useAdvancedGeocoding,
    useTrafficAwareRouting:
      row.use_traffic_routing ?? featureAccess.preferences.useTrafficRouting,
    googleMapsApiKey: row.google_maps_api_key ?? DEFAULT_PROFILE_SETTINGS.googleMapsApiKey,
    calendarConnected: row.calendar_connected ?? DEFAULT_PROFILE_SETTINGS.calendarConnected,
    calendarProvider: row.calendar_provider ?? DEFAULT_PROFILE_SETTINGS.calendarProvider,
    lastCalendarSyncAt: row.last_calendar_sync_at ?? null,
    updatedAt: row.updated_at ?? null
  };
}

function buildResponse(settings: UserProfileSettings, featureAccess: UserFeatureAccess) {
  return {
    settings,
    access: {
      subscriptionTier: featureAccess.subscriptionTier,
      source: featureAccess.access.source,
      canEditSettings: featureAccess.access.canEditSettings,
      lockReason: featureAccess.access.lockReason,
      subscriptionStatus: featureAccess.access.subscriptionStatus,
      subscriptionCurrentPeriodEnd: featureAccess.access.subscriptionCurrentPeriodEnd,
      trialStartedAt: featureAccess.access.trialStartedAt,
      trialEndsAt: featureAccess.access.trialEndsAt,
      trialPlanCode: featureAccess.access.trialPlanCode,
      trialDaysTotal: featureAccess.access.trialDaysTotal,
      trialDaysLeft: featureAccess.access.trialDaysLeft,
      trialActive: featureAccess.access.trialActive,
      trialExpired: featureAccess.access.trialExpired
    },
    entitlements: featureAccess.entitlements,
    upgradeUrl: featureAccess.upgradeUrl
  };
}

export async function getUserProfileSettings(userId: string): Promise<UserProfileSettingsResponse> {
  const [row, featureAccess] = await Promise.all([
    getProfileSettingsRow(userId),
    getUserFeatureAccess(userId)
  ]);
  if (!row) {
    throw new Error("User not found");
  }
  const settings = buildSettings(row, featureAccess);
  return buildResponse(settings, featureAccess);
}

export async function updateUserProfileSettings(
  userId: string,
  patch: UpdateUserProfileSettingsInput,
  source = "app"
): Promise<UserProfileSettingsResponse> {
  const current = await getUserProfileSettings(userId);
  if (!current.access.canEditSettings) {
    throw new SettingsAccessLockedError(
      "Profile settings are locked. Start or reactivate a paid plan to edit settings."
    );
  }

  const nextSettings: UserProfileSettings = {
    ...current.settings,
    ...(patch.workingHours
      ? {
          workingHours: {
            start: patch.workingHours.start ?? current.settings.workingHours.start,
            end: patch.workingHours.end ?? current.settings.workingHours.end
          }
        }
      : {}),
    ...(patch.preMeetingBuffer !== undefined
      ? { preMeetingBuffer: patch.preMeetingBuffer }
      : {}),
    ...(patch.postMeetingBuffer !== undefined
      ? { postMeetingBuffer: patch.postMeetingBuffer }
      : {}),
    ...(patch.homeBase !== undefined
      ? patch.homeBase
        ? { homeBase: patch.homeBase }
        : {
            homeBase: {
              lat: DEFAULT_PROFILE_SETTINGS.homeBaseLat,
              lon: DEFAULT_PROFILE_SETTINGS.homeBaseLon
            }
          }
      : {}),
    ...(patch.homeBaseLabel !== undefined
      ? {
          homeBaseLabel:
            patch.homeBaseLabel?.trim() || DEFAULT_PROFILE_SETTINGS.homeBaseLabel
        }
      : {}),
    ...(patch.workingDays !== undefined ? { workingDays: patch.workingDays } : {}),
    ...(patch.distanceThresholdKm !== undefined
      ? { distanceThresholdKm: patch.distanceThresholdKm }
      : {}),
    ...(patch.alwaysStartFromHomeBase !== undefined
      ? { alwaysStartFromHomeBase: patch.alwaysStartFromHomeBase }
      : {}),
    ...(patch.useGoogleGeocoding !== undefined
      ? { useGoogleGeocoding: patch.useGoogleGeocoding }
      : {}),
    ...(patch.useTrafficAwareRouting !== undefined
      ? { useTrafficAwareRouting: patch.useTrafficAwareRouting }
      : {}),
    ...(patch.googleMapsApiKey !== undefined
      ? {
          googleMapsApiKey:
            patch.googleMapsApiKey && patch.googleMapsApiKey.trim().length > 0
              ? patch.googleMapsApiKey.trim()
              : null
        }
      : {}),
    ...(patch.calendarConnected !== undefined
      ? { calendarConnected: patch.calendarConnected }
      : {}),
    ...(patch.calendarProvider !== undefined
      ? { calendarProvider: patch.calendarProvider }
      : {})
  };

  if (nextSettings.useGoogleGeocoding && !current.entitlements.canUseBetterGeocoding) {
    throw new FeatureNotIncludedError(
      "Advanced geocoding is not included in the current subscription tier",
      {
        featureKey: "geocode.provider.premium",
        minimumTier: "basic"
      }
    );
  }

  if (nextSettings.useTrafficAwareRouting && !current.entitlements.canUseTrafficAwareRouting) {
    throw new FeatureNotIncludedError(
      "Traffic-aware routing is not included in the current subscription tier",
      {
        featureKey: "routing.traffic.enabled",
        minimumTier: "pro"
      }
    );
  }

  if (nextSettings.calendarConnected && !current.entitlements.canSyncCalendar) {
    throw new FeatureNotIncludedError(
      "Calendar sync is not included in the current subscription tier",
      {
        featureKey: "calendar.sync.enabled",
        minimumTier: "basic"
      }
    );
  }

  const nextCalendarProvider = nextSettings.calendarConnected
    ? nextSettings.calendarProvider ?? "outlook"
    : null;

  await query(
    `INSERT INTO user_profile_settings(
       user_id,
       working_hours_start,
       working_hours_end,
       pre_meeting_buffer_minutes,
       post_meeting_buffer_minutes,
       home_base_lat,
       home_base_lon,
       home_base_label,
       working_days,
       distance_threshold_km,
       always_start_from_home_base,
       use_advanced_geocoding,
       use_traffic_routing,
       google_maps_api_key,
       calendar_connected,
       calendar_provider,
       updated_by_source
     )
     VALUES (
       $1,
       $2,
       $3,
       $4,
       $5,
       $6,
       $7,
       $8,
       $9::jsonb,
       $10,
       $11,
       $12,
       $13,
       $14,
       $15,
       $16,
       $17
     )
     ON CONFLICT (user_id) DO UPDATE
       SET working_hours_start = EXCLUDED.working_hours_start,
           working_hours_end = EXCLUDED.working_hours_end,
           pre_meeting_buffer_minutes = EXCLUDED.pre_meeting_buffer_minutes,
           post_meeting_buffer_minutes = EXCLUDED.post_meeting_buffer_minutes,
           home_base_lat = EXCLUDED.home_base_lat,
           home_base_lon = EXCLUDED.home_base_lon,
           home_base_label = EXCLUDED.home_base_label,
           working_days = EXCLUDED.working_days,
           distance_threshold_km = EXCLUDED.distance_threshold_km,
           always_start_from_home_base = EXCLUDED.always_start_from_home_base,
           use_advanced_geocoding = EXCLUDED.use_advanced_geocoding,
           use_traffic_routing = EXCLUDED.use_traffic_routing,
           google_maps_api_key = EXCLUDED.google_maps_api_key,
           calendar_connected = EXCLUDED.calendar_connected,
           calendar_provider = EXCLUDED.calendar_provider,
           updated_by_source = EXCLUDED.updated_by_source,
           updated_at = now()`,
    [
      userId,
      nextSettings.workingHours.start,
      nextSettings.workingHours.end,
      nextSettings.preMeetingBuffer,
      nextSettings.postMeetingBuffer,
      nextSettings.homeBase.lat,
      nextSettings.homeBase.lon,
      nextSettings.homeBaseLabel,
      JSON.stringify(nextSettings.workingDays),
      nextSettings.distanceThresholdKm,
      nextSettings.alwaysStartFromHomeBase,
      nextSettings.useGoogleGeocoding,
      nextSettings.useTrafficAwareRouting,
      nextSettings.googleMapsApiKey,
      nextSettings.calendarConnected,
      nextCalendarProvider,
      source
    ]
  );

  await query(
    `INSERT INTO user_feature_preferences(user_id, use_advanced_geocoding, use_traffic_routing)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE
       SET use_advanced_geocoding = EXCLUDED.use_advanced_geocoding,
           use_traffic_routing = EXCLUDED.use_traffic_routing,
           updated_at = now()`,
    [userId, nextSettings.useGoogleGeocoding, nextSettings.useTrafficAwareRouting]
  );

  return getUserProfileSettings(userId);
}
