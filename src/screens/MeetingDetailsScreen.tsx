import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ScheduleStackParamList } from '../navigation/ScheduleStack';
import { MapPin, Trash2, Check, Circle, X, Clock, AlignLeft, Calendar } from 'lucide-react-native';
import { useAuth } from '../context/AuthContext';
import { useRoute as useRouteContext } from '../context/RouteContext';
import { useUserPreferences } from '../context/UserPreferencesContext';
import { openNativeDirections } from '../utils/maps';
import {
  updateCalendarEvent,
  deleteCalendarEvent,
} from '../services/graph';
import { getEffectiveSubscriptionTier, getTierEntitlements } from '../utils/subscription';

const MS_BLUE = '#2563EB'; // Vibrant Blue
const RED = '#EF4444'; // Modern Red

type MeetingDetailsNav = NativeStackNavigationProp<ScheduleStackParamList, 'MeetingDetails'>;
type MeetingDetailsRoute = RouteProp<ScheduleStackParamList, 'MeetingDetails'>;

export default function MeetingDetailsScreen() {
  const navigation = useNavigation<MeetingDetailsNav>();
  const route = useRoute<MeetingDetailsRoute>();
  const { getValidToken, userToken } = useAuth();
  const { preferences } = useUserPreferences();
  const subscriptionTier = getEffectiveSubscriptionTier(preferences, Boolean(userToken));
  const { canSyncCalendar } = getTierEntitlements(subscriptionTier);
  const { appointments, updateAppointment, removeAppointment, markEventAsDone, unmarkEventAsDone } =
    useRouteContext();

  const eventId = route.params?.eventId ?? '';
  const event = appointments.find((e) => e.id === eventId);

  const [title, setTitle] = useState('');
  const [timeRange, setTimeRange] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (event) {
      setTitle(event.title ?? '');
      setTimeRange(event.time ?? '');
      setLocation(event.location ?? '');
      setNotes(event.notes ?? '');
    }
  }, [event?.id]);

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

  const handleSave = async () => {
    const patch = {
      title: title.trim() || event.title,
      time: timeRange.trim() || event.time,
      location: location.trim() || event.location,
      notes: notes.trim() || undefined,
    };
    const baseDate = event.startIso ? new Date(event.startIso) : new Date();
    const [startStr, endStr] = (timeRange || event.time || '09:00 - 10:00')
      .split('-')
      .map((s) => s?.trim());
    const [sh, sm] = (startStr || '09:00').split(':').map((x) => parseInt(x || '0', 10));
    const [eh, em] = (endStr || '10:00').split(':').map((x) => parseInt(x || '0', 10));
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

    if (canSyncCalendar && token && isGraphEvent) {
      const result = await updateCalendarEvent(token, eventId, {
        subject: patch.title,
        startIso: new Date(newStartMs).toISOString(),
        endIso: new Date(newEndMs).toISOString(),
        location: patch.location,
        body: patch.notes,
      });
      if (result.success && result.event) {
        updateAppointment(eventId, result.event);
      } else {
        if (!result.success && result.needsConsent) {
          Alert.alert(
            'Permission needed',
            'Grant Calendars.ReadWrite to sync changes to Outlook. Saved locally.',
            [{ text: 'OK' }]
          );
        }
        updateAppointment(eventId, {
          ...patch,
          startIso: new Date(newStartMs).toISOString(),
          endIso: new Date(newEndMs).toISOString(),
        });
      }
    } else {
      updateAppointment(eventId, {
        ...patch,
        startIso: new Date(newStartMs).toISOString(),
        endIso: new Date(newEndMs).toISOString(),
      });
    }
    navigation.goBack();
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete meeting',
      'Are you sure? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const token = getValidToken ? await getValidToken() : null;
            const isGraphEvent = !eventId.startsWith('local-');
            if (canSyncCalendar && token && isGraphEvent) {
              const result = await deleteCalendarEvent(token, eventId);
              if (!result.success && result.needsConsent) {
                Alert.alert(
                  'Permission needed',
                  'Grant Calendars.ReadWrite to delete from Outlook. Removed locally.',
                  [{ text: 'OK' }]
                );
              }
            }
            removeAppointment(eventId);
            navigation.goBack();
          },
        },
      ]
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
              onChangeText={setTitle}
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
              onChangeText={setTimeRange}
              placeholder="09:00 - 10:00"
              placeholderTextColor="#94A3B8"
            />
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
              onChangeText={setLocation}
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
              onChangeText={setNotes}
              placeholder="Notes (optional)"
              placeholderTextColor="#94A3B8"
              multiline
              numberOfLines={4}
            />
          </View>

          {/* Actions */}
          <View style={styles.actionsBox}>
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
