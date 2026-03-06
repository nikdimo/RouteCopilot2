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
  useWindowDimensions,
  Alert,
  Linking,
  PanResponder,
  Animated,
} from 'react-native';
import type { RenderItemParams } from 'react-native-draggable-flatlist';
import { GripVertical, ChevronUp, ChevronDown, RefreshCw, ChevronLeft, ChevronRight, Calendar } from 'lucide-react-native';

let cachedDraggableFlatList: React.ComponentType<any> | null | undefined = undefined;
function getDraggableFlatList(): React.ComponentType<any> | null {
  if (cachedDraggableFlatList !== undefined) return cachedDraggableFlatList;
  try {
    const mod = require('react-native-draggable-flatlist');
    cachedDraggableFlatList = mod?.default ?? mod ?? null;
  } catch {
    cachedDraggableFlatList = null;
  }
  return cachedDraggableFlatList ?? null;
}
import { useNavigation, useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ScheduleStackParamList } from '../navigation/ScheduleStack';
import { startOfDay, endOfDay, isSameDay, format, addDays } from 'date-fns';
import { toLocalDayKey } from '../utils/dateUtils';
import DaySlider, { type DaySliderRef } from '../components/DaySlider';
import SwipeableMeetingRow from '../components/SwipeableMeetingRow';
import LegBetweenRow from '../components/LegBetweenRow';
import DaySummaryBar from '../components/DaySummaryBar';
import ViewModeToggle, { type ViewMode } from '../components/ViewModeToggle';
import DayTimelineStrip from '../components/DayTimelineStrip';
import MonthCalendarOverlay from '../components/MonthCalendarOverlay';
import { useAuth } from '../context/AuthContext';
import { useRoute } from '../context/RouteContext';
import { useUserPreferences } from '../context/UserPreferencesContext';
import { useRouteData } from '../hooks/useRouteData';
import { openNativeDirections } from '../utils/maps';
import type { CalendarEvent } from '../services/graph';
import { useEnsureMeetingCountsForDate } from '../hooks/useEnsureMeetingCountsForDate';
import { useIsWideScreen } from '../hooks/useIsWideScreen';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { getEffectiveSubscriptionTier, getTierEntitlements } from '../utils/subscription';
import { getAppointmentsViewState } from '../utils/appointmentsViewState';
import { EmptyStateScanner } from '../components/emptyState/EmptyStateScanner';
import { useEmptyStateAnimation } from '../components/emptyState/useEmptyStateAnimation';
import { MockSchedule } from '../components/emptyState/MockSchedule';
import { SignedInEmptyStateLeft, SignedInEmptyStateRight } from '../components/emptyState/SignedInEmptyState';
import TrialSubscribeBanner from '../components/TrialSubscribeBanner';
import { backendGetProfileSettings } from '../services/backendApi';

const MapScreen = React.lazy(() => import('./MapScreen'));
const isExpoGo = Constants.appOwnership === 'expo';
const ROUTE_UI_DEBUG =
  __DEV__ || process.env.EXPO_PUBLIC_DEBUG_ROUTE_SYNC === '1';

const GREEN = '#107C10';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Keep onboarding CTA dismissed across component remounts within this JS session.
let onboardingCtaDismissedThisSession = false;

type TrialBannerState = {
  visible: boolean;
  daysLeft: number | null;
  trialEndsAtLabel: string | null;
  upgradeUrl: string | null;
};

function formatShortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function computeDaysLeftFromIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const endMs = new Date(iso).getTime();
  if (!Number.isFinite(endMs)) return null;
  const left = Math.ceil((endMs - Date.now()) / MS_PER_DAY);
  return Math.max(0, left);
}

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

const SKELETON_CARD_COUNT = 4;
const DEFAULT_WIDE_HEADER_SPACER = 56;
const DEFAULT_PORTRAIT_HEADER_SPACER = 220;

function ScheduleSkeletonCards() {
  return (
    <View style={styles.skeletonList}>
      {Array.from({ length: SKELETON_CARD_COUNT }).map((_, i) => (
        <View key={i} style={styles.skeletonCard}>
          <View style={styles.skeletonTime} />
          <View style={styles.skeletonContent}>
            <View style={[styles.skeletonLine, styles.skeletonTitle]} />
            <View style={[styles.skeletonLine, styles.skeletonAddress]} />
          </View>
        </View>
      ))}
    </View>
  );
}

function EmptySchedule({
  animationState,
  isWide,
  isSignedIn,
  onAddMeeting,
  onSignInAndSync,
  ctaVisible,
  onDismissCta,
}: {
  animationState: number;
  isWide: boolean;
  isSignedIn: boolean;
  onAddMeeting: () => void;
  onSignInAndSync: () => void;
  ctaVisible: boolean;
  onDismissCta: () => void;
}) {
  if (isWide) {
    if (isSignedIn) {
      return (
        <View style={{ width: '100%', height: '100%' }}>
          <SignedInEmptyStateLeft onAddMeeting={onAddMeeting} />
        </View>
      );
    }
    return (
      <View style={{ width: '100%', height: '100%', backgroundColor: '#ffffff' }}>
        <MockSchedule animationState={animationState} />
      </View>
    );
  }

  // Mobile Portrait
  if (isSignedIn) {
    return (
      <View style={{ width: '100%', height: '100%' }}>
        <SignedInEmptyStateLeft onAddMeeting={onAddMeeting} />
      </View>
    );
  }
  return (
    <View style={styles.emptyContainer}>
      <EmptyStateScanner
        onSignInAndSync={onSignInAndSync}
        ctaVisible={ctaVisible}
        onDismissCta={onDismissCta}
      />
    </View>
  );
}

function MeetingsLoadErrorState({
  message,
  onRetry,
}: {
  message?: string | null;
  onRetry: () => void;
}) {
  return (
    <View style={styles.loadingErrorContainer}>
      <Text style={styles.loadingErrorTitle}>Couldn't load meetings</Text>
      <Text style={styles.loadingErrorMessage}>
        {message ?? 'Please check your connection and try again.'}
      </Text>
      <TouchableOpacity style={styles.loadingErrorButton} onPress={onRetry} activeOpacity={0.85}>
        <Text style={styles.loadingErrorButtonText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
}

type ScheduleNav = NativeStackNavigationProp<ScheduleStackParamList, 'ScheduleHome'>;

function ScheduleScreenNew() {
  const navigation = useNavigation<ScheduleNav>();
  const isFocused = useIsFocused();
  const { userToken, getValidToken } = useAuth();
  const { preferences } = useUserPreferences();
  const {
    appointments,
    setAppointments,
    appointmentsRequestStatus,
    appointmentsError,
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
  const subscriptionTier = getEffectiveSubscriptionTier(preferences, Boolean(userToken));
  const { canOptimizeRoute, canUseTrafficAwareRouting } = getTierEntitlements(subscriptionTier);
  const ensureMeetingCountsForDate = useEnsureMeetingCountsForDate();
  const { coords, legStats, etas, waitTimeBeforeMeetingMin, departByMs, returnByMs, homeBase } = useRouteData();
  const [refreshing, setRefreshing] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);
  const [ctaVisible, setCtaVisible] = useState(() => !onboardingCtaDismissedThisSession);
  const [trialBannerState, setTrialBannerState] = useState<TrialBannerState>({
    visible: false,
    daysLeft: null,
    trialEndsAtLabel: null,
    upgradeUrl: null,
  });
  const [wideHeaderHeight, setWideHeaderHeight] = useState(DEFAULT_WIDE_HEADER_SPACER);
  const [portraitHeaderHeight, setPortraitHeaderHeight] = useState(DEFAULT_PORTRAIT_HEADER_SPACER);

  const scrollY = useRef(new Animated.Value(0)).current;

  const isSignedIn = !!userToken;

  const refreshTrialBannerState = useCallback(async () => {
    if (!userToken) {
      setTrialBannerState({
        visible: false,
        daysLeft: null,
        trialEndsAtLabel: null,
        upgradeUrl: null,
      });
      return;
    }

    const token = userToken ?? (getValidToken ? await getValidToken() : null);
    if (!token) return;

    const profileSettings = await backendGetProfileSettings(token);
    if (!profileSettings) return;

    const access = profileSettings.access;
    const daysLeft =
      typeof access.trialDaysLeft === 'number'
        ? access.trialDaysLeft
        : computeDaysLeftFromIso(access.trialEndsAt);
    const isBasicTrial = access.source === 'trial' && access.trialPlanCode === 'basic';
    const visible = isBasicTrial && typeof daysLeft === 'number' && daysLeft > 0;

    setTrialBannerState({
      visible,
      daysLeft: typeof daysLeft === 'number' ? daysLeft : null,
      trialEndsAtLabel: formatShortDate(access.trialEndsAt),
      upgradeUrl: profileSettings.upgradeUrl ?? null,
    });
  }, [getValidToken, userToken]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refreshTrialBannerState();
      if (cancelled) return;
    })().catch(() => { });
    return () => {
      cancelled = true;
    };
  }, [refreshTrialBannerState]);

  const handleAddMeeting = useCallback(() => {
    navigation.navigate('AddMeeting');
  }, [navigation]);

  const handleSignInAndSync = useCallback(() => {
    const parent = navigation.getParent();
    if (parent) {
      parent.navigate('Profile' as never);
      return;
    }
    Alert.alert('Open Profile', 'Go to Profile to sign in and connect calendar sync.');
  }, [navigation]);

  const handleTrialSubscribe = useCallback(async () => {
    const url = trialBannerState.upgradeUrl ?? 'https://wiseplan.dk/billing';
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Billing link unavailable', 'Could not open the upgrade page right now.');
    }
  }, [trialBannerState.upgradeUrl]);

  const isWide = useIsWideScreen();
  const useSplitLayout = isWide;
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const dismissOnboardingCta = useCallback(() => {
    onboardingCtaDismissedThisSession = true;
    setCtaVisible(false);
  }, []);

  // Sidebar Resizer State
  const MIN_SIDEBAR = 300;
  const MIN_MAP = 300;
  const RESIZER_HANDLE_WIDTH = 16;
  const [sidebarWidth, setSidebarWidth] = useState(400);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarWidthRef = useRef(400);
  const initialSidebarWidthRef = useRef(400);
  const windowWidthRef = useRef(windowWidth);

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);
  useEffect(() => {
    windowWidthRef.current = windowWidth;
  }, [windowWidth]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: () => {
        setIsResizing(true);
        initialSidebarWidthRef.current = sidebarWidthRef.current;
      },
      onPanResponderMove: (_evt, gestureState) => {
        const w = windowWidthRef.current;
        const maxSidebar = w - MIN_MAP - RESIZER_HANDLE_WIDTH;
        let newWidth = initialSidebarWidthRef.current + gestureState.dx;
        if (newWidth < MIN_SIDEBAR) newWidth = MIN_SIDEBAR;
        if (newWidth > maxSidebar) newWidth = maxSidebar;
        setSidebarWidth(newWidth);
      },
      onPanResponderRelease: () => setIsResizing(false),
      onPanResponderTerminate: () => setIsResizing(false),
    })
  ).current;

  // Web: mouse drag for resizer (PanResponder does not work with mouse on web)
  const handleResizerMouseDown = useCallback((e: any) => {
    if (Platform.OS !== 'web') return;
    e?.preventDefault?.();
    e?.stopPropagation?.();
    const native = e?.nativeEvent ?? e;
    const startX = (native.clientX != null ? native.clientX : e?.clientX) ?? 0;
    const startWidth = sidebarWidthRef.current;
    const onMove = (e2: MouseEvent) => {
      const w = windowWidthRef.current;
      const maxSidebar = Math.max(MIN_SIDEBAR, w - MIN_MAP - RESIZER_HANDLE_WIDTH);
      let newWidth = startWidth + (e2.clientX - startX);
      if (newWidth < MIN_SIDEBAR) newWidth = MIN_SIDEBAR;
      if (newWidth > maxSidebar) newWidth = maxSidebar;
      setSidebarWidth(newWidth);
    };
    const onUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    setIsResizing(true);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  // Day Slider ref for custom scrolling navigation
  const daySliderRef = useRef<DaySliderRef>(null);

  // Syncs the top-left map header text to the slider's visible scroll point
  const [visibleMonthDate, setVisibleMonthDate] = useState(selectedDate);
  const [monthPickerVisible, setMonthPickerVisible] = useState(false);
  useEffect(() => {
    setVisibleMonthDate(selectedDate);
  }, [selectedDate]);

  // Fallback 56 when hook returns 0 (e.g. stack-inside-tab). Min 100 so content clears tab bar + system nav on edge-to-edge Android.
  const listBottomPadding = Math.max(100, (tabBarHeight || 56) + insets.bottom + 16);

  const appointmentsList = appointments ?? [];
  const meetingsViewState = getAppointmentsViewState(appointmentsRequestStatus, appointmentsList.length);
  const isMeetingsLoading = meetingsViewState === 'loading';
  const hasMeetingsLoadError = meetingsViewState === 'error';
  const isEmptyData = meetingsViewState === 'empty';
  const emptyAnimationState = useEmptyStateAnimation(isEmptyData && isWide);

  useEffect(() => {
    if (!ROUTE_UI_DEBUG) return;
    if (!isEmptyData) return;
    console.log('[RouteQC] ScheduleScreen: rendering empty state', {
      selectedDateKey: toLocalDayKey(selectedDate),
      meetingsViewState,
      appointmentsRequestStatus,
      appointmentsCount: appointmentsList.length,
    });
  }, [
    isEmptyData,
    selectedDate,
    meetingsViewState,
    appointmentsRequestStatus,
    appointmentsList.length,
  ]);

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
    return {
      totalDriveSec,
      totalDistanceM,
      departByMs,
      returnByMs,
    };
  }, [legStats, departByMs, returnByMs]);

  useFocusEffect(
    useCallback(() => {
      ensureMeetingCountsForDate(selectedDate);
    }, [ensureMeetingCountsForDate, selectedDate])
  );

  useFocusEffect(
    useCallback(() => {
      refreshTrialBannerState().catch(() => { });
    }, [refreshTrialBannerState])
  );

  const onSelectDate = useCallback(
    (date: Date) => {
      setSelectedDate(date);
      ensureMeetingCountsForDate(date);
    },
    [setSelectedDate, ensureMeetingCountsForDate]
  );

  const openMonthPicker = useCallback(() => {
    setMonthPickerVisible(true);
    ensureMeetingCountsForDate(visibleMonthDate);
  }, [ensureMeetingCountsForDate, visibleMonthDate]);

  const closeMonthPicker = useCallback(() => {
    setMonthPickerVisible(false);
  }, []);

  const handleMonthPickerSelectDate = useCallback(
    (date: Date) => {
      onSelectDate(date);
      setMonthPickerVisible(false);
    },
    [onSelectDate]
  );

  const handleMonthPickerVisibleMonthChange = useCallback(
    (date: Date) => {
      ensureMeetingCountsForDate(date);
    },
    [ensureMeetingCountsForDate]
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
    ensureMeetingCountsForDate(selectedDate, true);
    refreshTimeoutRef.current = setTimeout(() => setRefreshing(false), 12000);
  }, [triggerRefresh, ensureMeetingCountsForDate, selectedDate, setLoadedRange]);

  const handleRetryMeetingsLoad = useCallback(() => {
    onRefresh();
  }, [onRefresh]);

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

  const updateMeasuredHeaderHeight = useCallback(
    (nextHeight: number, setHeight: React.Dispatch<React.SetStateAction<number>>) => {
      if (!Number.isFinite(nextHeight) || nextHeight <= 0) return;
      const rounded = Math.ceil(nextHeight);
      setHeight((prev) => (Math.abs(prev - rounded) > 1 ? rounded : prev));
    },
    []
  );

  const handleWideHeaderLayout = useCallback(
    (event: any) => {
      const nextHeight = event?.nativeEvent?.layout?.height;
      updateMeasuredHeaderHeight(nextHeight, setWideHeaderHeight);
    },
    [updateMeasuredHeaderHeight]
  );

  const handlePortraitHeaderLayout = useCallback(
    (event: any) => {
      const nextHeight = event?.nativeEvent?.layout?.height;
      updateMeasuredHeaderHeight(nextHeight, setPortraitHeaderHeight);
    },
    [updateMeasuredHeaderHeight]
  );

  const topHeaderSpacerHeight = isWide ? wideHeaderHeight : portraitHeaderHeight;

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

  const showProUpgradeAlert = useCallback(() => {
    Alert.alert(
      'Pro feature',
      'Route optimization is available on Pro and Premium plans.'
    );
  }, []);

  const handleReoptimize = useCallback(() => {
    if (!canOptimizeRoute) {
      showProUpgradeAlert();
      return;
    }
    optimize({ latitude: homeBase.lat, longitude: homeBase.lon });
    setReorderMode(false);
  }, [canOptimizeRoute, showProUpgradeAlert, optimize, homeBase.lat, homeBase.lon]);

  const getLateWrapStyle = (minutesLate: number) => {
    if (minutesLate <= 0) return null;
    if (minutesLate <= 10) return styles.meetingRowLateYellow;
    if (minutesLate <= 15) return styles.meetingRowLateOrange;
    return styles.meetingRowLateRed;
  };

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
    const waitMin = waitTimeBeforeMeetingMin[item.appointmentIndex] ?? 0;
    const minutesLate = waitMin < 0 ? Math.abs(Math.round(waitMin)) : 0;
    const lateStyle = getLateWrapStyle(minutesLate);
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
        onEdit={() => navigation.navigate('MeetingDetails', { eventId: meeting.id })}
        onPress={
          hasCoords ? () => setHighlightWaypointIndex(item.appointmentIndex) : undefined
        }
        onDelete={() => removeAppointment(meeting.id)}
      />
    );
    const useArrowReorder = reorderMode && (Platform.OS === 'web' || !useDragList);
    if (useArrowReorder) {
      return (
        <View style={[styles.meetingRowWithReorder, lateStyle]}>
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
    if (lateStyle) {
      return <View style={[styles.meetingRowLateWrap, lateStyle]}>{row}</View>;
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
      const waitMinBlock = waitTimeBeforeMeetingMin[item.appointmentIndex] ?? 0;
      const minutesLateBlock = waitMinBlock < 0 ? Math.abs(Math.round(waitMinBlock)) : 0;
      const lateStyleBlock = getLateWrapStyle(minutesLateBlock);
      const block = (
        <View style={[styles.blockRow, isActive && styles.blockRowActive, lateStyleBlock]}>
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
              onEdit={() => navigation.navigate('MeetingDetails', { eventId: meeting.id })}
              onPress={
                hasCoords ? () => setHighlightWaypointIndex(item.appointmentIndex) : undefined
              }
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
      <View style={{ height: topHeaderSpacerHeight }} />

      {isWide && reorderMode && appointmentsList.length > 0 ? (
        <View style={styles.reorderBar}>
          <TouchableOpacity style={styles.reorderBarButton} onPress={handleSaveOrder}>
            <Text style={styles.reorderBarButtonText}>Save order</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.reorderBarButton,
              !canOptimizeRoute && styles.reorderBarButtonDisabled,
            ]}
            onPress={handleReoptimize}
          >
            <Text style={styles.reorderBarButtonText}>
              {canOptimizeRoute ? 'Re-optimize' : 'Upgrade to Pro'}
            </Text>
          </TouchableOpacity>
          {canOptimizeRoute && !canUseTrafficAwareRouting ? (
            <Text style={styles.reorderHint}>
              Traffic-aware routing provider not active. Current optimization uses standard routing.
            </Text>
          ) : null}
          {canOptimizeRoute && canUseTrafficAwareRouting ? (
            <Text style={styles.reorderHint}>
              Traffic-aware provider is planned. Current optimization uses standard routing until enabled.
            </Text>
          ) : null}
        </View>
      ) : null}

      {appointmentsList.length > 0 ? (
        <DayTimelineStrip
          appointments={appointmentsList}
          selectedDateMs={selectedDate.getTime()}
        />
      ) : null}
    </>
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: false,
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
      {isMeetingsLoading && !refreshing && appointmentsList.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ScheduleSkeletonCards />
        </View>
      ) : hasMeetingsLoadError && appointmentsList.length === 0 ? (
        <MeetingsLoadErrorState message={appointmentsError} onRetry={handleRetryMeetingsLoad} />
      ) : useDragList && DraggableFlatListComponent ? (
        <DraggableFlatListComponent
          data={blockData}
          keyExtractor={(item: ScheduleBlockItem) => item.id}
          renderItem={renderBlockItem}
          onDragEnd={handleDragEnd}
          ListHeaderComponent={listHeader}
          contentContainerStyle={[styles.listContent, { paddingBottom: listBottomPadding }]}
        />
      ) : (
        <FlatList
          data={scheduleListItems}
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          ListHeaderComponent={listHeader}
          contentContainerStyle={
            scheduleListItems.length === 0
              ? [styles.listEmpty, { paddingBottom: listBottomPadding }]
              : [styles.listContent, { paddingBottom: listBottomPadding }]
          }
          ListEmptyComponent={() => (
            hasMeetingsLoadError ? (
              <MeetingsLoadErrorState
                message={appointmentsError}
                onRetry={handleRetryMeetingsLoad}
              />
            ) : (
              <EmptySchedule
                animationState={emptyAnimationState}
                isWide={isWide}
                isSignedIn={isSignedIn}
                onAddMeeting={handleAddMeeting}
                onSignInAndSync={handleSignInAndSync}
                ctaVisible={ctaVisible}
                onDismissCta={dismissOnboardingCta}
              />
            )
          )}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: scrollY } } }],
            { useNativeDriver: false }
          )}
          scrollEventThrottle={16}
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

  const headerTranslateY = scrollY.interpolate({
    inputRange: [0, 80],
    outputRange: [0, -80],
    extrapolate: 'clamp',
  });

  if (!isSignedIn && isEmptyData) {
    return (
      <View style={styles.container}>
        <EmptyStateScanner
          onSignInAndSync={handleSignInAndSync}
          ctaVisible={ctaVisible}
          onDismissCta={dismissOnboardingCta}
          animate={isFocused}
        />
      </View>
    );
  }

  if (isWide) {
    return (
      <View style={[styles.container, isResizing && Platform.OS === 'web' ? { userSelect: 'none' } as any : null]}>
        {/* GLOBAL HEADER */}
        <Animated.View
          onLayout={handleWideHeaderLayout}
          style={[styles.globalHeaderWide, { transform: [{ translateY: headerTranslateY }] }]}
        >
          {/* Left: Date & Title */}
          <View style={styles.globalHeaderLeft}>
            <TouchableOpacity
              style={styles.calendarIconSquare}
              onPress={openMonthPicker}
              activeOpacity={0.8}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Calendar color="#3B82F6" size={20} />
            </TouchableOpacity>
            <View style={styles.desktopMonthTextGroup}>
              <Text style={styles.desktopMonthTitle}>{format(visibleMonthDate, 'MMMM yyyy')}</Text>
              <Text style={styles.desktopMonthSubtitle}>Route Planner</Text>
            </View>
          </View>

          {/* Center: Info boxes (Time, Distance, Start, End) */}
          <View style={styles.globalHeaderCenterRightWrap}>
            <View style={styles.globalHeaderCenter}>
              {daySummary ? (
                <DaySummaryBar
                  totalDriveSec={daySummary.totalDriveSec}
                  totalDistanceM={daySummary.totalDistanceM}
                  departByMs={daySummary.departByMs}
                  returnByMs={daySummary.returnByMs}
                />
              ) : null}
            </View>

            {/* Right: Today + Day selector */}
            <View style={styles.globalHeaderRight}>
              <TouchableOpacity
                style={styles.desktopTodayButton}
                onPress={() => onSelectDate(TODAY)}
                activeOpacity={0.7}
              >
                <Text style={styles.desktopTodayText}>Today</Text>
              </TouchableOpacity>
              <View style={styles.unifiedDayStripContainer}>
                <TouchableOpacity style={styles.chevronButton} onPress={() => daySliderRef.current?.scrollByDays(-5)}>
                  <ChevronLeft color="#333" size={18} />
                </TouchableOpacity>
                <View style={styles.desktopDaySliderWrap}>
                  <DaySlider
                    ref={daySliderRef}
                    selectedDate={selectedDate}
                    onSelectDate={onSelectDate}
                    meetingCountByDay={meetingCountByDay}
                    onVisibleMonthChange={setVisibleMonthDate}
                  />
                </View>
                <TouchableOpacity style={styles.chevronButton} onPress={() => daySliderRef.current?.scrollByDays(5)}>
                  <ChevronRight color="#333" size={18} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Animated.View>

        <View style={styles.splitContainer}>
          {/* Schedule Pane - using dynamic sidebarWidth */}
          <View style={[styles.schedulePane, { width: sidebarWidth, flex: undefined, paddingLeft: insets.left }]}>
            {scheduleContent}
          </View>

          {/* Draggable Divider - on web use mouse only; on native use PanResponder */}
          <View
            style={styles.resizerHandle}
            {...(Platform.OS === 'web'
              ? { onMouseDown: handleResizerMouseDown }
              : panResponder.panHandlers)}
          >
            <View style={styles.resizerLine} />
          </View>

          <View style={[styles.mapPane, { flex: 1, paddingRight: insets.right }]}>
            <View style={{ flex: 1 }}>
              {isExpoGo ? (
                <View style={[styles.container, styles.mapPlaceholder]}>
                  <Text style={styles.mapPlaceholderText}>Map available in development build</Text>
                </View>
              ) : isSignedIn && isEmptyData ? (
                <SignedInEmptyStateRight />
              ) : (
                <Suspense
                  fallback={
                    <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
                      <ActivityIndicator size="large" color="#0078D4" />
                    </View>
                  }
                >
                  <MapScreen key={`embed-${windowWidth}-${windowHeight}`} embeddedInSchedule emptyAnimationState={emptyAnimationState} />
                </Suspense>
              )}
            </View>
          </View>

          {/* Floating trial subscribe banner (driven by backend trial access state). */}
          <TrialSubscribeBanner
            visible={trialBannerState.visible}
            trialEndsAtLabel={trialBannerState.trialEndsAtLabel ?? undefined}
            daysLeft={trialBannerState.daysLeft}
            onSubscribe={handleTrialSubscribe}
          />

        </View>

        <MonthCalendarOverlay
          visible={monthPickerVisible}
          selectedDate={selectedDate}
          initialMonthDate={visibleMonthDate}
          meetingCountByDay={meetingCountByDay}
          onSelectDate={handleMonthPickerSelectDate}
          onVisibleMonthChange={handleMonthPickerVisibleMonthChange}
          onClose={closeMonthPicker}
        />
      </View>
    );
  }

  // Portrait layout fallback (old mobile)
  return (
    <View style={styles.container}>
      <Animated.View
        onLayout={handlePortraitHeaderLayout}
        style={[styles.globalHeaderPortrait, { transform: [{ translateY: headerTranslateY }] }]}
      >
        <View style={styles.globalHeaderPortraitTop}>
          <TouchableOpacity
            style={styles.calendarIconSquare}
            onPress={openMonthPicker}
            activeOpacity={0.8}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Calendar color="#3B82F6" size={20} />
          </TouchableOpacity>
          <View style={[styles.desktopMonthTextGroup, { marginLeft: 12 }]}>
            <Text style={styles.desktopMonthTitle}>{format(visibleMonthDate, 'MMMM yyyy')}</Text>
            <Text style={styles.desktopMonthSubtitle}>Route Planner</Text>
          </View>
        </View>

        <View style={styles.globalHeaderPortraitCenter}>
          {daySummary ? (
            <DaySummaryBar
              totalDriveSec={daySummary.totalDriveSec}
              totalDistanceM={daySummary.totalDistanceM}
              departByMs={daySummary.departByMs}
              returnByMs={daySummary.returnByMs}
            />
          ) : null}
        </View>

        <View style={styles.globalHeaderPortraitBottom}>
          <View style={styles.portraitUnifiedStripContainer}>
            <TouchableOpacity
              style={[styles.desktopTodayButton, { marginRight: 8 }]}
              onPress={() => onSelectDate(TODAY)}
              activeOpacity={0.7}
            >
              <Text style={styles.desktopTodayText}>Today</Text>
            </TouchableOpacity>
            <View style={styles.unifiedDayStripContainer}>
              <TouchableOpacity style={styles.chevronButton} onPress={() => daySliderRef.current?.scrollByDays(-5)}>
                <ChevronLeft color="#333" size={18} />
              </TouchableOpacity>
              <View style={styles.daySliderWrap}>
                <DaySlider
                  ref={daySliderRef}
                  selectedDate={selectedDate}
                  onSelectDate={onSelectDate}
                  meetingCountByDay={meetingCountByDay}
                  onVisibleMonthChange={setVisibleMonthDate}
                />
              </View>
              <TouchableOpacity style={styles.chevronButton} onPress={() => daySliderRef.current?.scrollByDays(5)}>
                <ChevronRight color="#333" size={18} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Animated.View>

      {scheduleContent}
      <TrialSubscribeBanner
        visible={trialBannerState.visible}
        trialEndsAtLabel={trialBannerState.trialEndsAtLabel ?? undefined}
        daysLeft={trialBannerState.daysLeft}
        onSubscribe={handleTrialSubscribe}
      />
      <MonthCalendarOverlay
        visible={monthPickerVisible}
        selectedDate={selectedDate}
        initialMonthDate={visibleMonthDate}
        meetingCountByDay={meetingCountByDay}
        onSelectDate={handleMonthPickerSelectDate}
        onVisibleMonthChange={handleMonthPickerVisibleMonthChange}
        onClose={closeMonthPicker}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  splitContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  schedulePane: {
    flex: 1,
    minWidth: 0,
    backgroundColor: '#FFFFFF',
  },
  mapPane: {
    flex: 1,
    minWidth: 0,
  },
  resizerHandle: {
    width: 16,
    minWidth: 16,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    // @ts-ignore - web
    cursor: 'col-resize',
    touchAction: 'none',
    userSelect: 'none',
    zIndex: 50,
  },
  resizerLine: {
    width: 4,
    height: 48,
    borderRadius: 2,
    backgroundColor: '#D1D5DB', // subtle grey handle
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
  topHeaderSpacing: {
    paddingTop: 8,
    paddingBottom: 4,
  },
  timelineHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    marginTop: 8,
  },
  desktopMapHeaderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingBottom: 8, // Tighter padding like mockup
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    zIndex: 10,
  },
  desktopMonthTextGroup: {
    flexDirection: 'column',
    justifyContent: 'center',
    flex: 1,
  },
  chevronButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    flex: 1,
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
  reorderBarButtonDisabled: {
    backgroundColor: '#94a3b8',
  },
  reorderBarButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  reorderHint: {
    flex: 1,
    minWidth: 220,
    fontSize: 12,
    color: '#475569',
    alignSelf: 'center',
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
  /** Timeline late indicator: pastel yellow 0–10 min, orange 10–15, red >15 */
  meetingRowLateYellow: {
    backgroundColor: '#FEF9C3',
    borderLeftWidth: 4,
    borderLeftColor: '#EAB308',
  },
  meetingRowLateOrange: {
    backgroundColor: '#FFEDD5',
    borderLeftWidth: 4,
    borderLeftColor: '#F97316',
  },
  meetingRowLateRed: {
    backgroundColor: '#FDE7E9',
    borderLeftWidth: 4,
    borderLeftColor: '#DC2626',
  },
  meetingRowLateWrap: {
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
  daySliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 4,
  },
  desktopMonthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  desktopMonthTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  desktopMonthSubtitle: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
    marginTop: 0,
  },
  desktopLeftHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  calendarIconSquare: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unifiedDayStripContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  desktopHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    flex: 1,
    justifyContent: 'flex-end',
  },
  desktopTodayButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
  },
  desktopTodayText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  desktopDaySliderWrap: {
    maxWidth: 400,
  },
  daySliderWrap: {
    flex: 1,
    minWidth: 0,
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#E8E8E8',
    borderRadius: 8,
  },
  refreshButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0078D4',
  },
  refreshButtonTextDisabled: {
    color: '#999',
  },
  listContent: {
    padding: 16,
    paddingBottom: 88,
  },
  listEmpty: {
    height: '100%',
    paddingBottom: 88,
  },
  loadingContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  loadingErrorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 10,
  },
  loadingErrorTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
    textAlign: 'center',
  },
  loadingErrorMessage: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    maxWidth: 420,
  },
  loadingErrorButton: {
    marginTop: 8,
    backgroundColor: '#0078D4',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  loadingErrorButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  skeletonList: {
    gap: 12,
  },
  skeletonCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    borderRadius: 8,
  },
  skeletonTime: {
    width: 56,
    height: 14,
    backgroundColor: '#E1DFDD',
    borderRadius: 4,
    marginRight: 12,
    marginTop: 2,
  },
  skeletonContent: {
    flex: 1,
    gap: 8,
  },
  skeletonLine: {
    height: 12,
    backgroundColor: '#E1DFDD',
    borderRadius: 4,
  },
  skeletonTitle: {
    width: '70%',
  },
  skeletonAddress: {
    width: '90%',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 0,
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
  floatingCtaContainer: {
    position: 'absolute',
    bottom: 32,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 100,
    paddingHorizontal: 24,
  },
  floatingCtaInner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    padding: 12,
    paddingRight: 36,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 10,
    maxWidth: 680,
    width: '100%',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  ctaIconBadge: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  ctaTextContainer: {
    flex: 1,
    marginRight: 12,
  },
  ctaHeadline: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 2,
  },
  ctaSubtext: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 16,
  },
  ctaButton: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  ctaButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  ctaCloseButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
  },
  globalHeaderWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderColor: '#E2E8F0',
    zIndex: 10,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  /** Month + Today + day selector grouped on the left; no flex so they stay next to the month */
  globalHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexShrink: 0,
    zIndex: 2,
  },
  globalHeaderCenterRightWrap: {
    flex: 1,
    minWidth: 620,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    zIndex: 1,
  },
  globalHeaderCenter: {
    flex: 1,
    minWidth: 420,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -8,
    marginBottom: -20,
  },
  globalHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 16,
    flexShrink: 1,
    minWidth: 0,
  },
  globalHeaderPortrait: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderColor: '#E2E8F0',
    zIndex: 10,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  globalHeaderPortraitTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  globalHeaderPortraitCenter: {
    marginHorizontal: -16, // Bleed summary bar
  },
  globalHeaderPortraitBottom: {
    marginHorizontal: -16, // Bleed day slider
    borderTopWidth: 1,
    borderColor: '#F1F5F9',
    paddingVertical: 4,
    paddingHorizontal: 16,
  },
  portraitUnifiedStripContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
});

export default ScheduleScreenNew;
