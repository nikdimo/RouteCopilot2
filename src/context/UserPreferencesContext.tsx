import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { UserPreferences } from '../types';
import { DEFAULT_USER_PREFERENCES, DEFAULT_WORKING_DAYS } from '../types';

const PREFS_KEY = 'routeCopilot_userPreferences';

type UserPreferencesContextValue = {
  preferences: UserPreferences;
  updatePreferences: (partial: Partial<UserPreferences>) => void;
};

const UserPreferencesContext = createContext<UserPreferencesContextValue | null>(null);

export function UserPreferencesProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_USER_PREFERENCES);

  useEffect(() => {
    AsyncStorage.getItem(PREFS_KEY)
      .then((raw) => {
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as Partial<UserPreferences>;
            const wd = parsed.workingDays;
            const validWorkingDays =
              Array.isArray(wd) &&
              wd.length === 7 &&
              wd.every((x): x is boolean => typeof x === 'boolean')
                ? (wd as UserPreferences['workingDays'])
                : DEFAULT_WORKING_DAYS;
            const { lunchWindow: _lunch, ...rest } = parsed;
            setPreferences({
              ...DEFAULT_USER_PREFERENCES,
              ...rest,
              workingHours: {
                ...DEFAULT_USER_PREFERENCES.workingHours,
                ...(parsed.workingHours && typeof parsed.workingHours === 'object'
                  ? parsed.workingHours
                  : {}),
              },
              workingDays: validWorkingDays,
            });
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
      AsyncStorage.setItem(PREFS_KEY, JSON.stringify(next)).catch(() => {});
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
