import React, { useEffect, useRef, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Platform, TouchableOpacity, ScrollView } from 'react-native';
import { openNativeDirections } from '../utils/maps';
import MapView, { Marker, Polyline, Callout } from 'react-native-maps';
import { useRoute } from '../context/RouteContext';
import { useUserPreferences } from '../context/UserPreferencesContext';
import { getTravelMinutes } from '../utils/scheduler';
import { DEFAULT_HOME_BASE } from '../types';

const DEFAULT_REGION = {
  latitude: 55.6761,
  longitude: 12.5683,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

const EDGE_PADDING = { top: 60, right: 60, bottom: 60, left: 60 };
const MS_BLUE = '#0078D4';
const HOME_GREEN = '#107C10';

function parseTimeToDayMs(timeStr: string, isoFallback?: string, useEnd = false): number {
  const ref = isoFallback ? new Date(isoFallback) : new Date();
  const dayStart = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()).getTime();
  if (!timeStr || typeof timeStr !== 'string') return dayStart + 9 * 60 * 60 * 1000;
  const parts = timeStr.split('-').map((p) => p.trim());
  const target = useEnd ? (parts[1] ?? parts[0]) : (parts[0] ?? '09:00');
  const [h = 9, m = 0] = target.split(':').map((x) => parseInt(x || '0', 10));
  return dayStart + (h * 60 + m) * 60 * 1000;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export default function MapScreen() {
  const mapRef = useRef<MapView>(null);
  const [showDetails, setShowDetails] = useState(false);
  const { appointments: appointmentsFromContext } = useRoute();
  const { preferences } = useUserPreferences();
  const appointments = appointmentsFromContext ?? [];
  const homeBase = preferences.homeBase ?? DEFAULT_HOME_BASE;
  const preBuffer = preferences.preMeetingBuffer ?? 15;
  const postBuffer = preferences.postMeetingBuffer ?? 15;
  const homeBaseLabel = preferences.homeBaseLabel ?? 'Home Base';

  const coords = appointments.filter(
    (a): a is typeof a & { coordinates: { latitude: number; longitude: number } } =>
      a.coordinates != null
  );

  const { departByMs, returnByMs, allCoordsForFit, fullPolyline } = useMemo(() => {
    const home = { lat: homeBase.lat, lon: homeBase.lon };
    let departByMs = 0;
    let returnByMs = 0;

    if (coords.length > 0) {
      const first = coords[0]!;
      const last = coords[coords.length - 1]!;
      const firstStartMs = first.startIso
        ? new Date(first.startIso).getTime()
        : parseTimeToDayMs(first.time, first.startIso ?? first.endIso ?? undefined);
      const lastEndMs = last.endIso
        ? new Date(last.endIso).getTime()
        : parseTimeToDayMs(last.time, last.startIso ?? last.endIso ?? undefined, true);
      const firstCoord = { lat: first.coordinates.latitude, lon: first.coordinates.longitude };
      const lastCoord = { lat: last.coordinates.latitude, lon: last.coordinates.longitude };
      const travelToFirst = getTravelMinutes(home, firstCoord, firstStartMs) * 60 * 1000;
      const travelFromLast = getTravelMinutes(lastCoord, home, lastEndMs) * 60 * 1000;
      departByMs = firstStartMs - preBuffer * 60 * 1000 - travelToFirst;
      returnByMs = lastEndMs + postBuffer * 60 * 1000 + travelFromLast;
    }

    const homeLatLng = { latitude: homeBase.lat, longitude: homeBase.lon };
    const meetingCoords = coords.map((a) => a.coordinates);
    const allCoordsForFit = meetingCoords.length > 0
      ? [homeLatLng, ...meetingCoords, homeLatLng]
      : [homeLatLng];
    const fullPolyline = meetingCoords.length > 0
      ? [homeLatLng, ...meetingCoords, homeLatLng]
      : [];

    return { departByMs, returnByMs, allCoordsForFit, fullPolyline };
  }, [coords, homeBase, preBuffer, postBuffer]);

  useEffect(() => {
    if (allCoordsForFit.length === 0) return;
    try {
      if (allCoordsForFit.length === 1) {
        mapRef.current?.animateToRegion({
          ...allCoordsForFit[0],
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        }, 350);
      } else {
        mapRef.current?.fitToCoordinates(allCoordsForFit, {
          edgePadding: EDGE_PADDING,
          animated: true,
        });
      }
    } catch {
      // ignore
    }
  }, [appointments]);

  if (Platform.OS === 'web') {
    return (
      <View style={styles.container}>
        <View style={styles.placeholderContainer}>
          <Text style={styles.placeholderText}>
            Maps are only available on Mobile
          </Text>
        </View>
      </View>
    );
  }

  if (appointments.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.placeholderContainer}>
          <Text style={styles.placeholderText}>
            No meetings loaded. Go to Schedule to load your route.
          </Text>
        </View>
      </View>
    );
  }

  if (coords.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.placeholderContainer}>
          <Text style={styles.placeholderText}>
            No locations with addresses. Add addresses to your meetings to see them on the map.
          </Text>
        </View>
      </View>
    );
  }

  const showHomeBase = fullPolyline.length > 0;

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.detailsButton}
        onPress={() => setShowDetails((s) => !s)}
        activeOpacity={0.8}
      >
        <Text style={styles.detailsButtonText}>{showDetails ? 'Hide details' : 'Show details'}</Text>
      </TouchableOpacity>
      {showDetails && (
        <ScrollView style={styles.detailsOverlay} contentContainerStyle={styles.detailsOverlayContent}>
          {showHomeBase && (
            <View style={[styles.detailsCard, styles.detailsCardHome]}>
              <View style={[styles.detailsBadge, { backgroundColor: HOME_GREEN }]}>
                <Text style={styles.detailsBadgeText}>H</Text>
              </View>
              <View style={styles.detailsCardContent}>
                <Text style={styles.detailsCardTitle}>{homeBaseLabel}</Text>
                <Text style={styles.detailsCardTime}>Depart by {formatTime(departByMs)} · Return ~{formatTime(returnByMs)}</Text>
              </View>
            </View>
          )}
          {coords.map((appointment, index) => (
            <View key={appointment.id} style={styles.detailsCard}>
              <View style={[styles.detailsBadge, { backgroundColor: appointment.status === 'completed' ? '#808080' : MS_BLUE }]}>
                <Text style={styles.detailsBadgeText}>{index + 1}</Text>
              </View>
              <View style={styles.detailsCardContent}>
                <Text style={styles.detailsCardTitle}>{appointment.title}</Text>
                <Text style={styles.detailsCardTime}>{appointment.time}</Text>
                <Text style={styles.detailsCardAddress}>{appointment.location}</Text>
                <TouchableOpacity onPress={() => openNativeDirections(appointment.coordinates.latitude, appointment.coordinates.longitude, appointment.title)}>
                  <Text style={styles.detailsCardLink}>Open in Maps</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={DEFAULT_REGION}
        showsUserLocation
      >
        {showHomeBase && (
          <Marker
            coordinate={{ latitude: homeBase.lat, longitude: homeBase.lon }}
            pinColor={HOME_GREEN}
            title={homeBaseLabel}
            description={`Depart by ${formatTime(departByMs)} · Return ~${formatTime(returnByMs)}`}
          >
            <Callout tooltip>
              <View style={styles.calloutBubble}>
                <Text style={[styles.calloutBadge, { color: HOME_GREEN }]}>Home Base</Text>
                <Text style={styles.calloutTitle}>{homeBaseLabel}</Text>
                <Text style={styles.calloutDescription}>Depart by {formatTime(departByMs)}</Text>
                <Text style={styles.calloutDescription}>Return ~{formatTime(returnByMs)}</Text>
              </View>
            </Callout>
          </Marker>
        )}
        {coords.map((appointment, index) => {
          const isCompleted = appointment.status === 'completed';
          const bgColor = isCompleted ? '#808080' : MS_BLUE;
          return (
            <Marker
              key={appointment.id}
              coordinate={appointment.coordinates}
              title={`${index + 1}. ${appointment.title}`}
              description={appointment.time}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View style={[styles.markerPin, { backgroundColor: bgColor }]}>
                <Text style={styles.markerPinNumber}>{index + 1}</Text>
              </View>
              <Callout
                tooltip={true}
                onPress={() =>
                  openNativeDirections(
                    appointment.coordinates.latitude,
                    appointment.coordinates.longitude,
                    appointment.title
                  )
                }
              >
                <View style={styles.calloutBubble}>
                  <Text style={styles.calloutTitle}>{appointment.title}</Text>
                  <Text style={styles.calloutDescription}>{appointment.time}</Text>
                  <Text style={styles.calloutAddress}>{appointment.location}</Text>
                  <Text style={styles.calloutHint}>Tap to open in Maps</Text>
                </View>
              </Callout>
            </Marker>
          );
        })}
        {fullPolyline.length >= 2 && (
          <Polyline
            coordinates={fullPolyline}
            strokeColor="#00B0FF"
            strokeWidth={4}
          />
        )}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  placeholderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
  },
  placeholderText: {
    fontSize: 18,
    color: '#64748b',
  },
  calloutBubble: {
    backgroundColor: 'white',
    padding: 10,
    borderRadius: 8,
    minWidth: 150,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  markerPin: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  markerPinNumber: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  calloutBadge: {
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 4,
  },
  calloutTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  calloutDescription: {
    fontSize: 12,
    color: '#323130',
    marginBottom: 4,
  },
  calloutAddress: {
    fontSize: 11,
    color: '#64748b',
    marginBottom: 6,
  },
  calloutHint: {
    fontSize: 11,
    color: MS_BLUE,
    fontWeight: '600',
  },
  detailsButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 10,
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  detailsButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: MS_BLUE,
  },
  detailsOverlay: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    maxHeight: '45%',
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 12,
    zIndex: 10,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  detailsOverlayContent: {
    padding: 12,
    paddingBottom: 16,
  },
  detailsCard: {
    flexDirection: 'row',
    padding: 10,
    marginBottom: 8,
    backgroundColor: '#f8fafc',
    borderRadius: 8,
  },
  detailsCardHome: {
    backgroundColor: 'rgba(16,124,16,0.1)',
    borderLeftWidth: 4,
    borderLeftColor: HOME_GREEN,
  },
  detailsBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  detailsBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  detailsCardContent: {
    flex: 1,
  },
  detailsCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 2,
  },
  detailsCardTime: {
    fontSize: 12,
    color: '#605E5C',
    marginBottom: 2,
  },
  detailsCardAddress: {
    fontSize: 11,
    color: '#64748b',
    marginBottom: 6,
  },
  detailsCardLink: {
    fontSize: 12,
    fontWeight: '600',
    color: MS_BLUE,
  },
});
