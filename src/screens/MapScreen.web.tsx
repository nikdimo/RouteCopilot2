import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useRoute } from '../context/RouteContext';
import { useLoadAppointmentsForDate } from '../hooks/useLoadAppointmentsForDate';
import { useRouteData } from '../hooks/useRouteData';
import { getMarkerPositions } from '../utils/mapClusters';
import { formatTime, formatDurationSeconds } from '../utils/dateUtils';
import DaySlider from '../components/DaySlider';
import { useEnsureMeetingCountsForDate } from '../hooks/useEnsureMeetingCountsForDate';
import { format, isSameDay, startOfDay } from 'date-fns';
import { type OSRMLeg } from '../utils/osrm';
import {
  pointAlongSegmentAndForward,
  pickTipCornerSimple,
  segmentBubblePath,
  formatDistance,
  offsetPolyline,
  SEGMENT_BUBBLE_W,
  SEGMENT_BUBBLE_H,
  type TipCorner,
  type LatLng,
} from '../utils/routeBubbles';

import 'leaflet/dist/leaflet.css';
import 'leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.webpack.css';
import 'leaflet-defaulticon-compatibility';

const DEFAULT_CENTER: [number, number] = [55.6761, 12.5683];
const DEFAULT_ZOOM = 10;
const MS_BLUE = '#0078D4';
const HOME_GREEN = '#107C10';

function createNumberedIcon(num: number | string, color: string, etaLabel?: string, sizePx: number = 28) {
  const r = sizePx / 2;
  const fontSz = Math.round((sizePx * 13) / 28);
  const pinOnly = !etaLabel;
  const html = pinOnly
    ? `<div style="
      width:${sizePx}px;height:${sizePx}px;border-radius:${r}px;background:${color};
      border:2px solid #fff;box-shadow:0 1px 2px rgba(0,0,0,0.2);
      display:flex;align-items:center;justify-content:center;
      color:#fff;font-size:${fontSz}px;font-weight:700;
    ">${num}</div>`
    : `<div style="display:flex;flex-direction:column;align-items:center;">
      <div style="
        font-size:10px;font-weight:600;color:#1a1a1a;background:rgba(255,255,255,0.96);
        padding:2px 5px;border-radius:4px;margin-bottom:2px;
        box-shadow:0 1px 2px rgba(0,0,0,0.15);white-space:nowrap;
      ">${etaLabel}</div>
      <div style="
        width:${sizePx}px;height:${sizePx}px;border-radius:${r}px;background:${color};
        border:2px solid #fff;box-shadow:0 1px 2px rgba(0,0,0,0.2);
        display:flex;align-items:center;justify-content:center;
        color:#fff;font-size:${fontSz}px;font-weight:700;
      ">${num}</div>
    </div>`;
  const height = pinOnly ? sizePx : sizePx + 18;
  const iconW = pinOnly ? sizePx : Math.max(60, sizePx + 4);
  return L.divIcon({
    className: 'numbered-marker',
    html,
    iconSize: [iconW, height],
    iconAnchor: [iconW / 2, height],
  });
}

/** Stack marker for overlapping waypoints: shows "2+4" and ETAs for each. */
function createClusterIcon(waypointNumbers: number[], color: string, etaLabels: (string | undefined)[]) {
  const label = waypointNumbers.join('+');
  const hasEta = etaLabels.some((e) => e != null && e !== '');
  const etaBlock =
    hasEta &&
    `<div style="
      display:flex;flex-direction:column;align-items:center;gap:2px;
      font-size:10px;font-weight:600;color:#1a1a1a;background:rgba(255,255,255,0.96);
      padding:2px 5px;border-radius:4px;margin-bottom:2px;
      box-shadow:0 1px 2px rgba(0,0,0,0.15);white-space:nowrap;
    ">${etaLabels.map((e) => (e ?? '—')).join(' · ')}</div>`;
  const pinBlock = `<div style="
    min-width:36px;height:28px;padding:0 6px;border-radius:14px;background:${color};
    border:2px solid #fff;box-shadow:0 1px 2px rgba(0,0,0,0.2);
    display:flex;align-items:center;justify-content:center;
    color:#fff;font-size:12px;font-weight:700;
  ">${label}</div>`;
  const html = `<div style="display:flex;flex-direction:column;align-items:center;">${etaBlock || ''}${pinBlock}</div>`;
  const height = hasEta ? 28 + 20 : 28;
  return L.divIcon({
    className: 'cluster-marker',
    html,
    iconSize: [56, height],
    iconAnchor: [28, height],
  });
}

function createHomeBaseIcon() {
  return L.divIcon({
    className: 'home-marker',
    html: `<div style="
      width:28px;height:28px;border-radius:14px;background:${HOME_GREEN};
      border:2px solid #fff;box-shadow:0 1px 2px rgba(0,0,0,0.2);
      display:flex;align-items:center;justify-content:center;
      color:#fff;font-size:12px;font-weight:700;
    ">H</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

/** Fraction along each leg for bubble position (closer to destination = more spread out). */
const SEGMENT_BUBBLE_FRACTION = 0.75;

/** Renders segment bubble only for the selected leg (when selectedLegIndex != null). */
function SegmentBubblesLayer({
  legs,
  selectedLegIndex,
}: {
  legs: OSRMLeg[];
  selectedLegIndex: number | null;
}) {
  const map = useMap();
  const [corner, setCorner] = useState<TipCorner>('BR');

  useEffect(() => {
    if (selectedLegIndex == null || !legs[selectedLegIndex]) {
      return;
    }
    const leg = legs[selectedLegIndex]!;
    const updateCorner = () => {
      const mf = pointAlongSegmentAndForward(leg.coordinates, SEGMENT_BUBBLE_FRACTION);
      if (!mf) return;
      try {
        const mPoint = map.latLngToContainerPoint([mf.M.latitude, mf.M.longitude]);
        const fPoint = map.latLngToContainerPoint([mf.F.latitude, mf.F.longitude]);
        const vx = fPoint.x - mPoint.x;
        const vy = fPoint.y - mPoint.y;
        const len = Math.sqrt(vx * vx + vy * vy) || 1;
        const rightScreen = { x: vy / len, y: -vx / len };
        setCorner(pickTipCornerSimple(rightScreen, SEGMENT_BUBBLE_W, SEGMENT_BUBBLE_H));
      } catch {
        setCorner('BR');
      }
    };

    updateCorner();
    map.on('moveend', updateCorner);
    map.on('zoomend', updateCorner);
    return () => {
      map.off('moveend', updateCorner);
      map.off('zoomend', updateCorner);
    };
  }, [map, legs, selectedLegIndex]);

  if (selectedLegIndex == null || !legs[selectedLegIndex]) return null;

  const leg = legs[selectedLegIndex]!;
  const mf = pointAlongSegmentAndForward(leg.coordinates, SEGMENT_BUBBLE_FRACTION);
  if (!mf) return null;

  const durationStr = formatDurationSeconds(leg.duration);
  const distanceStr = formatDistance(leg.distance);
  const anchorByCorner: Record<TipCorner, [number, number]> = {
    TL: [0, 0],
    TR: [SEGMENT_BUBBLE_W, 0],
    BL: [0, SEGMENT_BUBBLE_H],
    BR: [SEGMENT_BUBBLE_W, SEGMENT_BUBBLE_H],
  };

  return (
    <Marker
      position={[mf.M.latitude, mf.M.longitude]}
      icon={L.divIcon({
        className: 'segment-bubble-marker',
        html: `
          <div style="position:absolute;left:0;top:0;width:${SEGMENT_BUBBLE_W}px;height:${SEGMENT_BUBBLE_H}px;pointer-events:none;">
            <svg width="${SEGMENT_BUBBLE_W}" height="${SEGMENT_BUBBLE_H}" viewBox="0 0 ${SEGMENT_BUBBLE_W} ${SEGMENT_BUBBLE_H}">
              <path d="${segmentBubblePath(corner)}" fill="rgba(255,255,255,0.96)" stroke="#0078D4" stroke-width="1.5"/>
            </svg>
            <div style="position:absolute;left:0;top:0;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:#1a1a1a;pointer-events:none;">
              <span>${durationStr}</span>
              <span style="font-size:10px;color:#64748b;font-weight:500">${distanceStr}</span>
            </div>
          </div>
        `,
        iconSize: [SEGMENT_BUBBLE_W, SEGMENT_BUBBLE_H],
        iconAnchor: anchorByCorner[corner],
      })}
    />
  );
}

/** Fit map to show all coordinates with padding */
function MapFitBounds({ coords }: { coords: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (coords.length === 0) return;
    try {
      if (coords.length === 1) {
        map.setView(coords[0], 14);
      } else {
        map.fitBounds(L.latLngBounds(coords), { padding: [60, 60], maxZoom: 14 });
      }
    } catch {
      // ignore
    }
  }, [map, coords]);
  return null;
}

/** Clears selected leg when user clicks the map. */
function MapClickToClear({ onClear }: { onClear: () => void }) {
  const map = useMap();
  useEffect(() => {
    map.on('click', onClear);
    return () => map.off('click', onClear);
  }, [map, onClear]);
  return null;
}

/** Zoom map to a coordinate when focused (e.g. after tapping a cluster). */
function ZoomToFocusedCluster({
  coord,
  zoom,
}: {
  coord: { latitude: number; longitude: number } | null;
  zoom: number;
}) {
  const map = useMap();
  useEffect(() => {
    if (!coord) return;
    map.setView([coord.latitude, coord.longitude], zoom);
  }, [map, coord?.latitude, coord?.longitude, zoom]);
  return null;
}

export type ClusterTapInfo = {
  clusterKey: string;
  coordinate: { latitude: number; longitude: number };
  isCluster: boolean;
};

const LATE_RED = '#D13438';

/** Waypoint markers: circles touch by default; when a cluster is focused, zoom in and use larger offset + larger icons. */
function WaypointMarkersLayer({
  coordList,
  coords,
  etas,
  legStress,
  focusedClusterKey,
  onSelect,
}: {
  coordList: Array<{ latitude: number; longitude: number }>;
  coords: Array<{ status?: string; coordinates: { latitude: number; longitude: number }; title?: string; location?: string }>;
  etas: (number | null | undefined)[];
  legStress?: ('ok' | 'tight' | 'late')[];
  focusedClusterKey: string | null;
  onSelect: (index: number, clusterInfo: ClusterTapInfo | null) => void;
}) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useEffect(() => {
    const update = () => setZoom(map.getZoom());
    map.on('zoomend', update);
    map.on('moveend', update);
    return () => {
      map.off('zoomend', update);
      map.off('moveend', update);
    };
  }, [map]);
  const markerPositions = useMemo(
    () =>
      getMarkerPositions(coordList, zoom, {
        focusedClusterKey,
        focusedPixelGap: 64,
      }),
    [coordList, zoom, focusedClusterKey]
  );
  return (
    <>
      {markerPositions.map(({ index, coordinate, realCoordinate, clusterKey, isCluster }) => {
        if (realCoordinate != null) {
          const dashPositions: [number, number][] = [
            [coordinate.latitude, coordinate.longitude],
            [realCoordinate.latitude, realCoordinate.longitude],
          ];
          return (
            <Polyline
              key={`connector-${index}`}
              positions={dashPositions}
              pathOptions={{
                color: '#64748b',
                weight: 2,
                opacity: 0.8,
                dashArray: '4, 4',
              }}
            />
          );
        }
        return null;
      })}
      {markerPositions.map(({ index, coordinate, realCoordinate, clusterKey, isCluster }) => {
        const appointment = coords[index]!;
        const anyCompleted = appointment.status === 'completed';
        const isLate = legStress?.[index] === 'late';
        const color = anyCompleted ? '#808080' : isLate ? LATE_RED : MS_BLUE;
        const pos: [number, number] = [
          coordinate.latitude,
          coordinate.longitude,
        ];
        const eta = etas[index];
        const etaLabel = eta != null ? formatTime(eta) : undefined;
        const isFocused = isCluster && clusterKey != null && clusterKey === focusedClusterKey;
        const icon = createNumberedIcon(index + 1, color, etaLabel, isFocused ? 40 : 28);
        const clusterInfo: ClusterTapInfo | null =
          isCluster && clusterKey != null
            ? { clusterKey, coordinate, isCluster: true }
            : null;
        return (
          <Marker
            key={`waypoint-${index}`}
            position={pos}
            icon={icon}
            eventHandlers={{
              click: () => onSelect(index, clusterInfo),
            }}
          />
        );
      })}
    </>
  );
}

/** Open directions in new tab (web: Google Maps) */
function openDirectionsWeb(lat: number, lon: number) {
  const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

const FOCUSED_ZOOM = 17;

type MapScreenProps = { embeddedInSchedule?: boolean };

export default function MapScreen({ embeddedInSchedule }: MapScreenProps = {}) {
  const navigation = useNavigation();
  const { selectedDate: ctxSelectedDate, setSelectedDate, meetingCountByDay, highlightWaypointIndex, setHighlightWaypointIndex } = useRoute();
  const ensureMeetingCountsForDate = useEnsureMeetingCountsForDate();
  const [showDetails, setShowDetails] = useState(false);
  const [selectedArrivalLegIndex, setSelectedArrivalLegIndex] = useState<number | null>(null);
  const [selectedWaypointIndices, setSelectedWaypointIndices] = useState<number[] | null>(null);
  const [focusedClusterKey, setFocusedClusterKey] = useState<string | null>(null);
  const [focusedClusterCoord, setFocusedClusterCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const { load } = useLoadAppointmentsForDate(undefined);
  const clearSelection = useCallback(() => {
    setSelectedArrivalLegIndex(null);
    setSelectedWaypointIndices(null);
    setFocusedClusterKey(null);
    setFocusedClusterCoord(null);
  }, []);
  const routeData = useRouteData();
  const {
    appointments,
    coords,
    osrmRoute,
    routeLoading,
    departByMs,
    returnByMs,
    allCoordsForFit,
    fullPolyline,
    etas,
    homeBase,
    homeBaseLabel,
  } = routeData;
  const legStress = routeData.legStress ?? [];

  const legStrokeColor = (legIndex: number): string => {
    const s = legStress[legIndex];
    if (s === 'late') return '#D13438';
    if (s === 'tight') return '#C19C00';
    return MS_BLUE;
  };

  const today = useMemo(() => startOfDay(new Date()), []);

  useFocusEffect(
    useCallback(() => {
      if (appointments.length === 0 && isSameDay(ctxSelectedDate, today)) load();
      if (!embeddedInSchedule) ensureMeetingCountsForDate(ctxSelectedDate);
    }, [load, appointments.length, embeddedInSchedule, ensureMeetingCountsForDate, ctxSelectedDate, today])
  );
  const headerTitle = isSameDay(ctxSelectedDate, today) ? "Today's Route" : format(ctxSelectedDate, 'EEE, MMM d');

  const onSelectDate = useCallback(
    (date: Date) => {
      clearSelection();
      setSelectedDate(date);
      ensureMeetingCountsForDate(date);
    },
    [clearSelection, setSelectedDate, ensureMeetingCountsForDate]
  );

  // Clear selection whenever the displayed date changes (e.g. from DaySlider or from another tab)
  useEffect(() => {
    clearSelection();
  }, [ctxSelectedDate, clearSelection]);

  // When schedule sets highlight (e.g. tap waypoint number on card), highlight that waypoint/leg on map (tab and embedded)
  useEffect(() => {
    const idx = highlightWaypointIndex;
    if (typeof idx === 'number' && coords[idx] != null) {
      setSelectedArrivalLegIndex(idx);
      setSelectedWaypointIndices([idx]);
      setFocusedClusterKey(null);
      setFocusedClusterCoord(null);
      setHighlightWaypointIndex(null);
    }
  }, [highlightWaypointIndex, coords, setHighlightWaypointIndex]);

  useLayoutEffect(() => {
    if (embeddedInSchedule) return;
    navigation.setOptions?.({
      headerTitle: headerTitle,
      headerStyle: { backgroundColor: MS_BLUE },
      headerTintColor: '#fff',
    });
  }, [embeddedInSchedule, navigation, headerTitle]);

  const boundsCoords = useMemo(
    (): [number, number][] =>
      allCoordsForFit.map((c) => [c.latitude, c.longitude]),
    [allCoordsForFit]
  );
  const coordList = useMemo(() => coords.map((a) => a.coordinates), [coords]);
  const fullPolylineLatLon = useMemo(
    (): [number, number][] =>
      fullPolyline.map((c) => [c.latitude, c.longitude]),
    [fullPolyline]
  );
  const showHomeBase = fullPolyline.length > 0;

  if (appointments.length === 0) {
    return (
      <View style={styles.container}>
        {!embeddedInSchedule && (
          <DaySlider
            selectedDate={ctxSelectedDate}
            onSelectDate={onSelectDate}
            meetingCountByDay={meetingCountByDay}
          />
        )}
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
        {!embeddedInSchedule && (
          <DaySlider
            selectedDate={ctxSelectedDate}
            onSelectDate={onSelectDate}
            meetingCountByDay={meetingCountByDay}
          />
        )}
        <View style={styles.placeholderContainer}>
          <Text style={styles.placeholderText}>
            No locations with addresses. Add addresses to your meetings to see them on the map.
          </Text>
        </View>
      </View>
    );
  }

  const mapWrapperStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    minHeight: 400,
  };

  const leafletMapStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    minHeight: 400,
  };

  return (
    <View style={styles.container}>
      {!embeddedInSchedule && (
        <DaySlider
          selectedDate={ctxSelectedDate}
          onSelectDate={onSelectDate}
          meetingCountByDay={meetingCountByDay}
        />
      )}
      {!embeddedInSchedule && routeLoading && (
        <View style={styles.loadingBar}>
          <Text style={styles.loadingBarText}>Loading route…</Text>
        </View>
      )}
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
                <Text style={styles.detailsCardTime}>
                  {appointment.time}
                  {etas[index] != null && (
                    <> · Arrive ~{formatTime(etas[index]!)}</>
                  )}
                </Text>
                <Text style={styles.detailsCardAddress}>{appointment.location}</Text>
                <TouchableOpacity onPress={() => openDirectionsWeb(appointment.coordinates.latitude, appointment.coordinates.longitude)}>
                  <Text style={styles.detailsCardLink}>Open in Google Maps</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
      <div style={mapWrapperStyle}>
        <MapContainer
          center={DEFAULT_CENTER}
          zoom={DEFAULT_ZOOM}
          scrollWheelZoom={true}
          style={leafletMapStyle}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapFitBounds coords={boundsCoords} />
          <ZoomToFocusedCluster coord={focusedClusterCoord} zoom={FOCUSED_ZOOM} />
          <MapClickToClear onClear={clearSelection} />
          {showHomeBase && (
            <Marker
              position={[homeBase.lat, homeBase.lon]}
              icon={createHomeBaseIcon()}
            >
              <Popup>
                <div style={popupStyles.container}>
                  <div style={{ ...popupStyles.badge, color: HOME_GREEN }}>Home Base</div>
                  <strong style={popupStyles.title}>{homeBaseLabel}</strong>
                  <div style={popupStyles.time}>Depart by {formatTime(departByMs)}</div>
                  <div style={popupStyles.time}>Return ~{formatTime(returnByMs)}</div>
                </div>
              </Popup>
            </Marker>
          )}
          <WaypointMarkersLayer
            coordList={coordList}
            coords={coords}
            etas={etas}
            legStress={legStress}
            focusedClusterKey={focusedClusterKey}
            onSelect={(index, _clusterInfo) => {
              setFocusedClusterKey(null);
              setFocusedClusterCoord(null);
              setSelectedArrivalLegIndex(index);
              setSelectedWaypointIndices([index]);
            }}
          />
          {osrmRoute?.legs
            ? (() => {
                const LEG_OFFSET_DEG = 0.00025;
                const HIGHLIGHT_WEIGHT = 7;
                const LATE_LEG_WEIGHT = 9;
                const legs = osrmRoute.legs;
                const toPositions = (coords: LatLng[]): [number, number][] =>
                  coords.map((c) => [c.latitude, c.longitude]);
                const elements: React.ReactNode[] = [];
                for (let idx = 1; idx < legs.length; idx++) {
                  const leg = legs[idx]!;
                  if (leg.coordinates.length < 2) continue;
                  if (idx === selectedArrivalLegIndex) continue;
                  if (legStress[idx] === 'late') continue;
                  const offsetSign = idx % 2 === 1 ? (1 as const) : (-1 as const);
                  const offsetCoords = offsetPolyline(leg.coordinates, LEG_OFFSET_DEG, offsetSign);
                  elements.push(
                    <Polyline
                      key={idx}
                      positions={toPositions(offsetCoords)}
                      pathOptions={{ color: legStrokeColor(idx), weight: 4 }}
                    />
                  );
                }
                for (let idx = 1; idx < legs.length; idx++) {
                  const leg = legs[idx]!;
                  if (leg.coordinates.length < 2) continue;
                  if (idx === selectedArrivalLegIndex) continue;
                  if (legStress[idx] !== 'late') continue;
                  const offsetSign = idx % 2 === 1 ? (1 as const) : (-1 as const);
                  const offsetCoords = offsetPolyline(leg.coordinates, LEG_OFFSET_DEG, offsetSign);
                  elements.push(
                    <Polyline
                      key={`late-${idx}`}
                      positions={toPositions(offsetCoords)}
                      pathOptions={{ color: legStrokeColor(idx), weight: LATE_LEG_WEIGHT }}
                    />
                  );
                }
                const isArrivalLeg = selectedArrivalLegIndex !== null && selectedArrivalLegIndex < legs.length - 1;
                if (isArrivalLeg && legs[selectedArrivalLegIndex!]?.coordinates.length >= 2) {
                  const idx = selectedArrivalLegIndex!;
                  const leg = legs[idx]!;
                  const positions =
                    idx === 0
                      ? toPositions(leg.coordinates)
                      : toPositions(
                          offsetPolyline(
                            leg.coordinates,
                            LEG_OFFSET_DEG,
                            idx % 2 === 1 ? (1 as const) : (-1 as const)
                          )
                        );
                  elements.push(
                    <Polyline
                      key={`highlight-${idx}`}
                      positions={positions}
                      pathOptions={{
                        color: HOME_GREEN,
                        weight: HIGHLIGHT_WEIGHT,
                      }}
                    />
                  );
                }
                return elements;
              })()
            : fullPolylineLatLon.length >= 2 && (
                <Polyline positions={fullPolylineLatLon} pathOptions={{ color: '#00B0FF', weight: 4 }} />
              )}
          {osrmRoute?.legs && osrmRoute.legs.length > 0 && (
            <SegmentBubblesLayer
              legs={osrmRoute.legs}
              selectedLegIndex={selectedArrivalLegIndex}
            />
          )}
        </MapContainer>
      </div>
      {selectedWaypointIndices &&
        selectedWaypointIndices.length > 0 &&
        selectedWaypointIndices.every((i) => coords[i] != null) && (
        <View style={styles.bottomCardContainer} pointerEvents="box-none">
          <View style={[styles.bottomCard]}>
            {selectedWaypointIndices.length === 1 ? (
              (() => {
                const idx = selectedWaypointIndices[0]!;
                const appt = coords[idx];
                if (!appt) return null;
                const eta = etas[idx];
                return (
                  <>
                    <Text style={styles.bottomCardTitle}>{appt.title ?? 'Meeting'}</Text>
                    {appt.location ? (
                      <Text style={styles.bottomCardAddress}>{appt.location}</Text>
                    ) : null}
                    {eta != null && (
                      <Text style={styles.bottomCardTime}>
                        Arrive ~{formatTime(eta)}
                      </Text>
                    )}
                    <TouchableOpacity
                      style={styles.bottomCardButton}
                      onPress={() =>
                        openDirectionsWeb(
                          appt.coordinates.latitude,
                          appt.coordinates.longitude
                        )
                      }
                    >
                      <Text style={styles.bottomCardButtonText}>Open in Google Maps</Text>
                    </TouchableOpacity>
                    {appt.phone ? (
                      <a
                        href={`tel:${appt.phone}`}
                        style={styles.bottomCardButtonLink}
                      >
                        Call
                      </a>
                    ) : null}
                    <TouchableOpacity
                      style={styles.bottomCardClose}
                      onPress={clearSelection}
                    >
                      <Text style={styles.bottomCardCloseText}>Close</Text>
                    </TouchableOpacity>
                  </>
                );
              })()
            ) : (
              <>
                <Text style={styles.bottomCardClusterTitle}>
                  {selectedWaypointIndices.length} waypoints at this location
                </Text>
                <ScrollView style={styles.bottomCardScroll}>
                  {selectedWaypointIndices.map((idx) => {
                    const appt = coords[idx];
                    if (!appt) return null;
                    const apptEta = etas[idx];
                    return (
                      <View key={appt.id} style={styles.bottomCardItem}>
                        <Text style={styles.bottomCardTitle}>{idx + 1}. {appt.title ?? 'Meeting'}</Text>
                        {appt.location ? (
                          <Text style={styles.bottomCardAddress}>{appt.location}</Text>
                        ) : null}
                        <Text style={styles.bottomCardTime}>
                          {appt.time}
                          {apptEta != null && ` · Arrive ~${formatTime(apptEta)}`}
                        </Text>
                        <TouchableOpacity
                          style={styles.bottomCardButton}
                          onPress={() =>
                            openDirectionsWeb(
                              appt.coordinates.latitude,
                              appt.coordinates.longitude
                            )
                          }
                        >
                          <Text style={styles.bottomCardButtonText}>Open in Google Maps</Text>
                        </TouchableOpacity>
                        {appt.phone ? (
                          <a href={`tel:${appt.phone}`} style={styles.bottomCardButtonLink}>
                            Call
                          </a>
                        ) : null}
                      </View>
                    );
                  })}
                </ScrollView>
                <TouchableOpacity style={styles.bottomCardClose} onPress={clearSelection}>
                  <Text style={styles.bottomCardCloseText}>Close</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 400,
  },
  placeholderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    padding: 24,
  },
  placeholderText: {
    fontSize: 16,
    color: '#64748b',
    textAlign: 'center',
  },
  loadingBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 999,
    backgroundColor: 'rgba(0,120,212,0.9)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  loadingBarText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  detailsButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 1000,
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
    zIndex: 1000,
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
  bottomCardContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingBottom: 24,
    zIndex: 15,
    justifyContent: 'flex-end',
  },
  bottomCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    maxHeight: '40%',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  bottomCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  bottomCardAddress: {
    fontSize: 11,
    color: '#64748b',
    marginBottom: 4,
  },
  bottomCardTime: {
    fontSize: 12,
    color: '#605E5C',
    marginBottom: 8,
  },
  bottomCardClusterTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    marginBottom: 10,
  },
  bottomCardScroll: {
    maxHeight: 200,
    marginBottom: 8,
  },
  bottomCardItem: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  bottomCardButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: MS_BLUE,
    borderRadius: 6,
    marginBottom: 6,
    alignItems: 'center',
  },
  bottomCardButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  bottomCardButtonLink: {
    display: 'block',
    marginBottom: 8,
    fontSize: 12,
    fontWeight: '600',
    color: MS_BLUE,
    textAlign: 'center',
    textDecoration: 'none',
  },
  bottomCardClose: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  bottomCardCloseText: {
    fontSize: 12,
    fontWeight: '600',
    color: MS_BLUE,
  },
});

const popupStyles = {
  container: { padding: 4, minWidth: 160 },
  badge: { fontSize: 10, fontWeight: 700, marginBottom: 4 },
  title: { display: 'block', marginBottom: 6, fontSize: 14 },
  time: { display: 'block', marginBottom: 4, fontSize: 12, color: '#605E5C' },
  address: { display: 'block', marginBottom: 8, fontSize: 11, color: '#64748b' },
  clusterTitle: { fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 10 },
  clusterItem: { marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid #e2e8f0' },
  button: {
    padding: '6px 12px',
    backgroundColor: MS_BLUE,
    color: 'white',
    border: 'none',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  buttonLink: {
    display: 'block',
    marginTop: 6,
    textAlign: 'center' as const,
    textDecoration: 'none',
  },
};
