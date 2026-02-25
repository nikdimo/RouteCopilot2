import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
} from 'react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { BottomTabParamList } from '../navigation/AppNavigator';

type Props = BottomTabScreenProps<BottomTabParamList, 'Schedule'>;

const MEETINGS = [
  {
    id: '1',
    time: '10:00 AM',
    clientName: 'Acme Corp',
    address: '123 Main St, Downtown',
  },
  {
    id: '2',
    time: '2:00 PM',
    clientName: 'TechStart Inc',
    address: '456 Oak Ave, Midtown',
  },
  {
    id: '3',
    time: '4:30 PM',
    clientName: 'Global Solutions',
    address: '789 Park Blvd, Uptown',
  },
];

export default function DayViewScreen({ navigation }: Props) {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>Today&apos;s Meetings</Text>
      {MEETINGS.map((meeting) => (
        <View key={meeting.id} style={styles.card}>
          <Text style={styles.time}>{meeting.time}</Text>
          <Text style={styles.clientName}>{meeting.clientName}</Text>
          <Text style={styles.address}>{meeting.address}</Text>
          <TouchableOpacity
            style={styles.navigateButton}
            onPress={() => navigation.navigate('Map')}
            activeOpacity={0.8}
          >
            <Text style={styles.navigateButtonText}>Navigate</Text>
          </TouchableOpacity>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 20,
    color: '#1a1a1a',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  time: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6366f1',
    marginBottom: 4,
  },
  clientName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  address: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 12,
  },
  navigateButton: {
    backgroundColor: '#6366f1',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  navigateButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
});
