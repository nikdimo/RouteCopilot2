import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CalendarEvent } from './graph';
import { toLocalDayKey } from '../utils/dateUtils';

const LOCAL_MEETINGS_KEY = 'wiseplan_localMeetings_v1';

type StoredLocalMeetings = CalendarEvent[];

function isValidStoredEvent(value: unknown): value is CalendarEvent {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<CalendarEvent>;
  return (
    typeof v.id === 'string' &&
    typeof v.title === 'string' &&
    typeof v.time === 'string' &&
    typeof v.location === 'string' &&
    typeof v.status === 'string'
  );
}

function normalizeStoredEvents(value: unknown): StoredLocalMeetings {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isValidStoredEvent)
    .map((ev) => ({
      ...ev,
      status: ev.status ?? 'pending',
    }));
}

async function readRaw(): Promise<string | null> {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
    try {
      return window.localStorage.getItem(LOCAL_MEETINGS_KEY);
    } catch {
      // ignore
    }
  }
  return AsyncStorage.getItem(LOCAL_MEETINGS_KEY);
}

async function writeRaw(raw: string): Promise<void> {
  await AsyncStorage.setItem(LOCAL_MEETINGS_KEY, raw);
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(LOCAL_MEETINGS_KEY, raw);
    } catch {
      // ignore
    }
  }
}

async function readAll(): Promise<StoredLocalMeetings> {
  try {
    const raw = await readRaw();
    if (!raw) return [];
    return normalizeStoredEvents(JSON.parse(raw));
  } catch {
    return [];
  }
}

async function writeAll(events: StoredLocalMeetings): Promise<void> {
  await writeRaw(JSON.stringify(events));
}

export async function getLocalMeetingsForDay(dayKey: string): Promise<CalendarEvent[]> {
  const all = await readAll();
  return all.filter((ev) => {
    if (!ev.startIso) return false;
    try {
      return toLocalDayKey(new Date(ev.startIso)) === dayKey;
    } catch {
      return false;
    }
  });
}

export async function getLocalMeetingsInRange(
  windowStart: Date,
  windowEnd: Date
): Promise<CalendarEvent[]> {
  const startKey = toLocalDayKey(windowStart);
  const endKey = toLocalDayKey(windowEnd);
  const all = await readAll();
  return all.filter((ev) => {
    if (!ev.startIso) return false;
    try {
      const key = toLocalDayKey(new Date(ev.startIso));
      return key >= startKey && key <= endKey;
    } catch {
      return false;
    }
  });
}

export async function getLocalMeetingCountsInRange(
  windowStart: Date,
  windowEnd: Date
): Promise<Record<string, number>> {
  const startKey = toLocalDayKey(windowStart);
  const endKey = toLocalDayKey(windowEnd);
  const all = await readAll();
  const counts: Record<string, number> = {};
  for (const ev of all) {
    if (!ev.startIso) continue;
    try {
      const key = toLocalDayKey(new Date(ev.startIso));
      if (key < startKey || key > endKey) continue;
      counts[key] = (counts[key] ?? 0) + 1;
    } catch {
      // ignore invalid dates
    }
  }
  return counts;
}

export async function upsertLocalMeeting(event: CalendarEvent): Promise<void> {
  const all = await readAll();
  const idx = all.findIndex((x) => x.id === event.id);
  const next = idx >= 0 ? [...all.slice(0, idx), event, ...all.slice(idx + 1)] : [...all, event];
  await writeAll(next);
}

export async function patchLocalMeeting(
  eventId: string,
  patch: Partial<CalendarEvent>
): Promise<void> {
  const all = await readAll();
  const idx = all.findIndex((x) => x.id === eventId);
  if (idx < 0) return;
  const current = all[idx]!;
  const nextEvent: CalendarEvent = { ...current, ...patch };
  const next = [...all];
  next[idx] = nextEvent;
  await writeAll(next);
}

export async function removeLocalMeeting(eventId: string): Promise<void> {
  const all = await readAll();
  const next = all.filter((x) => x.id !== eventId);
  if (next.length === all.length) return;
  await writeAll(next);
}
