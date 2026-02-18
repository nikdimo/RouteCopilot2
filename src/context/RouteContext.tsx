import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CalendarEvent } from '../services/graph';
import { optimizeRoute } from '../utils/optimization';

export type UserLocation = { latitude: number; longitude: number };

const COMPLETED_IDS_KEY = 'routeCopilot_completedEventIds';
const DAY_ORDER_PREFIX = 'routeCopilot_dayOrder_';

type RouteContextValue = {
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
};

const RouteContext = createContext<RouteContextValue | null>(null);

export function RouteProvider({ children }: { children: React.ReactNode }) {
  const [appointments, setAppointmentsState] = useState<CalendarEvent[]>([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);
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
