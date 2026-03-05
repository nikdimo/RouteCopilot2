import React from 'react';
import { View, Text, StyleSheet, ScrollView, Platform } from 'react-native';
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
};

const MS_BLUE = '#2563EB';
const TEXT_MUTED = '#94A3B8';
const TEXT_DARK = '#0F172A';
/** Min width so "Distance" + "9,0 km" / "16 min" fit; cards stay equal. */
const CARD_MIN_WIDTH = 96;

const SummaryCard = ({ icon: Icon, color, label, value, isWide }: any) => (
  <View style={[styles.card, isWide && styles.cardWide, isWide && { minWidth: CARD_MIN_WIDTH }]}>
    <View style={styles.header}>
      <Icon size={14} color={color} style={styles.iconFixed} />
      <Text
        style={[styles.label, isWide && styles.labelWide]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.5}
      >
        {label}
      </Text>
    </View>
    <Text
      style={[styles.value, isWide && styles.valueWide]}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.5}
    >
      {value}
    </Text>
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
    { id: 1, icon: Clock, color: MS_BLUE, label: 'Time', value: totalDriveStr },
    { id: 2, icon: Navigation, color: '#9333EA', label: 'Distance', value: totalDistStr },
    { id: 3, icon: Car, color: '#16A34A', label: 'Start', value: startTimeStr },
    { id: 4, icon: Flag, color: '#D97706', label: 'End', value: endTimeStr },
  ];

  const cardsSection = isWide ? (
    <View style={styles.wideRow}>
      {cards.map(c => <SummaryCard key={c.id} {...c} isWide={true} />)}
    </View>
  ) : (
    <>
      <View style={styles.row}>
        <SummaryCard {...cards[0]} />
        <SummaryCard {...cards[1]} />
      </View>
      <View style={styles.row}>
        <SummaryCard {...cards[2]} />
        <SummaryCard {...cards[3]} />
      </View>
    </>
  );

  if (isWide) {
    const wideRow = (
      <View style={styles.wideRowWrap}>
        {Platform.OS === 'web' ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.wideRowScrollContent, { minWidth: CARD_MIN_WIDTH * 4 + 18 }]}
            style={styles.wideRowScroll}
          >
            {cardsSection}
          </ScrollView>
        ) : (
          cardsSection
        )}
      </View>
    );
    return <View style={styles.gridContainer}>{wideRow}</View>;
  }

  return (
    <View style={styles.gridContainer}>
      {cardsSection}
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
  wideRowWrap: {
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  wideRow: {
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'space-between',
    flex: 1,
  },
  wideRowScroll: {
    flexGrow: 1,
  },
  wideRowScrollContent: {
    flexGrow: 1,
  },
  card: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    justifyContent: 'flex-start',
    ...Platform.select({
      web: {
        boxShadow: '0px 2px 6px rgba(0, 0, 0, 0.08)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 6,
        elevation: 3,
      },
    }),
  },
  cardWide: {
    padding: 6,
    borderRadius: 8,
  },
  iconFixed: {
    flexShrink: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
    minWidth: 0,
  },
  label: {
    flex: 1,
    fontSize: 8,
    fontWeight: '800',
    color: TEXT_MUTED,
    letterSpacing: 0.5,
    minWidth: 0,
  },
  labelWide: {
    fontSize: 7,
    letterSpacing: 0.2,
  },
  value: {
    fontSize: 14,
    fontWeight: '800',
    color: TEXT_DARK,
    minWidth: 0,
  },
  valueWide: {
    fontSize: 12,
  },
});
