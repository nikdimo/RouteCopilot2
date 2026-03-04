import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { refreshAccessToken } from '../utils/tokenRefresh';

const GRAPH_ACCESS_TOKEN_KEY = 'wiseplanGraphAccessToken';
const GRAPH_REFRESH_TOKEN_KEY = 'wiseplanGraphRefreshToken';
const GRAPH_EXPIRES_AT_KEY = 'wiseplanGraphTokenExpiresAt';

const GRAPH_AUDIENCE_IDS = new Set([
  'https://graph.microsoft.com',
  '00000003-0000-0000-c000-000000000000',
]);

const tokenStorage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      let asyncValue: string | null = null;
      try {
        asyncValue = await AsyncStorage.getItem(key);
      } catch {
        // ignore AsyncStorage read failures on web
      }
      if (asyncValue && asyncValue.trim().length > 0) {
        return asyncValue;
      }
      if (typeof window !== 'undefined' && window.localStorage) {
        try {
          const localValue = window.localStorage.getItem(key);
          if (localValue && localValue.trim().length > 0) {
            AsyncStorage.setItem(key, localValue).catch(() => { });
            return localValue;
          }
        } catch {
          // ignore localStorage read failures
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
        // ignore AsyncStorage write failures and fallback to localStorage
      }
      if (typeof window !== 'undefined' && window.localStorage) {
        try {
          window.localStorage.setItem(key, value);
          wrote = true;
        } catch {
          // ignore localStorage write failures
        }
      }
      if (!wrote) {
        throw new Error('Failed to persist graph session on web storage');
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
        // ignore AsyncStorage remove failures
      }
      if (typeof window !== 'undefined' && window.localStorage) {
        try {
          window.localStorage.removeItem(key);
        } catch {
          // ignore localStorage remove failures
        }
      }
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};

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

function getAudienceList(payload: Record<string, unknown> | null): string[] {
  if (!payload) return [];
  const raw = payload.aud;
  if (Array.isArray(raw)) {
    return raw.filter((value): value is string => typeof value === 'string');
  }
  if (typeof raw === 'string') return [raw];
  return [];
}

export function isGraphAccessToken(token: string): boolean {
  const payload = decodeJwtPayload(token);
  const issuer = typeof payload?.iss === 'string' ? payload.iss : '';
  const audiences = getAudienceList(payload);
  return (
    issuer.includes('login.microsoftonline.com') &&
    audiences.some((aud) => GRAPH_AUDIENCE_IDS.has(aud))
  );
}

export function isMagicAuthToken(token: string): boolean {
  const payload = decodeJwtPayload(token);
  const issuer = typeof payload?.iss === 'string' ? payload.iss : '';
  const audiences = getAudienceList(payload);
  return issuer.includes('wiseplan-auth') || audiences.includes('wiseplan-app');
}

function inferExpiryTimestampMs(token: string, expiresInSec?: number): number | null {
  if (typeof expiresInSec === 'number' && Number.isFinite(expiresInSec) && expiresInSec > 0) {
    return Date.now() + expiresInSec * 1000;
  }
  const payload = decodeJwtPayload(token);
  const exp = typeof payload?.exp === 'number' ? payload.exp : null;
  if (exp == null) return null;
  return exp * 1000;
}

function isExpired(expiryRaw: string | null) {
  if (!expiryRaw) return false;
  const expiryMs = Number(expiryRaw);
  if (!Number.isFinite(expiryMs)) return false;
  return Date.now() >= expiryMs - 60_000;
}

export async function saveGraphSession(
  accessToken: string,
  refreshToken?: string,
  expiresInSec?: number
) {
  await tokenStorage.setItem(GRAPH_ACCESS_TOKEN_KEY, accessToken);
  if (refreshToken && refreshToken.trim().length > 0) {
    await tokenStorage.setItem(GRAPH_REFRESH_TOKEN_KEY, refreshToken);
  }
  const expiresAt = inferExpiryTimestampMs(accessToken, expiresInSec);
  if (expiresAt != null) {
    await tokenStorage.setItem(GRAPH_EXPIRES_AT_KEY, String(expiresAt));
  } else {
    await tokenStorage.removeItem(GRAPH_EXPIRES_AT_KEY);
  }
}

export async function clearGraphSession() {
  await Promise.all([
    tokenStorage.removeItem(GRAPH_ACCESS_TOKEN_KEY),
    tokenStorage.removeItem(GRAPH_REFRESH_TOKEN_KEY),
    tokenStorage.removeItem(GRAPH_EXPIRES_AT_KEY),
  ]);
}

export async function hasGraphSession() {
  const [accessToken, refreshToken] = await Promise.all([
    tokenStorage.getItem(GRAPH_ACCESS_TOKEN_KEY),
    tokenStorage.getItem(GRAPH_REFRESH_TOKEN_KEY),
  ]);
  return Boolean(
    (accessToken && accessToken.trim().length > 0) ||
      (refreshToken && refreshToken.trim().length > 0)
  );
}

export async function hasValidGraphSession(clientId: string): Promise<boolean> {
  const token = await getValidGraphToken(clientId);
  return Boolean(token);
}

export async function getValidGraphToken(clientId: string): Promise<string | null> {
  const [accessToken, refreshToken, expiresAtRaw] = await Promise.all([
    tokenStorage.getItem(GRAPH_ACCESS_TOKEN_KEY),
    tokenStorage.getItem(GRAPH_REFRESH_TOKEN_KEY),
    tokenStorage.getItem(GRAPH_EXPIRES_AT_KEY),
  ]);

  const trimmedAccessToken = accessToken?.trim() ?? '';
  if (trimmedAccessToken.length > 0 && !isExpired(expiresAtRaw)) {
    return trimmedAccessToken;
  }

  if (!refreshToken || refreshToken.trim().length === 0) {
    return null;
  }

  const refreshed = await refreshAccessToken(refreshToken, clientId);
  const refreshedAccessToken = refreshed.success ? refreshed.accessToken.trim() : '';
  if (!refreshed.success || refreshedAccessToken.length === 0) {
    await clearGraphSession();
    return null;
  }

  await saveGraphSession(
    refreshedAccessToken,
    refreshed.refreshToken ?? refreshToken,
    refreshed.expiresIn
  );
  return refreshedAccessToken;
}
