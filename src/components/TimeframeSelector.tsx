import React, { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Modal,
  TextInput,
} from 'react-native';
import { addWeeks, startOfWeek, startOfDay, addDays, endOfDay } from 'date-fns';

const MS_BLUE = '#0078D4';

export type TimeframeMode = 'anytime' | 'week';

/** Selected week = Monday 00:00 of that week (epoch ms). Only used when mode === 'week'. */
export type TimeframeSelection =
  | { mode: 'anytime' }
  | { mode: 'week'; weekStartMs: number };

export type TimeframeSelectorProps = {
  selected: TimeframeSelection;
  onSelect: (v: TimeframeSelection) => void;
};

/**
 * Search window:
 * - Best Match: today → today + 13 days (14 days incl. today)
 * - Pick Week: Mon 00:00 → Sun 23:59:59.999 of selected week (weekStartsOn: 1)
 */
export function getSearchWindow(
  selection: TimeframeSelection
): { start: Date; end: Date } {
  const now = new Date();
  const today = startOfDay(now);

  if (selection.mode === 'anytime') {
    return {
      start: today,
      end: endOfDay(addDays(today, 13)),
    };
  }

  const weekStart = startOfDay(new Date(selection.weekStartMs));
  const weekEnd = endOfDay(addDays(weekStart, 6));
  return {
    start: weekStart,
    end: weekEnd,
  };
}

function formatWeekLabel(weekStartMs: number): string {
  const d = new Date(weekStartMs);
  const mon = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const sun = addDays(d, 6).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${mon} – ${sun}`;
}

function getThisWeekStartMs(): number {
  return startOfWeek(startOfDay(new Date()), { weekStartsOn: 1 }).getTime();
}

function getNextWeekStartMs(): number {
  return addWeeks(new Date(getThisWeekStartMs()), 1).getTime();
}

export default function TimeframeSelector({
  selected,
  onSelect,
}: TimeframeSelectorProps) {
  const [showWeekPicker, setShowWeekPicker] = useState(false);
  const [dateInput, setDateInput] = useState('');

  const thisWeekMs = getThisWeekStartMs();
  const nextWeekMs = getNextWeekStartMs();

  const handleSelectWeek = (weekStartMs: number) => {
    onSelect({ mode: 'week', weekStartMs });
    setShowWeekPicker(false);
    setDateInput('');
  };

  const handleDateSubmit = () => {
    const trimmed = dateInput.trim();
    if (!trimmed) return;
    const parts = trimmed.split(/[-/]/).map((x) => parseInt(x || '0', 10));
    if (parts.length >= 3) {
      const y = parts[0]!;
      const m = (parts[1] ?? 1) - 1;
      const d = parts[2] ?? 1;
      const date = new Date(y, m, d);
      if (!isNaN(date.getTime())) {
        const weekStart = startOfWeek(date, { weekStartsOn: 1 });
        handleSelectWeek(weekStart.getTime());
      }
    }
  };

  return (
    <View style={styles.wrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.container}
        style={styles.scroll}
      >
        <TouchableOpacity
          style={[styles.pill, selected.mode === 'anytime' && styles.pillActive]}
          onPress={() => onSelect({ mode: 'anytime' })}
          activeOpacity={0.8}
        >
          <Text
            style={[
              styles.label,
              selected.mode === 'anytime' && styles.labelActive,
            ]}
          >
            Best Match
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.pill,
            selected.mode === 'week' && styles.pillActive,
          ]}
          onPress={() => setShowWeekPicker(true)}
          activeOpacity={0.8}
        >
          <Text
            style={[
              styles.label,
              selected.mode === 'week' && styles.labelActive,
            ]}
            numberOfLines={1}
          >
            {selected.mode === 'week'
              ? formatWeekLabel(selected.weekStartMs)
              : 'Pick Week'}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal
        visible={showWeekPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowWeekPicker(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowWeekPicker(false)}
        >
          <View
            style={styles.modalContent}
            onStartShouldSetResponder={() => true}
          >
            <Text style={styles.modalTitle}>Choose week</Text>
            <TouchableOpacity
              style={styles.weekOption}
              onPress={() => handleSelectWeek(thisWeekMs)}
            >
              <Text style={styles.weekOptionText}>This week</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.weekOption}
              onPress={() => handleSelectWeek(nextWeekMs)}
            >
              <Text style={styles.weekOptionText}>Next week</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.weekOption}
              onPress={() => handleSelectWeek(addWeeks(new Date(thisWeekMs), 2).getTime())}
            >
              <Text style={styles.weekOptionText}>In 2 weeks</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.weekOption}
              onPress={() => handleSelectWeek(addWeeks(new Date(thisWeekMs), 3).getTime())}
            >
              <Text style={styles.weekOptionText}>In 3 weeks</Text>
            </TouchableOpacity>

            <Text style={styles.modalSubtitle}>Or pick a date (YYYY-MM-DD)</Text>
            <TextInput
              style={styles.dateInput}
              placeholder="e.g. 2025-03-15"
              placeholderTextColor="#94a3b8"
              value={dateInput}
              onChangeText={setDateInput}
              onSubmitEditing={handleDateSubmit}
              returnKeyType="done"
            />
            <TouchableOpacity
              style={[styles.weekOption, styles.submitBtn]}
              onPress={handleDateSubmit}
            >
              <Text style={styles.submitBtnText}>Apply</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => setShowWeekPicker(false)}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    minHeight: 44,
  },
  scroll: {
    maxHeight: 56,
  },
  container: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pill: {
    minWidth: 90,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 320,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 16,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#605E5C',
    marginTop: 20,
    marginBottom: 8,
  },
  weekOption: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    marginBottom: 8,
  },
  weekOptionText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  submitBtn: {
    backgroundColor: MS_BLUE,
    marginTop: 8,
  },
  submitBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  dateInput: {
    backgroundColor: '#E1DFDD',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#1a1a1a',
  },
  cancelBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  cancelBtnText: {
    fontSize: 16,
    color: '#605E5C',
  },
});
