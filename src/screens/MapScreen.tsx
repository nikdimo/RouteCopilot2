import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Platform, Linking } from 'react-native';
import MapView, { Marker, Polyline, Callout } from 'react-native-maps';
import { useRoute } from '../context/RouteContext';

const DEFAULT_REGION = {
  latitude: 55.6761,
  longitude: 12.5683,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

const EDGE_PADDING = { top: 60, right: 60, bottom: 60, left: 60 };

function openMaps(
  latitude: number,
  longitude: number,
  label: string
) {
  const lat = latitude;
  const lng = longitude;
  const encodedLabel = encodeURIComponent(label);
  const url =
    Platform.OS === 'ios'
      ? `http://maps.apple.com/?daddr=${lat},${lng}`
      : `geo:0,0?q=${lat},${lng}(${encodedLabel})`;
  Linking.openURL(url).catch(() => {});
}

export default function MapScreen() {
  const mapRef = useRef<MapView>(null);
  const { appointments: appointmentsFromContext } = useRoute();
  const appointments = appointmentsFromContext ?? [];

  const coords = appointments.filter(
    (a): a is typeof a & { coordinates: { latitude: number; longitude: number } } =>
      a.coordinates != null
  );

  useEffect(() => {
    if (coords.length === 0) return;
    const coordinates = coords.map((a) => a.coordinates);
    try {
      mapRef.current?.fitToCoordinates(coordinates, {
        edgePadding: EDGE_PADDING,
        animated: true,
      });
    } catch {
      // ignore fitToCoordinates errors (e.g. on web or unsupported)
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

  const polylineCoordinates = coords.map((a) => a.coordinates);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={DEFAULT_REGION}
        showsUserLocation
      >
        {coords.map((appointment, index) => (
          <Marker
            key={appointment.id}
            coordinate={appointment.coordinates}
            title={appointment.title}
            description={appointment.time}
            pinColor="blue"
          >
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{index + 1}</Text>
            </View>
            <Callout
              tooltip={true}
              onPress={() =>
                openMaps(
                  appointment.coordinates.latitude,
                  appointment.coordinates.longitude,
                  appointment.title
                )
              }
            >
              <View style={styles.calloutBubble}>
                <Text style={styles.calloutTitle}>{appointment.title}</Text>
                <Text style={styles.calloutDescription}>{appointment.time}</Text>
                <Text style={styles.calloutHint}>Tap to open in Maps</Text>
              </View>
            </Callout>
          </Marker>
        ))}
        {polylineCoordinates.length >= 2 && (
          <Polyline
            coordinates={polylineCoordinates}
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
    width: '100%',
    height: '100%',
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
  calloutTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  calloutDescription: {
    fontSize: 12,
    color: '#323130',
    marginBottom: 6,
  },
  calloutHint: {
    fontSize: 11,
    color: '#0078D4',
    fontWeight: '600',
  },
  badge: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: 'red',
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
  },
  badgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
  },
});
