import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Platform } from 'react-native';
import { Navigation, Phone, Mail, MessageCircle, MapPin, Briefcase, Home } from 'lucide-react-native';

const MS_BLUE = '#2563EB'; // Vibrant Blue
const LIGHT_BLUE = '#EFF6FF';
const TEXT_DARK = '#0F172A';
const TEXT_MUTED = '#64748B';

export type MeetingCardProps = {
  timeRange: string;
  client: string;
  address: string;
  statusColor?: string;
  /** When true, uses light blue background (booked meetings in Plan Visit view) */
  variantBooked?: boolean;
  /** Opens native directions (Apple/Google Maps) to this meeting */
  onNavigate?: () => void;
  /** Waypoint number or 'HOME' identifier rendered inside the timeline circle */
  waypointNumber?: number | 'HOME';
  /** Contact phone number; when set, shows a tappable phone icon to call */
  phone?: string;
  /** Contact email; when set, shows a tappable mail icon to send email */
  email?: string;
  isCompleted?: boolean;
  /** Replaces old default action: now Tapping highlights it on map */
  onPress?: () => void;
};

export default function MeetingCard({
  timeRange,
  client,
  address,
  statusColor = MS_BLUE,
  variantBooked,
  onNavigate,
  waypointNumber,
  phone,
  email,
  isCompleted = false,
  onPress,
}: MeetingCardProps) {
  const hasPhone = phone != null && phone.trim() !== '';
  const hasEmail = email != null && email.trim() !== '';

  const [startTime, endTime] = timeRange.split('-').map(s => s.trim());

  const content = (
    <View style={styles.container}>
      {/* Left Timeline Section */}
      <View style={styles.timelineCol}>
        <Text style={[styles.timeText, isCompleted && styles.strikeThrough]}>{startTime}</Text>
        <Text style={[styles.timeSubtext, isCompleted && styles.strikeThrough]}>{endTime}</Text>
      </View>

      {/* Center Line & Node */}
      <View style={styles.nodeCol}>
        <View
          style={[
            styles.timelineNode,
            { backgroundColor: waypointNumber === 'HOME' ? TEXT_DARK : isCompleted ? '#10B981' : statusColor }
          ]}
        >
          {waypointNumber === 'HOME' ? (
            <Home color="#fff" size={10} />
          ) : (
            <Briefcase color="#fff" size={10} />
          )}
        </View>
      </View>

      {/* Right Content Card */}
      <View style={[
        styles.cardBox,
        variantBooked && styles.cardBooked,
        isCompleted && styles.cardCompleted
      ]}>
        {/* Type Badge from Mockup */}
        <View style={styles.typeBadge}>
          <Text style={styles.typeBadgeText}>
            {waypointNumber === 'HOME' ? 'HOME' : 'MEETING'}
          </Text>
        </View>

        {/* Main Text */}
        <View style={styles.main}>
          <Text style={[styles.client, isCompleted && styles.strikeThrough]} numberOfLines={1}>
            {client}
          </Text>
          <View style={styles.addressRow}>
            <MapPin color={TEXT_MUTED} size={14} style={styles.addressIcon} />
            <Text style={[styles.address, isCompleted && styles.strikeThrough]} numberOfLines={2}>
              {address}
            </Text>
          </View>
        </View>



      </View>
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.9}>
        {content}
      </TouchableOpacity>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    marginBottom: 8,
    minHeight: 100,
  },
  timelineCol: {
    width: 50,
    alignItems: 'flex-end',
    paddingTop: 16,
    paddingRight: 10,
  },
  timeText: {
    fontSize: 13,
    fontWeight: '700',
    color: TEXT_DARK,
  },
  timeSubtext: {
    fontSize: 11,
    color: TEXT_MUTED,
    marginTop: 2,
  },
  nodeCol: {
    width: 24,
    alignItems: 'center',
    paddingTop: 16,
    position: 'relative',
    marginRight: 10,
  },
  timelineNode: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    ...Platform.select({
      web: {
        boxShadow: '0px 2px 3px rgba(0, 0, 0, 0.1)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 3,
        elevation: 3,
      },
    }),
  },
  nodeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  cardBox: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    padding: 12,
    ...Platform.select({
      web: {
        boxShadow: '0px 1px 4px rgba(0, 0, 0, 0.03)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.03,
        shadowRadius: 4,
        elevation: 2,
      },
    }),
  },
  cardBooked: {
    backgroundColor: LIGHT_BLUE,
    borderColor: '#DBEAFE',
  },
  cardCompleted: {
    opacity: 0.6,
    backgroundColor: '#F8FAFC',
  },
  strikeThrough: {
    textDecorationLine: 'line-through',
    color: '#94A3B8',
  },
  main: {
    marginBottom: 8,
  },
  client: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A', // darker text for main details
  },
  typeBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: '#F1F5F9', // light grey 
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  typeBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.8,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingRight: 10,
  },
  addressIcon: {
    marginTop: 2,
    marginRight: 6,
  },
  address: {
    fontSize: 13,
    color: TEXT_MUTED,
    lineHeight: 18,
    flex: 1,
  },
  actionsFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  iconPill: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: LIGHT_BLUE,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  navPill: {
    flexDirection: 'row',
    width: 'auto',
    paddingHorizontal: 16,
    gap: 6,
  },
  navPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: MS_BLUE,
  }
});
