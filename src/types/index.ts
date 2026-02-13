export type Meeting = {
  id: string;
  time: string;
  clientName: string;
  address: string;
  latitude: number;
  longitude: number;
};

/** Status for calendar events / route stops */
export type EventStatus = 'pending' | 'completed' | 'skipped';

/** Working days: 0=Sun, 1=Mon, ... 6=Sat (matches Date.getDay()) */
export type WorkingDays = [boolean, boolean, boolean, boolean, boolean, boolean, boolean];

/** User profile settings for smart scheduling (Phase 7) */
export type UserPreferences = {
  workingHours: { start: string; end: string }; // "08:00", "17:00"
  postMeetingBuffer: number; // Minutes reserved AFTER meeting end (overrun/wrap-up)
  preMeetingBuffer: number; // Minutes reserved BEFORE meeting start (parking/check-in)
  /** Home base / office coordinates for anchors */
  homeBase?: { lat: number; lon: number };
  /** Display label for home base (e.g. "Copenhagen", "Hovedgaden 24") */
  homeBaseLabel?: string;
  /** Working days filter: [Sun,Mon,Tue,Wed,Thu,Fri,Sat]. Non-working days excluded from slot generation. */
  workingDays?: WorkingDays;
};

/** Default Mon–Fri enabled, Sat–Sun disabled (matches Date.getDay() 0=Sun..6=Sat) */
export const DEFAULT_WORKING_DAYS: WorkingDays = [
  false, // 0=Sun OFF
  true, true, true, true, true, // 1–5 Mon–Fri ON
  false, // 6=Sat OFF
];

export const DEFAULT_HOME_BASE = { lat: 55.6761, lon: 12.5683 } as const; // Copenhagen

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  workingHours: { start: '08:00', end: '17:00' },
  postMeetingBuffer: 15,
  preMeetingBuffer: 15,
  workingDays: DEFAULT_WORKING_DAYS,
  homeBase: DEFAULT_HOME_BASE,
};

/** Proposed time slot from smart scheduling (Phase 7) */
export type ProposedSlot = {
  start: Date;
  end: Date;
  score: number; // Lower is better
  metrics: {
    driveMinutes: number;
    waitMinutes: number;
    detourKm: number;
  };
  tags: ('Best Match' | 'Minimal Drive' | 'Cluster Bonus' | 'Early Bird')[];
};
