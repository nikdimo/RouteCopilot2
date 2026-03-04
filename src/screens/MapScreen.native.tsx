import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  TouchableOpacity,
  ScrollView,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRoute as useNavRoute, useNavigation } from '@react-navigation/native';
import { Phone } from 'lucide-react-native';
import { format, isSameDay, startOfDay } from 'date-fns';
import { openNativeDirections } from '../utils/maps';
import { useRoute } from '../context/RouteContext';
import { useLoadAppointmentsForDate } from '../hooks/useLoadAppointmentsForDate';
import { useRouteData } from '../hooks/useRouteData';
import { formatTime } from '../utils/dateUtils';
import DaySlider from '../components/DaySlider';
import { useEnsureMeetingCountsForDate } from '../hooks/useEnsureMeetingCountsForDate';
import { useIsWideScreen } from '../hooks/useIsWideScreen';
import { getClusters } from '../utils/mapClusters';
import NativeLeafletMap, {
  type LeafletCoordinate,
  type LeafletMarker,
  type LeafletPolyline,
} from '../components/NativeLeafletMap';

const DEFAULT_COORD: LeafletCoordinate = {
  latitude: 55.6761,
  longitude: 12.5683,
};

const MS_BLUE = '#0078D4';
const ROUTE_BLUE = '#0078D4';
const HOME_GREEN = '#107C10';

type MapScreenNavParams = { triggerLoadWhenEmpty?: boolean };
type MapScreenProps = { embeddedInSchedule?: boolean };

export default function MapScreen({ embeddedInSchedule }: MapScreenProps = {}) {
  const [mapReady, setMapReady] = useState(false);
  const [focusedClusterKey, setFocusedClusterKey] = useState<string | null>(null);
  const [selectedArrivalLegIndex, setSelectedArrivalLegIndex] = useState<number | null>(null);
  const [selectedWaypointIndices, setSelectedWaypointIndices] = useState<number[] | null>(null);
  const [fitRequestKey, setFitRequestKey] = useState(0);

  const navigation = useNavigation();
  const isWide = useIsWideScreen();
  const insets = useSafeAreaInsets();
  const {
    selectedDate: ctxSelectedDate,
    setSelectedDate,
    meetingCountByDay,
    highlightWaypointIndex,
    setHighlightWaypointIndex,
    triggerRefresh,
  } = useRoute();
  const ensureMeetingCountsForDate = useEnsureMeetingCountsForDate();
  const navRoute = useNavRoute();
  const navParams = navRoute.params as MapScreenNavParams | undefined;
  const triggerLoadWhenEmpty = navParams?.triggerLoadWhenEmpty ?? false;
  const { load } = useLoadAppointmentsForDate(undefined);

  const routeData = useRouteData();
  const {
    appointments,
    coords,
    osrmRoute,
    routeLoading,
    allCoordsForFit,
    fullPolyline,
    etas,
    meetingDurations,
    legStress,
    homeBase,
    homeBaseLabel,
    refetchRouteIfNeeded,
  } = routeData;

  const today = useMemo(() => startOfDay(new Date()), []);

  useFocusEffect(
    useCallback(() => {
      if (triggerLoadWhenEmpty && appointments.length === 0 && isSameDay(ctxSelectedDate, today)) load();
      if (!embeddedInSchedule && appointments.length === 0) triggerRefresh();
      if (!embeddedInSchedule) ensureMeetingCountsForDate(ctxSelectedDate);
      refetchRouteIfNeeded();
    }, [
      triggerLoadWhenEmpty,
      load,
      appointments.length,
      ctxSelectedDate,
      today,
      embeddedInSchedule,
      triggerRefresh,
      ensureMeetingCountsForDate,
      refetchRouteIfNeeded,
    ])
  );

  const headerTitle = isSameDay(ctxSelectedDate, today) ? "Today's Route" : format(ctxSelectedDate, 'EEE, MMM d');

  const onSelectDate = useCallback(
    (date: Date) => {
      setSelectedArrivalLegIndex(null);
      setSelectedWaypointIndices(null);
      setFocusedClusterKey(null);
      setSelectedDate(date);
      ensureMeetingCountsForDate(date);
    },
    [ensureMeetingCountsForDate, setSelectedDate]
  );

  useEffect(() => {
    setSelectedArrivalLegIndex(null);
    setSelectedWaypointIndices(null);
    setFocusedClusterKey(null);
  }, [ctxSelectedDate]);

  useEffect(() => {
    const idx = highlightWaypointIndex;
    if (typeof idx === 'number' && coords[idx] != null) {
      setSelectedArrivalLegIndex(idx);
      setSelectedWaypointIndices([idx]);
      setFocusedClusterKey(null);
      setHighlightWaypointIndex(null);
    }
  }, [highlightWaypointIndex, coords, setHighlightWaypointIndex]);

  useLayoutEffect(() => {
    if (embeddedInSchedule) return;
    navigation.setOptions({
      headerShown: false,
      headerTitle,
      headerTitleStyle: { fontWeight: '600', fontSize: isWide ? 16 : undefined },
      headerStyle: { backgroundColor: MS_BLUE },
      headerTintColor: '#fff',
    });
  }, [embeddedInSchedule, headerTitle, isWide, navigation]);

  const routeCoordinates = osrmRoute?.coordinates?.length
    ? osrmRoute.coordinates
    : fullPolyline.length >= 2
      ? fullPolyline
      : [];

  const mainPolylineCoords = useMemo(() => {
    if (routeCoordinates.length < 2) return [];
    // Keep only one route line. Prefer OSRM road geometry when available.
    if (!osrmRoute?.coordinates?.length) return routeCoordinates;
    const maxPoints = 1800;
    if (routeCoordinates.length <= maxPoints) return routeCoordinates;
    const step = routeCoordinates.length / maxPoints;
    const out: typeof routeCoordinates = [];
    for (let i = 0; i < maxPoints; i++) {
      const idx = Math.min(Math.floor(i * step), routeCoordinates.length - 1);
      out.push(routeCoordinates[idx]!);
    }
    out.push(routeCoordinates[routeCoordinates.length - 1]!);
    return out;
  }, [osrmRoute?.coordinates, routeCoordinates]);

  const coordList = useMemo(() => coords.map((a) => a.coordinates), [coords]);

  const clusterMembersByKey = useMemo(() => {
    const out = new Map<string, number[]>();
    for (const cluster of getClusters(coordList)) {
      if (cluster.indices.length > 1) out.set(cluster.coordKey, [...cluster.indices]);
    }
    return out;
  }, [coordList]);

  const showHomeBase = fullPolyline.length > 0;

  const mapMarkers = useMemo<LeafletMarker[]>(() => {
    const markers: LeafletMarker[] = [];

    if (showHomeBase) {
      markers.push({
        id: 'home-base',
        coordinate: { latitude: homeBase.lat, longitude: homeBase.lon },
        label: 'H',
        title: homeBaseLabel ?? 'Home Base',
        color: HOME_GREEN,
        index: 0,
      });
    }

    for (const cluster of getClusters(coordList)) {
      if (cluster.indices.length > 1) {
        const label = cluster.indices.map((i) => String(i + 1)).join('+');
        const allDone = cluster.indices.every((i) => coords[i]?.status === 'completed');
        const anyLate = cluster.indices.some((i) => legStress[i] === 'late');
        markers.push({
          id: `cluster-${cluster.coordKey}`,
          coordinate: cluster.coordinate,
          label,
          title: `${cluster.indices.length} waypoints`,
          color: allDone ? '#808080' : anyLate ? '#D13438' : MS_BLUE,
          index: cluster.indices[0],
          isCluster: true,
          clusterKey: cluster.coordKey,
        });
        continue;
      }

      const index = cluster.indices[0];
      if (index == null || !coords[index]) continue;
      const appointment = coords[index];
      const isCompleted = appointment.status === 'completed';
      const isLate = legStress[index] === 'late';
      markers.push({
        id: `waypoint-${index}`,
        coordinate: appointment.coordinates,
        label: String(index + 1),
        title: appointment.title ?? appointment.location ?? `Waypoint ${index + 1}`,
        color: isCompleted ? '#808080' : isLate ? '#D13438' : MS_BLUE,
        index,
      });
    }

    return markers;
  }, [coordList, coords, homeBase.lat, homeBase.lon, homeBaseLabel, legStress, showHomeBase]);

  const markerById = useMemo(() => {
    const map = new Map<string, LeafletMarker>();
    for (const marker of mapMarkers) {
      map.set(marker.id, marker);
    }
    return map;
  }, [mapMarkers]);

  const mapPolylines = useMemo<LeafletPolyline[]>(() => {
    const lines: LeafletPolyline[] = [];

    if (mainPolylineCoords.length >= 2) {
      lines.push({
        id: 'route-main',
        coordinates: mainPolylineCoords,
        color: ROUTE_BLUE,
        width: 5,
        opacity: 0.95,
      });
    }

    return lines;
  }, [mainPolylineCoords]);

  const clearSelection = useCallback(() => {
    setSelectedArrivalLegIndex(null);
    setSelectedWaypointIndices(null);
    setFocusedClusterKey(null);
  }, []);

  const handleMarkerPress = useCallback(
    (markerId: string) => {
      const marker = markerById.get(markerId);
      if (!marker) return;

      if (marker.id === 'home-base') {
        setFocusedClusterKey(null);
        setSelectedArrivalLegIndex(0);
        setSelectedWaypointIndices([0]);
        setHighlightWaypointIndex(0);
        return;
      }

      if (marker.isCluster && marker.clusterKey) {
        const clusterIndices = clusterMembersByKey.get(marker.clusterKey) ?? [];
        if (clusterIndices.length === 0) return;
        const leadIndex = marker.index ?? clusterIndices[0];
        const alreadyFocused = focusedClusterKey === marker.clusterKey;
        setFocusedClusterKey(marker.clusterKey);
        setSelectedArrivalLegIndex(leadIndex ?? null);
        if (alreadyFocused && leadIndex != null) {
          setSelectedWaypointIndices([leadIndex]);
          setHighlightWaypointIndex(leadIndex);
        } else {
          setSelectedWaypointIndices(clusterIndices);
        }
        return;
      }

      if (typeof marker.index === 'number') {
        setFocusedClusterKey(null);
        setSelectedArrivalLegIndex(marker.index);
        setSelectedWaypointIndices([marker.index]);
        setHighlightWaypointIndex(marker.index);
      }
    },
    [clusterMembersByKey, focusedClusterKey, markerById, setHighlightWaypointIndex]
  );

  const fitCoordinates = useMemo(() => {
    if (appointments.length === 0) return [];
    if (allCoordsForFit.length > 0) return allCoordsForFit;
    return coordList;
  }, [allCoordsForFit, appointments.length, coordList]);

  useEffect(() => {
    if (fitCoordinates.length === 0) return;
    setFitRequestKey((prev) => prev + 1);
  }, [fitCoordinates, ctxSelectedDate]);

  const showEmptyOverlay = appointments.length === 0;
  const showNoAddressOverlay = appointments.length > 0 && coords.length === 0;
  const showLoadingBar = !embeddedInSchedule && routeLoading;
  const topInset = embeddedInSchedule ? 0 : insets.top;

  return (
    <View style={[styles.container, topInset > 0 && { paddingTop: topInset }]}>
      {!embeddedInSchedule && (
        <DaySlider
          selectedDate={ctxSelectedDate}
          onSelectDate={onSelectDate}
          meetingCountByDay={meetingCountByDay}
        />
      )}

      {showLoadingBar && (
        <>
          <View style={styles.loadingBar} />
          <View style={styles.routeLoadingOverlay}>
            <ActivityIndicator size="small" color={MS_BLUE} />
            <Text style={styles.routeLoadingText}>Calculating route...</Text>
          </View>
        </>
      )}

      {showEmptyOverlay && (
        <View style={styles.emptyOverlay}>
          <Text style={styles.emptyOverlayText}>
            {isSameDay(ctxSelectedDate, today)
              ? 'No meetings today'
              : `No meetings on ${format(ctxSelectedDate, 'EEE, MMM d')}`}
          </Text>
        </View>
      )}

      {showNoAddressOverlay && (
        <View style={styles.emptyOverlay}>
          <Text style={styles.emptyOverlayText}>Add addresses to see them on the map</Text>
        </View>
      )}

      {(__DEV__ || Platform.OS === 'android') && !embeddedInSchedule && (
        <View style={[styles.routeQcOverlay, { pointerEvents: 'none', top: topInset + 52 }]}>
          <Text style={styles.routeQcTitle}>Route QC</Text>
          <Text style={styles.routeQcLine}>engine: Leaflet/WebView</Text>
          <Text style={styles.routeQcLine}>appointments: {appointments.length}</Text>
          <Text style={styles.routeQcLine}>coords: {coords.length}</Text>
          <Text style={styles.routeQcLine}>markers: {mapMarkers.length}</Text>
          <Text style={styles.routeQcLine}>routeCoords: {routeCoordinates.length}</Text>
          <Text style={styles.routeQcLine}>polylines: {mapPolylines.length}</Text>
          <Text style={styles.routeQcLine}>allCoordsForFit: {allCoordsForFit.length}</Text>
          <Text style={styles.routeQcLine}>mapReady: {mapReady ? 'yes' : 'no'}</Text>
        </View>
      )}

      <NativeLeafletMap
        style={styles.map}
        markers={mapMarkers}
        polylines={mapPolylines}
        fitCoordinates={fitCoordinates}
        fitRequestKey={fitRequestKey}
        fitPadding={64}
        initialCenter={fitCoordinates[0] ?? DEFAULT_COORD}
        initialZoom={11}
        onReady={() => setMapReady(true)}
        onMapPress={clearSelection}
        onMarkerPress={handleMarkerPress}
      />

      {selectedWaypointIndices &&
        selectedWaypointIndices.length > 0 &&
        selectedWaypointIndices.every((i) => coords[i] != null) && (
          <View style={[styles.bottomCardContainer, { pointerEvents: 'box-none' }]}>
            <View style={[styles.selectedCalloutCard, styles.bottomCard]}>
              {selectedWaypointIndices.length === 1 ? (
                <ScrollView
                  style={styles.bottomCardScroll}
                  contentContainerStyle={styles.bottomCardScrollContent}
                  showsVerticalScrollIndicator
                  nestedScrollEnabled
                >
                  {(() => {
                    const idx = selectedWaypointIndices[0];
                    if (idx == null) return null;
                    const appt = coords[idx];
                    if (!appt) return null;
                    const eta = etas[idx];
                    const duration = meetingDurations[idx];
                    return (
                      <>
                        <Text style={styles.calloutTitle}>{appt.title ?? 'Meeting'}</Text>
                        {appt.location ? <Text style={styles.calloutAddress}>{appt.location}</Text> : null}
                        {eta != null && (
                          <Text style={styles.calloutDescription}>
                            ETA {formatTime(eta)}
                            {duration ? ` | ${duration}` : ''}
                          </Text>
                        )}
                        <View style={styles.calloutActions}>
                          <TouchableOpacity
                            style={styles.calloutAction}
                            onPress={() =>
                              openNativeDirections(
                                appt.coordinates.latitude,
                                appt.coordinates.longitude,
                                appt.title
                              )
                            }
                          >
                            <Text style={styles.calloutLink}>Open in Maps</Text>
                          </TouchableOpacity>
                          {appt.phone ? (
                            <TouchableOpacity
                              style={[styles.calloutAction, styles.calloutActionCall]}
                              onPress={() => Linking.openURL(`tel:${appt.phone}`)}
                            >
                              <Phone size={20} color={MS_BLUE} />
                              <Text style={[styles.calloutLink, styles.calloutLinkPhone]}>Call</Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                        <TouchableOpacity style={styles.calloutAction} onPress={clearSelection}>
                          <Text style={styles.calloutLink}>Close</Text>
                        </TouchableOpacity>
                      </>
                    );
                  })()}
                </ScrollView>
              ) : (
                <>
                  <Text style={styles.clusterSheetTitle}>
                    {selectedWaypointIndices.length} waypoints at this location
                  </Text>
                  <ScrollView style={styles.clusterSheetList} nestedScrollEnabled>
                    {selectedWaypointIndices.map((idx) => {
                      const appt = coords[idx];
                      if (!appt) return null;
                      const apptEta = etas[idx];
                      const duration = meetingDurations[idx];
                      return (
                        <View key={appt.id} style={styles.clusterSheetItem}>
                          <Text style={styles.calloutTitle}>
                            {idx + 1}. {appt.title ?? 'Meeting'}
                          </Text>
                          {appt.location ? <Text style={styles.calloutAddress}>{appt.location}</Text> : null}
                          <Text style={styles.calloutDescription}>
                            {appt.time}
                            {apptEta != null && ` | ETA ${formatTime(apptEta)}`}
                            {duration ? ` | ${duration}` : ''}
                          </Text>
                          <View style={styles.calloutActions}>
                            <TouchableOpacity
                              style={styles.calloutAction}
                              onPress={() =>
                                openNativeDirections(
                                  appt.coordinates.latitude,
                                  appt.coordinates.longitude,
                                  appt.title
                                )
                              }
                            >
                              <Text style={styles.calloutLink}>Open in Maps</Text>
                            </TouchableOpacity>
                            {appt.phone ? (
                              <TouchableOpacity
                                style={[styles.calloutAction, styles.calloutActionCall]}
                                onPress={() => Linking.openURL(`tel:${appt.phone}`)}
                              >
                                <Phone size={20} color={MS_BLUE} />
                                <Text style={[styles.calloutLink, styles.calloutLinkPhone]}>Call</Text>
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        </View>
                      );
                    })}
                  </ScrollView>
                  <TouchableOpacity style={styles.calloutAction} onPress={clearSelection}>
                    <Text style={styles.calloutLink}>Close</Text>
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
  },
  map: {
    flex: 1,
  },
  loadingBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: MS_BLUE,
    zIndex: 20,
    opacity: 0.9,
  },
  routeLoadingOverlay: {
    position: 'absolute',
    top: 8,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 8,
    zIndex: 19,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  routeLoadingText: {
    fontSize: 14,
    color: '#605E5C',
  },
  emptyOverlay: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    zIndex: 15,
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignSelf: 'center',
    maxWidth: 280,
  },
  emptyOverlayText: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
  },
  routeQcOverlay: {
    position: 'absolute',
    top: 56,
    left: 8,
    zIndex: 25,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    maxWidth: 220,
  },
  routeQcTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  routeQcLine: {
    fontSize: 10,
    color: '#e2e8f0',
    fontFamily: Platform.OS === 'android' ? 'monospace' : undefined,
  },
  selectedCalloutCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
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
    maxHeight: '45%',
  },
  bottomCardScroll: {
    maxHeight: 280,
  },
  bottomCardScrollContent: {
    paddingBottom: 8,
    gap: 4,
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
  calloutActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  calloutAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  calloutActionCall: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
  },
  calloutLink: {
    fontSize: 12,
    fontWeight: '600',
    color: MS_BLUE,
  },
  calloutLinkPhone: {
    marginLeft: 2,
  },
  clusterSheetTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
    marginBottom: 12,
  },
  clusterSheetList: {
    maxHeight: 320,
    marginBottom: 12,
  },
  clusterSheetItem: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
});
