import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Navigation } from 'lucide-react-native';

const DEFAULT_STATUS_COLOR = '#107C10';

export type MeetingCardProps = {
  timeRange: string;
  client: string;
  address: string;
  statusColor?: string;
  onNavigate?: () => void;
};

export default function MeetingCard({
  timeRange,
  client,
  address,
  statusColor = DEFAULT_STATUS_COLOR,
  onNavigate,
}: MeetingCardProps) {
  return (
    <View style={styles.card}>
      <View style={[styles.pastelLine, { backgroundColor: statusColor }]} />
      <View style={styles.content}>
        <View style={styles.main}>
          <Text style={styles.time}>{timeRange}</Text>
          <Text style={styles.client}>{client}</Text>
          <Text style={styles.address}>{address}</Text>
        </View>
        <TouchableOpacity
          style={styles.navButton}
          onPress={onNavigate}
          activeOpacity={0.7}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Navigation color="#0078D4" size={22} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 8,
    marginBottom: 12,
    minHeight: 72,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
    overflow: 'hidden',
  },
  pastelLine: {
    width: 4,
    alignSelf: 'stretch',
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  main: {
    flex: 1,
  },
  time: {
    fontSize: 12,
    color: '#605E5C',
    marginBottom: 4,
    fontWeight: '500',
  },
  client: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 2,
  },
  address: {
    fontSize: 13,
    color: '#605E5C',
  },
  navButton: {
    padding: 8,
    marginLeft: 8,
  },
});
