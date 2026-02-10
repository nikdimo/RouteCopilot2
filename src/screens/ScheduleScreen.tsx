import React, { useState, useLayoutEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ListRenderItem,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ScheduleStackParamList } from '../navigation/ScheduleStack';
import { Plus } from 'lucide-react-native';
import { startOfDay, endOfDay, isSameDay, format } from 'date-fns';
import DaySlider from '../components/DaySlider';
import MeetingCard from '../components/MeetingCard';
import { useAuth } from '../context/AuthContext';
import { useRoute } from '../context/RouteContext';
import { getCalendarEvents, type CalendarEvent } from '../services/graph';
import { sortAppointmentsByTime } from '../utils/optimization';

const GREEN = '#107C10';

export type MeetingItem = {
  id: string;
  timeRange: string;
  client: string;
  address: string;
  statusColor: string;
};

function eventToMeetingItem(ev: CalendarEvent): MeetingItem {
  return {
    id: ev.id,
    timeRange: ev.time,
    client: ev.title,
    address: ev.location,
    statusColor: GREEN,
  };
}

const TODAY = startOfDay(new Date());

function EmptySchedule() {
  return (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyText}>No visits scheduled for this week.</Text>
    </View>
  );
}

type ScheduleNav = NativeStackNavigationProp<ScheduleStackParamList, 'ScheduleHome'>;

export default function ScheduleScreen() {
  const navigation = useNavigation<ScheduleNav>();
  const { userToken } = useAuth();
  const { appointments, setAppointments } = useRoute();
  const [selectedDate, setSelectedDate] = useState<Date>(TODAY);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meetings = (appointments ?? []).map(eventToMeetingItem);

  const fetchData = useCallback(() => {
    if (!userToken) {
      setAppointments([]);
      return;
    }
    const start = startOfDay(selectedDate);
    const end = endOfDay(selectedDate);
    setLoading(true);
    setError(null);
    getCalendarEvents(userToken, start, end)
      .then((events) => {
        const sorted = sortAppointmentsByTime(events);
        setAppointments(sorted);
      })
      .catch((e) => {
        setAppointments([]);
        setError(e instanceof Error ? e.message : 'Failed to load events');
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [userToken, selectedDate, setAppointments]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  const headerTitle = isSameDay(selectedDate, TODAY)
    ? "Today's Route"
    : format(selectedDate, 'EEE, MMM d');

  useLayoutEffect(() => {
    navigation.setOptions({ headerTitle });
  }, [navigation, headerTitle]);

  const renderItem: ListRenderItem<MeetingItem> = ({ item }) => (
    <MeetingCard
      timeRange={item.timeRange}
      client={item.client}
      address={item.address}
      statusColor={item.statusColor}
      onNavigate={() => {}}
    />
  );

  return (
    <View style={styles.container}>
      <DaySlider
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
      />
      {loading && !refreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#0078D4" />
        </View>
      ) : error ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={meetings}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={
            meetings.length === 0 ? styles.listEmpty : styles.listContent
          }
          ListEmptyComponent={EmptySchedule}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={['#0078D4']}
              tintColor="#0078D4"
            />
          }
        />
      )}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('AddMeeting')}
        activeOpacity={0.9}
      >
        <Plus color="#fff" size={28} strokeWidth={2.5} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F2F1',
  },
  listContent: {
    padding: 16,
    paddingBottom: 88,
  },
  listEmpty: {
    flex: 1,
    paddingBottom: 88,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  emptyText: {
    fontSize: 16,
    color: '#605E5C',
    textAlign: 'center',
  },
  errorText: {
    fontSize: 14,
    color: '#D13438',
    textAlign: 'center',
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#0078D4',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
});
