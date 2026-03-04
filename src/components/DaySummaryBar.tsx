import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Clock, Navigation, Car, Flag } from 'lucide-react-native';
import { formatTime } from '../utils/dateUtils';
import { formatDurationSeconds } from '../utils/dateUtils';
import { formatDistance } from '../utils/routeBubbles';

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
const LIGHT_BLUE = '#EFF6FF';
const TEXT_MUTED = '#94A3B8';
const TEXT_DARK = '#0F172A';

export default function DaySummaryBar({
  totalDriveSec,
  totalDistanceM,
  departByMs,
  returnByMs,
}: DaySummaryBarProps) {
  const totalDriveStr = formatDurationSeconds(totalDriveSec);
  const totalDistStr = formatDistance(totalDistanceM);

  const startTimeStr = formatTime(departByMs);
  const endTimeStr = formatTime(returnByMs);

  return (
    <View style={styles.gridContainer}>
      <View style={styles.row}>
        {/* Box 1: Drive Time */}
        <View style={styles.card}>
          <View style={styles.header}>
            <Clock size={14} color={MS_BLUE} />
            <Text style={styles.label}>TOTAL DRIVE TIME</Text>
          </View>
          <Text style={styles.value}>{totalDriveStr.replace(' hr', 'h').replace(' min', ' min')} drive</Text>
        </View>

        {/* Box 2: Distance */}
        <View style={styles.card}>
          <View style={styles.header}>
            <Navigation size={14} color="#9333EA" />
            <Text style={styles.label}>TOTAL DISTANCE</Text>
          </View>
          <Text style={styles.value}>{totalDistStr}</Text>
        </View>
      </View>

      <View style={styles.row}>
        {/* Box 3: Start Time */}
        <View style={styles.card}>
          <View style={styles.header}>
            <Car size={14} color="#16A34A" />
            <Text style={styles.label}>START TIME</Text>
          </View>
          <Text style={styles.value}>{startTimeStr}</Text>
        </View>

        {/* Box 4: End Time */}
        <View style={styles.card}>
          <View style={styles.header}>
            <Flag size={14} color="#D97706" />
            <Text style={styles.label}>END TIME</Text>
          </View>
          <Text style={styles.value}>{endTimeStr}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  gridContainer: {
    paddingHorizontal: 16,
    marginBottom: 24,
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  card: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.02,
    shadowRadius: 4,
    elevation: 2,
    minHeight: 70,
    justifyContent: 'flex-start',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  label: {
    fontSize: 9,
    fontWeight: '800',
    color: TEXT_MUTED,
    letterSpacing: 0.5,
  },
  value: {
    fontSize: 16,
    fontWeight: '800',
    color: TEXT_DARK,
  },
});
