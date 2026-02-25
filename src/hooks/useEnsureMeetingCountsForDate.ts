import { useCallback } from 'react';
import { addDays, endOfDay, startOfDay } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import { useRoute } from '../context/RouteContext';
import { getCalendarEventsRaw } from '../services/graph';
import { toLocalDayKey } from '../utils/dateUtils';

export function useEnsureMeetingCountsForDate() {
  const { userToken, getValidToken } = useAuth();
  const { loadedRange, setMeetingCountByDay, setLoadedRange } = useRoute();

  return useCallback(
    async (date: Date, forceRefetch?: boolean) => {
      const token = userToken ?? (getValidToken ? await getValidToken() : null);
      if (!token) return;
      const windowStart = startOfDay(addDays(date, -30));
      const windowEnd = endOfDay(addDays(date, 30));
      const startKey = toLocalDayKey(windowStart);
      const endKey = toLocalDayKey(windowEnd);
      if (!forceRefetch && loadedRange && loadedRange.start <= startKey && loadedRange.end >= endKey) return;
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
            const merged = { ...prev };
            for (const [k, v] of Object.entries(counts)) merged[k] = v;
            return merged;
          });
          setLoadedRange((prev) => ({
            start: prev ? (prev.start <= startKey ? prev.start : startKey) : startKey,
            end: prev ? (prev.end >= endKey ? prev.end : endKey) : endKey,
          }));
        })
        .catch(() => {});
    },
    [userToken, getValidToken, loadedRange, setMeetingCountByDay, setLoadedRange]
  );
}
