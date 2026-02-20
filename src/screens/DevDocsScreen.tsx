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

const MS_BLUE = '#0078D4';

type Section = 'User Story' | 'Roadmap' | 'Architecture' | 'Logic Specs' | 'Telegram VPS' | 'QA' | 'QA Log';

const SECTIONS: Section[] = [
  'User Story',
  'Roadmap',
  'Architecture',
  'Logic Specs',
  'Telegram VPS',
  'QA',
  'QA Log',
];

export default function DevDocsScreen() {
  const [section, setSection] = useState<Section>('User Story');

  return (
    <View style={styles.container}>
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
        {section === 'Telegram VPS' && <TelegramVpsSection />}
        {section === 'QA' && <QASection />}
        {section === 'QA Log' && <QALogViewerSection />}
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
        RouteCopilot doesn’t just look for “empty slots” in his calendar. It
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

      <Text style={styles.h2}>Phase 7: Smart Scheduling (Current)</Text>
      <Text style={styles.body}>
        Pre- and post-meeting buffers: preBuffer reserves minutes before a meeting
        (parking, check-in); postBuffer reserves minutes after (overrun, wrap-up).
        Both are configurable in Profile.
      </Text>
      <Text style={styles.body}>
        Plan Visit uses a gated setup→results flow: location, duration (30/60/90),
        timeframe (Best Match / Pick Week), CTA "Find best time". Results only after
        CTA: Best Options + By Day merged timeline. Best Match = 14 days; Pick Week =
        any week (This week, Next week, date picker). Strict searchWindow filtering.
        Scheduler: no past slots, 15-min grid, empty week = earliest days first.
      </Text>
      <Text style={styles.body}>
        ETA is heuristic for now: haversine distance, road factor by distance,
        and speed buckets by time-of-day (rush vs non-rush). No traffic API yet.
      </Text>

      <Text style={styles.h2}>Phase 7C: Real ETA (Later)</Text>
      <Text style={styles.body}>
        Integrate a traffic/routing API (e.g. Mapbox, Google Directions) for
        real driving times and distances. Replace heuristic ETA with live or
        cached route data when offline-capable.
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
      <Text style={styles.h1}>Logic Specs v2</Text>

      <Text style={styles.h2}>Goal</Text>
      <Text style={styles.body}>
        Minimize total driving distance when inserting a new meeting. Preserve admin days —
        avoid creating single-meeting days when a geographically compatible slot exists on a day
        with other meetings. Home to first meeting and last meeting to home are both included.
      </Text>

      <Text style={styles.h2}>Tier System</Text>
      <View style={styles.ruleList}>
        <Text style={styles.ruleItem}>• Tier 1 – On Route: same day as meetings, detourKm ≤ 5 km</Text>
        <Text style={styles.ruleItem}>• Tier 2 – Nearby: same day, 5 km &lt; detourKm ≤ distanceThresholdKm</Text>
        <Text style={styles.ruleItem}>• Tier 3 – Over threshold: detourKm &gt; threshold → excluded; empty day suggested instead</Text>
        <Text style={styles.ruleItem}>• Tier 4 – New Day: empty day, round-trip from home. Only shown when no Tier 1/2 exist (admin-day protection).</Text>
      </View>

      <Text style={styles.h2}>Distance Threshold (Profile)</Text>
      <Text style={styles.body}>
        distanceThresholdKm (default 30 km, Profile → Max Detour Distance). Same-day slots with
        detour &gt; threshold are skipped; empty day suggested instead.
      </Text>

      <Text style={styles.h2}>Detour km (Primary Metric)</Text>
      <Text style={styles.body}>
        detourKm = haversineKm(prev, newLoc) + haversineKm(newLoc, next) - haversineKm(prev, next).
        Empty day: 2 × haversineKm(home, newLoc).
      </Text>

      <Text style={styles.h2}>Score &amp; Ranking (within tier)</Text>
      <View style={styles.ruleList}>
        <Text style={styles.ruleItem}>• score = detourKm × 10 + slackPenalty</Text>
        <Text style={styles.ruleItem}>• slack &lt;10: +5000; slack 10–90: 0; slack &gt;90: +(slack−90)×2</Text>
        <Text style={styles.ruleItem}>• Sort: tier asc, score asc, startMs asc, dayIso asc</Text>
        <Text style={styles.ruleItem}>• Empty week: dayIso asc, startMs asc</Text>
        <Text style={styles.ruleItem}>• "On Route" badge: detourKm ≤ 5</Text>
      </View>

      <Text style={styles.h2}>Hard Constraints (slot discarded if any fails)</Text>
      <View style={styles.ruleList}>
        <Text style={styles.ruleItem}>• Meeting within work window: meetingStart ≥ workStart, meetingEnd ≤ workEnd</Text>
        <Text style={styles.ruleItem}>• Day-boundary waiver: first meeting may start at workStart; last may end at workEnd</Text>
        <Text style={styles.ruleItem}>• No overlap: [meetingStart, meetingEnd] must not overlap ANY event (even without coords)</Text>
        <Text style={styles.ruleItem}>• No past: meetingStartMs ≥ now + preBuffer</Text>
        <Text style={styles.ruleItem}>• Today after working hours end → skip today entirely</Text>
        <Text style={styles.ruleItem}>• 15-min snap UP; if snapping breaks feasibility, discard</Text>
        <Text style={styles.ruleItem}>• Travel feasible between events (waived at day boundaries)</Text>
      </View>

      <Text style={styles.h2}>Gap Formula (Buffer-Aware)</Text>
      <Text style={styles.body}>
        prevDepartMs = Prev.endMs + postBuffer (Start: prev.endMs). nextArriveByMs = Next.startMs − preBuffer (End: next.startMs).
        required = travelTo + preBuffer + duration + postBuffer + travelFrom (reduced at boundaries). Events without coords block time via homeBase.
      </Text>

      <Text style={styles.h2}>Gap-Based Search</Text>
      <Text style={styles.body}>
        Scans gaps between timeline anchors (Start, events, End). For each gap
        checks if required time fits, computes detourKm, assigns tier, excludes
        Tier 3 (over threshold). Travel uses getTravelMinutes (haversine +
        road factor + rush-hour speed).
      </Text>

      <Text style={styles.h2}>Ghost-Slot Timeline (Plan Visit)</Text>
      <Text style={styles.body}>
        Plan Visit is a gated setup→results flow. Setup state: location, duration
        (30/60/90), timeframe, CTA "Find best time". Results only after CTA press.
      </Text>
      <View style={styles.ruleList}>
        <Text style={styles.ruleItem}>• Setup: location search, duration pills, timeframe (Best Match / Pick Week), CTA button</Text>
        <Text style={styles.ruleItem}>• Results (post-CTA): Best Options (top 3), By Day merged timeline (real meetings + ghost slots)</Text>
        <Text style={styles.ruleItem}>• Best Match: next 14 days; best = minimal detour, then earlier</Text>
        <Text style={styles.ruleItem}>• Pick Week: any week (This week, Next week, date picker); searchWindow = exact Mon–Sun</Text>
        <Text style={styles.ruleItem}>• Empty week: suggest every working day at earliest start; Best Options = earliest days first</Text>
        <Text style={styles.ruleItem}>• Location search: contacts + address suggestions; dropdown stable (no flicker); onPressIn for reliable tap; keyboardShouldPersistTaps; requestId avoids stale results</Text>
        <Text style={styles.ruleItem}>• Ghost slots appear between real meetings; tap opens Confirm booking; Book creates CalendarEvent</Text>
        <Text style={styles.ruleItem}>• No past slots; 15-min grid snap; working-days filter; strict searchWindow (no leakage)</Text>
        <Text style={styles.ruleItem}>• Day keys (dayIso): always LOCAL time via toLocalDayKey; never UTC (toISOString) for grouping/filtering</Text>
        <Text style={styles.ruleItem}>• Contact save: checkbox "Also save as Outlook contact when booking"; button shows "Book meeting + Save contact" when enabled; explicit success/failure feedback after book</Text>
        <Text style={styles.ruleItem}>• Home Base in Profile for route preview; map includes Home → stops → Home</Text>
        <Text style={styles.ruleItem}>• Explain (DEV): (i) on ghost card shows prev/next, arriveBy, departAt, travelFeasible, constraints; Best Options show date+time</Text>
      </View>
      <Text style={styles.h2}>Outlook Integration</Text>
      <View style={styles.ruleList}>
        <Text style={styles.ruleItem}>• Auth: offline_access for refresh token; session persists across restarts</Text>
        <Text style={styles.ruleItem}>• Scopes: User.Read, Calendars.ReadWrite, Contacts.ReadWrite</Text>
        <Text style={styles.ruleItem}>• Booking creates real Outlook event when permissions granted; local fallback otherwise</Text>
        <Text style={styles.ruleItem}>• Meeting Details: edit/delete sync to Outlook for Graph events</Text>
        <Text style={styles.ruleItem}>• Contact: checkbox in Confirm sheet; if checked + name/email, creates Outlook contact on Book; success/failure feedback; meeting never blocked</Text>
        <Text style={styles.ruleItem}>• Dev: "Restore session" button (__DEV__ only) to revalidate stored token</Text>
        <Text style={styles.ruleItem}>• Clear error when permissions missing (Calendars.ReadWrite, Contacts.ReadWrite)</Text>
      </View>

      <Text style={styles.h2}>Schedule Screen UX</Text>
      <View style={styles.ruleList}>
        <Text style={styles.ruleItem}>• Tap meeting → Meeting Details → edit title, time, location, notes → Save updates schedule</Text>
        <Text style={styles.ruleItem}>• Done/Undone: check marks completed; tap again to uncheck; persists in AsyncStorage</Text>
        <Text style={styles.ruleItem}>• Swipe left → Delete (with confirm) → removes meeting locally</Text>
        <Text style={styles.ruleItem}>• Arrow icon → opens native directions (Apple/Google Maps) to that meeting</Text>
      </View>

      <Text style={styles.h2}>Acceptance Checks</Text>
      <View style={styles.ruleList}>
        <Text style={styles.ruleItem}>• Sunday OFF → no suggestions on Sunday</Text>
        <Text style={styles.ruleItem}>• Next Week begins on next Monday</Text>
        <Text style={styles.ruleItem}>• Suggestions never in the past</Text>
        <Text style={styles.ruleItem}>• Map preview always shows full route (Home → stops → Home) and fits reliably</Text>
      </View>
      <Text style={styles.body}>
        Profile preferences (preMeetingBuffer, postMeetingBuffer, distanceThresholdKm)
        are used throughout the scheduler and reflected in the UI ("arrive by",
        "depart at", Max Detour Distance in the expandable info).
      </Text>

      <Text style={styles.h2}>Location Search (Plan Visit)</Text>
      <Text style={styles.body}>
        Location search combines Outlook contacts and address suggestions in one dropdown.
        When the user types, both searchContacts (Graph) and getAddressSuggestions (geocoding)
        run in parallel. Contacts with addresses are shown first; then address suggestions.
        User selects a contact (geocoded to coords) or address. There is no proactive
        suggestion of contacts based on geographic clusters or existing meetings.
      </Text>
    </View>
  );
}

function TelegramVpsSection() {
  return (
    <View style={styles.section}>
      <Text style={styles.h1}>Editing Code on the VPS via Telegram</Text>
      <Text style={styles.body}>
        How we work on the repo from the VPS using the Telegram bot, and how secrets are stored. Full doc: docs/TELEGRAM_VPS_WORKFLOW.md
      </Text>

      <Text style={styles.h2}>How we edit code on the VPS via Telegram</Text>
      <View style={styles.stackList}>
        <Text style={styles.stackItem}>Bot lives in telegram-bot/. On the VPS: clone repo, cd telegram-bot && npm start. Bot runs tools from repo root (git, EAS, shell).</Text>
        <Text style={styles.stackItem}>Send natural-language messages (e.g. "git status", "commit and push with message: fix map", "bump iOS build and submit to TestFlight"). LLM (default Gemini) picks tools and runs them; bot replies with outcome.</Text>
        <Text style={styles.stackItem}>The bot does not edit source by itself — it runs shell, git, EAS. Edit locally or on GitHub; use the bot to pull, build, submit when away.</Text>
        <Text style={styles.stackItem}>Flow when away: open Telegram → "Pull latest and run prepare:vps" or "Bump iOS build, EAS build, submit TestFlight" → bot runs tools and reports back.</Text>
      </View>

      <Text style={styles.h2}>How secrets are stored</Text>
      <Text style={styles.body}>All bot/LLM secrets in telegram-bot/.env (not in git):</Text>
      <View style={styles.ruleList}>
        <Text style={styles.ruleItem}>TELEGRAM_BOT_TOKEN (from @BotFather), TELEGRAM_ALLOWED_CHAT_IDS (optional), LLM_PROVIDER, one of GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY</Text>
      </View>
      <Text style={styles.body}>Git (GitHub): SSH key or personal access token on the VPS only; not in repo.</Text>
      <Text style={styles.body}>EAS/Expo/Apple: eas login or EXPO_TOKEN on VPS; Apple ID / app-specific password in EAS or EXPO_APPLE_APP_SPECIFIC_PASSWORD. All on VPS only.</Text>
      <Text style={styles.body}>Nothing secret is committed; everything stays on the VPS (and EAS where applicable).</Text>
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
  const { setAppointments } = useRoute();

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
  section: {
    marginBottom: 24,
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
