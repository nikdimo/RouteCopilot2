import { useCallback } from 'react';
import { startOfDay, endOfDay } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import { useRoute } from '../context/RouteContext';
import { useUserPreferences } from '../context/UserPreferencesContext';
import { getCalendarEvents, GraphUnauthorizedError } from '../services/graph';
import { clearGraphSession, isMagicAuthToken } from '../services/graphAuth';
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
  const { userToken, signOut, getValidToken, isRestoringSession } = useAuth();
  const { setAppointments, setAppointmentsRequestState } = useRoute();
  const { preferences } = useUserPreferences();
  const subscriptionTier = getEffectiveSubscriptionTier(preferences, Boolean(userToken));
  const { canSyncCalendar } = getTierEntitlements(subscriptionTier);
  const shouldSyncCalendar = canSyncCalendar || Boolean(userToken);

  const load = useCallback(async () => {
    const targetDate = date ?? startOfDay(new Date());
    if (isRestoringSession) {
      setAppointmentsRequestState('loading');
      return;
    }
    if (!shouldSyncCalendar) {
      setAppointmentsRequestState('loading');
      const dayKey = toLocalDayKey(targetDate);
      getLocalMeetingsForDay(dayKey)
        .then((events) => {
          const sorted = sortAppointmentsByTime(events);
          setAppointments(sorted);
          setAppointmentsRequestState('success');
        })
        .catch(() => {
          setAppointments([]);
          setAppointmentsRequestState('error', 'Could not load local meetings.');
        })
      return;
    }
    const token = userToken ?? (getValidToken ? await getValidToken() : null);
    if (!token) {
      setAppointmentsRequestState('loading');
      return;
    }
    const start = startOfDay(targetDate);
    const end = endOfDay(targetDate);
    setAppointmentsRequestState('loading');
    getCalendarEvents(token, start, end)
      .then((events) => {
        const sorted = sortAppointmentsByTime(events);
        setAppointments(sorted);
        setAppointmentsRequestState('success');
      })
      .catch((e) => {
        setAppointments([]);
        setAppointmentsRequestState('error', 'Could not load meetings from calendar.');
        if (e instanceof GraphUnauthorizedError) {
          clearGraphSession().catch(() => {});
          if (userToken && !isMagicAuthToken(userToken)) {
            signOut();
          }
        }
      })
  }, [isRestoringSession, shouldSyncCalendar, userToken, getValidToken, setAppointments, setAppointmentsRequestState, signOut, date]);

  return { load };
}
