export const MEETING_DOT_COLOR = {
  none: 'transparent',
  green: '#107C10',
  yellow: '#F4B400',
  red: '#D13438',
} as const;

export type MeetingDotTone = keyof typeof MEETING_DOT_COLOR;

/** Dot colors by meeting count: none (0), green (1-2), yellow (3-4), red (5+). */
export function getMeetingDotTone(count: number): MeetingDotTone {
  if (count === 0) return 'none';
  if (count <= 2) return 'green';
  if (count <= 4) return 'yellow';
  return 'red';
}
