import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Linking,
  Switch,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ScheduleStackParamList } from '../navigation/ScheduleStack';
import { MapPin, Trash2, Check, X, Clock, AlignLeft, Calendar } from 'lucide-react-native';
import { useAuth } from '../context/AuthContext';
import { useRoute as useRouteContext } from '../context/RouteContext';
import { useUserPreferences } from '../context/UserPreferencesContext';
import { openNativeDirections } from '../utils/maps';
import {
  GraphUnauthorizedError,
  getCalendarEventById,
  updateCalendarEvent,
  deleteCalendarEvent,
} from '../services/graph';
import { getEffectiveSubscriptionTier, getTierEntitlements } from '../utils/subscription';
import MeetingDurationFlexTimeline from '../components/MeetingDurationFlexTimeline';

const MS_BLUE = '#2563EB'; // Vibrant Blue
const RED = '#EF4444'; // Modern Red
const DURATION_STEP_MINUTES = 15;
const MAX_DURATION_MINUTES = 8 * 60;
const FLEXIBLE_WINDOW_TAG_REGEX = /\[Flexible Window:[^\]]+\]/i;
const FLEX_WINDOW_REGEX = /\[Flexible Window:\s*([0-2]?\d:[0-5]\d)\s*to\s*([0-2]?\d:[0-5]\d)(?:\s*\|[^\]]*)?\]/i;

type MeetingDetailsNav = NativeStackNavigationProp<ScheduleStackParamList, 'MeetingDetails'>;
type MeetingDetailsRoute = RouteProp<ScheduleStackParamList, 'MeetingDetails'>;

type WebDialogHost = {
  alert?: (message?: string) => void;
  confirm?: (message?: string) => boolean;
};

type ParsedFlexibleWindow = {
  notesText: string;
  isFlexible: boolean;
  startMinutes: number | null;
  endMinutes: number | null;
};

function parseClockToMinutes(value: string): number | null {
  const match = value.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  const hours = parseInt(match[1] ?? '0', 10);
  const minutes = parseInt(match[2] ?? '0', 10);
  return hours * 60 + minutes;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatMinutesLabel(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  if (safe < 60) return `${safe}m`;
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatClockFromMinutes(minutes: number): string {
  const safe = clamp(minutes, 0, 23 * 60 + 59);
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function snapDuration(value: number): number {
  return Math.max(
    DURATION_STEP_MINUTES,
    Math.min(
      MAX_DURATION_MINUTES,
      Math.round(value / DURATION_STEP_MINUTES) * DURATION_STEP_MINUTES
    )
  );
}

function parseRangeFromTimeText(
  value: string | undefined
): { startMinutes: number; endMinutes: number } | null {
  const raw = value?.trim();
  if (!raw) return null;
  const normalized = raw.replace(/[\u2013\u2014]/g, '-');
  const match = normalized.match(/([0-2]?\d:[0-5]\d)\s*-\s*([0-2]?\d:[0-5]\d)/);
  if (!match) return null;
  const startMinutes = parseClockToMinutes(match[1] ?? '');
  const endMinutes = parseClockToMinutes(match[2] ?? '');
  if (startMinutes == null || endMinutes == null || endMinutes <= startMinutes) return null;
  return { startMinutes, endMinutes };
}

function parseRangeFromIso(
  startIso?: string,
  endIso?: string
): { startMinutes: number; endMinutes: number } | null {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso);
  const end = new Date(endIso);
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const endMinutes = end.getHours() * 60 + end.getMinutes();
  if (endMinutes <= startMinutes) return null;
  return { startMinutes, endMinutes };
}

function buildFlexibleWindowTag(
  meetingStartMinutes: number,
  flexBeforeMinutes: number,
  flexAfterMinutes: number
): string | null {
  if (flexBeforeMinutes <= 0 && flexAfterMinutes <= 0) return null;
  const minStart = Math.max(0, meetingStartMinutes - flexBeforeMinutes);
  const maxStart = Math.min(23 * 60 + 59, meetingStartMinutes + flexAfterMinutes);
  if (maxStart <= minStart) return null;
  return `[Flexible Window: ${formatClockFromMinutes(minStart)} to ${formatClockFromMinutes(maxStart)} | source=meeting-details]`;
}

function composeNotesWithFlexibleWindow(
  notesText: string | undefined,
  flexibleWindowTag: string | null
): string | undefined {
  const cleanedBase = (notesText ?? '').replace(FLEXIBLE_WINDOW_TAG_REGEX, '').trim();
  if (!flexibleWindowTag) return cleanedBase || undefined;
  if (!cleanedBase) return flexibleWindowTag;
  return `${cleanedBase}\n\n${flexibleWindowTag}`;
}

function parseFlexibleWindow(notesRaw: string | undefined): ParsedFlexibleWindow {
  const source = notesRaw ?? '';
  const match = source.match(FLEX_WINDOW_REGEX);
  if (!match) {
    return {
      notesText: source.trim(),
      isFlexible: false,
      startMinutes: null,
      endMinutes: null,
    };
  }
  const startMinutes = parseClockToMinutes(match[1] ?? '');
  const endMinutes = parseClockToMinutes(match[2] ?? '');
  const hasValidRange =
    startMinutes != null &&
    endMinutes != null &&
    endMinutes > startMinutes;
  const strippedNotes = source
    .replace(match[0], '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return {
    notesText: strippedNotes,
    isFlexible: hasValidRange,
    startMinutes: hasValidRange ? startMinutes! : null,
    endMinutes: hasValidRange ? endMinutes! : null,
  };
}

function confirmDestructiveAction(
  title: string,
  message: string,
  confirmText: string,
  onConfirm: () => void
) {
  if (Platform.OS === 'web') {
    const host = globalThis as WebDialogHost;
    if (typeof host.confirm === 'function') {
      if (host.confirm(`${title}\n\n${message}`)) {
        onConfirm();
      }
      return;
    }
  }

  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmText, style: 'destructive', onPress: onConfirm },
  ]);
}

export default function MeetingDetailsScreen() {
  const navigation = useNavigation<MeetingDetailsNav>();
  const route = useRoute<MeetingDetailsRoute>();
  const { getValidToken, userToken } = useAuth();
  const { preferences } = useUserPreferences();
  const subscriptionTier = getEffectiveSubscriptionTier(preferences, Boolean(userToken));
  const { canSyncCalendar } = getTierEntitlements(subscriptionTier);
  const { appointments, updateAppointment, removeAppointment, markEventAsDone, unmarkEventAsDone, triggerRefresh } =
    useRouteContext();

  const eventId = route.params?.eventId ?? '';
  const event = appointments.find((e) => e.id === eventId);

  const [title, setTitle] = useState('');
  const [timeRange, setTimeRange] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [isFlexible, setIsFlexible] = useState(false);
  const [flexBeforeMinutes, setFlexBeforeMinutes] = useState(0);
  const [flexAfterMinutes, setFlexAfterMinutes] = useState(0);
  const isUserEditingRef = useRef(false);
  const hydratedEventIdRef = useRef<string | null>(null);

  const maxFlexPerSideMinutes = useMemo(() => {
    const raw = (MAX_DURATION_MINUTES - durationMinutes) / 2;
    if (raw <= 0) return 0;
    return Math.floor(raw / DURATION_STEP_MINUTES) * DURATION_STEP_MINUTES;
  }, [durationMinutes]);

  const applyEventToForm = useCallback((payload: {
    title?: string;
    time?: string;
    location?: string;
    notes?: string;
    bodyPreview?: string;
    startIso?: string;
    endIso?: string;
  }) => {
    const nextTitle = payload.title ?? '';
    const nextTime = payload.time ?? '';
    const nextLocation = payload.location ?? '';
    const rawNotes = payload.notes ?? payload.bodyPreview ?? '';
    const parsedFlex = parseFlexibleWindow(rawNotes);
    const meetingRange =
      parseRangeFromTimeText(nextTime) ??
      parseRangeFromIso(payload.startIso, payload.endIso) ??
      { startMinutes: 9 * 60, endMinutes: 10 * 60 };
    const parsedDuration = snapDuration(meetingRange.endMinutes - meetingRange.startMinutes);
    const initialMaxFlexPerSide = Math.floor(
      Math.max(0, (MAX_DURATION_MINUTES - parsedDuration) / 2) / DURATION_STEP_MINUTES
    ) * DURATION_STEP_MINUTES;
    const parsedFlexBefore = parsedFlex.isFlexible && parsedFlex.startMinutes != null
      ? Math.max(0, meetingRange.startMinutes - parsedFlex.startMinutes)
      : 0;
    const parsedFlexAfter = parsedFlex.isFlexible && parsedFlex.endMinutes != null
      ? Math.max(0, parsedFlex.endMinutes - meetingRange.startMinutes)
      : 0;

    setTitle(nextTitle);
    setTimeRange(nextTime || `${formatClockFromMinutes(meetingRange.startMinutes)} - ${formatClockFromMinutes(meetingRange.endMinutes)}`);
    setLocation(nextLocation);
    setNotes(parsedFlex.notesText);
    setDurationMinutes(parsedDuration);
    setIsFlexible(parsedFlexBefore > 0 || parsedFlexAfter > 0);
    setFlexBeforeMinutes(clamp(parsedFlexBefore, 0, initialMaxFlexPerSide));
    setFlexAfterMinutes(clamp(parsedFlexAfter, 0, initialMaxFlexPerSide));
  }, []);

  useEffect(() => {
    if (event) {
      isUserEditingRef.current = false;
      applyEventToForm(event);
    }
  }, [applyEventToForm, event?.id]);

  const markUserEditing = useCallback(() => {
    isUserEditingRef.current = true;
  }, []);

  const meetingRange = useMemo(() => {
    return (
      parseRangeFromTimeText(timeRange || event?.time) ??
      parseRangeFromIso(event?.startIso, event?.endIso) ??
      { startMinutes: 9 * 60, endMinutes: 10 * 60 }
    );
  }, [event?.endIso, event?.startIso, event?.time, timeRange]);

  const flexEarlyMinutes = isFlexible ? flexBeforeMinutes : 0;
  const flexLateMinutes = isFlexible ? flexAfterMinutes : 0;

  useEffect(() => {
    setFlexBeforeMinutes((prev) => Math.min(prev, maxFlexPerSideMinutes));
    setFlexAfterMinutes((prev) => Math.min(prev, maxFlexPerSideMinutes));
  }, [maxFlexPerSideMinutes]);

  const handleTimelineDurationChange = useCallback((nextDuration: number) => {
    markUserEditing();
    const snapped = snapDuration(nextDuration);
    setDurationMinutes(snapped);
    const startMinutes = meetingRange.startMinutes;
    const endMinutes = Math.min(23 * 60 + 59, startMinutes + snapped);
    setTimeRange(`${formatClockFromMinutes(startMinutes)} - ${formatClockFromMinutes(endMinutes)}`);
  }, [markUserEditing, meetingRange.startMinutes]);

  const handleFlexBeforeChange = useCallback((next: number) => {
    markUserEditing();
    const snapped = Math.max(
      0,
      Math.min(maxFlexPerSideMinutes, Math.round(next / DURATION_STEP_MINUTES) * DURATION_STEP_MINUTES)
    );
    setFlexBeforeMinutes(snapped);
  }, [markUserEditing, maxFlexPerSideMinutes]);

  const handleFlexAfterChange = useCallback((next: number) => {
    markUserEditing();
    const snapped = Math.max(
      0,
      Math.min(maxFlexPerSideMinutes, Math.round(next / DURATION_STEP_MINUTES) * DURATION_STEP_MINUTES)
    );
    setFlexAfterMinutes(snapped);
  }, [markUserEditing, maxFlexPerSideMinutes]);

  const handleFlexibleToggle = useCallback((next: boolean) => {
    markUserEditing();
    setIsFlexible(next);
    if (next) {
      const fallbackFlex = Math.min(15, maxFlexPerSideMinutes);
      setFlexBeforeMinutes((prev) => {
        if (prev > 0) return Math.min(prev, maxFlexPerSideMinutes);
        return fallbackFlex;
      });
      setFlexAfterMinutes((prev) => {
        if (prev > 0) return Math.min(prev, maxFlexPerSideMinutes);
        return fallbackFlex;
      });
    } else {
      setFlexBeforeMinutes(0);
      setFlexAfterMinutes(0);
    }
  }, [markUserEditing, maxFlexPerSideMinutes]);

  useEffect(() => {
    let cancelled = false;
    const isGraphEvent = eventId !== '' && !eventId.startsWith('local-');
    if (!canSyncCalendar || !isGraphEvent) return () => {
      cancelled = true;
    };
    if (hydratedEventIdRef.current === eventId) return () => {
      cancelled = true;
    };
    hydratedEventIdRef.current = eventId;

    void (async () => {
      const token = getValidToken ? await getValidToken() : null;
      if (!token || cancelled) return;
      try {
        const result = await getCalendarEventById(token, eventId);
        if (cancelled || !result.success) return;
        if (isUserEditingRef.current) return;
        const remote = result.event;
        applyEventToForm(remote);
        updateAppointment(eventId, {
          title: remote.title,
          time: remote.time,
          location: remote.location,
          startIso: remote.startIso,
          endIso: remote.endIso,
          notes: remote.notes,
          bodyPreview: remote.bodyPreview,
          outlookWebLink: remote.outlookWebLink,
        });
      } catch {
        // Ignore remote hydrate failures; local event payload still opens.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyEventToForm, canSyncCalendar, eventId, getValidToken, updateAppointment]);

  if (!event) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Meeting not found</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isCompleted = event.status === 'completed';
  const hasCoords = event.coordinates != null;
  const outlookEventLink = event.outlookWebLink?.trim() || '';
  const canEditInOutlook = Boolean(outlookEventLink) && !eventId.startsWith('local-');

  const handleSave = async () => {
    const notesValue = notes.trim() || undefined;
    const parsedTimeRange = parseRangeFromTimeText(timeRange || event.time || '09:00 - 10:00');
    if (!parsedTimeRange) {
      Alert.alert('Invalid time', 'Use format HH:MM - HH:MM.');
      return;
    }
    const startMinutes = parsedTimeRange.startMinutes;
    const endMinutes = Math.min(23 * 60 + 59, startMinutes + durationMinutes);
    if (endMinutes <= startMinutes) {
      Alert.alert('Invalid time', 'Duration is too long for the selected start time.');
      return;
    }
    const normalizedTimeRange = `${formatClockFromMinutes(startMinutes)} - ${formatClockFromMinutes(endMinutes)}`;
    const flexibleWindowTag = isFlexible
      ? buildFlexibleWindowTag(startMinutes, flexBeforeMinutes, flexAfterMinutes)
      : null;
    const composedNotes = composeNotesWithFlexibleWindow(notesValue, flexibleWindowTag);
    const existingNotesRaw = event.notes ?? event.bodyPreview;
    const existingNotesValue = (existingNotesRaw ?? '').trim();
    const includeNotesPatch = (composedNotes ?? '') !== existingNotesValue || existingNotesRaw != null;
    const patch = {
      title: title.trim() || event.title,
      time: normalizedTimeRange,
      location: location.trim() || event.location,
      notes: includeNotesPatch ? (composedNotes || undefined) : event.notes,
    };
    const baseDate = event.startIso ? new Date(event.startIso) : new Date();
    const sh = Math.floor(startMinutes / 60);
    const sm = startMinutes % 60;
    const eh = Math.floor(endMinutes / 60);
    const em = endMinutes % 60;
    const start = new Date(baseDate);
    start.setHours(sh, sm, 0, 0);
    const end = new Date(baseDate);
    end.setHours(eh, em, 0, 0);
    const newStartMs = start.getTime();
    const newEndMs = end.getTime();
    if (newEndMs <= newStartMs) {
      Alert.alert('Invalid time', 'End time must be after start time.');
      return;
    }

    const token = getValidToken ? await getValidToken() : null;
    const isGraphEvent = !eventId.startsWith('local-');
    const localPatch = {
      ...patch,
      startIso: new Date(newStartMs).toISOString(),
      endIso: new Date(newEndMs).toISOString(),
      ...(includeNotesPatch
        ? { notes: composedNotes || undefined, bodyPreview: composedNotes || undefined }
        : {}),
    };

    if (canSyncCalendar && token && isGraphEvent) {
      try {
        const result = await updateCalendarEvent(token, eventId, {
          subject: patch.title,
          startIso: new Date(newStartMs).toISOString(),
          endIso: new Date(newEndMs).toISOString(),
          location: patch.location,
          body: includeNotesPatch ? composedNotes : undefined,
        });
        if (result.success && result.event) {
          updateAppointment(eventId, { ...result.event, ...localPatch });
        } else {
          if (!result.success && result.needsConsent) {
            Alert.alert(
              'Permission needed',
              'Grant Calendars.ReadWrite to sync changes to Outlook. Saved locally.',
              [{ text: 'OK' }]
            );
          }
          updateAppointment(eventId, localPatch);
        }
      } catch (err) {
        if (err instanceof GraphUnauthorizedError) {
          Alert.alert('Session expired', 'Calendar session expired. Changes were saved locally.');
        } else {
          Alert.alert('Sync failed', 'Could not update Outlook right now. Changes were saved locally.');
        }
        updateAppointment(eventId, localPatch);
      }
    } else {
      updateAppointment(eventId, localPatch);
    }
    navigation.goBack();
  };

  const handleDelete = () => {
    const finishDeleteLocally = () => {
      removeAppointment(eventId);
      triggerRefresh();
      navigation.goBack();
    };

    confirmDestructiveAction(
      'Delete meeting',
      'Are you sure? This cannot be undone.',
      'Delete',
      () => {
        void (async () => {
          const token = getValidToken ? await getValidToken() : null;
          const isGraphEvent = !eventId.startsWith('local-');
          if (canSyncCalendar && token && isGraphEvent) {
            try {
              const result = await deleteCalendarEvent(token, eventId);
              if (!result.success) {
                const errText = (result.error ?? '').toLowerCase();
                if (errText.includes('404') || errText.includes('not found')) {
                  // Already gone in Outlook; remove local copy.
                  finishDeleteLocally();
                  return;
                }
                confirmDestructiveAction(
                  result.needsConsent ? 'Permission needed' : 'Delete failed',
                  result.needsConsent
                    ? 'Could not delete in Outlook due missing permission. Remove it from WisePlan list anyway?'
                    : `Could not confirm Outlook delete (${result.error}). Remove it from WisePlan list anyway?`,
                  'Remove from list',
                  finishDeleteLocally
                );
                return;
              }
            } catch (err) {
              confirmDestructiveAction(
                err instanceof GraphUnauthorizedError ? 'Session expired' : 'Delete sync failed',
                'Could not confirm Outlook delete. Remove it from WisePlan list anyway?',
                'Remove from list',
                finishDeleteLocally
              );
              return;
            }
          }
          finishDeleteLocally();
        })();
      }
    );
  };

  const handleToggleDone = () => {
    if (isCompleted) {
      unmarkEventAsDone(eventId);
    } else {
      markEventAsDone(eventId);
    }
  };

  const handleOpenDirections = () => {
    if (hasCoords) {
      openNativeDirections(
        event.coordinates!.latitude,
        event.coordinates!.longitude,
        event.title || 'Meeting'
      );
    }
  };

  const handleEditInOutlook = async () => {
    if (!canEditInOutlook) return;
    try {
      await Linking.openURL(outlookEventLink);
    } catch {
      Alert.alert('Could not open Outlook', 'Unable to open this event in Outlook on this device.');
    }
  };

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Custom Header */}
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>Meeting Details</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={() => navigation.goBack()}>
              <X size={24} color="#64748B" />
            </TouchableOpacity>
          </View>

          {/* Mark as Done Card */}
          <View style={styles.sectionHeader}>
            <Text style={styles.label}>STATUS</Text>
          </View>
          <TouchableOpacity
            style={[styles.doneRow, isCompleted && styles.doneRowActive]}
            onPress={handleToggleDone}
            activeOpacity={0.8}
          >
            {isCompleted ? (
              <View style={styles.checkDone}>
                <Check color="#fff" size={16} strokeWidth={3} />
              </View>
            ) : (
              <View style={styles.circleEmpty} />
            )}
            <Text style={[styles.doneLabel, isCompleted && styles.doneLabelActive]}>
              {isCompleted ? 'Completed' : 'Mark as completed'}
            </Text>
          </TouchableOpacity>

          {/* Title */}
          <View style={styles.sectionHeader}>
            <Text style={styles.label}>TITLE</Text>
          </View>
          <View style={styles.inputWrapper}>
            <Calendar size={20} color="#94A3B8" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={(text) => {
                markUserEditing();
                setTitle(text);
              }}
              placeholder="Meeting title"
              placeholderTextColor="#94A3B8"
            />
          </View>

          {/* Time */}
          <View style={styles.sectionHeader}>
            <Text style={styles.label}>TIME</Text>
          </View>
          <View style={styles.inputWrapper}>
            <Clock size={20} color="#94A3B8" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              value={timeRange}
              onChangeText={(text) => {
                markUserEditing();
                setTimeRange(text);
                const parsed = parseRangeFromTimeText(text);
                if (parsed) {
                  setDurationMinutes(snapDuration(parsed.endMinutes - parsed.startMinutes));
                }
              }}
              placeholder="09:00 - 10:00"
              placeholderTextColor="#94A3B8"
            />
          </View>

          {/* Flexibility */}
          <View style={styles.sectionHeader}>
            <Text style={styles.label}>FLEXIBILITY</Text>
          </View>
          <View style={styles.flexCard}>
            <View style={styles.rangeBarWrap}>
              <MeetingDurationFlexTimeline
                durationMinutes={durationMinutes}
                flexBeforeMinutes={flexBeforeMinutes}
                flexAfterMinutes={flexAfterMinutes}
                showFlexHandles={isFlexible}
                onDurationChange={handleTimelineDurationChange}
                onFlexBeforeChange={handleFlexBeforeChange}
                onFlexAfterChange={handleFlexAfterChange}
                maxMinutes={MAX_DURATION_MINUTES}
                stepMinutes={DURATION_STEP_MINUTES}
                maxFlexPerSideMinutes={maxFlexPerSideMinutes}
              />
            </View>
            <Text style={styles.durationSummary}>
              Duration: {formatMinutesLabel(durationMinutes)}
            </Text>
            <View style={styles.flexToggleRow}>
              <View style={styles.flexToggleTextWrap}>
                <Text style={styles.flexTitle}>Flexible meeting time</Text>
                <Text style={styles.flexToggleHint}>
                  Turn on to allow earlier/later start around this meeting.
                </Text>
              </View>
              <Switch
                value={isFlexible}
                onValueChange={handleFlexibleToggle}
                trackColor={{ false: '#CBD5E1', true: '#F59E0B' }}
                thumbColor={isFlexible ? '#FFFFFF' : '#F8FAFC'}
              />
            </View>
            {isFlexible && (
              <View style={styles.flexSummaryRow}>
                <View style={styles.flexSummaryBadge}>
                  <Text style={styles.flexSummaryBadgeLabel}>Before</Text>
                  <Text style={styles.flexSummaryBadgeValue}>
                    {formatMinutesLabel(flexEarlyMinutes)}
                  </Text>
                </View>
                <View style={styles.flexSummaryBadge}>
                  <Text style={styles.flexSummaryBadgeLabel}>After</Text>
                  <Text style={styles.flexSummaryBadgeValue}>
                    {formatMinutesLabel(flexLateMinutes)}
                  </Text>
                </View>
              </View>
            )}
          </View>

          {/* Address */}
          <View style={styles.sectionHeader}>
            <Text style={styles.label}>ADDRESS / LOCATION</Text>
          </View>
          <View style={styles.inputWrapper}>
            <MapPin size={20} color="#94A3B8" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              value={location}
              onChangeText={(text) => {
                markUserEditing();
                setLocation(text);
              }}
              placeholder="Address"
              placeholderTextColor="#94A3B8"
            />
          </View>

          {/* Notes */}
          <View style={styles.sectionHeader}>
            <Text style={styles.label}>NOTES</Text>
          </View>
          <View style={[styles.inputWrapper, { alignItems: 'flex-start' }]}>
            <AlignLeft size={20} color="#94A3B8" style={[styles.inputIcon, { marginTop: 14 }]} />
            <TextInput
              style={[styles.input, styles.notesInput]}
              value={notes}
              onChangeText={(text) => {
                markUserEditing();
                setNotes(text);
              }}
              placeholder="Notes (optional)"
              placeholderTextColor="#94A3B8"
              multiline
              numberOfLines={4}
            />
          </View>

          {/* Actions */}
          <View style={styles.actionsBox}>
            <TouchableOpacity
              style={[styles.outlookBtn, !canEditInOutlook && styles.mapBtnDisabled]}
              onPress={handleEditInOutlook}
              disabled={!canEditInOutlook}
              activeOpacity={0.8}
            >
              <Text style={[styles.outlookBtnText, !canEditInOutlook && styles.mapBtnTextDisabled]}>
                Edit in Outlook
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.mapBtn, !hasCoords && styles.mapBtnDisabled]}
              onPress={handleOpenDirections}
              disabled={!hasCoords}
              activeOpacity={0.8}
            >
              <MapPin color={hasCoords ? MS_BLUE : '#94a3b8'} size={20} />
              <Text style={[styles.mapBtnText, !hasCoords && styles.mapBtnTextDisabled]}>
                Open in Maps
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.8}>
              <Text style={styles.saveBtnText}>Save changes</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} activeOpacity={0.8}>
              <Trash2 color={RED} size={18} />
              <Text style={styles.deleteBtnText}>Delete meeting</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC', // Match new app background
  },
  keyboardContainer: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 40,
    width: '100%',
    maxWidth: 700, // Important fix for desktop spanning
    alignSelf: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
    paddingTop: 8,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontSize: 16,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 40,
  },
  backBtn: {
    marginTop: 16,
    alignSelf: 'center',
  },
  backBtnText: {
    fontSize: 16,
    color: MS_BLUE,
    fontWeight: '600',
  },
  sectionHeader: {
    marginBottom: 6,
    marginTop: 18,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  inputIcon: {
    marginLeft: 16,
    marginRight: 8,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    paddingRight: 16,
    fontSize: 16,
    color: '#0F172A',
  },
  notesInput: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  flexCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    paddingVertical: 12,
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
  flexTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 2,
  },
  rangeBarWrap: {
    marginTop: 10,
    paddingVertical: 6,
  },
  durationSummary: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  flexToggleTextWrap: {
    flex: 1,
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
  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 8,
  },
  doneRowActive: {
    backgroundColor: '#F0FDF4', // Light green background for checked
    borderColor: '#86EFAC',
  },
  circleEmpty: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#CBD5E1',
  },
  checkDone: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#10B981', // Emerald
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 12,
    color: '#334155',
  },
  doneLabelActive: {
    color: '#065F46',
  },
  actionsBox: {
    marginTop: 40,
    paddingTop: 24,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  mapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: MS_BLUE,
    marginBottom: 16,
    backgroundColor: '#FFFFFF',
  },
  outlookBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#0A66C2',
    marginBottom: 16,
    backgroundColor: '#FFFFFF',
  },
  outlookBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0A66C2',
  },
  mapBtnDisabled: {
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    opacity: 0.7,
  },
  mapBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: MS_BLUE,
    marginLeft: 8,
  },
  mapBtnTextDisabled: {
    color: '#94A3B8',
  },
  saveBtn: {
    backgroundColor: MS_BLUE,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 24,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  deleteBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: RED,
    marginLeft: 8,
  },
});
