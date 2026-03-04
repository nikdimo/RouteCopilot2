import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Clock, Navigation, Car, Flag } from 'lucide-react-native';
import { formatTime } from '../utils/dateUtils';
import { formatDurationSeconds } from '../utils/dateUtils';
import { formatDistance } from '../utils/routeBubbles';
import { useIsWideScreen } from '../hooks/useIsWideScreen';

export type DaySummaryBarProps = {
  totalDriveSec: number;
  totalDistanceM: number;
  departByMs: number;
  returnByMs: number;
  tightCount: number;
  lateCount: number;
  longWaitCount?: number;
};

const MS_BLUE = '#2563EB';
const TEXT_MUTED = '#94A3B8';
const TEXT_DARK = '#0F172A';

const SummaryCard = ({ icon: Icon, color, label, value, isWide }: any) => (
  <View style={[styles.card, isWide && styles.cardWide]}>
    <View style={styles.header}>
      <Icon size={14} color={color} />
      <Text style={[styles.label, isWide && styles.labelWide]} numberOfLines={1}>{label}</Text>
    </View>
    <Text style={[styles.value, isWide && styles.valueWide]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
  </View>
);

export default function DaySummaryBar({
  totalDriveSec,
  totalDistanceM,
  departByMs,
  returnByMs,
}: DaySummaryBarProps) {
  const isWide = useIsWideScreen();
  const totalDriveStr = formatDurationSeconds(totalDriveSec);
  const totalDistStr = formatDistance(totalDistanceM);

  const startTimeStr = formatTime(departByMs);
  const endTimeStr = formatTime(returnByMs);

  const cards = [
    { id: 1, icon: Clock, color: MS_BLUE, label: 'Time', value: totalDriveStr.replace(' hr', 'h').replace(' min', ' min') },
    { id: 2, icon: Navigation, color: '#9333EA', label: 'Distance', value: totalDistStr },
    { id: 3, icon: Car, color: '#16A34A', label: 'START TIME', value: startTimeStr },
    { id: 4, icon: Flag, color: '#D97706', label: 'END TIME', value: endTimeStr },
  ];

  if (isWide) {
    return (
      <View style={styles.gridContainer}>
        <View style={styles.wideRow}>
          {cards.map(c => <SummaryCard key={c.id} {...c} isWide={true} />)}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.gridContainer}>
      <View style={styles.row}>
        <SummaryCard {...cards[0]} />
        <SummaryCard {...cards[1]} />
      </View>
      <View style={styles.row}>
        <SummaryCard {...cards[2]} />
        <SummaryCard {...cards[3]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  gridContainer: {
    paddingHorizontal: 12,
    marginBottom: 8,
    marginTop: 4,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  wideRow: {
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'space-between',
  },
  card: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
    justifyContent: 'flex-start',
  },
  cardWide: {
    padding: 6,
    borderRadius: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  label: {
    fontSize: 8,
    fontWeight: '800',
    color: TEXT_MUTED,
    letterSpacing: 0.5,
  },
  labelWide: {
    fontSize: 7,
    letterSpacing: 0.2,
  },
  value: {
    fontSize: 14,
    fontWeight: '800',
    color: TEXT_DARK,
  },
  valueWide: {
    fontSize: 12,
  },
});
