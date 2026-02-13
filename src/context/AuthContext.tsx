import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MS_CLIENT_ID } from '../config/auth';
import { refreshAccessToken } from '../utils/tokenRefresh';

// SecureStore is not available on web; use AsyncStorage instead.
const tokenStorage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === 'web') return AsyncStorage.getItem(key);
    return SecureStore.getItemAsync(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') await AsyncStorage.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  },
  async removeItem(key: string): Promise<void> {
    if (Platform.OS === 'web') await AsyncStorage.removeItem(key);
    else await SecureStore.deleteItemAsync(key);
  },
};

export type UserData = {
  displayName: string | null;
  mail: string | null;
};

type AuthContextValue = {
  userToken: string | null;
  userData: UserData | null;
  isRestoringSession: boolean;
  signIn: (token: string, refreshToken?: string) => Promise<void>;
  signOut: () => void;
  /** Get a valid token, refreshing if needed. Returns null if session invalid. */
  getValidToken: () => Promise<string | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const ME_URL = 'https://graph.microsoft.com/v1.0/me';
const ME_SELECT = 'displayName,mail';
const TOKEN_KEY = 'userToken';
const REFRESH_TOKEN_KEY = 'userRefreshToken';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [userToken, setUserToken] = useState<string | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  /** True until we've checked SecureStore for a stored session. Prevents showing Login while restoring. */
  const [isRestoringSession, setIsRestoringSession] = useState(true);

  const signOut = useCallback(() => {
    setUserToken(null);
    setUserData(null);
    tokenStorage.removeItem(TOKEN_KEY).catch(() => {});
    tokenStorage.removeItem(REFRESH_TOKEN_KEY).catch(() => {});
  }, []);

  const fetchUserData = useCallback(async (token: string) => {
    try {
      const res = await fetch(`${ME_URL}?$select=${ME_SELECT}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) return false;
      if (!res.ok) return false;
      const data = await res.json();
      setUserData({
        displayName: data.displayName ?? null,
        mail: data.mail ?? data.userPrincipalName ?? null,
      });
      return true;
    } catch {
      setUserData(null);
      return false;
    }
  }, []);

  const signIn = useCallback(
    async (token: string, refreshToken?: string) => {
      setUserToken(token);
      await tokenStorage.setItem(TOKEN_KEY, token);
      if (refreshToken) {
        await tokenStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
      }
      const ok = await fetchUserData(token);
      if (!ok) signOut();
    },
    [fetchUserData, signOut]
  );

  const getValidToken = useCallback(async (): Promise<string | null> => {
    const stored = await tokenStorage.getItem(TOKEN_KEY);
    if (!stored) return null;

    const res = await fetch(`${ME_URL}?$select=${ME_SELECT}`, {
      headers: { Authorization: `Bearer ${stored}` },
    });
    if (res.ok) return stored;
    if (res.status !== 401) return null;

    const refreshToken = await tokenStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) return null;

    const result = await refreshAccessToken(refreshToken, MS_CLIENT_ID);
    if (!result.success) return null;

    await tokenStorage.setItem(TOKEN_KEY, result.accessToken);
    if (result.refreshToken) {
      await tokenStorage.setItem(REFRESH_TOKEN_KEY, result.refreshToken);
    }
    const meRes = await fetch(`${ME_URL}?$select=${ME_SELECT}`, {
      headers: { Authorization: `Bearer ${result.accessToken}` },
    });
    if (meRes.ok) {
      const data = await meRes.json().catch(() => ({}));
      setUserToken(result.accessToken);
      setUserData({
        displayName: data.displayName ?? null,
        mail: data.mail ?? data.userPrincipalName ?? null,
      });
    }
    return result.accessToken;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let token: string | null = await tokenStorage.getItem(TOKEN_KEY);
      if (cancelled) {
        setIsRestoringSession(false);
        return;
      }
      if (!token) {
        setIsRestoringSession(false);
        return;
      }

      let res = await fetch(`${ME_URL}?$select=${ME_SELECT}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401) {
        const refresh = await tokenStorage.getItem(REFRESH_TOKEN_KEY);
        if (refresh) {
          const result = await refreshAccessToken(refresh, MS_CLIENT_ID);
          if (result.success) {
            token = result.accessToken;
            await tokenStorage.setItem(TOKEN_KEY, token);
            if (result.refreshToken) {
              await tokenStorage.setItem(REFRESH_TOKEN_KEY, result.refreshToken);
            }
            res = await fetch(`${ME_URL}?$select=${ME_SELECT}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
          } else {
            if (!cancelled) setIsRestoringSession(false);
            signOut();
            return;
          }
        } else {
          await tokenStorage.removeItem(TOKEN_KEY);
          if (!cancelled) setIsRestoringSession(false);
          return;
        }
      }

      if (cancelled) return;
      if (!res.ok) {
        setIsRestoringSession(false);
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (!cancelled) {
        setUserToken(token);
        setUserData({
          displayName: data.displayName ?? null,
          mail: data.mail ?? data.userPrincipalName ?? null,
        });
      }
      setIsRestoringSession(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [signOut]);

  const value: AuthContextValue = {
    userToken,
    userData,
    isRestoringSession,
    signIn,
    signOut,
    getValidToken,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
