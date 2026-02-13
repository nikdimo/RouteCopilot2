import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { startOfDay } from 'date-fns';
import { Alert } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useRoute } from '../context/RouteContext';
import { useUserPreferences } from '../context/UserPreferencesContext';
import {
  findSmartSlots,
  slotId,
  type ScoredSlot,
  type Coordinate,
  type QASlotConsidered,
} from '../utils/scheduler';
import { useQALog } from '../context/QALogContext';
import { toLocalDayKey } from '../utils/dateUtils';
import { geocodeAddress, geocodeContactAddress, getAddressSuggestions } from '../utils/geocoding';
import { searchContacts } from '../services/graph';
import TimeframeSelector, {
  getSearchWindow,
  type TimeframeSelection,
} from '../components/TimeframeSelector';
import DayTimeline, { buildTimelineEntries } from '../components/DayTimeline';
import GhostSlotCard from '../components/GhostSlotCard';
import MapPreviewModal from '../components/MapPreviewModal';
import ConfirmBookingSheet, { type ContactInput } from '../components/ConfirmBookingSheet';
import LocationSearch, {
  type LocationSelection,
} from '../components/LocationSearch';
import {
  createCalendarEvent,
  createContact,
  getCalendarEvents,
  GraphUnauthorizedError,
  type CalendarEvent,
} from '../services/graph';
import { sortAppointmentsByTime } from '../utils/optimization';
import { DEFAULT_HOME_BASE } from '../types';

const MS_BLUE = '#0078D4';
const MS_PER_MIN = 60_000;

function toCoord(ev: CalendarEvent): Coordinate | null {
  const c = ev.coordinates;
  if (!c || typeof c.latitude !== 'number' || typeof c.longitude !== 'number') return null;
  return { lat: c.latitude, lon: c.longitude };
}

const DURATION_OPTS = [30, 60, 90] as const;

function formatDayLabel(dayIso: string): string {
  const [y, mo, d] = dayIso.split('-').map((x) => parseInt(x, 10));
  const date = new Date(y, mo - 1, d);
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
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

/** Pick top 3 with variety: lowest detour, safest slack, best score (day with meetings) */
function pickBestOptions(slots: ScoredSlot[]): ScoredSlot[] {
  if (slots.length === 0) return [];
  if (slots.length <= 3) return [...slots];

  const byScore = [...slots].sort((a, b) => a.score - b.score);
  const byDetour = [...slots].sort((a, b) => a.metrics.detourMinutes - b.metrics.detourMinutes);
  const bySlack = [...slots].sort((a, b) => b.metrics.slackMinutes - a.metrics.slackMinutes);

  const seen = new Set<string>();
  const result: ScoredSlot[] = [];

  for (const slot of byScore) {
    const id = slotId(slot);
    if (!seen.has(id)) {
      seen.add(id);
      result.push(slot);
      if (result.length >= 3) return result;
    }
  }
  for (const slot of byDetour) {
    const id = slotId(slot);
    if (!seen.has(id)) {
      seen.add(id);
      result.push(slot);
      if (result.length >= 3) return result;
    }
  }
  for (const slot of bySlack) {
    const id = slotId(slot);
    if (!seen.has(id)) {
      seen.add(id);
      result.push(slot);
      if (result.length >= 3) return result;
    }
  }

  return result;
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
  const { appointments, addAppointment } = useRoute();
  const { preferences } = useUserPreferences();

  const [locationSelection, setLocationSelection] = useState<LocationSelection>({ type: 'none' });
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [timeframe, setTimeframe] = useState<TimeframeSelection>({ mode: 'anytime' });
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [mapSlot, setMapSlot] = useState<ScoredSlot | null>(null);
  const [confirmSlot, setConfirmSlot] = useState<ScoredSlot | null>(null);
  const [devDebug, setDevDebug] = useState<Record<string, unknown>>({});
  const [devPanelCollapsed, setDevPanelCollapsed] = useState(true);
  const [searchAppointments, setSearchAppointments] = useState<CalendarEvent[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const qaLog = useQALog();
  const qaEntriesRef = React.useRef<QASlotConsidered[]>([]);

  const searchWindow = useMemo(() => getSearchWindow(timeframe), [timeframe]);

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
      clampSearchStartToToday: timeframe.mode === 'anytime',
      includeExplain: __DEV__,
      onSlotConsidered: __DEV__ && qaLog
        ? (e) => { qaEntriesRef.current.push(e); }
        : undefined,
    });
  }, [hasSearched, scheduleForSearch, newLocation, durationMinutes, preferences, searchWindow, timeframe.mode, qaLog]);

  const bestOptions = useMemo(() => pickBestOptions(allSlots), [allSlots]);
  const bestOptionIds = useMemo(
    () => new Set(bestOptions.map((s) => slotId(s))),
    [bestOptions]
  );

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

  const handleFindBestTime = async () => {
    if (!canFindBestTime) return;
    setHasSearched(true);
    setSearchLoading(true);
    setSearchAppointments(null);
    const token = userToken ?? (getValidToken ? await getValidToken() : null);
    if (!token) {
      setSearchLoading(false);
      return;
    }
    try {
      const { start, end } = searchWindow;
      const events = await getCalendarEvents(token, start, end);
      const enriched = await enrichAppointmentsWithCoords(events, async (addr) => {
        const r = await geocodeAddress(addr);
        return { success: r.success, lat: r.success ? r.lat : undefined, lon: r.success ? r.lon : undefined };
      });
      const sorted = sortAppointmentsByTime(enriched);
      setSearchAppointments(sorted);
    } catch (e) {
      if (e instanceof GraphUnauthorizedError) {
        signOut();
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

  // Reset results when user changes inputs (must press CTA again)
  useEffect(() => {
    setHasSearched(false);
    setSearchAppointments(null);
  }, [locationSelection, durationMinutes, timeframe]);

  const handleSelectSlot = (slot: ScoredSlot) => {
    setSelectedSlotId(slotId(slot));
    setConfirmSlot(slot);
  };

  const handleMapPress = (slot: ScoredSlot) => {
    setMapSlot(slot);
  };

  const handleConfirmBooking = async (
    event: CalendarEvent,
    contactInput?: ContactInput
  ) => {
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
    if (token && isLocalId) {
      const proposedStartIso = finalEvent.startIso!;
      const proposedEndIso = finalEvent.endIso!;
      const proposedTime = finalEvent.time;
      const result = await createCalendarEvent(token, {
        subject: finalEvent.title,
        startIso: proposedStartIso,
        endIso: proposedEndIso,
        location: finalEvent.location,
        body: finalEvent.notes,
      });
      if (result.success) {
        // Preserve proposed times; Graph may return different format causing display shift
        finalEvent = { ...result.event, startIso: proposedStartIso, endIso: proposedEndIso, time: proposedTime };
      } else {
        if (result.needsConsent) {
          Alert.alert(
            'Permission needed',
            'Grant Calendars.ReadWrite in your Microsoft account to sync to Outlook. Saved locally for now.',
            [{ text: 'OK' }]
          );
        } else {
          Alert.alert(
            'Calendar sync failed',
            result.error,
            [{ text: 'OK' }]
          );
        }
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

    addAppointment(finalEvent);
    setSelectedSlotId(null);
    setConfirmSlot(null);
    navigation.goBack();

    if (token && contactInput && (contactInput.displayName || contactInput.email)) {
      const contactResult = await createContact(token, {
        displayName: contactInput.displayName ?? contactInput.email,
        companyName: contactInput.companyName,
        businessPhones: contactInput.businessPhone ? [contactInput.businessPhone] : undefined,
        emailAddresses: contactInput.email ? [{ address: contactInput.email }] : undefined,
      });
      if (contactResult.success) {
        Alert.alert('Contact saved', 'Contact saved to Outlook.');
      } else {
        Alert.alert(
          'Meeting saved',
          contactResult.needsConsent
            ? 'Could not save contact (permission needed). Grant Contacts.ReadWrite to sync contacts to Outlook.'
            : `Could not save contact: ${contactResult.error ?? 'Unknown error'}. Meeting was saved.`,
          [{ text: 'OK' }]
        );
      }
    }
  };

  const token = userToken ?? null;

  return (
    <View style={styles.container}>
      <LocationSearch
        token={token}
        searchContacts={async (t, q) => {
          const r = await searchContacts(t, q);
          return {
            success: r.success,
            contacts: r.success ? r.contacts : undefined,
            error: !r.success ? r.error : undefined,
            needsConsent: !r.success ? r.needsConsent : undefined,
          };
        }}
        getAddressSuggestions={async (q) => {
          const r = await getAddressSuggestions(q);
          return {
            success: r.success,
            suggestions: r.success ? r.suggestions : undefined,
            error: !r.success ? r.error : undefined,
          };
        }}
        geocodeAddress={async (addr) => {
          const r = await geocodeAddress(addr);
          return {
            success: r.success,
            lat: r.success ? r.lat : undefined,
            lon: r.success ? r.lon : undefined,
            fromCache: r.success ? r.fromCache : undefined,
            error: !r.success ? r.error : undefined,
          };
        }}
        geocodeContactAddress={async (addr, parts) => {
          const r = await geocodeContactAddress(addr, parts);
          return {
            success: r.success,
            lat: r.success ? r.lat : undefined,
            lon: r.success ? r.lon : undefined,
            fromCache: r.success ? r.fromCache : undefined,
            error: !r.success ? r.error : undefined,
          };
        }}
        selection={locationSelection}
        onSelectionChange={setLocationSelection}
        onGraphError={handleGraphError}
        placeholder="Search Client or Address (e.g. Nikola, Køge)"
        onDebug={__DEV__ ? handleLocationDebug : undefined}
      />

      <View style={styles.durationRow}>
        <Text style={styles.durationLabel}>Duration</Text>
        <View style={styles.durationPills}>
          {DURATION_OPTS.map((d) => (
            <TouchableOpacity
              key={d}
              style={[
                styles.durationPill,
                durationMinutes === d && styles.durationPillActive,
              ]}
              onPress={() => setDurationMinutes(d)}
            >
              <Text
                style={[
                  styles.durationPillText,
                  durationMinutes === d && styles.durationPillTextActive,
                ]}
              >
                {d} min
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <TimeframeSelector selected={timeframe} onSelect={setTimeframe} />

      <TouchableOpacity
        style={[
          styles.ctaButton,
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
                  Appointments: {filteredAppointments.length} (missing coords: {filteredAppointments.filter((a) => !a.coordinates || typeof a.coordinates?.latitude !== 'number').length}) | Slots: {allSlots.length}
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

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
        keyboardShouldPersistTaps="handled"
      >
        {!hasSearched ? (
          <View style={styles.setupState}>
            <Text style={styles.setupHint}>
              {canFindBestTime
                ? 'Tap "Find best time" to see slots.'
                : 'Select a location (contact or address) to see best slots.'}
            </Text>
          </View>
        ) : searchLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color={MS_BLUE} />
            <Text style={styles.loadingText}>Loading your schedule…</Text>
          </View>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Best Options</Text>
            {bestOptions.length === 0 ? (
              <Text style={styles.emptyHint}>
                No slots found. Try a different timeframe or client.
              </Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.bestOptionsRow}
                style={styles.bestOptionsScroll}
              >
                {bestOptions.map((slot) => (
                  <View key={slotId(slot)} style={styles.bestOptionCard}>
                    <GhostSlotCard
                      slot={slot}
                      preBuffer={preBuffer}
                      postBuffer={postBuffer}
                      isSelected={selectedSlotId === slotId(slot)}
                      isBestOption={true}
                      showDate={true}
                      onSelect={() => handleSelectSlot(slot)}
                      onMapPress={() => handleMapPress(slot)}
                    />
                  </View>
                ))}
              </ScrollView>
            )}

            <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>
              By Day
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
                />
              ))
            )}
          </>
        )}
      </ScrollView>

      {mapSlot && newLocation && (
        <MapPreviewModal
          visible={!!mapSlot}
          onClose={() => setMapSlot(null)}
          dayEvents={eventsForDay(filteredAppointments, mapSlot.dayIso)}
          insertionCoord={newLocation}
          slot={mapSlot}
          homeBase={preferences.homeBase ?? DEFAULT_HOME_BASE}
        />
      )}

      <ConfirmBookingSheet
        visible={!!confirmSlot}
        slot={confirmSlot}
        locationLabel={locationLabel}
        locationForEvent={locationForEvent || undefined}
        coordinates={newLocation ?? { lat: 0, lon: 0 }}
        onClose={() => {
          setConfirmSlot(null);
        }}
        onConfirm={handleConfirmBooking}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F2F1',
  },
  durationRow: {
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  durationLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#605E5C',
    marginBottom: 8,
  },
  durationPills: {
    flexDirection: 'row',
    gap: 8,
  },
  durationPill: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#E1DFDD',
    borderWidth: 2,
    borderColor: 'transparent',
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
  emptyHint: {
    fontSize: 14,
    color: '#605E5C',
    marginBottom: 16,
  },
});
