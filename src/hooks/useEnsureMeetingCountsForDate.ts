import { useCallback, useEffect, useRef } from 'react';
import { addDays, endOfDay, startOfDay, isAfter } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import { useRoute } from '../context/RouteContext';
import { useUserPreferences } from '../context/UserPreferencesContext';
import { getCalendarEventsRaw } from '../services/graph';
import { getLocalMeetingCountsInRange } from '../services/localMeetings';
import { toLocalDayKey } from '../utils/dateUtils';
import { getEffectiveSubscriptionTier, getTierEntitlements } from '../utils/subscription';

const ROUTE_COUNTS_DEBUG =
  __DEV__ || process.env.EXPO_PUBLIC_DEBUG_ROUTE_SYNC === '1';

export function useEnsureMeetingCountsForDate() {
  const { userToken, getValidToken } = useAuth();
  const { loadedRange, setMeetingCountByDay, setLoadedRange } = useRoute();
  const { preferences } = useUserPreferences();
  const subscriptionTier = getEffectiveSubscriptionTier(preferences, Boolean(userToken));
  const { canSyncCalendar } = getTierEntitlements(subscriptionTier);
  const shouldSyncCalendar = canSyncCalendar || Boolean(userToken);
  const syncModeRef = useRef<'local' | 'remote'>(shouldSyncCalendar ? 'remote' : 'local');

  // Avoid startup races: if mode flips local<->remote (e.g. prefs hydrate after auth),
  // invalidate the loaded range so we do not skip the first fetch for the new mode.
  useEffect(() => {
    const nextMode: 'local' | 'remote' = shouldSyncCalendar ? 'remote' : 'local';
    if (syncModeRef.current !== nextMode) {
      syncModeRef.current = nextMode;
      setLoadedRange(null);
    }
  }, [shouldSyncCalendar, setLoadedRange]);

  return useCallback(
    async (date: Date, forceRefetch?: boolean) => {
      const windowStart = startOfDay(addDays(date, -30));
      const windowEnd = endOfDay(addDays(date, 30));
      const startKey = toLocalDayKey(windowStart);
      const endKey = toLocalDayKey(windowEnd);
      if (ROUTE_COUNTS_DEBUG) {
        console.log('[RouteQC] MeetingCounts: request', {
          dateKey: toLocalDayKey(date),
          startKey,
          endKey,
          forceRefetch: !!forceRefetch,
          mode: shouldSyncCalendar ? 'remote' : 'local',
          hasToken: !!userToken,
          loadedRange,
        });
      }

      if (!shouldSyncCalendar) {
        const counts = await getLocalMeetingCountsInRange(windowStart, windowEnd);
        setMeetingCountByDay((prev) => {
          let changed = false;
          const merged = { ...prev };
          let d = new Date(windowStart);
          while (!isAfter(d, windowEnd)) {
            const key = toLocalDayKey(d);
            const count = counts[key] ?? 0;
            if (count === 0 && merged[key] !== undefined) {
              delete merged[key];
              changed = true;
            } else if (count > 0 && merged[key] !== count) {
              merged[key] = count;
              changed = true;
            }
            d = addDays(d, 1);
          }
          return changed ? merged : prev;
        });
        setLoadedRange((prev) => {
          const nextStart = prev ? (prev.start <= startKey ? prev.start : startKey) : startKey;
          const nextEnd = prev ? (prev.end >= endKey ? prev.end : endKey) : endKey;
          if (prev && prev.start === nextStart && prev.end === nextEnd) return prev;
          return { start: nextStart, end: nextEnd };
        });
        if (ROUTE_COUNTS_DEBUG) {
          const dotCount = Object.values(counts).filter((count) => count > 0).length;
          console.log('[RouteQC] MeetingCounts: local success', {
            startKey,
            endKey,
            dotCount,
          });
        }
        return;
      }

      if (!forceRefetch && loadedRange && loadedRange.start <= startKey && loadedRange.end >= endKey) {
        if (ROUTE_COUNTS_DEBUG) {
          console.log('[RouteQC] MeetingCounts: skip (range already loaded)', {
            startKey,
            endKey,
            loadedRange,
          });
        }
        return;
      }

      const token = userToken ?? (getValidToken ? await getValidToken() : null);
      if (!token) {
        if (ROUTE_COUNTS_DEBUG) {
          console.log('[RouteQC] MeetingCounts: token missing, retry on next state change', {
            startKey,
            endKey,
          });
        }
        return;
      }
      getCalendarEventsRaw(token, windowStart, windowEnd)
        .then((events) => {
          const counts: Record<string, number> = {};
          for (const ev of events) {
            if (ev.startIso) {
              try {
                const key = toLocalDayKey(new Date(ev.startIso));
                counts[key] = (counts[key] ?? 0) + 1;
              } catch {
                /* skip */
              }
            }
          }
          setMeetingCountByDay((prev) => {
            let changed = false;
            const merged = { ...prev };
            let d = new Date(windowStart);
            while (!isAfter(d, windowEnd)) {
              const key = toLocalDayKey(d);
              const count = counts[key] ?? 0;
              if (count === 0 && merged[key] !== undefined) {
                delete merged[key];
                changed = true;
              } else if (count > 0 && merged[key] !== count) {
                merged[key] = count;
                changed = true;
              }
              d = addDays(d, 1);
            }
            return changed ? merged : prev;
          });
          setLoadedRange((prev) => {
            const nextStart = prev ? (prev.start <= startKey ? prev.start : startKey) : startKey;
            const nextEnd = prev ? (prev.end >= endKey ? prev.end : endKey) : endKey;
            if (prev && prev.start === nextStart && prev.end === nextEnd) return prev;
            return { start: nextStart, end: nextEnd };
          });
          if (ROUTE_COUNTS_DEBUG) {
            const dotCount = Object.values(counts).filter((count) => count > 0).length;
            console.log('[RouteQC] MeetingCounts: remote success', {
              startKey,
              endKey,
              events: events.length,
              dotCount,
            });
          }
        })
        .catch((error) => {
          if (ROUTE_COUNTS_DEBUG) {
            console.log('[RouteQC] MeetingCounts: remote error', {
              startKey,
              endKey,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
    },
    [shouldSyncCalendar, userToken, getValidToken, loadedRange, setMeetingCountByDay, setLoadedRange]
  );
}
