import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { CalendarEvent } from '../services/graph';
import { parseTimeToDayMs } from '../utils/dateUtils';

const STRIP_HEIGHT = 28;
const HOURS_START = 6;
const HOURS_END = 20;

export default function DayTimelineStrip({
  appointments,
  selectedDateMs,
}: {
  appointments: CalendarEvent[];
  selectedDateMs: number;
}) {
  const dayStart = new Date(selectedDateMs);
  dayStart.setHours(HOURS_START, 0, 0, 0);
  const dayEnd = new Date(selectedDateMs);
  dayEnd.setHours(HOURS_END, 0, 0, 0);
  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayEnd.getTime();
  const rangeMs = dayEndMs - dayStartMs;

  const blocks: { left: number; width: number; isCompleted?: boolean }[] = [];
  for (const a of appointments) {
    const startMs = a.startIso
      ? new Date(a.startIso).getTime()
      : parseTimeToDayMs(a.time, a.startIso ?? a.endIso);
    const endMs = a.endIso
      ? new Date(a.endIso).getTime()
      : parseTimeToDayMs(a.time, a.startIso ?? a.endIso, true);
    const left = Math.max(0, (startMs - dayStartMs) / rangeMs) * 100;
    const endPct = Math.min(100, (endMs - dayStartMs) / rangeMs * 100);
    const width = Math.max(2, endPct - left);
    blocks.push({ left, width, isCompleted: a.status === 'completed' });
  }

  const hourLabels: number[] = [];
  for (let h = HOURS_START; h <= HOURS_END; h += 2) {
    hourLabels.push(h);
  }

  return (
    <View style={styles.container}>
      <View style={styles.strip}>
        {blocks.map((b, i) => (
          <View
            key={i}
            style={[
              styles.block,
              {
                left: `${b.left}%`,
                width: `${b.width}%`,
                backgroundColor: b.isCompleted ? '#808080' : '#0078D4',
              },
            ]}
          />
        ))}
      </View>
      <View style={styles.labels}>
        {hourLabels.map((h) => (
          <Text key={h} style={styles.label}>
            {h}:00
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  strip: {
    height: STRIP_HEIGHT,
    backgroundColor: '#E8E8E8',
    borderRadius: 6,
    overflow: 'hidden',
    position: 'relative',
  },
  block: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    borderRadius: 4,
    minWidth: 4,
  },
  labels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
    paddingHorizontal: 2,
  },
  label: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: '500',
  },
});
