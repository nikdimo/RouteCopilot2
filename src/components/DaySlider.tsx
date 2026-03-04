import React, { useRef, useEffect, useLayoutEffect, useState, forwardRef, useImperativeHandle } from 'react';
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
  /** Callback fired when the user scrolls the view, changing the visible month on the left edge */
  onVisibleMonthChange?: (date: Date) => void;
};

type ScrollViewRef = React.ElementRef<typeof ScrollView> & { getScrollableNode?: () => HTMLElement | null };

export type DaySliderRef = {
  scrollByDays: (offset: number) => void;
};

const DaySlider = forwardRef<DaySliderRef, DaySliderProps>(({
  selectedDate,
  onSelectDate,
  meetingCountByDay,
  onVisibleMonthChange,
}, ref) => {
  const scrollRef = useRef<ScrollViewRef>(null);
  const wrapperRef = useRef<View>(null);
  const today = startOfDay(new Date());
  const isWeb = Platform.OS === 'web';
  const startDate = today;
  const totalDays = isWeb ? DAYS_AHEAD_WEB : DAYS_TO_SHOW;
  const days = Array.from({ length: totalDays }, (_, i) =>
    addDays(startDate, i)
  );

  const selectedIndex = Math.round(
    (selectedDate.getTime() - startDate.getTime()) / 86400000
  );

  const [scrollMonthDate, setScrollMonthDate] = useState<Date>(selectedDate);
  const pillStep = PILL_WIDTH + PILL_GAP;
  const initialScrollDoneRef = useRef(false);

  useImperativeHandle(ref, () => ({
    scrollByDays: (offset: number) => {
      if (!scrollRef.current) return;
      if (isWeb) {
        const node = scrollRef.current.getScrollableNode?.();
        if (node) {
          node.scrollBy({ left: offset * pillStep, behavior: 'smooth' });
        }
      } else {
        // approximate generic scroll logic for native if needed
        // but typically the buttons are only on the web desktop layout anyway
      }
    }
  }));
  useEffect(() => {
    setScrollMonthDate(selectedDate);
    onVisibleMonthChange?.(selectedDate);
  }, [selectedDate, onVisibleMonthChange]);

  // Also push the new month to the parent when dragging/scrolling manually
  useEffect(() => {
    if (initialScrollDoneRef.current) {
      onVisibleMonthChange?.(scrollMonthDate);
    }
  }, [scrollMonthDate, onVisibleMonthChange]);

  const containerPadding = 16;

  // Keep strip on selected day: set position immediately on first run (no animation),
  // then when user picks another day use scrollTo with animation.
  useLayoutEffect(() => {
    if (selectedIndex < 0 || selectedIndex >= totalDays || !scrollRef.current) return;
    const offsetX = selectedIndex * pillStep - (isWeb ? 40 : 20);
    const isInitial = !initialScrollDoneRef.current;
    initialScrollDoneRef.current = true;
    if (isInitial && isWeb) {
      const node = scrollRef.current.getScrollableNode?.();
      if (node) node.scrollLeft = offsetX;
      return;
    }
    scrollRef.current.scrollTo({ x: offsetX, animated: !isInitial });
  }, [selectedDate, selectedIndex, totalDays, isWeb, pillStep]);

  // On web: prevent vertical wheel from scrolling the horizontal day strip
  useEffect(() => {
    if (!isWeb) return;
    const wrapper = (wrapperRef.current as unknown as HTMLElement) ?? null;
    if (!wrapper) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      const scrollNode = scrollRef.current?.getScrollableNode?.() ?? null;
      if (!scrollNode) return;
      const savedScrollLeft = scrollNode.scrollLeft;
      requestAnimationFrame(() => {
        scrollNode.scrollLeft = savedScrollLeft;
      });
    };
    wrapper.addEventListener('wheel', handleWheel, { capture: true });
    return () => wrapper.removeEventListener('wheel', handleWheel, { capture: true });
  }, [isWeb]);

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
      {days.map((date, i) => {
        const active = isSameDay(date, selectedDate);
        const dayKey = toLocalDayKey(date);
        const count = meetingCountByDay?.[dayKey] ?? 0;
        const dotColor = getDotColor(count);
        const isFirstOfMonth = i > 0 && date.getDate() === 1;

        return (
          <React.Fragment key={date.getTime()}>
            {isFirstOfMonth && (
              <View style={styles.monthDividerPill}>
                <Text style={styles.monthDividerText}>{format(date, 'MMM')}</Text>
                <View style={styles.monthDividerLine} />
              </View>
            )}
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
          </React.Fragment>
        );
      })}
    </ScrollView>
  );

  if (isWeb) {
    return (
      <View ref={wrapperRef} style={styles.wrapper} collapsable={false}>
        {scrollContent}
      </View>
    );
  }
  return scrollContent;
});

export default DaySlider;

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: 'transparent',
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
    width: 48,
    marginRight: 0,
    borderRadius: 8,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    marginHorizontal: 2,
    height: 54, // Consistent height
  },
  pillActive: {
    backgroundColor: '#3B82F6', // Brighter mockup blue
    height: 64, // stretches taller
    marginTop: -5, // pop out effect
    borderRadius: 12,
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  monthDividerPill: {
    height: 54, // Matches the inactive pill height
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
    marginHorizontal: 4,
  },
  monthDividerText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  monthDividerLine: {
    width: 20,
    height: 2,
    backgroundColor: '#E2E8F0',
    borderRadius: 1,
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
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  dayNameActive: {
    color: '#E0E7FF',
  },
  dayNameWeb: {
    fontSize: 10,
  },
  dateNum: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  dateNumActive: {
    color: '#FFFFFF',
    fontSize: 18,
  },
  dateNumWeb: {
    fontSize: 15,
  },
});
