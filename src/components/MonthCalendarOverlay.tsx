import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  addMonths,
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { toLocalDayKey } from '../utils/dateUtils';
import { getMeetingDotTone, MEETING_DOT_COLOR } from '../utils/meetingDots';

type MonthCalendarOverlayProps = {
  visible: boolean;
  selectedDate: Date;
  initialMonthDate?: Date;
  meetingCountByDay?: Record<string, number>;
  onSelectDate: (date: Date) => void;
  onVisibleMonthChange?: (date: Date) => void;
  onClose: () => void;
};

const WEEK_STARTS_ON = 1 as const; // Monday

export default function MonthCalendarOverlay({
  visible,
  selectedDate,
  initialMonthDate,
  meetingCountByDay,
  onSelectDate,
  onVisibleMonthChange,
  onClose,
}: MonthCalendarOverlayProps) {
  const [visibleMonth, setVisibleMonth] = useState(() =>
    startOfMonth(initialMonthDate ?? selectedDate)
  );

  useEffect(() => {
    if (!visible) return;
    const nextMonth = startOfMonth(initialMonthDate ?? selectedDate);
    setVisibleMonth((prev) => (isSameDay(prev, nextMonth) ? prev : nextMonth));
  }, [visible, initialMonthDate, selectedDate]);

  useEffect(() => {
    if (!visible) return;
    onVisibleMonthChange?.(visibleMonth);
  }, [visible, visibleMonth, onVisibleMonthChange]);

  const weekdayLabels = useMemo(() => {
    const start = startOfWeek(new Date(), { weekStartsOn: WEEK_STARTS_ON });
    return Array.from({ length: 7 }, (_, index) => format(addDays(start, index), 'EEE'));
  }, []);

  const daysInGrid = useMemo(() => {
    const monthStart = startOfMonth(visibleMonth);
    const monthEnd = endOfMonth(visibleMonth);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: WEEK_STARTS_ON });
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: WEEK_STARTS_ON });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [visibleMonth]);
  const todayStart = useMemo(() => startOfDay(new Date()), []);

  const handleSelectDate = useCallback(
    (date: Date) => {
      onSelectDate(startOfDay(date));
      onClose();
    },
    [onClose, onSelectDate]
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.panel} onPress={() => {}}>
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.headerNavButton}
              onPress={() => setVisibleMonth((prev) => addMonths(prev, -1))}
              activeOpacity={0.8}
            >
              <ChevronLeft color="#334155" size={18} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>{format(visibleMonth, 'MMMM yyyy')}</Text>
            <TouchableOpacity
              style={styles.headerNavButton}
              onPress={() => setVisibleMonth((prev) => addMonths(prev, 1))}
              activeOpacity={0.8}
            >
              <ChevronRight color="#334155" size={18} />
            </TouchableOpacity>
          </View>

          <View style={styles.weekdayRow}>
            {weekdayLabels.map((label) => (
              <Text key={label} style={styles.weekdayLabel}>
                {label}
              </Text>
            ))}
          </View>

          <View style={styles.grid}>
            {daysInGrid.map((date) => {
              const dayKey = toLocalDayKey(date);
              const count = meetingCountByDay?.[dayKey] ?? 0;
              const dotTone = getMeetingDotTone(count);
              const isSelected = isSameDay(date, selectedDate);
              const outsideMonth = date.getMonth() !== visibleMonth.getMonth();
              const isPastDay = date.getTime() < todayStart.getTime();
              const dotColor = isSelected ? '#FFFFFF' : MEETING_DOT_COLOR[dotTone];

              return (
                <TouchableOpacity
                  key={dayKey}
                  style={[
                    styles.dayCell,
                    outsideMonth && styles.dayCellOutsideMonth,
                    isPastDay && styles.dayCellPast,
                    isToday(date) && styles.dayCellToday,
                    isSelected && styles.dayCellSelected,
                  ]}
                  onPress={() => handleSelectDate(date)}
                  disabled={isPastDay}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[
                      styles.dayNumber,
                      outsideMonth && styles.dayNumberOutsideMonth,
                      isPastDay && styles.dayNumberPast,
                      isSelected && styles.dayNumberSelected,
                    ]}
                  >
                    {format(date, 'd')}
                  </Text>
                  {dotTone !== 'none' ? (
                    <View style={[styles.dayDot, { backgroundColor: dotColor }]} />
                  ) : (
                    <View style={styles.dayDotSpacer} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.footerButton} onPress={() => setVisibleMonth(startOfMonth(new Date()))}>
              <Text style={styles.footerButtonText}>Today</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.footerButton} onPress={onClose}>
              <Text style={styles.footerButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  panel: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  headerNavButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
  weekdayRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  weekdayLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.2857%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    marginBottom: 3,
  },
  dayCellOutsideMonth: {
    opacity: 0.45,
  },
  dayCellPast: {
    opacity: 0.35,
  },
  dayCellToday: {
    borderWidth: 1,
    borderColor: '#93C5FD',
  },
  dayCellSelected: {
    backgroundColor: '#3B82F6',
  },
  dayNumber: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  dayNumberOutsideMonth: {
    color: '#64748B',
  },
  dayNumberPast: {
    color: '#94A3B8',
  },
  dayNumberSelected: {
    color: '#FFFFFF',
  },
  dayDot: {
    marginTop: 3,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dayDotSpacer: {
    marginTop: 3,
    width: 6,
    height: 6,
  },
  footer: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  footerButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  footerButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
});
