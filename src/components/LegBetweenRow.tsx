import React, { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Car } from 'lucide-react-native';
import { formatTime } from '../utils/dateUtils';
import { formatDistance } from '../utils/routeBubbles';

export type LegBetweenRowProps = {
  /** Drive duration in seconds */
  durationSec: number;
  /** Distance in meters */
  distanceM: number;
  /** ETA at next stop (ms) */
  etaAtNextMs: number;
  /** Wait time before next meeting (minutes). Negative = late */
  waitMin: number;
  /** Optional: 'tight' | 'late' | 'ok' for stress color */
  stress?: 'tight' | 'late' | 'ok';
  /** Label e.g. "To next" or "From home" or "Home" */
  label?: string;
};

const BLUE = '#2563EB';
const LIGHT_BLUE = '#EFF6FF';
const RED = '#EF4444';
const YELLOW = '#F59E0B';
const GRAY = '#94A3B8';

function LegBetweenRow({
  durationSec,
  distanceM,
  etaAtNextMs,
  waitMin,
  stress = 'ok',
  label,
}: LegBetweenRowProps) {
  const driveMin = Math.max(1, Math.round(durationSec / 60));
  const etaStr = formatTime(etaAtNextMs);
  const isToHome = label === 'To home';

  const waitStr = isToHome
    ? null
    : waitMin < 0
      ? `${Math.abs(Math.round(waitMin))} min late`
      : waitMin < 1
        ? 'No wait'
        : `Wait ${Math.round(waitMin)} min`;

  // Determine colors based on status
  let stressColor = BLUE;
  let bgColor = 'transparent';

  if (stress === 'late') {
    stressColor = RED;
  } else if (stress === 'tight') {
    stressColor = YELLOW;
  }

  return (
    <View style={styles.container}>
      {/* Visual Linking Line matches MeetingCard timeline node col */}
      <View style={styles.lineCol}>
        <View style={styles.verticalLine} />
      </View>

      <View style={styles.contentCol}>
        <View style={[styles.pill, { backgroundColor: bgColor, borderColor: stressColor + '40' }]}>
          <Car size={12} color={stressColor} style={styles.icon} />

          <Text style={[styles.pillText, { color: stressColor }]}>
            {driveMin} min · {formatDistance(distanceM)}
          </Text>

          {waitStr ? (
            <Text style={[styles.waitText, { color: stress === 'late' ? RED : GRAY }]}>
              · {waitStr}
            </Text>
          ) : null}
        </View>
        <Text style={styles.etaText}>
          {isToHome ? `Arrive ~${etaStr}` : `Expected ETA: ${etaStr}`}
        </Text>
      </View>
    </View>
  );
}

export default memo(LegBetweenRow);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    minHeight: 40,
    marginTop: -8, // Pulls the line up to connect to the card above
    marginBottom: 0,
  },
  lineCol: {
    width: 50 + 24 + 10, // Match the exact offset from MeetingCard (timelineCol + node radius)
    alignItems: 'center',
    paddingRight: 12,
  },
  verticalLine: {
    width: 0,
    flex: 1,
    borderLeftWidth: 2,
    borderColor: '#DBEAFE', // Light blue line
    borderStyle: 'dashed',
    marginLeft: 32, // Adjust to center directly under the TimelineNode circle
  },
  contentCol: {
    flex: 1,
    paddingVertical: 12,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
    borderWidth: 1,
  },
  icon: {
    marginRight: 6,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  waitText: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  etaText: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 4,
    marginLeft: 2,
    fontWeight: '500',
  }
});
