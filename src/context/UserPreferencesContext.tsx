import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { UserPreferences } from '../types';
import { DEFAULT_USER_PREFERENCES, DEFAULT_WORKING_DAYS } from '../types';

const PREFS_KEY = 'routeCopilot_userPreferences';

function mergeStoredIntoDefaults(parsed: Partial<UserPreferences> | null): UserPreferences {
  if (!parsed || typeof parsed !== 'object') return DEFAULT_USER_PREFERENCES;
  try {
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
    const raw = window.localStorage.getItem(PREFS_KEY);
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

export function UserPreferencesProvider({ children }: { children: React.ReactNode }) {
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
        }
      })
      .catch(() => {});
  }, []);

  const updatePreferences = useCallback((partial: Partial<UserPreferences>) => {
    setPreferences((prev) => {
      const next = {
        ...prev,
        ...partial,
        workingHours: partial.workingHours
          ? { ...prev.workingHours, ...partial.workingHours }
          : prev.workingHours,
        workingDays: partial.workingDays ?? prev.workingDays ?? DEFAULT_WORKING_DAYS,
      };
      const serialized = JSON.stringify(next);
      AsyncStorage.setItem(PREFS_KEY, serialized).catch(() => {});
      // On web, also write to localStorage so sync initial read and map see the same data
      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
        try {
          window.localStorage.setItem(PREFS_KEY, serialized);
        } catch {
          // ignore
        }
      }
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
