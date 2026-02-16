import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { addDays, format, isSameDay, startOfDay } from 'date-fns';
import { toLocalDayKey } from '../utils/dateUtils';

const MS_BLUE = '#0078D4';
const DAYS_TO_SHOW = 14;
const DAYS_BACK_WEB = 365;
const DAYS_AHEAD_WEB = 730;
const PILL_WIDTH = 48;
const PILL_GAP = 10;

/** Dot colors by meeting count: none (0), green (1–2), yellow (3–4), red (5+) */
const DOT_COLOR = {
  none: 'transparent',
  green: '#107C10',
  yellow: '#F4B400',
  red: '#D13438',
} as const;

function getDotColor(count: number): keyof typeof DOT_COLOR {
  if (count === 0) return 'none';
  if (count <= 2) return 'green';
  if (count <= 4) return 'yellow';
  return 'red';
}

type DaySliderProps = {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  /** Meeting count per day key (YYYY-MM-DD) for dot indicators */
  meetingCountByDay?: Record<string, number>;
};

export default function DaySlider({
  selectedDate,
  onSelectDate,
  meetingCountByDay,
}: DaySliderProps) {
  const scrollRef = useRef<ScrollView>(null);
  const today = startOfDay(new Date());
  const isWeb = Platform.OS === 'web';
  const startDate = isWeb ? addDays(today, -DAYS_BACK_WEB) : today;
  const totalDays = isWeb ? DAYS_BACK_WEB + DAYS_AHEAD_WEB : DAYS_TO_SHOW;
  const days = Array.from({ length: totalDays }, (_, i) =>
    addDays(startDate, i)
  );

  const selectedIndex = Math.round(
    (selectedDate.getTime() - startDate.getTime()) / 86400000
  );

  const [scrollMonthDate, setScrollMonthDate] = useState<Date>(selectedDate);
  const pillStep = PILL_WIDTH + PILL_GAP;
  useEffect(() => {
    setScrollMonthDate(selectedDate);
  }, [selectedDate]);
  const containerPadding = 16;

  useEffect(() => {
    if (selectedIndex >= 0 && selectedIndex < totalDays && scrollRef.current) {
      scrollRef.current.scrollTo({
        x: selectedIndex * pillStep - (isWeb ? 40 : 20),
        animated: true,
      });
    }
  }, [selectedDate, selectedIndex, totalDays, isWeb, pillStep]);

  const handleScroll = (e: { nativeEvent: { contentOffset: { x: number } } }) => {
    if (!isWeb) return;
    const x = e.nativeEvent.contentOffset.x;
    const idx = Math.min(
      totalDays - 1,
      Math.max(0, Math.floor((x + containerPadding + pillStep / 2) / pillStep))
    );
    setScrollMonthDate(days[idx]);
  };

  const monthLabel = isWeb ? format(scrollMonthDate, 'MMMM yyyy') : '';

  const scrollContent = (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
      style={styles.scroll}
      onScroll={handleScroll}
      scrollEventThrottle={32}
      onMomentumScrollEnd={handleScroll}
    >
      {days.map((date) => {
        const active = isSameDay(date, selectedDate);
        const dayKey = toLocalDayKey(date);
        const count = meetingCountByDay?.[dayKey] ?? 0;
        const dotColor = getDotColor(count);

        return (
          <TouchableOpacity
            key={date.getTime()}
            style={[styles.pill, active && styles.pillActive]}
            onPress={() => onSelectDate(date)}
            activeOpacity={0.8}
          >
            {dotColor !== 'none' && (
              <View
                style={[
                  styles.dot,
                  { backgroundColor: DOT_COLOR[dotColor] },
                  active && styles.dotOnActive,
                ]}
              />
            )}
            <Text
              style={[
                styles.dayName,
                active && styles.dayNameActive,
                isWeb && styles.dayNameWeb,
              ]}
              numberOfLines={1}
            >
              {format(date, 'EEE')}
            </Text>
            <Text
              style={[
                styles.dateNum,
                active && styles.dateNumActive,
                isWeb && styles.dateNumWeb,
              ]}
              numberOfLines={1}
            >
              {format(date, 'd')}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );

  if (isWeb) {
    return (
      <View style={styles.wrapper}>
        <Text style={styles.monthLabel}>{monthLabel}</Text>
        {scrollContent}
      </View>
    );
  }
  return scrollContent;
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: '#F3F2F1',
    borderBottomWidth: 1,
    borderBottomColor: '#E1DFDD',
  },
  monthLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#323130',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
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
    marginRight: PILL_GAP,
    borderRadius: 9999,
    backgroundColor: '#E1DFDD',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  pillActive: {
    backgroundColor: MS_BLUE,
  },
  dot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotOnActive: {
    backgroundColor: '#fff',
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
  dayNameWeb: {
    fontSize: 11,
  },
  dateNum: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  dateNumActive: {
    color: '#fff',
  },
  dateNumWeb: {
    fontSize: 14,
  },
});
