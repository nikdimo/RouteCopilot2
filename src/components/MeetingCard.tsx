import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Navigation, Circle, Check } from 'lucide-react-native';

const DEFAULT_STATUS_COLOR = '#107C10';

export type MeetingCardProps = {
  timeRange: string;
  client: string;
  address: string;
  statusColor?: string;
  /** Opens native directions (Apple/Google Maps) to this meeting */
  onNavigate?: () => void;
  isCompleted?: boolean;
  /** Toggles done state (check/uncheck) */
  onToggleDone?: () => void;
  onPress?: () => void;
};

export default function MeetingCard({
  timeRange,
  client,
  address,
  statusColor = DEFAULT_STATUS_COLOR,
  onNavigate,
  isCompleted = false,
  onToggleDone,
  onPress,
}: MeetingCardProps) {
  const content = (
    <View style={[styles.card, isCompleted && styles.cardCompleted]}>
      <View style={[styles.pastelLine, { backgroundColor: statusColor }]} />
      <View style={styles.content}>
        <View style={styles.main}>
          <Text style={[styles.time, isCompleted && styles.strikeThrough]}>{timeRange}</Text>
          <Text style={[styles.client, isCompleted && styles.strikeThrough]}>{client}</Text>
          <Text style={[styles.address, isCompleted && styles.strikeThrough]}>{address}</Text>
        </View>
        {onToggleDone != null && (
          <TouchableOpacity
            style={styles.checkButton}
            onPress={onToggleDone}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            {isCompleted ? (
              <View style={styles.checkDone}>
                <Check color="#fff" size={16} strokeWidth={3} />
              </View>
            ) : (
              <Circle color="#107C10" size={24} />
            )}
          </TouchableOpacity>
        )}
        {onNavigate != null && (
          <TouchableOpacity
            style={styles.navButton}
            onPress={onNavigate}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Navigation color="#0078D4" size={22} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.95}>
        {content}
      </TouchableOpacity>
    );
  }

  return content;
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
  cardCompleted: {
    opacity: 0.5,
  },
  strikeThrough: {
    textDecorationLine: 'line-through',
    color: '#808080',
  },
  checkButton: {
    padding: 8,
    marginLeft: 4,
  },
  checkDone: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#107C10',
    alignItems: 'center',
    justifyContent: 'center',
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
