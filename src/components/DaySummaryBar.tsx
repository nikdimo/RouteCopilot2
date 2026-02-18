import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
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

export default function DaySummaryBar({
  totalDriveSec,
  totalDistanceM,
  departByMs,
  returnByMs,
  tightCount,
  lateCount,
  longWaitCount = 0,
}: DaySummaryBarProps) {
  const totalDriveStr = formatDurationSeconds(totalDriveSec);
  const totalDistStr = formatDistance(totalDistanceM);
  const summaryParts: string[] = [];
  if (lateCount > 0) summaryParts.push(`${lateCount} late`);
  if (tightCount > 0) summaryParts.push(`${tightCount} tight`);
  if (longWaitCount > 0) summaryParts.push(`${longWaitCount} long wait`);
  const summaryStr = summaryParts.length > 0 ? summaryParts.join(', ') : 'On time';

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text style={styles.primary}>
          {totalDriveStr} drive · {totalDistStr}
        </Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.secondary}>
          Out {formatTime(departByMs)} · Back ~{formatTime(returnByMs)}
        </Text>
      </View>
      <View style={styles.row}>
        <Text
          style={[
            styles.badge,
            (lateCount > 0 || tightCount > 0) && styles.badgeWarning,
            lateCount > 0 && styles.badgeLate,
          ]}
        >
          {summaryStr}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  row: {
    marginBottom: 4,
  },
  rowLast: {
    marginBottom: 0,
  },
  primary: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  secondary: {
    fontSize: 13,
    color: '#605E5C',
  },
  badge: {
    fontSize: 12,
    fontWeight: '600',
    color: '#107C10',
    marginTop: 4,
  },
  badgeWarning: {
    color: '#C19C00',
  },
  badgeLate: {
    color: '#D13438',
  },
});
