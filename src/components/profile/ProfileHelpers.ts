import { Alert, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_USER_PREFERENCES } from '../../types';
import { clearGraphSession } from '../../services/graphAuth';

const LOCAL_DATA_EXACT_KEYS = new Set([
    'wiseplanAuthToken',
    'wiseplanGraphAccessToken',
    'wiseplanGraphRefreshToken',
    'wiseplanGraphTokenExpiresAt',
    'wiseplan_userPreferences',
    'routeCopilot_userPreferences',
    'wiseplan_localMeetings_v1',
    'wiseplan_meetingCounts',
    'wiseplan_completedEventIds',
    'wiseplan.billing.token',
    'ExpoWebBrowserRedirectHandle',
    'wiseplanOAuthFallbackRedirectUrl',
    'wiseplanOAuthPkceVerifier',
    'wiseplanOAuthExpectedState',
]);

const LOCAL_DATA_PREFIXES = [
    'wiseplan_',
    'routeCopilot_',
    'routecopilot_',
    'wiseplan_dayOrder_',
    'wiseplan_geocode_',
    'wiseplan_osrm_',
    'routecopilot_geocode_',
    'ExpoWebBrowser_OriginUrl_',
    'ExpoWebBrowser_RedirectUrl_',
];

export function isLocalDataKey(key: string): boolean {
    if (LOCAL_DATA_EXACT_KEYS.has(key)) return true;
    return LOCAL_DATA_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function parseNumber(s: string, min: number, max: number): number {
    const n = parseInt(s, 10);
    if (isNaN(n)) return min;
    return Math.min(max, Math.max(min, n));
}

/** 5-min slot index 0–287: 0 = 00:00, 287 = 23:55 */
export const SLOTS_PER_HOUR = 12; // 60/5
export const MAX_SLOT = 24 * SLOTS_PER_HOUR - 1; // 287

/** 15-min slot index 0–95 for working hours UI: 0 = 00:00, 95 = 23:45 */
export const SLOTS_PER_HOUR_15 = 4; // 60/15
export const MAX_SLOT_15 = 24 * SLOTS_PER_HOUR_15 - 1; // 95

export function slot5ToSlot15(slot5: number): number {
  return Math.min(MAX_SLOT_15, Math.max(0, Math.round(slot5 / 3)));
}
export function slot15ToSlot5(slot15: number): number {
  return Math.min(MAX_SLOT, Math.max(0, slot15 * 3));
}

export function timeToSlot(time: string): number {
    const m = time.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return 96; // default 08:00
    const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
    const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
    const slot = h * SLOTS_PER_HOUR + Math.round(min / 5);
    return Math.min(MAX_SLOT, Math.max(0, slot));
}

export function slotToTime(slot: number): string {
    const s = Math.min(MAX_SLOT, Math.max(0, Math.round(slot)));
    const totalMin = s * 5;
    const h = Math.floor(totalMin / 60);
    const min = totalMin % 60;
    return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
}

export const clearLocalDataNow = async (
    signOut: () => void,
    updatePreferences: (p: any) => void,
    options?: { title?: string; message?: string; suppressAlert?: boolean }
) => {
    signOut();
    await clearGraphSession().catch(() => {
        // ignore graph-session cleanup failures
    });

    try {
        const keys = await AsyncStorage.getAllKeys();
        const keysToRemove = keys.filter((key) => isLocalDataKey(key));
        if (keysToRemove.length > 0) {
            await AsyncStorage.multiRemove(keysToRemove);
        }
    } catch {
        // ignore async-storage cleanup failures
    }

    if (typeof window !== 'undefined' && window.localStorage) {
        try {
            const webKeys: string[] = [];
            for (let i = 0; i < window.localStorage.length; i += 1) {
                const key = window.localStorage.key(i);
                if (key && isLocalDataKey(key)) {
                    webKeys.push(key);
                }
            }
            for (const key of webKeys) {
                window.localStorage.removeItem(key);
            }
        } catch {
            // ignore web localStorage cleanup failures
        }
    }

    updatePreferences(DEFAULT_USER_PREFERENCES);
    if (!options?.suppressAlert) {
        const title = options?.title ?? 'Local data cleared';
        const message =
            options?.message ?? 'Local routes, preferences, caches, and session data were removed from this device.';

        if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.alert === 'function') {
            window.alert(`${title}\n\n${message}`);
        } else {
            Alert.alert(title, message);
        }
    }
};
