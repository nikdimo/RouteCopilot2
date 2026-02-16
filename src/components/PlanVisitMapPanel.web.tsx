import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { CalendarEvent } from '../services/graph';
import type { ScoredSlot } from '../utils/scheduler';
import type { Coordinate } from '../utils/scheduler';
import { buildRouteWithInsertion } from '../utils/mapPreview';

import 'leaflet/dist/leaflet.css';
import 'leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.webpack.css';
import 'leaflet-defaulticon-compatibility';

export type PlanVisitMapPanelProps = {
  newLocation?: Coordinate | null;
  slot?: ScoredSlot | null;
  dayEvents?: CalendarEvent[];
  homeBase: Coordinate;
};

function createIcon(color: string, label: string) {
  return L.divIcon({
    className: 'plan-visit-marker',
    html: `<div style="
      width:28px;height:28px;border-radius:14px;background:${color};
      border:2px solid #fff;box-shadow:0 1px 2px rgba(0,0,0,0.2);
      display:flex;align-items:center;justify-content:center;
      color:#fff;font-size:12px;font-weight:700;
    ">${label}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
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

const DEFAULT_CENTER: [number, number] = [55.6761, 12.5683];
const DEFAULT_ZOOM = 10;

export default function PlanVisitMapPanel({
  newLocation,
  slot,
  dayEvents = [],
  homeBase,
}: PlanVisitMapPanelProps) {
  const homePos: [number, number] = [homeBase.lat, homeBase.lon];
  const insertionPos: [number, number] | null =
    newLocation != null ? [newLocation.lat, newLocation.lon] : null;

  const coordsWithInsertion =
    slot != null && newLocation != null && dayEvents.length > 0
      ? buildRouteWithInsertion(dayEvents, newLocation, slot, homeBase)
      : [];

  const polylinePositions: [number, number][] =
    coordsWithInsertion.length >= 2
      ? coordsWithInsertion.map((c) => [c.latitude, c.longitude])
      : [];

  const boundsCoords: [number, number][] =
    polylinePositions.length >= 2
      ? polylinePositions
      : insertionPos != null
        ? [homePos, insertionPos]
        : [homePos];

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
          <Marker
            position={homePos}
            icon={createIcon('#107C10', 'H')}
          />
          {insertionPos != null && (
            <Marker
              position={insertionPos}
              icon={createIcon('#D13438', '!')}
            />
          )}
          {dayEvents
            .filter(
              (a): a is typeof a & { coordinates: { latitude: number; longitude: number } } =>
                a.coordinates != null
            )
            .map((a, i) => (
              <Marker
                key={a.id}
                position={[a.coordinates.latitude, a.coordinates.longitude]}
                icon={createIcon('#0078D4', String(i + 1))}
              />
            ))}
          {polylinePositions.length >= 2 && (
            <Polyline
              positions={polylinePositions}
              pathOptions={{ color: '#00B0FF', weight: 4 }}
            />
          )}
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
