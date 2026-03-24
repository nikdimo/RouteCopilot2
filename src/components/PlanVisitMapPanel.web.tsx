import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { CalendarEvent } from '../services/graph';
import type { ScoredSlot } from '../utils/scheduler';
import type { Coordinate } from '../utils/scheduler';
import { buildRouteWithInsertionMeta } from '../utils/mapPreview';
import { getMarkerPositions } from '../utils/mapClusters';

import 'leaflet/dist/leaflet.css';
import 'leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.webpack.css';
import 'leaflet-defaulticon-compatibility';

export type PlanVisitMapPanelProps = {
  newLocation?: Coordinate | null;
  slot?: ScoredSlot | null;
  dayEvents?: CalendarEvent[];
  homeBase: Coordinate;
  highlightedEventIds?: string[];
};

const PUSHED_MEETING_PASTEL_YELLOW = '#FDE68A';
const BEST_MATCH_MARKER_GAP_PX = 42;
const EARTH_RADIUS_KM = 6371;

function createIcon(color: string, label: string, textColor = '#FFFFFF') {
  const width = label.length >= 3 ? 40 : 28;
  return L.divIcon({
    className: 'plan-visit-marker',
    html: `<div style="
      width:${width}px;height:28px;border-radius:14px;background:${color};
      border:2px solid #fff;box-shadow:0 1px 2px rgba(0,0,0,0.2);
      display:flex;align-items:center;justify-content:center;
      color:${textColor};font-size:12px;font-weight:700;
      line-height:1;
    ">${label}</div>`,
    iconSize: [width, 28],
    iconAnchor: [Math.round(width / 2), 14],
  });
}

function createDistanceBadgeIcon(label: string) {
  const width = Math.max(48, Math.round(label.length * 6.5 + 12));
  return L.divIcon({
    className: 'plan-visit-distance-badge',
    html: `<div style="
      min-width:${width}px;height:18px;padding:0 6px;
      background:#FFFFFF;color:#0078D4;
      border:1px solid #93C5FD;box-shadow:0 1px 3px rgba(0,0,0,0.2);
      display:flex;align-items:center;justify-content:center;
      font-size:10px;font-weight:700;line-height:1;white-space:nowrap;
      clip-path:polygon(4px 0, calc(100% - 4px) 0, 100% 4px, 100% calc(100% - 4px), calc(100% - 4px) 100%, 4px 100%, 0 calc(100% - 4px), 0 4px);
    ">${label}</div>`,
    iconSize: [width, 18],
    iconAnchor: [Math.round(width / 2), 9],
  });
}

function segmentDistanceKm(a: [number, number], b: [number, number]) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const dLat = lat2 - lat1;
  const dLon = toRad(b[1] - a[1]);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const hav =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
  return EARTH_RADIUS_KM * c;
}

function MapFitBounds({
  coords,
}: {
  coords: [number, number][];
}) {
  const map = useMap();
  useEffect(() => {
    if (coords.length === 0) return;
    try {
      if (coords.length === 1) {
        map.setView(coords[0], 14);
      } else {
        map.fitBounds(L.latLngBounds(coords), { padding: [40, 40], maxZoom: 14 });
      }
    } catch {
      // ignore
    }
  }, [map, coords]);
  return null;
}

function MapZoomSync({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const map = useMap();
  useEffect(() => {
    const update = () => onZoomChange(map.getZoom());
    update();
    map.on('zoomend', update);
    return () => {
      map.off('zoomend', update);
    };
  }, [map, onZoomChange]);
  return null;
}

const DEFAULT_CENTER: [number, number] = [55.6761, 12.5683];
const DEFAULT_ZOOM = 10;

export default function PlanVisitMapPanel({
  newLocation,
  slot,
  dayEvents = [],
  homeBase,
  highlightedEventIds = [],
}: PlanVisitMapPanelProps) {
  const [zoom, setZoom] = React.useState(DEFAULT_ZOOM);
  const highlightedSet = React.useMemo(
    () => new Set(highlightedEventIds),
    [highlightedEventIds]
  );
  const homePos = React.useMemo<[number, number]>(
    () => [homeBase.lat, homeBase.lon],
    [homeBase.lat, homeBase.lon]
  );
  const insertionPos = React.useMemo<[number, number] | null>(
    () => (newLocation != null ? [newLocation.lat, newLocation.lon] : null),
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
        label: string;
        kind: 'new' | 'event';
        eventId?: string;
      }> = [];

      if (insertionPos != null) {
        items.push({
          id: 'new-meeting',
          coordinate: { latitude: insertionPos[0], longitude: insertionPos[1] },
          label: 'New',
          kind: 'new',
        });
      }

      sortedStops.forEach((stop) => {
        items.push({
          id: `stop-${stop.eventId}`,
          coordinate: stop.coordinate,
          label: String(stop.routeIndex + 1),
          kind: 'event',
          eventId: stop.eventId,
        });
      });

      return items;
    },
    [insertionPos, sortedStops]
  );

  const markerPositions = React.useMemo(
    () =>
      getMarkerPositions(displayStops.map((stop) => stop.coordinate), zoom, {
        pixelGap: BEST_MATCH_MARKER_GAP_PX,
      }),
    [displayStops, zoom]
  );

  const connectorLines = React.useMemo(
    () =>
      markerPositions
        .filter((marker) => marker.realCoordinate != null)
        .map((marker) => ({
          id: `connector-${displayStops[marker.index]?.id ?? marker.index}`,
          positions: [
            [marker.coordinate.latitude, marker.coordinate.longitude] as [number, number],
            [marker.realCoordinate!.latitude, marker.realCoordinate!.longitude] as [number, number],
          ],
        })),
    [displayStops, markerPositions]
  );

  const polylinePositions = React.useMemo<[number, number][]>(
    () =>
      coordsWithInsertion.length >= 2
        ? coordsWithInsertion.map((c) => [c.latitude, c.longitude])
        : [],
    [coordsWithInsertion]
  );

  const segmentDistanceBadges = React.useMemo(
    () =>
      polylinePositions.slice(0, -1).map((start, index) => {
        const end = polylinePositions[index + 1];
        const midpoint: [number, number] = [
          (start[0] + end[0]) / 2,
          (start[1] + end[1]) / 2,
        ];
        const distanceKm = segmentDistanceKm(start, end);
        return {
          id: `segment-distance-${index}`,
          position: midpoint,
          label: `${distanceKm.toFixed(1)} km`,
        };
      }),
    [polylinePositions]
  );

  const boundsCoords = React.useMemo<[number, number][]>(
    () =>
      polylinePositions.length >= 2
        ? polylinePositions
        : insertionPos != null
          ? [homePos, insertionPos]
          : [homePos],
    [homePos, insertionPos, polylinePositions]
  );

  return (
    <View style={styles.container}>
      <div style={styles.mapWrapper}>
        <MapContainer
          center={DEFAULT_CENTER}
          zoom={DEFAULT_ZOOM}
          scrollWheelZoom={true}
          style={styles.leafletMap}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapFitBounds coords={boundsCoords} />
          <MapZoomSync onZoomChange={setZoom} />
          <Marker
            position={homePos}
            icon={createIcon('#107C10', 'H')}
          />
          {connectorLines.map((line) => (
            <Polyline
              key={line.id}
              positions={line.positions}
              pathOptions={{ color: '#64748b', weight: 2, dashArray: '4, 4', opacity: 0.8 }}
            />
          ))}
          {markerPositions.map((marker) => {
            const stop = displayStops[marker.index];
            if (!stop) return null;
            const isHighlighted = stop.kind === 'event' && stop.eventId != null && highlightedSet.has(stop.eventId);
            return (
              <Marker
                key={stop.id}
                position={[marker.coordinate.latitude, marker.coordinate.longitude]}
                icon={createIcon(
                  stop.kind === 'new' ? '#D13438' : isHighlighted ? PUSHED_MEETING_PASTEL_YELLOW : '#0078D4',
                  stop.label,
                  stop.kind === 'new' ? '#FFFFFF' : isHighlighted ? '#7C2D12' : '#FFFFFF'
                )}
              />
            );
          })}
          {polylinePositions.length >= 2 && (
            <Polyline
              positions={polylinePositions}
              pathOptions={{ color: '#00B0FF', weight: 4 }}
            />
          )}
          {segmentDistanceBadges.map((badge) => (
            <Marker
              key={badge.id}
              position={badge.position}
              icon={createDistanceBadgeIcon(badge.label)}
              interactive={false}
              keyboard={false}
            />
          ))}
        </MapContainer>
      </div>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 200,
  },
  mapWrapper: {
    width: '100%',
    height: '100%',
    minHeight: 200,
    position: 'relative' as const,
  },
  leafletMap: {
    width: '100%',
    height: '100%',
    minHeight: 200,
  },
});
