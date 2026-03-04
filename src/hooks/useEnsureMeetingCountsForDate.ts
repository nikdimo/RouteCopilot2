import { useCallback } from 'react';
import { addDays, endOfDay, startOfDay, isAfter } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import { useRoute } from '../context/RouteContext';
import { useUserPreferences } from '../context/UserPreferencesContext';
import { getCalendarEventsRaw } from '../services/graph';
import { getLocalMeetingCountsInRange } from '../services/localMeetings';
import { toLocalDayKey } from '../utils/dateUtils';
import { getEffectiveSubscriptionTier, getTierEntitlements } from '../utils/subscription';

export function useEnsureMeetingCountsForDate() {
  const { userToken, getValidToken } = useAuth();
  const { loadedRange, setMeetingCountByDay, setLoadedRange } = useRoute();
  const { preferences } = useUserPreferences();
  const subscriptionTier = getEffectiveSubscriptionTier(preferences, Boolean(userToken));
  const { canSyncCalendar } = getTierEntitlements(subscriptionTier);

  return useCallback(
    async (date: Date, forceRefetch?: boolean) => {
      const windowStart = startOfDay(addDays(date, -30));
      const windowEnd = endOfDay(addDays(date, 30));
      const startKey = toLocalDayKey(windowStart);
      const endKey = toLocalDayKey(windowEnd);

      if (!canSyncCalendar) {
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
        return;
      }

      if (!forceRefetch && loadedRange && loadedRange.start <= startKey && loadedRange.end >= endKey) return;

      const token = userToken ?? (getValidToken ? await getValidToken() : null);
      if (!token) return;
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
        })
        .catch(() => { });
    },
    [canSyncCalendar, userToken, getValidToken, loadedRange, setMeetingCountByDay, setLoadedRange]
  );
}
