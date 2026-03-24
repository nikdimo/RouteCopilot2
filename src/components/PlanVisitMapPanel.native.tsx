import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import type { CalendarEvent } from '../services/graph';
import type { ScoredSlot } from '../utils/scheduler';
import type { Coordinate } from '../utils/scheduler';
import { buildRouteWithInsertionMeta } from '../utils/mapPreview';
import { getMarkerPositions } from '../utils/mapClusters';
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
    [newLocation?.lat, newLocation?.lon]
  );

  const routeWithInsertion = useMemo(
    () =>
      slot != null && newLocation != null && dayEvents.length > 0
        ? buildRouteWithInsertionMeta(dayEvents, newLocation, slot, homeBase, 'NEW')
        : null,
    [dayEvents, homeBase.lat, homeBase.lon, newLocation?.lat, newLocation?.lon, slot]
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

  const sortedStops = useMemo(
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

  const displayStops = useMemo(
    () => {
      const items: Array<{
        id: string;
        coordinate: { latitude: number; longitude: number };
        label: string;
        kind: 'new' | 'event';
        eventId?: string;
        title?: string;
      }> = [];

      if (insertionPoint != null) {
        items.push({
          id: 'new-meeting',
          coordinate: insertionPoint,
          label: 'New',
          kind: 'new',
          title: 'Proposed visit',
        });
      }

      sortedStops.forEach((stop) => {
        items.push({
          id: `stop-${stop.eventId}`,
          coordinate: stop.coordinate,
          label: String(stop.routeIndex + 1),
          kind: 'event',
          eventId: stop.eventId,
          title: stop.title,
        });
      });

      return items;
    },
    [insertionPoint, sortedStops]
  );

  const markerPositions = useMemo(
    () =>
      getMarkerPositions(displayStops.map((stop) => stop.coordinate), MARKER_LAYOUT_ZOOM, {
        pixelGap: BEST_MATCH_MARKER_GAP_PX,
      }),
    [displayStops]
  );

  const connectorLines = useMemo(
    () =>
      markerPositions
        .filter((marker) => marker.realCoordinate != null)
        .map((marker) => ({
          id: `connector-${displayStops[marker.index]?.id ?? marker.index}`,
          coordinates: [marker.coordinate, marker.realCoordinate!] as LeafletCoordinate[],
        })),
    [displayStops, markerPositions]
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

    markerPositions.forEach((marker) => {
      const stop = displayStops[marker.index];
      if (!stop) return;
      const isHighlighted = stop.kind === 'event' && stop.eventId != null && highlightedSet.has(stop.eventId);
      markers.push({
        id: stop.id,
        coordinate: marker.coordinate,
        label: stop.label,
        title: stop.title,
        color: stop.kind === 'new' ? '#D13438' : isHighlighted ? PUSHED_MEETING_PASTEL_YELLOW : '#0078D4',
        textColor: stop.kind === 'new' ? '#FFFFFF' : isHighlighted ? '#7C2D12' : '#FFFFFF',
        isCluster: marker.isCluster,
        clusterKey: marker.clusterKey,
      });
    });

    return markers;
  }, [displayStops, highlightedSet, homePoint, markerPositions]);

  const mapPolylines = useMemo<LeafletPolyline[]>(
    () => {
      const lines: LeafletPolyline[] = [];
      if (coordsWithInsertion.length >= 2) {
        lines.push({
          id: 'route-with-insertion',
          coordinates: coordsWithInsertion,
          color: '#00B0FF',
          width: 4,
        });
      }
      connectorLines.forEach((line) => {
        lines.push({
          id: line.id,
          coordinates: line.coordinates,
          color: '#64748b',
          width: 2,
          opacity: 0.8,
          dashArray: '4, 4',
        });
      });
      return lines;
    },
    [connectorLines, coordsWithInsertion]
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
