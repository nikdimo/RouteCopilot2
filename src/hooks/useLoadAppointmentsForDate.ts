import { useCallback } from 'react';
import { startOfDay, endOfDay } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import { useRoute } from '../context/RouteContext';
import { getCalendarEvents, GraphUnauthorizedError } from '../services/graph';
import { sortAppointmentsByTime } from '../utils/optimization';

/**
 * Hook to load appointments for a given date into RouteContext.
 * Used by: RootNavigator (on mount when authenticated), MapScreen / MapScreen.web (on focus when appointments empty).
 * ScheduleScreen uses getCalendarEvents directly for its selected date and does not use this hook.
 * @param date - Date to load; if undefined, loads today's appointments
 */
export function useLoadAppointmentsForDate(date: Date | undefined) {
  const { userToken, signOut, getValidToken } = useAuth();
  const { setAppointments, setAppointmentsLoading } = useRoute();

  const load = useCallback(async () => {
    const token = userToken ?? (getValidToken ? await getValidToken() : null);
    if (!token) {
      setAppointments([]);
      return;
    }
    const targetDate = date ?? startOfDay(new Date());
    const start = startOfDay(targetDate);
    const end = endOfDay(targetDate);
    setAppointmentsLoading(true);
    getCalendarEvents(token, start, end)
      .then((events) => {
        const sorted = sortAppointmentsByTime(events);
        setAppointments(sorted);
      })
      .catch((e) => {
        setAppointments([]);
        if (e instanceof GraphUnauthorizedError) {
          signOut();
        }
      })
      .finally(() => setAppointmentsLoading(false));
  }, [userToken, getValidToken, setAppointments, setAppointmentsLoading, signOut, date]);

  return { load };
}
