import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
} from 'react-native';
import { addWeeks, startOfWeek, getWeek } from 'date-fns';

const MS_BLUE = '#0078D4';
const WEEKS_TO_SHOW = 4;

export type WeekItem = {
  id: string;
  label: string;
  weekNumber: number;
  startDate: Date;
};

type WeekPillSliderProps = {
  selectedWeek: WeekItem;
  onSelectWeek: (week: WeekItem) => void;
};

const base = startOfWeek(new Date(), { weekStartsOn: 1 });

function buildWeeks(): WeekItem[] {
  return Array.from({ length: WEEKS_TO_SHOW }, (_, i) => {
    const start = addWeeks(base, i);
    const weekNum = getWeek(start, { weekStartsOn: 1 });
    const label =
      i === 0
        ? 'Current Week'
        : i === 1
          ? 'Next Week'
          : `Week ${weekNum}`;
    return {
      id: start.getTime().toString(),
      label,
      weekNumber: weekNum,
      startDate: start,
    };
  });
}

const WEEKS = buildWeeks();

export function getDefaultWeek(): WeekItem {
  return WEEKS[0];
}

export default function WeekPillSlider({
  selectedWeek,
  onSelectWeek,
}: WeekPillSliderProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
      style={styles.scroll}
    >
      {WEEKS.map((week) => {
        const active = week.id === selectedWeek.id;
        return (
          <TouchableOpacity
            key={week.id}
            style={[styles.pill, active && styles.pillActive]}
            onPress={() => onSelectWeek(week)}
            activeOpacity={0.8}
          >
            <Text
              style={[styles.label, active && styles.labelActive]}
            >
              {week.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    minHeight: 44,
    maxHeight: 56,
  },
  container: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pill: {
    minWidth: 80,
    minHeight: 40,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 9999,
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#E1DFDD',
    marginRight: 10,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillActive: {
    backgroundColor: MS_BLUE,
    borderColor: MS_BLUE,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  labelActive: {
    color: '#fff',
  },
});
