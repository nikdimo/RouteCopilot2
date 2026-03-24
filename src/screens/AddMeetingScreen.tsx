import React, { useState, useRef, useEffect, useMemo, Suspense } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Alert,
  Switch,
  Platform,
  Animated,
  PanResponder,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { addDays, endOfDay, startOfDay, startOfWeek } from 'date-fns';
import Constants from 'expo-constants';
import { useAuth } from '../context/AuthContext';
import { useRoute } from '../context/RouteContext';
import { useUserPreferences } from '../context/UserPreferencesContext';
import { useDevUI } from '../context/DevUIContext';
import {
  compareScoredSlots,
  findSmartSlots,
  getTravelMinutes,
  getBestBadgeSlotId,
  pickBestOptionsWithDayDiversity,
  slotId,
  type ScoredSlot,
  type Coordinate,
  type QASlotConsidered,
} from '../utils/scheduler';
import { useQALog } from '../context/QALogContext';
import { toLocalDayKey } from '../utils/dateUtils';
import {
  geocodeAddress,
  geocodeAddressGoogle,
  geocodeContactAddress,
  getAddressSuggestions,
  getAddressSuggestionsGoogle,
  getCoordsForPlaceId,
} from '../utils/geocoding';
import { searchContacts as searchContactsGraph } from '../services/graph';
import TimeframeSelector, {
  getSearchWindow,
  type TimeframeSelection,
} from '../components/TimeframeSelector';
import MeetingDurationFlexTimeline from '../components/MeetingDurationFlexTimeline';
import DayTimeline, { buildTimelineEntries } from '../components/DayTimeline';
import GhostSlotCard from '../components/GhostSlotCard';
import ConfirmBookingSheet, {
  type ContactInput,
  type ConfirmFlexConfig,
} from '../components/ConfirmBookingSheet';

const isExpoGo = Constants.appOwnership === 'expo';
const MapPreviewModal = React.lazy(() => import('../components/MapPreviewModal'));
const PlanVisitMapPanel = React.lazy(() => import('../components/PlanVisitMapPanel'));
import { useIsWideScreen } from '../hooks/useIsWideScreen';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LocationSearch, {
  type LocationSelection,
} from '../components/LocationSearch';
import {
  createCalendarEvent,
  updateCalendarEvent,
  createContact,
  getCalendarEvents,
  GraphUnauthorizedError,
  type CalendarEvent,
} from '../services/graph';
import { clearGraphSession, isMagicAuthToken } from '../services/graphAuth';
import { BACKEND_API_ENABLED } from '../config/backend';
import { backendAppendMeetingDecisionAudit } from '../services/backendApi';
import { getLocalMeetingsInRange } from '../services/localMeetings';
import {
  allocateMeetingDecisionCode,
  appendMeetingCodeSuffix,
  appendMeetingDecisionEntry,
  stripMeetingCodeSuffix,
  type MeetingDecisionAction,
  type MeetingDecisionCandidate,
  type MeetingDecisionConsideredSlot,
} from '../services/meetingDecisionLog';
import { sortAppointmentsByTime } from '../utils/optimization';
import { buildRouteWithInsertionMeta } from '../utils/mapPreview';
import { DEFAULT_HOME_BASE } from '../types';
import { getEffectiveSubscriptionTier, getTierEntitlements } from '../utils/subscription';

const MS_BLUE = '#0078D4';
const MS_PER_MIN = 60_000;
const IMPACT_DRAWER_WIDTH = 360;
const FLEX_WINDOW_REGEX = /\[Flexible Window:\s*([0-2]?\d:[0-5]\d)\s*to\s*([0-2]?\d:[0-5]\d)(?:\s*\|[^\]]*)?\]/i;
const DECISION_CODE_TAG_REGEX = /\[Decision Code:\s*\d{4}\]/i;

function toCoord(ev: CalendarEvent): Coordinate | null {
  const c = ev.coordinates;
  if (!c || typeof c.latitude !== 'number' || typeof c.longitude !== 'number') return null;
  return { lat: c.latitude, lon: c.longitude };
}

const DEFAULT_DURATION_OPTS: [number, number, number] = [30, 60, 90];
const MAX_DURATION_MINUTES = 8 * 60;
const DURATION_STEP_MINUTES = 15;
const FLEXIBLE_WINDOW_TAG_REGEX = /\[Flexible Window:[^\]]+\]/i;
type DurationPreset = number | 'custom';
type MeetingConfigSnapshot = {
  durationMinutes: number;
  flexibleMeetingEnabled: boolean;
  flexBeforeMinutes: number;
  flexAfterMinutes: number;
};

function normalizeDurationOptions(
  values: [number, number, number] | undefined | null
): [number, number, number] {
  if (!values) return DEFAULT_DURATION_OPTS;
  const normalized = values
    .map((value, index) => {
      const fallback = DEFAULT_DURATION_OPTS[index]!;
      const safe = Number.isFinite(value) ? value : fallback;
      const snapped = Math.round(safe / DURATION_STEP_MINUTES) * DURATION_STEP_MINUTES;
      return Math.max(DURATION_STEP_MINUTES, Math.min(MAX_DURATION_MINUTES, snapped));
    })
    .sort((a, b) => a - b);
  if (normalized[1]! <= normalized[0]!) normalized[1] = Math.min(MAX_DURATION_MINUTES, normalized[0]! + DURATION_STEP_MINUTES);
  if (normalized[2]! <= normalized[1]!) normalized[2] = Math.min(MAX_DURATION_MINUTES, normalized[1]! + DURATION_STEP_MINUTES);
  return [normalized[0]!, normalized[1]!, normalized[2]!];
}

function formatDayLabel(dayIso: string): string {
  const [y, mo, d] = dayIso.split('-').map((x) => parseInt(x, 10));
  const date = new Date(y, mo - 1, d);
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function hasFlexibleWindow(event: CalendarEvent): boolean {
  const body = (event.notes ?? event.bodyPreview ?? '').trim();
  if (!body) return false;
  return FLEX_WINDOW_REGEX.test(body);
}

function eventsForDay(events: CalendarEvent[], dayIso: string): CalendarEvent[] {
  const [y, mo, d] = dayIso.split('-').map((x) => parseInt(x, 10));
  const dayStartMs = startOfDay(new Date(y, mo - 1, d)).getTime();
  return events.filter((ev) => {
    let startMs: number;
    if (ev.startIso) {
      try {
        startMs = new Date(ev.startIso).getTime();
      } catch {
        return false;
      }
    } else if (ev.time) {
      const parts = ev.time.split('-').map((p) => p.trim());
      if (parts.length < 2) return false;
      const [sh, sm] = (parts[0] ?? '00:00').split(':').map((x) => parseInt(x || '0', 10));
      startMs = dayStartMs + (sh * 60 + sm) * 60_000;
    } else {
      return false;
    }
    return startOfDay(new Date(startMs)).getTime() === dayStartMs;
  });
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function formatDetourKmDisplay(detourKm: number): string {
  if (detourKm === 0) return '0 km';
  if (detourKm < 0) return `Saves ${Math.abs(detourKm).toFixed(1)} km`;
  return `+${detourKm.toFixed(1)} km`;
}

function formatDurationLabel(minutes: number): string {
  if (minutes <= 0) return '0m';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
}

function formatDiagnosticNumber(value: number): string {
  if (!Number.isFinite(value)) return `${value}`;
  if (Math.abs(value - Math.round(value)) < 0.001) return `${Math.round(value)}`;
  return value.toFixed(1);
}

function buildSlotDecisionMessage(entry: QASlotConsidered): string {
  if (entry.status === 'accepted') {
    if (entry.summary && entry.summary.trim().length > 0) {
      return `Proposed. ${entry.summary}`;
    }
    const detourPart =
      entry.detourKm != null && entry.addToRouteMin != null
        ? `Detour +${formatDiagnosticNumber(entry.addToRouteMin)} min (${formatDiagnosticNumber(entry.detourKm)} km).`
        : '';
    const slackPart =
      entry.slackMin != null
        ? `Slack ${formatDiagnosticNumber(entry.slackMin)} min.`
        : '';
    const scorePart = entry.score != null ? `Score ${formatDiagnosticNumber(entry.score)}.` : '';
    const composed = [detourPart, slackPart, scorePart].filter(Boolean).join(' ');
    return composed ? `Proposed. ${composed}` : 'Proposed.';
  }

  const parts: string[] = [];
  parts.push(`Dismissed. ${entry.reason ?? 'Constraint not met.'}`);
  if (entry.impactedMeetingTitle) {
    parts.push(`Impacted meeting: ${entry.impactedMeetingTitle}.`);
  }
  if (entry.eta && entry.requiredBy) {
    parts.push(`ETA ${entry.eta}, required by ${entry.requiredBy}.`);
  }
  if (entry.lateByMin != null) {
    parts.push(`Late by ${formatDiagnosticNumber(entry.lateByMin)} min.`);
  }
  if (entry.requiredShiftMin != null || entry.maxShiftMin != null) {
    const required = entry.requiredShiftMin != null ? formatDiagnosticNumber(entry.requiredShiftMin) : '?';
    const allowed = entry.maxShiftMin != null ? formatDiagnosticNumber(entry.maxShiftMin) : '?';
    parts.push(`Shift needed ${required} min, allowed ${allowed} min.`);
  }
  if (entry.arrivalMarginMin != null && entry.requiredBufferMin != null) {
    parts.push(
      `Arrival margin ${formatDiagnosticNumber(entry.arrivalMarginMin)} min, buffer required ${formatDiagnosticNumber(entry.requiredBufferMin)} min.`
    );
  }
  return parts.join(' ');
}

type RuleChecklistStatus = 'pass' | 'fail' | 'na';
type RuleChecklistItem = {
  label: string;
  status: RuleChecklistStatus;
  detail?: string;
};

type EvaluatedRouteMath = {
  baselineEquation: string;
  candidateEquation: string;
  baselineKm: number;
  candidateKm: number;
  extraDriveKm: number;
};

type DayImpactRow = {
  id: string;
  title: string;
  isNew: boolean;
  timeRange: string;
  shiftLabel?: string;
  travelFromPrevMin: number;
  eta: string;
  requiredBy: string;
  lateByMin: number;
};

type DayImpactSummary = {
  dayIso: string;
  rows: DayImpactRow[];
  lateCount: number;
  returnHomeLateByMin: number;
  rejectionReason?: string;
};

function formatTimeRangeFromMs(startMs: number, endMs: number): string {
  return `${formatClock(startMs)}–${formatClock(endMs)}`;
}

function parseClockToMinutes(clock: string): number | null {
  const match = clock.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  const h = parseInt(match[1] ?? '0', 10);
  const m = parseInt(match[2] ?? '0', 10);
  return h * 60 + m;
}

function parseTimeRangeToMs(dayIso: string, timeRange: string): { startMs: number; endMs: number } | null {
  const compact = timeRange.replace(/\s+/g, '');
  const normalized = compact.match(/^([01]?\d:[0-5]\d)[–-]([01]?\d:[0-5]\d)$/);
  if (!normalized) return null;
  const startMin = parseClockToMinutes(normalized[1] ?? '');
  const endMin = parseClockToMinutes(normalized[2] ?? '');
  if (startMin == null || endMin == null) return null;
  const [y, mo, d] = dayIso.split('-').map((x) => parseInt(x, 10));
  const dayStartMs = startOfDay(new Date(y, mo - 1, d)).getTime();
  return {
    startMs: dayStartMs + startMin * MS_PER_MIN,
    endMs: dayStartMs + endMin * MS_PER_MIN,
  };
}

function parseEventRangeMsForDay(ev: CalendarEvent, dayIso: string): { startMs: number; endMs: number } | null {
  if (ev.startIso && ev.endIso) {
    const startMs = new Date(ev.startIso).getTime();
    const endMs = new Date(ev.endIso).getTime();
    if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
      return { startMs, endMs };
    }
  }
  if (!ev.time) return null;
  const normalized = ev.time.replace(/\s*-\s*/, '–');
  return parseTimeRangeToMs(dayIso, normalized);
}

function makeQASlotKey(dayIso: string, timeRange: string): string {
  const parsed = parseTimeRangeToMs(dayIso, timeRange);
  if (!parsed) return `${dayIso}|${timeRange.trim()}`;
  return `${dayIso}|${formatTimeRangeFromMs(parsed.startMs, parsed.endMs)}`;
}

function haversineKmEstimate(a: Coordinate, b: Coordinate): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return 6371 * c;
}

function estimateRoadFactor(distKm: number): number {
  if (distKm < 5) return 1.45;
  if (distKm <= 20) return 1.3;
  return 1.18;
}

function estimateTravelDistanceKm(a: Coordinate, b: Coordinate): number {
  const straight = haversineKmEstimate(a, b);
  return straight * estimateRoadFactor(straight);
}

function buildDistanceEquation(labels: string[], coords: Coordinate[]): { equation: string; totalKm: number } | null {
  if (labels.length < 2 || labels.length !== coords.length) return null;
  let totalKm = 0;
  const parts: string[] = [labels[0] ?? 'H'];
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    if (!a || !b) continue;
    const legKm = estimateTravelDistanceKm(a, b);
    totalKm += legKm;
    parts.push(`${legKm.toFixed(1)}km`);
    parts.push(labels[i + 1] ?? '?');
  }
  return {
    equation: `${parts.join('_')}=${totalKm.toFixed(1)}km`,
    totalKm,
  };
}

function buildPreviewSlotFromEvaluatedEntry(entry: QASlotConsidered): ScoredSlot | null {
  const parsed = parseTimeRangeToMs(entry.dayIso, entry.timeRange);
  if (!parsed) return null;
  const detourKmAbs = Math.abs(entry.detourKm ?? 0);
  const inferredTier: 1 | 2 | 4 =
    (entry.prev === 'Start' && entry.next === 'End')
      ? 4
      : detourKmAbs <= 5
        ? 1
        : 2;
  return {
    dayIso: entry.dayIso,
    startMs: parsed.startMs,
    endMs: parsed.endMs,
    score: entry.score ?? 99999,
    tier: inferredTier,
    metrics: {
      detourKm: detourKmAbs,
      detourMinutes: entry.addToRouteMin ?? 0,
      slackMinutes: entry.slackMin ?? 0,
      travelToMinutes: 0,
      travelFromMinutes: 0,
    },
    label: entry.label ?? (entry.status === 'accepted' ? 'Candidate' : 'Dismissed candidate'),
  };
}

function compactMeetingLabel(title: string | undefined, index1Based: number): string {
  const base = stripMeetingCodeSuffix(title ?? `M${index1Based}`).trim();
  const compact = base.replace(/\s+/g, '').slice(0, 14);
  return `${compact || `M${index1Based}`}.${index1Based}`;
}

function buildEvaluatedRouteMath(
  slot: ScoredSlot,
  dayEvents: CalendarEvent[],
  newLocation: Coordinate,
  homeBase: Coordinate
): EvaluatedRouteMath | null {
  const routeMeta = buildRouteWithInsertionMeta(dayEvents, newLocation, slot, homeBase, 'NEW');
  const eventById = new Map(
    dayEvents
      .filter(
        (ev): ev is CalendarEvent & { coordinates: { latitude: number; longitude: number } } =>
          ev.coordinates != null &&
          typeof ev.coordinates.latitude === 'number' &&
          typeof ev.coordinates.longitude === 'number'
      )
      .map((ev) => [ev.id, ev])
  );

  const orderedIds = routeMeta.sortedEventIds.filter((id) => eventById.has(id));
  const mapLabelById = new Map<string, string>();
  orderedIds.forEach((id, idx) => {
    mapLabelById.set(id, compactMeetingLabel(eventById.get(id)?.title, idx + 1));
  });

  const baselineLabels = ['H', ...orderedIds.map((id) => mapLabelById.get(id) ?? id), 'H'];
  const baselineCoords: Coordinate[] = [
    homeBase,
    ...orderedIds.map((id) => {
      const c = eventById.get(id)!.coordinates;
      return { lat: c.latitude, lon: c.longitude };
    }),
    homeBase,
  ];
  const baselineEquation = buildDistanceEquation(baselineLabels, baselineCoords);
  if (!baselineEquation) return null;

  const candidateSequence = routeMeta.orderedSequenceIds.filter((id) => id === 'NEW' || eventById.has(id));
  const candidateLabels = [
    'H',
    ...candidateSequence.map((id) => (id === 'NEW' ? 'NEW' : mapLabelById.get(id) ?? id)),
    'H',
  ];
  const candidateCoords: Coordinate[] = routeMeta.coordsWithInsertion.map((coord) => ({
    lat: coord.latitude,
    lon: coord.longitude,
  }));
  const candidateEquation = buildDistanceEquation(candidateLabels, candidateCoords);
  if (!candidateEquation) return null;

  return {
    baselineEquation: baselineEquation.equation,
    candidateEquation: candidateEquation.equation,
    baselineKm: baselineEquation.totalKm,
    candidateKm: candidateEquation.totalKm,
    extraDriveKm: candidateEquation.totalKm - baselineEquation.totalKm,
  };
}

function buildRuleChecklist(
  entry: QASlotConsidered,
  explain: ScoredSlot['explain'] | undefined,
  distanceThresholdKm: number,
  farDetourOverrideMinSavings: number,
  decisionMetric: 'minutes' | 'km',
  startFromHomeBase: boolean,
  showQaDebug: boolean
): RuleChecklistItem[] {
  const detourKm = Math.abs(entry.detourKm ?? explain?.detourKm ?? 0);
  const savingsValue =
    decisionMetric === 'km'
      ? (explain?.farDetourSavingsKm ?? null)
      : (explain?.farDetourSavingsMinutes ?? null);
  const detourDebugDetail = showQaDebug
    ? buildDetourDebugDetail(entry, explain, decisionMetric, distanceThresholdKm, farDetourOverrideMinSavings)
    : null;
  const detourRulePass =
    detourKm <= distanceThresholdKm ||
    (savingsValue != null && savingsValue >= farDetourOverrideMinSavings);
  const workingHoursBaseDetail = [
    'Meetings must stay within your working hours, based on the Return to base daily setting.',
    'ON: Working hours include travel from home to the first meeting and from the last meeting back home.',
    'OFF: Home travel is ignored at the start and end of the day, so the first meeting can start at work start and the last meeting can end at work end.',
    'Examples:',
    'ON: A meeting may be rejected even if it ends by 17:00, if the trip home would push the total day past working hours.',
    'OFF: A meeting ending at 17:00 can still be valid, because the trip home is not counted.',
    `Current mode: ${startFromHomeBase ? 'ON' : 'OFF'}.`,
  ].join('\n');

  if (entry.status === 'accepted') {
    return [
      {
        label: 'Working-hours window',
        status: explain?.withinWorkingHours === false ? 'fail' : 'pass',
        detail: workingHoursBaseDetail,
      },
      { label: 'Not in the past', status: explain?.notPast === false ? 'fail' : 'pass' },
      { label: 'No overlap with existing meetings', status: explain?.noOverlap === false ? 'fail' : 'pass' },
      { label: 'Travel + buffers feasible', status: explain?.travelFeasible === false ? 'fail' : 'pass' },
      { label: 'Gap can fit duration + buffers', status: explain?.fitsGap === false ? 'fail' : 'pass' },
      {
        label:
          decisionMetric === 'km'
            ? `Detour <= ${distanceThresholdKm} km or override >= ${farDetourOverrideMinSavings} km`
            : `Detour <= ${distanceThresholdKm} km or override >= ${farDetourOverrideMinSavings} min`,
        status: detourRulePass ? 'pass' : 'fail',
        detail: detourDebugDetail ?? undefined,
      },
      { label: 'Flexible-chain limits', status: 'pass' },
    ];
  }

  const reason = (entry.reason ?? '').toLowerCase();
  const has = (...terms: string[]) => terms.some((term) => reason.includes(term));
  const workingHoursFail = has('before work start', 'before window', 'outside');
  const pastFail = has('in the past', "can't leave now in time");
  const overlapFail = has('overlap');
  const travelFail = has("can't reach", 'misses pre-buffer', 'travel-feasibility', 'late');
  const gapFail = has('gap too small');
  const detourFail = has('detour');
  const flexFail = has('shift', 'flex');
  const workingHoursFailDetail = workingHoursFail
    ? has('before work start')
      ? 'Failed here: slot starts before your configured work-start time.'
      : has('before window')
        ? 'Failed here: slot is outside the selected timeframe window.'
        : 'Failed here: slot is outside allowed working-hour boundaries.'
    : null;
  const workingHoursDetail = workingHoursFailDetail
    ? `${workingHoursBaseDetail}\nFailed reason: ${workingHoursFailDetail}`
    : workingHoursBaseDetail;

  const detourStatus: RuleChecklistStatus =
    detourFail
      ? 'fail'
      : entry.detourKm != null
        ? detourRulePass
          ? 'pass'
          : 'fail'
        : 'na';

  return [
    { label: 'Working-hours window', status: workingHoursFail ? 'fail' : 'na', detail: workingHoursDetail },
    { label: 'Not in the past', status: pastFail ? 'fail' : 'na' },
    { label: 'No overlap with existing meetings', status: overlapFail ? 'fail' : 'na' },
    { label: 'Travel + buffers feasible', status: travelFail ? 'fail' : 'na' },
    { label: 'Gap can fit duration + buffers', status: gapFail ? 'fail' : 'na' },
    {
      label:
        decisionMetric === 'km'
          ? `Detour <= ${distanceThresholdKm} km or override >= ${farDetourOverrideMinSavings} km`
          : `Detour <= ${distanceThresholdKm} km or override >= ${farDetourOverrideMinSavings} min`,
      status: detourStatus,
      detail: detourDebugDetail ?? undefined,
    },
    { label: 'Flexible-chain limits', status: flexFail ? 'fail' : 'na' },
  ];
}

function formatClockFromMinutes(minutes: number): string {
  const safe = Math.max(0, Math.min(23 * 60 + 59, minutes));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function buildDetourDebugDetail(
  entry: QASlotConsidered,
  explain: ScoredSlot['explain'] | undefined,
  decisionMetric: 'minutes' | 'km',
  distanceThresholdKm: number,
  farDetourOverrideMinSavings: number
): string | null {
  const dbg = explain?.farDetourCheck;
  if (!dbg) return null;
  const savings = decisionMetric === 'km' ? dbg.savingsKm : dbg.savingsMinutes;
  const units = decisionMetric === 'km' ? 'km' : 'min';
  const savingsStr =
    savings == null
      ? 'n/a'
      : Number.isInteger(savings)
        ? `${savings} ${units}`
        : `${(savings as number).toFixed(1)} ${units}`;
  const emptyDayStr =
    decisionMetric === 'km'
      ? dbg.bestEmptyDayRoundTripKm != null
        ? `${dbg.bestEmptyDayRoundTripKm.toFixed(1)} km`
        : 'n/a'
      : dbg.bestEmptyDayRoundTripMinutes != null
        ? `${Math.round(dbg.bestEmptyDayRoundTripMinutes)} min`
        : 'n/a';
  const sameDayExtraStr =
    decisionMetric === 'km'
      ? `${dbg.sameDayMarginalKm.toFixed(1)} km`
      : `${Math.round(dbg.sameDayMarginalMinutes)} min`;
  const outcome =
    dbg.detourKmVal <= distanceThresholdKm
      ? 'Within limit'
      : dbg.passed
        ? 'Override used (savings met)'
        : 'Rejected (override not met)';

  return [
    `Detour rule: same-day must be ≤ ${distanceThresholdKm} km or save ≥ ${farDetourOverrideMinSavings} ${units} vs empty day (metric: ${dbg.decisionOptimizationMetric}).`,
    `Detour this slot: ${dbg.detourKmVal.toFixed(1)} km (same-day extra: ${sameDayExtraStr}).`,
    `Empty-day round trip: ${emptyDayStr}.`,
    `Savings vs empty day: ${savingsStr} (needs ${farDetourOverrideMinSavings} ${units}).`,
    `Result: ${outcome}.`,
  ].join('\n');
}

function buildFlexibleWindowTag(
  slotStartMs: number,
  flexBeforeMinutes: number,
  flexAfterMinutes: number
): string | null {
  if (flexBeforeMinutes <= 0 && flexAfterMinutes <= 0) return null;
  const dayStartMs = startOfDay(new Date(slotStartMs)).getTime();
  const startMinutes = Math.round((slotStartMs - dayStartMs) / MS_PER_MIN);
  const minStart = Math.max(0, startMinutes - flexBeforeMinutes);
  const maxStart = Math.min(23 * 60 + 59, startMinutes + flexAfterMinutes);
  if (maxStart <= minStart) return null;
  return `[Flexible Window: ${formatClockFromMinutes(minStart)} to ${formatClockFromMinutes(maxStart)} | source=plan-visit]`;
}

function composeEventBodyWithFlexibleWindow(
  baseBody: string | undefined,
  flexibleWindowTag: string | null
): string | undefined {
  const cleanedBase = (baseBody ?? '').replace(FLEXIBLE_WINDOW_TAG_REGEX, '').trim();
  if (!flexibleWindowTag) return cleanedBase || undefined;
  if (!cleanedBase) return flexibleWindowTag;
  return `${cleanedBase}\n\n${flexibleWindowTag}`;
}

function composeEventBodyWithDecisionCode(baseBody: string | undefined, decisionCode: string): string {
  const cleanedBase = (baseBody ?? '').replace(DECISION_CODE_TAG_REGEX, '').trim();
  const decisionTag = `[Decision Code: ${decisionCode}]`;
  if (!cleanedBase) return decisionTag;
  return `${cleanedBase}\n\n${decisionTag}`;
}

function getProposalPreviewDebugFlag(): boolean {
  const g = globalThis as unknown as { __debugProposalPreviewFlow?: boolean };
  return Boolean(g.__debugProposalPreviewFlow);
}

function inferCountryCodeFromHomeBase(homeBase?: { lat: number; lon: number } | null) {
  if (!homeBase) return undefined;
  const { lat, lon } = homeBase;
  // Denmark bounding box (approx), used only as a search bias.
  if (lat >= 54.4 && lat <= 57.9 && lon >= 7.8 && lon <= 15.4) {
    return 'dk';
  }
  return undefined;
}

/** Appointments whose start falls within [windowStart, windowEnd]. Events filtered by day start. */
function filterAppointmentsByWindow(
  events: CalendarEvent[],
  windowStart: Date,
  windowEnd: Date
): CalendarEvent[] {
  const startMs = startOfDay(windowStart).getTime();
  const endDayStartMs = startOfDay(windowEnd).getTime();

  return events.filter((ev) => {
    if (!ev.startIso) return false;
    try {
      const evStartMs = new Date(ev.startIso).getTime();
      const evDayStart = startOfDay(new Date(evStartMs)).getTime();
      // Event day must be within window (inclusive)
      return evDayStart >= startMs && evDayStart <= endDayStartMs;
    } catch {
      return false;
    }
  });
}

/** Enrich events that have location but no coordinates. Enables correct detour when inserting between meetings. */
async function enrichAppointmentsWithCoords(
  events: CalendarEvent[],
  geocode: (addr: string) => Promise<{ success: boolean; lat?: number; lon?: number }>
): Promise<CalendarEvent[]> {
  const results = await Promise.all(
    events.map(async (ev) => {
      const loc = (ev.location ?? '').trim();
      const hasCoords = ev.coordinates && typeof ev.coordinates.latitude === 'number' && typeof ev.coordinates.longitude === 'number';
      if (hasCoords || !loc) return ev;
      const r = await geocode(loc);
      if (r.success && r.lat != null && r.lon != null) {
        return { ...ev, coordinates: { latitude: r.lat, longitude: r.lon } };
      }
      return ev;
    })
  );
  return results;
}

export default function AddMeetingScreen() {
  const navigation = useNavigation();
  const { userToken, getValidToken, signOut } = useAuth();
  const { appointments, addAppointment, updateAppointment, setSelectedDate, setPendingLocalEvent } = useRoute();
  const { preferences } = useUserPreferences();
  const { showQaDebug } = useDevUI();
  const subscriptionTier = getEffectiveSubscriptionTier(preferences, Boolean(userToken));
  const { canSyncCalendar, canCreateContacts, canUseBetterGeocoding } = getTierEntitlements(subscriptionTier);
  const canUseContactLookup = canSyncCalendar;
  const useGoogleGeocoding = canUseBetterGeocoding && preferences.useGoogleGeocoding === true;
  const googleApiKey = (preferences.googleMapsApiKey ?? '').trim();
  const useGoogleWithKey = useGoogleGeocoding && googleApiKey.length > 0;
  const preferredCountryCode = useMemo(
    () => inferCountryCodeFromHomeBase(preferences.homeBase),
    [preferences.homeBase]
  );
  const durationOptions = useMemo(
    () => normalizeDurationOptions(preferences.meetingDurationPresets),
    [preferences.meetingDurationPresets]
  );

  const [locationSelection, setLocationSelection] = useState<LocationSelection>({ type: 'none' });
  const [durationMinutes, setDurationMinutes] = useState(durationOptions[1]);
  const [durationPreset, setDurationPreset] = useState<DurationPreset>(durationOptions[1]);
  const [flexibleMeetingEnabled, setFlexibleMeetingEnabled] = useState(false);
  const [flexBeforeMinutes, setFlexBeforeMinutes] = useState(15);
  const [flexAfterMinutes, setFlexAfterMinutes] = useState(15);
  const [searchMeetingConfig, setSearchMeetingConfig] = useState<MeetingConfigSnapshot | null>(null);
  const [timeframe, setTimeframe] = useState<TimeframeSelection>({ mode: 'best' });
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [mapSlot, setMapSlot] = useState<ScoredSlot | null>(null);
  const [confirmSlot, setConfirmSlot] = useState<ScoredSlot | null>(null);
  const [highlightedShiftEventIds, setHighlightedShiftEventIds] = useState<string[]>([]);
  const [devDebug, setDevDebug] = useState<Record<string, unknown>>({});
  const [devPanelCollapsed, setDevPanelCollapsed] = useState(true);
  const [searchAppointments, setSearchAppointments] = useState<CalendarEvent[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [showAllEvaluatedSlots, setShowAllEvaluatedSlots] = useState(false);
  const [isImpactDrawerOpen, setIsImpactDrawerOpen] = useState(false);
  const [anyTimeWeeksLoaded, setAnyTimeWeeksLoaded] = useState(1);
  const [anyTimeLoadingMore, setAnyTimeLoadingMore] = useState(false);
  const [collapsedAnyTimeDays, setCollapsedAnyTimeDays] = useState<Record<string, boolean>>({});
  const [bestOptionsViewportWidth, setBestOptionsViewportWidth] = useState(0);
  const qaLog = useQALog();
  const qaEntriesRef = React.useRef<QASlotConsidered[]>([]);
  const searchRequestSeqRef = React.useRef(0);
  const lastBookingDebugRef = React.useRef<{
    proposalId: string;
    dayIso: string;
    bookedEventId: string;
  } | null>(null);
  const bestOptionsScrollRef = React.useRef<ScrollView | null>(null);
  const bestOptionsScrollXRef = React.useRef(0);
  const proposalActionsRef = React.useRef<MeetingDecisionAction[]>([]);
  const impactDrawerAnim = React.useRef(new Animated.Value(IMPACT_DRAWER_WIDTH)).current;

  const baseSearchWindow = useMemo(() => getSearchWindow(timeframe), [timeframe]);
  const searchWindow = useMemo(() => {
    if (timeframe.mode !== 'anytime') return baseSearchWindow;
    const weekStart = startOfWeek(startOfDay(new Date()), { weekStartsOn: 1 });
    const totalDays = Math.max(1, anyTimeWeeksLoaded * 7);
    return {
      start: weekStart,
      end: endOfDay(addDays(weekStart, totalDays - 1)),
    };
  }, [baseSearchWindow, timeframe.mode, anyTimeWeeksLoaded]);
  const maxFlexPerSideMinutes = useMemo(() => {
    const raw = (MAX_DURATION_MINUTES - durationMinutes) / 2;
    if (raw <= 0) return 0;
    return Math.floor(raw / DURATION_STEP_MINUTES) * DURATION_STEP_MINUTES;
  }, [durationMinutes]);

  const applyDurationPreset = React.useCallback((nextDuration: number) => {
    const snapped = Math.max(
      DURATION_STEP_MINUTES,
      Math.min(MAX_DURATION_MINUTES, Math.round(nextDuration / DURATION_STEP_MINUTES) * DURATION_STEP_MINUTES)
    );
    setDurationMinutes(snapped);
    if (durationOptions.includes(snapped)) {
      setDurationPreset(snapped as DurationPreset);
    } else {
      setDurationPreset('custom');
    }
  }, [durationOptions]);

  const handleTimelineDurationChange = React.useCallback((nextDuration: number) => {
    const snapped = Math.max(
      DURATION_STEP_MINUTES,
      Math.min(MAX_DURATION_MINUTES, Math.round(nextDuration / DURATION_STEP_MINUTES) * DURATION_STEP_MINUTES)
    );
    setDurationMinutes(snapped);
    setDurationPreset('custom');
  }, []);

  const handleFlexBeforeChange = React.useCallback((next: number) => {
    const snapped = Math.max(
      0,
      Math.min(maxFlexPerSideMinutes, Math.round(next / DURATION_STEP_MINUTES) * DURATION_STEP_MINUTES)
    );
    setFlexBeforeMinutes(snapped);
  }, [maxFlexPerSideMinutes]);

  const handleFlexAfterChange = React.useCallback((next: number) => {
    const snapped = Math.max(
      0,
      Math.min(maxFlexPerSideMinutes, Math.round(next / DURATION_STEP_MINUTES) * DURATION_STEP_MINUTES)
    );
    setFlexAfterMinutes(snapped);
  }, [maxFlexPerSideMinutes]);

  useEffect(() => {
    if (durationPreset === 'custom') return;
    if (durationOptions.includes(durationPreset)) return;
    setDurationPreset(durationOptions[1]);
  }, [durationOptions, durationPreset]);

  useEffect(() => {
    const snapped = Math.max(
      DURATION_STEP_MINUTES,
      Math.min(MAX_DURATION_MINUTES, Math.round(durationMinutes / DURATION_STEP_MINUTES) * DURATION_STEP_MINUTES)
    );
    if (durationPreset === 'custom') {
      if (snapped !== durationMinutes) setDurationMinutes(snapped);
      return;
    }
    const targetDuration = durationOptions.includes(durationPreset)
      ? durationPreset
      : durationOptions[1];
    if (durationMinutes !== targetDuration) {
      setDurationMinutes(targetDuration);
    }
  }, [durationMinutes, durationOptions, durationPreset]);

  const handleFlexibleToggle = React.useCallback((enabled: boolean) => {
    setFlexibleMeetingEnabled(enabled);
    if (enabled) {
      const defaultFlex = Math.min(15, maxFlexPerSideMinutes);
      setFlexBeforeMinutes((prev) => (prev > 0 ? Math.min(prev, maxFlexPerSideMinutes) : defaultFlex));
      setFlexAfterMinutes((prev) => (prev > 0 ? Math.min(prev, maxFlexPerSideMinutes) : defaultFlex));
    } else {
      setFlexBeforeMinutes(0);
      setFlexAfterMinutes(0);
    }
  }, [maxFlexPerSideMinutes]);

  useEffect(() => {
    setFlexBeforeMinutes((prev) => Math.min(prev, maxFlexPerSideMinutes));
    setFlexAfterMinutes((prev) => Math.min(prev, maxFlexPerSideMinutes));
  }, [maxFlexPerSideMinutes]);

  const newLocation: Coordinate | null = useMemo(() => {
    if (locationSelection.type === 'contact') return locationSelection.coords;
    if (locationSelection.type === 'address') return locationSelection.coords;
    return null;
  }, [locationSelection]);

  const hasValidLocation = newLocation != null;
  const canFindMoreOptions = hasValidLocation && hasSearched;

  /** Search only against the active search dataset once location-driven search starts. */
  const scheduleForSearch = hasSearched ? (searchAppointments ?? []) : appointments;

  const filteredAppointments = useMemo(
    () =>
      hasSearched
        ? filterAppointmentsByWindow(
          scheduleForSearch,
          searchWindow.start,
          searchWindow.end
        )
        : [],
    [hasSearched, scheduleForSearch, searchWindow]
  );

  const allSlots = useMemo(() => {
    if (!hasSearched || !newLocation) return [];
    qaEntriesRef.current = [];
    return findSmartSlots({
      schedule: scheduleForSearch,
      newLocation,
      durationMinutes,
      preferences,
      searchWindow,
      clampSearchStartToToday: timeframe.mode !== 'week',
      includeExplain: __DEV__,
      onSlotConsidered: (e) => { qaEntriesRef.current.push(e); },
    });
  }, [hasSearched, scheduleForSearch, newLocation, durationMinutes, preferences, searchWindow, timeframe.mode]);

  const rankedSlots = useMemo(
    () => [...allSlots].sort(compareScoredSlots),
    [allSlots]
  );
  const bestOptions = useMemo(
    () => pickBestOptionsWithDayDiversity(rankedSlots, 3),
    [rankedSlots]
  );
  const bestBadgeSlotId = useMemo(
    () => getBestBadgeSlotId(bestOptions),
    [bestOptions]
  );
  const bestOptionIds = useMemo(
    () => new Set(bestBadgeSlotId ? [bestBadgeSlotId] : []),
    [bestBadgeSlotId]
  );
  const anyTimeSlots = useMemo(() => rankedSlots, [rankedSlots]);
  const anyTimeDayGroups = useMemo(
    () => {
      const byDay = new Map<string, ScoredSlot[]>();
      for (const slot of anyTimeSlots) {
        const list = byDay.get(slot.dayIso);
        if (list) list.push(slot);
        else byDay.set(slot.dayIso, [slot]);
      }
      return Array.from(byDay.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([dayIso, slots]) => {
          const sorted = [...slots].sort((a, b) => a.startMs - b.startMs || a.score - b.score);
          return {
            dayIso,
            dayLabel: formatDayLabel(dayIso),
            slots: sorted,
            bestSlot: sorted.reduce<ScoredSlot | null>((best, slot) => {
              if (!best) return slot;
              return compareScoredSlots(slot, best) < 0 ? slot : best;
            }, null),
          };
        });
    },
    [anyTimeSlots]
  );
  const showBestMatchResults = timeframe.mode === 'best';
  const showAllPossibleResults = timeframe.mode === 'best' || timeframe.mode === 'anytime';
  const allPossibleSectionTitle = timeframe.mode === 'best' ? 'All Possible Suggestions' : 'Any Time';
  const showAnyTimeResults = timeframe.mode === 'anytime';
  const showPickWeekResults = timeframe.mode === 'week';
  const shouldBlockResultsWithLoading =
    searchLoading && !(timeframe.mode === 'anytime' && anyTimeSlots.length > 0);

  useEffect(() => {
    const devEnabled = typeof __DEV__ !== 'undefined' && __DEV__;
    if (!devEnabled || !hasSearched || searchLoading) return;
    const g = globalThis as unknown as { __debugBestOptionsRanking?: boolean };
    if (!g.__debugBestOptionsRanking) return;

    const bestBadgeSource = 'bestOptions[0] from ranked candidates (compareScoredSlots + day-diversity pick)';
    const ranked = [...allSlots].sort(compareScoredSlots);

    const rows = ranked.map((slot, idx) => {
      const id = slotId(slot);
      const explain = slot.explain;
      const shifts = explain?.shiftedEvents ?? [];
      const primaryShift = shifts[0];
      const onRoute = (slot.metrics.detourKm ?? 0) <= 5;
      const scoreBreakdown = explain?.scoreBreakdown;
      const detourKm = slot.metrics.detourKm ?? 0;

      return {
        candidateId: id,
        slotStart: formatClock(slot.startMs),
        slotEnd: formatClock(slot.endMs),
        candidateType: shifts.length > 0 ? 'pusher' : (slot.tier === 4 ? 'new-day' : 'standard'),
        pushedMeetingIds: shifts.map((s) => s.id),
        pushedMeetingOldTimes: shifts.map((s) => `${formatClock(s.fromStartMs)}-${formatClock(s.fromEndMs)}`),
        pushedMeetingNewTimes: shifts.map((s) => `${formatClock(s.toStartMs)}-${formatClock(s.toEndMs)}`),
        moveDirections: shifts.map((s) => s.direction),
        primaryPushedMeetingId: primaryShift?.id ?? null,
        primaryPushedMeetingOldTime: primaryShift ? `${formatClock(primaryShift.fromStartMs)}-${formatClock(primaryShift.fromEndMs)}` : null,
        primaryPushedMeetingNewTime: primaryShift ? `${formatClock(primaryShift.toStartMs)}-${formatClock(primaryShift.toEndMs)}` : null,
        primaryMoveDirection: primaryShift?.direction ?? null,
        detourKmRaw: detourKm,
        detourMetersRaw: detourKm * 1000,
        detourDisplay: formatDetourKmDisplay(detourKm),
        onRoute,
        scoreComponents: scoreBreakdown ?? null,
        finalScore: slot.score,
        finalRankIndex: idx,
        bestBadgeApplied: bestBadgeSlotId === id,
        bestBadgeSource,
        indexInUnsortedArray: allSlots.findIndex((s) => slotId(s) === id),
      };
    });

    console.groupCollapsed(`[BestOptionsRanking] ${rows.length} candidates`);
    rows.forEach((row) => console.log(row));
    console.log('Best options order', bestOptions.map((s, index) => ({
      rankInBestOptions: index,
      candidateId: slotId(s),
      finalScore: s.score,
      detourKmRaw: s.metrics.detourKm ?? 0,
      detourDisplay: formatDetourKmDisplay(s.metrics.detourKm ?? 0),
    })));
    console.log('Best badge slot', bestBadgeSlotId);
    console.groupEnd();
  }, [allSlots, bestOptions, bestBadgeSlotId, hasSearched, searchLoading]);

  useEffect(() => {
    if (!getProposalPreviewDebugFlag()) return;
    const pending = lastBookingDebugRef.current;
    if (!pending) return;
    const rendered = sortAppointmentsByTime(eventsForDay(appointments, pending.dayIso));
    if (!rendered.some((ev) => ev.id === pending.bookedEventId)) return;
    console.log('[ProposalPreviewFlow] final rendered sequence after reconciliation', {
      proposalId: pending.proposalId,
      dayIso: pending.dayIso,
      finalRenderedSequenceIds: rendered.map((ev) => ev.id),
    });
    lastBookingDebugRef.current = null;
  }, [appointments]);

  const dayIsos = useMemo(() => {
    const fromSlots = new Set(allSlots.map((s) => s.dayIso));
    filteredAppointments.forEach((a) => {
      if (a.startIso) {
        try {
          fromSlots.add(toLocalDayKey(new Date(a.startIso)));
        } catch {
          // skip
        }
      }
    });
    const windowStartKey = toLocalDayKey(searchWindow.start);
    const windowEndKey = toLocalDayKey(searchWindow.end);
    return [...fromSlots].filter((key) => key >= windowStartKey && key <= windowEndKey).sort();
  }, [allSlots, filteredAppointments, searchWindow]);

  const dayGroups = useMemo(() => {
    return dayIsos.map((dayIso) => {
      const dayEvents = eventsForDay(filteredAppointments, dayIso);
      const entries = buildTimelineEntries(dayIso, filteredAppointments, allSlots);
      return { dayIso, dayLabel: formatDayLabel(dayIso), entries };
    }).filter((g) => g.entries.length > 0);
  }, [dayIsos, filteredAppointments, allSlots]);

  const preBuffer = preferences.preMeetingBuffer ?? 15;
  const postBuffer = preferences.postMeetingBuffer ?? 15;

  const locationLabel = useMemo(() => {
    if (locationSelection.type === 'contact') {
      return locationSelection.contact.displayName;
    }
    if (locationSelection.type === 'address') {
      return locationSelection.address;
    }
    return 'Visit';
  }, [locationSelection]);

  const locationForEvent = useMemo(() => {
    if (locationSelection.type === 'contact') {
      return locationSelection.contact.hasAddress
        ? locationSelection.contact.formattedAddress
        : locationSelection.contact.displayName;
    }
    if (locationSelection.type === 'address') {
      return locationSelection.address;
    }
    return '';
  }, [locationSelection]);

  useEffect(() => {
    proposalActionsRef.current = [];
  }, [locationSelection]);

  const logProposalSelection = React.useCallback(
    (slot: ScoredSlot, source: 'select' | 'map' | 'book' | 'confirm') => {
      const proposalId = slotId(slot);
      const action: MeetingDecisionAction = {
        atIso: new Date().toISOString(),
        type: source,
        proposalId,
      };
      proposalActionsRef.current = [...proposalActionsRef.current.slice(-119), action];
      if (!getProposalPreviewDebugFlag() || !newLocation) return;
      const dayEventsForSlot = eventsForDay(filteredAppointments, slot.dayIso);
      const previewMeta = buildRouteWithInsertionMeta(
        dayEventsForSlot,
        newLocation,
        slot,
        preferences.homeBase ?? DEFAULT_HOME_BASE,
        'NEW'
      );
      const timelineEntries = buildTimelineEntries(slot.dayIso, filteredAppointments, allSlots);
      const ghostRenderIndex = timelineEntries.findIndex(
        (entry) => entry.type === 'ghost' && slotId(entry.slot) === proposalId
      );
      const detourKm = slot.metrics.detourKm ?? 0;
      console.log('[ProposalPreviewFlow] selected proposal', {
        source,
        proposalId,
        slotStart: formatClock(slot.startMs),
        slotEnd: formatClock(slot.endMs),
        logicalInsertionIndex: previewMeta.insertIndexInMiddle,
        prevMeetingId: slot.explain?.prev.id ?? null,
        nextMeetingId: slot.explain?.next.id ?? null,
        mapPreviewSequenceIds: previewMeta.orderedSequenceIds,
        routePreviewInsertionSource: previewMeta.insertionSource,
        detourKmScoreMetric: detourKm,
        detourKmDisplay: formatDetourKmDisplay(detourKm),
        onRoute: detourKm <= 5,
        ghostSlotRenderIndex: ghostRenderIndex,
        ghostSlotPixelTop: null,
      });
    },
    [allSlots, filteredAppointments, newLocation, preferences.homeBase]
  );

  const handleFindMoreOptions = () => {
    if (!canFindMoreOptions) return;
    setShowAlternatives(true);
  };

  const toggleAnyTimeDay = React.useCallback((dayIso: string) => {
    setCollapsedAnyTimeDays((prev) => ({ ...prev, [dayIso]: !prev[dayIso] }));
  }, []);

  const maybeLoadMoreAnyTimeWeeks = React.useCallback(() => {
    if (!hasSearched) return;
    if (timeframe.mode !== 'anytime') return;
    if (searchLoading || anyTimeLoadingMore) return;
    setAnyTimeLoadingMore(true);
    setAnyTimeWeeksLoaded((prev) => prev + 1);
  }, [anyTimeLoadingMore, hasSearched, searchLoading, timeframe.mode]);

  const handleGraphError = (msg: string, needsConsent?: boolean) => {
    if (needsConsent) {
      Alert.alert(
        'Permission needed',
        msg + '\n\nGrant Contacts.Read or Contacts.ReadWrite in your Microsoft account.',
        [{ text: 'OK' }]
      );
    } else {
      Alert.alert('Search error', msg, [{ text: 'OK' }]);
    }
  };

  const handleLocationDebug = (info: Record<string, unknown>) => {
    setDevDebug(info);
  };

  const scrollBestOptionsBy = React.useCallback((direction: -1 | 1) => {
    const step = Math.max(260, Math.floor((bestOptionsViewportWidth || 320) * 0.85));
    const nextX = Math.max(0, bestOptionsScrollXRef.current + direction * step);
    bestOptionsScrollRef.current?.scrollTo({ x: nextX, animated: true });
  }, [bestOptionsViewportWidth]);

  useEffect(() => {
    if (!hasValidLocation) {
      searchRequestSeqRef.current += 1;
      proposalActionsRef.current = [];
      setHasSearched(false);
      setSearchLoading(false);
      setSearchAppointments(null);
      setSearchMeetingConfig(null);
      setShowAlternatives(false);
      setShowAllEvaluatedSlots(false);
      setAnyTimeWeeksLoaded(1);
      setAnyTimeLoadingMore(false);
      setCollapsedAnyTimeDays({});
      setSelectedSlotId(null);
      setMapSlot(null);
      setConfirmSlot(null);
      setHighlightedShiftEventIds([]);
      return;
    }

    setHasSearched(true);
  }, [hasValidLocation]);

  useEffect(() => {
    if (timeframe.mode !== 'anytime') {
      setAnyTimeWeeksLoaded(1);
      setAnyTimeLoadingMore(false);
      setCollapsedAnyTimeDays({});
      return;
    }
    setAnyTimeWeeksLoaded(1);
    setAnyTimeLoadingMore(false);
    setCollapsedAnyTimeDays({});
  }, [timeframe.mode, durationMinutes, flexibleMeetingEnabled, flexBeforeMinutes, flexAfterMinutes, locationLabel]);

  useEffect(() => {
    if (!searchLoading) {
      setAnyTimeLoadingMore(false);
    }
  }, [searchLoading]);

  useEffect(() => {
    if (timeframe.mode === 'anytime' && hasSearched) {
      setShowAlternatives(true);
    }
  }, [timeframe.mode, hasSearched]);

  useEffect(() => {
    if (!hasValidLocation) return;
    setSearchMeetingConfig({
      durationMinutes,
      flexibleMeetingEnabled,
      flexBeforeMinutes: flexibleMeetingEnabled ? flexBeforeMinutes : 0,
      flexAfterMinutes: flexibleMeetingEnabled ? flexAfterMinutes : 0,
    });
    setSelectedSlotId(null);
    setMapSlot(null);
    setConfirmSlot(null);
    setHighlightedShiftEventIds([]);
  }, [hasValidLocation, durationMinutes, flexibleMeetingEnabled, flexBeforeMinutes, flexAfterMinutes, timeframe]);

  useEffect(() => {
    if (!hasValidLocation) return;

    const requestSeq = ++searchRequestSeqRef.current;
    const isAnyTimePaginationLoad =
      timeframe.mode === 'anytime' &&
      anyTimeWeeksLoaded > 1 &&
      Array.isArray(searchAppointments) &&
      searchAppointments.length > 0;
    setSearchLoading(true);
    if (!isAnyTimePaginationLoad) {
      setSearchAppointments(null);
    }

    const run = async () => {
      if (!canSyncCalendar) {
        const { start, end } = searchWindow;
        const localEvents = await getLocalMeetingsInRange(start, end);
        if (requestSeq !== searchRequestSeqRef.current) return;
        setSearchAppointments(sortAppointmentsByTime(localEvents));
        setSearchLoading(false);
        return;
      }

      const token = userToken ?? (getValidToken ? await getValidToken() : null);
      if (!token) {
        if (requestSeq !== searchRequestSeqRef.current) return;
        setSearchLoading(false);
        return;
      }
      try {
        const { start, end } = searchWindow;
        const events = await getCalendarEvents(token, start, end);
        const enriched = await enrichAppointmentsWithCoords(events, async (addr) => {
          const r = await geocodeAddress(addr, { authToken: token });
          return { success: r.success, lat: r.success ? r.lat : undefined, lon: r.success ? r.lon : undefined };
        });
        if (requestSeq !== searchRequestSeqRef.current) return;
        const sorted = sortAppointmentsByTime(enriched);
        setSearchAppointments(sorted);
      } catch (e) {
        if (requestSeq !== searchRequestSeqRef.current) return;
        if (e instanceof GraphUnauthorizedError) {
          await clearGraphSession().catch(() => { });
          if (userToken && !isMagicAuthToken(userToken)) {
            signOut();
          }
        } else {
          Alert.alert('Search error', e instanceof Error ? e.message : 'Failed to load calendar');
        }
      } finally {
        if (requestSeq === searchRequestSeqRef.current) {
          setSearchLoading(false);
        }
      }
    };

    void run();
  }, [
    hasValidLocation,
    canSyncCalendar,
    userToken,
    getValidToken,
    signOut,
    timeframe.mode,
    anyTimeWeeksLoaded,
    searchWindow.start,
    searchWindow.end,
  ]);

  const handleSelectSlot = (slot: ScoredSlot) => {
    logProposalSelection(slot, 'select');
    setSelectedSlotId(slotId(slot));
    setMapSlot(slot);
    setConfirmSlot(null);
    setHighlightedShiftEventIds([]);
  };

  const handleBookSlot = (slot: ScoredSlot) => {
    logProposalSelection(slot, 'book');
    setConfirmSlot(slot);
    setHighlightedShiftEventIds([]);
  };

  const handleMapPress = (slot: ScoredSlot) => {
    logProposalSelection(slot, 'map');
    setMapSlot(slot);
    setHighlightedShiftEventIds([]);
  };

  const handlePusherToggle = (
    slot: ScoredSlot,
    active: boolean,
    affectedEventIds: string[]
  ) => {
    logProposalSelection(slot, 'select');
    setSelectedSlotId(slotId(slot));
    setMapSlot(slot);
    setConfirmSlot(null);
    setHighlightedShiftEventIds(active ? affectedEventIds : []);
  };

  const handleConfirmBooking = async (
    event: CalendarEvent,
    contactInput?: ContactInput,
    flexConfig?: ConfirmFlexConfig
  ) => {
    const guestSave = !userToken;

    let finalEvent = { ...event };
    if (!finalEvent.startIso || !finalEvent.endIso) {
      if (confirmSlot) {
        finalEvent.startIso = new Date(confirmSlot.startMs).toISOString();
        finalEvent.endIso = new Date(confirmSlot.endMs).toISOString();
        const fmt = (ms: number) => {
          const d = new Date(ms);
          return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
        };
        finalEvent.time = `${fmt(confirmSlot.startMs)} - ${fmt(confirmSlot.endMs)}`;
      } else {
        Alert.alert('Error', 'Cannot save: missing meeting time.');
        return;
      }
    }

    /** We propose only feasible, optimal slots. No save-time checks—trust the proposals. */
    const isLocalId = finalEvent.id.startsWith('local-');
    const token = userToken ?? (getValidToken ? await getValidToken() : null);
    const decisionCode = await allocateMeetingDecisionCode();
    finalEvent = {
      ...finalEvent,
      title: appendMeetingCodeSuffix(finalEvent.title || locationLabel, decisionCode),
    };
    const baseEventBody = (finalEvent.bodyPreview ?? finalEvent.notes ?? '').trim() || undefined;
    const effectiveFlexEnabled = Boolean(flexConfig?.enabled);
    const effectiveFlexBeforeMinutes = effectiveFlexEnabled ? Math.max(0, flexConfig?.earlyMinutes ?? 0) : 0;
    const effectiveFlexAfterMinutes = effectiveFlexEnabled ? Math.max(0, flexConfig?.lateMinutes ?? 0) : 0;
    const flexibleWindowTag = confirmSlot && effectiveFlexEnabled
      ? buildFlexibleWindowTag(confirmSlot.startMs, effectiveFlexBeforeMinutes, effectiveFlexAfterMinutes)
      : null;
    const bodyWithDecisionCode = composeEventBodyWithDecisionCode(baseEventBody, decisionCode);
    const eventBody = composeEventBodyWithFlexibleWindow(bodyWithDecisionCode, flexibleWindowTag) ?? bodyWithDecisionCode;
    finalEvent = {
      ...finalEvent,
      notes: eventBody,
      bodyPreview: eventBody,
    };

    if (confirmSlot) {
      logProposalSelection(confirmSlot, 'confirm');
      if (getProposalPreviewDebugFlag()) {
        const shiftedById = new Map((confirmSlot.explain?.shiftedEvents ?? []).map((s) => [s.id, s]));
        const projectedDayEvents = eventsForDay(appointments, confirmSlot.dayIso).map((ev) => {
          const shift = shiftedById.get(ev.id);
          if (!shift) return ev;
          return {
            ...ev,
            startIso: new Date(shift.toStartMs).toISOString(),
            endIso: new Date(shift.toEndMs).toISOString(),
            time: `${formatClock(shift.toStartMs)} - ${formatClock(shift.toEndMs)}`,
          };
        });
        const optimisticSequenceIds = sortAppointmentsByTime([...projectedDayEvents, finalEvent]).map((ev) => ev.id);
        console.log('[ProposalPreviewFlow] booking proposal', {
          proposalId: slotId(confirmSlot),
          slotStart: formatClock(confirmSlot.startMs),
          slotEnd: formatClock(confirmSlot.endMs),
          optimisticInsertedSequenceIds: optimisticSequenceIds,
          persistedSequenceReturnedFromBackend: null,
        });
      }
    }

    const shiftedEvents = confirmSlot?.explain?.shiftedEvents ?? [];
    if (shiftedEvents.length > 0) {
      const appliedShiftPatches: Array<{
        id: string;
        oldStartIso: string;
        oldEndIso: string;
        oldTime: string;
        newStartIso: string;
        newEndIso: string;
        newTime: string;
        serverEvent?: CalendarEvent;
      }> = [];
      const errors: string[] = [];

      for (const shift of shiftedEvents) {
        const eventId = shift.id;
        const existing = appointments.find((a) => a.id === eventId) ?? null;
        const oldStartIso = existing?.startIso ?? new Date(shift.fromStartMs).toISOString();
        const oldEndIso = existing?.endIso ?? new Date(shift.fromEndMs).toISOString();
        const oldTime = existing?.time ?? `${formatClock(shift.fromStartMs)} - ${formatClock(shift.fromEndMs)}`;
        const newStartIso = new Date(shift.toStartMs).toISOString();
        const newEndIso = new Date(shift.toEndMs).toISOString();
        const newTime = `${formatClock(shift.toStartMs)} - ${formatClock(shift.toEndMs)}`;

        if (!eventId.startsWith('local-')) {
          if (!canSyncCalendar || !token) {
            errors.push(`${shift.title}: calendar sync unavailable`);
            continue;
          }
          try {
            const result = await updateCalendarEvent(token, eventId, {
              startIso: newStartIso,
              endIso: newEndIso,
            });
            if (!result.success) {
              const err = 'error' in result ? result.error : 'unknown sync error';
              errors.push(`${shift.title}: ${err}`);
              continue;
            }
            appliedShiftPatches.push({
              id: eventId,
              oldStartIso,
              oldEndIso,
              oldTime,
              newStartIso,
              newEndIso,
              newTime,
              serverEvent: result.event,
            });
          } catch (err) {
            if (err instanceof GraphUnauthorizedError) {
              await clearGraphSession().catch(() => { });
              if (userToken && !isMagicAuthToken(userToken)) {
                signOut();
              }
            }
            errors.push(`${shift.title}: ${err instanceof Error ? err.message : 'sync failed'}`);
          }
          continue;
        }

        appliedShiftPatches.push({
          id: eventId,
          oldStartIso,
          oldEndIso,
          oldTime,
          newStartIso,
          newEndIso,
          newTime,
        });
      }

      if (errors.length > 0) {
        // Best-effort rollback for already synced Graph shifts when chain update fails.
        if (token) {
          for (const patch of [...appliedShiftPatches].reverse()) {
            if (patch.id.startsWith('local-')) continue;
            await updateCalendarEvent(token, patch.id, {
              startIso: patch.oldStartIso,
              endIso: patch.oldEndIso,
            }).catch(() => { });
          }
        }
        Alert.alert(
          'Could not reschedule pushed meetings',
          errors.join('\n'),
          [{ text: 'OK' }]
        );
        return;
      }

      for (const patch of appliedShiftPatches) {
        if (patch.serverEvent) {
          updateAppointment(patch.id, {
            ...patch.serverEvent,
            startIso: patch.newStartIso,
            endIso: patch.newEndIso,
            time: patch.newTime,
          });
        } else {
          updateAppointment(patch.id, {
            startIso: patch.newStartIso,
            endIso: patch.newEndIso,
            time: patch.newTime,
          });
        }
      }
    }

    if (canSyncCalendar && token && isLocalId) {
      const proposedStartIso = finalEvent.startIso!;
      const proposedEndIso = finalEvent.endIso!;
      const proposedTime = finalEvent.time;
      try {
        const result = await createCalendarEvent(token, {
          subject: finalEvent.title,
          startIso: proposedStartIso,
          endIso: proposedEndIso,
          location: finalEvent.location,
          body: eventBody,
        });
        if (result.success && 'event' in result) {
          // Preserve proposed times; Graph may return different format causing display shift
          finalEvent = {
            ...result.event,
            startIso: proposedStartIso,
            endIso: proposedEndIso,
            time: proposedTime,
            notes: eventBody,
            bodyPreview: eventBody,
          };
        } else {
          const needsConsent = 'needsConsent' in result ? Boolean(result.needsConsent) : false;
          const errorMessage = 'error' in result ? result.error : 'Calendar sync failed';
          if (needsConsent) {
            Alert.alert(
              'Permission needed',
              'Grant Calendars.ReadWrite in your Microsoft account to sync to Outlook. Saved locally for now.',
              [{ text: 'OK' }]
            );
          } else {
            Alert.alert(
              'Calendar sync failed',
              errorMessage,
              [{ text: 'OK' }]
            );
          }
        }
      } catch (err) {
        if (err instanceof GraphUnauthorizedError) {
          await clearGraphSession().catch(() => { });
          if (userToken && !isMagicAuthToken(userToken)) {
            signOut();
          }
        }
        Alert.alert(
          'Calendar sync failed',
          err instanceof Error ? err.message : 'Meeting was saved locally.',
          [{ text: 'OK' }]
        );
      }
    }

    if (confirmSlot) {
      try {
        const existingMeetingsByDay: Record<string, Array<{
          id: string;
          title: string;
          time: string;
          location: string;
          startIso?: string;
          endIso?: string;
        }>> = {};
        for (const ev of filteredAppointments) {
          if (!ev.startIso) continue;
          try {
            const dayKey = toLocalDayKey(new Date(ev.startIso));
            if (!existingMeetingsByDay[dayKey]) existingMeetingsByDay[dayKey] = [];
            existingMeetingsByDay[dayKey].push({
              id: ev.id,
              title: ev.title ?? '(No title)',
              time: ev.time ?? '-',
              location: ev.location ?? '-',
              startIso: ev.startIso ?? undefined,
              endIso: ev.endIso ?? undefined,
            });
          } catch {
            // skip invalid dates
          }
        }

        const consideredSlots: MeetingDecisionConsideredSlot[] = qaEntriesRef.current.map((e) => ({
          dayIso: e.dayIso,
          dayLabel: e.dayLabel,
          timeRange: e.timeRange,
          status: e.status,
          reason: e.reason,
          detourKm: e.detourKm,
          addToRouteMin: e.addToRouteMin,
          baselineMin: e.baselineMin,
          newPathMin: e.newPathMin,
          slackMin: e.slackMin,
          score: e.score,
          label: e.label,
          prev: e.prev,
          next: e.next,
          summary: e.summary,
        }));

        const rankedCandidates: MeetingDecisionCandidate[] = rankedSlots.map((candidate, index) => ({
          proposalId: slotId(candidate),
          rank: index + 1,
          dayIso: candidate.dayIso,
          startMs: candidate.startMs,
          endMs: candidate.endMs,
          score: candidate.score,
          tier: candidate.tier,
          label: candidate.label,
          metrics: {
            detourKm: candidate.metrics.detourKm ?? 0,
            detourMinutes: candidate.metrics.detourMinutes ?? 0,
            slackMinutes: candidate.metrics.slackMinutes ?? 0,
            travelToMinutes: candidate.metrics.travelToMinutes ?? 0,
            travelFromMinutes: candidate.metrics.travelFromMinutes ?? 0,
          },
          explain: candidate.explain as Record<string, unknown> | undefined,
        }));

        const actions: MeetingDecisionAction[] =
          proposalActionsRef.current.length > 0
            ? [...proposalActionsRef.current]
            : [{ atIso: new Date().toISOString(), type: 'auto-best', proposalId: slotId(confirmSlot) }];

        const appendedDecisionEntry = await appendMeetingDecisionEntry({
          code: decisionCode,
          bookedMeeting: {
            eventId: finalEvent.id,
            title: finalEvent.title ?? locationLabel,
            titleBase: stripMeetingCodeSuffix(finalEvent.title ?? locationLabel),
            location: finalEvent.location ?? locationForEvent,
            startIso: finalEvent.startIso ?? undefined,
            endIso: finalEvent.endIso ?? undefined,
          },
          searchInput: {
            locationLabel,
            locationForEvent,
            locationCoords: newLocation ?? undefined,
            timeframeMode: timeframe.mode,
            durationMinutes: searchMeetingConfig?.durationMinutes ?? durationMinutes,
            flexibleMeetingEnabled: searchMeetingConfig?.flexibleMeetingEnabled ?? flexibleMeetingEnabled,
            flexBeforeMinutes: searchMeetingConfig?.flexBeforeMinutes ?? flexBeforeMinutes,
            flexAfterMinutes: searchMeetingConfig?.flexAfterMinutes ?? flexAfterMinutes,
            searchWindowStartIso: searchWindow.start.toISOString(),
            searchWindowEndIso: searchWindow.end.toISOString(),
          },
          selected: {
            proposalId: slotId(confirmSlot),
            dayIso: confirmSlot.dayIso,
            startMs: confirmSlot.startMs,
            endMs: confirmSlot.endMs,
            bestBadgeProposalId: bestBadgeSlotId ?? null,
          },
          ranking: {
            candidateCount: rankedSlots.length,
            orderedProposalIds: rankedSlots.map((candidate) => slotId(candidate)),
          },
          candidates: rankedCandidates,
          consideredSlots,
          existingMeetingsByDay,
          actions,
        });
        if (BACKEND_API_ENABLED && token) {
          const auditPersisted = await backendAppendMeetingDecisionAudit(
            appendedDecisionEntry,
            token
          );
          if (!auditPersisted) {
            console.warn('[MeetingDecisionLog] backend audit append skipped/failed');
          }
        }
      } catch (err) {
        console.warn('[MeetingDecisionLog] append failed', err);
      }
    }

    if (__DEV__ && qaLog && confirmSlot) {
      const existingByDay: Record<string, { title: string; time: string; location: string }[]> = {};
      for (const ev of filteredAppointments) {
        if (!ev.startIso) continue;
        try {
          const key = toLocalDayKey(new Date(ev.startIso));
          if (!existingByDay[key]) existingByDay[key] = [];
          existingByDay[key].push({
            title: ev.title ?? '(No title)',
            time: ev.time ?? '-',
            location: ev.location ?? '-',
          });
        } catch {
          /* skip */
        }
      }
      const fmt = (ms: number) => {
        const d = new Date(ms);
        return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
      };
      qaLog.addEntry({
        newMeeting: { title: locationLabel, location: finalEvent.location ?? '-', durationMin: durationMinutes },
        selectedSlot: {
          dayIso: confirmSlot.dayIso,
          timeRange: `${fmt(confirmSlot.startMs)}–${fmt(confirmSlot.endMs)}`,
          dayLabel: formatDayLabel(confirmSlot.dayIso),
        },
        existingByDay,
        slotsConsidered: qaEntriesRef.current.map((e) => ({
          dayIso: e.dayIso,
          dayLabel: e.dayLabel,
          timeRange: e.timeRange,
          status: e.status,
          reason: e.reason,
          detourKm: e.detourKm,
          addToRouteMin: e.addToRouteMin,
          baselineMin: e.baselineMin,
          newPathMin: e.newPathMin,
          slackMin: e.slackMin,
          score: e.score,
          label: e.label,
          prev: e.prev,
          next: e.next,
          summary: e.summary,
        })),
      });
    }

    if (confirmSlot && getProposalPreviewDebugFlag()) {
      lastBookingDebugRef.current = {
        proposalId: slotId(confirmSlot),
        dayIso: confirmSlot.dayIso,
        bookedEventId: finalEvent.id,
      };
    }

    const meetingDay = finalEvent.startIso ? new Date(finalEvent.startIso) : null;
    let optimisticDaySnapshot: CalendarEvent[] | undefined;
    if (confirmSlot && meetingDay) {
      const dayKey = toLocalDayKey(meetingDay);
      const sourceDayEvents = eventsForDay(
        filteredAppointments.length > 0 ? filteredAppointments : appointments,
        dayKey
      );
      const shiftedById = new Map(shiftedEvents.map((shift) => [shift.id, shift]));
      const patchedSourceEvents = sourceDayEvents.map((ev) => {
        const shift = shiftedById.get(ev.id);
        if (!shift) return ev;
        return {
          ...ev,
          startIso: new Date(shift.toStartMs).toISOString(),
          endIso: new Date(shift.toEndMs).toISOString(),
          time: `${formatClock(shift.toStartMs)} - ${formatClock(shift.toEndMs)}`,
        };
      });
      const byId = new Map(patchedSourceEvents.map((ev) => [ev.id, ev]));
      byId.set(finalEvent.id, { ...finalEvent, status: 'pending' as const });
      optimisticDaySnapshot = sortAppointmentsByTime(Array.from(byId.values()));
    }

    addAppointment(finalEvent);
    setSelectedSlotId(null);
    setConfirmSlot(null);
    if (meetingDay) {
      const dayKey = toLocalDayKey(meetingDay);
      setPendingLocalEvent({
        dayKey,
        event: finalEvent,
        daySnapshot: optimisticDaySnapshot,
        // Keep optimistic state through cache/raw/enriched passes.
        remainingMerges: optimisticDaySnapshot ? 3 : 1,
      });
      setSelectedDate(startOfDay(meetingDay));
    }
    navigation.goBack();

    if (guestSave) {
      Alert.alert(
        'Saved locally',
        'This meeting is saved on this device. Sign in any time to back up and sync across devices.'
      );
    }

    if (!canCreateContacts && contactInput && (contactInput.displayName || contactInput.email)) {
      Alert.alert(
        'Contact not saved',
        'Contact sync requires Basic or higher. The meeting was saved locally.'
      );
      return;
    }

    if (canCreateContacts && token && contactInput && (contactInput.displayName || contactInput.email)) {
      const displayName = (contactInput.displayName ?? contactInput.email ?? finalEvent.title ?? '').trim();
      const nameParts = displayName.split(/\s+/).filter(Boolean);
      const givenName = nameParts[0] ?? undefined;
      const surname = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined;
      const businessAddress =
        locationSelection.type === 'contact'
          ? locationSelection.contact.bestAddress ?? undefined
          : (locationForEvent.trim() ? { street: locationForEvent.trim() } : undefined);

      try {
        const contactResult = await createContact(token, {
          displayName,
          givenName,
          surname,
          companyName: contactInput.companyName,
          businessPhones: contactInput.businessPhone ? [contactInput.businessPhone] : undefined,
          emailAddresses: contactInput.email ? [{ address: contactInput.email, name: displayName }] : undefined,
          businessAddress,
        });
        if (contactResult.success) {
          Alert.alert('Contact saved', 'Contact name and address were saved to Outlook.');
        } else {
          const needsConsent = 'needsConsent' in contactResult ? Boolean(contactResult.needsConsent) : false;
          const errorMessage = 'error' in contactResult ? contactResult.error : 'Unknown error';
          Alert.alert(
            'Meeting saved',
            needsConsent
              ? 'Could not save contact (permission needed). Grant Contacts.ReadWrite to sync contacts to Outlook.'
              : `Could not save contact: ${errorMessage}. Meeting was saved.`,
            [{ text: 'OK' }]
          );
        }
      } catch (err) {
        Alert.alert(
          'Meeting saved',
          `Could not save contact: ${err instanceof Error ? err.message : 'Unknown error'}. Meeting was saved.`,
          [{ text: 'OK' }]
        );
      }
    }
  };

  const token = canUseContactLookup ? userToken ?? null : null;
  const isWide = useIsWideScreen();
  const insets = useSafeAreaInsets();

  const bookingDefaultFlexibleEnabled = useMemo(
    () => searchMeetingConfig?.flexibleMeetingEnabled ?? flexibleMeetingEnabled,
    [searchMeetingConfig?.flexibleMeetingEnabled, flexibleMeetingEnabled]
  );
  const bookingDefaultFlexBeforeMinutes = useMemo(
    () => searchMeetingConfig?.flexBeforeMinutes ?? (flexibleMeetingEnabled ? flexBeforeMinutes : 0),
    [searchMeetingConfig?.flexBeforeMinutes, flexibleMeetingEnabled, flexBeforeMinutes]
  );
  const bookingDefaultFlexAfterMinutes = useMemo(
    () => searchMeetingConfig?.flexAfterMinutes ?? (flexibleMeetingEnabled ? flexAfterMinutes : 0),
    [searchMeetingConfig?.flexAfterMinutes, flexibleMeetingEnabled, flexAfterMinutes]
  );
  const bookingDefaultDurationMinutes = useMemo(
    () => searchMeetingConfig?.durationMinutes ?? durationMinutes,
    [searchMeetingConfig?.durationMinutes, durationMinutes]
  );

  const inlineBestSlot = useMemo(
    () => (showBestMatchResults ? (bestOptions[0] ?? null) : (anyTimeSlots[0] ?? null)),
    [showBestMatchResults, bestOptions, anyTimeSlots]
  );
  const evaluatedSlots = useMemo(() => {
    if (!hasSearched) return [] as QASlotConsidered[];
    return [...qaEntriesRef.current];
  }, [hasSearched, allSlots]);
  const evaluatedAcceptedCount = useMemo(
    () => evaluatedSlots.filter((entry) => entry.status === 'accepted').length,
    [evaluatedSlots]
  );
  const evaluatedRejectedCount = useMemo(
    () => evaluatedSlots.filter((entry) => entry.status === 'rejected').length,
    [evaluatedSlots]
  );
  const distanceThresholdKm = Math.round(preferences.distanceThresholdKm ?? 30);
  const farDetourOverrideMinSavings = Math.max(
    0,
    Math.round(preferences.farDetourOverrideMinSavingsMinutes ?? 20)
  );
  const decisionMetric: 'minutes' | 'km' =
    preferences.decisionOptimizationMetric === 'km' ? 'km' : 'minutes';
  const startFromHomeBase = preferences.alwaysStartFromHomeBase !== false;
  const homeBaseForPreview = preferences.homeBase ?? DEFAULT_HOME_BASE;

  const acceptedSlotsByQaKey = useMemo(() => {
    const byKey = new Map<string, ScoredSlot>();
    for (const slot of allSlots) {
      byKey.set(makeQASlotKey(slot.dayIso, formatTimeRangeFromMs(slot.startMs, slot.endMs)), slot);
    }
    return byKey;
  }, [allSlots]);

  const evaluatedSlotRows = useMemo(
    () =>
      evaluatedSlots.map((entry, index) => {
        const qaKey = makeQASlotKey(entry.dayIso, entry.timeRange);
        const matchedSlot = acceptedSlotsByQaKey.get(qaKey) ?? null;
        const previewSlot = matchedSlot ?? buildPreviewSlotFromEvaluatedEntry(entry);
        const dayEventsForEntry =
          previewSlot != null ? eventsForDay(filteredAppointments, previewSlot.dayIso) : [];
        const routeMath =
          previewSlot != null && newLocation != null
            ? buildEvaluatedRouteMath(previewSlot, dayEventsForEntry, newLocation, homeBaseForPreview)
            : null;
        const checklist = buildRuleChecklist(
          entry,
          matchedSlot?.explain,
          distanceThresholdKm,
          farDetourOverrideMinSavings,
          decisionMetric,
          startFromHomeBase,
          showQaDebug
        );
        return {
          id: `${qaKey}|${entry.status}|${index}`,
          entry,
          matchedSlot,
          previewSlot,
          routeMath,
          checklist,
        };
      }),
    [
      acceptedSlotsByQaKey,
      decisionMetric,
      distanceThresholdKm,
      evaluatedSlots,
      farDetourOverrideMinSavings,
      filteredAppointments,
      homeBaseForPreview,
      newLocation,
      startFromHomeBase,
    ]
  );

  const handleEvaluatedSlotPress = React.useCallback(
    (previewSlot: ScoredSlot | null, matchedSlot: ScoredSlot | null) => {
      if (!previewSlot) return;
      handleMapPress(previewSlot);
      setConfirmSlot(null);
      setHighlightedShiftEventIds([]);
      if (matchedSlot) {
        setSelectedSlotId(slotId(matchedSlot));
      } else {
        setSelectedSlotId(null);
      }
    },
    [handleMapPress]
  );

  /** Slot to display on map: selected for booking, or tapped for map, or Best Match. */
  const defaultMapSlot = inlineBestSlot;
  const displayedMapSlot = confirmSlot ?? mapSlot ?? defaultMapSlot;
  const selectedEvaluatedRow = useMemo(() => {
    if (!displayedMapSlot) return null;
    return (
      evaluatedSlotRows.find((row) => {
        const previewSlot = row.previewSlot;
        return (
          previewSlot != null &&
          previewSlot.dayIso === displayedMapSlot.dayIso &&
          previewSlot.startMs === displayedMapSlot.startMs &&
          previewSlot.endMs === displayedMapSlot.endMs
        );
      }) ?? null
    );
  }, [displayedMapSlot, evaluatedSlotRows]);

  const selectedDayImpact = useMemo<DayImpactSummary | null>(() => {
    if (!displayedMapSlot || !newLocation) return null;
    const dayIso = displayedMapSlot.dayIso;
    const dayEvents = eventsForDay(filteredAppointments, dayIso);
    const homeCoord = preferences.homeBase ?? DEFAULT_HOME_BASE;
    const preBufferMin = preferences.preMeetingBuffer ?? 15;
    const postBufferMin = preferences.postMeetingBuffer ?? 15;
    const startMinutes = parseClockToMinutes(preferences.workingHours?.start ?? '08:00') ?? 8 * 60;
    const endMinutes = parseClockToMinutes(preferences.workingHours?.end ?? '17:00') ?? 17 * 60;
    const [y, mo, d] = dayIso.split('-').map((x) => parseInt(x, 10));
    const dayStartMs = startOfDay(new Date(y, mo - 1, d)).getTime();
    const workStartMs = dayStartMs + startMinutes * MS_PER_MIN;
    const workEndMs = dayStartMs + endMinutes * MS_PER_MIN;

    const shiftById = new Map((displayedMapSlot.explain?.shiftedEvents ?? []).map((shift) => [shift.id, shift]));

    const timelineItems: Array<{
      id: string;
      title: string;
      startMs: number;
      endMs: number;
      coord: Coordinate;
      isNew: boolean;
      shiftLabel?: string;
    }> = [];

    dayEvents.forEach((ev) => {
      const range = parseEventRangeMsForDay(ev, dayIso);
      if (!range) return;
      const shift = shiftById.get(ev.id);
      const coord =
        ev.coordinates && typeof ev.coordinates.latitude === 'number' && typeof ev.coordinates.longitude === 'number'
          ? { lat: ev.coordinates.latitude, lon: ev.coordinates.longitude }
          : homeCoord;
      const shiftLabel = shift ? `${shift.shiftMinutes}m ${shift.direction}` : undefined;
      timelineItems.push({
        id: ev.id,
        title: ev.title ?? '(No title)',
        startMs: shift?.toStartMs ?? range.startMs,
        endMs: shift?.toEndMs ?? range.endMs,
        coord,
        isNew: false,
        shiftLabel,
      });
    });

    timelineItems.push({
      id: '__new__',
      title: `New meeting (${locationLabel})`,
      startMs: displayedMapSlot.startMs,
      endMs: displayedMapSlot.endMs,
      coord: newLocation,
      isNew: true,
    });

    timelineItems.sort((a, b) => a.startMs - b.startMs);

    const baselineTimelineItems = timelineItems
      .filter((item) => !item.isNew)
      .map((item) => ({ ...item }))
      .sort((a, b) => a.startMs - b.startMs);

    let baselinePrevCoord: Coordinate = homeCoord;
    let baselinePrevEndMs = workStartMs;
    const baselineLateById = new Map<string, number>();
    baselineTimelineItems.forEach((item, idx) => {
      const departMs = Math.max(workStartMs, baselinePrevEndMs + (idx === 0 ? 0 : postBufferMin * MS_PER_MIN));
      const travelFromPrevMin = getTravelMinutes(baselinePrevCoord, item.coord, departMs);
      const etaMs = departMs + travelFromPrevMin * MS_PER_MIN;
      const requiredByMs = item.startMs - preBufferMin * MS_PER_MIN;
      const lateByMin = Math.max(0, Math.ceil((etaMs - requiredByMs) / MS_PER_MIN));
      baselineLateById.set(item.id, lateByMin);
      baselinePrevCoord = item.coord;
      baselinePrevEndMs = item.endMs;
    });

    let prevCoord: Coordinate = homeCoord;
    let prevEndMs = workStartMs;
    const rows: DayImpactRow[] = timelineItems.map((item, idx) => {
      const departMs = Math.max(workStartMs, prevEndMs + (idx === 0 ? 0 : postBufferMin * MS_PER_MIN));
      const travelFromPrevMin = getTravelMinutes(prevCoord, item.coord, departMs);
      const etaMs = departMs + travelFromPrevMin * MS_PER_MIN;
      const requiredByMs = item.startMs - preBufferMin * MS_PER_MIN;
      const lateByMin = Math.max(0, Math.ceil((etaMs - requiredByMs) / MS_PER_MIN));
      prevCoord = item.coord;
      prevEndMs = item.endMs;
      return {
        id: item.id,
        title: item.title,
        isNew: item.isNew,
        timeRange: formatTimeRangeFromMs(item.startMs, item.endMs),
        shiftLabel: item.shiftLabel,
        travelFromPrevMin,
        eta: formatClock(etaMs),
        requiredBy: formatClock(requiredByMs),
        lateByMin,
      };
    });

    let returnHomeLateByMin = 0;
    if (preferences.alwaysStartFromHomeBase !== false && rows.length > 0) {
      const departHomeMs = prevEndMs + postBufferMin * MS_PER_MIN;
      const travelHomeMin = getTravelMinutes(prevCoord, homeCoord, departHomeMs);
      const arriveHomeMs = departHomeMs + travelHomeMin * MS_PER_MIN;
      returnHomeLateByMin = Math.max(0, Math.ceil((arriveHomeMs - workEndMs) / MS_PER_MIN));
    }

    const rejectionReason =
      selectedEvaluatedRow?.entry.status === 'rejected'
        ? buildSlotDecisionMessage(selectedEvaluatedRow.entry)
        : undefined;

    return {
      dayIso,
      rows,
      lateCount: rows.filter((row) => {
        if (row.isNew) return row.lateByMin > 0;
        return row.lateByMin > (baselineLateById.get(row.id) ?? 0);
      }).length,
      returnHomeLateByMin,
      rejectionReason,
    };
  }, [displayedMapSlot, filteredAppointments, locationLabel, newLocation, preferences, selectedEvaluatedRow]);

  useEffect(() => {
    if (!isWide || !hasValidLocation) {
      setIsImpactDrawerOpen(false);
    }
  }, [hasValidLocation, isWide]);

  useEffect(() => {
    Animated.timing(impactDrawerAnim, {
      toValue: isImpactDrawerOpen ? 0 : IMPACT_DRAWER_WIDTH,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [impactDrawerAnim, isImpactDrawerOpen]);

  const impactHeaderPanResponder = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_evt, gestureState) =>
          Math.abs(gestureState.dx) > 8 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
        onPanResponderRelease: (_evt, gestureState) => {
          if (gestureState.dx > 40) {
            setIsImpactDrawerOpen(false);
          }
        },
      }),
    []
  );

  return (
    <View style={[styles.container, isWide && styles.splitContainer]}>
      <View style={[
        styles.formPane,
        isWide && (hasSearched || hasValidLocation ? styles.formPaneWide : styles.formPaneCentered),
        isWide && { paddingLeft: insets.left }
      ]}>
        <ScrollView
          style={styles.formScroll}
          contentContainerStyle={[
            styles.formScrollContent,
            isWide && !hasSearched && !hasValidLocation && styles.formScrollContentCentered
          ]}
          showsVerticalScrollIndicator={true}
          keyboardShouldPersistTaps="handled"
          onScroll={(e) => {
            if (timeframe.mode !== 'anytime' || !hasSearched) return;
            const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
            const distanceToBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
            if (distanceToBottom < 220) {
              maybeLoadMoreAnyTimeWeeks();
            }
          }}
          scrollEventThrottle={16}
        >
          {!hasSearched && (
            <View style={{ alignItems: 'center', marginTop: 16, marginBottom: 24 }}>
              <View style={[styles.sectionIconBox, { backgroundColor: '#DBEAFE' }]}>
                <Text style={{ fontSize: 18 }}>📅</Text>
              </View>
              <Text style={styles.headerTitle}>Plan a Meeting</Text>
            </View>
          )}

          <View style={!hasSearched ? styles.sectionCard : {}}>
            <LocationSearch
              token={token}
              searchContacts={async (t, q) => {
                if (!canUseContactLookup) {
                  return { success: true, contacts: [] };
                }
                const r = await searchContactsGraph(t, q);
                return {
                  success: r.success,
                  contacts: r.success ? r.contacts : undefined,
                  error: 'error' in r ? r.error : undefined,
                  needsConsent: 'needsConsent' in r ? r.needsConsent : undefined,
                };
              }}
              getAddressSuggestions={async (q) => {
                if (useGoogleWithKey) {
                  const r = await getAddressSuggestionsGoogle(q, googleApiKey);
                  return {
                    success: r.success,
                    suggestions: r.success ? r.suggestions : undefined,
                    error: 'error' in r ? r.error : undefined,
                  };
                }
                const authToken = userToken ?? (getValidToken ? await getValidToken() : null);
                const r = await getAddressSuggestions(q, {
                  authToken,
                  ...(preferredCountryCode ? { countryCode: preferredCountryCode } : {}),
                });
                return {
                  success: r.success,
                  suggestions: r.success ? r.suggestions : undefined,
                  error: 'error' in r ? r.error : undefined,
                };
              }}
              geocodeAddress={async (addr) => {
                if (useGoogleWithKey) {
                  const r = await geocodeAddressGoogle(addr, googleApiKey);
                  return {
                    success: r.success,
                    lat: r.success ? r.lat : undefined,
                    lon: r.success ? r.lon : undefined,
                    fromCache: r.success ? r.fromCache : undefined,
                    error: 'error' in r ? r.error : undefined,
                  };
                }
                const authToken = userToken ?? (getValidToken ? await getValidToken() : null);
                const r = await geocodeAddress(addr, {
                  authToken,
                });
                return {
                  success: r.success,
                  lat: r.success ? r.lat : undefined,
                  lon: r.success ? r.lon : undefined,
                  fromCache: r.success ? r.fromCache : undefined,
                  error: 'error' in r ? r.error : undefined,
                };
              }}
              getCoordsForPlaceId={
                useGoogleWithKey
                  ? async (placeId) => {
                    const r = await getCoordsForPlaceId(placeId, googleApiKey);
                    return r.success === true ? { lat: r.lat, lon: r.lon } : { error: r.error };
                  }
                  : undefined
              }
              geocodeContactAddress={async (addr, parts) => {
                if (useGoogleWithKey) {
                  const r = await geocodeAddressGoogle(addr, googleApiKey);
                  return {
                    success: r.success,
                    lat: r.success ? r.lat : undefined,
                    lon: r.success ? r.lon : undefined,
                    fromCache: r.success ? r.fromCache : undefined,
                    error: 'error' in r ? r.error : undefined,
                  };
                }
                const authToken = userToken ?? (getValidToken ? await getValidToken() : null);
                const r = await geocodeContactAddress(addr, parts, { authToken });
                return {
                  success: r.success,
                  lat: r.success ? r.lat : undefined,
                  lon: r.success ? r.lon : undefined,
                  fromCache: r.success ? r.fromCache : undefined,
                  error: 'error' in r ? r.error : undefined,
                };
              }}
              selection={locationSelection}
              onSelectionChange={setLocationSelection}
              onGraphError={handleGraphError}
              placeholder="Search Client or Address (e.g. Nikola, Køge)"
              onDebug={__DEV__ ? handleLocationDebug : undefined}
              variant="profile_home_base"
            />

            {hasValidLocation ? (
              <>
                <View style={styles.durationRow}>
                  <Text style={styles.formLabelTop}>DURATION</Text>
                  <View style={styles.durationPills}>
                    {durationOptions.map((d) => (
                      <TouchableOpacity
                        key={d}
                        style={[
                          styles.durationPill,
                          durationPreset === d && styles.durationPillActive,
                        ]}
                        onPress={() => applyDurationPreset(d)}
                      >
                        <Text
                          style={[
                            styles.durationPillText,
                            durationPreset === d && styles.durationPillTextActive,
                          ]}
                        >
                          {d} min
                        </Text>
                      </TouchableOpacity>
                    ))}
                    <TouchableOpacity
                      style={[
                        styles.durationPill,
                        durationPreset === 'custom' && styles.durationPillActive,
                      ]}
                      onPress={() => setDurationPreset('custom')}
                    >
                      <Text
                        style={[
                          styles.durationPillText,
                          durationPreset === 'custom' && styles.durationPillTextActive,
                        ]}
                      >
                        Custom
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.durationSummary}>
                    Selected: {formatDurationLabel(durationMinutes)}
                  </Text>
                  {(durationPreset === 'custom' || flexibleMeetingEnabled) && (
                    <View style={styles.rangeBarWrap}>
                      <MeetingDurationFlexTimeline
                        durationMinutes={durationMinutes}
                        flexBeforeMinutes={flexBeforeMinutes}
                        flexAfterMinutes={flexAfterMinutes}
                        showFlexHandles={flexibleMeetingEnabled}
                        onDurationChange={handleTimelineDurationChange}
                        onFlexBeforeChange={handleFlexBeforeChange}
                        onFlexAfterChange={handleFlexAfterChange}
                        maxMinutes={MAX_DURATION_MINUTES}
                        stepMinutes={DURATION_STEP_MINUTES}
                        maxFlexPerSideMinutes={maxFlexPerSideMinutes}
                      />
                    </View>
                  )}
                  <View style={styles.flexToggleRow}>
                    <View style={styles.flexToggleTextWrap}>
                      <Text style={styles.flexToggleTitle}>Flexible meeting</Text>
                      <Text style={styles.flexToggleHint}>
                        Add earlier/later flexibility around the selected meeting duration.
                      </Text>
                    </View>
                    <Switch
                      value={flexibleMeetingEnabled}
                      onValueChange={handleFlexibleToggle}
                      trackColor={{ false: '#CBD5E1', true: '#F59E0B' }}
                      thumbColor={flexibleMeetingEnabled ? '#FFFFFF' : '#F8FAFC'}
                    />
                  </View>
                  {flexibleMeetingEnabled && (
                    <View style={styles.flexSummaryRow}>
                      <View style={styles.flexSummaryBadge}>
                        <Text style={styles.flexSummaryBadgeLabel}>Before</Text>
                        <Text style={styles.flexSummaryBadgeValue}>
                          {formatDurationLabel(flexBeforeMinutes)}
                        </Text>
                      </View>
                      <View style={styles.flexSummaryBadge}>
                        <Text style={styles.flexSummaryBadgeLabel}>After</Text>
                        <Text style={styles.flexSummaryBadgeValue}>
                          {formatDurationLabel(flexAfterMinutes)}
                        </Text>
                      </View>
                    </View>
                  )}
                </View>

                <View style={{ marginBottom: 16 }}>
                  <Text style={[styles.formLabelTop, { paddingHorizontal: 16 }]}>TIMEFRAME</Text>
                  <TimeframeSelector selected={timeframe} onSelect={setTimeframe} />
                </View>

                {timeframe.mode !== 'anytime' && (
                  <View style={styles.inlineBestSection}>
                    <Text style={styles.sectionTitle}>Best Match</Text>
                    {(!hasSearched || searchLoading) && (
                      <View style={styles.inlineBestStatusRow}>
                        <ActivityIndicator size="small" color={MS_BLUE} />
                        <Text style={styles.inlineBestStatusText}>Updating best match...</Text>
                      </View>
                    )}
                    {hasSearched && !searchLoading && !inlineBestSlot && (
                      <Text style={styles.emptyHint}>
                        No valid time found. Tap "Find more options" to browse alternatives.
                      </Text>
                    )}
                    {hasSearched && inlineBestSlot && (
                      <View style={styles.anyTimeCard}>
                        <GhostSlotCard
                          slot={inlineBestSlot}
                          preBuffer={preBuffer}
                          postBuffer={postBuffer}
                          decisionMetric={decisionMetric}
                          showQaDebug={showQaDebug}
                          startFromHomeBase={startFromHomeBase}
                          isSelected={true}
                          isBestOption={true}
                          showDate={true}
                          onSelect={() => handleSelectSlot(inlineBestSlot)}
                          onMapPress={() => handleMapPress(inlineBestSlot)}
                          onBookPress={searchLoading ? undefined : () => handleBookSlot(inlineBestSlot)}
                          onPusherToggle={handlePusherToggle}
                        />
                      </View>
                    )}
                  </View>
                )}

                {showQaDebug && hasSearched && !searchLoading && (
                  <View style={styles.allSlotsSection}>
                    <View style={styles.allSlotsHeaderRow}>
                      <Text style={styles.allSlotsTitle}>All Evaluated Slots</Text>
                      <TouchableOpacity
                        style={styles.allSlotsToggleBtn}
                        onPress={() => setShowAllEvaluatedSlots((prev) => !prev)}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.allSlotsToggleText}>
                          {showAllEvaluatedSlots ? 'Hide all' : 'Show all'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.allSlotsSummary}>
                      Total {evaluatedSlots.length} | Proposed {evaluatedAcceptedCount} | Dismissed {evaluatedRejectedCount}
                    </Text>

                    {showAllEvaluatedSlots && (
                      <View style={styles.allSlotsList}>
                        {evaluatedSlotRows.length === 0 ? (
                          <Text style={styles.emptyHint}>No evaluated slots yet.</Text>
                        ) : (
                          evaluatedSlotRows.map((row) => {
                            const { entry, previewSlot, matchedSlot, routeMath, checklist, id } = row;
                            const isMapActive =
                              previewSlot != null &&
                              displayedMapSlot != null &&
                              displayedMapSlot.dayIso === previewSlot.dayIso &&
                              displayedMapSlot.startMs === previewSlot.startMs &&
                              displayedMapSlot.endMs === previewSlot.endMs;
                            const detourDebugDetail = showQaDebug
                              ? buildDetourDebugDetail(
                                entry,
                                matchedSlot?.explain,
                                decisionMetric,
                                distanceThresholdKm,
                                farDetourOverrideMinSavings
                              )
                              : null;
                            const extraDriveLabel =
                              routeMath == null
                                ? null
                                : routeMath.extraDriveKm >= 0
                                  ? `Extra drive: ${formatDiagnosticNumber(routeMath.extraDriveKm)} km`
                                  : `Drive saved: ${formatDiagnosticNumber(Math.abs(routeMath.extraDriveKm))} km`;
                            return (
                            <TouchableOpacity
                              key={id}
                              style={[
                                styles.allSlotCard,
                                isMapActive && styles.allSlotCardActive,
                                previewSlot == null && styles.allSlotCardDisabled,
                              ]}
                              activeOpacity={0.85}
                              disabled={previewSlot == null}
                              onPress={() => handleEvaluatedSlotPress(previewSlot, matchedSlot)}
                            >
                              <View style={styles.allSlotCardHeader}>
                                <Text style={styles.allSlotCardTitle}>
                                  {entry.dayLabel} {entry.timeRange}
                                </Text>
                                <TouchableOpacity
                                  style={styles.copyBtn}
                                  accessibilityRole="button"
                                  accessibilityLabel="Copy slot summary"
                                  onPress={() => {
                                    const decisionLine = buildSlotDecisionMessage(entry);
                                    const contextLine =
                                      entry.prev || entry.next
                                        ? `Context: ${entry.prev ?? 'Start'} -> ${entry.next ?? 'End'}`
                                        : null;
                                    const detourLine =
                                      entry.detourKm != null || entry.addToRouteMin != null
                                        ? `Detour: ${entry.detourKm != null ? formatDetourKmDisplay(entry.detourKm) : '—'}`
                                          + (entry.addToRouteMin != null
                                            ? ` / ${entry.addToRouteMin >= 0 ? `+${entry.addToRouteMin}` : entry.addToRouteMin} min`
                                            : '')
                                        : null;
                                    const routeLines = routeMath != null
                                      ? [
                                        routeMath.baselineEquation,
                                        routeMath.candidateEquation,
                                        extraDriveLabel ?? null,
                                      ].filter(Boolean)
                                      : [];
                                    const checklistLines = checklist.map((rule) => {
                                      const status =
                                        rule.status === 'pass'
                                          ? '[OK]'
                                          : rule.status === 'fail'
                                            ? '[X]'
                                            : '[ ]';
                                      return rule.detail
                                        ? `${status} ${rule.label}: ${rule.detail}`
                                        : `${status} ${rule.label}`;
                                    });
                                    const summary = [
                                      `${entry.dayLabel} ${entry.timeRange}`,
                                      entry.status === 'accepted' ? 'Proposed' : 'Dismissed',
                                      entry.reason ? `Reason: ${entry.reason}` : null,
                                      entry.summary ? `Summary: ${entry.summary}` : decisionLine,
                                      detourLine,
                                      contextLine,
                                      ...routeLines,
                                      ...checklistLines,
                                    ]
                                      .filter(Boolean)
                                      .join('\n');
                                    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                                      navigator.clipboard.writeText(summary).catch(() => {});
                                    }
                                  }}
                                  activeOpacity={0.7}
                                >
                                  <Text style={styles.copyBtnText}>⧉</Text>
                                </TouchableOpacity>
                                <View
                                  style={[
                                    styles.allSlotBadge,
                                    entry.status === 'accepted'
                                      ? styles.allSlotBadgeAccepted
                                      : styles.allSlotBadgeRejected,
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.allSlotBadgeText,
                                      entry.status === 'accepted'
                                        ? styles.allSlotBadgeTextAccepted
                                        : styles.allSlotBadgeTextRejected,
                                    ]}
                                  >
                                    {entry.status === 'accepted' ? 'Proposed' : 'Dismissed'}
                                  </Text>
                                </View>
                              </View>
                              <Text style={styles.allSlotClickHint}>
                                {previewSlot != null
                                  ? 'Tap to preview this slot on the map'
                                  : 'Map preview unavailable for this row'}
                              </Text>
                              <Text style={styles.allSlotCardMessage}>
                                {buildSlotDecisionMessage(entry)}
                              </Text>
                              {detourDebugDetail && (
                                <Text style={styles.allSlotDetourDebug}>
                                  {detourDebugDetail}
                                </Text>
                              )}
                              {(entry.prev || entry.next) && (
                                <Text style={styles.allSlotCardMeta}>
                                  Context: {entry.prev ?? 'Start'} {'->'} {entry.next ?? 'End'}
                                </Text>
                              )}
                              {(entry.detourKm != null || entry.addToRouteMin != null) && (
                                <Text style={styles.allSlotRouteSummary}>
                                  Detour: {entry.detourKm != null ? formatDetourKmDisplay(entry.detourKm) : ''}
                                  {entry.addToRouteMin != null
                                    ? ` / ${entry.addToRouteMin >= 0 ? `+${entry.addToRouteMin}` : entry.addToRouteMin} min`
                                    : ''}
                                </Text>
                              )}
                              {routeMath != null && (
                                <View style={styles.allSlotRouteBlock}>
                                  <Text style={styles.allSlotRouteEquation}>{routeMath.baselineEquation}</Text>
                                  <Text style={styles.allSlotRouteEquation}>{routeMath.candidateEquation}</Text>
                                  {extraDriveLabel != null && (
                                    <Text style={styles.allSlotRouteSummary}>{extraDriveLabel}</Text>
                                  )}
                                </View>
                              )}
                              <View style={styles.allSlotChecklist}>
                                {checklist.map((rule, ruleIndex) => {
                                  const ruleStatusStyle =
                                    rule.status === 'pass'
                                      ? styles.allSlotRulePass
                                      : rule.status === 'fail'
                                        ? styles.allSlotRuleFail
                                        : styles.allSlotRuleNA;
                                  return (
                                    <View
                                      key={`${id}-rule-${ruleIndex}`}
                                      style={styles.allSlotRuleRow}
                                    >
                                      <Text style={[styles.allSlotRuleItem, ruleStatusStyle]}>
                                        {rule.status === 'pass'
                                          ? '[OK]'
                                          : rule.status === 'fail'
                                            ? '[X]'
                                            : '[ ]'}{' '}
                                        {rule.label}
                                      </Text>
                                      {rule.detail ? (
                                        <Text style={[styles.allSlotRuleDetail, ruleStatusStyle]}>{rule.detail}</Text>
                                      ) : null}
                                    </View>
                                  );
                                })}
                              </View>
                            </TouchableOpacity>
                          );
                          })
                        )}
                      </View>
                    )}
                  </View>
                )}
              </>
            ) : (
              <View style={styles.setupState}>
                <Text style={styles.setupHint}>
                  Select a location (contact or address) to see your best match instantly.
                </Text>
              </View>
            )}
          </View>

          {hasValidLocation && timeframe.mode !== 'anytime' && (
            <View style={!hasSearched ? { width: '100%', maxWidth: 600, alignSelf: 'center' } : {}}>
            <TouchableOpacity
              style={[
                styles.ctaButton,
                (!hasSearched && isWide) && { marginHorizontal: 0 },
                (!canFindMoreOptions || searchLoading) && styles.ctaButtonDisabled,
              ]}
              onPress={handleFindMoreOptions}
              activeOpacity={0.85}
              disabled={!canFindMoreOptions || searchLoading}
            >
                <Text
                  style={[
                    styles.ctaButtonText,
                    (!canFindMoreOptions || searchLoading) && styles.ctaButtonTextDisabled,
                  ]}
                >
                  {!hasSearched || searchLoading ? 'Finding best match...' : 'Find more options'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {showQaDebug && (Object.keys(devDebug).length > 0 || hasSearched) && (
            <TouchableOpacity
              style={styles.devPanel}
              onPress={() => setDevPanelCollapsed((c) => !c)}
              activeOpacity={0.8}
            >
              <Text style={styles.devPanelTitle}>
                DEV: Plan Visit {devPanelCollapsed ? '(tap to expand)' : '(tap to collapse)'}
              </Text>
              {!devPanelCollapsed && (
                <>
                  <Text style={styles.devPanelLine}>
                    Location – Contacts: {String(devDebug.contactsCount ?? '-')} | Selected: {String(devDebug.selectedContact ?? devDebug.selectedAddress ?? '-')}
                  </Text>
                  <Text style={styles.devPanelLine}>
                    Address: {String(devDebug.selectedAddress ?? '-')} | Geocode: {String(devDebug.geocodeResult ?? '-')} | Cache: {devDebug.geocodeCacheHit != null ? (devDebug.geocodeCacheHit ? 'hit' : 'miss') : '-'}
                  </Text>
                  {hasSearched && (
                    <Text style={styles.devPanelLine}>
                      Search – Mode: {timeframe.mode}
                    </Text>
                  )}
                  {hasSearched && (
                    <Text style={styles.devPanelLine}>
                      Local today: {toLocalDayKey(new Date())} | Window: {toLocalDayKey(searchWindow.start)}–{toLocalDayKey(searchWindow.end)}
                    </Text>
                  )}
                  {hasSearched && (
                    <Text style={styles.devPanelLine}>
                      Appointments: {filteredAppointments.length} (missing coords: {filteredAppointments.filter((a) => !a.coordinates || typeof a.coordinates?.latitude !== 'number').length}, flexible: {filteredAppointments.filter(hasFlexibleWindow).length}) | Slots: {allSlots.length}
                    </Text>
                  )}
                  {hasSearched && dayIsos.length > 0 && (() => {
                    const dayKey = dayIsos[0]!;
                    const evs = eventsForDay(filteredAppointments, dayKey);
                    if (evs.length === 0) return null;
                    const parts = evs.map((e) => {
                      const start = e.startIso ? new Date(e.startIso) : null;
                      const end = e.endIso ? new Date(e.endIso) : null;
                      const range = start && end ? `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')}-${end.getHours().toString().padStart(2, '0')}:${end.getMinutes().toString().padStart(2, '0')}` : '-';
                      const hasC = !!(e.coordinates && typeof e.coordinates.latitude === 'number');
                      return `${e.title ?? '?'}(${range},coord=${hasC})`;
                    });
                    return <Text style={styles.devPanelLine}>Day {dayKey}: {parts.join('; ')}</Text>;
                  })()}
                  {devDebug.graphError != null && devDebug.graphError !== '' ? (
                    <Text style={[styles.devPanelLine, styles.devPanelError]}>
                      Graph: {String(devDebug.graphError)}
                    </Text>
                  ) : null}
                </>
              )}
            </TouchableOpacity>
          )}

          {hasSearched && (showAlternatives || timeframe.mode === 'anytime') && (
            shouldBlockResultsWithLoading ? (
              <View style={styles.loadingState}>
                <ActivityIndicator size="large" color={MS_BLUE} />
                <Text style={styles.loadingText}>Loading your schedule…</Text>
              </View>
            ) : (
              <>
                {showBestMatchResults && (
                  <>
                    <View style={styles.sectionHeaderRow}>
                      <Text style={styles.sectionTitle}>Best Match</Text>
                      {bestOptions.length > 0 && (
                        <View style={styles.carouselControls}>
                          <TouchableOpacity
                            style={styles.carouselControlBtn}
                            onPress={() => scrollBestOptionsBy(-1)}
                            activeOpacity={0.8}
                          >
                            <Text style={styles.carouselControlText}>‹</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.carouselControlBtn}
                            onPress={() => scrollBestOptionsBy(1)}
                            activeOpacity={0.8}
                          >
                            <Text style={styles.carouselControlText}>›</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                    {bestOptions.length === 0 ? (
                      <Text style={styles.emptyHint}>
                        No slots found. Try a different timeframe or client.
                      </Text>
                    ) : (
                      <ScrollView
                        ref={bestOptionsScrollRef}
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.bestOptionsRow}
                        style={styles.bestOptionsScroll}
                        onLayout={(e) => setBestOptionsViewportWidth(e.nativeEvent.layout.width)}
                        onScroll={(e) => {
                          bestOptionsScrollXRef.current = e.nativeEvent.contentOffset.x;
                        }}
                        scrollEventThrottle={16}
                      >
                        {bestOptions.map((slot) => (
                          <View key={slotId(slot)} style={styles.bestOptionCard}>
                            <GhostSlotCard
                              slot={slot}
                              preBuffer={preBuffer}
                              postBuffer={postBuffer}
                              decisionMetric={decisionMetric}
                              showQaDebug={showQaDebug}
                              startFromHomeBase={startFromHomeBase}
                              isSelected={selectedSlotId === slotId(slot)}
                              isBestOption={bestBadgeSlotId != null && slotId(slot) === bestBadgeSlotId}
                              showDate={true}
                              onSelect={() => handleSelectSlot(slot)}
                              onMapPress={() => handleMapPress(slot)}
                              onBookPress={() => handleBookSlot(slot)}
                              onPusherToggle={handlePusherToggle}
                            />
                          </View>
                        ))}
                      </ScrollView>
                    )}
                  </>
                )}

                {showQaDebug && timeframe.mode === 'best' && showAllPossibleResults && (
                  <>
                    <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>
                      {allPossibleSectionTitle}
                    </Text>
                    {anyTimeSlots.length === 0 ? (
                      <Text style={styles.emptyHint}>
                        No slots found. Try a different location or duration.
                      </Text>
                    ) : (
                      anyTimeSlots.map((slot) => (
                        <View key={slotId(slot)} style={styles.anyTimeCard}>
                          <GhostSlotCard
                            slot={slot}
                            preBuffer={preBuffer}
                            postBuffer={postBuffer}
                            decisionMetric={decisionMetric}
                            showQaDebug={showQaDebug}
                            startFromHomeBase={startFromHomeBase}
                            isSelected={selectedSlotId === slotId(slot)}
                            isBestOption={bestBadgeSlotId != null && slotId(slot) === bestBadgeSlotId}
                            showDate={true}
                            onSelect={() => handleSelectSlot(slot)}
                            onMapPress={() => handleMapPress(slot)}
                            onBookPress={() => handleBookSlot(slot)}
                            onPusherToggle={handlePusherToggle}
                          />
                        </View>
                      ))
                    )}
                  </>
                )}

                {showAnyTimeResults && (
                  <>
                    <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>
                      Any Time
                    </Text>
                    {anyTimeDayGroups.length === 0 ? (
                      <Text style={styles.emptyHint}>
                        No slots found. Try a different location or duration.
                      </Text>
                    ) : (
                      anyTimeDayGroups.map((group) => {
                        const isCollapsed = collapsedAnyTimeDays[group.dayIso] === true;
                        const bestTime = group.bestSlot ? formatClock(group.bestSlot.startMs) : null;
                        return (
                          <View key={group.dayIso} style={styles.anyTimeDayGroup}>
                            <TouchableOpacity
                              style={styles.anyTimeDayHeader}
                              onPress={() => toggleAnyTimeDay(group.dayIso)}
                              activeOpacity={0.85}
                            >
                              <View style={styles.anyTimeDayHeaderMain}>
                                <Text style={styles.anyTimeDayHeaderTitle}>{group.dayLabel}</Text>
                                <Text style={styles.anyTimeDayHeaderMeta}>
                                  {group.slots.length} slot{group.slots.length === 1 ? '' : 's'}
                                  {bestTime ? ` • best ${bestTime}` : ''}
                                </Text>
                              </View>
                              <Text style={styles.anyTimeDayHeaderChevron}>{isCollapsed ? '▸' : '▾'}</Text>
                            </TouchableOpacity>
                            {!isCollapsed && group.slots.map((slot) => (
                              <View key={slotId(slot)} style={styles.anyTimeCard}>
                                <GhostSlotCard
                                  slot={slot}
                                  preBuffer={preBuffer}
                                  postBuffer={postBuffer}
                                  decisionMetric={decisionMetric}
                                  showQaDebug={showQaDebug}
                                  startFromHomeBase={startFromHomeBase}
                                  isSelected={selectedSlotId === slotId(slot)}
                                  isBestOption={bestBadgeSlotId != null && slotId(slot) === bestBadgeSlotId}
                                  showDate={false}
                                  onSelect={() => handleSelectSlot(slot)}
                                  onMapPress={() => handleMapPress(slot)}
                                  onBookPress={() => handleBookSlot(slot)}
                                  onPusherToggle={handlePusherToggle}
                                />
                              </View>
                            ))}
                          </View>
                        );
                      })
                    )}
                    {anyTimeLoadingMore && (
                      <View style={styles.anyTimeLoadingMoreRow}>
                        <ActivityIndicator size="small" color={MS_BLUE} />
                        <Text style={styles.anyTimeLoadingMoreText}>Loading more slots…</Text>
                      </View>
                    )}
                  </>
                )}

                {showQaDebug && showPickWeekResults && (
                  <>
                    <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>
                      Pick a Week
                    </Text>
                    {dayGroups.length === 0 ? (
                      <Text style={styles.emptyHint}>
                        No schedule in this window. Add meetings or choose another
                        timeframe.
                      </Text>
                    ) : (
                      dayGroups.map((group) => (
                        <DayTimeline
                          key={group.dayIso}
                          dayIso={group.dayIso}
                          dayLabel={group.dayLabel}
                          entries={group.entries}
                          preBuffer={preBuffer}
                          postBuffer={postBuffer}
                          decisionMetric={decisionMetric}
                          showQaDebug={showQaDebug}
                          startFromHomeBase={startFromHomeBase}
                          selectedSlotId={selectedSlotId}
                          bestOptionIds={bestOptionIds}
                          onSelectSlot={handleSelectSlot}
                          onMapPress={handleMapPress}
                          onBookSlot={handleBookSlot}
                          onPusherToggle={handlePusherToggle}
                        />
                      ))
                    )}
                  </>
                )}
              </>
            )
          )}
        </ScrollView>

        {
          !isWide && mapSlot && newLocation && (
            isExpoGo ? (
              <Modal visible transparent animationType="fade">
                <TouchableOpacity
                  style={styles.expoGoModalOverlay}
                  activeOpacity={1}
                  onPress={() => {
                    setMapSlot(null);
                    setHighlightedShiftEventIds([]);
                  }}
                >
                  <View style={styles.expoGoModalBox}>
                    <Text style={styles.expoGoModalTitle}>Map preview</Text>
                    <Text style={styles.expoGoModalText}>
                      Map preview is available in the development build (EAS Build / TestFlight).
                    </Text>
                    <TouchableOpacity
                      style={styles.expoGoModalButton}
                      onPress={() => {
                        setMapSlot(null);
                        setHighlightedShiftEventIds([]);
                      }}
                    >
                      <Text style={styles.expoGoModalButtonText}>Close</Text>
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              </Modal>
            ) : (
              <Suspense fallback={null}>
                <MapPreviewModal
                  visible={!!mapSlot}
                  onClose={() => {
                    setMapSlot(null);
                    setHighlightedShiftEventIds([]);
                  }}
                  onConfirmBooking={() => {
                    if (mapSlot) {
                      setConfirmSlot(mapSlot);
                      setMapSlot(null);
                      setHighlightedShiftEventIds([]);
                    }
                  }}
                  dayEvents={eventsForDay(filteredAppointments, mapSlot.dayIso)}
                  insertionCoord={newLocation}
                  slot={mapSlot}
                  homeBase={preferences.homeBase ?? DEFAULT_HOME_BASE}
                  highlightedEventIds={highlightedShiftEventIds}
                />
              </Suspense>
            )
          )
        }
      </View >

      {isWide && hasValidLocation && (
        <>
          <View style={styles.mapPane}>
            {isExpoGo ? (
              <View style={styles.expoGoMapPlaceholder}>
                <Text style={styles.expoGoMapPlaceholderText}>Map available in development build</Text>
              </View>
            ) : (
              <Suspense fallback={
                <View style={styles.expoGoMapPlaceholder}>
                  <ActivityIndicator size="large" color={MS_BLUE} />
                </View>
              }>
                <PlanVisitMapPanel
                  newLocation={newLocation}
                  slot={displayedMapSlot ?? undefined}
                  dayEvents={
                    displayedMapSlot
                      ? eventsForDay(filteredAppointments, displayedMapSlot.dayIso)
                      : []
                  }
                  homeBase={preferences.homeBase ?? DEFAULT_HOME_BASE}
                  highlightedEventIds={highlightedShiftEventIds}
                />
              </Suspense>
            )}
            <TouchableOpacity
              style={[
                styles.impactDrawerToggleBtn,
                isImpactDrawerOpen && styles.impactDrawerToggleBtnShifted,
              ]}
              activeOpacity={0.9}
              onPress={() => setIsImpactDrawerOpen((prev) => !prev)}
            >
              <Text style={styles.impactDrawerToggleBtnText}>
                {isImpactDrawerOpen ? 'Hide impact' : 'Day Impact'}
              </Text>
            </TouchableOpacity>

            <Animated.View
              style={[
                styles.impactDrawer,
                {
                  transform: [{ translateX: impactDrawerAnim }],
                },
              ]}
              pointerEvents={isImpactDrawerOpen ? 'auto' : 'none'}
            >
              {selectedDayImpact ? (
                <View style={styles.mapPaneImpactWrap}>
                  <TouchableOpacity
                    activeOpacity={0.9}
                    style={styles.impactDrawerHeader}
                    onPress={() => setIsImpactDrawerOpen(false)}
                    {...impactHeaderPanResponder.panHandlers}
                  >
                    <Text style={styles.mapPaneImpactTitle}>
                      Day Impact ({selectedDayImpact.dayIso})
                    </Text>
                    <Text style={styles.impactDrawerHeaderHint}>Tap or slide right to collapse</Text>
                  </TouchableOpacity>
                  <Text style={styles.mapPaneImpactSummary}>
                    Late meetings: {selectedDayImpact.lateCount}
                    {preferences.alwaysStartFromHomeBase !== false
                      ? ` | Return-home late: ${selectedDayImpact.returnHomeLateByMin} min`
                      : ''}
                  </Text>
                  {selectedDayImpact.rejectionReason ? (
                    <Text style={styles.mapPaneImpactRejection}>
                      {selectedDayImpact.rejectionReason}
                    </Text>
                  ) : null}
                  <ScrollView style={styles.mapPaneImpactScroll} contentContainerStyle={styles.mapPaneImpactScrollContent}>
                    {selectedDayImpact.rows.map((row, index) => (
                      <View
                        key={`${row.id}-${index}`}
                        style={[
                          styles.mapPaneImpactRow,
                          row.isNew ? styles.mapPaneImpactRowNew : null,
                        ]}
                      >
                        <Text style={styles.mapPaneImpactRowTitle}>
                          {row.isNew ? 'NEW' : 'M'} {row.title}
                        </Text>
                        <Text style={styles.mapPaneImpactRowMeta}>
                          {row.timeRange}
                          {row.shiftLabel ? ` | Shift ${row.shiftLabel}` : ''}
                        </Text>
                        <Text style={styles.mapPaneImpactRowMeta}>
                          Travel from previous: {row.travelFromPrevMin} min | ETA {row.eta} | Required {row.requiredBy}
                        </Text>
                        <Text
                          style={[
                            styles.mapPaneImpactRowLate,
                            row.lateByMin > 0 ? styles.mapPaneImpactRowLateBad : styles.mapPaneImpactRowLateGood,
                          ]}
                        >
                          {row.lateByMin > 0 ? `Late by ${row.lateByMin} min` : 'On time'}
                        </Text>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              ) : (
                <View style={styles.impactPaneEmpty}>
                  <TouchableOpacity
                    activeOpacity={0.9}
                    style={styles.impactDrawerHeader}
                    onPress={() => setIsImpactDrawerOpen(false)}
                    {...impactHeaderPanResponder.panHandlers}
                  >
                    <Text style={styles.impactPaneEmptyTitle}>Day Impact</Text>
                    <Text style={styles.impactDrawerHeaderHint}>Tap or slide right to collapse</Text>
                  </TouchableOpacity>
                  <Text style={styles.impactPaneEmptyText}>
                    Click any suggested slot to preview how that day changes.
                  </Text>
                </View>
              )}
            </Animated.View>
          </View>
        </>
      )}

      <ConfirmBookingSheet
        visible={!!confirmSlot}
        slot={confirmSlot}
        locationLabel={locationLabel}
        locationForEvent={locationForEvent || undefined}
        coordinates={newLocation ?? { lat: 0, lon: 0 }}
        defaultFlexibleEnabled={bookingDefaultFlexibleEnabled}
        defaultFlexBeforeMinutes={bookingDefaultFlexBeforeMinutes}
        defaultFlexAfterMinutes={bookingDefaultFlexAfterMinutes}
        defaultDurationMinutes={bookingDefaultDurationMinutes}
        onClose={() => {
          setConfirmSlot(null);
        }}
        onConfirm={handleConfirmBooking}
      />
    </View >
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F2F1',
  },
  splitContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  formPane: {
    flex: 1,
    minWidth: 0,
  },
  formPaneCentered: {
    flex: 1,
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
  },
  formPaneWide: {
    maxWidth: 420,
  },
  mapPane: {
    flex: 1,
    minWidth: 0,
    minHeight: 300,
    position: 'relative',
    overflow: 'hidden',
  },
  impactDrawerToggleBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 20,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  impactDrawerToggleBtnShifted: {
    right: IMPACT_DRAWER_WIDTH + 20,
  },
  impactDrawerToggleBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  impactDrawer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: IMPACT_DRAWER_WIDTH,
    borderLeftWidth: 1,
    borderLeftColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
    zIndex: 15,
  },
  mapPaneImpactWrap: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
  },
  impactDrawerHeader: {
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  impactDrawerHeaderHint: {
    marginTop: 4,
    fontSize: 11,
    color: '#64748b',
  },
  impactPaneEmpty: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  impactPaneEmptyTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 8,
  },
  impactPaneEmptyText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#475569',
  },
  mapPaneImpactTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  mapPaneImpactSummary: {
    marginTop: 4,
    fontSize: 12,
    color: '#334155',
    fontWeight: '600',
  },
  mapPaneImpactRejection: {
    marginTop: 8,
    fontSize: 11,
    color: '#991b1b',
    lineHeight: 16,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  mapPaneImpactScroll: {
    marginTop: 8,
  },
  mapPaneImpactScrollContent: {
    paddingBottom: 14,
    gap: 8,
  },
  mapPaneImpactRow: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  mapPaneImpactRowNew: {
    borderColor: '#93c5fd',
    backgroundColor: '#eff6ff',
  },
  mapPaneImpactRowTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  mapPaneImpactRowMeta: {
    marginTop: 2,
    fontSize: 11,
    color: '#475569',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  mapPaneImpactRowLate: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '700',
  },
  mapPaneImpactRowLateGood: {
    color: '#166534',
  },
  mapPaneImpactRowLateBad: {
    color: '#b91c1c',
  },
  expoGoMapPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
  },
  expoGoMapPlaceholderText: {
    fontSize: 14,
    color: '#64748b',
  },
  expoGoModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  expoGoModalBox: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    maxWidth: 320,
  },
  expoGoModalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  expoGoModalText: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 16,
  },
  expoGoModalButton: {
    backgroundColor: MS_BLUE,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  expoGoModalButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  searchSummaryHeader: {
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    marginBottom: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#38BDF8',
    backgroundColor: '#0369A1',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchSummaryText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#E0F2FE',
  },
  searchSummaryEdit: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    color: '#BAE6FD',
    textTransform: 'uppercase',
  },
  durationRow: {
    paddingHorizontal: 16,
    marginBottom: 16,
    marginTop: 8,
  },
  durationPills: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  durationPill: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  durationPillActive: {
    backgroundColor: MS_BLUE,
    borderColor: MS_BLUE,
  },
  durationPillText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  durationPillTextActive: {
    color: '#fff',
  },
  durationSummary: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  rangeBarWrap: {
    marginTop: 10,
    paddingVertical: 6,
  },
  flexToggleRow: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  flexToggleTextWrap: {
    flex: 1,
  },
  flexToggleTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 2,
  },
  flexToggleHint: {
    fontSize: 12,
    color: '#64748B',
  },
  flexSummaryRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8,
  },
  flexSummaryBadge: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#FFFBEB',
  },
  flexSummaryBadgeLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#92400E',
    marginBottom: 2,
    letterSpacing: 0.3,
  },
  flexSummaryBadgeValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#78350F',
  },
  ctaButton: {
    backgroundColor: MS_BLUE,
    marginHorizontal: 16,
    marginVertical: 12,
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaButtonDisabled: {
    backgroundColor: '#94a3b8',
    opacity: 0.7,
  },
  ctaButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
  },
  ctaButtonTextDisabled: {
    color: '#e2e8f0',
  },
  inlineBestSection: {
    marginHorizontal: 16,
    marginBottom: 8,
  },
  inlineBestStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  inlineBestStatusText: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '600',
  },
  allSlotsSection: {
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    padding: 10,
  },
  allSlotsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    gap: 8,
  },
  allSlotsTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  allSlotsToggleBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#e2e8f0',
  },
  allSlotsToggleText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  allSlotsSummary: {
    fontSize: 12,
    color: '#475569',
    marginBottom: 8,
  },
  allSlotsList: {
    gap: 8,
  },
  allSlotCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 10,
  },
  allSlotCardActive: {
    borderColor: '#0284c7',
    backgroundColor: '#eff6ff',
  },
  allSlotCardDisabled: {
    opacity: 0.6,
  },
  allSlotCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 6,
  },
  allSlotCardTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  allSlotBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  allSlotBadgeAccepted: {
    backgroundColor: '#ecfdf5',
    borderColor: '#86efac',
  },
  copyBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#e2e8f0',
    marginLeft: 8,
    minWidth: 28,
    alignItems: 'center',
  },
  copyBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
    lineHeight: 16,
  },
  allSlotBadgeRejected: {
    backgroundColor: '#fef2f2',
    borderColor: '#fca5a5',
  },
  allSlotBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  allSlotBadgeTextAccepted: {
    color: '#166534',
  },
  allSlotBadgeTextRejected: {
    color: '#991b1b',
  },
  allSlotCardMessage: {
    fontSize: 12,
    color: '#1e293b',
    marginBottom: 4,
    lineHeight: 18,
  },
  allSlotDetourDebug: {
    fontSize: 11,
    color: '#475569',
    marginBottom: 6,
  },
  allSlotCardMeta: {
    fontSize: 11,
    color: '#475569',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  allSlotClickHint: {
    fontSize: 11,
    color: '#0369a1',
    marginBottom: 4,
    fontWeight: '600',
  },
  allSlotRouteBlock: {
    marginTop: 8,
    marginBottom: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    gap: 2,
  },
  allSlotRouteEquation: {
    fontSize: 11,
    color: '#0f172a',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  allSlotRouteSummary: {
    fontSize: 11,
    color: '#0f766e',
    fontWeight: '700',
    marginTop: 2,
  },
  allSlotChecklist: {
    marginTop: 6,
    gap: 4,
  },
  allSlotRuleRow: {
    gap: 2,
  },
  allSlotRuleItem: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  allSlotRuleDetail: {
    fontSize: 10,
    lineHeight: 14,
    marginLeft: 18,
  },
  allSlotRulePass: {
    color: '#166534',
  },
  allSlotRuleFail: {
    color: '#991b1b',
  },
  allSlotRuleNA: {
    color: '#64748b',
  },
  devPanel: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    backgroundColor: '#1e293b',
    borderRadius: 8,
  },
  devPanelTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94a3b8',
    marginBottom: 6,
  },
  devPanelLine: {
    fontSize: 11,
    color: '#cbd5e1',
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  devPanelError: {
    color: '#f87171',
  },
  formScroll: {
    flex: 1,
  },
  formScrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  formScrollContentCentered: {
    alignItems: 'center',
    paddingTop: 16,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  setupState: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  setupHint: {
    fontSize: 15,
    color: '#605E5C',
    textAlign: 'center',
  },
  loadingState: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 15,
    color: '#605E5C',
    marginTop: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: MS_BLUE,
    marginBottom: 12,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  carouselControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  carouselControlBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  carouselControlText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    lineHeight: 19,
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
    width: 300,
    marginRight: 12,
  },
  anyTimeCard: {
    marginBottom: 10,
  },
  anyTimeDayGroup: {
    marginBottom: 16,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 10,
  },
  anyTimeDayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingVertical: 4,
    marginBottom: 8,
  },
  anyTimeDayHeaderMain: {
    flex: 1,
    marginRight: 8,
  },
  anyTimeDayHeaderTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  anyTimeDayHeaderMeta: {
    fontSize: 12,
    color: '#475569',
    marginTop: 2,
  },
  anyTimeDayHeaderChevron: {
    fontSize: 16,
    color: '#334155',
    fontWeight: '700',
  },
  anyTimeLoadingMoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  anyTimeLoadingMoreText: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '600',
  },
  emptyHint: {
    fontSize: 14,
    color: '#605E5C',
    marginBottom: 16,
  },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
  },
  sectionIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
  },
  formLabelTop: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
});
