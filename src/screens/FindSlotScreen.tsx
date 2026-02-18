import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import type { ScheduleStackParamList } from '../navigation/ScheduleStack';
import { findSmartSlots, type ScoredSlot, type Coordinate } from '../utils/scheduler';
import { useRoute as useRouteData } from '../context/RouteContext';
import { useUserPreferences } from '../context/UserPreferencesContext';

const MS_PER_MIN = 60_000;

/** Format epoch ms to "HH:MM" (local time). Deterministic for given ms. */
function formatTimeMs(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/**
 * Format dayIso (YYYY-MM-DD) to readable date.
 * Uses explicit local date construction to avoid UTC parsing shifts.
 */
function formatDayIso(dayIso: string): string {
  const [y, mo, d] = dayIso.split('-').map((x) => parseInt(x, 10));
  const date = new Date(y, mo - 1, d);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** User-friendly detour label: negative = "Saves X min", positive = "+X min", zero = "0 min" */
function formatDetour(detourMinutes: number): string {
  if (detourMinutes < 0) return `Saves ${Math.abs(detourMinutes)} min`;
  if (detourMinutes > 0) return `+${detourMinutes} min`;
  return '0 min';
}

type SlotCardProps = {
  slot: ScoredSlot;
  preBuffer: number;
  postBuffer: number;
  /** True if this slot has the lowest score among all slots (Best Match badge) */
  isBestMatch: boolean;
};

function SlotCard({ slot, preBuffer, postBuffer, isBestMatch }: SlotCardProps) {
  const arriveByMs = slot.startMs - preBuffer * MS_PER_MIN;
  const departAtMs = slot.endMs + postBuffer * MS_PER_MIN;

  /** On Your Route: detour ≤ 5 km means the new stop is on the existing route */
  const isOnRoute = (slot.metrics.detourKm ?? 0) <= 5;

  return (
    <View style={styles.card}>
      {isBestMatch && (
        <View style={styles.badgeBest}>
          <Text style={styles.badgeBestText}>✨ Best Match</Text>
        </View>
      )}
      {slot.tier === 4 && !isBestMatch && (
        <View style={[styles.badgeOnRoute, { backgroundColor: '#e0f2fe' }]}>
          <Text style={[styles.badgeOnRouteText, { color: '#0369a1' }]}>🗓 New Day</Text>
        </View>
      )}
      {slot.tier === 1 && !isBestMatch && (
        <View style={styles.badgeOnRoute}>
          <Text style={styles.badgeOnRouteText}>⚡ On Route</Text>
        </View>
      )}
      {slot.tier === 2 && !isBestMatch && (
        <View style={[styles.badgeOnRoute, { backgroundColor: '#fef3c7' }]}>
          <Text style={[styles.badgeOnRouteText, { color: '#92400e' }]}>📍 Nearby</Text>
        </View>
      )}
      <Text style={styles.cardDay}>{formatDayIso(slot.dayIso)}</Text>
      <Text style={styles.cardTitle}>
        {formatTimeMs(slot.startMs)} – {formatTimeMs(slot.endMs)}
      </Text>
      <Text style={styles.contextLine}>
        Arrive by {formatTimeMs(arriveByMs)} (+{preBuffer}m)
      </Text>
      <Text style={styles.contextLine}>
        Depart at {formatTimeMs(departAtMs)} (+{postBuffer}m)
      </Text>
      <Text style={styles.reasoning}>{slot.label}</Text>
      <View style={styles.impactRow}>
        <Text style={styles.impactItem}>
          🚗 {slot.tier === 4
            ? `Round trip: ${slot.metrics.detourKm != null ? `${slot.metrics.detourKm.toFixed(1)} km` : `${slot.metrics.detourMinutes} min`}`
            : `Detour: ${slot.metrics.detourKm != null ? (slot.metrics.detourKm > 0 ? `+${slot.metrics.detourKm.toFixed(1)} km` : '0 km') : formatDetour(slot.metrics.detourMinutes)}`}
        </Text>
        <Text style={styles.impactItem}>Slack: {slot.metrics.slackMinutes} min</Text>
        <Text style={styles.impactItem}>
          Travel: {slot.metrics.travelToMinutes}m + {slot.metrics.travelFromMinutes}m
        </Text>
      </View>
    </View>
  );
}

export default function FindSlotScreen() {
  const route = useRoute<RouteProp<ScheduleStackParamList, 'FindSlot'>>();
  const { appointments } = useRouteData();
  const { preferences } = useUserPreferences();

  const params = route.params ?? {};
  const newLocation: Coordinate =
    params.newLocation ??
    { lat: 55.458, lon: 12.182 };
  const durationMinutes = params.durationMinutes ?? 60;

  const searchWindow = useMemo(() => {
    const start = new Date();
    const end = new Date();
    end.setDate(end.getDate() + 7);
    return { start, end };
  }, []);

  const slots = useMemo(() => {
    return findSmartSlots({
      schedule: appointments,
      newLocation,
      durationMinutes,
      preferences,
      searchWindow,
    });
  }, [appointments, newLocation, durationMinutes, preferences, searchWindow]);

  const preBuffer = preferences.preMeetingBuffer ?? 15;
  const postBuffer = preferences.postMeetingBuffer ?? 15;

  /** Best Match = lowest score. Explicit comparison ensures correctness regardless of sort order. */
  const minScore = slots.length > 0 ? Math.min(...slots.map((s) => s.score)) : Infinity;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.header}>
        {slots.length} slot{slots.length !== 1 ? 's' : ''} found
      </Text>
      {slots.length === 0 ? (
        <Text style={styles.empty}>
          No slots fit your schedule in the next 7 days. Try a shorter duration or different dates.
        </Text>
      ) : (
        slots.map((slot) => (
          <SlotCard
            key={`${slot.dayIso}-${slot.startMs}`}
            slot={slot}
            preBuffer={preBuffer}
            postBuffer={postBuffer}
            isBestMatch={slot.score === minScore}
          />
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F2F1',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 16,
  },
  empty: {
    fontSize: 15,
    color: '#605E5C',
    textAlign: 'center',
    paddingVertical: 32,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  badgeBest: {
    alignSelf: 'flex-start',
    backgroundColor: '#107C10',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 10,
  },
  badgeBestText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  badgeOnRoute: {
    alignSelf: 'flex-start',
    backgroundColor: '#0078D4',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 10,
  },
  badgeOnRouteText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  cardDay: {
    fontSize: 13,
    color: '#605E5C',
    marginBottom: 2,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  contextLine: {
    fontSize: 14,
    color: '#605E5C',
    marginBottom: 4,
  },
  reasoning: {
    fontSize: 13,
    color: '#0078D4',
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 8,
  },
  impactRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
  },
  impactItem: {
    fontSize: 12,
    color: '#605E5C',
    marginRight: 16,
    marginBottom: 4,
  },
});
