import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Platform,
  Dimensions,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { X } from 'lucide-react-native';
import type { CalendarEvent } from '../services/graph';
import type { ScoredSlot } from '../utils/scheduler';
import type { Coordinate } from '../utils/scheduler';
import { startOfDay } from 'date-fns';

const MS_PER_MIN = 60_000;

export type MapPreviewModalProps = {
  visible: boolean;
  onClose: () => void;
  /** Real appointments for this day (in route order) */
  dayEvents: CalendarEvent[];
  /** The proposed insertion (ghost slot location) */
  insertionCoord: Coordinate;
  /** Slot for label/timing context */
  slot: ScoredSlot;
  /** Home base (start/end) - required for stable route preview with at least 2 points */
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
  dayEvents,
  insertionCoord,
  slot,
  homeBase,
}: MapPreviewModalProps) {
  const mapRef = useRef<MapView>(null);

  const homePoint = { latitude: homeBase.lat, longitude: homeBase.lon };
  const insertionPoint = { latitude: insertionCoord.lat, longitude: insertionCoord.lon };

  const coordsWithInsertion = (() => {
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

    return [homePoint, ...middle, homePoint];
  })();

  useEffect(() => {
    if (!visible || coordsWithInsertion.length < 2) return;
    try {
      mapRef.current?.fitToCoordinates(coordsWithInsertion, {
        edgePadding: { top: 80, right: 80, bottom: 80, left: 80 },
        animated: true,
      });
    } catch {
      // ignore
    }
  }, [visible, coordsWithInsertion]);

  if (Platform.OS === 'web') {
    return (
      <Modal visible={visible} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.webPlaceholder}>
            <Text style={styles.placeholderText}>Map preview available on mobile</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <X color="#fff" size={24} />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Route with insertion</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <X color="#1a1a1a" size={24} />
            </TouchableOpacity>
          </View>
          <View style={styles.mapContainer}>
            <MapView
              ref={mapRef}
              style={styles.map}
              initialRegion={{
                latitude: (homeBase.lat + insertionCoord.lat) / 2,
                longitude: (homeBase.lon + insertionCoord.lon) / 2,
                latitudeDelta: Math.max(0.05, Math.abs(homeBase.lat - insertionCoord.lat) * 2.5 || 0.05),
                longitudeDelta: Math.max(0.05, Math.abs(homeBase.lon - insertionCoord.lon) * 2.5 || 0.05),
              }}
              showsUserLocation
            >
              <Marker coordinate={homePoint} title="Home / Start" pinColor="green" />
              {dayEvents
                .filter((a): a is typeof a & { coordinates: { latitude: number; longitude: number } } => a.coordinates != null)
                .map((a) => (
                  <Marker
                    key={a.id}
                    coordinate={a.coordinates}
                    title={a.title}
                    pinColor="blue"
                  />
                ))}
              <Marker coordinate={insertionPoint} title="Proposed visit" pinColor="red" />
              {coordsWithInsertion.length >= 2 && (
                <Polyline
                  coordinates={coordsWithInsertion}
                  strokeColor="#00B0FF"
                  strokeWidth={4}
                />
              )}
            </MapView>
          </View>
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
    maxHeight: height * 0.7,
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
  webPlaceholder: {
    backgroundColor: '#323130',
    padding: 24,
    borderRadius: 12,
    margin: 16,
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 16,
    color: '#fff',
    marginBottom: 12,
  },
});
