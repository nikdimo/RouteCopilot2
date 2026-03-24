import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const MEETING_DECISION_LOG_KEY = 'wiseplan_meetingDecisionLog_v1';
const MAX_MEETING_DECISION_ENTRIES = 500;
const MEETING_CODE_SUFFIX_REGEX = /\s\[#\d{4}\]$/;

export type MeetingDecisionActionType = 'auto-best' | 'select' | 'map' | 'book' | 'confirm';

export type MeetingDecisionAction = {
  atIso: string;
  type: MeetingDecisionActionType;
  proposalId: string;
};

export type MeetingDecisionCandidate = {
  proposalId: string;
  rank: number;
  dayIso: string;
  startMs: number;
  endMs: number;
  score: number;
  tier: number;
  label: string;
  metrics: {
    detourKm: number;
    detourMinutes: number;
    slackMinutes: number;
    travelToMinutes: number;
    travelFromMinutes: number;
  };
  explain?: Record<string, unknown>;
};

export type MeetingDecisionConsideredSlot = {
  dayIso: string;
  dayLabel: string;
  timeRange: string;
  status: 'accepted' | 'rejected';
  reason?: string;
  detourKm?: number;
  addToRouteMin?: number;
  baselineMin?: number;
  newPathMin?: number;
  slackMin?: number;
  score?: number;
  label?: string;
  prev?: string;
  next?: string;
  summary?: string;
};

export type MeetingDecisionEntry = {
  id: string;
  createdAt: string;
  code: string;
  bookedMeeting: {
    eventId: string;
    title: string;
    titleBase: string;
    location: string;
    startIso?: string;
    endIso?: string;
  };
  searchInput: {
    locationLabel: string;
    locationForEvent: string;
    locationCoords?: { lat: number; lon: number };
    timeframeMode: string;
    durationMinutes: number;
    flexibleMeetingEnabled: boolean;
    flexBeforeMinutes: number;
    flexAfterMinutes: number;
    searchWindowStartIso: string;
    searchWindowEndIso: string;
  };
  selected: {
    proposalId: string | null;
    dayIso: string | null;
    startMs: number | null;
    endMs: number | null;
    bestBadgeProposalId: string | null;
  };
  ranking: {
    candidateCount: number;
    orderedProposalIds: string[];
  };
  candidates: MeetingDecisionCandidate[];
  consideredSlots: MeetingDecisionConsideredSlot[];
  existingMeetingsByDay: Record<
    string,
    Array<{
      id: string;
      title: string;
      time: string;
      location: string;
      startIso?: string;
      endIso?: string;
    }>
  >;
  actions: MeetingDecisionAction[];
};

type MeetingDecisionEntryInput = Omit<MeetingDecisionEntry, 'id' | 'createdAt'>;

function normalizeStoredEntries(value: unknown): MeetingDecisionEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is MeetingDecisionEntry => {
    if (!item || typeof item !== 'object') return false;
    const candidate = item as Partial<MeetingDecisionEntry>;
    return (
      typeof candidate.id === 'string' &&
      typeof candidate.createdAt === 'string' &&
      typeof candidate.code === 'string' &&
      candidate.bookedMeeting != null &&
      typeof candidate.bookedMeeting.eventId === 'string' &&
      typeof candidate.bookedMeeting.title === 'string'
    );
  });
}

async function readRaw(): Promise<string | null> {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
    try {
      return window.localStorage.getItem(MEETING_DECISION_LOG_KEY);
    } catch {
      // ignore
    }
  }
  return AsyncStorage.getItem(MEETING_DECISION_LOG_KEY);
}

async function writeRaw(raw: string): Promise<void> {
  await AsyncStorage.setItem(MEETING_DECISION_LOG_KEY, raw);
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(MEETING_DECISION_LOG_KEY, raw);
    } catch {
      // ignore
    }
  }
}

export async function getMeetingDecisionEntries(): Promise<MeetingDecisionEntry[]> {
  try {
    const raw = await readRaw();
    if (!raw) return [];
    return normalizeStoredEntries(JSON.parse(raw));
  } catch {
    return [];
  }
}

export async function appendMeetingDecisionEntry(
  entry: MeetingDecisionEntryInput
): Promise<MeetingDecisionEntry> {
  const current = await getMeetingDecisionEntries();
  const nowIso = new Date().toISOString();
  const nextEntry: MeetingDecisionEntry = {
    ...entry,
    id: `mdr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: nowIso,
  };
  const next = [nextEntry, ...current].slice(0, MAX_MEETING_DECISION_ENTRIES);
  await writeRaw(JSON.stringify(next));
  return nextEntry;
}

function random4DigitCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export async function allocateMeetingDecisionCode(): Promise<string> {
  const current = await getMeetingDecisionEntries();
  const usedCodes = new Set(current.map((entry) => entry.code));
  for (let i = 0; i < 200; i++) {
    const code = random4DigitCode();
    if (!usedCodes.has(code)) return code;
  }
  const fallback = String(Date.now() % 10000).padStart(4, '0');
  return fallback;
}

export function stripMeetingCodeSuffix(title: string): string {
  return title.replace(MEETING_CODE_SUFFIX_REGEX, '').trim();
}

export function appendMeetingCodeSuffix(title: string, code: string): string {
  const base = stripMeetingCodeSuffix(title);
  return `${base} [#${code}]`;
}

export async function findMeetingDecisionEntriesByCode(
  code: string
): Promise<MeetingDecisionEntry[]> {
  const normalized = code.trim();
  if (!/^\d{4}$/.test(normalized)) return [];
  const current = await getMeetingDecisionEntries();
  return current.filter((entry) => entry.code === normalized);
}

export async function findMeetingDecisionEntriesByTitle(
  titleQuery: string
): Promise<MeetingDecisionEntry[]> {
  const normalized = stripMeetingCodeSuffix(titleQuery).toLowerCase();
  if (!normalized) return [];
  const current = await getMeetingDecisionEntries();
  return current.filter((entry) => {
    const title = entry.bookedMeeting.title.toLowerCase();
    const titleBase = entry.bookedMeeting.titleBase.toLowerCase();
    return title.includes(normalized) || titleBase.includes(normalized);
  });
}

