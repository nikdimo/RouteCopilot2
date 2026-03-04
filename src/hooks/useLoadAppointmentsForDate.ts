import { useCallback } from 'react';
import { startOfDay, endOfDay } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import { useRoute } from '../context/RouteContext';
import { useUserPreferences } from '../context/UserPreferencesContext';
import { getCalendarEvents, GraphUnauthorizedError } from '../services/graph';
import { getLocalMeetingsForDay } from '../services/localMeetings';
import { sortAppointmentsByTime } from '../utils/optimization';
import { toLocalDayKey } from '../utils/dateUtils';
import { getEffectiveSubscriptionTier, getTierEntitlements } from '../utils/subscription';

/**
 * Hook to load appointments for a given date into RouteContext.
 * Used by: RootNavigator (on mount when authenticated), MapScreen / MapScreen.web (on focus when appointments empty).
 * ScheduleScreen uses getCalendarEvents directly for its selected date and does not use this hook.
 * @param date - Date to load; if undefined, loads today's appointments
 */
export function useLoadAppointmentsForDate(date: Date | undefined) {
  const { userToken, signOut, getValidToken } = useAuth();
  const { setAppointments, setAppointmentsLoading } = useRoute();
  const { preferences } = useUserPreferences();
  const subscriptionTier = getEffectiveSubscriptionTier(preferences, Boolean(userToken));
  const { canSyncCalendar } = getTierEntitlements(subscriptionTier);

  const load = useCallback(async () => {
    const targetDate = date ?? startOfDay(new Date());
    if (!canSyncCalendar) {
      setAppointmentsLoading(true);
      const dayKey = toLocalDayKey(targetDate);
      getLocalMeetingsForDay(dayKey)
        .then((events) => {
          const sorted = sortAppointmentsByTime(events);
          setAppointments(sorted);
        })
        .catch(() => {
          setAppointments([]);
        })
        .finally(() => setAppointmentsLoading(false));
      return;
    }
    const token = userToken ?? (getValidToken ? await getValidToken() : null);
    if (!token) {
      setAppointments([]);
      return;
    }
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
  }, [canSyncCalendar, userToken, getValidToken, setAppointments, setAppointmentsLoading, signOut, date]);

  return { load };
}
