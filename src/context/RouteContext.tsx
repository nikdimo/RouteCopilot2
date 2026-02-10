import React, { createContext, useContext, useState, useCallback } from 'react';
import type { CalendarEvent } from '../services/graph';
import { optimizeRoute } from '../utils/optimization';

export type UserLocation = { latitude: number; longitude: number };

type RouteContextValue = {
  appointments: CalendarEvent[];
  setAppointments: (events: CalendarEvent[]) => void;
  optimize: (userLocation: UserLocation) => void;
};

const RouteContext = createContext<RouteContextValue | null>(null);

export function RouteProvider({ children }: { children: React.ReactNode }) {
  const [appointments, setAppointmentsState] = useState<CalendarEvent[]>([]);

  const setAppointments = useCallback((events: CalendarEvent[]) => {
    setAppointmentsState(events);
  }, []);

  const optimize = useCallback((userLocation: UserLocation) => {
    setAppointmentsState((current) => {
      const withCoords = current.filter((a) => a.coordinates != null);
      const withoutCoords = current.filter((a) => a.coordinates == null);
      const sorted = optimizeRoute(userLocation, current);
      return sorted.length > 0 ? [...sorted, ...withoutCoords] : current;
    });
  }, []);

  const value: RouteContextValue = {
    appointments,
    setAppointments,
    optimize,
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
