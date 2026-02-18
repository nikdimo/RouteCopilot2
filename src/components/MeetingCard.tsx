import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Navigation, Check, Phone, Mail, MessageCircle } from 'lucide-react-native';

const DEFAULT_STATUS_COLOR = '#107C10';
const MS_BLUE = '#0078D4';

export type MeetingCardProps = {
  timeRange: string;
  client: string;
  address: string;
  statusColor?: string;
  /** When true, uses light blue background (booked meetings in Plan Visit view) */
  variantBooked?: boolean;
  /** Opens native directions (Apple/Google Maps) to this meeting */
  onNavigate?: () => void;
  /** Waypoint number (1-based) matching the map marker for easy cross-reference */
  waypointNumber?: number;
  /** Contact phone number; when set, shows a tappable phone icon to call */
  phone?: string;
  /** Contact email; when set, shows a tappable mail icon to send email */
  email?: string;
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
  variantBooked,
  onNavigate,
  waypointNumber,
  phone,
  email,
  isCompleted = false,
  onToggleDone,
  onPress,
}: MeetingCardProps) {
  const hasPhone = phone != null && phone.trim() !== '';
  const hasEmail = email != null && email.trim() !== '';
  const content = (
    <View style={[styles.card, variantBooked && styles.cardBooked, isCompleted && styles.cardCompleted]}>
      <View style={styles.leftColumn}>
        {waypointNumber != null && (
          <View style={styles.waypointBadge}>
            <Text style={styles.waypointBadgeText}>{waypointNumber}</Text>
          </View>
        )}
        {onToggleDone != null && (
          <TouchableOpacity
            style={[styles.doneBox, isCompleted && styles.doneBoxCompleted]}
            onPress={onToggleDone}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {isCompleted && <Check color="#fff" size={14} strokeWidth={3} />}
          </TouchableOpacity>
        )}
      </View>
      <View style={[styles.pastelLine, { backgroundColor: statusColor }]} />
      <View style={styles.content}>
        <View style={styles.main}>
          <Text style={[styles.time, isCompleted && styles.strikeThrough]}>{timeRange}</Text>
          <Text style={[styles.client, isCompleted && styles.strikeThrough]}>{client}</Text>
          <Text style={[styles.address, isCompleted && styles.strikeThrough]}>{address}</Text>
        </View>
        {hasPhone && (
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => Linking.openURL(`tel:${phone!.trim()}`)}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Phone color={MS_BLUE} size={22} />
          </TouchableOpacity>
        )}
        {hasPhone && (
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => Linking.openURL(`sms:${phone!.trim()}`)}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <MessageCircle color={MS_BLUE} size={22} />
          </TouchableOpacity>
        )}
        {hasEmail && (
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => Linking.openURL(`mailto:${email!.trim()}`)}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Mail color={MS_BLUE} size={22} />
          </TouchableOpacity>
        )}
        {onNavigate != null && (
          <TouchableOpacity
            style={styles.navButton}
            onPress={onNavigate}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Navigation color={MS_BLUE} size={22} />
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
  cardBooked: {
    backgroundColor: '#E8F4FC',
  },
  cardCompleted: {
    opacity: 0.5,
  },
  strikeThrough: {
    textDecorationLine: 'line-through',
    color: '#808080',
  },
  leftColumn: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingLeft: 10,
    paddingVertical: 10,
  },
  waypointBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: MS_BLUE,
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBox: {
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: '#E5E7EB',
    borderWidth: 2,
    borderColor: '#9ca3af',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  doneBoxCompleted: {
    backgroundColor: '#6b7280',
    borderColor: '#6b7280',
  },
  waypointBadgeText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
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
  iconButton: {
    padding: 8,
    marginLeft: 4,
  },
  navButton: {
    padding: 8,
    marginLeft: 8,
  },
});
