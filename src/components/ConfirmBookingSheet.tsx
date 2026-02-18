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
} from 'react-native';
import { X } from 'lucide-react-native';
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
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
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
  const [title, setTitle] = useState('');
  const [saveContact, setSaveContact] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactCompany, setContactCompany] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  const handleBook = () => {
    if (!slot) return;
    const startIso = new Date(slot.startMs).toISOString();
    const endIso = new Date(slot.endMs).toISOString();
    const event: CalendarEvent = {
      id: `local-${Date.now()}`,
      title: title.trim() || locationLabel || 'Visit',
      time: `${formatTimeMs(slot.startMs)} - ${formatTimeMs(slot.endMs)}`,
      location: (locationForEvent || locationLabel).trim(),
      coordinates: { latitude: coordinates.lat, longitude: coordinates.lon },
      status: 'pending',
      startIso,
      endIso,
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
    setSaveContact(false);
    setContactName('');
    setContactCompany('');
    setContactPhone('');
    setContactEmail('');
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
              <Text style={styles.title}>Confirm booking</Text>
              <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <X color="#1a1a1a" size={24} />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.scrollView}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={true}
            >
              <Text style={styles.summary}>
                {formatDayLabel(slot.dayIso)} @ {formatTimeMs(slot.startMs)} – {formatTimeMs(slot.endMs)}
              </Text>
              <Text style={styles.location}>📍 {locationLabel || '(No address)'}</Text>
              <View style={styles.field}>
                <Text style={styles.label}>Title / Client name</Text>
                <TextInput
                  style={styles.input}
                  value={title}
                  onChangeText={setTitle}
                  placeholder="e.g. Client A, Follow-up"
                  placeholderTextColor="#94a3b8"
                />
              </View>
              <TouchableOpacity
                style={styles.checkRow}
                onPress={() => setSaveContact(!saveContact)}
                activeOpacity={0.7}
              >
                <View style={[styles.checkbox, saveContact && styles.checkboxChecked]} />
                <Text style={styles.checkLabel}>Also save as Outlook contact when booking</Text>
              </TouchableOpacity>
              {saveContact && (
                <>
                  <View style={styles.field}>
                    <Text style={styles.label}>Contact name</Text>
                    <TextInput
                      style={styles.input}
                      value={contactName}
                      onChangeText={setContactName}
                      placeholder="Full name"
                      placeholderTextColor="#94a3b8"
                    />
                  </View>
                  <View style={styles.field}>
                    <Text style={styles.label}>Company</Text>
                    <TextInput
                      style={styles.input}
                      value={contactCompany}
                      onChangeText={setContactCompany}
                      placeholder="Company name"
                      placeholderTextColor="#94a3b8"
                    />
                  </View>
                  <View style={styles.field}>
                    <Text style={styles.label}>Phone</Text>
                    <TextInput
                      style={styles.input}
                      value={contactPhone}
                      onChangeText={setContactPhone}
                      placeholder="Business phone"
                      placeholderTextColor="#94a3b8"
                      keyboardType="phone-pad"
                    />
                  </View>
                  <View style={styles.field}>
                    <Text style={styles.label}>Email</Text>
                    <TextInput
                      style={styles.input}
                      value={contactEmail}
                      onChangeText={setContactEmail}
                      placeholder="Email address"
                      placeholderTextColor="#94a3b8"
                      keyboardType="email-address"
                    />
                  </View>
                </>
              )}
            </ScrollView>
            <TouchableOpacity style={styles.bookBtn} onPress={handleBook} activeOpacity={0.8}>
              <Text style={styles.bookBtnText}>
                {saveContact && (contactName.trim() || contactEmail.trim())
                  ? 'Book meeting + Save contact'
                  : 'Book meeting'}
              </Text>
            </TouchableOpacity>
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
    maxHeight: '85%',
    width: '100%',
  },
  sheet: {
    flex: 1,
    minHeight: 0,
    maxHeight: '100%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E1DFDD',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  closeBtn: {
    padding: 4,
  },
  scrollView: {
    flex: 1,
    minHeight: 0,
  },
  bodyContent: {
    padding: 16,
    paddingBottom: 24,
  },
  summary: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 6,
  },
  location: {
    fontSize: 14,
    color: '#605E5C',
    marginBottom: 20,
  },
  field: {
    marginBottom: 12,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#605E5C',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#E1DFDD',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1a1a1a',
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  checkbox: {
    width: 22,
    height: 22,
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
  bookBtn: {
    backgroundColor: MS_BLUE,
    marginHorizontal: 16,
    marginTop: 12,
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  bookBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
