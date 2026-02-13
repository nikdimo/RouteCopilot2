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
import { MapPin, Trash2, Check, Circle } from 'lucide-react-native';
import { useAuth } from '../context/AuthContext';
import { useRoute as useRouteContext } from '../context/RouteContext';
import { openNativeDirections } from '../utils/maps';
import {
  updateCalendarEvent,
  deleteCalendarEvent,
  type CalendarEvent,
} from '../services/graph';

const MS_BLUE = '#0078D4';
const RED = '#D13438';

type MeetingDetailsNav = NativeStackNavigationProp<ScheduleStackParamList, 'MeetingDetails'>;
type MeetingDetailsRoute = RouteProp<ScheduleStackParamList, 'MeetingDetails'>;

export default function MeetingDetailsScreen() {
  const navigation = useNavigation<MeetingDetailsNav>();
  const route = useRoute<MeetingDetailsRoute>();
  const { getValidToken } = useAuth();
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

    if (token && isGraphEvent) {
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
            if (token && isGraphEvent) {
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
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.section}>
          <Text style={styles.label}>Done</Text>
          <TouchableOpacity
            style={styles.doneRow}
            onPress={handleToggleDone}
            activeOpacity={0.8}
          >
            {isCompleted ? (
              <View style={styles.checkDone}>
                <Check color="#fff" size={18} strokeWidth={3} />
              </View>
            ) : (
              <Circle color="#107C10" size={28} />
            )}
            <Text style={styles.doneLabel}>
              {isCompleted ? 'Completed' : 'Mark as completed'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Title</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Meeting title"
            placeholderTextColor="#94a3b8"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Time</Text>
          <TextInput
            style={styles.input}
            value={timeRange}
            onChangeText={setTimeRange}
            placeholder="09:00 - 10:00"
            placeholderTextColor="#94a3b8"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Address / Location</Text>
          <TextInput
            style={styles.input}
            value={location}
            onChangeText={setLocation}
            placeholder="Address"
            placeholderTextColor="#94a3b8"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Notes</Text>
          <TextInput
            style={[styles.input, styles.notesInput]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Notes (optional)"
            placeholderTextColor="#94a3b8"
            multiline
            numberOfLines={4}
          />
        </View>

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
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F2F1',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  errorText: {
    fontSize: 16,
    color: '#605E5C',
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
  section: {
    marginBottom: 20,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#605E5C',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#E1DFDD',
  },
  notesInput: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E1DFDD',
  },
  checkDone: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#107C10',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneLabel: {
    fontSize: 16,
    marginLeft: 12,
    color: '#1a1a1a',
  },
  mapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: MS_BLUE,
    marginBottom: 12,
  },
  mapBtnDisabled: {
    borderColor: '#94a3b8',
    opacity: 0.7,
  },
  mapBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: MS_BLUE,
    marginLeft: 8,
  },
  mapBtnTextDisabled: {
    color: '#94a3b8',
  },
  saveBtn: {
    backgroundColor: MS_BLUE,
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: RED,
    borderRadius: 8,
  },
  deleteBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: RED,
    marginLeft: 8,
  },
});
