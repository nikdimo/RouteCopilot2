import React, { useState, useLayoutEffect, useCallback, useMemo, useRef, useEffect, Suspense } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ListRenderItem,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from 'react-native';
import type { RenderItemParams } from 'react-native-draggable-flatlist';
import { GripVertical, ChevronUp, ChevronDown } from 'lucide-react-native';

let cachedDraggableFlatList: React.ComponentType<any> | null | undefined = undefined;
function getDraggableFlatList(): React.ComponentType<any> | null {
  if (cachedDraggableFlatList !== undefined) return cachedDraggableFlatList;
  try {
    const mod = require('react-native-draggable-flatlist');
    cachedDraggableFlatList = mod?.default ?? mod ?? null;
  } catch {
    cachedDraggableFlatList = null;
  }
  return cachedDraggableFlatList;
}
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ScheduleStackParamList } from '../navigation/ScheduleStack';
import { startOfDay, endOfDay, isSameDay, format, addDays } from 'date-fns';
import { toLocalDayKey } from '../utils/dateUtils';
import DaySlider from '../components/DaySlider';
import SwipeableMeetingRow from '../components/SwipeableMeetingRow';
import LegBetweenRow from '../components/LegBetweenRow';
import DaySummaryBar from '../components/DaySummaryBar';
import ViewModeToggle, { type ViewMode } from '../components/ViewModeToggle';
import DayTimelineStrip from '../components/DayTimelineStrip';
import { useAuth } from '../context/AuthContext';
import { useRoute } from '../context/RouteContext';
import { useRouteData } from '../hooks/useRouteData';
import { openNativeDirections } from '../utils/maps';
import type { CalendarEvent } from '../services/graph';
import { useEnsureMeetingCountsForDate } from '../hooks/useEnsureMeetingCountsForDate';
import { useIsWideScreen } from '../hooks/useIsWideScreen';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';

const MapScreen = React.lazy(() => import('./MapScreen'));
const isExpoGo = Constants.appOwnership === 'expo';

const GREEN = '#107C10';

export type MeetingItem = {
  id: string;
  timeRange: string;
  client: string;
  address: string;
  statusColor: string;
  status: 'pending' | 'completed' | 'skipped';
};

function eventToMeetingItem(ev: CalendarEvent): MeetingItem {
  return {
    id: ev.id,
    timeRange: ev.time,
    client: ev.title,
    address: ev.location,
    statusColor: GREEN,
    status: ev.status ?? 'pending',
  };
}

const TODAY = startOfDay(new Date());

export type ScheduleListMeetingItem = {
  type: 'meeting';
  key: string;
  appointmentIndex: number;
};
export type ScheduleListLegItem = {
  type: 'leg';
  key: string;
  durationSec: number;
  distanceM: number;
  etaAtNextMs: number;
  waitMin: number;
  stress: 'ok' | 'tight' | 'late';
  label?: string;
};
export type ScheduleListItem = ScheduleListMeetingItem | ScheduleListLegItem;

/** One draggable block = one meeting + its following leg (for reorder mode). */
export type ScheduleBlockItem = { id: string; appointmentIndex: number };

function getLegAfterMeeting(
  items: ScheduleListItem[],
  appointmentIndex: number
): ScheduleListLegItem | null {
  const idx = items.findIndex(
    (x) => x.type === 'meeting' && x.appointmentIndex === appointmentIndex
  );
  if (idx < 0) return null;
  const next = items[idx + 1];
  return next?.type === 'leg' ? next : null;
}

function getLegFromHome(items: ScheduleListItem[]): ScheduleListLegItem | null {
  const first = items[0];
  return first?.type === 'leg' ? first : null;
}

function getCoordIndex(appointments: CalendarEvent[], coords: { id: string }[], index: number): number {
  if (!appointments[index]?.coordinates) return -1;
  const id = appointments[index]!.id;
  return coords.findIndex((c) => c.id === id);
}

function buildScheduleListItems(
  appointments: CalendarEvent[],
  coords: { id: string }[],
  legStats: { durationSec: number; distanceM: number }[],
  etas: number[],
  waitTimeBeforeMeetingMin: number[],
  returnByMs: number
): ScheduleListItem[] {
  const items: ScheduleListItem[] = [];
  if (appointments.length === 0) return items;
  for (let i = 0; i < appointments.length; i++) {
    const ci = getCoordIndex(appointments, coords, i);
    if (i === 0 && ci === 0 && legStats[0]) {
      const waitMin = waitTimeBeforeMeetingMin[0] ?? 0;
      items.push({
        type: 'leg',
        key: 'leg-from-home',
        durationSec: legStats[0].durationSec,
        distanceM: legStats[0].distanceM,
        etaAtNextMs: etas[0] ?? 0,
        waitMin,
        stress: waitMin < 0 ? 'late' : waitMin < 5 ? 'tight' : 'ok',
        label: 'From home',
      });
    }
    items.push({ type: 'meeting', key: `m-${i}`, appointmentIndex: i });
    if (i < appointments.length - 1) {
      const ciNext = getCoordIndex(appointments, coords, i + 1);
      if (ci >= 0 && ciNext === ci + 1 && legStats[ci + 1] && etas[ci + 1] != null) {
        const waitMin = waitTimeBeforeMeetingMin[ci + 1] ?? 0;
        items.push({
          type: 'leg',
          key: `leg-${i}-${i + 1}`,
          durationSec: legStats[ci + 1].durationSec,
          distanceM: legStats[ci + 1].distanceM,
          etaAtNextMs: etas[ci + 1]!,
          waitMin,
          stress: waitMin < 0 ? 'late' : waitMin < 5 ? 'tight' : 'ok',
        });
      }
    } else if (ci >= 0 && legStats[ci + 1]) {
      items.push({
        type: 'leg',
        key: 'leg-to-home',
        durationSec: legStats[ci + 1].durationSec,
        distanceM: legStats[ci + 1].distanceM,
        etaAtNextMs: returnByMs,
        waitMin: 0,
        stress: 'ok',
        label: 'To home',
      });
    }
  }
  return items;
}

const TODAY_FOR_EMPTY = startOfDay(new Date());

function EmptySchedule() {
  const { selectedDate } = useRoute();
  const label = isSameDay(selectedDate, TODAY_FOR_EMPTY)
    ? "No visits today."
    : `No visits on ${format(selectedDate, 'EEE, MMM d')}.`;
  return (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyText}>{label}</Text>
    </View>
  );
}

type ScheduleNav = NativeStackNavigationProp<ScheduleStackParamList, 'ScheduleHome'>;

export default function ScheduleScreen() {
  const navigation = useNavigation<ScheduleNav>();
  const { userToken, signOut, getValidToken } = useAuth();
  const {
    appointments,
    setAppointments,
    setAppointmentsLoading,
    markEventAsDone,
    unmarkEventAsDone,
    removeAppointment,
    saveDayOrder,
    getDayOrder,
    optimize,
    selectedDate,
    setSelectedDate,
    meetingCountByDay,
    setMeetingCountByDay,
    loadedRange,
    setLoadedRange,
    setHighlightWaypointIndex,
    triggerRefresh,
    appointmentsLoading,
  } = useRoute();
  const ensureMeetingCountsForDate = useEnsureMeetingCountsForDate();
  const { coords, legStats, etas, waitTimeBeforeMeetingMin, departByMs, returnByMs, homeBase } = useRouteData();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [reorderMode, setReorderMode] = useState(false);

  const isWide = useIsWideScreen();
  const insets = useSafeAreaInsets();

  const appointmentsList = appointments ?? [];
  const meetings = appointmentsList.map(eventToMeetingItem);

  const scheduleListItems = useMemo((): ScheduleListItem[] => {
    if (legStats.length === 0 || coords.length === 0) {
      return appointmentsList.map((_, i) => ({ type: 'meeting', key: `m-${i}`, appointmentIndex: i }));
    }
    return buildScheduleListItems(
      appointmentsList,
      coords,
      legStats,
      etas,
      waitTimeBeforeMeetingMin,
      returnByMs
    );
  }, [appointmentsList, coords, legStats, etas, waitTimeBeforeMeetingMin, returnByMs]);

  const blockData = useMemo(
    (): ScheduleBlockItem[] =>
      appointmentsList.map((ev, i) => ({ id: ev.id, appointmentIndex: i })),
    [appointmentsList]
  );

  const daySummary = useMemo(() => {
    if (legStats.length === 0) return null;
    const totalDriveSec = legStats.reduce((s, l) => s + l.durationSec, 0);
    const totalDistanceM = legStats.reduce((s, l) => s + l.distanceM, 0);
    const lateCount = waitTimeBeforeMeetingMin.filter((w) => w < 0).length;
    const tightCount = waitTimeBeforeMeetingMin.filter((w) => w >= 0 && w < 5).length;
    const longWaitCount = waitTimeBeforeMeetingMin.filter((w) => w >= 30).length;
    return {
      totalDriveSec,
      totalDistanceM,
      departByMs,
      returnByMs,
      tightCount,
      lateCount,
      longWaitCount,
    };
  }, [legStats, waitTimeBeforeMeetingMin, departByMs, returnByMs]);

  useFocusEffect(
    useCallback(() => {
      ensureMeetingCountsForDate(selectedDate);
    }, [ensureMeetingCountsForDate, selectedDate])
  );

  const onSelectDate = useCallback(
    (date: Date) => {
      setSelectedDate(date);
      ensureMeetingCountsForDate(date);
    },
    [setSelectedDate, ensureMeetingCountsForDate]
  );

  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = null;
    }
    setRefreshing(true);
    setLoadedRange(null);
    triggerRefresh();
    ensureMeetingCountsForDate(selectedDate);
    refreshTimeoutRef.current = setTimeout(() => setRefreshing(false), 12000);
  }, [triggerRefresh, ensureMeetingCountsForDate, selectedDate, setLoadedRange]);

  const prevLoadingRef = useRef(false);
  useEffect(() => {
    if (prevLoadingRef.current && !appointmentsLoading && refreshing) {
      setRefreshing(false);
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    }
    prevLoadingRef.current = appointmentsLoading;
  }, [appointmentsLoading, refreshing]);

  const headerTitle = isSameDay(selectedDate, TODAY)
    ? "Today's Route"
    : format(selectedDate, 'EEE, MMM d');

  const handleDragEnd = useCallback(
    ({ data }: { data: ScheduleBlockItem[] }) => {
      const newAppointments = data.map(
        (b) => appointmentsList[b.appointmentIndex]!
      );
      setAppointments(newAppointments);
    },
    [appointmentsList, setAppointments]
  );

  const handleMoveMeeting = useCallback(
    (fromIndex: number, direction: 'up' | 'down') => {
      const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
      if (toIndex < 0 || toIndex >= appointmentsList.length) return;
      const next = [...appointmentsList];
      const a = next[fromIndex]!;
      const b = next[toIndex]!;
      next[fromIndex] = b;
      next[toIndex] = a;
      setAppointments(next);
    },
    [appointmentsList, setAppointments]
  );

  const handleSaveOrder = useCallback(() => {
    const dayKey = toLocalDayKey(selectedDate);
    saveDayOrder(dayKey, appointmentsList.map((a) => a.id));
    setReorderMode(false);
  }, [selectedDate, appointmentsList, saveDayOrder]);

  const handleReoptimize = useCallback(() => {
    optimize({ latitude: homeBase.lat, longitude: homeBase.lon });
    setReorderMode(false);
  }, [optimize, homeBase.lat, homeBase.lon]);

  const renderItem: ListRenderItem<ScheduleListItem> = ({ item }) => {
    if (item.type === 'leg') {
      return (
        <LegBetweenRow
          durationSec={item.durationSec}
          distanceM={item.distanceM}
          etaAtNextMs={item.etaAtNextMs}
          waitMin={item.waitMin}
          stress={item.stress}
          label={item.label}
        />
      );
    }
    const meeting = meetings[item.appointmentIndex]!;
    const event = appointmentsList[item.appointmentIndex]!;
    const hasCoords = event?.coordinates != null;
    const isLate = (waitTimeBeforeMeetingMin[item.appointmentIndex] ?? 0) < 0;
    const row = (
      <SwipeableMeetingRow
        timeRange={meeting.timeRange}
        client={meeting.client}
        address={meeting.address}
        statusColor={meeting.statusColor}
        waypointNumber={item.appointmentIndex + 1}
        phone={event.phone}
        email={event.email}
        isCompleted={meeting.status === 'completed'}
        onToggleDone={() =>
          meeting.status === 'completed' ? unmarkEventAsDone(meeting.id) : markEventAsDone(meeting.id)
        }
        onWaypointNumberPress={
          hasCoords ? () => setHighlightWaypointIndex(item.appointmentIndex) : undefined
        }
        onNavigate={
          hasCoords
            ? () =>
                openNativeDirections(
                  event!.coordinates!.latitude,
                  event!.coordinates!.longitude,
                  meeting.client
                )
            : undefined
        }
        onPress={() => navigation.navigate('MeetingDetails', { eventId: meeting.id })}
        onDelete={() => removeAppointment(meeting.id)}
      />
    );
    const useArrowReorder = reorderMode && (Platform.OS === 'web' || !useDragList);
    if (useArrowReorder) {
      return (
        <View style={[styles.meetingRowWithReorder, isLate && styles.meetingRowLate]}>
          <View style={styles.meetingRowMain}>{row}</View>
          <View style={styles.moveButtons}>
            <TouchableOpacity
              style={[styles.moveButton, item.appointmentIndex === 0 && styles.moveButtonDisabled]}
              onPress={() => handleMoveMeeting(item.appointmentIndex, 'up')}
              disabled={item.appointmentIndex === 0}
            >
              <ChevronUp size={20} color={item.appointmentIndex === 0 ? '#ccc' : '#0078D4'} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.moveButton,
                item.appointmentIndex === appointmentsList.length - 1 && styles.moveButtonDisabled,
              ]}
              onPress={() => handleMoveMeeting(item.appointmentIndex, 'down')}
              disabled={item.appointmentIndex === appointmentsList.length - 1}
            >
              <ChevronDown size={20} color={item.appointmentIndex === appointmentsList.length - 1 ? '#ccc' : '#0078D4'} />
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    if (isLate) {
      return <View style={styles.meetingRowLateWrap}>{row}</View>;
    }
    return row;
  };

  const renderBlockItem = useCallback(
    ({
      item,
      drag,
      isActive,
      getIndex,
    }: RenderItemParams<ScheduleBlockItem>) => {
      const meeting = meetings[item.appointmentIndex]!;
      const event = appointmentsList[item.appointmentIndex]!;
      const hasCoords = event?.coordinates != null;
      const legAfter = getLegAfterMeeting(scheduleListItems, item.appointmentIndex);
      const legFromHome = getIndex() === 0 ? getLegFromHome(scheduleListItems) : null;
      const isLate = (waitTimeBeforeMeetingMin[item.appointmentIndex] ?? 0) < 0;
      const block = (
        <View style={[styles.blockRow, isActive && styles.blockRowActive, isLate && styles.meetingRowLate]}>
          {isWide ? (
            <TouchableOpacity
              onLongPress={drag}
              style={styles.dragHandle}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <GripVertical size={22} color="#605E5C" />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={styles.blockContent}
            activeOpacity={1}
            onLongPress={isWide ? undefined : drag}
            delayLongPress={400}
          >
            {legFromHome ? (
              <LegBetweenRow
                durationSec={legFromHome.durationSec}
                distanceM={legFromHome.distanceM}
                etaAtNextMs={legFromHome.etaAtNextMs}
                waitMin={legFromHome.waitMin}
                stress={legFromHome.stress}
                label={legFromHome.label}
              />
            ) : null}
            <SwipeableMeetingRow
              timeRange={meeting.timeRange}
              client={meeting.client}
              address={meeting.address}
              statusColor={meeting.statusColor}
              waypointNumber={item.appointmentIndex + 1}
              phone={event.phone}
              email={event.email}
              isCompleted={meeting.status === 'completed'}
              onToggleDone={() =>
                meeting.status === 'completed'
                  ? unmarkEventAsDone(meeting.id)
                  : markEventAsDone(meeting.id)
              }
              onWaypointNumberPress={
                hasCoords ? () => setHighlightWaypointIndex(item.appointmentIndex) : undefined
              }
              onNavigate={
                hasCoords
                  ? () =>
                      openNativeDirections(
                        event!.coordinates!.latitude,
                        event!.coordinates!.longitude,
                        meeting.client
                      )
                  : undefined
              }
              onPress={() => navigation.navigate('MeetingDetails', { eventId: meeting.id })}
              onDelete={() => removeAppointment(meeting.id)}
            />
            {legAfter ? (
              <LegBetweenRow
                durationSec={legAfter.durationSec}
                distanceM={legAfter.distanceM}
                etaAtNextMs={legAfter.etaAtNextMs}
                waitMin={legAfter.waitMin}
                stress={legAfter.stress}
                label={legAfter.label}
              />
            ) : null}
          </TouchableOpacity>
        </View>
      );
      return block;
    },
    [
      meetings,
      appointmentsList,
      scheduleListItems,
      waitTimeBeforeMeetingMin,
      navigation,
      setHighlightWaypointIndex,
      unmarkEventAsDone,
      markEventAsDone,
      removeAppointment,
      isWide,
    ]
  );

  const listHeader = (
    <>
      <DaySlider
        selectedDate={selectedDate}
        onSelectDate={onSelectDate}
        meetingCountByDay={meetingCountByDay}
      />
      {daySummary ? (
        <DaySummaryBar
          totalDriveSec={daySummary.totalDriveSec}
          totalDistanceM={daySummary.totalDistanceM}
          departByMs={daySummary.departByMs}
          returnByMs={daySummary.returnByMs}
          tightCount={daySummary.tightCount}
          lateCount={daySummary.lateCount}
          longWaitCount={daySummary.longWaitCount}
        />
      ) : null}
      {isWide ? (
        <>
          <View style={styles.toolbarRow}>
            <View style={styles.viewModeWrap}>
              <ViewModeToggle value={viewMode} onChange={setViewMode} />
            </View>
            {appointmentsList.length > 0 ? (
              <TouchableOpacity
                style={styles.reorderButton}
                onPress={() => setReorderMode((m) => !m)}
                activeOpacity={0.8}
              >
                <Text style={styles.reorderButtonText}>
                  {reorderMode ? 'Cancel' : 'Reorder'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {reorderMode && appointmentsList.length > 0 ? (
            <View style={styles.reorderBar}>
              <TouchableOpacity style={styles.reorderBarButton} onPress={handleSaveOrder}>
                <Text style={styles.reorderBarButtonText}>Save order</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.reorderBarButton} onPress={handleReoptimize}>
                <Text style={styles.reorderBarButtonText}>Re-optimize</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </>
      ) : null}
      {(viewMode === 'timeline' || !isWide) && appointmentsList.length > 0 ? (
        <DayTimelineStrip
          appointments={appointmentsList}
          selectedDateMs={selectedDate.getTime()}
        />
      ) : null}
    </>
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerTitle,
      headerTitleStyle: {
        fontWeight: '600',
        fontSize: isWide ? 16 : undefined,
      },
      headerStyle: {
        backgroundColor: '#0078D4',
        ...(isWide && { minHeight: 44 }),
      },
    });
  }, [navigation, headerTitle, isWide]);

  const useDragList = appointmentsList.length > 0 && Platform.OS !== 'web' && !isExpoGo && !isWide;
  const DraggableFlatListComponent = useDragList ? getDraggableFlatList() : null;
  const scheduleContent = (
    <>
      {appointmentsLoading && !refreshing && appointmentsList.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#0078D4" />
        </View>
      ) : error ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : useDragList && DraggableFlatListComponent ? (
        <DraggableFlatListComponent
          data={blockData}
          keyExtractor={(item: ScheduleBlockItem) => item.id}
          renderItem={renderBlockItem}
          onDragEnd={handleDragEnd}
          ListHeaderComponent={listHeader}
          contentContainerStyle={styles.listContent}
        />
      ) : (
        <FlatList
          data={scheduleListItems}
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          ListHeaderComponent={listHeader}
          contentContainerStyle={
            scheduleListItems.length === 0 ? styles.listEmpty : styles.listContent
          }
          ListEmptyComponent={EmptySchedule}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={['#0078D4']}
              tintColor="#0078D4"
            />
          }
        />
      )}
    </>
  );

  if (isWide) {
    return (
      <View style={styles.splitContainer}>
        <View style={[styles.schedulePane, { paddingLeft: insets.left }]}>
          {scheduleContent}
        </View>
        <View style={styles.mapPane}>
          {isExpoGo ? (
            <View style={[styles.container, styles.mapPlaceholder]}>
              <Text style={styles.mapPlaceholderText}>Map available in development build</Text>
            </View>
          ) : (
            <Suspense
              fallback={
                <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
                  <ActivityIndicator size="large" color="#0078D4" />
                </View>
              }
            >
              <MapScreen embeddedInSchedule />
            </Suspense>
          )}
        </View>
      </View>
    );
  }

  return <View style={styles.container}>{scheduleContent}</View>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F2F1',
  },
  splitContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  schedulePane: {
    flex: 1,
    minWidth: 0,
    backgroundColor: '#F3F2F1',
  },
  mapPane: {
    flex: 1,
    minWidth: 0,
  },
  mapPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
  },
  mapPlaceholderText: {
    fontSize: 14,
    color: '#64748b',
  },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 12,
    gap: 8,
  },
  viewModeWrap: {
    flex: 1,
  },
  reorderButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#E8E8E8',
    borderRadius: 8,
  },
  reorderButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0078D4',
  },
  reorderBar: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  reorderBarButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: '#0078D4',
    borderRadius: 8,
  },
  reorderBarButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  blockRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  blockRowActive: {
    opacity: 0.9,
  },
  dragHandle: {
    paddingVertical: 12,
    paddingRight: 8,
    justifyContent: 'center',
  },
  blockContent: {
    flex: 1,
  },
  meetingRowWithReorder: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  meetingRowLate: {
    backgroundColor: '#FDE7E9',
  },
  meetingRowLateWrap: {
    backgroundColor: '#FDE7E9',
    marginBottom: 12,
  },
  meetingRowMain: {
    flex: 1,
  },
  moveButtons: {
    flexDirection: 'row',
    paddingRight: 8,
    gap: 4,
  },
  moveButton: {
    padding: 8,
  },
  moveButtonDisabled: {
    opacity: 0.5,
  },
  listContent: {
    padding: 16,
    paddingBottom: 88,
  },
  listEmpty: {
    flex: 1,
    paddingBottom: 88,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  emptyText: {
    fontSize: 16,
    color: '#605E5C',
    textAlign: 'center',
  },
  errorText: {
    fontSize: 14,
    color: '#D13438',
    textAlign: 'center',
  },
});
