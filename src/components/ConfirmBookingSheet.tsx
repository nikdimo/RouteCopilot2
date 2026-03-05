import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type LayoutChangeEvent,
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
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { X, Users, Clock, MapPin, AlignLeft } from 'lucide-react-native';
import type { ScoredSlot } from '../utils/scheduler';
import type { CalendarEvent } from '../services/graph';
import type { Coordinate } from '../utils/scheduler';

const MS_BLUE = '#0078D4';
const FLEX_STEP_MINUTES = 15;
const FLEX_SLOTS_PER_DAY = (24 * 60) / FLEX_STEP_MINUTES;
const FLEX_MAX_SLOT = FLEX_SLOTS_PER_DAY - 1;
const FLEX_TRACK_HEIGHT = 8;
const FLEX_THUMB_SIZE = 24;

type FlexibleRangeSliderProps = {
  startSlot15: number;
  endSlot15: number;
  onStartChange: (slot15: number) => void;
  onEndChange: (slot15: number) => void;
  onSlidingComplete: () => void;
  canEdit: boolean;
  onDragStateChange?: (dragging: boolean) => void;
};

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

function formatSlot15(slot15: number): string {
  const totalMinutes = Math.max(0, Math.min(FLEX_MAX_SLOT, Math.round(slot15))) * FLEX_STEP_MINUTES;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function msToSlot15(ms: number): number {
  const date = new Date(ms);
  const totalMinutes = date.getHours() * 60 + date.getMinutes();
  return Math.max(0, Math.min(FLEX_MAX_SLOT, Math.round(totalMinutes / FLEX_STEP_MINUTES)));
}

function formatMinutesLabel(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  if (safe < 60) return `${safe}m`;
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function FlexibleRangeSlider({
  startSlot15,
  endSlot15,
  onStartChange,
  onEndChange,
  onSlidingComplete,
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
    const slot = Math.round(pct * FLEX_MAX_SLOT);
    return Math.max(0, Math.min(FLEX_MAX_SLOT, slot));
  }, []);

  const setDragging = useCallback(
    (dragging: boolean) => {
      onDragStateChange?.(dragging);
    },
    [onDragStateChange]
  );

  const handleStartUpdate = useCallback(
    (absoluteX: number) => {
      const slot = absoluteXToSlot15(absoluteX);
      const clamped = Math.min(slot, endSlot15 - 1);
      onStartChange(Math.max(0, clamped));
    },
    [absoluteXToSlot15, endSlot15, onStartChange]
  );

  const handleEndUpdate = useCallback(
    (absoluteX: number) => {
      const slot = absoluteXToSlot15(absoluteX);
      const clamped = Math.max(slot, startSlot15 + 1);
      onEndChange(Math.min(FLEX_MAX_SLOT, clamped));
    },
    [absoluteXToSlot15, onEndChange, startSlot15]
  );

  const handleComplete = useCallback(() => {
    onSlidingComplete();
    onDragStateChange?.(false);
  }, [onSlidingComplete, onDragStateChange]);

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
          runOnJS(handleComplete)();
        }),
    [canEdit, handleComplete, handleStartUpdate, setDragging]
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
          runOnJS(handleComplete)();
        }),
    [canEdit, handleComplete, handleEndUpdate, setDragging]
  );

  const startLeft = (startSlot15 / FLEX_MAX_SLOT) * trackWidth - FLEX_THUMB_SIZE / 2;
  const endLeft = (endSlot15 / FLEX_MAX_SLOT) * trackWidth - FLEX_THUMB_SIZE / 2;
  const fillLeft = (startSlot15 / FLEX_MAX_SLOT) * trackWidth;
  const fillWidth = ((endSlot15 - startSlot15) / FLEX_MAX_SLOT) * trackWidth;

  return (
    <View ref={trackRef} onLayout={onTrackLayout} style={styles.flexSliderShell} pointerEvents="box-none">
      <View style={[styles.flexRangeTrack, { height: FLEX_TRACK_HEIGHT }]} pointerEvents="none">
        <View
          style={[
            styles.flexRangeFill,
            { left: fillLeft, width: Math.max(0, fillWidth), height: FLEX_TRACK_HEIGHT },
          ]}
        />
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

export type ContactInput = {
  displayName?: string;
  companyName?: string;
  businessPhone?: string;
  email?: string;
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
  onConfirm: (event: CalendarEvent, contactInput?: ContactInput) => void;
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
}: ConfirmBookingSheetProps) {
  const titleInputRef = useRef<TextInput>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const [saveContact, setSaveContact] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactCompany, setContactCompany] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  const [isFlexible, setIsFlexible] = useState(false);
  const [flexStartSlot15, setFlexStartSlot15] = useState(0);
  const [flexEndSlot15, setFlexEndSlot15] = useState(0);
  const [isFlexDragging, setIsFlexDragging] = useState(false);

  const anchorSlot15 = useMemo(() => {
    if (!slot) return 0;
    return msToSlot15(slot.startMs);
  }, [slot]);

  const resetFlexWindow = useCallback(() => {
    const defaultStart = Math.max(0, anchorSlot15 - 2);
    const defaultEnd = Math.min(FLEX_MAX_SLOT, anchorSlot15 + 2);
    setFlexStartSlot15(defaultStart);
    setFlexEndSlot15(Math.max(defaultStart + 1, defaultEnd));
  }, [anchorSlot15]);

  useEffect(() => {
    if (!visible || !slot) return;
    resetFlexWindow();
    setIsFlexible(false);
    setIsFlexDragging(false);
  }, [resetFlexWindow, slot, visible]);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      titleInputRef.current?.focus();
    }, 80);
    return () => clearTimeout(timer);
  }, [visible]);

  const flexEarlyMinutes = Math.max(0, (anchorSlot15 - flexStartSlot15) * FLEX_STEP_MINUTES);
  const flexLateMinutes = Math.max(0, (flexEndSlot15 - anchorSlot15) * FLEX_STEP_MINUTES);

  const handleFlexibleToggle = useCallback(
    (next: boolean) => {
      setIsFlexible(next);
      if (next) resetFlexWindow();
    },
    [resetFlexWindow]
  );

  const handleBook = () => {
    if (!slot) return;
    const startIso = new Date(slot.startMs).toISOString();
    const endIso = new Date(slot.endMs).toISOString();

    // Description and flexible limits can be included in body preview or extended props
    const bodyContent = [
      description.trim(),
      isFlexible
        ? `[Flexible Window: ${formatSlot15(flexStartSlot15)} to ${formatSlot15(flexEndSlot15)} | Early ${formatMinutesLabel(flexEarlyMinutes)}, Late ${formatMinutesLabel(flexLateMinutes)}]`
        : ''
    ].filter(Boolean).join('\n\n');

    const event: CalendarEvent = {
      id: `local-${Date.now()}`,
      title: title.trim() || locationLabel || 'Visit',
      time: `${formatTimeMs(slot.startMs)} - ${formatTimeMs(slot.endMs)}`,
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

    onConfirm(event, contactInput);

    setTitle('');
    setDescription('');
    setSaveContact(false);
    setContactName('');
    setContactCompany('');
    setContactPhone('');
    setContactEmail('');
    setIsFlexible(false);
    setIsFlexDragging(false);
    onClose();
  };

  if (!slot) return null;

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
              scrollEnabled={!isFlexDragging}
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
                    <Text style={styles.timeLabel}>{formatTimeMs(slot.startMs)} – {formatTimeMs(slot.endMs)}</Text>
                  </View>
                  <View style={styles.flexibleToggleRow}>
                    <Text style={styles.flexibleLabel}>Flexible meeting time</Text>
                    <Switch
                      value={isFlexible}
                      onValueChange={handleFlexibleToggle}
                      trackColor={{ false: '#767577', true: '#cce3f5' }}
                      thumbColor={isFlexible ? MS_BLUE : '#f4f3f4'}
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
                        onStartChange={setFlexStartSlot15}
                        onEndChange={setFlexEndSlot15}
                        onSlidingComplete={() => {}}
                        onDragStateChange={setIsFlexDragging}
                        canEdit
                      />
                      <View style={styles.flexSummaryRow}>
                        <Text style={styles.flexOffsetText}>Early {formatMinutesLabel(flexEarlyMinutes)}</Text>
                        <Text style={styles.flexOffsetText}>Late {formatMinutesLabel(flexLateMinutes)}</Text>
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
  flexibleToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    marginTop: 4,
  },
  flexibleLabel: {
    fontSize: 15,
    color: '#323130',
  },
  flexRangeWrap: {
    marginTop: 8,
    paddingBottom: 4,
  },
  flexSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  flexOptionLabel: {
    fontSize: 13,
    color: '#605E5C',
  },
  flexOffsetText: {
    fontSize: 12,
    color: '#605E5C',
  },
  flexSliderShell: {
    height: 40,
    justifyContent: 'center',
    width: '100%',
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
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: MS_BLUE,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
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
