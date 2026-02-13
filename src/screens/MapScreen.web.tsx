import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useRoute } from '../context/RouteContext';
import { useUserPreferences } from '../context/UserPreferencesContext';
import { getTravelMinutes } from '../utils/scheduler';
import { DEFAULT_HOME_BASE } from '../types';

import 'leaflet/dist/leaflet.css';
import 'leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.webpack.css';
import 'leaflet-defaulticon-compatibility';

const DEFAULT_CENTER: [number, number] = [55.6761, 12.5683];
const DEFAULT_ZOOM = 10;
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

function createNumberedIcon(num: number | string, color: string) {
  return L.divIcon({
    className: 'numbered-marker',
    html: `<div style="
      width:28px;height:28px;border-radius:14px;background:${color};
      border:2px solid #fff;box-shadow:0 1px 2px rgba(0,0,0,0.2);
      display:flex;align-items:center;justify-content:center;
      color:#fff;font-size:13px;font-weight:700;
    ">${num}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
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

/** Open directions in new tab (web: Google Maps) */
function openDirectionsWeb(lat: number, lon: number) {
  const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

export default function MapScreen() {
  const [showDetails, setShowDetails] = useState(false);
  const { appointments: appointmentsFromContext } = useRoute();
  const { preferences } = useUserPreferences();
  const appointments = appointmentsFromContext ?? [];
  const homeBase = preferences.homeBase ?? DEFAULT_HOME_BASE;
  const homeBaseLabel = preferences.homeBaseLabel ?? 'Home Base';
  const preBuffer = preferences.preMeetingBuffer ?? 15;
  const postBuffer = preferences.postMeetingBuffer ?? 15;

  const coords = useMemo(
    () =>
      appointments.filter(
        (a): a is typeof a & { coordinates: { latitude: number; longitude: number } } =>
          a.coordinates != null
      ),
    [appointments]
  );

  const { departByMs, returnByMs, boundsCoords, fullPolyline } = useMemo(() => {
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

    const homePos: [number, number] = [homeBase.lat, homeBase.lon];
    const meetingCoords: [number, number][] = coords.map((a) => [
      a.coordinates.latitude,
      a.coordinates.longitude,
    ]);
    const allForBounds =
      meetingCoords.length > 0 ? [homePos, ...meetingCoords, homePos] : [homePos];
    const fullPolylineCoords: [number, number][] =
      meetingCoords.length > 0 ? [homePos, ...meetingCoords, homePos] : [];

    return {
      departByMs,
      returnByMs,
      boundsCoords: allForBounds,
      fullPolyline: fullPolylineCoords,
    };
  }, [coords, homeBase, preBuffer, postBuffer]);

  const showHomeBase = fullPolyline.length > 0;

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
          {showHomeBase && (
            <Marker
              position={[homeBase.lat, homeBase.lon]}
              icon={createHomeBaseIcon()}
            >
              <Popup>
                <div style={popupStyles.container}>
                  <div style={[popupStyles.badge, { color: HOME_GREEN }]}>Home Base</div>
                  <strong style={popupStyles.title}>{homeBaseLabel}</strong>
                  <div style={popupStyles.time}>Depart by {formatTime(departByMs)}</div>
                  <div style={popupStyles.time}>Return ~{formatTime(returnByMs)}</div>
                </div>
              </Popup>
            </Marker>
          )}
          {coords.map((appointment, index) => {
            const pos: [number, number] = [
              appointment.coordinates.latitude,
              appointment.coordinates.longitude,
            ];
            const isCompleted = appointment.status === 'completed';
            const color = isCompleted ? '#808080' : MS_BLUE;
            return (
              <Marker
                key={appointment.id}
                position={pos}
                icon={createNumberedIcon(index + 1, color)}
              >
                <Popup>
                  <div style={popupStyles.container}>
                    <strong style={popupStyles.title}>{appointment.title}</strong>
                    <div style={popupStyles.time}>{appointment.time}</div>
                    {appointment.location ? <div style={popupStyles.address}>{appointment.location}</div> : null}
                    <button
                      type="button"
                      style={popupStyles.button}
                      onClick={() =>
                        openDirectionsWeb(
                          appointment.coordinates.latitude,
                          appointment.coordinates.longitude
                        )
                      }
                    >
                      Open in Google Maps
                    </button>
                  </div>
                </Popup>
              </Marker>
            );
          })}
          {fullPolyline.length >= 2 && (
            <Polyline positions={fullPolyline} pathOptions={{ color: '#00B0FF', weight: 4 }} />
          )}
        </MapContainer>
      </div>
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
});

const popupStyles = {
  container: { padding: 4, minWidth: 160 },
  badge: { fontSize: 10, fontWeight: 700, marginBottom: 4 },
  title: { display: 'block', marginBottom: 6, fontSize: 14 },
  time: { display: 'block', marginBottom: 4, fontSize: 12, color: '#605E5C' },
  address: { display: 'block', marginBottom: 8, fontSize: 11, color: '#64748b' },
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
};
