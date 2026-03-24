import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import type { CalendarEvent } from '../services/graph';
import type { ScoredSlot } from '../utils/scheduler';
import type { Coordinate } from '../utils/scheduler';
import { buildRouteWithInsertionMeta } from '../utils/mapPreview';
import { getMarkerPositions } from '../utils/mapClusters';

export type PlanVisitMapPanelProps = {
  /** Selected address (before Find Best Time) – shows single pin */
  newLocation?: Coordinate | null;
  /** After Find Best Time: slot to show route for (Best Match by default, updates on suggestion click) */
  slot?: ScoredSlot | null;
  dayEvents?: CalendarEvent[];
  homeBase: Coordinate;
  highlightedEventIds?: string[];
};

const DEFAULT_REGION = {
  latitude: 55.6761,
  longitude: 12.5683,
  latitudeDelta: 0.1,
  longitudeDelta: 0.1,
};
const PUSHED_MEETING_PASTEL_YELLOW = '#FDE68A';
const MARKER_LAYOUT_ZOOM = 12;
const BEST_MATCH_MARKER_GAP_PX = 42;

export default function PlanVisitMapPanel({
  newLocation,
  slot,
  dayEvents = [],
  homeBase,
  highlightedEventIds = [],
}: PlanVisitMapPanelProps) {
  const mapRef = useRef<MapView>(null);
  const highlightedSet = React.useMemo(
    () => new Set(highlightedEventIds),
    [highlightedEventIds]
  );

  const homePoint = React.useMemo(
    () => ({ latitude: homeBase.lat, longitude: homeBase.lon }),
    [homeBase.lat, homeBase.lon]
  );
  const insertionPoint = React.useMemo(
    () =>
      newLocation != null
        ? { latitude: newLocation.lat, longitude: newLocation.lon }
        : null,
    [newLocation?.lat, newLocation?.lon]
  );

  const routeWithInsertion = React.useMemo(
    () =>
      slot != null && newLocation != null && dayEvents.length > 0
        ? buildRouteWithInsertionMeta(dayEvents, newLocation, slot, homeBase, 'NEW')
        : null,
    [dayEvents, homeBase.lat, homeBase.lon, newLocation?.lat, newLocation?.lon, slot]
  );

  const coordsWithInsertion = routeWithInsertion?.coordsWithInsertion ?? [];
  const sortedEventIds = routeWithInsertion?.sortedEventIds ?? [];
  const eventById = React.useMemo(
    () =>
      new Map(
        dayEvents
          .filter(
            (a): a is typeof a & { coordinates: { latitude: number; longitude: number } } =>
              a.coordinates != null
          )
          .map((a) => [a.id, a])
      ),
    [dayEvents]
  );

  const sortedStops = React.useMemo(
    () =>
      sortedEventIds
        .map((id, routeIndex) => {
          const event = eventById.get(id);
          if (!event) return null;
          return {
            eventId: id,
            routeIndex,
            coordinate: event.coordinates,
            title: event.title ?? undefined,
          };
        })
        .filter((stop): stop is {
          eventId: string;
          routeIndex: number;
          coordinate: { latitude: number; longitude: number };
          title?: string;
        } => stop != null),
    [eventById, sortedEventIds]
  );

  const displayStops = React.useMemo(
    () => {
      const items: Array<{
        id: string;
        coordinate: { latitude: number; longitude: number };
        kind: 'new' | 'event';
        label: string;
        title?: string;
        eventId?: string;
      }> = [];

      if (insertionPoint != null) {
        items.push({
          id: 'new-meeting',
          coordinate: insertionPoint,
          kind: 'new',
          label: 'New',
          title: 'New meeting',
        });
      }

      sortedStops.forEach((stop) => {
        items.push({
          id: `stop-${stop.eventId}`,
          coordinate: stop.coordinate,
          kind: 'event',
          label: String(stop.routeIndex + 1),
          title: stop.title ?? `Stop ${stop.routeIndex + 1}`,
          eventId: stop.eventId,
        });
      });

      return items;
    },
    [insertionPoint, sortedStops]
  );

  const markerPositions = React.useMemo(
    () =>
      getMarkerPositions(displayStops.map((stop) => stop.coordinate), MARKER_LAYOUT_ZOOM, {
        pixelGap: BEST_MATCH_MARKER_GAP_PX,
      }),
    [displayStops]
  );

  const coordsForFit = React.useMemo(
    () =>
      coordsWithInsertion.length >= 2
        ? coordsWithInsertion
        : insertionPoint != null
          ? [homePoint, insertionPoint]
          : [homePoint],
    [coordsWithInsertion, homePoint, insertionPoint]
  );

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
        {markerPositions
          .filter((marker) => marker.realCoordinate != null)
          .map((marker) => (
            <Polyline
              key={`connector-${displayStops[marker.index]?.id ?? marker.index}`}
              coordinates={[marker.coordinate, marker.realCoordinate!]}
              strokeColor="#64748b"
              strokeWidth={2}
              lineDashPattern={[4, 4]}
            />
          ))}
        {markerPositions.map((marker) => {
          const stop = displayStops[marker.index];
          if (!stop) return null;
          const isHighlighted = stop.kind === 'event' && stop.eventId != null && highlightedSet.has(stop.eventId);
          return (
          <Marker
            key={stop.id}
            coordinate={marker.coordinate}
            title={stop.title}
            pinColor={stop.kind === 'new' ? '#D13438' : isHighlighted ? PUSHED_MEETING_PASTEL_YELLOW : '#0078D4'}
          />
          );
        })}
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
