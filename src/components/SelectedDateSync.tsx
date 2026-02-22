/**
 * Syncs appointments to selectedDate. When selectedDate changes (from Schedule or Map DaySlider),
 * fetches for that date and updates RouteContext. Single source of fetch - Map just displays.
 * Clears appointments immediately when switching days so we never show another day's data.
 * Preloads appointments for the next 5 days in the background for faster day switching.
 */
import { useCallback, useEffect, useRef } from 'react';
import { startOfDay, endOfDay, addDays } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import { useRoute } from '../context/RouteContext';
import { getCalendarEvents, GraphUnauthorizedError } from '../services/graph';
import { sortAppointmentsByTime } from '../utils/optimization';
import { toLocalDayKey } from '../utils/dateUtils';

const PRELOAD_DAYS_AHEAD = 5;

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
  const { userToken, getValidToken, signOut } = useAuth();
  const {
    selectedDate,
    refreshTrigger,
    setAppointments,
    setAppointmentsLoading,
    getDayOrder,
    pendingLocalEvent,
    setPendingLocalEvent,
  } = useRoute();
  const dayCache = useRef<Map<string, Awaited<ReturnType<typeof sortAppointmentsByTime>>>>(new Map());
  const isFirstRun = useRef(true);
  const lastRefreshTrigger = useRef(0);

  /** Merge pending local event into list for this day (so newly confirmed meeting shows immediately). */
  const mergePendingIfSameDay = useCallback(
    (dayKey: string, list: Awaited<ReturnType<typeof sortAppointmentsByTime>>) => {
      if (!pendingLocalEvent || pendingLocalEvent.dayKey !== dayKey) return list;
      const hasId = list.some((e) => e.id === pendingLocalEvent.event.id);
      if (hasId) return list;
      const merged = sortAppointmentsByTime([...list, { ...pendingLocalEvent.event, status: 'pending' as const }]);
      setPendingLocalEvent(null);
      return merged;
    },
    [pendingLocalEvent, setPendingLocalEvent]
  );

  const fetchForDate = useCallback(
    async (date: Date) => {
      const token = userToken ?? (getValidToken ? await getValidToken() : null);
      if (!token) {
        setAppointments([]);
        return;
      }
      const dayKey = toLocalDayKey(date);
      const cached = dayCache.current.get(dayKey);
      if (cached) {
        const merged = mergePendingIfSameDay(dayKey, cached);
        setAppointments(merged);
        setAppointmentsLoading(false);
        return;
      }
      setAppointmentsLoading(true);
      const start = startOfDay(date);
      const end = endOfDay(date);
      try {
        const [events, savedOrder] = await Promise.all([
          getCalendarEvents(token, start, end),
          getDayOrder(dayKey),
        ]);
        const sorted = sortAppointmentsByTime(events);
        const ordered = applyOrderSync(sorted, savedOrder);
        const merged = mergePendingIfSameDay(dayKey, ordered);
        dayCache.current.set(dayKey, merged);
        setAppointments(merged);
      } catch (e) {
        setAppointments([]);
        if (e instanceof GraphUnauthorizedError) signOut();
      } finally {
        setAppointmentsLoading(false);
      }
    },
    [userToken, getValidToken, setAppointments, setAppointmentsLoading, getDayOrder, signOut, mergePendingIfSameDay]
  );

  /** Fetch a day and store only in cache (for preloading). Does not update context. */
  const preloadOneDay = useCallback(
    async (date: Date) => {
      const token = userToken ?? (getValidToken ? await getValidToken() : null);
      if (!token) return;
      const dayKey = toLocalDayKey(date);
      if (dayCache.current.has(dayKey)) return;
      const start = startOfDay(date);
      const end = endOfDay(date);
      try {
        const [events, savedOrder] = await Promise.all([
          getCalendarEvents(token, start, end),
          getDayOrder(dayKey),
        ]);
        const sorted = sortAppointmentsByTime(events);
        const ordered = applyOrderSync(sorted, savedOrder);
        dayCache.current.set(dayKey, ordered);
      } catch {
        // ignore; preload is best-effort
      }
    },
    [userToken, getValidToken, getDayOrder]
  );

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    const dayKey = toLocalDayKey(selectedDate);
    const cached = dayCache.current.get(dayKey);
    if (cached) {
      const merged = mergePendingIfSameDay(dayKey, cached);
      if (merged !== cached) dayCache.current.set(dayKey, merged);
      setAppointments(merged);
      setAppointmentsLoading(false);
      return;
    }
    setAppointments([]);
    setAppointmentsLoading(true);
    fetchForDate(selectedDate);
  }, [selectedDate, fetchForDate, setAppointments, setAppointmentsLoading, mergePendingIfSameDay]);

  useEffect(() => {
    if (!userToken && !getValidToken) return;
    for (let i = 1; i <= PRELOAD_DAYS_AHEAD; i++) {
      preloadOneDay(addDays(selectedDate, i));
    }
  }, [selectedDate, userToken, getValidToken, preloadOneDay]);

  useEffect(() => {
    if (refreshTrigger === lastRefreshTrigger.current) return;
    lastRefreshTrigger.current = refreshTrigger;
    dayCache.current.delete(toLocalDayKey(selectedDate));
    fetchForDate(selectedDate);
  }, [refreshTrigger, selectedDate, fetchForDate]);

  return null;
}
