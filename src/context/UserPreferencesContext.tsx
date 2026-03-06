import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { UserPreferences } from '../types';
import { DEFAULT_USER_PREFERENCES, DEFAULT_WORKING_DAYS } from '../types';
import { useAuth } from './AuthContext';
import { backendGetFeatureAccess, backendGetProfileSettings } from '../services/backendApi';
import { getSubscriptionTier } from '../utils/subscription';

const PREFS_KEY = 'wiseplan_userPreferences';
const LEGACY_PREFS_KEYS = ['routeCopilot_userPreferences'] as const;

function mergeStoredIntoDefaults(parsed: Partial<UserPreferences> | null): UserPreferences {
  if (!parsed || typeof parsed !== 'object') return DEFAULT_USER_PREFERENCES;
  try {
    const subscriptionTier = getSubscriptionTier(parsed);
    const wd = parsed.workingDays;
    const validWorkingDays =
      Array.isArray(wd) &&
      wd.length === 7 &&
      wd.every((x): x is boolean => typeof x === 'boolean')
        ? (wd as UserPreferences['workingDays'])
        : DEFAULT_WORKING_DAYS;
    return {
      ...DEFAULT_USER_PREFERENCES,
      ...parsed,
      subscriptionTier,
      workingHours: {
        ...DEFAULT_USER_PREFERENCES.workingHours,
        ...(parsed.workingHours && typeof parsed.workingHours === 'object'
          ? parsed.workingHours
          : {}),
      },
      workingDays: validWorkingDays,
    };
  } catch {
    return DEFAULT_USER_PREFERENCES;
  }
}

/** On web, read preferences synchronously from localStorage so route/map use profile Home Base on first paint. */
function getInitialPreferences(): UserPreferences {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.localStorage) {
    return DEFAULT_USER_PREFERENCES;
  }
  try {
    const raw =
      window.localStorage.getItem(PREFS_KEY) ??
      LEGACY_PREFS_KEYS.map((k) => window.localStorage.getItem(k)).find((v) => v != null) ??
      null;
    if (!raw) return DEFAULT_USER_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    return mergeStoredIntoDefaults(parsed);
  } catch {
    return DEFAULT_USER_PREFERENCES;
  }
}

type UserPreferencesContextValue = {
  preferences: UserPreferences;
  updatePreferences: (partial: Partial<UserPreferences>) => void;
};

const UserPreferencesContext = createContext<UserPreferencesContextValue | null>(null);

function persistPreferences(next: UserPreferences) {
  const serialized = JSON.stringify(next);
  AsyncStorage.setItem(PREFS_KEY, serialized).catch(() => {});
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(PREFS_KEY, serialized);
    } catch {
      // ignore
    }
  }
}

export function UserPreferencesProvider({ children }: { children: React.ReactNode }) {
  const { userToken, getValidToken } = useAuth();
  const [preferences, setPreferences] = useState<UserPreferences>(getInitialPreferences);

  useEffect(() => {
    AsyncStorage.getItem(PREFS_KEY)
      .then((raw) => {
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as Partial<UserPreferences>;
            setPreferences(mergeStoredIntoDefaults(parsed));
          } catch {
            // ignore invalid JSON
          }
          return;
        }

        Promise.all(LEGACY_PREFS_KEYS.map((k) => AsyncStorage.getItem(k)))
          .then((legacyValues) => {
            const legacyRaw = legacyValues.find((v) => v != null);
            if (!legacyRaw) return;
            try {
              const parsed = JSON.parse(legacyRaw) as Partial<UserPreferences>;
              const merged = mergeStoredIntoDefaults(parsed);
              const serialized = JSON.stringify(merged);
              setPreferences(merged);
              AsyncStorage.setItem(PREFS_KEY, serialized).catch(() => {});
              if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
                try {
                  window.localStorage.setItem(PREFS_KEY, serialized);
                } catch {
                  // ignore
                }
              }
            } catch {
              // ignore invalid legacy JSON
            }
          })
          .catch(() => {});
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!userToken) {
        if (cancelled) return;
        setPreferences((prev) => {
          const next = mergeStoredIntoDefaults(DEFAULT_USER_PREFERENCES);
          if (JSON.stringify(prev) === JSON.stringify(next)) {
            return prev;
          }
          persistPreferences(next);
          return next;
        });
        return;
      }

      const token = userToken ?? (getValidToken ? await getValidToken() : null);
      if (!token || cancelled) return;

      const [remoteSettings, remoteFeatures] = await Promise.all([
        backendGetProfileSettings(token),
        backendGetFeatureAccess(token),
      ]);
      if (cancelled) return;

      setPreferences((prev) => {
        const signedInFallbackUseAdvanced = true;
        const next = mergeStoredIntoDefaults(
          remoteSettings
            ? {
                ...prev,
                subscriptionTier: remoteSettings.access.subscriptionTier,
                workingHours: remoteSettings.settings.workingHours,
                preMeetingBuffer: remoteSettings.settings.preMeetingBuffer,
                postMeetingBuffer: remoteSettings.settings.postMeetingBuffer,
                homeBase: {
                  lat: remoteSettings.settings.homeBase.lat,
                  lon: remoteSettings.settings.homeBase.lon,
                },
                homeBaseLabel: remoteSettings.settings.homeBaseLabel,
                workingDays: remoteSettings.settings.workingDays,
                distanceThresholdKm: remoteSettings.settings.distanceThresholdKm,
                alwaysStartFromHomeBase: remoteSettings.settings.alwaysStartFromHomeBase,
                useGoogleGeocoding: remoteSettings.settings.useGoogleGeocoding,
                useTrafficAwareRouting: remoteSettings.settings.useTrafficAwareRouting,
                googleMapsApiKey: remoteSettings.settings.googleMapsApiKey ?? undefined,
                calendarConnected: remoteSettings.settings.calendarConnected,
                calendarProvider: remoteSettings.settings.calendarProvider ?? undefined,
              }
            : remoteFeatures
            ? {
                ...prev,
                subscriptionTier: remoteFeatures.subscriptionTier,
                useGoogleGeocoding: remoteFeatures.preferences.useAdvancedGeocoding,
                useTrafficAwareRouting: remoteFeatures.preferences.useTrafficRouting,
              }
            : {
                ...prev,
                subscriptionTier: getSubscriptionTier(prev),
                useGoogleGeocoding: prev.useGoogleGeocoding ?? signedInFallbackUseAdvanced,
                useTrafficAwareRouting: prev.useTrafficAwareRouting ?? false,
              }
        );

        if (JSON.stringify(prev) === JSON.stringify(next)) {
          return prev;
        }

        persistPreferences(next);
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [userToken, getValidToken]);

  const updatePreferences = useCallback((partial: Partial<UserPreferences>) => {
    setPreferences((prev) => {
      const next = {
        ...prev,
        ...partial,
        subscriptionTier: getSubscriptionTier({ ...prev, ...partial }),
        workingHours: partial.workingHours
          ? { ...prev.workingHours, ...partial.workingHours }
          : prev.workingHours,
        workingDays: partial.workingDays ?? prev.workingDays ?? DEFAULT_WORKING_DAYS,
      };
      persistPreferences(next);
      return next;
    });
  }, []);

  const value: UserPreferencesContextValue = {
    preferences,
    updatePreferences,
  };

  return (
    <UserPreferencesContext.Provider value={value}>
      {children}
    </UserPreferencesContext.Provider>
  );
}

export function useUserPreferences() {
  const ctx = useContext(UserPreferencesContext);
  if (!ctx) {
    throw new Error('useUserPreferences must be used within UserPreferencesProvider');
  }
  return ctx;
}
