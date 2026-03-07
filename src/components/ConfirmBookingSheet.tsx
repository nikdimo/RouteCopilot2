import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Switch,
} from 'react-native';
import { X, Users, Clock, MapPin, AlignLeft } from 'lucide-react-native';
import type { ScoredSlot } from '../utils/scheduler';
import type { CalendarEvent } from '../services/graph';
import type { Coordinate } from '../utils/scheduler';
import MeetingDurationFlexTimeline from './MeetingDurationFlexTimeline';

const MS_BLUE = '#0078D4';
const FLEX_STEP_MINUTES = 15;
const MAX_DURATION_MINUTES = 8 * 60;

function formatTimeMs(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function formatDayLabel(dayIso: string): string {
  const [y, mo, d] = dayIso.split('-').map((x) => parseInt(x, 10));
  const date = new Date(y, mo - 1, d);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatMinutesLabel(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  if (safe < 60) return `${safe}m`;
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export type ContactInput = {
  displayName?: string;
  companyName?: string;
  businessPhone?: string;
  email?: string;
};

export type ConfirmFlexConfig = {
  enabled: boolean;
  earlyMinutes: number;
  lateMinutes: number;
};

export type ConfirmBookingSheetProps = {
  visible: boolean;
  slot: ScoredSlot | null;
  /** Display label (e.g. contact name "D4_Faxe") */
  locationLabel: string;
  /** Full address to store in event.location for geocoding/display (e.g. "Hovedgaden 24, Faxe 4654") */
  locationForEvent?: string;
  coordinates: Coordinate;
  onClose: () => void;
  onConfirm: (
    event: CalendarEvent,
    contactInput?: ContactInput,
    flexConfig?: ConfirmFlexConfig
  ) => void;
  defaultFlexibleEnabled?: boolean;
  defaultFlexBeforeMinutes?: number;
  defaultFlexAfterMinutes?: number;
  defaultDurationMinutes?: number;
};

/** Confirm step: selection creates meeting. User reviews and taps Book to add in-app. */
export default function ConfirmBookingSheet({
  visible,
  slot,
  locationLabel,
  locationForEvent,
  coordinates,
  onClose,
  onConfirm,
  defaultFlexibleEnabled = false,
  defaultFlexBeforeMinutes = 0,
  defaultFlexAfterMinutes = 0,
  defaultDurationMinutes = 60,
}: ConfirmBookingSheetProps) {
  const titleInputRef = useRef<TextInput>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const [saveContact, setSaveContact] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactCompany, setContactCompany] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  const [bookingDurationMinutes, setBookingDurationMinutes] = useState(defaultDurationMinutes);
  const [isFlexible, setIsFlexible] = useState(false);
  const [flexBeforeMinutes, setFlexBeforeMinutes] = useState(0);
  const [flexAfterMinutes, setFlexAfterMinutes] = useState(0);

  const initialFlexibleEnabled = defaultFlexibleEnabled
    || defaultFlexBeforeMinutes > 0
    || defaultFlexAfterMinutes > 0;

  const maxFlexPerSideMinutes = useMemo(() => {
    const raw = (MAX_DURATION_MINUTES - bookingDurationMinutes) / 2;
    if (raw <= 0) return 0;
    return Math.floor(raw / FLEX_STEP_MINUTES) * FLEX_STEP_MINUTES;
  }, [bookingDurationMinutes]);

  useEffect(() => {
    if (!visible || !slot) return;
    const slotDurationMinutes = Math.max(
      FLEX_STEP_MINUTES,
      Math.round((slot.endMs - slot.startMs) / (FLEX_STEP_MINUTES * 60_000)) * FLEX_STEP_MINUTES
    );
    const nextDuration = Math.max(
      FLEX_STEP_MINUTES,
      Math.min(
        MAX_DURATION_MINUTES,
        Math.round((defaultDurationMinutes || slotDurationMinutes) / FLEX_STEP_MINUTES) * FLEX_STEP_MINUTES
      )
    );
    setBookingDurationMinutes(nextDuration);
    setFlexBeforeMinutes(Math.max(0, defaultFlexBeforeMinutes));
    setFlexAfterMinutes(Math.max(0, defaultFlexAfterMinutes));
    setIsFlexible(initialFlexibleEnabled);
  }, [
    initialFlexibleEnabled,
    defaultDurationMinutes,
    defaultFlexAfterMinutes,
    defaultFlexBeforeMinutes,
    slot,
    visible,
  ]);

  useEffect(() => {
    setFlexBeforeMinutes((prev) => Math.min(prev, maxFlexPerSideMinutes));
    setFlexAfterMinutes((prev) => Math.min(prev, maxFlexPerSideMinutes));
  }, [maxFlexPerSideMinutes]);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      titleInputRef.current?.focus();
    }, 80);
    return () => clearTimeout(timer);
  }, [visible]);

  const flexEarlyMinutes = isFlexible ? flexBeforeMinutes : 0;
  const flexLateMinutes = isFlexible ? flexAfterMinutes : 0;

  const handleFlexibleToggle = useCallback(
    (next: boolean) => {
      setIsFlexible(next);
      if (next) {
        const fallbackFlex = Math.min(15, maxFlexPerSideMinutes);
        setFlexBeforeMinutes((prev) => {
          if (prev > 0) return Math.min(prev, maxFlexPerSideMinutes);
          if (defaultFlexBeforeMinutes > 0) return Math.min(defaultFlexBeforeMinutes, maxFlexPerSideMinutes);
          return fallbackFlex;
        });
        setFlexAfterMinutes((prev) => {
          if (prev > 0) return Math.min(prev, maxFlexPerSideMinutes);
          if (defaultFlexAfterMinutes > 0) return Math.min(defaultFlexAfterMinutes, maxFlexPerSideMinutes);
          return fallbackFlex;
        });
      } else {
        setFlexBeforeMinutes(0);
        setFlexAfterMinutes(0);
      }
    },
    [defaultFlexAfterMinutes, defaultFlexBeforeMinutes, maxFlexPerSideMinutes]
  );

  const handleTimelineDurationChange = useCallback((nextDuration: number) => {
    const snapped = Math.max(
      FLEX_STEP_MINUTES,
      Math.min(MAX_DURATION_MINUTES, Math.round(nextDuration / FLEX_STEP_MINUTES) * FLEX_STEP_MINUTES)
    );
    setBookingDurationMinutes(snapped);
  }, []);

  const handleFlexBeforeChange = useCallback((next: number) => {
    const snapped = Math.max(
      0,
      Math.min(maxFlexPerSideMinutes, Math.round(next / FLEX_STEP_MINUTES) * FLEX_STEP_MINUTES)
    );
    setFlexBeforeMinutes(snapped);
  }, [maxFlexPerSideMinutes]);

  const handleFlexAfterChange = useCallback((next: number) => {
    const snapped = Math.max(
      0,
      Math.min(maxFlexPerSideMinutes, Math.round(next / FLEX_STEP_MINUTES) * FLEX_STEP_MINUTES)
    );
    setFlexAfterMinutes(snapped);
  }, [maxFlexPerSideMinutes]);

  const handleBook = () => {
    if (!slot) return;
    const startMs = slot.startMs;
    const endMs = startMs + bookingDurationMinutes * 60_000;
    const startIso = new Date(startMs).toISOString();
    const endIso = new Date(endMs).toISOString();

    // Description and flexible limits can be included in body preview or extended props
    const bodyContent = description.trim();

    const event: CalendarEvent = {
      id: `local-${Date.now()}`,
      title: title.trim() || locationLabel || 'Visit',
      time: `${formatTimeMs(startMs)} - ${formatTimeMs(endMs)}`,
      location: (locationForEvent || locationLabel).trim(),
      coordinates: { latitude: coordinates.lat, longitude: coordinates.lon },
      status: 'pending',
      startIso,
      endIso,
      notes: bodyContent || undefined,
      bodyPreview: bodyContent || undefined,
    };

    const contactInput: ContactInput | undefined =
      saveContact && (contactName.trim() || contactEmail.trim())
        ? {
          displayName: contactName.trim() || undefined,
          companyName: contactCompany.trim() || undefined,
          businessPhone: contactPhone.trim() || undefined,
          email: contactEmail.trim() || undefined,
        }
        : undefined;

    onConfirm(event, contactInput, {
      enabled: isFlexible,
      earlyMinutes: isFlexible ? flexEarlyMinutes : 0,
      lateMinutes: isFlexible ? flexLateMinutes : 0,
    });

    setTitle('');
    setDescription('');
    setSaveContact(false);
    setContactName('');
    setContactCompany('');
    setContactPhone('');
    setContactEmail('');
    setBookingDurationMinutes(defaultDurationMinutes);
    setIsFlexible(false);
    setFlexBeforeMinutes(0);
    setFlexAfterMinutes(0);
    onClose();
  };

  if (!slot) return null;
  const displayStartMs = slot.startMs;
  const displayEndMs = displayStartMs + bookingDurationMinutes * 60_000;

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} onPress={onClose} activeOpacity={1} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetWrap}
        >
          <View style={styles.sheet}>
            <View style={styles.header}>
              <Text style={styles.headerTitle}>New Event</Text>
              <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <X color="#605E5C" size={24} />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.scrollView}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={true}
            >
              <View style={styles.titleSection}>
                <TextInput
                  ref={titleInputRef}
                  style={styles.titleInput}
                  value={title}
                  onChangeText={setTitle}
                  placeholder="Add a title"
                  placeholderTextColor="#605E5C"
                  autoFocus
                />
              </View>

              <View style={styles.divider} />

              <View style={styles.formRow}>
                <View style={styles.rowIconBox}>
                  <Users size={20} color="#605E5C" />
                </View>
                <View style={styles.rowContent}>
                  <TextInput
                    style={styles.standardInput}
                    value={contactName}
                    onChangeText={setContactName}
                    placeholder="Invite required attendees (Name)"
                    placeholderTextColor="#605E5C"
                  />
                  <TouchableOpacity
                    style={styles.checkRow}
                    onPress={() => setSaveContact(!saveContact)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.checkbox, saveContact && styles.checkboxChecked]} />
                    <Text style={styles.checkLabel}>Also save as Outlook contact when booking</Text>
                  </TouchableOpacity>
                  {saveContact && (
                    <View style={styles.subFields}>
                      <TextInput
                        style={[styles.standardInput, styles.subInput]}
                        value={contactCompany}
                        onChangeText={setContactCompany}
                        placeholder="Company name"
                        placeholderTextColor="#94a3b8"
                      />
                      <TextInput
                        style={[styles.standardInput, styles.subInput]}
                        value={contactPhone}
                        onChangeText={setContactPhone}
                        placeholder="Business phone"
                        placeholderTextColor="#94a3b8"
                        keyboardType="phone-pad"
                      />
                      <TextInput
                        style={[styles.standardInput, styles.subInput]}
                        value={contactEmail}
                        onChangeText={setContactEmail}
                        placeholder="Email address"
                        placeholderTextColor="#94a3b8"
                        keyboardType="email-address"
                      />
                    </View>
                  )}
                </View>
              </View>

              <View style={styles.divider} />

              <View style={styles.formRow}>
                <View style={styles.rowIconBox}>
                  <Clock size={20} color="#605E5C" />
                </View>
                <View style={styles.rowContent}>
                  <View style={styles.readOnlyTimeBox}>
                    <Text style={styles.dateLabel}>{formatDayLabel(slot.dayIso)}</Text>
                    <Text style={styles.timeLabel}>{formatTimeMs(displayStartMs)} - {formatTimeMs(displayEndMs)}</Text>
                  </View>
                  <View style={styles.rangeBarWrap}>
                    <MeetingDurationFlexTimeline
                      durationMinutes={bookingDurationMinutes}
                      flexBeforeMinutes={flexBeforeMinutes}
                      flexAfterMinutes={flexAfterMinutes}
                      showFlexHandles={isFlexible}
                      onDurationChange={handleTimelineDurationChange}
                      onFlexBeforeChange={handleFlexBeforeChange}
                      onFlexAfterChange={handleFlexAfterChange}
                      maxMinutes={MAX_DURATION_MINUTES}
                      stepMinutes={FLEX_STEP_MINUTES}
                      maxFlexPerSideMinutes={maxFlexPerSideMinutes}
                    />
                  </View>
                  <Text style={styles.durationSummary}>
                    Duration: {formatMinutesLabel(bookingDurationMinutes)}
                  </Text>
                  <View style={styles.flexibleToggleRow}>
                    <View style={styles.flexToggleTextWrap}>
                      <Text style={styles.flexibleLabel}>Flexible meeting time</Text>
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
              </View>

              <View style={styles.divider} />

              <View style={styles.formRow}>
                <View style={styles.rowIconBox}>
                  <MapPin size={20} color="#605E5C" />
                </View>
                <View style={styles.rowContent}>
                  <View style={styles.readOnlyInput}>
                    <Text style={styles.readOnlyText}>{locationLabel || '(No address)'}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.divider} />

              <View style={styles.formRow}>
                <View style={styles.rowIconBox}>
                  <AlignLeft size={20} color="#605E5C" />
                </View>
                <View style={styles.rowContent}>
                  <TextInput
                    style={[styles.textArea, { minHeight: 120 }]}
                    value={description}
                    onChangeText={setDescription}
                    placeholder="Add a description"
                    placeholderTextColor="#605E5C"
                    multiline
                    textAlignVertical="top"
                  />
                </View>
              </View>

            </ScrollView>

            <View style={styles.footer}>
              <TouchableOpacity style={styles.bookBtn} onPress={handleBook} activeOpacity={0.8}>
                <Text style={styles.bookBtnText}>
                  {saveContact && (contactName.trim() || contactEmail.trim())
                    ? 'Book meeting & Save contact'
                    : 'Book meeting'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheetWrap: {
    flex: 1,
    maxHeight: '90%',
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  sheet: {
    flex: 1,
    minHeight: 0,
    maxHeight: '100%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 0,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#edebe9',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#323130',
  },
  closeBtn: {
    padding: 4,
  },
  scrollView: {
    flex: 1,
    minHeight: 0,
  },
  bodyContent: {
    padding: 20,
    paddingBottom: 40,
  },
  titleSection: {
    marginBottom: 8,
  },
  titleInput: {
    fontSize: 24,
    fontWeight: '600',
    color: '#323130',
    paddingVertical: 8,
  },
  divider: {
    height: 1,
    backgroundColor: '#edebe9',
    marginVertical: 16,
  },
  formRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  rowIconBox: {
    width: 40,
    alignItems: 'flex-start',
    paddingTop: 12,
  },
  rowContent: {
    flex: 1,
  },
  standardInput: {
    fontSize: 16,
    color: '#323130',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'transparent',
  },
  subFields: {
    marginTop: 8,
    marginLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: '#edebe9',
    paddingLeft: 12,
  },
  subInput: {
    fontSize: 15,
    borderBottomColor: '#edebe9',
    marginBottom: 8,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#94a3b8',
    marginRight: 10,
  },
  checkboxChecked: {
    backgroundColor: MS_BLUE,
    borderColor: MS_BLUE,
  },
  checkLabel: {
    fontSize: 14,
    color: '#605E5C',
  },
  readOnlyTimeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  dateLabel: {
    fontSize: 16,
    color: '#323130',
    marginRight: 12,
  },
  timeLabel: {
    fontSize: 16,
    color: '#323130',
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
  flexibleToggleRow: {
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
  flexibleLabel: {
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
  readOnlyInput: {
    paddingVertical: 10,
  },
  readOnlyText: {
    fontSize: 16,
    color: '#323130',
  },
  textArea: {
    fontSize: 16,
    color: '#323130',
    paddingVertical: 10,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#edebe9',
    backgroundColor: '#fff',
  },
  bookBtn: {
    backgroundColor: MS_BLUE,
    paddingVertical: 14,
    borderRadius: 6,
    alignItems: 'center',
  },
  bookBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
