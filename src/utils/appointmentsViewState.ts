export type AppointmentsRequestLikeStatus = 'idle' | 'loading' | 'success' | 'error';

export type AppointmentsViewState = 'loading' | 'error' | 'empty' | 'ready';

export function getAppointmentsViewState(
  status: AppointmentsRequestLikeStatus,
  meetingsCount: number
): AppointmentsViewState {
  if (status === 'error') return 'error';
  if (status === 'idle' || status === 'loading') return 'loading';
  return meetingsCount > 0 ? 'ready' : 'empty';
}
