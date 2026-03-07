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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getISOWeek, startOfDay } from 'date-fns';
import Constants from 'expo-constants';
import { useAuth } from '../context/AuthContext';
import { useRoute } from '../context/RouteContext';
import { useUserPreferences } from '../context/UserPreferencesContext';
import {
  compareScoredSlots,
  findSmartSlots,
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
import { getLocalMeetingsInRange } from '../services/localMeetings';
import { sortAppointmentsByTime } from '../utils/optimization';
import { buildRouteWithInsertionMeta } from '../utils/mapPreview';
import { DEFAULT_HOME_BASE } from '../types';
import { getEffectiveSubscriptionTier, getTierEntitlements } from '../utils/subscription';

const MS_BLUE = '#0078D4';
const MS_PER_MIN = 60_000;
const FLEX_WINDOW_REGEX = /\[Flexible Window:\s*([0-2]?\d:[0-5]\d)\s*to\s*([0-2]?\d:[0-5]\d)(?:\s*\|[^\]]*)?\]/i;

function toCoord(ev: CalendarEvent): Coordinate | null {
  const c = ev.coordinates;
  if (!c || typeof c.latitude !== 'number' || typeof c.longitude !== 'number') return null;
  return { lat: c.latitude, lon: c.longitude };
}

const DURATION_OPTS = [30, 60, 90] as const;
const MAX_DURATION_MINUTES = 8 * 60;
const DURATION_STEP_MINUTES = 15;
const FLEXIBLE_WINDOW_TAG_REGEX = /\[Flexible Window:[^\]]+\]/i;
type DurationPreset = (typeof DURATION_OPTS)[number] | 'custom';
type MeetingConfigSnapshot = {
  durationMinutes: number;
  flexibleMeetingEnabled: boolean;
  flexBeforeMinutes: number;
  flexAfterMinutes: number;
};

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

function formatTimeframeSummaryLabel(selection: TimeframeSelection): string {
  if (selection.mode === 'best') return 'Best Match';
  if (selection.mode === 'anytime') return 'Any Time';
  return `Week ${getISOWeek(new Date(selection.weekStartMs))}`;
}

function formatClockFromMinutes(minutes: number): string {
  const safe = Math.max(0, Math.min(23 * 60 + 59, minutes));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
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

  const [locationSelection, setLocationSelection] = useState<LocationSelection>({ type: 'none' });
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [durationPreset, setDurationPreset] = useState<DurationPreset>(60);
  const [flexibleMeetingEnabled, setFlexibleMeetingEnabled] = useState(false);
  const [flexBeforeMinutes, setFlexBeforeMinutes] = useState(15);
  const [flexAfterMinutes, setFlexAfterMinutes] = useState(15);
  const [showSearchInputs, setShowSearchInputs] = useState(true);
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
  const [bestOptionsViewportWidth, setBestOptionsViewportWidth] = useState(0);
  const qaLog = useQALog();
  const qaEntriesRef = React.useRef<QASlotConsidered[]>([]);
  const lastBookingDebugRef = React.useRef<{
    proposalId: string;
    dayIso: string;
    bookedEventId: string;
  } | null>(null);
  const bestOptionsScrollRef = React.useRef<ScrollView | null>(null);
  const bestOptionsScrollXRef = React.useRef(0);

  const searchWindow = useMemo(() => getSearchWindow(timeframe), [timeframe]);
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
    if (DURATION_OPTS.includes(snapped as (typeof DURATION_OPTS)[number])) {
      setDurationPreset(snapped as DurationPreset);
    } else {
      setDurationPreset('custom');
    }
  }, []);

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
  const canFindBestTime = hasValidLocation;

  /** Use freshly fetched + enriched data for search; fallback to context when not searched yet. */
  const scheduleForSearch = hasSearched && searchAppointments != null ? searchAppointments : appointments;

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
      onSlotConsidered: __DEV__ && qaLog
        ? (e) => { qaEntriesRef.current.push(e); }
        : undefined,
    });
  }, [hasSearched, scheduleForSearch, newLocation, durationMinutes, preferences, searchWindow, timeframe.mode, qaLog]);

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
  const showBestMatchResults = timeframe.mode === 'best';
  const showAnyTimeResults = timeframe.mode === 'anytime';
  const showPickWeekResults = timeframe.mode === 'week';

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

  const logProposalSelection = React.useCallback(
    (slot: ScoredSlot, source: 'select' | 'map' | 'book' | 'confirm') => {
      if (!getProposalPreviewDebugFlag() || !newLocation) return;
      const proposalId = slotId(slot);
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

  const handleFindBestTime = async () => {
    if (!canFindBestTime) return;
    setShowSearchInputs(false);
    setSearchMeetingConfig({
      durationMinutes,
      flexibleMeetingEnabled,
      flexBeforeMinutes: flexibleMeetingEnabled ? flexBeforeMinutes : 0,
      flexAfterMinutes: flexibleMeetingEnabled ? flexAfterMinutes : 0,
    });
    setHasSearched(true);
    setSearchLoading(true);
    setSearchAppointments(null);

    if (!canSyncCalendar) {
      const { start, end } = searchWindow;
      const localEvents = await getLocalMeetingsInRange(start, end);
      setSearchAppointments(sortAppointmentsByTime(localEvents));
      setSearchLoading(false);
      return;
    }

    const token = userToken ?? (getValidToken ? await getValidToken() : null);
    if (!token) {
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
      const sorted = sortAppointmentsByTime(enriched);
      setSearchAppointments(sorted);
    } catch (e) {
      if (e instanceof GraphUnauthorizedError) {
        await clearGraphSession().catch(() => { });
        if (userToken && !isMagicAuthToken(userToken)) {
          signOut();
        }
      } else {
        Alert.alert('Search error', e instanceof Error ? e.message : 'Failed to load calendar');
      }
    } finally {
      setSearchLoading(false);
    }
  };

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

  // Reset results when user changes inputs (must press CTA again)
  useEffect(() => {
    setHasSearched(false);
    setShowSearchInputs(true);
    setSearchAppointments(null);
    setSearchMeetingConfig(null);
    setHighlightedShiftEventIds([]);
  }, [locationSelection, durationMinutes, timeframe, flexibleMeetingEnabled, flexBeforeMinutes, flexAfterMinutes]);

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
    const baseEventBody = (finalEvent.bodyPreview ?? finalEvent.notes ?? '').trim() || undefined;
    const effectiveFlexEnabled = Boolean(flexConfig?.enabled);
    const effectiveFlexBeforeMinutes = effectiveFlexEnabled ? Math.max(0, flexConfig?.earlyMinutes ?? 0) : 0;
    const effectiveFlexAfterMinutes = effectiveFlexEnabled ? Math.max(0, flexConfig?.lateMinutes ?? 0) : 0;
    const flexibleWindowTag = confirmSlot && effectiveFlexEnabled
      ? buildFlexibleWindowTag(confirmSlot.startMs, effectiveFlexBeforeMinutes, effectiveFlexAfterMinutes)
      : null;
    const eventBody = composeEventBodyWithFlexibleWindow(baseEventBody, flexibleWindowTag);
    if (eventBody) {
      finalEvent = {
        ...finalEvent,
        notes: eventBody,
        bodyPreview: eventBody,
      };
    }

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

    addAppointment(finalEvent);
    setSelectedSlotId(null);
    setConfirmSlot(null);
    const meetingDay = finalEvent.startIso ? new Date(finalEvent.startIso) : null;
    if (meetingDay) {
      const dayKey = toLocalDayKey(meetingDay);
      setPendingLocalEvent({ dayKey, event: finalEvent });
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
  const timeframeSummaryLabel = useMemo(
    () => formatTimeframeSummaryLabel(timeframe),
    [timeframe]
  );
  const collapsedSearchSummary = useMemo(() => {
    const summaryLocation = locationLabel || 'No location';
    return `${summaryLocation} • Duration: ${formatDurationLabel(durationMinutes)} • Type: ${timeframeSummaryLabel}`;
  }, [durationMinutes, locationLabel, timeframeSummaryLabel]);
  const showCollapsedSearchHeader = hasSearched && !showSearchInputs;
  const showSearchInputsPanel = !hasSearched || showSearchInputs;

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

  /** Slot to display on map: selected for booking, or tapped for map, or Best Match. */
  const defaultMapSlot = showBestMatchResults
    ? (bestOptions[0] ?? null)
    : (anyTimeSlots[0] ?? null);
  const displayedMapSlot = confirmSlot ?? mapSlot ?? defaultMapSlot;

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
        >
          {!hasSearched && (
            <View style={{ alignItems: 'center', marginTop: 16, marginBottom: 24 }}>
              <View style={[styles.sectionIconBox, { backgroundColor: '#DBEAFE' }]}>
                <Text style={{ fontSize: 18 }}>📅</Text>
              </View>
              <Text style={styles.headerTitle}>Plan a Meeting</Text>
            </View>
          )}

          {showCollapsedSearchHeader && (
            <TouchableOpacity
              style={styles.searchSummaryHeader}
              onPress={() => setShowSearchInputs(true)}
              activeOpacity={0.88}
            >
              <View style={styles.searchSummaryRow}>
                <Text style={styles.searchSummaryText} numberOfLines={1}>
                  {collapsedSearchSummary}
                </Text>
                <Text style={styles.searchSummaryEdit}>Edit</Text>
              </View>
            </TouchableOpacity>
          )}

          {showSearchInputsPanel && (
            <>
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

            <View style={styles.durationRow}>
              <Text style={styles.formLabelTop}>DURATION</Text>
              <View style={styles.durationPills}>
                {DURATION_OPTS.map((d) => (
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
          </View>

          <View style={!hasSearched ? { width: '100%', maxWidth: 600, alignSelf: 'center' } : {}}>
            <TouchableOpacity
              style={[
                styles.ctaButton,
                (!hasSearched && isWide) && { marginHorizontal: 0 },
                (!canFindBestTime || searchLoading) && styles.ctaButtonDisabled,
              ]}
              onPress={handleFindBestTime}
              activeOpacity={0.85}
              disabled={!canFindBestTime || searchLoading}
            >
              <Text
                style={[
                  styles.ctaButtonText,
                  (!canFindBestTime || searchLoading) && styles.ctaButtonTextDisabled,
                ]}
              >
                {searchLoading ? 'Searching…' : 'Find best time'}
              </Text>
            </TouchableOpacity>

            {!hasSearched && (
              <View style={styles.setupState}>
                <Text style={styles.setupHint}>
                  {canFindBestTime
                    ? 'Tap "Find best time" to see slots.'
                    : 'Select a location (contact or address) to see best slots.'}
                </Text>
              </View>
            )}
              </View>
            </>
          )}

          {__DEV__ && (Object.keys(devDebug).length > 0 || hasSearched) && (
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

          {hasSearched && (
            searchLoading ? (
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

                {showAnyTimeResults && (
                  <>
                    <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>
                      Any Time
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

                {showPickWeekResults && (
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
        </View>
      )
      }

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
