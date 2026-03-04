import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';
import { Navigation, Phone, Mail, MessageCircle } from 'lucide-react-native';

const MS_BLUE = '#0078D4';
const DEFAULT_STATUS_COLOR = '#107C10';
const CHAMFER_SIZE = 36;

export type MeetingCardProps = {
  timeRange: string;
  client: string;
  address: string;
  statusColor?: string;
  /** When true, uses light blue background (booked meetings in Plan Visit view) */
  variantBooked?: boolean;
  /** Opens native directions (Apple/Google Maps) to this meeting */
  onNavigate?: () => void;
  /** When user taps the waypoint number in the corner: same as tapping that route point on the map (switch to Map + highlight) */
  onWaypointNumberPress?: () => void;
  /** Waypoint number (1-based) in blue chamfered top-right corner */
  waypointNumber?: number;
  /** Contact phone number; when set, shows a tappable phone icon to call */
  phone?: string;
  /** Contact email; when set, shows a tappable mail icon to send email */
  email?: string;
  isCompleted?: boolean;
  onPress?: () => void;
};

export default function MeetingCard({
  timeRange,
  client,
  address,
  statusColor = DEFAULT_STATUS_COLOR,
  variantBooked,
  onNavigate,
  onWaypointNumberPress,
  waypointNumber,
  phone,
  email,
  isCompleted = false,
  onPress,
}: MeetingCardProps) {
  const hasPhone = phone != null && phone.trim() !== '';
  const hasEmail = email != null && email.trim() !== '';
  const content = (
    <View style={[styles.card, variantBooked && styles.cardBooked, isCompleted && styles.cardCompleted]}>
      {waypointNumber != null && (
        <TouchableOpacity
          style={styles.chamferWrap}
          onPress={(e) => {
            e?.stopPropagation?.();
            onWaypointNumberPress?.();
          }}
          activeOpacity={0.8}
          disabled={onWaypointNumberPress == null}
        >
          <Svg width={CHAMFER_SIZE} height={CHAMFER_SIZE} style={styles.chamferSvg}>
            <Polygon points={`0,0 ${CHAMFER_SIZE},0 ${CHAMFER_SIZE},${CHAMFER_SIZE}`} fill={MS_BLUE} />
          </Svg>
          <View style={[styles.chamferNumberWrap, { pointerEvents: 'none' }]}>
            <Text style={styles.chamferNumber} allowFontScaling={false}>{waypointNumber}</Text>
          </View>
        </TouchableOpacity>
      )}
      <View style={[styles.content, waypointNumber != null && styles.contentWithChamfer]}>
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
    borderTopRightRadius: 0,
    marginBottom: 12,
    minHeight: 72,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
    overflow: 'hidden',
    position: 'relative',
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
  chamferWrap: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: CHAMFER_SIZE,
    height: CHAMFER_SIZE,
    zIndex: 1,
  },
  chamferSvg: {
    position: 'absolute',
    top: 0,
    right: 0,
  },
  chamferNumberWrap: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: CHAMFER_SIZE,
    height: CHAMFER_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ translateX: 6 }, { translateY: -6 }],
  },
  chamferNumber: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  contentWithChamfer: {
    paddingRight: CHAMFER_SIZE + 6,
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
