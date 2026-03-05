export type MeetingSyncMode = 'local' | 'remote_pending_auth' | 'remote_auth';

export function getMeetingSyncMode(shouldSyncCalendar: boolean, hasToken: boolean): MeetingSyncMode {
  if (!shouldSyncCalendar) return 'local';
  return hasToken ? 'remote_auth' : 'remote_pending_auth';
}
