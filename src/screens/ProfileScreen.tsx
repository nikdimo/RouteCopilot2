import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useUserPreferences } from '../context/UserPreferencesContext';
import LocationSearch, { type LocationSelection } from '../components/LocationSearch';
import { searchContacts } from '../services/graph';
import { geocodeAddress, geocodeContactAddress, getAddressSuggestions } from '../utils/geocoding';
import { DEFAULT_WORKING_DAYS, DEFAULT_HOME_BASE, type WorkingDays } from '../types';

function parseTime(s: string): string {
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return s;
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
}

function parseNumber(s: string, min: number, max: number): number {
  const n = parseInt(s, 10);
  if (isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export default function ProfileScreen() {
  const { userToken, getValidToken, signOut } = useAuth();
  const { preferences, updatePreferences } = useUserPreferences();
  const [preBuffer, setPreBuffer] = useState((preferences.preMeetingBuffer ?? 15).toString());
  const [postBuffer, setPostBuffer] = useState((preferences.postMeetingBuffer ?? 15).toString());
  const [distanceThreshold, setDistanceThreshold] = useState((preferences.distanceThresholdKm ?? 30).toString());
  const [workStart, setWorkStart] = useState(preferences.workingHours?.start ?? '08:00');
  const [workEnd, setWorkEnd] = useState(preferences.workingHours?.end ?? '17:00');
  const workingDays = preferences.workingDays ?? DEFAULT_WORKING_DAYS;

  const token = userToken ?? null;

  const homeBaseSelection: LocationSelection = useMemo(() => {
    const hb = preferences.homeBase;
    const label = preferences.homeBaseLabel?.trim();
    if (hb && label) {
      return { type: 'address', address: label, coords: { lat: hb.lat, lon: hb.lon } };
    }
    return { type: 'none' };
  }, [preferences.homeBase, preferences.homeBaseLabel]);

  const handleHomeBaseChange = (sel: LocationSelection) => {
    if (sel.type === 'contact' && sel.contact.hasAddress) {
      updatePreferences({
        homeBase: { lat: sel.coords.lat, lon: sel.coords.lon },
        homeBaseLabel: sel.contact.formattedAddress || sel.contact.displayName,
      });
    } else if (sel.type === 'address') {
      updatePreferences({
        homeBase: { lat: sel.coords.lat, lon: sel.coords.lon },
        homeBaseLabel: sel.address,
      });
    } else if (sel.type === 'none') {
      updatePreferences({
        homeBase: undefined,
        homeBaseLabel: undefined,
      });
    }
  };

  useEffect(() => {
    setPreBuffer((preferences.preMeetingBuffer ?? 15).toString());
    setPostBuffer((preferences.postMeetingBuffer ?? 15).toString());
    setDistanceThreshold((preferences.distanceThresholdKm ?? 30).toString());
    setWorkStart(preferences.workingHours.start);
    setWorkEnd(preferences.workingHours.end);
  }, [preferences]);

  const savePreBuffer = () => {
    const n = parseNumber(preBuffer, 0, 60);
    updatePreferences({ preMeetingBuffer: n });
    setPreBuffer(n.toString());
  };

  const savePostBuffer = () => {
    const n = parseNumber(postBuffer, 0, 60);
    updatePreferences({ postMeetingBuffer: n });
    setPostBuffer(n.toString());
  };

  const saveDistanceThreshold = () => {
    const n = parseNumber(distanceThreshold, 5, 300);
    updatePreferences({ distanceThresholdKm: n });
    setDistanceThreshold(n.toString());
  };

  const saveWorkingHours = () => {
    updatePreferences({
      workingHours: {
        start: parseTime(workStart),
        end: parseTime(workEnd),
      },
    });
    setWorkStart(parseTime(workStart));
    setWorkEnd(parseTime(workEnd));
  };

  const toggleWorkingDay = (dayIndex: number) => {
    const next: WorkingDays = [...workingDays] as WorkingDays;
    next[dayIndex] = !next[dayIndex];
    updatePreferences({ workingDays: next });
  };

  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Smart Scheduling</Text>
      <Text style={styles.sectionSubtitle}>
        These settings drive how the app suggests visit times.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Home Base (Start/End Address)</Text>
        <Text style={styles.hint}>
          Search contacts or addresses, same as when creating meetings. Tap the X to clear, or tap the field and type to change.
        </Text>
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
          selection={homeBaseSelection}
          onSelectionChange={handleHomeBaseChange}
          placeholder="Search contacts or address (e.g. Copenhagen, Office)"
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Pre-Meeting Buffer</Text>
        <Text style={styles.hint}>Minutes reserved before a meeting start (parking, check-in).</Text>
        <View style={styles.row}>
          <TextInput
            style={styles.input}
            value={preBuffer}
            onChangeText={setPreBuffer}
            onBlur={savePreBuffer}
            keyboardType="number-pad"
            placeholder="15"
            placeholderTextColor="#94a3b8"
          />
          <Text style={styles.unit}>min</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Post-Meeting Buffer</Text>
        <Text style={styles.hint}>Minutes reserved after a meeting end (overrun, wrap-up).</Text>
        <View style={styles.row}>
          <TextInput
            style={styles.input}
            value={postBuffer}
            onChangeText={setPostBuffer}
            onBlur={savePostBuffer}
            keyboardType="number-pad"
            placeholder="15"
            placeholderTextColor="#94a3b8"
          />
          <Text style={styles.unit}>min</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Max Detour Distance</Text>
        <Text style={styles.hint}>Same-day slot skipped when detour &gt; threshold km; empty day suggested instead.</Text>
        <View style={styles.row}>
          <TextInput
            style={styles.input}
            value={distanceThreshold}
            onChangeText={setDistanceThreshold}
            onBlur={saveDistanceThreshold}
            keyboardType="number-pad"
            placeholder="30"
            placeholderTextColor="#94a3b8"
          />
          <Text style={styles.unit}>km</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Working Days</Text>
        <Text style={styles.hint}>Non-working days are excluded from slot suggestions (e.g. Sun/Sat off).</Text>
        <View style={styles.workingDaysRow}>
          {DAY_LABELS.map((label, i) => (
            <TouchableOpacity
              key={label}
              style={[styles.dayPill, workingDays[i] && styles.dayPillActive]}
              onPress={() => toggleWorkingDay(i)}
              activeOpacity={0.8}
            >
              <Text style={[styles.dayPillText, workingDays[i] && styles.dayPillTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Working Hours</Text>
        <Text style={styles.hint}>No travel or meeting can extend beyond end time.</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.timeInput]}
            value={workStart}
            onChangeText={setWorkStart}
            onBlur={saveWorkingHours}
            placeholder="08:00"
            placeholderTextColor="#94a3b8"
          />
          <Text style={styles.dash}>–</Text>
          <TextInput
            style={[styles.input, styles.timeInput]}
            value={workEnd}
            onChangeText={setWorkEnd}
            onBlur={saveWorkingHours}
            placeholder="17:00"
            placeholderTextColor="#94a3b8"
          />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Sign out</Text>
        <Text style={styles.hint}>
          When you sign out, your session ends and you will need to sign in again to access your calendar.
          The schedule and meetings currently loaded in the app will be cleared. Your profile settings (home base, buffers, working days) stay saved on this device.
        </Text>
        <TouchableOpacity
          style={styles.signOutButton}
          onPress={signOut}
          activeOpacity={0.8}
        >
          <Text style={styles.signOutButtonText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F2F1',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#605E5C',
    marginBottom: 20,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 6,
  },
  hint: {
    fontSize: 13,
    color: '#605E5C',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowMargin: {
    marginTop: 8,
  },
  input: {
    backgroundColor: '#E1DFDD',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1a1a1a',
    minWidth: 80,
  },
  timeInput: {
    minWidth: 70,
  },
  fullInput: {
    minWidth: '100%',
  },
  unit: {
    fontSize: 14,
    color: '#605E5C',
    marginLeft: 10,
  },
  dash: {
    fontSize: 16,
    color: '#605E5C',
    marginHorizontal: 10,
  },
  workingDaysRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  dayPill: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#E1DFDD',
    minWidth: 44,
    alignItems: 'center',
  },
  dayPillActive: {
    backgroundColor: '#0078D4',
  },
  dayPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#605E5C',
  },
  dayPillTextActive: {
    color: '#fff',
  },
  signOutButton: {
    backgroundColor: '#D13438',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginTop: 8,
  },
  signOutButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});
