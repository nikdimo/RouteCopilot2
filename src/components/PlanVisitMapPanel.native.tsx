import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import type { CalendarEvent } from '../services/graph';
import type { ScoredSlot } from '../utils/scheduler';
import type { Coordinate } from '../utils/scheduler';
import { buildRouteWithInsertionMeta } from '../utils/mapPreview';
import NativeLeafletMap, {
  type LeafletCoordinate,
  type LeafletMarker,
  type LeafletPolyline,
} from './NativeLeafletMap';

export type PlanVisitMapPanelProps = {
  newLocation?: Coordinate | null;
  slot?: ScoredSlot | null;
  dayEvents?: CalendarEvent[];
  homeBase: Coordinate;
  highlightedEventIds?: string[];
};

const DEFAULT_COORD: LeafletCoordinate = {
  latitude: 55.6761,
  longitude: 12.5683,
};

export default function PlanVisitMapPanel({
  newLocation,
  slot,
  dayEvents = [],
  homeBase,
  highlightedEventIds = [],
}: PlanVisitMapPanelProps) {
  const highlightedSet = useMemo(() => new Set(highlightedEventIds), [highlightedEventIds]);
  const homePoint = useMemo(
    () => ({ latitude: homeBase.lat, longitude: homeBase.lon }),
    [homeBase.lat, homeBase.lon]
  );

  const insertionPoint = useMemo(
    () =>
      newLocation != null
        ? { latitude: newLocation.lat, longitude: newLocation.lon }
        : null,
    [newLocation]
  );

  const routeWithInsertion = useMemo(
    () =>
      slot != null && newLocation != null && dayEvents.length > 0
        ? buildRouteWithInsertionMeta(dayEvents, newLocation, slot, homeBase, 'NEW')
        : null,
    [dayEvents, homeBase, newLocation, slot]
  );
  const coordsWithInsertion = routeWithInsertion?.coordsWithInsertion ?? [];
  const sortedEventIds = routeWithInsertion?.sortedEventIds ?? [];

  const eventById = useMemo(
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

  const coordsForFit = useMemo(
    () =>
      coordsWithInsertion.length >= 2
        ? coordsWithInsertion
        : insertionPoint != null
          ? [homePoint, insertionPoint]
          : [homePoint],
    [coordsWithInsertion, homePoint, insertionPoint]
  );

  const mapMarkers = useMemo<LeafletMarker[]>(() => {
    const markers: LeafletMarker[] = [
      {
        id: 'home-base',
        coordinate: homePoint,
        label: 'H',
        title: 'Home Base',
        color: '#107C10',
      },
    ];

    if (insertionPoint != null) {
      markers.push({
        id: 'proposed-visit',
        coordinate: insertionPoint,
        label: 'New',
        title: 'Proposed visit',
        color: '#D13438',
      });
    }

    sortedEventIds
      .map((id) => eventById.get(id))
      .filter((a): a is NonNullable<typeof a> => a != null)
      .forEach((a, index) => {
        markers.push({
          id: `event-${a.id}`,
          coordinate: a.coordinates,
          label: String(index + 1),
          title: a.title ?? undefined,
          color: highlightedSet.has(a.id) ? '#EAB308' : '#0078D4',
        });
      });

    return markers;
  }, [eventById, highlightedSet, homePoint, insertionPoint, sortedEventIds]);

  const mapPolylines = useMemo<LeafletPolyline[]>(
    () =>
      coordsWithInsertion.length >= 2
        ? [
            {
              id: 'route-with-insertion',
              coordinates: coordsWithInsertion,
              color: '#00B0FF',
              width: 4,
            },
          ]
        : [],
    [coordsWithInsertion]
  );

  const fitRequestKey = useMemo(
    () =>
      `${coordsForFit.length}:${coordsWithInsertion.length}:${slot?.startMs ?? 'none'}:${
        newLocation?.lat ?? 'none'
      }:${newLocation?.lon ?? 'none'}`,
    [coordsForFit.length, coordsWithInsertion.length, newLocation?.lat, newLocation?.lon, slot?.startMs]
  );

  const initialCenter = useMemo<LeafletCoordinate>(() => {
    if (insertionPoint == null) return DEFAULT_COORD;
    return {
      latitude: (homeBase.lat + insertionPoint.latitude) / 2,
      longitude: (homeBase.lon + insertionPoint.longitude) / 2,
    };
  }, [homeBase.lat, homeBase.lon, insertionPoint]);

  return (
    <View style={styles.container}>
      <NativeLeafletMap
        style={styles.map}
        markers={mapMarkers}
        polylines={mapPolylines}
        fitCoordinates={coordsForFit}
        fitRequestKey={fitRequestKey}
        fitPadding={48}
        initialCenter={initialCenter}
        initialZoom={11}
      />
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
