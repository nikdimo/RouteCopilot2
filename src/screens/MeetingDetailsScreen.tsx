import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  type LayoutChangeEvent,
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
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
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

const MS_BLUE = '#2563EB'; // Vibrant Blue
const RED = '#EF4444'; // Modern Red
const FLEX_STEP_MINUTES = 15;
const FLEX_SLOTS_PER_DAY = (24 * 60) / FLEX_STEP_MINUTES;
const FLEX_MAX_SLOT = FLEX_SLOTS_PER_DAY - 1;
const FLEX_TRACK_HEIGHT = 8;
const FLEX_THUMB_SIZE = 24;
const FLEX_WINDOW_REGEX = /\[Flexible Window:\s*([0-2]?\d:[0-5]\d)\s*to\s*([0-2]?\d:[0-5]\d)(?:\s*\|[^\]]*)?\]/i;

type MeetingDetailsNav = NativeStackNavigationProp<ScheduleStackParamList, 'MeetingDetails'>;
type MeetingDetailsRoute = RouteProp<ScheduleStackParamList, 'MeetingDetails'>;

type WebDialogHost = {
  alert?: (message?: string) => void;
  confirm?: (message?: string) => boolean;
};

type FlexibleRangeSliderProps = {
  startSlot15: number;
  endSlot15: number;
  meetingStartSlot15: number;
  meetingEndSlot15: number;
  onStartChange: (slot15: number) => void;
  onEndChange: (slot15: number) => void;
  canEdit: boolean;
  onDragStateChange?: (dragging: boolean) => void;
};

type ParsedFlexibleWindow = {
  notesText: string;
  isFlexible: boolean;
  startSlot15: number | null;
  endSlot15: number | null;
};

function parseClockToMinutes(value: string): number | null {
  const match = value.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  const hours = parseInt(match[1] ?? '0', 10);
  const minutes = parseInt(match[2] ?? '0', 10);
  return hours * 60 + minutes;
}

function clampSlot(slot15: number): number {
  return Math.max(0, Math.min(FLEX_MAX_SLOT, Math.round(slot15)));
}

function minutesToSlot15Round(minutes: number): number {
  return clampSlot(minutes / FLEX_STEP_MINUTES);
}

function minutesToSlot15Floor(minutes: number): number {
  return clampSlot(Math.floor(minutes / FLEX_STEP_MINUTES));
}

function minutesToSlot15Ceil(minutes: number): number {
  return clampSlot(Math.ceil(minutes / FLEX_STEP_MINUTES));
}

function formatSlot15(slot15: number): string {
  const clamped = clampSlot(slot15);
  const totalMinutes = clamped * FLEX_STEP_MINUTES;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function formatMinutesLabel(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  if (safe < 60) return `${safe}m`;
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function parseRangeFromTimeText(
  value: string | undefined
): { startSlot15: number; endSlot15: number } | null {
  const raw = value?.trim();
  if (!raw) return null;
  const normalized = raw.replace(/[\u2013\u2014]/g, '-');
  const match = normalized.match(/([0-2]?\d:[0-5]\d)\s*-\s*([0-2]?\d:[0-5]\d)/);
  if (!match) return null;
  const startMinutes = parseClockToMinutes(match[1] ?? '');
  const endMinutes = parseClockToMinutes(match[2] ?? '');
  if (startMinutes == null || endMinutes == null || endMinutes <= startMinutes) return null;
  const startSlot15 = minutesToSlot15Floor(startMinutes);
  const endSlot15 = Math.max(startSlot15 + 1, minutesToSlot15Ceil(endMinutes));
  return { startSlot15, endSlot15 };
}

function parseRangeFromIso(
  startIso?: string,
  endIso?: string
): { startSlot15: number; endSlot15: number } | null {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso);
  const end = new Date(endIso);
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const endMinutes = end.getHours() * 60 + end.getMinutes();
  const startSlot15 = minutesToSlot15Floor(startMinutes);
  const endSlot15 = Math.max(startSlot15 + 1, minutesToSlot15Ceil(endMinutes));
  return { startSlot15, endSlot15 };
}

function defaultFlexRangeFromAnchor(anchorStartSlot15: number): { startSlot15: number; endSlot15: number } {
  const startSlot15 = Math.max(0, anchorStartSlot15 - 2);
  const endSlot15 = Math.min(FLEX_MAX_SLOT, anchorStartSlot15 + 2);
  return { startSlot15, endSlot15: Math.max(startSlot15 + 1, endSlot15) };
}

function parseFlexibleWindow(notesRaw: string | undefined): ParsedFlexibleWindow {
  const source = notesRaw ?? '';
  const match = source.match(FLEX_WINDOW_REGEX);
  if (!match) {
    return {
      notesText: source.trim(),
      isFlexible: false,
      startSlot15: null,
      endSlot15: null,
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
    startSlot15: hasValidRange ? minutesToSlot15Round(startMinutes!) : null,
    endSlot15: hasValidRange ? Math.max(minutesToSlot15Round(startMinutes!) + 1, minutesToSlot15Round(endMinutes!)) : null,
  };
}

function FlexibleRangeSlider({
  startSlot15,
  endSlot15,
  meetingStartSlot15,
  meetingEndSlot15,
  onStartChange,
  onEndChange,
  canEdit,
  onDragStateChange,
}: FlexibleRangeSliderProps) {
  const trackRef = useRef<View>(null);
  const trackLayout = useRef({ x: 0, width: 300 });
  const [trackWidth, setTrackWidth] = useState(300);

  const onTrackLayout = useCallback((e: LayoutChangeEvent) => {
    const width = Math.max(1, e.nativeEvent.layout.width);
    setTrackWidth(width);
    trackRef.current?.measureInWindow((x) => {
      trackLayout.current = { x, width };
    });
  }, []);

  const absoluteXToSlot15 = useCallback((absoluteX: number) => {
    const { x, width } = trackLayout.current;
    const pct = (absoluteX - x) / width;
    return clampSlot(Math.round(pct * FLEX_MAX_SLOT));
  }, []);

  const setDragging = useCallback((dragging: boolean) => {
    onDragStateChange?.(dragging);
  }, [onDragStateChange]);

  const handleStartUpdate = useCallback((absoluteX: number) => {
    const slot = absoluteXToSlot15(absoluteX);
    const clamped = Math.min(slot, endSlot15 - 1);
    onStartChange(Math.max(0, clamped));
  }, [absoluteXToSlot15, endSlot15, onStartChange]);

  const handleEndUpdate = useCallback((absoluteX: number) => {
    const slot = absoluteXToSlot15(absoluteX);
    const clamped = Math.max(slot, startSlot15 + 1);
    onEndChange(Math.min(FLEX_MAX_SLOT, clamped));
  }, [absoluteXToSlot15, onEndChange, startSlot15]);

  const finishDrag = useCallback(() => {
    onDragStateChange?.(false);
  }, [onDragStateChange]);

  const startGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(canEdit)
        .activeOffsetX([-4, 4])
        .failOffsetY([-20, 20])
        .onBegin(() => {
          runOnJS(setDragging)(true);
        })
        .onUpdate((e) => {
          runOnJS(handleStartUpdate)(e.absoluteX);
        })
        .onFinalize(() => {
          runOnJS(finishDrag)();
        }),
    [canEdit, finishDrag, handleStartUpdate, setDragging]
  );

  const endGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(canEdit)
        .activeOffsetX([-4, 4])
        .failOffsetY([-20, 20])
        .onBegin(() => {
          runOnJS(setDragging)(true);
        })
        .onUpdate((e) => {
          runOnJS(handleEndUpdate)(e.absoluteX);
        })
        .onFinalize(() => {
          runOnJS(finishDrag)();
        }),
    [canEdit, finishDrag, handleEndUpdate, setDragging]
  );

  const startLeft = (startSlot15 / FLEX_MAX_SLOT) * trackWidth - FLEX_THUMB_SIZE / 2;
  const endLeft = (endSlot15 / FLEX_MAX_SLOT) * trackWidth - FLEX_THUMB_SIZE / 2;
  const fillLeft = (startSlot15 / FLEX_MAX_SLOT) * trackWidth;
  const fillWidth = ((endSlot15 - startSlot15) / FLEX_MAX_SLOT) * trackWidth;
  const meetingLeft = (meetingStartSlot15 / FLEX_MAX_SLOT) * trackWidth;
  const meetingWidth = Math.max(2, ((meetingEndSlot15 - meetingStartSlot15) / FLEX_MAX_SLOT) * trackWidth);

  return (
    <View ref={trackRef} onLayout={onTrackLayout} style={styles.flexSliderShell} pointerEvents="box-none">
      <View style={[styles.flexRangeTrack, { height: FLEX_TRACK_HEIGHT }]} pointerEvents="none">
        <View style={[styles.flexRangeFill, { left: fillLeft, width: Math.max(0, fillWidth), height: FLEX_TRACK_HEIGHT }]} />
        <View style={[styles.flexMeetingFill, { left: meetingLeft, width: meetingWidth, height: FLEX_TRACK_HEIGHT }]} />
      </View>

      <GestureDetector gesture={startGesture}>
        <View style={[styles.flexThumbHitArea, { left: startLeft - 10 }]}>
          <View style={styles.flexRangeThumb} />
        </View>
      </GestureDetector>

      <GestureDetector gesture={endGesture}>
        <View style={[styles.flexThumbHitArea, { left: endLeft - 10 }]}>
          <View style={styles.flexRangeThumb} />
        </View>
      </GestureDetector>
    </View>
  );
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
  const [isFlexible, setIsFlexible] = useState(false);
  const [flexStartSlot15, setFlexStartSlot15] = useState(0);
  const [flexEndSlot15, setFlexEndSlot15] = useState(0);
  const [isFlexDragging, setIsFlexDragging] = useState(false);
  const isUserEditingRef = useRef(false);
  const hydratedEventIdRef = useRef<string | null>(null);

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
    const meetingSlots =
      parseRangeFromTimeText(nextTime) ??
      parseRangeFromIso(payload.startIso, payload.endIso) ??
      { startSlot15: 36, endSlot15: 40 };
    const defaults = defaultFlexRangeFromAnchor(meetingSlots.startSlot15);

    setTitle(nextTitle);
    setTimeRange(nextTime);
    setLocation(nextLocation);
    setNotes(parsedFlex.notesText);

    if (parsedFlex.isFlexible && parsedFlex.startSlot15 != null && parsedFlex.endSlot15 != null) {
      setIsFlexible(true);
      setFlexStartSlot15(parsedFlex.startSlot15);
      setFlexEndSlot15(parsedFlex.endSlot15);
    } else {
      setIsFlexible(false);
      setFlexStartSlot15(defaults.startSlot15);
      setFlexEndSlot15(defaults.endSlot15);
    }
  }, []);

  useEffect(() => {
    if (event) {
      isUserEditingRef.current = false;
      setIsFlexDragging(false);
      applyEventToForm(event);
    }
  }, [applyEventToForm, event?.id]);

  const markUserEditing = useCallback(() => {
    isUserEditingRef.current = true;
  }, []);

  const meetingSlotRange = useMemo(() => {
    return (
      parseRangeFromTimeText(timeRange || event?.time) ??
      parseRangeFromIso(event?.startIso, event?.endIso) ??
      { startSlot15: 36, endSlot15: 40 }
    );
  }, [event?.endIso, event?.startIso, event?.time, timeRange]);

  const flexEarlyMinutes = Math.max(
    0,
    (meetingSlotRange.startSlot15 - flexStartSlot15) * FLEX_STEP_MINUTES
  );
  const flexLateMinutes = Math.max(
    0,
    (flexEndSlot15 - meetingSlotRange.startSlot15) * FLEX_STEP_MINUTES
  );

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
    const notesValue = notes.trim();
    const flexMetaValue = isFlexible
      ? `[Flexible Window: ${formatSlot15(flexStartSlot15)} to ${formatSlot15(flexEndSlot15)} | Early ${formatMinutesLabel(flexEarlyMinutes)}, Late ${formatMinutesLabel(flexLateMinutes)}]`
      : '';
    const composedNotes = [notesValue, flexMetaValue].filter(Boolean).join('\n\n').trim();
    const existingNotesRaw = event.notes ?? event.bodyPreview;
    const existingNotesValue = (existingNotesRaw ?? '').trim();
    const includeNotesPatch = composedNotes !== existingNotesValue || existingNotesRaw != null;
    const patch = {
      title: title.trim() || event.title,
      time: timeRange.trim() || event.time,
      location: location.trim() || event.location,
      notes: includeNotesPatch ? (composedNotes || undefined) : event.notes,
    };
    const baseDate = event.startIso ? new Date(event.startIso) : new Date();
    const normalizedTimeRange = (timeRange || event.time || '09:00 - 10:00').replace(/[\u2013\u2014]/g, '-');
    const timeMatch = normalizedTimeRange.match(/([0-2]?\d:[0-5]\d)\s*-\s*([0-2]?\d:[0-5]\d)/);
    const startMinutes = parseClockToMinutes(timeMatch?.[1] ?? '');
    const endMinutes = parseClockToMinutes(timeMatch?.[2] ?? '');
    if (startMinutes == null || endMinutes == null) {
      Alert.alert('Invalid time', 'Use format HH:MM - HH:MM.');
      return;
    }
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
          scrollEnabled={!isFlexDragging}
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
            <View style={styles.flexToggleRow}>
              <Text style={styles.flexTitle}>Flexible meeting time</Text>
              <Switch
                value={isFlexible}
                onValueChange={(next) => {
                  markUserEditing();
                  setIsFlexible(next);
                  if (next) {
                    const defaults = defaultFlexRangeFromAnchor(meetingSlotRange.startSlot15);
                    setFlexStartSlot15(defaults.startSlot15);
                    setFlexEndSlot15(defaults.endSlot15);
                  }
                }}
                trackColor={{ false: '#CBD5E1', true: '#BFDBFE' }}
                thumbColor={isFlexible ? MS_BLUE : '#F8FAFC'}
              />
            </View>
            {isFlexible && (
              <View style={styles.flexRangeWrap}>
                <View style={styles.flexSummaryRow}>
                  <Text style={styles.flexOptionLabel}>From {formatSlot15(flexStartSlot15)}</Text>
                  <Text style={styles.flexOptionLabel}>To {formatSlot15(flexEndSlot15)}</Text>
                </View>
                <FlexibleRangeSlider
                  startSlot15={flexStartSlot15}
                  endSlot15={flexEndSlot15}
                  meetingStartSlot15={meetingSlotRange.startSlot15}
                  meetingEndSlot15={meetingSlotRange.endSlot15}
                  onStartChange={(slot15) => {
                    markUserEditing();
                    setFlexStartSlot15(slot15);
                  }}
                  onEndChange={(slot15) => {
                    markUserEditing();
                    setFlexEndSlot15(slot15);
                  }}
                  onDragStateChange={setIsFlexDragging}
                  canEdit
                />
                <View style={styles.flexSummaryRow}>
                  <Text style={styles.flexOffsetText}>Early {formatMinutesLabel(flexEarlyMinutes)}</Text>
                  <Text style={styles.flexOffsetText}>Late {formatMinutesLabel(flexLateMinutes)}</Text>
                </View>
                <View style={styles.flexLegendRow}>
                  <View style={styles.flexLegendItem}>
                    <View style={styles.flexLegendBlue} />
                    <Text style={styles.flexLegendText}>Flexible window</Text>
                  </View>
                  <View style={styles.flexLegendItem}>
                    <View style={styles.flexLegendRed} />
                    <Text style={styles.flexLegendText}>Actual meeting</Text>
                  </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  flexTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#334155',
  },
  flexRangeWrap: {
    marginTop: 10,
  },
  flexSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  flexOptionLabel: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '600',
  },
  flexOffsetText: {
    fontSize: 12,
    color: '#64748B',
  },
  flexLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  flexLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flexLegendBlue: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: MS_BLUE,
    marginRight: 6,
  },
  flexLegendRed: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: RED,
    marginRight: 6,
  },
  flexLegendText: {
    fontSize: 12,
    color: '#64748B',
  },
  flexSliderShell: {
    height: 40,
    justifyContent: 'center',
    width: '100%',
    marginBottom: 2,
  },
  flexRangeTrack: {
    width: '100%',
    backgroundColor: '#E5E7EB',
    borderRadius: 4,
    position: 'relative',
  },
  flexRangeFill: {
    position: 'absolute',
    top: 0,
    backgroundColor: MS_BLUE,
    borderRadius: 4,
  },
  flexMeetingFill: {
    position: 'absolute',
    top: 0,
    backgroundColor: RED,
    borderRadius: 4,
  },
  flexThumbHitArea: {
    position: 'absolute',
    top: (40 - (FLEX_THUMB_SIZE + 20)) / 2,
    width: FLEX_THUMB_SIZE + 20,
    height: FLEX_THUMB_SIZE + 20,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  flexRangeThumb: {
    width: FLEX_THUMB_SIZE,
    height: FLEX_THUMB_SIZE,
    borderRadius: FLEX_THUMB_SIZE / 2,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: MS_BLUE,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
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
