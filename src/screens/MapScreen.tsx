import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  TouchableOpacity,
  ScrollView,
  Linking,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useFocusEffect, useRoute as useNavRoute } from '@react-navigation/native';
import { Phone, Car } from 'lucide-react-native';
import { openNativeDirections } from '../utils/maps';
import MapView, { Marker, Polyline, Callout } from 'react-native-maps';
import { useLoadAppointmentsForDate } from '../hooks/useLoadAppointmentsForDate';
import { useRouteData } from '../hooks/useRouteData';
import { formatTime } from '../utils/dateUtils';
import { formatDistance, offsetPolyline } from '../utils/routeBubbles';
import { getMarkerPositions } from '../utils/mapClusters';

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
  const [showDetails, setShowDetails] = useState(false);
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

  useFocusEffect(
    useCallback(() => {
      if (triggerLoadWhenEmpty && appointments.length === 0) load();
      refetchRouteIfNeeded();
    }, [triggerLoadWhenEmpty, load, appointments.length, refetchRouteIfNeeded])
  );

  const routeCoordinates = osrmRoute?.coordinates?.length
    ? osrmRoute.coordinates
    : fullPolyline.length >= 2
      ? fullPolyline
      : [];

  const fitWhenStable = true;

  useEffect(() => {
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
  }, [allCoordsForFit, fitWhenStable]);

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
  const screenWidth = Dimensions.get('window').width;
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
      {showLoadingBar && <View style={styles.loadingBar} />}
      {showEmptyOverlay && (
        <View style={styles.emptyOverlay}>
          <Text style={styles.emptyOverlayText}>No meetings today</Text>
        </View>
      )}
      {showNoAddressOverlay && (
        <View style={styles.emptyOverlay}>
          <Text style={styles.emptyOverlayText}>Add addresses to see them on the map</Text>
        </View>
      )}
      <TouchableOpacity
        style={styles.detailsButton}
        onPress={() => setShowDetails((s) => !s)}
        activeOpacity={0.8}
      >
        <Text style={styles.detailsButtonText}>
          {showDetails ? 'Hide details' : 'Show details'}
        </Text>
      </TouchableOpacity>
      {showDetails && (
        <ScrollView
          style={styles.detailsOverlay}
          contentContainerStyle={styles.detailsOverlayContent}
        >
          {showHomeBase && (
            <View style={[styles.detailsCard, styles.detailsCardHome]}>
              <View style={[styles.detailsBadge, { backgroundColor: HOME_GREEN }]}>
                <Text style={styles.detailsBadgeText}>H</Text>
              </View>
              <View style={styles.detailsCardContent}>
                <Text style={styles.detailsCardTitle}>{homeBaseLabel}</Text>
                <Text style={styles.detailsCardTime}>
                  Depart by {formatTime(departByMs)} · Return ~{formatTime(returnByMs)}
                </Text>
              </View>
            </View>
          )}
          {coords.map((appointment, index) => (
            <View key={appointment.id} style={styles.detailsCard}>
              <View
                style={[
                  styles.detailsBadge,
                  { backgroundColor: appointment.status === 'completed' ? '#808080' : MS_BLUE },
                ]}
              >
                <Text style={styles.detailsBadgeText}>{index + 1}</Text>
              </View>
              <View style={styles.detailsCardContent}>
                <Text style={styles.detailsCardTitle}>{appointment.title}</Text>
                <Text style={styles.detailsCardTime}>
                  {appointment.time}
                  {etas[index] != null && ` · ETA ${formatTime(etas[index])}`}
                </Text>
                <Text style={styles.detailsCardAddress}>{appointment.location}</Text>
                <TouchableOpacity
                  onPress={() =>
                    openNativeDirections(
                      appointment.coordinates.latitude,
                      appointment.coordinates.longitude,
                      appointment.title
                    )
                  }
                >
                  <Text style={styles.detailsCardLink}>Open in Maps</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>
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
        {showHomeBase && (
          <Marker
            coordinate={{ latitude: homeBase.lat, longitude: homeBase.lon }}
            pinColor={HOME_GREEN}
          >
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
          </Marker>
        )}
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
          const appointment = coords[index]!;
          const anyCompleted = appointment.status === 'completed';
          const isLate = legStress[index] === 'late';
          const bgColor = anyCompleted ? '#808080' : isLate ? '#D13438' : MS_BLUE;
          const eta = etas[index];
          const isFocused = isCluster && clusterKey != null && clusterKey === focusedClusterKey;
          return (
            <Marker
              key={`waypoint-${index}`}
              coordinate={coordinate}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
              onPress={() => {
                ignoreNextMapPressRef.current = true;
                setFocusedClusterKey(null);
                setFocusedClusterCoord(null);
                setSelectedArrivalLegIndex(index);
                setSelectedWaypointIndices([index]);
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
              tracksViewChanges={false}
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
      {selectedWaypointIndices && selectedWaypointIndices.length > 0 && (
        <View style={styles.bottomCardContainer} pointerEvents="box-none">
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
                  const appt = coords[idx]!;
                  const eta = etas[idx];
                  const duration = meetingDurations[idx];
                  return (
                    <>
                      <Text style={styles.calloutTitle}>{appt.title}</Text>
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
                    const appt = coords[idx]!;
                    const apptEta = etas[idx];
                    const duration = meetingDurations[idx];
                    return (
                      <View key={appt.id} style={styles.clusterSheetItem}>
                        <Text style={styles.calloutTitle}>
                          {idx + 1}. {appt.title}
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
  detailsButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 10,
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
    zIndex: 10,
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
