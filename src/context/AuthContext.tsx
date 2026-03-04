import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BACKEND_API_BASE_URL, BACKEND_API_ENABLED } from '../config/backend';
import { clearGraphSession, isMagicAuthToken } from '../services/graphAuth';

const BACKEND_BASE_FALLBACK = 'http://localhost:4000';
const NORMALIZED_BACKEND_BASE = (() => {
  const raw = (BACKEND_API_BASE_URL || BACKEND_BASE_FALLBACK).replace(/\/+$/, '');
  return raw.endsWith('/api') ? raw.slice(0, -4) : raw;
})();

function buildApiUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${NORMALIZED_BACKEND_BASE}/api${normalizedPath}`;
}

const tokenStorage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      let asyncValue: string | null = null;
      try {
        asyncValue = await AsyncStorage.getItem(key);
      } catch {
        // ignore AsyncStorage read errors on web and try localStorage fallback
      }
      if (asyncValue && asyncValue.trim().length > 0) {
        return asyncValue;
      }
      if (typeof window !== 'undefined' && window.localStorage) {
        try {
          const localValue = window.localStorage.getItem(key);
          if (localValue && localValue.trim().length > 0) {
            // best-effort sync back to AsyncStorage
            AsyncStorage.setItem(key, localValue).catch(() => { });
            return localValue;
          }
        } catch {
          // ignore localStorage read errors
        }
      }
      return asyncValue;
    }
    return SecureStore.getItemAsync(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      let wrote = false;
      try {
        await AsyncStorage.setItem(key, value);
        wrote = true;
      } catch {
        // ignore and fallback to localStorage
      }
      if (typeof window !== 'undefined' && window.localStorage) {
        try {
          window.localStorage.setItem(key, value);
          wrote = true;
        } catch {
          // ignore localStorage write errors
        }
      }
      if (!wrote) {
        throw new Error('Failed to persist auth token on web storage');
      }
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async removeItem(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      try {
        await AsyncStorage.removeItem(key);
      } catch {
        // ignore AsyncStorage remove errors
      }
      if (typeof window !== 'undefined' && window.localStorage) {
        try {
          window.localStorage.removeItem(key);
        } catch {
          // ignore localStorage remove errors
        }
      }
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};

export type UserData = {
  email: string | null;
  displayName: string | null;
};

type AuthContextValue = {
  userToken: string | null;
  userData: UserData | null;
  isRestoringSession: boolean;
  signIn: (token: string, refreshToken?: string) => Promise<void>;
  signOut: () => void;
  getValidToken: () => Promise<string | null>;
  requestMagicLink: (email: string) => Promise<{ success: boolean; error?: string }>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = 'wiseplanAuthToken';

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const encoded = parts[1]!;
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padding = (4 - (base64.length % 4)) % 4;
    const padded = `${base64}${'='.repeat(padding)}`;
    const atobFn = typeof globalThis !== 'undefined' && typeof globalThis.atob === 'function'
      ? globalThis.atob.bind(globalThis)
      : null;
    if (!atobFn) return null;

    const binary = atobFn(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }

    let jsonText = '';
    if (typeof TextDecoder !== 'undefined') {
      jsonText = new TextDecoder('utf-8').decode(bytes);
    } else {
      let encodedUtf8 = '';
      for (let i = 0; i < bytes.length; i += 1) {
        encodedUtf8 += `%${bytes[i]!.toString(16).padStart(2, '0')}`;
      }
      jsonText = decodeURIComponent(encodedUtf8);
    }

    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

function isTokenExpired(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload) return false;
  const exp = typeof payload.exp === 'number' ? payload.exp : null;
  if (exp == null) return false;
  // Backend remains the source of truth for magic-link token validity.
  if (isMagicAuthToken(token)) return false;
  return Date.now() / 1000 > exp - 60;
}

function userDataFromJwt(token: string): UserData {
  const payload = decodeJwtPayload(token);
  const email = typeof payload?.email === 'string' ? payload.email : null;
  const displayName = typeof payload?.name === 'string' ? payload.name : email;
  return { email, displayName };
}

function stripMagicTokenFromWebUrl() {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.history?.replaceState) {
    return;
  }
  try {
    const current = new URL(window.location.href);
    if (!current.searchParams.has('token')) return;
    current.searchParams.delete('token');
    const nextSearch = current.searchParams.toString();
    const nextUrl = `${current.pathname}${nextSearch ? `?${nextSearch}` : ''}${current.hash ?? ''}`;
    window.history.replaceState({}, '', nextUrl);
  } catch {
    // ignore browser URL cleanup errors
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [userToken, setUserToken] = useState<string | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [isRestoringSession, setIsRestoringSession] = useState(true);

  const signOut = useCallback(() => {
    setUserToken(null);
    setUserData(null);
    tokenStorage.removeItem(TOKEN_KEY).catch(() => { });
    clearGraphSession().catch(() => { });
  }, []);

  const fetchUserData = useCallback(async (token: string) => {
    if (!BACKEND_API_ENABLED) {
      setUserData(userDataFromJwt(token));
      return true;
    }
    try {
      const res = await fetch(buildApiUrl('/me'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) return false;
      if (!res.ok) {
        // Keep session on non-auth failures (e.g. endpoint temporarily unavailable).
        setUserData(userDataFromJwt(token));
        return true;
      }
      const data = await res.json();
      setUserData({
        email: data.email ?? null,
        displayName: data.name ?? data.email ?? null,
      });
      return true;
    } catch {
      setUserData(userDataFromJwt(token));
      return true;
    }
  }, []);

  const signIn = useCallback(
    async (token: string) => {
      setUserToken(token);
      await tokenStorage.setItem(TOKEN_KEY, token);
      const ok = await fetchUserData(token);
      if (!ok) {
        // Keep magic-link sessions alive on transient backend auth races.
        if (isMagicAuthToken(token)) {
          setUserData(userDataFromJwt(token));
          return;
        }
        signOut();
      }
    },
    [fetchUserData, signOut]
  );

  const getValidToken = useCallback(async (): Promise<string | null> => {
    const stored = await tokenStorage.getItem(TOKEN_KEY);
    if (!stored) return null;
    if (isTokenExpired(stored)) {
      signOut();
      return null;
    }
    return stored;
  }, [signOut]);

  const requestMagicLink = useCallback(async (email: string) => {
    if (!BACKEND_API_ENABLED) {
      console.log(`[Mock Auth] Requested magic link for ${email}`);
      return { success: true };
    }
    try {
      const res = await fetch(buildApiUrl('/auth/request-magic-link'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { success: false, error: data.error || 'Failed to send magic link' };
      }
      if (typeof data?.token === 'string' && data.token.trim()) {
        await signIn(data.token.trim());
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: 'Network error. Please try again.' };
    }
  }, [signIn]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await tokenStorage.getItem(TOKEN_KEY);
      if (cancelled) { setIsRestoringSession(false); return; }
      if (!token || isTokenExpired(token)) {
        await tokenStorage.removeItem(TOKEN_KEY);
        if (!cancelled) setIsRestoringSession(false);
        return;
      }

      setUserToken(token);
      setUserData(userDataFromJwt(token));
      setIsRestoringSession(false);

      if (BACKEND_API_ENABLED) {
        fetch(buildApiUrl('/me'), { headers: { Authorization: `Bearer ${token}` } })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (data && !cancelled) {
              setUserData({ email: data.email ?? null, displayName: data.name ?? data.email ?? null });
            }
          })
          .catch(() => { });
      }
    })();
    return () => { cancelled = true; };
  }, [signOut]);

  useEffect(() => {
    const handleDeepLink = (event: Linking.EventType) => {
      const url = event.url;
      if (!url) return;
      const parsed = Linking.parse(url);
      const tokenParam =
        parsed.queryParams && typeof parsed.queryParams.token === 'string'
          ? parsed.queryParams.token.trim()
          : '';
      if (tokenParam) {
        void signIn(tokenParam).finally(() => {
          stripMagicTokenFromWebUrl();
        });
      }
    };

    const sub = Linking.addEventListener('url', handleDeepLink);
    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLink({ url });
    });

    return () => {
      sub.remove();
    };
  }, [signIn]);

  const value: AuthContextValue = {
    userToken,
    userData,
    isRestoringSession,
    signIn,
    signOut,
    getValidToken,
    requestMagicLink,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
