import React, { useRef, useEffect } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
} from 'react-native';
import { addDays, format, isSameDay, startOfDay } from 'date-fns';

const MS_BLUE = '#0078D4';
const DAYS_TO_SHOW = 14;
const PILL_WIDTH = 48;

type DaySliderProps = {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
};

export default function DaySlider({
  selectedDate,
  onSelectDate,
}: DaySliderProps) {
  const scrollRef = useRef<ScrollView>(null);
  const today = startOfDay(new Date());
  const days = Array.from({ length: DAYS_TO_SHOW }, (_, i) =>
    addDays(today, i)
  );

  useEffect(() => {
    const start = startOfDay(today);
    const index = Math.round((selectedDate.getTime() - start.getTime()) / 86400000);
    if (index >= 0 && index < DAYS_TO_SHOW && scrollRef.current) {
      scrollRef.current.scrollTo({
        x: index * (PILL_WIDTH + 10) - 20,
        animated: true,
      });
    }
  }, [selectedDate]);

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
      style={styles.scroll}
    >
      {days.map((date) => {
        const active = isSameDay(date, selectedDate);
        return (
          <TouchableOpacity
            key={date.getTime()}
            style={[styles.pill, active && styles.pillActive]}
            onPress={() => onSelectDate(date)}
            activeOpacity={0.8}
          >
            <Text
              style={[styles.dayName, active && styles.dayNameActive]}
              numberOfLines={1}
            >
              {format(date, 'EEE')}
            </Text>
            <Text
              style={[styles.dateNum, active && styles.dateNumActive]}
              numberOfLines={1}
            >
              {format(date, 'd')}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    maxHeight: 76,
  },
  container: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  pill: {
    width: PILL_WIDTH,
    marginRight: 10,
    borderRadius: 9999,
    backgroundColor: '#E1DFDD',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  pillActive: {
    backgroundColor: MS_BLUE,
  },
  dayName: {
    fontSize: 12,
    color: '#1a1a1a',
    fontWeight: '500',
    marginBottom: 4,
  },
  dayNameActive: {
    color: '#fff',
  },
  dateNum: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  dateNumActive: {
    color: '#fff',
  },
});
