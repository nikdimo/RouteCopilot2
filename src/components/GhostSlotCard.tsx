import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Modal,
  ScrollView,
} from 'react-native';
import { MapPin, Info } from 'lucide-react-native';
import type { ScoredSlot, SlotExplain } from '../utils/scheduler';

const MS_PER_MIN = 60_000;

function formatTimeMs(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function formatDayLabel(dayIso: string): string {
  const [y, mo, d] = dayIso.split('-').map((x) => parseInt(x, 10));
  const date = new Date(y, mo - 1, d);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatDetour(detourMinutes: number): string {
  if (detourMinutes < 0) return `Saves ${Math.abs(detourMinutes)} min`;
  if (detourMinutes > 0) return `+${detourMinutes} min`;
  return '0 min';
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function ExplainSheet({ explain, onClose }: { explain: SlotExplain; onClose: () => void }) {
  const prevStr = `${explain.prev.title} (${formatTime(explain.prev.startMs)}–${formatTime(explain.prev.endMs)}, coord=${explain.prev.hasCoord ? 'yes' : 'no'})`;
  const nextStr = `${explain.next.title} (${formatTime(explain.next.startMs)}–${formatTime(explain.next.endMs)}, coord=${explain.next.hasCoord ? 'yes' : 'no'})`;

  const reachable = (explain.reachableFromWorkStart ?? true) && (explain.travelFeasibleFromNow ?? explain.travelFeasible ?? true);
  const conflictFree = explain.noOverlap;
  const onTime = explain.arriveEarlyPreferred === true || (explain.arrivalMarginMinutes != null && explain.arrivalMarginMinutes >= 0);
  const efficient = explain.detourMinutes <= 20;

  return (
    <Modal visible transparent animationType="slide">
      <TouchableOpacity style={explainStyles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={explainStyles.sheet} onStartShouldSetResponder={() => true}>
          <Text style={explainStyles.title}>Why this slot was suggested</Text>
          <Text style={explainStyles.checklist}>Feasibility Checklist</Text>
          <Text style={explainStyles.checkItem}>{reachable ? '✅' : '○'} Reachable from start</Text>
          <Text style={explainStyles.checkItem}>{conflictFree ? '✅' : '○'} Conflict-free</Text>
          <Text style={explainStyles.checkItem}>{onTime ? '✅' : '○'} On time (travel + buffer)</Text>
          <Text style={explainStyles.checkItem}>{efficient ? '✅' : '○'} Efficient: +{explain.detourMinutes} min detour</Text>
          <Text style={explainStyles.section}>Prev: {prevStr}</Text>
          <Text style={explainStyles.section}>Next: {nextStr}</Text>
          <ScrollView style={explainStyles.scroll}>
            <Text style={explainStyles.section}>Gap: {explain.gapMinutes.toFixed(1)} min</Text>
            <Text style={explainStyles.section}>Travel: {explain.travelToMinutes}m to, {explain.travelFromMinutes}m from {explain.travelToUsedFallback || explain.travelFromUsedFallback ? '(fallback coords)' : ''}</Text>
            <Text style={explainStyles.section}>Buffers: pre={explain.preBuffer}m post={explain.postBuffer}m</Text>
            <Text style={explainStyles.section}>Meeting: {formatTime(explain.meetingStartMs)}–{formatTime(explain.meetingEndMs)}</Text>
            <Text style={explainStyles.section}>Baseline: {explain.baselineMinutes}m | New path: {explain.newPathMinutes}m | Detour: {explain.detourMinutes}m</Text>
            <Text style={explainStyles.section}>Slack: {explain.slackMinutes}m | Score: {explain.score}</Text>
            <Text style={explainStyles.section}>Times: arriveBy={formatTime(explain.arriveByMs)} departAt={formatTime(explain.departAtMs)}</Text>
            <Text style={explainStyles.section}>Constraints: fitsGap={explain.fitsGap} withinHours={explain.withinWorkingHours} notPast={explain.notPast} noOverlap={explain.noOverlap} travelFeasible={explain.travelFeasible}</Text>
            {(explain.bufferWaivedAtStart || explain.bufferWaivedAtEnd) && (
              <Text style={[explainStyles.section, explainStyles.warn]}>
                Buffers waived at boundary: start={String(explain.bufferWaivedAtStart)} end={String(explain.bufferWaivedAtEnd)}
              </Text>
            )}
            {explain.eventsWithMissingCoordsUsed.length > 0 && (
              <Text style={[explainStyles.section, explainStyles.warn]}>Events used with fallback coords: {explain.eventsWithMissingCoordsUsed.join(', ')}</Text>
            )}
          </ScrollView>
          <TouchableOpacity style={explainStyles.closeBtn} onPress={onClose}>
            <Text style={explainStyles.closeBtnText}>Close</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const explainStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '70%', padding: 16 },
  title: { fontSize: 18, fontWeight: '700', color: '#1a1a1a', marginBottom: 12 },
  checklist: { fontSize: 14, fontWeight: '600', color: '#1a1a1a', marginBottom: 8 },
  checkItem: { fontSize: 14, color: '#374151', marginBottom: 4 },
  scroll: { maxHeight: 320, marginBottom: 12 },
  section: { fontSize: 13, color: '#374151', marginBottom: 6, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  warn: { color: '#b45309' },
  closeBtn: { paddingVertical: 12, alignItems: 'center', backgroundColor: '#0078D4', borderRadius: 8 },
  closeBtnText: { color: '#fff', fontWeight: '600' },
});

export type GhostSlotCardProps = {
  slot: ScoredSlot;
  preBuffer: number;
  postBuffer: number;
  isSelected: boolean;
  isBestOption?: boolean;
  /** When true, show date in the header (e.g. for Best Options carousel) */
  showDate?: boolean;
  onSelect: () => void;
  onMapPress: () => void;
};

export default function GhostSlotCard({
  slot,
  preBuffer,
  postBuffer,
  isSelected,
  isBestOption,
  showDate,
  onSelect,
  onMapPress,
}: GhostSlotCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showExplain, setShowExplain] = useState(false);
  const arriveByMs = slot.startMs - preBuffer * MS_PER_MIN;
  const departAtMs = slot.endMs + postBuffer * MS_PER_MIN;
  const isOnRoute = slot.metrics.detourMinutes <= 5;
  const hasExplain = typeof __DEV__ !== 'undefined' && __DEV__ && slot.explain;

  const handleInfoPress = () => {
    if (hasExplain) {
      setShowExplain(true);
    } else {
      setExpanded(!expanded);
    }
  };

  const whyLine = hasExplain && slot.explain
    ? `Prev=${slot.explain.prev.title} (${formatTime(slot.explain.prev.startMs)}–${formatTime(slot.explain.prev.endMs)}, coord=${slot.explain.prev.hasCoord ? 'yes' : 'no'}) Next=${slot.explain.next.title} (${formatTime(slot.explain.next.startMs)}–${formatTime(slot.explain.next.endMs)}, coord=${slot.explain.next.hasCoord ? 'yes' : 'no'})`
    : null;

  return (
    <TouchableOpacity
      style={[styles.card, isSelected && styles.cardSelected]}
      onPress={onSelect}
      activeOpacity={0.85}
    >
      <View style={[styles.ghostLine, isSelected && styles.ghostLineSelected]} />
      <View style={styles.content}>
        <View style={styles.main}>
          <View style={styles.headerRow}>
            <Text style={styles.time}>
              {showDate ? `${formatDayLabel(slot.dayIso)} · ` : ''}
              {formatTimeMs(slot.startMs)} – {formatTimeMs(slot.endMs)}
            </Text>
            {isBestOption && (
              <View style={styles.bestBadge}>
                <Text style={styles.bestBadgeText}>✨ Best</Text>
              </View>
            )}
          </View>
          <Text style={styles.label}>{slot.label}</Text>
          {whyLine != null && (
            <Text style={styles.whyLine} numberOfLines={2}>{whyLine}</Text>
          )}
          <View style={styles.badges}>
            {isOnRoute ? (
              <View style={styles.onRouteBadge}>
                <Text style={styles.onRouteText}>⚡ On your route</Text>
              </View>
            ) : (
              <Text style={styles.detourText}>
                🚗 Detour: {formatDetour(slot.metrics.detourMinutes)}
              </Text>
            )}
          </View>
          {expanded && !hasExplain && (
            <View style={styles.expanded}>
              <Text style={styles.expandedLine}>
                Arrive by {formatTimeMs(arriveByMs)} (+{preBuffer}m)
              </Text>
              <Text style={styles.expandedLine}>
                Depart at {formatTimeMs(departAtMs)} (+{postBuffer}m)
              </Text>
              <Text style={styles.expandedLine}>
                Travel: {slot.metrics.travelToMinutes}m + {slot.metrics.travelFromMinutes}m
              </Text>
              <Text style={styles.expandedLine}>Slack: {slot.metrics.slackMinutes} min</Text>
            </View>
          )}
        </View>
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.expandBtn}
            onPress={handleInfoPress}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Info color="#605E5C" size={18} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.mapBtn}
            onPress={onMapPress}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MapPin color="#0078D4" size={20} />
          </TouchableOpacity>
        </View>
      </View>
      {hasExplain && slot.explain && showExplain && (
        <ExplainSheet explain={slot.explain} onClose={() => setShowExplain(false)} />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderRadius: 8,
    marginBottom: 10,
    minHeight: 72,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#94a3b8',
    overflow: 'hidden',
  },
  cardSelected: {
    backgroundColor: '#fff',
    borderStyle: 'solid',
    borderColor: '#0078D4',
  },
  ghostLine: {
    width: 4,
    alignSelf: 'stretch',
    backgroundColor: '#94a3b8',
  },
  ghostLineSelected: {
    backgroundColor: '#0078D4',
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  main: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  time: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1a1a1a',
    marginRight: 8,
  },
  bestBadge: {
    backgroundColor: '#107C10',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  bestBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  label: {
    fontSize: 13,
    color: '#605E5C',
    marginBottom: 4,
  },
  whyLine: {
    fontSize: 10,
    color: '#64748b',
    marginBottom: 4,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  badges: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  onRouteBadge: {
    backgroundColor: 'rgba(0,120,212,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  onRouteText: {
    fontSize: 12,
    color: '#0078D4',
    fontWeight: '600',
  },
  detourText: {
    fontSize: 12,
    color: '#605E5C',
  },
  expanded: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E1DFDD',
  },
  expandedLine: {
    fontSize: 12,
    color: '#605E5C',
    marginBottom: 2,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
  },
  expandBtn: {
    padding: 6,
    marginRight: 4,
  },
  mapBtn: {
    padding: 6,
  },
});
