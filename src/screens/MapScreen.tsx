import React, { useEffect, useRef, useMemo, useState, useCallback, useLayoutEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  TouchableOpacity,
  ScrollView,
  Linking,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useFocusEffect, useRoute as useNavRoute, useNavigation } from '@react-navigation/native';
import { Phone, Car } from 'lucide-react-native';
import { openNativeDirections } from '../utils/maps';
import MapView, { Marker, Polyline, Callout } from 'react-native-maps';
import { useRoute } from '../context/RouteContext';
import { useLoadAppointmentsForDate } from '../hooks/useLoadAppointmentsForDate';
import { useRouteData } from '../hooks/useRouteData';
import { formatTime } from '../utils/dateUtils';
import DaySlider from '../components/DaySlider';
import { useEnsureMeetingCountsForDate } from '../hooks/useEnsureMeetingCountsForDate';
import { format, isSameDay, startOfDay } from 'date-fns';
import { useIsWideScreen } from '../hooks/useIsWideScreen';
import { formatDistance, offsetPolyline } from '../utils/routeBubbles';
import { getMarkerPositions } from '../utils/mapClusters';
import type { CoordAppointment } from '../hooks/useRouteData';

/** Format meeting start–end for root marker (e.g. "9:00-10:00"). */
function formatMeetingTimeRange(coord: CoordAppointment): string {
  if (coord.time && typeof coord.time === 'string') {
    const parts = coord.time.split('-').map((p) => p.trim());
    if (parts.length >= 2) {
      const start = (parts[0] ?? '').trim();
      const end = (parts[1] ?? '').trim();
      if (start && end) return `${start}-${end}`;
    }
  }
  if (coord.startIso && coord.endIso) {
    try {
      const s = new Date(coord.startIso);
      const e = new Date(coord.endIso);
      const pad = (n: number) => n.toString().padStart(2, '0');
      return `${pad(s.getHours())}:${pad(s.getMinutes())}-${pad(e.getHours())}:${pad(e.getMinutes())}`;
    } catch {
      // fallthrough
    }
  }
  return '';
}

const DEFAULT_REGION = {
  latitude: 55.6761,
  longitude: 12.5683,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

const EDGE_PADDING = { top: 60, right: 60, bottom: 60, left: 60 };
const MS_BLUE = '#0078D4';
const HOME_GREEN = '#107C10';
const FOCUSED_ZOOM_DELTA = 0.004;
const FOCUSED_MARKER_SPREAD_PX = 64;

type MapScreenNavParams = { triggerLoadWhenEmpty?: boolean };

type MapScreenProps = { embeddedInSchedule?: boolean };

export default function MapScreen({ embeddedInSchedule }: MapScreenProps = {}) {
  const mapRef = useRef<MapView>(null);
  const ignoreNextMapPressRef = useRef(false);
  const [region, setRegion] = useState(DEFAULT_REGION);
  const [focusedClusterKey, setFocusedClusterKey] = useState<string | null>(null);
  const [focusedClusterCoord, setFocusedClusterCoord] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  /** Leg index to highlight (the leg that arrives at the selected waypoint). Null = none. */
  const [selectedArrivalLegIndex, setSelectedArrivalLegIndex] = useState<number | null>(null);
  /** Waypoint indices at the selected marker (for bottom info card). */
  const [selectedWaypointIndices, setSelectedWaypointIndices] = useState<number[] | null>(null);
  const navigation = useNavigation();
  const isWide = useIsWideScreen();
  const { selectedDate: ctxSelectedDate, setSelectedDate, meetingCountByDay, highlightWaypointIndex, setHighlightWaypointIndex, triggerRefresh } = useRoute();
  const ensureMeetingCountsForDate = useEnsureMeetingCountsForDate();
  const navParams = useNavRoute<MapScreenNavParams>().params;
  const triggerLoadWhenEmpty = navParams?.triggerLoadWhenEmpty ?? false;
  const { load } = useLoadAppointmentsForDate(undefined);

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
    meetingDurations,
    legStress,
    homeBase,
    homeBaseLabel,
    refetchRouteIfNeeded,
  } = routeData;

  const legStrokeColor = (legIndex: number): string => {
    const s = legStress[legIndex];
    if (s === 'late') return '#D13438';
    if (s === 'tight') return '#C19C00';
    return legIndex % 2 === 1 ? '#00B0FF' : '#4FC3F7';
  };

  const today = useMemo(() => startOfDay(new Date()), []);

  useFocusEffect(
    useCallback(() => {
      if (triggerLoadWhenEmpty && appointments.length === 0 && isSameDay(ctxSelectedDate, today)) load();
      if (!embeddedInSchedule && appointments.length === 0) triggerRefresh();
      if (!embeddedInSchedule) ensureMeetingCountsForDate(ctxSelectedDate);
      refetchRouteIfNeeded();
    }, [triggerLoadWhenEmpty, load, appointments.length, refetchRouteIfNeeded, embeddedInSchedule, ensureMeetingCountsForDate, ctxSelectedDate, today, triggerRefresh])
  );

  const headerTitle = isSameDay(ctxSelectedDate, today) ? "Today's Route" : format(ctxSelectedDate, 'EEE, MMM d');

  const onSelectDate = useCallback(
    (date: Date) => {
      // Clear selection immediately so we never render with old indices and new date's coords
      setSelectedArrivalLegIndex(null);
      setSelectedWaypointIndices(null);
      setFocusedClusterKey(null);
      setFocusedClusterCoord(null);
      setSelectedDate(date);
      ensureMeetingCountsForDate(date);
    },
    [setSelectedDate, ensureMeetingCountsForDate]
  );

  // Clear selection whenever the displayed date changes (e.g. from DaySlider or from another tab)
  useEffect(() => {
    setSelectedArrivalLegIndex(null);
    setSelectedWaypointIndices(null);
    setFocusedClusterKey(null);
    setFocusedClusterCoord(null);
  }, [ctxSelectedDate]);

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
    navigation.setOptions({
      headerShown: false,
      headerTitle,
      headerTitleStyle: { fontWeight: '600', fontSize: isWide ? 16 : undefined },
      headerStyle: { backgroundColor: MS_BLUE },
      headerTintColor: '#fff',
    });
  }, [embeddedInSchedule, navigation, headerTitle, isWide]);

  const routeCoordinates = osrmRoute?.coordinates?.length
    ? osrmRoute.coordinates
    : fullPolyline.length >= 2
      ? fullPolyline
      : [];

  const fitWhenStable = true;

  useEffect(() => {
    // Don't zoom on empty days – leave map as is and show "No meetings" overlay
    if (appointments.length === 0) return;
    if (allCoordsForFit.length === 0) return;
    if (!fitWhenStable) return;
    try {
      if (allCoordsForFit.length === 1) {
        mapRef.current?.animateToRegion(
          { ...allCoordsForFit[0], latitudeDelta: 0.02, longitudeDelta: 0.02 },
          350
        );
      } else {
        mapRef.current?.fitToCoordinates(allCoordsForFit, {
          edgePadding: EDGE_PADDING,
          animated: true,
        });
      }
    } catch {
      // ignore
    }
  }, [appointments.length, allCoordsForFit, fitWhenStable]);

  if (Platform.OS === 'web') {
    return (
      <View style={styles.container}>
        <View style={styles.placeholderContainer}>
          <Text style={styles.placeholderText}>Maps are only available on Mobile</Text>
        </View>
      </View>
    );
  }

  const showEmptyOverlay = appointments.length === 0;
  const showNoAddressOverlay = appointments.length > 0 && coords.length === 0;

  const showHomeBase = fullPolyline.length > 0;
  const coordList = useMemo(() => coords.map((a) => a.coordinates), [coords]);
  const { width: screenWidth } = useWindowDimensions();
  const markerPositions = useMemo(
    () =>
      getMarkerPositions(
        coordList,
        0,
        { focusedClusterKey, focusedPixelGap: FOCUSED_MARKER_SPREAD_PX },
        { longitudeDelta: region.longitudeDelta, screenWidth }
      ),
    [coordList, region.longitudeDelta, screenWidth, focusedClusterKey]
  );

  const showLoadingBar = !embeddedInSchedule && routeLoading;

  return (
    <View style={styles.container}>
      {!embeddedInSchedule && (
        <DaySlider
          selectedDate={ctxSelectedDate}
          onSelectDate={onSelectDate}
          meetingCountByDay={meetingCountByDay}
        />
      )}
      {showLoadingBar && <View style={styles.loadingBar} />}
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
        <View style={[styles.routeQcOverlay, { pointerEvents: 'none' }]}>
          <Text style={styles.routeQcTitle}>Route QC</Text>
          <Text style={styles.routeQcLine}>appointments: {appointments.length}</Text>
          <Text style={styles.routeQcLine}>coords: {coords.length}</Text>
          <Text style={styles.routeQcLine}>waypoints: {routeData.waypoints.length}</Text>
          <Text style={styles.routeQcLine}>fullPolyline: {fullPolyline.length}</Text>
          <Text style={styles.routeQcLine}>osrmRoute: {osrmRoute ? 'yes' : 'no'}</Text>
          <Text style={styles.routeQcLine}>routeCoords: {routeCoordinates.length}</Text>
          <Text style={styles.routeQcLine}>allCoordsForFit: {allCoordsForFit.length}</Text>
        </View>
      )}
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={DEFAULT_REGION}
        showsUserLocation
        mapType={Platform.OS === 'ios' ? 'mutedStandard' : 'standard'}
        onRegionChangeComplete={setRegion}
        onPress={() => {
          if (ignoreNextMapPressRef.current) {
            ignoreNextMapPressRef.current = false;
            return;
          }
          setSelectedArrivalLegIndex(null);
          setSelectedWaypointIndices(null);
          setFocusedClusterKey(null);
          setFocusedClusterCoord(null);
        }}
      >
        {osrmRoute?.legs && (() => {
          const LEG_OFFSET_DEG = 0.00025;
          const HIGHLIGHT_WIDTH = 7;
          const LATE_LEG_WIDTH = 9;
          const legs = osrmRoute.legs;
          const out: React.ReactNode[] = [];
          for (let i = 1; i < legs.length; i++) {
            const leg = legs[i]!;
            if (leg.coordinates.length < 2) continue;
            if (i === selectedArrivalLegIndex) continue;
            if (legStress[i] === 'late') continue;
            const sign = i % 2 === 1 ? (1 as const) : (-1 as const);
            const coords = offsetPolyline(leg.coordinates, LEG_OFFSET_DEG, sign);
            out.push(
              <Polyline
                key={`poly-${i}`}
                coordinates={coords}
                strokeColor={legStrokeColor(i)}
                strokeWidth={5}
              />
            );
          }
          for (let i = 1; i < legs.length; i++) {
            const leg = legs[i]!;
            if (leg.coordinates.length < 2) continue;
            if (i === selectedArrivalLegIndex) continue;
            if (legStress[i] !== 'late') continue;
            const sign = i % 2 === 1 ? (1 as const) : (-1 as const);
            const coords = offsetPolyline(leg.coordinates, LEG_OFFSET_DEG, sign);
            out.push(
              <Polyline
                key={`poly-late-${i}`}
                coordinates={coords}
                strokeColor={legStrokeColor(i)}
                strokeWidth={LATE_LEG_WIDTH}
                zIndex={50}
              />
            );
          }
          if (selectedArrivalLegIndex !== null && selectedArrivalLegIndex < legs.length - 1 && legs[selectedArrivalLegIndex]?.coordinates.length >= 2) {
            const leg = legs[selectedArrivalLegIndex]!;
            const coords =
              selectedArrivalLegIndex === 0
                ? leg.coordinates
                : offsetPolyline(
                    leg.coordinates,
                    LEG_OFFSET_DEG,
                    selectedArrivalLegIndex % 2 === 1 ? (1 as const) : (-1 as const)
                  );
            out.push(
              <Polyline
                key={`poly-highlight-${selectedArrivalLegIndex}`}
                coordinates={coords}
                strokeColor={HOME_GREEN}
                strokeWidth={HIGHLIGHT_WIDTH}
                zIndex={100}
              />
            );
          }
          return out;
        })()}
        {osrmRoute && routeCoordinates.length >= 2 && osrmRoute.legs.every((l) => l.coordinates.length < 2) && (
          <Polyline coordinates={routeCoordinates} strokeColor="#00B0FF" strokeWidth={5} />
        )}
        {!osrmRoute && routeCoordinates.length >= 2 && (
          <Polyline coordinates={routeCoordinates} strokeColor="#00B0FF" strokeWidth={5} />
        )}
        {showHomeBase && (() => {
          const targetIndex = selectedArrivalLegIndex != null ? selectedArrivalLegIndex : 0;
          const rootEta = coords.length > 0 && targetIndex < etas.length ? etas[targetIndex] : undefined;
          const rootMeetingTime = coords.length > 0 && coords[targetIndex] ? formatMeetingTimeRange(coords[targetIndex]) : '';
          const onRootPress = () => {
            ignoreNextMapPressRef.current = true;
            setFocusedClusterKey(null);
            setFocusedClusterCoord(null);
            setSelectedArrivalLegIndex(0);
            setSelectedWaypointIndices([0]);
            setHighlightWaypointIndex(0);
          };
          // On Android, custom Marker children often don't render with tracksViewChanges={false}
          const homeTracksView = Platform.OS === 'android' ? true : !isWide;
          return (
            <Marker
              coordinate={{ latitude: homeBase.lat, longitude: homeBase.lon }}
              pinColor={isWide ? HOME_GREEN : undefined}
              anchor={isWide ? undefined : { x: 0.5, y: 0.5 }}
              tracksViewChanges={homeTracksView}
              onPress={onRootPress}
            >
              {isWide ? (
                <Callout tooltip={false}>
                  <View style={styles.calloutBubble}>
                    <Text style={[styles.calloutBadge, { color: HOME_GREEN }]}>Home Base</Text>
                    <Text style={styles.calloutTitle}>{homeBaseLabel ?? 'Home Base'}</Text>
                    {typeof departByMs === 'number' && !Number.isNaN(departByMs) && (
                      <Text style={styles.calloutDescription}>Depart by {formatTime(departByMs)}</Text>
                    )}
                    {typeof returnByMs === 'number' && !Number.isNaN(returnByMs) && (
                      <Text style={styles.calloutDescription}>Return ~{formatTime(returnByMs)}</Text>
                    )}
                  </View>
                </Callout>
              ) : (
                <View style={styles.markerWithEta}>
                  {(rootEta != null || rootMeetingTime) && (
                    <View style={[styles.markerEtaBadge, styles.markerRootLabel]}>
                      {rootEta != null && (
                        <Text style={styles.markerEtaText}>{formatTime(rootEta)}</Text>
                      )}
                      {rootMeetingTime ? (
                        <Text style={styles.markerMeetingTimeText}>{rootMeetingTime}</Text>
                      ) : null}
                    </View>
                  )}
                  <View style={[styles.markerPin, { backgroundColor: HOME_GREEN }]}>
                    <Text style={styles.markerPinNumber}>H</Text>
                  </View>
                </View>
              )}
            </Marker>
          );
        })()}
        {markerPositions.map(
          ({ index, coordinate, realCoordinate }) =>
            realCoordinate != null && (
              <Polyline
                key={`connector-${index}`}
                coordinates={[coordinate, realCoordinate]}
                strokeColor="#64748b"
                strokeWidth={2}
                lineDashPattern={[4, 4]}
              />
            )
        )}
        {markerPositions.map(({ index, coordinate, clusterKey, isCluster }) => {
          const appointment = coords[index];
          if (!appointment) return null;
          const anyCompleted = appointment.status === 'completed';
          const isLate = legStress[index] === 'late';
          const bgColor = anyCompleted ? '#808080' : isLate ? '#D13438' : MS_BLUE;
          const eta = etas[index];
          const isFocused = isCluster && clusterKey != null && clusterKey === focusedClusterKey;
          // On Android, custom Marker views often don't render with tracksViewChanges={false}
          const waypointTracksView = Platform.OS === 'android';
          return (
            <Marker
              key={`waypoint-${index}`}
              coordinate={coordinate}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={waypointTracksView}
              onPress={() => {
                ignoreNextMapPressRef.current = true;
                setFocusedClusterKey(null);
                setFocusedClusterCoord(null);
                setSelectedArrivalLegIndex(index);
                setSelectedWaypointIndices([index]);
                setHighlightWaypointIndex(index);
              }}
            >
              <View style={styles.markerWithEta}>
                {eta != null && (
                  <View style={styles.markerEtaBadge}>
                    <Text style={styles.markerEtaText}>{formatTime(eta)}</Text>
                  </View>
                )}
                <View
                  style={[
                    styles.markerPin,
                    styles.markerPinCluster,
                    isFocused && styles.markerPinFocused,
                    { backgroundColor: bgColor },
                  ]}
                >
                  <Text style={[styles.markerPinNumber, isFocused && styles.markerPinNumberFocused]}>
                    {index + 1}
                  </Text>
                </View>
              </View>
            </Marker>
          );
        })}
        {selectedArrivalLegIndex != null &&
          osrmRoute?.legs[selectedArrivalLegIndex] && (
            <Marker
              key={`leg-${selectedArrivalLegIndex}`}
              coordinate={osrmRoute.legs[selectedArrivalLegIndex]!.labelPoint}
              anchor={{ x: 0.5, y: 1 }}
              tracksViewChanges={Platform.OS === 'android'}
            >
              <View style={styles.segmentBubble}>
                <View style={styles.segmentBubbleContent}>
                  <Car size={14} color="#3c3c3c" style={styles.segmentBubbleIcon} />
                  <View>
                    <Text style={styles.segmentLabelTime}>
                      {Math.round(osrmRoute.legs[selectedArrivalLegIndex]!.duration / 60)} min
                    </Text>
                    <Text style={styles.segmentLabelDist}>
                      {formatDistance(osrmRoute.legs[selectedArrivalLegIndex]!.distance)}
                    </Text>
                  </View>
                </View>
                <View style={styles.segmentBubblePointer}>
                  <Svg width={24} height={12} viewBox="0 0 24 12">
                    <Path d="M 0 0 L 18 0 L 12 12 Z" fill="#fff" />
                  </Svg>
                </View>
              </View>
            </Marker>
          )}
      </MapView>
      {selectedWaypointIndices &&
        selectedWaypointIndices.length > 0 &&
        selectedWaypointIndices.every((i) => coords[i] != null) && (
        <View style={[styles.bottomCardContainer, { pointerEvents: 'box-none' }]}>
          <View style={[styles.selectedCalloutCard, styles.bottomCard]}>
            {selectedWaypointIndices.length === 1 ? (
              <ScrollView
                style={styles.bottomCardScroll}
                contentContainerStyle={styles.bottomCardScrollContent}
                showsVerticalScrollIndicator={true}
                nestedScrollEnabled
              >
                {(() => {
                  const idx = selectedWaypointIndices[0]!;
                  const appt = coords[idx];
                  if (!appt) return null;
                  const eta = etas[idx];
                  const duration = meetingDurations[idx];
                  return (
                    <>
                      <Text style={styles.calloutTitle}>{appt.title ?? 'Meeting'}</Text>
                      {appt.location ? (
                        <Text style={styles.calloutAddress}>{appt.location}</Text>
                      ) : null}
                      {eta != null && (
                        <Text style={styles.calloutDescription}>
                          ETA {formatTime(eta)}
                          {duration ? ` · ${duration}` : ''}
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
                      <TouchableOpacity
                        style={styles.calloutAction}
                        onPress={() => {
                          setSelectedArrivalLegIndex(null);
                          setSelectedWaypointIndices(null);
                        }}
                      >
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
                        {appt.location ? (
                          <Text style={styles.calloutAddress}>{appt.location}</Text>
                        ) : null}
                        <Text style={styles.calloutDescription}>
                          {appt.time}
                          {apptEta != null && ` · ETA ${formatTime(apptEta)}`}
                          {duration ? ` · ${duration}` : ''}
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
                <TouchableOpacity
                  style={styles.calloutAction}
                  onPress={() => {
                    setSelectedArrivalLegIndex(null);
                    setSelectedWaypointIndices(null);
                  }}
                >
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
  loadingText: {
    marginTop: 12,
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
    maxWidth: 200,
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
  segmentBubble: {
    alignItems: 'center',
  },
  segmentBubblePointer: {
    alignSelf: 'flex-end',
    marginTop: -1,
    marginRight: 8,
  },
  segmentBubbleContent: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    minWidth: 72,
    gap: 6,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
  },
  segmentBubbleIcon: {
    marginRight: 2,
  },
  segmentLabelTime: {
    fontSize: 14,
    fontWeight: '700',
    color: '#3c3c3c',
  },
  segmentLabelDist: {
    fontSize: 11,
    color: '#666',
  },
  markerWithEta: {
    alignItems: 'center',
  },
  markerEtaBadge: {
    backgroundColor: '#fff',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginBottom: 4,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  markerEtaText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#3c3c3c',
  },
  markerRootLabel: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 0,
  },
  markerMeetingTimeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#3c3c3c',
  },
  markerEtaBadgeCluster: {
    backgroundColor: '#fff',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 4,
    marginBottom: 4,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    gap: 2,
  },
  calloutBubble: {
    backgroundColor: 'white',
    padding: 10,
    borderRadius: 8,
    minWidth: 150,
    maxWidth: 220,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  selectedCalloutOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'flex-end',
    padding: 16,
    zIndex: 20,
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
  markerPin: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  markerPinCluster: {},
  markerPinStack: {
    minWidth: 36,
    paddingHorizontal: 4,
  },
  markerPinNumber: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  markerPinFocused: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  markerPinNumberFocused: {
    fontSize: 17,
  },
  calloutBadge: {
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 4,
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
  clusterSheetCard: {
    maxHeight: '70%',
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
  clusterCalloutItem: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
});
