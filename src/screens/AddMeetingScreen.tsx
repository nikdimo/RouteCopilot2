import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
} from 'react-native';
import WeekPillSlider, { type WeekItem, getDefaultWeek } from '../components/WeekPillSlider';
import MeetingCard from '../components/MeetingCard';

const MS_BLUE = '#0078D4';
const GREEN = '#107C10';
const RED = '#D13438';

// Dummy Best Options (3 cards, all green per spec)
const BEST_OPTIONS = [
  { id: 'b1', timeRange: '10:00 - 11:00', label: 'Best Match', statusColor: GREEN },
  { id: 'b2', timeRange: '14:00 - 15:00', label: 'Minimal Detour', statusColor: GREEN },
  { id: 'b3', timeRange: '16:00 - 17:00', label: 'Minimal Detour', statusColor: GREEN },
];

// Dummy By Day slots (grouped by day; Client field used as Time Slot, red = bad slot)
const BY_DAY_GROUPS = [
  {
    dayLabel: 'Tuesday, Feb 11',
    slots: [
      { id: 's1', timeRange: '09:00 - 10:00', timeSlotLabel: '09:00 - 10:00', statusColor: RED },
      { id: 's2', timeRange: '11:30 - 12:30', timeSlotLabel: '11:30 - 12:30', statusColor: RED },
    ],
  },
  {
    dayLabel: 'Wednesday, Feb 12',
    slots: [
      { id: 's3', timeRange: '08:00 - 09:00', timeSlotLabel: '08:00 - 09:00', statusColor: RED },
    ],
  },
];

export default function AddMeetingScreen() {
  const searchRef = useRef<TextInput>(null);
  const [selectedWeek, setSelectedWeek] = useState<WeekItem>(getDefaultWeek());
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const t = setTimeout(() => searchRef.current?.focus(), 300);
    return () => clearTimeout(t);
  }, []);

  return (
    <View style={styles.container}>
      <TextInput
        ref={searchRef}
        style={styles.searchBar}
        placeholder="Search Client or Address..."
        placeholderTextColor="#605E5C"
        value={searchQuery}
        onChangeText={setSearchQuery}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <WeekPillSlider
        selectedWeek={selectedWeek}
        onSelectWeek={setSelectedWeek}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sectionTitle}>Best Options</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.bestOptionsRow}
          style={styles.bestOptionsScroll}
        >
          {BEST_OPTIONS.map((opt) => (
            <View key={opt.id} style={styles.bestOptionCard}>
              <MeetingCard
                timeRange={opt.timeRange}
                client={opt.label}
                address=""
                statusColor={opt.statusColor}
              />
            </View>
          ))}
        </ScrollView>

        <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>By Day</Text>
        {BY_DAY_GROUPS.map((group) => (
          <View key={group.dayLabel} style={styles.dayGroup}>
            <Text style={styles.dayLabel}>{group.dayLabel}</Text>
            {group.slots.map((slot) => (
              <MeetingCard
                key={slot.id}
                timeRange={slot.timeRange}
                client={slot.timeSlotLabel}
                address=""
                statusColor={slot.statusColor}
              />
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F2F1',
  },
  searchBar: {
    backgroundColor: '#E1DFDD',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 8,
    fontSize: 16,
    color: '#1a1a1a',
    minHeight: 52,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: MS_BLUE,
    marginBottom: 12,
  },
  sectionTitleSpaced: {
    marginTop: 24,
  },
  bestOptionsScroll: {
    marginHorizontal: -16,
  },
  bestOptionsRow: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    flexDirection: 'row',
  },
  bestOptionCard: {
    width: 280,
    marginRight: 12,
  },
  dayGroup: {
    marginBottom: 20,
  },
  dayLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 10,
  },
});
