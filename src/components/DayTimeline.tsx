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
type EventTimelineEntry = Extract<TimelineEntry, { type: 'event' }>;

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

  const eventEntries: EventTimelineEntry[] = events
    .map((ev) => {
      const r = eventToRange(ev, dayStartMs);
      if (!r) return null;
      const dayOfStart = startOfDay(new Date(r.startMs)).getTime();
      if (dayOfStart !== dayStartMs) return null;
      return { type: 'event' as const, event: ev, startMs: r.startMs, endMs: r.endMs };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  const sortedEvents = [...eventEntries].sort((a, b) => a.startMs - b.startMs);
  const eventIndexById = new Map(
    sortedEvents.map((entry, idx) => [entry.event.id, idx])
  );
  const ghostByGap = new Map<number, ScoredSlot[]>();

  const pushGhostToGap = (gapIndex: number, slot: ScoredSlot) => {
    const current = ghostByGap.get(gapIndex) ?? [];
    current.push(slot);
    ghostByGap.set(gapIndex, current);
  };

  const fallbackGapIndexFromTime = (slotStartMs: number): number => {
    for (let i = 0; i < sortedEvents.length; i++) {
      if (slotStartMs < sortedEvents[i]!.startMs) {
        return i;
      }
    }
    return sortedEvents.length;
  };

  const ghostSlotsForDay = ghostSlots.filter((s) => s.dayIso === dayIso);
  for (const slot of ghostSlotsForDay) {
    const prevId = slot.explain?.prev.type === 'event' ? slot.explain.prev.id : null;
    const nextId = slot.explain?.next.type === 'event' ? slot.explain.next.id : null;
    const prevIdx = prevId != null ? eventIndexById.get(prevId) : undefined;
    const nextIdx = nextId != null ? eventIndexById.get(nextId) : undefined;

    let gapIndex: number | null = null;
    if (prevIdx != null && nextIdx != null && prevIdx < nextIdx) {
      // Place in the gap after prev (which is before next when indexes are consecutive).
      gapIndex = prevIdx + 1;
    } else if (prevIdx != null) {
      gapIndex = prevIdx + 1;
    } else if (nextIdx != null) {
      gapIndex = nextIdx;
    }

    if (gapIndex == null) {
      gapIndex = fallbackGapIndexFromTime(slot.startMs);
    }

    const clampedGap = Math.max(0, Math.min(gapIndex, sortedEvents.length));
    pushGhostToGap(clampedGap, slot);
  }

  ghostByGap.forEach((slotsInGap) => {
    slotsInGap.sort((a, b) => {
      if (a.startMs !== b.startMs) return a.startMs - b.startMs;
      return slotId(a).localeCompare(slotId(b));
    });
  });

  const merged: TimelineEntry[] = [];
  if (sortedEvents.length === 0) {
    const onlyGap = ghostByGap.get(0) ?? [];
    onlyGap.forEach((slot) => merged.push({ type: 'ghost', slot }));
    return merged;
  }

  for (let i = 0; i < sortedEvents.length; i++) {
    if (i === 0) {
      const beforeFirst = ghostByGap.get(0) ?? [];
      beforeFirst.forEach((slot) => merged.push({ type: 'ghost', slot }));
    }
    merged.push(sortedEvents[i]!);
    const afterCurrent = ghostByGap.get(i + 1) ?? [];
    afterCurrent.forEach((slot) => merged.push({ type: 'ghost', slot }));
  }

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
  /** When provided, selected ghost slots show "Book this time" to open the confirm sheet */
  onBookSlot?: (slot: ScoredSlot) => void;
  onPusherToggle?: (slot: ScoredSlot, active: boolean, affectedEventIds: string[]) => void;
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
  onBookSlot,
  onPusherToggle,
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
              variantBooked
              phone={entry.event.phone}
              email={entry.event.email}
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
            onBookPress={onBookSlot ? () => onBookSlot(slot) : undefined}
            onPusherToggle={onPusherToggle}
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
