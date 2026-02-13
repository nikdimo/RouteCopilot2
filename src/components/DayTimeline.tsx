import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { startOfDay } from 'date-fns';
import type { CalendarEvent } from '../services/graph';
import { slotId, type ScoredSlot } from '../utils/scheduler';
import MeetingCard from './MeetingCard';
import GhostSlotCard from './GhostSlotCard';

const MS_PER_MIN = 60_000;

export type TimelineEntry =
  | { type: 'event'; event: CalendarEvent; startMs: number; endMs: number }
  | { type: 'ghost'; slot: ScoredSlot };

function formatTimeRange(startMs: number, endMs: number): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const s = new Date(startMs);
  const e = new Date(endMs);
  return `${pad(s.getHours())}:${pad(s.getMinutes())} - ${pad(e.getHours())}:${pad(e.getMinutes())}`;
}

function eventToRange(ev: CalendarEvent, dayStartMs: number): { startMs: number; endMs: number } | null {
  if (ev.startIso && ev.endIso) {
    try {
      return {
        startMs: new Date(ev.startIso).getTime(),
        endMs: new Date(ev.endIso).getTime(),
      };
    } catch {
      return parseTimeRange(ev.time, dayStartMs);
    }
  }
  return parseTimeRange(ev.time, dayStartMs);
}

function parseTimeRange(timeStr: string | undefined, dayStartMs: number): { startMs: number; endMs: number } | null {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const parts = timeStr.split('-').map((p) => p.trim());
  if (parts.length < 2) return null;
  const [startStr, endStr] = parts;
  if (!startStr || !endStr) return null;
  const [sh, sm] = startStr.split(':').map((x) => parseInt(x || '0', 10));
  const [eh, em] = endStr.split(':').map((x) => parseInt(x || '0', 10));
  const startMs = dayStartMs + (sh * 60 + sm) * MS_PER_MIN;
  const endMs = dayStartMs + (eh * 60 + em) * MS_PER_MIN;
  return { startMs, endMs };
}

export function buildTimelineEntries(
  dayIso: string,
  events: CalendarEvent[],
  ghostSlots: ScoredSlot[]
): TimelineEntry[] {
  const [y, mo, d] = dayIso.split('-').map((x) => parseInt(x, 10));
  const dayStartMs = startOfDay(new Date(y, mo - 1, d)).getTime();

  const eventEntries: TimelineEntry[] = events
    .map((ev) => {
      const r = eventToRange(ev, dayStartMs);
      if (!r) return null;
      const dayOfStart = startOfDay(new Date(r.startMs)).getTime();
      if (dayOfStart !== dayStartMs) return null;
      return { type: 'event' as const, event: ev, startMs: r.startMs, endMs: r.endMs };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  const ghostEntries: TimelineEntry[] = ghostSlots
    .filter((s) => s.dayIso === dayIso)
    .map((slot) => ({ type: 'ghost' as const, slot }));

  const merged = [...eventEntries, ...ghostEntries].sort((a, b) => {
    const aMs = a.type === 'event' ? a.startMs : a.slot.startMs;
    const bMs = b.type === 'event' ? b.startMs : b.slot.startMs;
    return aMs - bMs;
  });

  return merged;
}

export type DayTimelineProps = {
  dayIso: string;
  dayLabel: string;
  entries: TimelineEntry[];
  preBuffer: number;
  postBuffer: number;
  selectedSlotId: string | null;
  bestOptionIds: Set<string>;
  onSelectSlot: (slot: ScoredSlot) => void;
  onMapPress: (slot: ScoredSlot) => void;
};

export default function DayTimeline({
  dayLabel,
  entries,
  preBuffer,
  postBuffer,
  selectedSlotId,
  bestOptionIds,
  onSelectSlot,
  onMapPress,
}: DayTimelineProps) {
  if (entries.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.dayLabel}>{dayLabel}</Text>
      {entries.map((entry) => {
        if (entry.type === 'event') {
          return (
            <MeetingCard
              key={entry.event.id}
              timeRange={formatTimeRange(entry.startMs, entry.endMs)}
              client={entry.event.title ?? '(No title)'}
              address={entry.event.location ?? ''}
              statusColor="#107C10"
            />
          );
        }
        const slot = entry.slot;
        const id = slotId(slot);
        return (
          <GhostSlotCard
            key={id}
            slot={slot}
            preBuffer={preBuffer}
            postBuffer={postBuffer}
            isSelected={selectedSlotId === id}
            isBestOption={bestOptionIds.has(id)}
            onSelect={() => onSelectSlot(slot)}
            onMapPress={() => onMapPress(slot)}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 24,
  },
  dayLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 10,
  },
});
