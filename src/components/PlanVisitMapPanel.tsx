import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import type { CalendarEvent } from '../services/graph';
import type { ScoredSlot } from '../utils/scheduler';
import type { Coordinate } from '../utils/scheduler';
import { buildRouteWithInsertion } from '../utils/mapPreview';

export type PlanVisitMapPanelProps = {
  /** Selected address (before Find Best Time) – shows single pin */
  newLocation?: Coordinate | null;
  /** After Find Best Time: slot to show route for (Best Match by default, updates on suggestion click) */
  slot?: ScoredSlot | null;
  dayEvents?: CalendarEvent[];
  homeBase: Coordinate;
};

const DEFAULT_REGION = {
  latitude: 55.6761,
  longitude: 12.5683,
  latitudeDelta: 0.1,
  longitudeDelta: 0.1,
};

export default function PlanVisitMapPanel({
  newLocation,
  slot,
  dayEvents = [],
  homeBase,
}: PlanVisitMapPanelProps) {
  const mapRef = useRef<MapView>(null);

  const homePoint = { latitude: homeBase.lat, longitude: homeBase.lon };
  const insertionPoint =
    newLocation != null
      ? { latitude: newLocation.lat, longitude: newLocation.lon }
      : null;

  const coordsWithInsertion =
    slot != null && newLocation != null && dayEvents.length > 0
      ? buildRouteWithInsertion(dayEvents, newLocation, slot, homeBase)
      : [];

  const coordsForFit =
    coordsWithInsertion.length >= 2
      ? coordsWithInsertion
      : insertionPoint != null
        ? [homePoint, insertionPoint]
        : [homePoint];

  useEffect(() => {
    if (coordsForFit.length === 0) return;
    try {
      if (coordsForFit.length === 1) {
        mapRef.current?.animateToRegion({
          ...coordsForFit[0],
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        }, 350);
      } else {
        mapRef.current?.fitToCoordinates(coordsForFit, {
          edgePadding: { top: 40, right: 40, bottom: 40, left: 40 },
          animated: true,
        });
      }
    } catch {
      // ignore
    }
  }, [coordsForFit]);

  const center =
    insertionPoint != null
      ? {
          latitude: (homeBase.lat + newLocation!.lat) / 2,
          longitude: (homeBase.lon + newLocation!.lon) / 2,
          latitudeDelta: Math.max(
            0.05,
            (Math.abs(homeBase.lat - newLocation!.lat) || 0.1) * 2.5
          ),
          longitudeDelta: Math.max(
            0.05,
            (Math.abs(homeBase.lon - newLocation!.lon) || 0.1) * 2.5
          ),
        }
      : DEFAULT_REGION;

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        googleRenderer={Platform.OS === 'android' ? 'LEGACY' : undefined}
        initialRegion={center}
        showsUserLocation
      >
        <Marker coordinate={homePoint} title="Home Base" pinColor="green" />
        {insertionPoint != null && (
          <Marker
            coordinate={insertionPoint}
            title="Proposed visit"
            pinColor="#D13438"
          />
        )}
        {dayEvents
          .filter(
            (a): a is typeof a & { coordinates: { latitude: number; longitude: number } } =>
              a.coordinates != null
          )
          .map((a) => (
            <Marker
              key={a.id}
              coordinate={a.coordinates}
              title={a.title ?? undefined}
              pinColor="#0078D4"
            />
          ))}
        {coordsWithInsertion.length >= 2 && (
          <Polyline
            coordinates={coordsWithInsertion}
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
    minHeight: 200,
  },
  map: {
    width: '100%',
    height: '100%',
    minHeight: 200,
  },
});
