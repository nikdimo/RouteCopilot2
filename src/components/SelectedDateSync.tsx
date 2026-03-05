/**
 * Syncs appointments to selectedDate. When selectedDate changes (from Schedule or Map DaySlider),
 * fetches for that date and updates RouteContext. Single source of fetch - Map just displays.
 * Clears appointments immediately when switching days so we never show another day's data.
 * Preloads appointments for the next 5 days in the background for faster day switching.
 */
import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { startOfDay, endOfDay, addDays, subDays } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import { useRoute } from '../context/RouteContext';
import { useUserPreferences } from '../context/UserPreferencesContext';
import { getCalendarEventsRaw, enrichCalendarEventsAll, GraphUnauthorizedError } from '../services/graph';
import { clearGraphSession, isMagicAuthToken } from '../services/graphAuth';
import { getLocalMeetingsForDay } from '../services/localMeetings';
import { sortAppointmentsByTime } from '../utils/optimization';
import { toLocalDayKey } from '../utils/dateUtils';
import { getEffectiveSubscriptionTier, getTierEntitlements } from '../utils/subscription';
import { useEnsureMeetingCountsForDate } from '../hooks/useEnsureMeetingCountsForDate';
import { getMeetingSyncMode } from '../utils/meetingSyncMode';

const PRELOAD_DAYS_AHEAD = 5;

/** Route diagnostics for auth/fetch/count sync races. */
const ROUTE_QC_LOG = __DEV__ || Platform.OS === 'android' || process.env.EXPO_PUBLIC_DEBUG_ROUTE_SYNC === '1';

function applyOrderSync(
  events: Awaited<ReturnType<typeof sortAppointmentsByTime>>,
  order: string[] | null
): Awaited<ReturnType<typeof sortAppointmentsByTime>> {
  if (!order || order.length === 0) return events;
  const byId = new Map(events.map((e) => [e.id, e]));
  const result: typeof events = [];
  for (const id of order) {
    const ev = byId.get(id);
    if (ev) {
      result.push(ev);
      byId.delete(id);
    }
  }
  byId.forEach((ev) => result.push(ev));
  return result;
}

export default function SelectedDateSync() {
  const { userToken, getValidToken, signOut, isRestoringSession } = useAuth();
  const { preferences } = useUserPreferences();
  const subscriptionTier = getEffectiveSubscriptionTier(preferences, Boolean(userToken));
  const { canSyncCalendar } = getTierEntitlements(subscriptionTier);
  // Avoid startup races where preferences still report `free` while signed-in auth is already ready.
  const shouldSyncCalendar = canSyncCalendar || Boolean(userToken);
  const syncMode = getMeetingSyncMode(shouldSyncCalendar, Boolean(userToken));
  const ensureMeetingCountsForDate = useEnsureMeetingCountsForDate();
  const {
    selectedDate,
    refreshTrigger,
    meetingCountByDay,
    setAppointments,
    setAppointmentsRequestState,
    setAppointmentsEnriching,
    getDayOrder,
    pendingLocalEvent,
    setPendingLocalEvent,
  } = useRoute();
  const dayCache = useRef<Map<string, Awaited<ReturnType<typeof sortAppointmentsByTime>>>>(new Map());
  const lastRefreshTrigger = useRef(0);
  const lastSyncModeRef = useRef<string | null>(null);
  /** Track which day is currently "active" so background enrichment doesn't clobber a switched day. */
  const activeDayKey = useRef<string>('');

  const pendingEventRef = useRef(pendingLocalEvent);
  useEffect(() => {
    pendingEventRef.current = pendingLocalEvent;
  }, [pendingLocalEvent]);

  useEffect(() => {
    if (lastSyncModeRef.current !== syncMode) {
      if (ROUTE_QC_LOG) {
        console.log('[RouteQC] SelectedDateSync: sync mode changed -> clear day cache', {
          from: lastSyncModeRef.current,
          to: syncMode,
        });
      }
      dayCache.current.clear();
      activeDayKey.current = '';
      lastSyncModeRef.current = syncMode;
    }
  }, [syncMode]);

  /** Merge pending local event into list for this day (so newly confirmed meeting shows immediately). */
  const mergePendingIfSameDay = useCallback(
    (dayKey: string, list: Awaited<ReturnType<typeof sortAppointmentsByTime>>) => {
      const pending = pendingEventRef.current;
      if (!pending || pending.dayKey !== dayKey) return list;
      const hasId = list.some((e) => e.id === pending.event.id);
      if (hasId) return list;
      const merged = sortAppointmentsByTime([...list, { ...pending.event, status: 'pending' as const }]);
      setPendingLocalEvent(null);
      return merged;
    },
    [setPendingLocalEvent]
  );

  const fetchForDate = useCallback(
    async (date: Date, options?: { forceNetwork?: boolean }) => {
      const forceNetwork = options?.forceNetwork === true;
      const dayKey = toLocalDayKey(date);
      if (isRestoringSession) {
        setAppointmentsRequestState('loading');
        setAppointmentsEnriching(false);
        return;
      }
      if (!shouldSyncCalendar) {
        try {
          const localEvents = await getLocalMeetingsForDay(dayKey);
          const localSorted = sortAppointmentsByTime(localEvents);
          const localMerged = mergePendingIfSameDay(dayKey, localSorted);
          dayCache.current.set(dayKey, localMerged);
          setAppointments(localMerged);
          setAppointmentsRequestState('success');
          setAppointmentsEnriching(false);
        } catch {
          setAppointments([]);
          setAppointmentsRequestState('error', 'Could not load local meetings.');
          setAppointmentsEnriching(false);
        }
        return;
      }
      const token = userToken ?? (getValidToken ? await getValidToken() : null);
      if (!token) {
        if (ROUTE_QC_LOG) {
          console.log('[RouteQC] SelectedDateSync: token missing, keep loading', {
            dayKey,
            syncMode,
          });
        }
        setAppointmentsRequestState('loading');
        setAppointmentsEnriching(false);
        return;
      }
      activeDayKey.current = dayKey;

      // ── Serve from cache immediately if available ──
      const cached = dayCache.current.get(dayKey);
      if (cached && !forceNetwork) {
        const merged = mergePendingIfSameDay(dayKey, cached);
        const hasUnresolvedAddresses = merged.some(
          (e) => !e.coordinates && (e.location?.trim() ?? '') !== ''
        );
        if (ROUTE_QC_LOG) {
          const withCoords = merged.filter((e) => e.coordinates != null);
          console.log('[RouteQC] SelectedDateSync: from cache', {
            dayKey,
            total: merged.length,
            withCoordinates: withCoords.length,
            hasUnresolvedAddresses,
          });
        }
        setAppointments(merged);
        setAppointmentsRequestState('success');
        setAppointmentsEnriching(hasUnresolvedAddresses);

        // Cached entries may come from raw-only fallback; retry enrichment in background.
        if (hasUnresolvedAddresses) {
          enrichCalendarEventsAll(token, merged)
            .then((enrichedFromCache) => {
              if (activeDayKey.current !== dayKey) return;
              const reordered = applyOrderSync(sortAppointmentsByTime(enrichedFromCache), merged.map((e) => e.id));
              const mergedEnriched = mergePendingIfSameDay(dayKey, reordered);
              dayCache.current.set(dayKey, mergedEnriched);
              setAppointments(mergedEnriched);
              setAppointmentsEnriching(false);
              if (ROUTE_QC_LOG) {
                const withCoords = mergedEnriched.filter((e) => e.coordinates != null);
                console.log('[RouteQC] SelectedDateSync: cache enrichment set', {
                  dayKey,
                  total: mergedEnriched.length,
                  withCoordinates: withCoords.length,
                });
              }
            })
            .catch(() => {
              if (activeDayKey.current === dayKey) setAppointmentsEnriching(false);
            });
        }
        return;
      }

      setAppointmentsRequestState('loading');
      setAppointmentsEnriching(false);
      const start = startOfDay(date);
      const end = endOfDay(date);

      try {
        // ── Phase 1: Fast raw fetch — show list immediately ──
        const [rawEvents, savedOrder] = await Promise.all([
          getCalendarEventsRaw(token, start, end),
          getDayOrder(dayKey),
        ]);
        const rawSorted = sortAppointmentsByTime(rawEvents);
        const rawOrdered = applyOrderSync(rawSorted, savedOrder);
        const rawMerged = mergePendingIfSameDay(dayKey, rawOrdered);

        if (activeDayKey.current === dayKey) {
          if (ROUTE_QC_LOG) {
            const withCoords = rawMerged.filter((e) => e.coordinates != null);
            console.log('[RouteQC] SelectedDateSync: raw set', {
              dayKey,
              total: rawMerged.length,
              withCoordinates: withCoords.length,
            });
          }
          setAppointments(rawMerged);
          setAppointmentsRequestState('success');
          const hasUnresolvedAddresses = rawMerged.some(
            (e) => !e.coordinates && (e.location?.trim() ?? '') !== ''
          );
          setAppointmentsEnriching(hasUnresolvedAddresses);
        }

        // ── Phase 2: Enrich in background (geocoding + contacts) ──
        enrichCalendarEventsAll(token, rawEvents)
          .then((enriched) => {
            if (activeDayKey.current !== dayKey) return; // user switched day
            const enrichedSorted = sortAppointmentsByTime(enriched);
            const enrichedOrdered = applyOrderSync(enrichedSorted, savedOrder);
            const enrichedMerged = mergePendingIfSameDay(dayKey, enrichedOrdered);
            dayCache.current.set(dayKey, enrichedMerged);
            if (ROUTE_QC_LOG) {
              const withCoords = enrichedMerged.filter((e) => e.coordinates != null);
              console.log('[RouteQC] SelectedDateSync: enriched set', {
                dayKey,
                total: enrichedMerged.length,
                withCoordinates: withCoords.length,
              });
            }
            setAppointments(enrichedMerged);
            setAppointmentsEnriching(false);
          })
          .catch(() => {
            // enrichment failed — raw events already displayed, cache raw as fallback
            dayCache.current.set(dayKey, rawMerged);
            if (activeDayKey.current === dayKey) {
              setAppointmentsEnriching(false);
            }
          });
      } catch (e) {
        if (activeDayKey.current === dayKey) {
          setAppointments([]);
          setAppointmentsRequestState('error', 'Could not load meetings from calendar.');
          setAppointmentsEnriching(false);
        }
        if (e instanceof GraphUnauthorizedError) {
          await clearGraphSession().catch(() => {});
          if (userToken && !isMagicAuthToken(userToken)) {
            signOut();
          }
        }
      }
    },
    [isRestoringSession, shouldSyncCalendar, syncMode, userToken, getValidToken, setAppointments, setAppointmentsRequestState, setAppointmentsEnriching, getDayOrder, signOut, mergePendingIfSameDay]
  );

  /** Preload a future day fully (raw + enrich) and store in cache. Does not update context. */
  const preloadOneDay = useCallback(
    async (date: Date) => {
      if (!shouldSyncCalendar) return;
      const token = userToken ?? (getValidToken ? await getValidToken() : null);
      if (!token) return;
      const dayKey = toLocalDayKey(date);
      if (dayCache.current.has(dayKey)) return;
      const start = startOfDay(date);
      const end = endOfDay(date);
      try {
        // Raw first → cache immediately so date switches feel instant
        const [rawEvents, savedOrder] = await Promise.all([
          getCalendarEventsRaw(token, start, end),
          getDayOrder(dayKey),
        ]);
        const rawSorted = sortAppointmentsByTime(rawEvents);
        const rawOrdered = applyOrderSync(rawSorted, savedOrder);
        dayCache.current.set(dayKey, rawOrdered);

        // Then enrich and update cache with richer data
        enrichCalendarEventsAll(token, rawEvents)
          .then((enriched) => {
            const enrichedSorted = sortAppointmentsByTime(enriched);
            const enrichedOrdered = applyOrderSync(enrichedSorted, savedOrder);
            dayCache.current.set(dayKey, enrichedOrdered);
          })
          .catch(() => {});
      } catch {
        // ignore; preload is best-effort
      }
    },
    [shouldSyncCalendar, userToken, getValidToken, getDayOrder]
  );

  useEffect(() => {
    if (isRestoringSession) {
      setAppointmentsRequestState('loading');
      setAppointmentsEnriching(false);
      return;
    }
    const dayKey = toLocalDayKey(selectedDate);
    const cached = dayCache.current.get(dayKey);
    if (cached) {
      // In signed-in calendar mode, never trust an empty cached day.
      // It can be a stale preload and would otherwise flash a false empty-state.
      if (shouldSyncCalendar && cached.length === 0) {
        const dotCount = meetingCountByDay[dayKey] ?? 0;
        if (ROUTE_QC_LOG) {
          console.log('[RouteQC] SelectedDateSync: empty cache on selected day -> force network fetch', {
            dayKey,
            dotCount,
          });
        }
        setAppointments([]);
        setAppointmentsRequestState('loading');
        setAppointmentsEnriching(false);
        fetchForDate(selectedDate, { forceNetwork: true });
        return;
      }
      // Reuse fetchForDate even for cache hits so cached-raw days can self-heal via background enrichment.
      fetchForDate(selectedDate);
      return;
    }
    setAppointments([]);
    setAppointmentsRequestState('loading');
    setAppointmentsEnriching(false);
    fetchForDate(selectedDate);
  }, [isRestoringSession, selectedDate, shouldSyncCalendar, meetingCountByDay, fetchForDate, setAppointments, setAppointmentsRequestState, setAppointmentsEnriching]);

  useEffect(() => {
    if (!shouldSyncCalendar) return;
    if (!userToken && !getValidToken) return;
    let cancelled = false;
    const run = async () => {
      // Preload yesterday for instant day switch when going back
      preloadOneDay(subDays(selectedDate, 1));
      for (let i = 1; i <= PRELOAD_DAYS_AHEAD; i++) {
        if (cancelled) return;
        preloadOneDay(addDays(selectedDate, i));
        if (i < PRELOAD_DAYS_AHEAD) await new Promise((r) => setTimeout(r, 400));
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [shouldSyncCalendar, selectedDate, userToken, getValidToken, preloadOneDay]);

  useEffect(() => {
    if (isRestoringSession) return;
    ensureMeetingCountsForDate(selectedDate).catch(() => {});
  }, [isRestoringSession, selectedDate, syncMode, ensureMeetingCountsForDate]);

  useEffect(() => {
    if (refreshTrigger === lastRefreshTrigger.current) return;
    lastRefreshTrigger.current = refreshTrigger;
    dayCache.current.delete(toLocalDayKey(selectedDate));
    fetchForDate(selectedDate, { forceNetwork: true });
    ensureMeetingCountsForDate(selectedDate, true).catch(() => {});
  }, [refreshTrigger, selectedDate, fetchForDate, ensureMeetingCountsForDate]);

  return null;
}
