import React from 'react';
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

export default function LegBetweenRow({
  durationSec,
  distanceM,
  etaAtNextMs,
  waitMin,
  stress = 'ok',
  label,
}: LegBetweenRowProps) {
  const driveMin = Math.round(durationSec / 60);
  const etaStr = formatTime(etaAtNextMs);
  const isToHome = label === 'To home';
  const waitStr = isToHome
    ? null
    : waitMin < 0
      ? `${Math.abs(Math.round(waitMin))} min late`
      : waitMin < 1
        ? 'No wait'
        : `Wait ${Math.round(waitMin)} min`;
  const stressColor =
    stress === 'late' ? '#D13438' : stress === 'tight' ? '#C19C00' : '#605E5C';

  const borderColor = stress === 'late' ? '#D13438' : stress === 'tight' ? '#C19C00' : undefined;
  const stressStyle =
    stress !== 'ok'
      ? [
          styles.containerStress,
          borderColor && { borderLeftColor: borderColor },
          stress === 'late' && { backgroundColor: '#FDE7E9' },
        ]
      : [];
  return (
    <View style={[styles.container, ...stressStyle]}>
      <View style={styles.iconWrap}>
        <Car size={16} color={stressColor} />
      </View>
      <View style={styles.content}>
        {label ? <Text style={styles.label}>{label}</Text> : null}
        <Text style={styles.line1}>
          {driveMin} min · {formatDistance(distanceM)}
        </Text>
        <Text style={[styles.line2, { color: stressColor }]}>
          {isToHome ? `Arrive ~${etaStr}` : `Arrive ${etaStr} · ${waitStr}`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#E8E8E8',
    borderRadius: 8,
  },
  containerStress: {
    backgroundColor: '#FFF4CE',
    borderLeftWidth: 4,
  },
  iconWrap: {
    marginRight: 12,
  },
  content: {
    flex: 1,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  line1: {
    fontSize: 14,
    fontWeight: '600',
    color: '#323130',
  },
  line2: {
    fontSize: 12,
    marginTop: 2,
  },
});
