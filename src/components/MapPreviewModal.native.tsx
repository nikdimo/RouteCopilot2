import React, { useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Dimensions,
  PanResponder,
} from 'react-native';
import { X } from 'lucide-react-native';
import { startOfDay } from 'date-fns';
import type { CalendarEvent } from '../services/graph';
import type { ScoredSlot } from '../utils/scheduler';
import type { Coordinate } from '../utils/scheduler';
import NativeLeafletMap, {
  type LeafletCoordinate,
  type LeafletMarker,
  type LeafletPolyline,
} from './NativeLeafletMap';

const MS_PER_MIN = 60_000;
const HOME_GREEN = '#107C10';
const MS_BLUE = '#0078D4';

export type MapPreviewModalProps = {
  visible: boolean;
  onClose: () => void;
  onConfirmBooking?: () => void;
  dayEvents: CalendarEvent[];
  insertionCoord: Coordinate;
  slot: ScoredSlot;
  homeBase: Coordinate;
};

function eventToStartMs(ev: CalendarEvent, dayStartMs: number): number | null {
  if (ev.startIso) {
    try {
      return new Date(ev.startIso).getTime();
    } catch {
      return parseTimeStart(ev.time, dayStartMs);
    }
  }
  return parseTimeStart(ev.time, dayStartMs);
}

function parseTimeStart(timeStr: string | undefined, dayStartMs: number): number | null {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const parts = timeStr.split('-').map((p) => p.trim());
  if (parts.length < 2) return null;
  const [sh, sm] = (parts[0] ?? '00:00').split(':').map((x) => parseInt(x || '0', 10));
  return dayStartMs + (sh * 60 + sm) * MS_PER_MIN;
}

export default function MapPreviewModal({
  visible,
  onClose,
  onConfirmBooking,
  dayEvents,
  insertionCoord,
  slot,
  homeBase,
}: MapPreviewModalProps) {
  const homePoint = useMemo(
    () => ({ latitude: homeBase.lat, longitude: homeBase.lon }),
    [homeBase.lat, homeBase.lon]
  );

  const insertionPoint = useMemo(
    () => ({ latitude: insertionCoord.lat, longitude: insertionCoord.lon }),
    [insertionCoord.lat, insertionCoord.lon]
  );

  const { coordsWithInsertion, insertIndexInMiddle } = useMemo(() => {
    const withCoords = dayEvents.filter(
      (a): a is typeof a & { coordinates: { latitude: number; longitude: number } } =>
        a.coordinates != null
    );

    const [y, mo, d] = slot.dayIso.split('-').map((x) => parseInt(x, 10));
    const dayStartMs = startOfDay(new Date(y, mo - 1, d)).getTime();

    const sorted = [...withCoords].sort((a, b) => {
      const aMs = eventToStartMs(a, dayStartMs) ?? 0;
      const bMs = eventToStartMs(b, dayStartMs) ?? 0;
      return aMs - bMs;
    });

    const slotStartMs = slot.startMs;
    let insertIndex = sorted.length;
    for (let i = 0; i < sorted.length; i++) {
      const evMs = eventToStartMs(sorted[i], dayStartMs);
      if (evMs != null && slotStartMs < evMs) {
        insertIndex = i;
        break;
      }
    }

    const middle = [
      ...sorted.slice(0, insertIndex).map((a) => a.coordinates),
      insertionPoint,
      ...sorted.slice(insertIndex).map((a) => a.coordinates),
    ];

    return {
      coordsWithInsertion: [homePoint, ...middle, homePoint],
      insertIndexInMiddle: insertIndex,
    };
  }, [dayEvents, homePoint, insertionPoint, slot.dayIso, slot.startMs]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 15,
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 80 || gestureState.vy > 0.3) {
          onClose();
        }
      },
    })
  ).current;

  const middle = useMemo(() => coordsWithInsertion.slice(1, -1), [coordsWithInsertion]);

  const mapMarkers = useMemo<LeafletMarker[]>(() => {
    const markers: LeafletMarker[] = [
      {
        id: 'home-base',
        coordinate: homePoint,
        label: 'H',
        title: 'Home Base',
        color: HOME_GREEN,
      },
    ];

    middle.forEach((coord, i) => {
      const isInsertion = i === insertIndexInMiddle;
      markers.push({
        id: isInsertion ? 'proposed' : `stop-${i}`,
        coordinate: coord,
        label: isInsertion ? 'New' : String(i + 1),
        title: isInsertion ? 'Proposed visit' : `Stop ${i + 1}`,
        color: isInsertion ? '#D13438' : MS_BLUE,
      });
    });

    return markers;
  }, [homePoint, insertIndexInMiddle, middle]);

  const mapPolylines = useMemo<LeafletPolyline[]>(
    () =>
      coordsWithInsertion.length >= 2
        ? [
            {
              id: 'insertion-route',
              coordinates: coordsWithInsertion,
              color: '#00B0FF',
              width: 4,
            },
          ]
        : [],
    [coordsWithInsertion]
  );

  const initialCenter = useMemo<LeafletCoordinate>(
    () => ({
      latitude: (homeBase.lat + insertionCoord.lat) / 2,
      longitude: (homeBase.lon + insertionCoord.lon) / 2,
    }),
    [homeBase.lat, homeBase.lon, insertionCoord.lat, insertionCoord.lon]
  );

  const fitRequestKey = useMemo(
    () =>
      `${visible}:${coordsWithInsertion.length}:${slot.startMs}:${slot.dayIso}:${insertionCoord.lat}:${insertionCoord.lon}`,
    [
      coordsWithInsertion.length,
      insertionCoord.lat,
      insertionCoord.lon,
      slot.dayIso,
      slot.startMs,
      visible,
    ]
  );

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.dragHandleArea} {...panResponder.panHandlers}>
            <View style={styles.dragHandleBar} />
          </View>
          <View style={styles.header}>
            <Text style={styles.title}>Route with insertion</Text>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <X color="#1a1a1a" size={24} />
            </TouchableOpacity>
          </View>
          <View style={styles.mapContainer}>
            <NativeLeafletMap
              style={styles.map}
              markers={mapMarkers}
              polylines={mapPolylines}
              fitCoordinates={coordsWithInsertion}
              fitPadding={72}
              fitRequestKey={fitRequestKey}
              initialCenter={initialCenter}
              initialZoom={11}
            />
          </View>
          {typeof onConfirmBooking === 'function' && (
            <View style={styles.footer}>
              <TouchableOpacity
                style={styles.confirmButton}
                onPress={onConfirmBooking}
                activeOpacity={0.8}
              >
                <Text style={styles.confirmButtonText}>Confirm booking</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const { height } = Dimensions.get('window');

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: height * 0.88,
  },
  dragHandleArea: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  dragHandleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#C8C6C4',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E1DFDD',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  closeBtn: {
    padding: 4,
  },
  mapContainer: {
    height: 280,
  },
  map: {
    width: '100%',
    height: '100%',
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: '#E1DFDD',
  },
  confirmButton: {
    backgroundColor: MS_BLUE,
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
