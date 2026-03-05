import React, { useState } from 'react';
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
import { X, Users, Clock, MapPin, AlignLeft, ChevronDown } from 'lucide-react-native';
import type { ScoredSlot } from '../utils/scheduler';
import type { CalendarEvent } from '../services/graph';
import type { Coordinate } from '../utils/scheduler';

const MS_BLUE = '#0078D4';

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

const FLEX_OPTS = ['0m', '5m', '10m', '15m', '30m', '45m', '60m'];

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
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const [saveContact, setSaveContact] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactCompany, setContactCompany] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  const [isFlexible, setIsFlexible] = useState(false);
  const [flexPlus, setFlexPlus] = useState('15m');
  const [flexMinus, setFlexMinus] = useState('15m');

  const cyclePlus = () => setFlexPlus(p => FLEX_OPTS[(FLEX_OPTS.indexOf(p) + 1) % FLEX_OPTS.length]!);
  const cycleMinus = () => setFlexMinus(p => FLEX_OPTS[(FLEX_OPTS.indexOf(p) + 1) % FLEX_OPTS.length]!);

  const handleBook = () => {
    if (!slot) return;
    const startIso = new Date(slot.startMs).toISOString();
    const endIso = new Date(slot.endMs).toISOString();

    // Description and flexible limits can be included in body preview or extended props
    const bodyContent = [
      description.trim(),
      isFlexible ? `[Flexible Limits: Early ${flexMinus}, Late ${flexPlus}]` : ''
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
            >
              <View style={styles.titleSection}>
                <TextInput
                  style={styles.titleInput}
                  value={title}
                  onChangeText={setTitle}
                  placeholder="Add a title"
                  placeholderTextColor="#605E5C"
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
                      onValueChange={setIsFlexible}
                      trackColor={{ false: '#767577', true: '#cce3f5' }}
                      thumbColor={isFlexible ? MS_BLUE : '#f4f3f4'}
                    />
                  </View>
                  {isFlexible && (
                    <View style={styles.flexOptionsRow}>
                      <View style={styles.flexOptionItem}>
                        <Text style={styles.flexOptionLabel}>Early limits (-)</Text>
                        <TouchableOpacity style={styles.pickerFake} onPress={cycleMinus} activeOpacity={0.7}>
                          <Text style={styles.pickerFakeText}>{flexMinus}</Text>
                          <ChevronDown size={16} color="#605E5C" />
                        </TouchableOpacity>
                      </View>
                      <View style={styles.flexOptionItem}>
                        <Text style={styles.flexOptionLabel}>Late limits (+)</Text>
                        <TouchableOpacity style={styles.pickerFake} onPress={cyclePlus} activeOpacity={0.7}>
                          <Text style={styles.pickerFakeText}>{flexPlus}</Text>
                          <ChevronDown size={16} color="#605E5C" />
                        </TouchableOpacity>
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
  flexOptionsRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 8,
  },
  flexOptionItem: {
    flex: 1,
  },
  flexOptionLabel: {
    fontSize: 13,
    color: '#605E5C',
    marginBottom: 4,
  },
  pickerFake: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#edebe9',
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },
  pickerFakeText: {
    fontSize: 15,
    color: '#323130',
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
