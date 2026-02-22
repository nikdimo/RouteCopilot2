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

// ─── JWT helpers (no-network token inspection) ────────────────────────────────

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const base64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=');
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Returns true if the JWT is expired (or unparseable). Uses a 60-second buffer. */
function isTokenExpired(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload) return true;
  const exp = typeof payload.exp === 'number' ? payload.exp : null;
  if (exp == null) return true;
  return Date.now() / 1000 > exp - 60;
}

/** Extract user display info from Microsoft JWT claims — no network needed. */
function userDataFromJwt(token: string): UserData {
  const payload = decodeJwtPayload(token);
  const displayName = payload && typeof payload.name === 'string' ? payload.name : null;
  const mail =
    payload && typeof payload.preferred_username === 'string'
      ? payload.preferred_username
      : payload && typeof payload.upn === 'string'
      ? payload.upn
      : null;
  return { displayName, mail };
}

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

    // Fast path: token still valid — skip the /me network call entirely
    if (!isTokenExpired(stored)) return stored;

    // Token expired — try refresh
    const refreshToken = await tokenStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) return null;

    const result = await refreshAccessToken(refreshToken, MS_CLIENT_ID);
    if (!result.success) return null;

    await tokenStorage.setItem(TOKEN_KEY, result.accessToken);
    if (result.refreshToken) {
      await tokenStorage.setItem(REFRESH_TOKEN_KEY, result.refreshToken);
    }
    setUserToken(result.accessToken);
    // Refresh user display info in background (non-blocking)
    fetch(`${ME_URL}?$select=${ME_SELECT}`, {
      headers: { Authorization: `Bearer ${result.accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setUserData({
            displayName: data.displayName ?? null,
            mail: data.mail ?? data.userPrincipalName ?? null,
          });
        }
      })
      .catch(() => {});
    return result.accessToken;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await tokenStorage.getItem(TOKEN_KEY);
      if (cancelled) { setIsRestoringSession(false); return; }
      if (!token) { setIsRestoringSession(false); return; }

      // ── Fast path: token is still valid — restore instantly from JWT, no network ──
      if (!isTokenExpired(token)) {
        if (!cancelled) {
          setUserToken(token);
          setUserData(userDataFromJwt(token));
          setIsRestoringSession(false);
          // Silently refresh user display name in background (non-blocking)
          fetch(`${ME_URL}?$select=${ME_SELECT}`, { headers: { Authorization: `Bearer ${token}` } })
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
              if (data && !cancelled) {
                setUserData({ displayName: data.displayName ?? null, mail: data.mail ?? data.userPrincipalName ?? null });
              }
            })
            .catch(() => {});
        }
        return;
      }

      // ── Token expired — try refresh token ──
      const refresh = await tokenStorage.getItem(REFRESH_TOKEN_KEY);
      if (!refresh) {
        await tokenStorage.removeItem(TOKEN_KEY);
        if (!cancelled) setIsRestoringSession(false);
        return;
      }

      const result = await refreshAccessToken(refresh, MS_CLIENT_ID);
      if (!result.success) {
        if (!cancelled) setIsRestoringSession(false);
        signOut();
        return;
      }

      const newToken = result.accessToken;
      await tokenStorage.setItem(TOKEN_KEY, newToken);
      if (result.refreshToken) await tokenStorage.setItem(REFRESH_TOKEN_KEY, result.refreshToken);

      const res = await fetch(`${ME_URL}?$select=${ME_SELECT}`, { headers: { Authorization: `Bearer ${newToken}` } });
      if (!cancelled) {
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          setUserToken(newToken);
          setUserData({ displayName: data.displayName ?? null, mail: data.mail ?? data.userPrincipalName ?? null });
        }
        setIsRestoringSession(false);
      }
    })();
    return () => { cancelled = true; };
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
