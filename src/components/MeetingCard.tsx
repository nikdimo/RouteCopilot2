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
        {/* Title row: client name + communication tools on same line */}
        <View style={styles.titleRow}>
          <Text style={[styles.client, isCompleted && styles.strikeThrough]} numberOfLines={1}>
            {client}
          </Text>
          {(onNavigate != null || hasPhone || hasEmail) && (
            <View style={styles.actionsInline}>
              {hasPhone && (
                <TouchableOpacity
                  style={styles.actionIcon}
                  onPress={(e) => {
                    e?.stopPropagation?.();
                    Linking.openURL(`tel:${phone!.trim()}`);
                  }}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Phone color={MS_BLUE} size={18} />
                </TouchableOpacity>
              )}
              {hasPhone && (
                <TouchableOpacity
                  style={styles.actionIcon}
                  onPress={(e) => {
                    e?.stopPropagation?.();
                    Linking.openURL(`sms:${phone!.trim()}`);
                  }}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <MessageCircle color={MS_BLUE} size={18} />
                </TouchableOpacity>
              )}
              {hasEmail && (
                <TouchableOpacity
                  style={styles.actionIcon}
                  onPress={(e) => {
                    e?.stopPropagation?.();
                    Linking.openURL(`mailto:${email!.trim()}`);
                  }}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Mail color={MS_BLUE} size={18} />
                </TouchableOpacity>
              )}
              {onNavigate != null && (
                <TouchableOpacity
                  style={styles.actionIcon}
                  onPress={(e) => {
                    e?.stopPropagation?.();
                    onNavigate();
                  }}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Navigation color={MS_BLUE} size={18} />
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
        <View style={styles.addressRow}>
          <MapPin color={TEXT_MUTED} size={14} style={styles.addressIcon} />
          <Text style={[styles.address, isCompleted && styles.strikeThrough]} numberOfLines={2}>
            {address}
          </Text>
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
    minHeight: 64,
  },
  timelineCol: {
    width: 50,
    alignItems: 'flex-end',
    paddingTop: 8,
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
    paddingTop: 8,
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
    padding: 8,
    ...Platform.select({
      web: {
        boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.08), 0px 1px 2px rgba(0, 0, 0, 0.04)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 6,
        elevation: 4,
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 2,
    minHeight: 20,
  },
  client: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    minWidth: 0,
  },
  actionsInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  actionIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingRight: 10,
  },
  addressIcon: {
    marginTop: 1,
    marginRight: 6,
  },
  address: {
    fontSize: 13,
    color: TEXT_MUTED,
    lineHeight: 16,
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
