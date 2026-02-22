import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { startOfDay } from 'date-fns';
import type { CalendarEvent } from '../services/graph';
import { optimizeRoute } from '../utils/optimization';

export type UserLocation = { latitude: number; longitude: number };

const COMPLETED_IDS_KEY = 'routeCopilot_completedEventIds';
const DAY_ORDER_PREFIX = 'routeCopilot_dayOrder_';

// ─── Meeting counts cache ─────────────────────────────────────────────────────
// Persists meetingCountByDay so DaySlider dots appear instantly on every launch
// instead of waiting for the ±30 day Graph API fetch to complete.
const COUNTS_CACHE_KEY = 'routeCopilot_meetingCounts';
const COUNTS_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

type CountsCache = { counts: Record<string, number>; savedAt: number };

/** Synchronous read from localStorage — web only. Used in useState initialiser for zero-flash display. */
function loadCountsCacheSync(): Record<string, number> {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(COUNTS_CACHE_KEY);
    if (!raw) return {};
    const { counts, savedAt } = JSON.parse(raw) as CountsCache;
    if (Date.now() - savedAt > COUNTS_CACHE_TTL_MS) return {};
    return counts;
  } catch {
    return {};
  }
}

type RouteContextValue = {
  selectedDate: Date;
  setSelectedDate: (d: Date | ((prev: Date) => Date)) => void;
  meetingCountByDay: Record<string, number>;
  setMeetingCountByDay: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  loadedRange: { start: string; end: string } | null;
  setLoadedRange: React.Dispatch<React.SetStateAction<{ start: string; end: string } | null>>;
  /** Call to force refetch for current selectedDate (e.g. pull-to-refresh) */
  triggerRefresh: () => void;
  refreshTrigger: number;
  appointments: CalendarEvent[];
  appointmentsLoading: boolean;
  setAppointmentsLoading: (loading: boolean) => void;
  setAppointments: (events: CalendarEvent[]) => void;
  addAppointment: (event: CalendarEvent) => void;
  updateAppointment: (eventId: string, patch: Partial<CalendarEvent>) => void;
  removeAppointment: (eventId: string) => void;
  optimize: (userLocation: UserLocation) => void;
  markEventAsDone: (eventId: string) => void;
  unmarkEventAsDone: (eventId: string) => void;
  /** Persist current appointment order for a day (YYYY-MM-DD). */
  saveDayOrder: (dayKey: string, eventIds: string[]) => Promise<void>;
  /** Load saved order for a day. Returns null if none. */
  getDayOrder: (dayKey: string) => Promise<string[] | null>;
  /** Reorder appointments to match saved order; append events not in saved. */
  applyDayOrder: (events: CalendarEvent[], dayKey: string) => Promise<CalendarEvent[]>;
  /** When set, SelectedDateSync merges this event into the day's list (so new meeting shows immediately). */
  pendingLocalEvent: { dayKey: string; event: CalendarEvent } | null;
  setPendingLocalEvent: (p: { dayKey: string; event: CalendarEvent } | null) => void;
  /** When set from schedule (e.g. tap waypoint number), map highlights that waypoint/leg. Map consumes and clears. */
  highlightWaypointIndex: number | null;
  setHighlightWaypointIndex: (index: number | null) => void;
};

const RouteContext = createContext<RouteContextValue | null>(null);

export function RouteProvider({ children }: { children: React.ReactNode }) {
  const [selectedDate, setSelectedDate] = useState<Date>(() => startOfDay(new Date()));
  // Initialised from localStorage synchronously on web → dots appear on first paint with no flash.
  // On native, AsyncStorage read happens in the effect below (fast, but async).
  const [meetingCountByDay, setMeetingCountByDay] = useState<Record<string, number>>(loadCountsCacheSync);
  const [loadedRange, setLoadedRange] = useState<{ start: string; end: string } | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const triggerRefresh = useCallback(() => setRefreshTrigger((n) => n + 1), []);
  const [appointments, setAppointmentsState] = useState<CalendarEvent[]>([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);
  const [pendingLocalEvent, setPendingLocalEvent] = useState<{ dayKey: string; event: CalendarEvent } | null>(null);
  const [highlightWaypointIndex, setHighlightWaypointIndex] = useState<number | null>(null);
  const [completedEventIds, setCompletedEventIds] = useState<string[]>([]);
  const completedIdsRef = useRef<string[]>([]);
  completedIdsRef.current = completedEventIds;

  useEffect(() => {
    AsyncStorage.getItem(COMPLETED_IDS_KEY)
      .then((raw) => {
        if (raw) {
          try {
            const arr = JSON.parse(raw) as string[];
            if (Array.isArray(arr)) setCompletedEventIds(arr);
          } catch {
            // ignore invalid JSON
          }
        }
      })
      .catch(() => {});
  }, []);

  // ── Meeting counts cache: load on native (web already loaded synchronously above) ──
  useEffect(() => {
    if (Platform.OS === 'web') return;
    AsyncStorage.getItem(COUNTS_CACHE_KEY)
      .then((raw) => {
        if (!raw) return;
        const { counts, savedAt } = JSON.parse(raw) as CountsCache;
        if (Date.now() - savedAt > COUNTS_CACHE_TTL_MS) return;
        setMeetingCountByDay((prev) =>
          Object.keys(prev).length > 0 ? prev : counts
        );
      })
      .catch(() => {});
  }, []);

  // ── Meeting counts cache: persist whenever counts update ──
  useEffect(() => {
    if (Object.keys(meetingCountByDay).length === 0) return;
    const payload: CountsCache = { counts: meetingCountByDay, savedAt: Date.now() };
    const serialized = JSON.stringify(payload);
    AsyncStorage.setItem(COUNTS_CACHE_KEY, serialized).catch(() => {});
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      try { window.localStorage.setItem(COUNTS_CACHE_KEY, serialized); } catch { /* ignore */ }
    }
  }, [meetingCountByDay]);

  const setAppointments = useCallback((events: CalendarEvent[]) => {
    const completedSet = new Set(completedIdsRef.current);
    const merged = events.map((ev) => ({
      ...ev,
      status: completedSet.has(ev.id) ? ('completed' as const) : (ev.status ?? ('pending' as const)),
    }));
    setAppointmentsState(merged);
  }, []);

  const addAppointment = useCallback((event: CalendarEvent) => {
    setAppointmentsState((prev) => [...prev, { ...event, status: 'pending' as const }]);
  }, []);

  const updateAppointment = useCallback((eventId: string, patch: Partial<CalendarEvent>) => {
    setAppointmentsState((prev) =>
      prev.map((ev) => (ev.id === eventId ? { ...ev, ...patch } : ev))
    );
  }, []);

  const removeAppointment = useCallback((eventId: string) => {
    setCompletedEventIds((prev) => {
      const next = prev.filter((id) => id !== eventId);
      AsyncStorage.setItem(COMPLETED_IDS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
    setAppointmentsState((prev) => prev.filter((ev) => ev.id !== eventId));
  }, []);

  useEffect(() => {
    if (completedEventIds.length === 0) return;
    setAppointmentsState((current) => {
      const completedSet = new Set(completedEventIds);
      let changed = false;
      const next = current.map((ev) => {
        if (completedSet.has(ev.id) && ev.status !== 'completed') {
          changed = true;
          return { ...ev, status: 'completed' as const };
        }
        return ev;
      });
      return changed ? next : current;
    });
  }, [completedEventIds]);

  const optimize = useCallback((userLocation: UserLocation) => {
    setAppointmentsState((current) => {
      const withCoords = current.filter((a) => a.coordinates != null);
      const withoutCoords = current.filter((a) => a.coordinates == null);
      const sorted = optimizeRoute(userLocation, current);
      return sorted.length > 0 ? [...sorted, ...withoutCoords] : current;
    });
  }, []);

  const markEventAsDone = useCallback((eventId: string) => {
    setCompletedEventIds((prev) => {
      if (prev.includes(eventId)) return prev;
      const next = [...prev, eventId];
      AsyncStorage.setItem(COMPLETED_IDS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
    setAppointmentsState((current) =>
      current.map((ev) =>
        ev.id === eventId ? { ...ev, status: 'completed' as const } : ev
      )
    );
  }, []);

  const unmarkEventAsDone = useCallback((eventId: string) => {
    setCompletedEventIds((prev) => {
      if (!prev.includes(eventId)) return prev;
      const next = prev.filter((id) => id !== eventId);
      AsyncStorage.setItem(COMPLETED_IDS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
    setAppointmentsState((current) =>
      current.map((ev) =>
        ev.id === eventId ? { ...ev, status: 'pending' as const } : ev
      )
    );
  }, []);

  const saveDayOrder = useCallback(async (dayKey: string, eventIds: string[]) => {
    await AsyncStorage.setItem(DAY_ORDER_PREFIX + dayKey, JSON.stringify(eventIds));
  }, []);

  const getDayOrder = useCallback(async (dayKey: string): Promise<string[] | null> => {
    try {
      const raw = await AsyncStorage.getItem(DAY_ORDER_PREFIX + dayKey);
      if (!raw) return null;
      const arr = JSON.parse(raw) as unknown;
      return Array.isArray(arr) ? (arr as string[]) : null;
    } catch {
      return null;
    }
  }, []);

  const applyDayOrder = useCallback(
    async (events: CalendarEvent[], dayKey: string): Promise<CalendarEvent[]> => {
      const order = await getDayOrder(dayKey);
      if (!order || order.length === 0) return events;
      const byId = new Map(events.map((e) => [e.id, e]));
      const result: CalendarEvent[] = [];
      for (const id of order) {
        const ev = byId.get(id);
        if (ev) {
          result.push(ev);
          byId.delete(id);
        }
      }
      byId.forEach((ev) => result.push(ev));
      return result;
    },
    [getDayOrder]
  );

  const value: RouteContextValue = {
    selectedDate,
    setSelectedDate,
    meetingCountByDay,
    setMeetingCountByDay,
    loadedRange,
    setLoadedRange,
    triggerRefresh,
    refreshTrigger,
    appointments,
    appointmentsLoading,
    setAppointmentsLoading,
    setAppointments,
    addAppointment,
    updateAppointment,
    removeAppointment,
    optimize,
    markEventAsDone,
    unmarkEventAsDone,
    saveDayOrder,
    getDayOrder,
    applyDayOrder,
    pendingLocalEvent,
    setPendingLocalEvent,
    highlightWaypointIndex,
    setHighlightWaypointIndex,
  };

  return (
    <RouteContext.Provider value={value}>
      {children}
    </RouteContext.Provider>
  );
}

export function useRoute() {
  const ctx = useContext(RouteContext);
  if (!ctx) {
    throw new Error('useRoute must be used within RouteProvider');
  }
  return ctx;
}
