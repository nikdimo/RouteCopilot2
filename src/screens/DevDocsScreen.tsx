import React, { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { runFullQASuite, runTravelFeasibilityQA, runOverlapSanityCheck, runFakeMeetingsQA, getFakeQASchedule } from '../utils/scheduler';
import { useRoute } from '../context/RouteContext';
import { useQALog } from '../context/QALogContext';
import { useDevUI } from '../context/DevUIContext';
import { useAuth } from '../context/AuthContext';
import { useUserPreferences } from '../context/UserPreferencesContext';
import { MS_SCOPES } from '../config/auth';
import { BACKEND_API_BASE_URL, BACKEND_API_ENABLED } from '../config/backend';
import {
  compareScoredSlots,
  findSmartSlots,
  getBestBadgeSlotId,
  pickBestOptionsWithDayDiversity,
  slotId,
  type QASlotConsidered,
} from '../utils/scheduler';
import { toLocalDayKey } from '../utils/dateUtils';
import {
  GraphUnauthorizedError,
  createCalendarEvent,
  updateCalendarEvent,
  type CalendarEvent,
} from '../services/graph';
import {
  allocateMeetingDecisionCode,
  appendMeetingCodeSuffix,
  appendMeetingDecisionEntry,
  type MeetingDecisionAction,
  type MeetingDecisionCandidate,
  type MeetingDecisionConsideredSlot,
} from '../services/meetingDecisionLog';
import { backendAppendMeetingDecisionAudit } from '../services/backendApi';

const MS_BLUE = '#0078D4';
const QA_SEED_COORDS = [
  { label: 'Kobenhavn K', location: 'Radhuspladsen 1, 1550 Copenhagen', lat: 55.6761, lon: 12.5683 },
  { label: 'Osterbro', location: 'Trianglen 1, 2100 Copenhagen', lat: 55.6997, lon: 12.5767 },
  { label: 'Valby', location: 'Toftegards Alle 43, 2500 Valby', lat: 55.6618, lon: 12.5162 },
  { label: 'Lyngby', location: 'Lyngby Hovedgade 50, 2800 Kongens Lyngby', lat: 55.7704, lon: 12.5038 },
  { label: 'Hillerod', location: 'Slotsgade 26, 3400 Hillerod', lat: 55.9279, lon: 12.3008 },
  { label: 'Roskilde', location: 'Algade 51, 4000 Roskilde', lat: 55.6415, lon: 12.0803 },
  { label: 'Koge', location: 'Torvet 1, 4600 Koge', lat: 55.4580, lon: 12.1821 },
  { label: 'Taastrup', location: 'Cityringen 6, 2630 Taastrup', lat: 55.6518, lon: 12.2871 },
  { label: 'Ballerup', location: 'Centrumgaden 7, 2750 Ballerup', lat: 55.7317, lon: 12.3636 },
  { label: 'Helsingor', location: 'Stengade 59, 3000 Helsingor', lat: 56.0361, lon: 12.6136 },
];
const QA_ADDRESS_CATALOG = [
  { label: 'City Hall', location: 'Radhuspladsen 1, 1550 Copenhagen', lat: 55.6761, lon: 12.5683 },
  { label: 'Nyhavn', location: 'Nyhavn 1, 1051 Copenhagen', lat: 55.6798, lon: 12.5910 },
  { label: 'Norreport', location: 'Norreport 1, 1165 Copenhagen', lat: 55.6833, lon: 12.5714 },
  { label: 'Osterbro', location: 'Trianglen 1, 2100 Copenhagen', lat: 55.6997, lon: 12.5767 },
  { label: 'Parken', location: 'Per Henrik Lings Alle 2, 2100 Copenhagen', lat: 55.7026, lon: 12.5723 },
  { label: 'Valby', location: 'Toftegards Alle 43, 2500 Valby', lat: 55.6618, lon: 12.5162 },
  { label: 'Carlsberg', location: 'Ny Carlsberg Vej 100, 1799 Copenhagen V', lat: 55.6672, lon: 12.5371 },
  { label: 'Frederiksberg', location: 'Frederiksberg Alle 21, 1820 Frederiksberg', lat: 55.6735, lon: 12.5410 },
  { label: 'Lyngby', location: 'Lyngby Hovedgade 50, 2800 Kongens Lyngby', lat: 55.7704, lon: 12.5038 },
  { label: 'DTU', location: 'Anker Engelunds Vej 1, 2800 Kongens Lyngby', lat: 55.7853, lon: 12.5213 },
  { label: 'Ballerup', location: 'Centrumgaden 7, 2750 Ballerup', lat: 55.7317, lon: 12.3636 },
  { label: 'Herlev', location: 'Herlev Hovedgade 119, 2730 Herlev', lat: 55.7230, lon: 12.4396 },
  { label: 'Taastrup', location: 'Cityringen 6, 2630 Taastrup', lat: 55.6518, lon: 12.2871 },
  { label: 'Roskilde', location: 'Algade 51, 4000 Roskilde', lat: 55.6415, lon: 12.0803 },
  { label: 'Koge', location: 'Torvet 1, 4600 Koge', lat: 55.4580, lon: 12.1821 },
  { label: 'Hillerod', location: 'Slotsgade 26, 3400 Hillerod', lat: 55.9279, lon: 12.3008 },
  { label: 'Helsingor', location: 'Stengade 59, 3000 Helsingor', lat: 56.0361, lon: 12.6136 },
  { label: 'Gentofte', location: 'Jagersborg Alle 14, 2920 Charlottenlund', lat: 55.7540, lon: 12.5744 },
  { label: 'Hvidovre', location: 'Hvidovrevej 278, 2650 Hvidovre', lat: 55.6571, lon: 12.4734 },
  { label: 'Amager', location: 'Amagerbrogade 145, 2300 Copenhagen S', lat: 55.6586, lon: 12.6131 },
];
const QA_EVENT_DURATION_MINUTES = [30, 45, 60, 90];
const QA_GENERATOR_SEED = 20260309;
const QA_SCHEDULER_BATCH_COUNT = 20;
const QA_SCHEDULER_MAX_ATTEMPTS = 300;
const FLEXIBLE_WINDOW_TAG_REGEX = /\[Flexible Window:[^\]]+\]/i;
const DECISION_CODE_TAG_REGEX = /\[Decision Code:\s*\d{4}\]/i;
const QA_WRITE_RETRY_DELAYS_MS = [0, 400, 1000];

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

function offsetCoordinateKm(
  base: { lat: number; lon: number },
  dxKm: number,
  dyKm: number
) {
  const lat = base.lat + dyKm / 110.574;
  const lon = base.lon + dxKm / (111.320 * Math.cos((base.lat * Math.PI) / 180));
  return {
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
  };
}

function sortAppointmentsByStart(events: CalendarEvent[]) {
  return [...events].sort((a, b) => {
    const aStart = a.startIso ? new Date(a.startIso).getTime() : 0;
    const bStart = b.startIso ? new Date(b.startIso).getTime() : 0;
    return aStart - bStart;
  });
}

function formatClock(ms: number): string {
  const date = new Date(ms);
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

function formatDayLabel(dayIso: string) {
  const [y, m, d] = dayIso.split('-').map((value) => parseInt(value, 10));
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function buildFlexibleWindowTag(slotStartMs: number, flexBeforeMinutes: number, flexAfterMinutes: number): string | null {
  if (flexBeforeMinutes <= 0 && flexAfterMinutes <= 0) return null;
  const day = new Date(slotStartMs);
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const startMinutes = Math.round((slotStartMs - dayStart) / 60_000);
  const minStart = Math.max(0, startMinutes - flexBeforeMinutes);
  const maxStart = Math.min(23 * 60 + 59, startMinutes + flexAfterMinutes);
  const formatMinutes = (minutes: number) =>
    `${Math.floor(minutes / 60).toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`;
  return `[Flexible Window: ${formatMinutes(minStart)} to ${formatMinutes(maxStart)} | source=qa-scheduler]`;
}

function composeEventBodyWithFlexibleWindow(baseBody: string | undefined, flexibleWindowTag: string | null) {
  const cleanedBase = (baseBody ?? '').replace(FLEXIBLE_WINDOW_TAG_REGEX, '').trim();
  if (!flexibleWindowTag) return cleanedBase || undefined;
  if (!cleanedBase) return flexibleWindowTag;
  return `${cleanedBase}\n\n${flexibleWindowTag}`;
}

function composeEventBodyWithDecisionCode(baseBody: string | undefined, decisionCode: string) {
  const cleanedBase = (baseBody ?? '').replace(DECISION_CODE_TAG_REGEX, '').trim();
  const decisionTag = `[Decision Code: ${decisionCode}]`;
  if (!cleanedBase) return decisionTag;
  return `${cleanedBase}\n\n${decisionTag}`;
}

function buildSchedulerQaRequest(index: number, sourceEvents: CalendarEvent[], rng: () => number) {
  const anchors = sourceEvents
    .filter(
      (event) =>
        event.coordinates &&
        typeof event.coordinates.latitude === 'number' &&
        typeof event.coordinates.longitude === 'number'
    )
    .map((event) => ({
      title: event.title ?? 'Meeting',
      lat: event.coordinates!.latitude,
      lon: event.coordinates!.longitude,
    }));
  const fallbackAnchors = QA_SEED_COORDS.map((entry) => ({
    title: entry.label,
    lat: entry.lat,
    lon: entry.lon,
  }));
  const sourceAnchors = anchors.length > 0 ? anchors : fallbackAnchors;
  const anchor = pick(rng, sourceAnchors);
  const sortedCatalog = [...QA_ADDRESS_CATALOG]
    .map((entry) => ({
      ...entry,
      distScore: Math.hypot(entry.lat - anchor.lat, entry.lon - anchor.lon),
    }))
    .sort((a, b) => a.distScore - b.distScore);
  const preferredPool = sortedCatalog.slice(0, Math.min(6, sortedCatalog.length));
  const catalogEntry = pick(rng, preferredPool);
  const flexibleEnabled = rng() < 0.35;
  const flexBeforeMinutes = flexibleEnabled ? pick(rng, [15, 30, 45, 60]) : 0;
  const flexAfterMinutes = flexibleEnabled ? pick(rng, [15, 30, 45, 60, 90]) : 0;
  return {
    index,
    titleBase: `QA Sched ${index} near ${anchor.title}`,
    locationLabel: catalogEntry.label,
    locationForEvent: catalogEntry.location,
    coord: { lat: catalogEntry.lat, lon: catalogEntry.lon },
    anchorTitle: anchor.title,
    durationMinutes: pick(rng, QA_EVENT_DURATION_MINUTES),
    flexibleEnabled,
    flexBeforeMinutes,
    flexAfterMinutes,
  };
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryGraphWrite<T>(
  operation: () => Promise<T>,
  isSuccess: (result: T) => boolean
) {
  let lastResult: T | null = null;
  for (const delayMs of QA_WRITE_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await sleep(delayMs);
    }
    const result = await operation();
    lastResult = result;
    if (isSuccess(result)) {
      return result;
    }
  }
  return lastResult;
}

function summarizeRejectedSlots(entries: QASlotConsidered[]) {
  const rejected = entries.filter((entry) => entry.status === 'rejected');
  return rejected.slice(0, 3).map((entry) => `${entry.dayLabel} ${entry.timeRange}: ${entry.reason ?? 'Rejected'}`);
}

function mapConsideredSlots(entries: QASlotConsidered[]): MeetingDecisionConsideredSlot[] {
  return entries.map((entry) => ({
    dayIso: entry.dayIso,
    dayLabel: entry.dayLabel,
    timeRange: entry.timeRange,
    status: entry.status,
    reason: entry.reason,
    detourKm: entry.detourKm,
    addToRouteMin: entry.addToRouteMin,
    baselineMin: entry.baselineMin,
    newPathMin: entry.newPathMin,
    slackMin: entry.slackMin,
    score: entry.score,
    label: entry.label,
    prev: entry.prev,
    next: entry.next,
    summary: entry.summary,
  }));
}

function buildExistingMeetingsByDay(events: CalendarEvent[]) {
  const result: Record<string, Array<{
    id: string;
    title: string;
    time: string;
    location: string;
    startIso?: string;
    endIso?: string;
  }>> = {};
  for (const event of events) {
    if (!event.startIso) continue;
    const dayKey = toLocalDayKey(new Date(event.startIso));
    if (!result[dayKey]) result[dayKey] = [];
    result[dayKey]!.push({
      id: event.id,
      title: event.title ?? '(No title)',
      time: event.time ?? '-',
      location: event.location ?? '-',
      startIso: event.startIso ?? undefined,
      endIso: event.endIso ?? undefined,
    });
  }
  return result;
}

/** Human-readable purpose for each Microsoft OAuth scope used by the app */
const SCOPE_PURPOSE: Record<string, string> = {
  'User.Read': 'Read signed-in user profile (e.g. /me). Required for auth and display name.',
  'offline_access': 'Refresh token so the app can get new access tokens without re-sign-in (session persistence).',
  'Calendars.Read': 'Read user calendar events and free/busy. Used for schedule and map.',
  'Calendars.ReadWrite': 'Create, update, delete calendar events. Used for Plan Visit booking and meeting edit/delete.',
  'Contacts.ReadWrite': 'Read and create Outlook contacts. Used when saving a contact from Plan Visit Confirm sheet.',
};

type Section = 'User Story' | 'Roadmap' | 'Architecture' | 'Logic Specs' | 'Scopes' | 'QA' | 'QA Log' | 'UI';

const SECTIONS: Section[] = [
  'User Story',
  'Roadmap',
  'Architecture',
  'Logic Specs',
  'Scopes',
  'QA',
  'QA Log',
  'UI',
];

export default function DevDocsScreen() {
  const [section, setSection] = useState<Section>('User Story');

  return (
    <View style={styles.container}>
      <View style={styles.versionBar}>
        <Text style={styles.versionText}>Build: 2025-02-android-fixes</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.segmentedScroll}
        contentContainerStyle={styles.segmentedContent}
      >
        {SECTIONS.map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.segment, section === tab && styles.segmentActive]}
            onPress={() => setSection(tab)}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.segmentText,
                section === tab && styles.segmentTextActive,
              ]}
              numberOfLines={1}
            >
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
      >
        {section === 'User Story' && <UserStorySection />}
        {section === 'Roadmap' && <RoadmapSection />}
        {section === 'Architecture' && <ArchitectureSection />}
        {section === 'Logic Specs' && <LogicSpecsSection />}
        {section === 'Scopes' && <ScopesSection />}
        {section === 'QA' && <QASection />}
        {section === 'QA Log' && <QALogViewerSection />}
        {section === 'UI' && <UISection />}
      </ScrollView>
    </View>
  );
}

function UserStorySection() {
  return (
    <View style={styles.section}>
      <Text style={styles.h1}>User Story: Dave & Køge</Text>
      <Text style={styles.body}>
        Dave is a field rep based in the Copenhagen area. His calendar is packed
        with meetings across the week, but they’re scattered: some in central
        Copenhagen, some in Køge, others in suburbs. He wastes hours driving
        back and forth instead of batching visits by area.
      </Text>
      <Text style={styles.body}>
        WisePlan doesn’t just look for “empty slots” in his calendar. It
        scans the whole week to find geographic clusters: groups of existing
        meetings that are close to each other in location and time. When it
        finds a cluster (e.g. several commitments in or near Køge on Thursday),
        it suggests adding new meetings in that same area to minimize travel.
      </Text>
      <Text style={styles.body}>
        The goal: fewer miles, less stress, more face-to-face time with clients
        in the same region on the same day.
      </Text>
    </View>
  );
}

function RoadmapSection() {
  return (
    <View style={styles.section}>
      <Text style={styles.h1}>Roadmap</Text>

      <Text style={styles.h2}>Phase 1: Skeleton</Text>
      <Text style={styles.body}>
        MVP app shell: Day View, Map, Dev docs. Bottom tabs, hardcoded
        meetings, and this documentation screen. Establishes navigation and
        UI patterns.
      </Text>

      <Text style={styles.h2}>Phase 2: Outlook Brain</Text>
      <Text style={styles.body}>
        Connect to Microsoft Graph: read calendar events and contacts. Sync
        meetings and locations into the app. User sees real calendar data
        instead of placeholders. Auth (e.g. MSAL) and backend API for
        token exchange.
      </Text>

      <Text style={styles.h2}>Phase 3: Optimization Algorithm</Text>
      <Text style={styles.body}>
        Use Mapbox Matrix API (or similar) for travel times. Implement
        clustering and slot-suggestion logic: “You’re already in Køge on
        Thursday—here are 3 contacts nearby you could slot in.” Display
        suggested blocks and optional reordering on the map and day view.
      </Text>

      <Text style={styles.h2}>Phase 4: Admin View</Text>
      <Text style={styles.body}>
        Admin dashboard (web or in-app): manage users, view usage, configure
        regions or rules. Support for multiple reps and optional reporting.
      </Text>

      <Text style={styles.h2}>Phase 7: Smart Scheduling ✓</Text>
      <Text style={styles.body}>
        Pre- and post-meeting buffers, Plan Visit gated flow (location, duration,
        timeframe, "Find best time"), Best Options + By Day timeline, tier-based
        slot ranking (On Route / Nearby / New Day), working hours/days filter,
        15-min grid snap, no-past constraint, OSRM route display with leg stats.
      </Text>

      <Text style={styles.h2}>Phase 7B: Scheduler Intelligence (Current) ✓</Text>
      <Text style={styles.body}>
        Improved slot quality and relevance. Changes shipped:
      </Text>
      <View style={styles.stackList}>
        <Text style={styles.stackItem}>Smooth slack penalty — replaced hard cliff at 10 min with curve; tight-but-possible slots no longer unfairly ranked below high-detour ones</Text>
        <Text style={styles.stackItem}>Busy day penalty — days with more than 3 meetings get a light score penalty; app prefers lighter days when detour is similar</Text>
        <Text style={styles.stackItem}>Midpoint gap candidate — each gap now also proposes the middle position, not just the earliest 3; reduces tight-against-previous-meeting slots</Text>
        <Text style={styles.stackItem}>Empty-day time variety — free days suggest Morning / Midday / Afternoon options instead of only the earliest possible time</Text>
        <Text style={styles.stackItem}>Best Options diversity — top 3 cards guaranteed from 3 different calendar days; never 3 variants of the same gap</Text>
        <Text style={styles.stackItem}>Field/overnight mode — "Start and end from home base" profile toggle; when off, first meeting starts at workStart and last ends at workEnd (no home commute counted); cross-day adjacency bonus activates</Text>
        <Text style={styles.stackItem}>Cross-day adjacency bonus — field mode only: −20 score if slot ends within 15 km of next working day's first meeting</Text>
      </View>

      <Text style={styles.h2}>Phase 8: Performance ✓</Text>
      <Text style={styles.body}>
        App startup and data loading optimised for perceived speed:
      </Text>
      <View style={styles.stackList}>
        <Text style={styles.stackItem}>JWT local validation — token expiry parsed from claims on device; /me network call skipped on every launch when token is still valid (saves ~500 ms)</Text>
        <Text style={styles.stackItem}>Instant app shell — AppNavigator shows immediately after token restore; ScheduleScreen spinner replaces the old full-screen blocker</Text>
        <Text style={styles.stackItem}>Two-phase calendar loading — raw event list shown instantly; geocoding + contact enrichment runs in background and patches data progressively</Text>
        <Text style={styles.stackItem}>Parallel enrichment — contact address + contact info lookups use Promise.all instead of sequential loops</Text>
        <Text style={styles.stackItem}>Contact request deduplication — session cache + in-flight Map; same query never fetches twice; $search fast-path before 500-item fallback</Text>
        <Text style={styles.stackItem}>OSRM route caching — routes cached in AsyncStorage (24h TTL) + memory; same waypoints never re-fetched</Text>
        <Text style={styles.stackItem}>Debounced route recalculation — 350 ms debounce prevents cascade OSRM calls during drag-reorder</Text>
        <Text style={styles.stackItem}>DaySlider counts use raw fetch — ±30 day meeting counts skip geocoding entirely</Text>
      </View>

      <Text style={styles.h2}>Phase 7C: Real ETA (Later)</Text>
      <Text style={styles.body}>
        Integrate a traffic/routing API (e.g. Mapbox, Google Directions) for
        real driving times and distances. Replace heuristic ETA with live or
        cached route data when offline-capable.
      </Text>

      <Text style={styles.h1}>Performance & UX Optimization Roadmap</Text>
      <Text style={styles.body}>
        Plan to improve perceived speed and performance: what to load first, what runs in background, and optional VPS-backed caches. Scope excludes Microsoft Graph calendar data on server (privacy/compliance); VPS only for geocode/OSRM cache and app state.
      </Text>

      <Text style={styles.h2}>Current Bottlenecks</Text>
      <View style={styles.stackList}>
        <Text style={styles.stackItem}>Duplicate today load — RootNavigator and SelectedDateSync both fetch today on startup (~50% redundant Graph calls)</Text>
        <Text style={styles.stackItem}>Initial load — 1–3 s spinner until first meetings appear</Text>
        <Text style={styles.stackItem}>Map first view — 600 ms–2 s until polylines (OSRM + map ready)</Text>
        <Text style={styles.stackItem}>Enrichment — If sequential: geocode then contact lookup adds 1–5 s</Text>
        <Text style={styles.stackItem}>Day switch — Re-fetch if not in dayCache; ±1 day can be prefetched</Text>
        <Text style={styles.stackItem}>OSRM debounce — 350 ms + 500 ms–2 s per reorder</Text>
      </View>

      <Text style={styles.h2}>Phase 1: Quick Wins (No VPS) — ~1 day ✓</Text>
      <Text style={styles.body}>Priority order (all done):</Text>
      <View style={styles.stackList}>
        <Text style={styles.stackItem}>1. Remove duplicate today load — SelectedDateSync is single source. ✓</Text>
        <Text style={styles.stackItem}>2. Parallelize enrichment — Promise.all([geocode, contacts]) in graph.ts. ✓</Text>
        <Text style={styles.stackItem}>3. Skeleton loaders — ScheduleScreen skeleton cards; MapScreen "Calculating route…" overlay. ✓</Text>
        <Text style={styles.stackItem}>4. Cache tuning — Counts 8 h TTL, OSRM 250 ms debounce, ±1 day prefetch (yesterday + next 5). ✓</Text>
        <Text style={styles.stackItem}>5. DaySlider dot fix — Delete meeting decrements count; Refresh forces refetch and clears stale dots (incl. web Refresh button). ✓</Text>
      </View>

      <Text style={styles.h2}>Phase 2: Progressive Map Loading — ~0.5 day ✓</Text>
      <View style={styles.stackList}>
        <Text style={styles.stackItem}>Show home marker immediately (already done)</Text>
        <Text style={styles.stackItem}>Last-session route cache in AsyncStorage → faded polyline while OSRM loads ✓</Text>
        <Text style={styles.stackItem}>OSRM in background; replace with fresh route when resolved ✓</Text>
        <Text style={styles.stackItem}>Haversine ETAs already used when OSRM not ready ✓</Text>
      </View>

      <Text style={styles.h2}>Phase 3: VPS Backend — Geocode + OSRM Cache — 2–3 days</Text>
      <Text style={styles.body}>Scope (explicitly NOT including Graph data):</Text>
      <View style={styles.stackList}>
        <Text style={styles.stackItem}>Include: POST /api/geocode (address → coordinates cache), POST /api/route (waypoints → OSRM polyline cache), GET/POST /api/user/state (completed IDs, custom order)</Text>
        <Text style={styles.stackItem}>Exclude: Microsoft Graph calendar caching; user PII/meeting content storage</Text>
        <Text style={styles.stackItem}>DB: geocode_cache (shared), osrm_routes (shared), user_app_state (user_id, completed_ids, day_order). Auth: Microsoft OAuth token validation (no new login)</Text>
      </View>
      <Text style={styles.body}>Estimated effort: 2–3 days. Risk: medium (new infra, isolated from user data).</Text>

      <Text style={styles.h2}>Phase 4: Multi-Device Sync (Optional) — 1–2 days</Text>
      <Text style={styles.body}>
        Once VPS exists: sync completed_ids and custom meeting order across devices; real-time via polling (e.g. 60 s) or WebSocket. Does NOT sync Graph data — app state only.
      </Text>

      <Text style={styles.h2}>Refinements & Boundaries</Text>
      <View style={styles.stackList}>
        <Text style={styles.stackItem}>VPS DB scope — Safe on VPS: geocode results, OSRM routes, user app state (completed IDs, order). Separate decision: caching Graph calendar data (PII/compliance).</Text>
        <Text style={styles.stackItem}>Meeting counts — On web already sync from localStorage; on native AsyncStorage is async. Win: use cached counts as soon as they resolve + extend TTL to 8 h.</Text>
        <Text style={styles.stackItem}>OSRM debounce — 250 ms recommended (not 200 ms) to avoid excess calls during rapid drag.</Text>
      </View>

      <Text style={styles.h2}>Recommended Order</Text>
      <Text style={styles.body}>
        Phase 1 and Phase 2 done. Next: Phase 3 (VPS backend + DB on new VPS). Then Phase 4 (multi-device sync) or Phase 5 (multi-calendar).
      </Text>

      <Text style={styles.h1}>SaaS & Backend Development Roadmap</Text>
      <Text style={styles.body}>
        Full schema and staged implementation (Option B). See docs/ROADMAP.md for the full roadmap and Decision Sheet.
      </Text>
      <Text style={styles.h2}>Phases (summary)</Text>
      <View style={styles.stackList}>
        <Text style={styles.stackItem}>Phase 3 — VPS backend: full schema, geocode + route + user state cache APIs (2–3 days)</Text>
        <Text style={styles.stackItem}>Phase 4 — Auth + tenant + entitlements core (users, auth_identities, orgs, roles)</Text>
        <Text style={styles.stackItem}>Phase 5 — Billing (Stripe, plans, subscriptions, webhooks, idempotency)</Text>
        <Text style={styles.stackItem}>Phase 6 — Admin panel MVP (admin.wiseplan.dk: plans, subs, promos, audit)</Text>
        <Text style={styles.stackItem}>Phase 7 — Multi-device sync (optional)</Text>
        <Text style={styles.stackItem}>Phase 8 — Usage metering, observability, backups, restore drills</Text>
      </View>
      <Text style={styles.body}>
        Locked: one org per user (v1); admin allowlist; email in DB (privacy policy + delete/export); geocode TTL 90d, route TTL 30d; paid status from webhooks only; entitlements enforced in backend.
      </Text>
    </View>
  );
}

function ArchitectureSection() {
  return (
    <View style={styles.section}>
      <Text style={styles.h1}>Architecture</Text>
      <View style={styles.stackList}>
        <Text style={styles.stackItem}>Expo — React Native app (this repo)</Text>
        <Text style={styles.stackItem}>Node.js on VPS — API and sync logic (Docker)</Text>
        <Text style={styles.stackItem}>PostgreSQL — Users, meetings, contacts, suggestions</Text>
        <Text style={styles.stackItem}>Mapbox Matrix API — Travel-time and distance matrix</Text>
        <Text style={styles.stackItem}>Microsoft Graph — Calendar and contacts (Outlook)</Text>
      </View>
      <Text style={styles.body}>
        Mobile talks to the Node backend; backend stores data in Postgres and
        calls Mapbox and Microsoft Graph as needed.
      </Text>
    </View>
  );
}

function LogicSpecsSection() {
  return (
    <View style={styles.section}>
      <Text style={styles.h1}>Logic Specs v3</Text>

      <Text style={styles.h2}>Goal</Text>
      <Text style={styles.body}>
        Minimize total driving distance when inserting a new meeting. Prefer days that
        already have meetings in the same geographic area. Preserve admin days — avoid
        creating single-meeting days when a compatible slot exists alongside other meetings.
        Home-to-first and last-to-home travel is included by default; field mode removes
        this assumption for workers who stay overnight.
      </Text>

      <Text style={styles.h2}>Tier System</Text>
      <View style={styles.ruleList}>
        <Text style={styles.ruleItem}>• Tier 1 – On Route: same day as meetings, detourKm ≤ 5 km</Text>
        <Text style={styles.ruleItem}>• Tier 2 – Nearby: same day, 5 km &lt; detourKm ≤ distanceThresholdKm</Text>
        <Text style={styles.ruleItem}>• Tier 3 – Over threshold: excluded; empty-day slot suggested instead</Text>
        <Text style={styles.ruleItem}>• Tier 4 – New Day: no other meetings that day. Only shown when no Tier 1/2 exist (admin-day protection).</Text>
      </View>

      <Text style={styles.h2}>Detour km (Primary Metric)</Text>
      <Text style={styles.body}>
        detourKm = d(prev→new) + d(new→next) − d(prev→next) using straight-line haversine.
        Empty day: 2 × d(home, newLoc). Rounds to 1 decimal.
      </Text>
      <Text style={styles.body}>
        Detour is a measure of the extra travel footprint added to your day by squeezing a new meeting into your existing schedule. It compares the day's route without the new meeting versus the route with the new meeting.
      </Text>
      <View style={styles.ruleList}>
        <Text style={styles.ruleItem}>• Without meeting: Home → Meeting A → Home = 20 km</Text>
        <Text style={styles.ruleItem}>• With new meeting: Home → Meeting A → Meeting B → Home = 45 km</Text>
        <Text style={styles.ruleItem}>• Detour: 45 - 20 = 25 km extra driving</Text>
      </View>
      <Text style={styles.body}>
        Max Same-Day Detour Distance (The Limit): If the detour exceeds this limit, the app considers it "too far out of the way" and dismisses the slot, looking for a day when you will naturally be closer.
      </Text>
      <Text style={styles.body}>
        Required Savings vs Empty Day (The Override): If a meeting has a massive detour (e.g., 50 km or +50 min) but going there on an empty day is even worse, the app checks the savings. If (Empty Day Travel − Detour) &gt; Far Detour Override, the meeting is approved. Units match your “Prefer Time or Distance” setting.
      </Text>

      <Text style={styles.h2}>Score Formula (v3)</Text>
      <View style={styles.ruleList}>
        <Text style={styles.ruleItem}>• base = detourKm × 10</Text>
        <Text style={styles.ruleItem}>• Smooth slack penalty (replaces old hard cliff at 10 min):</Text>
        <Text style={styles.ruleItem}>    slack &lt; 2 min → +5000 (truly impossible, no margin)</Text>
        <Text style={styles.ruleItem}>    slack 2–20 min → +200 / slack (smooth curve: ~100 at 2 min, ~10 at 20 min)</Text>
        <Text style={styles.ruleItem}>    slack &gt; 60 min → +(slack − 60) × 1.5 (mild penalty for long waits)</Text>
        <Text style={styles.ruleItem}>    slack 20–60 min → no penalty (ideal range)</Text>
        <Text style={styles.ruleItem}>• Busy day penalty: +15 per meeting on that day beyond 3 (prefer lighter days)</Text>
        <Text style={styles.ruleItem}>• Cross-day adjacency bonus: −20 if slot ends within 15 km of tomorrow's first meeting (field mode only; see below)</Text>
        <Text style={styles.ruleItem}>• Sort: tier asc → score asc → startMs asc → dayIso asc</Text>
        <Text style={styles.ruleItem}>• Empty week: dayIso asc → startMs asc (chronological)</Text>
        <Text style={styles.ruleItem}>• Primary metric: detourKm when “Prefer Distance”, detourMinutes when “Prefer Time”. detour base = detourKm×10 (km mode) or detourMinutes (time mode).</Text>
      </View>

      <Text style={styles.h2}>Gap Candidates (v3)</Text>
      <Text style={styles.body}>
        For each gap between timeline anchors, up to 4 candidate start times are generated
        instead of the old fixed 3 (earliest, +15, +30):
      </Text>
      <View style={styles.ruleList}>
        <Text style={styles.ruleItem}>• Earliest feasible (current behavior)</Text>
        <Text style={styles.ruleItem}>• +15 min from earliest</Text>
        <Text style={styles.ruleItem}>• +30 min from earliest</Text>
        <Text style={styles.ruleItem}>• Midpoint of the gap: (earliest + latestFeasible) / 2, snapped to 15-min grid. Gives balanced breathing room on both sides.</Text>
        <Text style={styles.ruleItem}>• Duplicates removed; all filtered to [earliest, latestFeasible]</Text>
      </View>

      <Text style={styles.h2}>Empty-Day Anchors (v3)</Text>
      <Text style={styles.body}>
        When the search window has no meetings at all, each working day now gets up to 3
        time-of-day options instead of a single "earliest possible":
      </Text>
      <View style={styles.ruleList}>
        <Text style={styles.ruleItem}>• Morning — earliest feasible (home + travel time)</Text>
        <Text style={styles.ruleItem}>• Midday — midpoint of the working day window</Text>
        <Text style={styles.ruleItem}>• Afternoon — latest feasible (work end − duration − postBuffer − travel home)</Text>
        <Text style={styles.ruleItem}>• Anchors within 30 min of each other are collapsed to avoid redundant suggestions</Text>
        <Text style={styles.ruleItem}>• All three pass the same feasibility checks (not in past, within working hours)</Text>
      </View>

      <Text style={styles.h2}>Best Options Selection (v3)</Text>
      <Text style={styles.body}>
        The top-3 "Best Options" banner now enforces one slot per unique calendar day,
        so the user sees genuinely different choices rather than three variants of the same gap:
      </Text>
      <View style={styles.ruleList}>
        <Text style={styles.ruleItem}>• Sort all slots by score (ascending)</Text>
        <Text style={styles.ruleItem}>• Pick best slot from Day A, best from Day B, best from Day C</Text>
        <Text style={styles.ruleItem}>• If fewer than 3 unique days, fill remaining slots from any day by score</Text>
      </View>

      <Text style={styles.h2}>Start and End from Home Base (Profile Toggle)</Text>
      <Text style={styles.body}>
        Profile → "Start and end from home base" (default: ON). Controls whether home-base
        travel time is included in the first and last gaps of the day.
      </Text>
      <View style={styles.ruleList}>
        <Text style={styles.ruleItem}>• ON (default, commute mode): earliest first meeting = workStart + travelFromHome; latest last meeting must end early enough to drive home before workEnd.</Text>
        <Text style={styles.ruleItem}>• OFF (field/overnight mode): first meeting can start at exactly workStart (no home travel deducted); last meeting can end at exactly workEnd (no return drive counted). For empty days: morning anchor = workStart, afternoon anchor = workEnd − duration − postBuffer.</Text>
        <Text style={styles.ruleItem}>• OFF also activates the cross-day adjacency bonus: slots ending within 15 km of the next working day's first meeting get a −20 score bonus, rewarding efficient field positioning.</Text>
        <Text style={styles.ruleItem}>• Today's "can you leave home now in time" safety check is preserved in both modes.</Text>
      </View>

      <Text style={styles.h2}>Hard Constraints (unchanged)</Text>
      <View style={styles.ruleList}>
        <Text style={styles.ruleItem}>• Meeting within work window: meetingStart ≥ workStart, meetingEnd ≤ workEnd</Text>
        <Text style={styles.ruleItem}>• No overlap: [meetingStart, meetingEnd] must not overlap ANY event (even without coords)</Text>
        <Text style={styles.ruleItem}>• No past: meetingStartMs ≥ now + preBuffer</Text>
        <Text style={styles.ruleItem}>• Today after working hours end → skip today entirely</Text>
        <Text style={styles.ruleItem}>• 15-min snap UP; if snapping breaks feasibility, discard</Text>
        <Text style={styles.ruleItem}>• Travel feasible between events; waived at day boundaries (Start/End anchors)</Text>
        <Text style={styles.ruleItem}>• Non-working days skipped entirely</Text>
      </View>

      <Text style={styles.h2}>Dismissal Checklist (Simple)</Text>
      <Text style={styles.body}>
        These are the same rule names shown in "Testing: Evaluated Slots" in Show all.
      </Text>
      <View style={styles.ruleList}>
        <Text style={styles.ruleItem}>
          {'• Working-hours window\n'}
          {'  Meetings must stay within your working hours, based on Return to base daily.\n'}
          {'  ON: Working hours include travel from home to the first meeting and from the last meeting back home.\n'}
          {'  OFF: Home travel is ignored at the start and end of the day, so the first meeting can start at work start and the last meeting can end at work end.\n'}
          {'  Examples:\n'}
          {'  ON: A meeting may be rejected even if it ends by 17:00, if the trip home would push the total day past working hours.\n'}
          {'  OFF: A meeting ending at 17:00 can still be valid, because the trip home is not counted.'}
        </Text>
        <Text style={styles.ruleItem}>
          • Not in the past: The meeting cannot start in a time that has already passed.
          Today safety: if leaving now plus travel plus buffer misses arrive-by, it is dismissed.
          Example: It is 10:05 now, so a 09:45 slot or any slot needing departure before now is dismissed.
        </Text>
        <Text style={styles.ruleItem}>
          • No overlap with existing meetings: Two meetings cannot occupy the same time.
          Example: Existing meeting 11:00-12:00, new slot 11:30-12:30 is dismissed.
        </Text>
        <Text style={styles.ruleItem}>
          • Travel + buffers feasible: You must be able to drive and still keep pre/post buffers (and return-home cutoff if Return to base daily is ON).
          Example: Arrival ETA is after required buffer time, or return-home ETA would miss work end, so the slot is dismissed.
        </Text>
        <Text style={styles.ruleItem}>
          • Gap can fit duration + buffers: The free gap must be big enough for travel + buffers + meeting.
          Example: Gap is 50 minutes but needs 80 minutes, so it is dismissed.
        </Text>
        <Text style={styles.ruleItem}>
          • Detour &lt;= [Max Same-Day Detour Distance] km or override &gt;= [Required Savings vs Empty Day] (min or km):
          Very far detours are blocked unless they save enough versus doing the meeting on an empty day.
          Example: Adds 40 km with 30 km limit and saves only 5 min when 20 min is required, so dismissed.
        </Text>
        <Text style={styles.ruleItem}>
          • Flexible-chain limits: If other meetings must move, those moves must stay within allowed flexibility and not overlap or move into the past.
          Example: Slot needs a 150 min shift but max allowed is 120 min, or the shifted chain would overlap, so dismissed.
        </Text>
      </View>

      <Text style={styles.h2}>Dismissal Rules Quick Table</Text>
      <View style={styles.ruleList}>
        <Text style={styles.ruleItem}>• Working-hours window — Must fit workday; Return-to-base ON counts home legs, OFF ignores them.</Text>
        <Text style={styles.ruleItem}>• Not in the past — Slot start can’t be before “now”; today also checks “leave now + travel + buffer”.</Text>
        <Text style={styles.ruleItem}>• No overlap — Slot must not collide with any existing meeting (even no-coords ones).</Text>
        <Text style={styles.ruleItem}>• Travel + buffers feasible — Pre/post buffers and travel (and return-home cutoff if ON) must fit.</Text>
        <Text style={styles.ruleItem}>• Gap can fit duration + buffers — Gap must be large enough for travel + buffers + duration.</Text>
        <Text style={styles.ruleItem}>• Detour &lt;= threshold or override &gt;= savings — Far slots need either low detour or enough savings vs empty day (minutes or km, matching preference).</Text>
        <Text style={styles.ruleItem}>• Flexible-chain limits — Required shifts must be within flex caps, not create overlap, not push into past.</Text>
      </View>

      <Text style={styles.h2}>Gap Formula (Buffer-Aware)</Text>
      <Text style={styles.body}>
        prevDepartMs = event.endMs + postBuffer (Start anchor: event.endMs only).
        nextArriveByMs = event.startMs − preBuffer (End anchor: event.startMs only).
        required = travelTo + preBuffer + duration + postBuffer + travelFrom (reduced at boundaries).
        Events without coords block time via homeBase coordinates.
      </Text>

      <Text style={styles.h2}>Travel Estimation</Text>
      <Text style={styles.body}>
        getTravelMinutes: haversine distance → road factor by distance (1.45× &lt;5 km,
        1.30× 5–20 km, 1.18× &gt;20 km) → speed by distance + rush hour (07–09, 15–18).
        Heuristic only; no live traffic. OSRM used for map route display and leg stats.
        OSRM results cached in AsyncStorage (24h TTL) and in-memory for the session.
      </Text>

      <Text style={styles.h2}>Ghost-Slot Timeline (Plan Visit)</Text>
      <Text style={styles.body}>
        Current flow: tap +, enter address → best match appears immediately with defaults (duration/flex/timeframe), map shows route, and “Find more options” reveals all slots.
      </Text>
      <View style={styles.ruleList}>
        <Text style={styles.ruleItem}>• Best Options: top 3, one per unique day (v3)</Text>
        <Text style={styles.ruleItem}>• By Day: merged timeline (real meetings + ghost slots)</Text>
        <Text style={styles.ruleItem}>• Best Match: next 14 days, clamp to today</Text>
        <Text style={styles.ruleItem}>• Pick Week: any week (This week, Next week, date picker); searchWindow = exact Mon–Sun</Text>
        <Text style={styles.ruleItem}>• Ghost slots appear between real meetings; tap → Confirm booking → creates CalendarEvent</Text>
        <Text style={styles.ruleItem}>• No past slots; 15-min grid snap; working-days filter; strict searchWindow (no leakage)</Text>
        <Text style={styles.ruleItem}>• dayIso always LOCAL via toLocalDayKey (never UTC)</Text>
        <Text style={styles.ruleItem}>• Contact save: checkbox in Confirm sheet; creates Outlook contact on Book</Text>
        <Text style={styles.ruleItem}>• Explain (DEV): (i) on ghost card shows prev/next, arriveBy, departAt, travelFeasible, constraints</Text>
      </View>

      <Text style={styles.h2}>Outlook Integration</Text>
      <View style={styles.ruleList}>
        <Text style={styles.ruleItem}>• Auth: offline_access for refresh token; JWT exp parsed locally on launch (no /me call if token valid)</Text>
        <Text style={styles.ruleItem}>• Scopes: User.Read, Calendars.ReadWrite, Contacts.ReadWrite</Text>
        <Text style={styles.ruleItem}>• Booking creates real Outlook event when permissions granted; local fallback otherwise</Text>
        <Text style={styles.ruleItem}>• Meeting Details: edit/delete sync to Outlook for Graph events</Text>
        <Text style={styles.ruleItem}>• Contact: checkbox in Confirm sheet; if checked + name/email, creates Outlook contact on Book</Text>
        <Text style={styles.ruleItem}>• Clear error when permissions missing (Calendars.ReadWrite, Contacts.ReadWrite)</Text>
      </View>

      <Text style={styles.h2}>Data Loading (Two-Phase)</Text>
      <View style={styles.ruleList}>
        <Text style={styles.ruleItem}>• Phase 1 (fast): Graph API fetch → map events synchronously using only Graph-provided coords → show list immediately</Text>
        <Text style={styles.ruleItem}>• Phase 2 (background): geocode addresses in parallel + enrich with contact addresses + contact info → update list in place</Text>
        <Text style={styles.ruleItem}>• Day cache stores enriched result; subsequent switches to same day are instant</Text>
        <Text style={styles.ruleItem}>• Next 5 days preloaded in background (raw → enrich) for instant switching</Text>
        <Text style={styles.ruleItem}>• Meeting counts (DaySlider ±30 days) use raw fetch only — no geocoding needed for counting</Text>
        <Text style={styles.ruleItem}>• searchContacts: session cache + in-flight dedup (same query = one HTTP request); $search fast-path then 500-item fallback</Text>
      </View>

      <Text style={styles.h2}>Schedule Screen UX</Text>
      <View style={styles.ruleList}>
        <Text style={styles.ruleItem}>• Tap meeting → Meeting Details → edit title, time, location, notes → Save updates schedule</Text>
        <Text style={styles.ruleItem}>• Done/Undone: check marks completed; persists in AsyncStorage</Text>
        <Text style={styles.ruleItem}>• Swipe left → Delete (with confirm); swipe right → Complete</Text>
        <Text style={styles.ruleItem}>• Arrow icon → opens native directions (Apple/Google Maps)</Text>
        <Text style={styles.ruleItem}>• Reorder mode: drag-and-drop (native) or up/down arrows (web); Save order persists; Re-optimize resets to route order</Text>
        <Text style={styles.ruleItem}>• DaySummaryBar: total drive time, distances, tight/late counts from OSRM leg stats</Text>
        <Text style={styles.ruleItem}>• Route recalculation debounced 350 ms to avoid cascade requests on rapid reorder</Text>
      </View>

      <Text style={styles.h2}>Profile Preferences</Text>
      <View style={styles.ruleList}>
        <Text style={styles.ruleItem}>• Home Base: geocoded address used as Start/End anchor for all route and slot calculations</Text>
        <Text style={styles.ruleItem}>• Start and end from home base (ON/OFF): see section above</Text>
        <Text style={styles.ruleItem}>• Pre/Post meeting buffers: used in gap formula and shown in slot cards</Text>
        <Text style={styles.ruleItem}>• Max Detour Distance: distanceThresholdKm (default 30 km)</Text>
        <Text style={styles.ruleItem}>• Working Hours + Working Days: slots never suggested outside these</Text>
        <Text style={styles.ruleItem}>• Google Maps API: optional; replaces Nominatim for address search and geocoding</Text>
      </View>

      <Text style={styles.h2}>Acceptance Checks</Text>
      <View style={styles.ruleList}>
        <Text style={styles.ruleItem}>• Sunday OFF → no suggestions on Sunday</Text>
        <Text style={styles.ruleItem}>• Next Week begins on next Monday</Text>
        <Text style={styles.ruleItem}>• Suggestions never in the past</Text>
        <Text style={styles.ruleItem}>• Map preview shows full route (Home → stops → Home) and fits bounds reliably</Text>
        <Text style={styles.ruleItem}>• Best Options always show slots from different days (never 3 variants of same gap)</Text>
        <Text style={styles.ruleItem}>• Empty-day search shows morning, midday and afternoon options per day</Text>
        <Text style={styles.ruleItem}>• Field mode: first meeting can start at workStart, last can end at workEnd</Text>
      </View>
    </View>
  );
}

function ScopesSection() {
  return (
    <View style={styles.section}>
      <Text style={styles.h1}>Auth & API Scopes</Text>
      <Text style={styles.body}>
        OAuth and API scopes requested by the app. These must match the app registration (e.g. Azure AD). Backend API scopes (api.wiseplan.dk) will be listed here once the VPS API is live.
      </Text>

      <Text style={styles.h2}>Microsoft (Azure AD / Microsoft Graph)</Text>
      <Text style={styles.body}>Used for sign-in and Outlook calendar/contacts. Defined in src/config/auth.ts (MS_SCOPES).</Text>
      <View style={styles.stackList}>
        {MS_SCOPES.map((scope) => (
          <View key={scope} style={styles.scopeRow}>
            <Text style={styles.scopeName}>{scope}</Text>
            <Text style={styles.body}>{SCOPE_PURPOSE[scope] ?? '—'}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.h2}>Backend API (api.wiseplan.dk)</Text>
      <View style={styles.scopeRow}>
        <Text style={styles.scopeName}>
          Backend Integration: {BACKEND_API_ENABLED ? 'Enabled' : 'Disabled'}
        </Text>
        <Text style={styles.body}>
          Base URL: {BACKEND_API_BASE_URL || '(not set)'}
        </Text>
      </View>
      <Text style={styles.body}>When the VPS backend is deployed, expected scope(s) for authenticated calls (e.g. Bearer token validation, optional scope for geocode/route/user-state endpoints). TBD in backend implementation.</Text>
    </View>
  );
}

function UISection() {
  const {
    showOldUI,
    setShowOldUI,
    mockMapStyleIndex,
    setMockMapStyleIndex,
    mockMapStyleCount,
    showQaDebug,
    setShowQaDebug,
  } = useDevUI();

  return (
    <View style={styles.section}>
      <Text style={styles.h1}>UI Controls</Text>
      <Text style={styles.body}>
        Development-only UI controls are centralized here so they do not cover the map or route list on the main Schedule screen.
      </Text>

      <View style={styles.uiCard}>
        <Text style={styles.h2}>Schedule UI Mode</Text>
        <Text style={styles.body}>
          Select which schedule implementation is used in the main app.
        </Text>
        <View style={styles.uiOptionsRow}>
          <TouchableOpacity
            style={[styles.uiOption, !showOldUI && styles.uiOptionActive]}
            onPress={() => setShowOldUI(false)}
            activeOpacity={0.8}
          >
            <Text style={[styles.uiOptionText, !showOldUI && styles.uiOptionTextActive]}>
              New UI
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.uiOption, showOldUI && styles.uiOptionActive]}
            onPress={() => setShowOldUI(true)}
            activeOpacity={0.8}
          >
            <Text style={[styles.uiOptionText, showOldUI && styles.uiOptionTextActive]}>
              Old UI
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.uiCard}>
        <Text style={styles.h2}>QA Debug Overlays</Text>
        <Text style={styles.body}>
          Toggle verbose slot/debug info in Add Meeting and related screens. Default is off; turn on only in QA/dev builds.
        </Text>
        <View style={styles.uiOptionsRow}>
          <TouchableOpacity
            style={[styles.uiOption, !showQaDebug && styles.uiOptionActive]}
            onPress={() => setShowQaDebug(false)}
            activeOpacity={0.8}
          >
            <Text style={[styles.uiOptionText, !showQaDebug && styles.uiOptionTextActive]}>
              Hidden
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.uiOption, showQaDebug && styles.uiOptionActive]}
            onPress={() => setShowQaDebug(true)}
            activeOpacity={0.8}
          >
            <Text style={[styles.uiOptionText, showQaDebug && styles.uiOptionTextActive]}>
              Visible
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.uiCard}>
        <Text style={styles.h2}>Mock Map Style</Text>
        <Text style={styles.body}>
          Choose the mock map style (1-{mockMapStyleCount}) used in empty-state map previews.
        </Text>
        <View style={styles.uiOptionsRow}>
          {Array.from({ length: mockMapStyleCount }).map((_, index) => {
            const selected = index === mockMapStyleIndex;
            return (
              <TouchableOpacity
                key={index}
                style={[styles.uiCircleOption, selected && styles.uiCircleOptionActive]}
                onPress={() => setMockMapStyleIndex(index)}
                activeOpacity={0.8}
              >
                <Text style={[styles.uiCircleOptionText, selected && styles.uiCircleOptionTextActive]}>
                  {index + 1}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
}

function QALogViewerSection() {
  const qaLog = useQALog();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!qaLog) {
    return (
      <View style={styles.section}>
        <Text style={styles.body}>QA Log not available.</Text>
      </View>
    );
  }

  const { entries, clearLog } = qaLog;
  const dayOrder = (slots: typeof entries[0]['slotsConsidered']) => {
    const days = [...new Set(slots.map((s) => s.dayIso))].sort();
    return days;
  };
  const slotsByDay = (slots: typeof entries[0]['slotsConsidered']) => {
    const byDay: Record<string, typeof slots> = {};
    for (const s of slots) {
      if (!byDay[s.dayIso]) byDay[s.dayIso] = [];
      byDay[s.dayIso].push(s);
    }
    return byDay;
  };

  return (
    <View style={styles.section}>
      <Text style={styles.h1}>QA Log – Meeting Creation</Text>
      <Text style={styles.body}>
        Each time you book a meeting via Plan Visit, a log is recorded: existing meetings at that moment, all slots considered (accepted or rejected), and why the best match was chosen.
      </Text>
      {entries.length > 0 && (
        <TouchableOpacity style={[styles.segment, { marginBottom: 16, alignSelf: 'flex-start' }]} onPress={clearLog}>
          <Text style={styles.segmentText}>Clear log</Text>
        </TouchableOpacity>
      )}
      {entries.length === 0 ? (
        <Text style={styles.body}>No entries yet. Create a meeting via Plan Visit to generate logs.</Text>
      ) : (
        entries.map((entry) => {
          const isExpanded = expandedId === entry.id;
          const byDay = slotsByDay(entry.slotsConsidered);
          return (
            <TouchableOpacity
              key={entry.id}
              style={styles.qaLogCard}
              onPress={() => setExpandedId(isExpanded ? null : entry.id)}
              activeOpacity={0.8}
            >
              <View style={styles.qaLogHeader}>
                <Text style={styles.qaLogTitle}>{entry.newMeeting.title}</Text>
                <Text style={styles.qaLogTime}>{entry.selectedSlot.dayLabel} {entry.selectedSlot.timeRange}</Text>
                <Text style={styles.qaLogMeta}>{entry.slotsConsidered.length} slots considered · {entry.slotsConsidered.filter((s) => s.status === 'accepted').length} accepted</Text>
              </View>
              {isExpanded && (
                <View style={styles.qaLogBody}>
                  <Text style={styles.qaLogH2}>New meeting</Text>
                  <Text style={styles.qaLogLine}>{entry.newMeeting.title} · {entry.newMeeting.durationMin} min · {entry.newMeeting.location || '-'}</Text>

                  <Text style={styles.qaLogH2}>Selected slot</Text>
                  <Text style={styles.qaLogLine}>{entry.selectedSlot.dayLabel} {entry.selectedSlot.timeRange}</Text>

                  {Object.keys(entry.existingByDay).length > 0 && (
                    <>
                      <Text style={styles.qaLogH2}>Existing meetings (at creation)</Text>
                      {Object.keys(entry.existingByDay).sort().map((day) => (
                        <View key={day} style={styles.qaLogDayBlock}>
                          <Text style={styles.qaLogDayLabel}>{day}</Text>
                          {(entry.existingByDay[day] ?? []).map((m, i) => (
                            <Text key={i} style={styles.qaLogLine}>  • {m.time} {m.title} · {m.location}</Text>
                          ))}
                        </View>
                      ))}
                    </>
                  )}

                  <Text style={styles.qaLogH2}>Slots considered (by day)</Text>
                  {dayOrder(entry.slotsConsidered).map((day) => (
                    <View key={day} style={styles.qaLogDayBlock}>
                      <Text style={styles.qaLogDayLabel}>{byDay[day][0]?.dayLabel ?? day}</Text>
                      {(byDay[day] ?? []).map((slot, i) => (
                        <View key={i} style={[styles.qaLogSlotRow, slot.status === 'rejected' && styles.qaLogSlotRejected]}>
                          <Text style={styles.qaLogSlotTime}>{slot.timeRange}</Text>
                          <Text style={[styles.qaLogSlotStatus, slot.status === 'accepted' ? styles.qaLogSlotAccepted : styles.qaLogSlotRejectedText]}>
                            {slot.status === 'accepted' ? '✓ OK' : '✗ ' + (slot.reason ?? 'rejected')}
                          </Text>
                          {slot.summary && <Text style={styles.qaLogSlotSummary}>{slot.summary}</Text>}
                          {slot.status === 'accepted' && (
                            <Text style={styles.qaLogSlotDetail}>
                              Detour: {slot.addToRouteMin != null ? (slot.addToRouteMin >= 0 ? `+${slot.addToRouteMin}` : `Saves ${-slot.addToRouteMin}`) : '-'} min
                              {slot.detourKm != null ? ` (${slot.detourKm} km)` : ''}
                              {slot.label ? ` · ${slot.label}` : ''}
                              {slot.prev && slot.next ? ` · ${slot.prev}→${slot.next}` : ''}
                            </Text>
                          )}
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              )}
            </TouchableOpacity>
          );
        })
      )}
    </View>
  );
}

function QASection() {
  const navigation = useNavigation();
  const { appointments, setAppointments, addAppointment, updateAppointment } = useRoute();
  const { getValidToken } = useAuth();
  const { preferences } = useUserPreferences();
  const [isCreatingSeedMeetings, setIsCreatingSeedMeetings] = useState(false);

  const runQA = () => {
    runFullQASuite();
    const overlapOk = runOverlapSanityCheck();
    const travelRes = runTravelFeasibilityQA();
    const fakeRes = runFakeMeetingsQA();
    const allPass = overlapOk && travelRes.pass && fakeRes.pass;
    Alert.alert(
      allPass ? 'QA Passed' : 'QA Failed',
      `Overlap: ${overlapOk ? 'PASS' : 'FAIL'}\nTravel: ${travelRes.message}\nFake meetings: ${fakeRes.message}`,
      [{ text: 'OK' }]
    );
  };

  const loadQAScenarioAndOpenPlanVisit = () => {
    const fakeSchedule = getFakeQASchedule();
    setAppointments(fakeSchedule);
    (navigation as { navigate: (name: string, params?: { screen: string }) => void }).navigate('Schedule', { screen: 'AddMeeting' });
    Alert.alert(
      'QA scenario loaded',
      'Fake meetings: Køge 09:00–10:00, Copenhagen 14:00–15:00 (tomorrow), Copenhagen 10:00–11:00 (D+1).\n\nGo to Plan Visit, pick Høje-Taastrup, 60 min, tap "Find best time". Best Match should NOT include 10:00 after Køge.',
      [{ text: 'OK' }]
    );
  };

  const createQaSeedMeetings = async () => {
    if (isCreatingSeedMeetings) return;
    setIsCreatingSeedMeetings(true);
    try {
      const token = await getValidToken();
      if (!token) {
        Alert.alert('Sign in required', 'You need an active account session before creating Outlook events.');
        return;
      }

      const rng = mulberry32(QA_GENERATOR_SEED);
      let workingSchedule = sortAppointmentsByStart(appointments);
      const created: string[] = [];
      const failed: string[] = [];

      for (let attempt = 1; attempt <= QA_SCHEDULER_MAX_ATTEMPTS && created.length < QA_SCHEDULER_BATCH_COUNT; attempt += 1) {
        try {
          const request = buildSchedulerQaRequest(attempt, workingSchedule, rng);
          const qaEntries: QASlotConsidered[] = [];
          const searchWindow = {
            start: new Date(),
            end: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
          };

          const allSlots = findSmartSlots({
            schedule: workingSchedule,
            newLocation: request.coord,
            durationMinutes: request.durationMinutes,
            preferences,
            searchWindow,
            clampSearchStartToToday: false,
            includeExplain: true,
            onSlotConsidered: (entry) => {
              qaEntries.push(entry);
            },
          });
          const rankedSlots = [...allSlots].sort(compareScoredSlots);
          const bestOptions = pickBestOptionsWithDayDiversity(rankedSlots, 3);
          const bestSlot = bestOptions[0] ?? null;
          if (!bestSlot) {
            failed.push(`${request.titleBase}: no valid slots. ${summarizeRejectedSlots(qaEntries).join(' | ')}`);
            continue;
          }

          const decisionCode = await allocateMeetingDecisionCode();
          const title = appendMeetingCodeSuffix(request.titleBase, decisionCode);
          const flexibleWindowTag = request.flexibleEnabled
            ? buildFlexibleWindowTag(bestSlot.startMs, request.flexBeforeMinutes, request.flexAfterMinutes)
            : null;
          let eventBody = composeEventBodyWithFlexibleWindow(
            `Generated by QA scheduler batch.\nLabel: ${request.locationLabel}\nAnchor: ${request.anchorTitle}\nRequest ${request.index}/${QA_SCHEDULER_BATCH_COUNT}`,
            flexibleWindowTag
          );
          eventBody = composeEventBodyWithDecisionCode(eventBody, decisionCode);

          const scheduleSnapshotBeforeBooking = sortAppointmentsByStart(workingSchedule);
          const shiftedEvents = bestSlot.explain?.shiftedEvents ?? [];
          let shiftFailed = false;

          for (const shift of shiftedEvents) {
            const existing = workingSchedule.find((event) => event.id === shift.id);
            if (!existing) continue;
            const newStartIso = new Date(shift.toStartMs).toISOString();
            const newEndIso = new Date(shift.toEndMs).toISOString();
            const newTime = `${formatClock(shift.toStartMs)} - ${formatClock(shift.toEndMs)}`;
            if (!existing.id.startsWith('local-')) {
              const updateResult = await retryGraphWrite(
                () =>
                  updateCalendarEvent(token, existing.id, {
                    startIso: newStartIso,
                    endIso: newEndIso,
                  }),
                (result) => result.success
              );
              if (!updateResult || !updateResult.success) {
                failed.push(`${title}: could not push ${shift.title} (${updateResult && 'error' in updateResult ? updateResult.error : 'Unknown error'})`);
                shiftFailed = true;
                break;
              }
            }
            updateAppointment(existing.id, {
              startIso: newStartIso,
              endIso: newEndIso,
              time: newTime,
            });
            workingSchedule = workingSchedule.map((event) =>
              event.id === existing.id
                ? { ...event, startIso: newStartIso, endIso: newEndIso, time: newTime }
                : event
            );
          }
          if (shiftFailed) {
            continue;
          }

          const proposedStartIso = new Date(bestSlot.startMs).toISOString();
          const proposedEndIso = new Date(bestSlot.endMs).toISOString();
          const proposedTime = `${formatClock(bestSlot.startMs)} - ${formatClock(bestSlot.endMs)}`;
          const createResult = await retryGraphWrite(
            () =>
              createCalendarEvent(token, {
                subject: title,
                startIso: proposedStartIso,
                endIso: proposedEndIso,
                location: request.locationForEvent,
                body: eventBody,
              }),
            (result) => result.success
          );
          if (!createResult || !createResult.success) {
            failed.push(`${title}: ${createResult && 'error' in createResult ? createResult.error : 'Unknown error'}`);
            continue;
          }

          const finalEvent: CalendarEvent = {
            ...('event' in createResult ? createResult.event : {}),
            id: 'event' in createResult ? createResult.event.id : `local-${Math.random().toString(36).substr(2, 9)}`,
            title,
            location: request.locationForEvent,
            startIso: proposedStartIso,
            endIso: proposedEndIso,
            time: proposedTime,
            notes: eventBody,
            bodyPreview: eventBody,
            coordinates: {
              latitude: request.coord.lat,
              longitude: request.coord.lon,
            },
            status: 'pending',
          };

          addAppointment(finalEvent);
          workingSchedule = sortAppointmentsByStart([...workingSchedule, finalEvent]);

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
          const actions: MeetingDecisionAction[] = [
            { atIso: new Date().toISOString(), type: 'auto-best', proposalId: slotId(bestSlot) },
            { atIso: new Date().toISOString(), type: 'book', proposalId: slotId(bestSlot) },
          ];
          const decisionEntry = await appendMeetingDecisionEntry({
            code: decisionCode,
            bookedMeeting: {
              eventId: finalEvent.id,
              title,
              titleBase: request.titleBase,
              location: request.locationForEvent,
              startIso: finalEvent.startIso ?? undefined,
              endIso: finalEvent.endIso ?? undefined,
            },
            searchInput: {
              locationLabel: request.locationLabel,
              locationForEvent: request.locationForEvent,
              locationCoords: request.coord,
              timeframeMode: 'best',
              durationMinutes: request.durationMinutes,
              flexibleMeetingEnabled: request.flexibleEnabled,
              flexBeforeMinutes: request.flexBeforeMinutes,
              flexAfterMinutes: request.flexAfterMinutes,
              searchWindowStartIso: searchWindow.start.toISOString(),
              searchWindowEndIso: searchWindow.end.toISOString(),
            },
            selected: {
              proposalId: slotId(bestSlot),
              dayIso: bestSlot.dayIso,
              startMs: bestSlot.startMs,
              endMs: bestSlot.endMs,
              bestBadgeProposalId: getBestBadgeSlotId(bestOptions),
            },
            ranking: {
              candidateCount: rankedSlots.length,
              orderedProposalIds: rankedSlots.map((candidate) => slotId(candidate)),
            },
            candidates: rankedCandidates,
            consideredSlots: mapConsideredSlots(qaEntries),
            existingMeetingsByDay: buildExistingMeetingsByDay(scheduleSnapshotBeforeBooking),
            actions,
          });
          if (BACKEND_API_ENABLED) {
            await backendAppendMeetingDecisionAudit(decisionEntry, token).catch(() => false);
          }

          created.push(`${title} · ${formatDayLabel(bestSlot.dayIso)} ${proposedTime}`);
        } catch (attemptError) {
          failed.push(
            `Attempt ${attempt}: ${attemptError instanceof Error ? attemptError.message : 'Unknown error'}`
          );
          continue;
        }
      }

      Alert.alert(
        failed.length === 0 ? 'Scheduler batch created' : 'Scheduler batch finished with issues',
        [
          `Created: ${created.length}`,
          failed.length > 0 ? `Failed: ${failed.length}` : null,
          '',
          'All created meetings were booked through the scheduler and written to the decision log.',
          'Titles start with "QA Sched". Refresh the calendar view if they do not appear immediately.',
          failed.length > 0 ? '' : null,
          failed.length > 0 ? failed.slice(0, 5).join('\n') : null,
        ].filter(Boolean).join('\n')
      );
    } catch (error) {
      if (error instanceof GraphUnauthorizedError) {
        Alert.alert('Session expired', 'Reconnect Outlook, then run the scheduler batch again.');
        return;
      }
      Alert.alert('Failed to create meetings', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsCreatingSeedMeetings(false);
    }
  };

  return (
    <View style={styles.section}>
      <Text style={styles.h1}>Scheduler QA</Text>
      <Text style={styles.body}>
        Run automated tests to verify the scheduler proposes only feasible, optimal slots.
        Save booking must never be blocked for scheduler-proposed slots.
      </Text>
      <Text style={styles.body}>
        • Overlap: no slot overlaps existing meetings (inc. no-coords, cross-midnight)
      </Text>
      <Text style={styles.body}>
        • Travel: Køge 09:00–10:00 → new at Høje-Taastrup must NOT propose 10:00 (need ~35m travel + 15m buffer)
      </Text>
      <TouchableOpacity style={[styles.segment, { marginTop: 16, alignSelf: 'flex-start' }]} onPress={runQA}>
        <Text style={styles.segmentText}>Run Scheduler QA</Text>
      </TouchableOpacity>
      <Text style={[styles.body, { marginTop: 24 }]}>
        Load fake meetings into the app and open Plan Visit to manually verify slots appear correct.
      </Text>
      <TouchableOpacity style={[styles.segment, { marginTop: 8, alignSelf: 'flex-start' }]} onPress={loadQAScenarioAndOpenPlanVisit}>
        <Text style={styles.segmentText}>Load QA scenario & open Plan Visit</Text>
      </TouchableOpacity>
      <Text style={[styles.body, { marginTop: 24 }]}>
        Create 20 real Outlook meetings through the scheduler. Each one uses the same `best match` logic as normal booking, applies pushers if needed, and writes a full decision log.
      </Text>
      <TouchableOpacity
        style={[styles.segment, { marginTop: 8, alignSelf: 'flex-start', opacity: isCreatingSeedMeetings ? 0.7 : 1 }]}
        onPress={() => { void createQaSeedMeetings(); }}
        disabled={isCreatingSeedMeetings}
      >
        <Text style={styles.segmentText}>{isCreatingSeedMeetings ? 'Creating scheduler batch...' : 'Create 20 scheduler-booked meetings'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  segmentedScroll: {
    maxHeight: 48,
    marginHorizontal: 12,
    marginTop: 12,
    marginBottom: 8,
  },
  segmentedContent: {
    paddingHorizontal: 4,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  segment: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#e2e8f0',
    marginRight: 8,
  },
  segmentActive: {
    backgroundColor: MS_BLUE,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  segmentTextActive: {
    color: '#fff',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  versionBar: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#E8F4FC',
    borderBottomWidth: 1,
    borderBottomColor: '#0078D4',
  },
  versionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0078D4',
  },
  buildTag: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 24,
    marginBottom: 8,
  },
  section: {
    marginBottom: 24,
  },
  uiCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dbe5f1',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  uiOptionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  uiOption: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#e2e8f0',
  },
  uiOptionActive: {
    backgroundColor: MS_BLUE,
  },
  uiOptionText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  uiOptionTextActive: {
    color: '#ffffff',
  },
  uiCircleOption: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e2e8f0',
  },
  uiCircleOptionActive: {
    backgroundColor: MS_BLUE,
  },
  uiCircleOptionText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  uiCircleOptionTextActive: {
    color: '#ffffff',
  },
  h1: {
    fontSize: 22,
    fontWeight: '700',
    color: MS_BLUE,
    marginBottom: 16,
  },
  h2: {
    fontSize: 17,
    fontWeight: '700',
    color: MS_BLUE,
    marginTop: 16,
    marginBottom: 8,
  },
  body: {
    fontSize: 15,
    lineHeight: 24,
    color: '#334155',
    marginBottom: 12,
  },
  stackList: {
    marginBottom: 12,
  },
  stackItem: {
    fontSize: 15,
    lineHeight: 24,
    color: '#334155',
    marginBottom: 6,
    paddingLeft: 8,
    borderLeftWidth: 3,
    borderLeftColor: MS_BLUE,
  },
  scopeRow: {
    marginBottom: 16,
    paddingLeft: 8,
    borderLeftWidth: 3,
    borderLeftColor: MS_BLUE,
  },
  scopeName: {
    fontSize: 15,
    fontWeight: '700',
    color: MS_BLUE,
    marginBottom: 4,
  },
  ruleList: {
    marginBottom: 12,
  },
  ruleItem: {
    fontSize: 15,
    lineHeight: 24,
    color: '#334155',
    marginBottom: 4,
  },
  qaLogCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 12,
    overflow: 'hidden',
  },
  qaLogHeader: {
    padding: 12,
  },
  qaLogTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1e293b',
  },
  qaLogTime: {
    fontSize: 14,
    color: MS_BLUE,
    marginTop: 4,
  },
  qaLogMeta: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
  },
  qaLogBody: {
    padding: 12,
    paddingTop: 0,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  qaLogH2: {
    fontSize: 13,
    fontWeight: '700',
    color: MS_BLUE,
    marginTop: 12,
    marginBottom: 6,
  },
  qaLogLine: {
    fontSize: 13,
    color: '#334155',
    marginBottom: 2,
  },
  qaLogDayBlock: {
    marginBottom: 8,
  },
  qaLogDayLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 4,
  },
  qaLogSlotRow: {
    backgroundColor: '#f8fafc',
    padding: 8,
    borderRadius: 6,
    marginBottom: 6,
  },
  qaLogSlotRejected: {
    backgroundColor: '#fef2f2',
  },
  qaLogSlotTime: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1e293b',
  },
  qaLogSlotStatus: {
    fontSize: 12,
    marginTop: 2,
  },
  qaLogSlotAccepted: {
    color: '#059669',
  },
  qaLogSlotRejectedText: {
    color: '#dc2626',
  },
  qaLogSlotSummary: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
  },
  qaLogSlotDetail: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
});
