/**
 * Shared route data logic for MapScreen (mobile) and MapScreen.web.
 * OSRM fetch, waypoints, depart/return times, ETAs, etc.
 * Each screen uses this data and renders with its own map library.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRoute } from '../context/RouteContext';
import { useUserPreferences } from '../context/UserPreferencesContext';
import { getTravelMinutes } from '../utils/scheduler';
import { DEFAULT_HOME_BASE } from '../types';
import { fetchRoute, type OSRMRoute } from '../utils/osrm';
import { parseTimeToDayMs, formatDurationMinutes } from '../utils/dateUtils';
import type { CalendarEvent } from '../services/graph';

export type CoordAppointment = CalendarEvent & {
  coordinates: { latitude: number; longitude: number };
};

/** Per-leg stats: leg 0 = home→first, leg i = meeting i-1→meeting i, leg n = last→home */
export type LegStats = {
  durationSec: number;
  distanceM: number;
};

/** Wait time before a meeting (minutes). Negative = late. */
export type UseRouteDataResult = {
  appointments: CalendarEvent[];
  coords: CoordAppointment[];
  waypoints: Array<{ latitude: number; longitude: number }>;
  osrmRoute: OSRMRoute | null;
  routeLoading: boolean;
  departByMs: number;
  returnByMs: number;
  /** Coords for fitting map bounds - {latitude, longitude}[] */
  allCoordsForFit: Array<{ latitude: number; longitude: number }>;
  /** Fallback polyline when OSRM not available - {latitude, longitude}[] */
  fullPolyline: Array<{ latitude: number; longitude: number }>;
  /** ETA (arrival time in ms) for each meeting */
  etas: number[];
  /** Formatted duration string for each meeting (e.g. "30 min") */
  meetingDurations: string[];
  /** Per-leg: leg 0 = to first meeting, leg 1..n-1 = between meetings, leg n = return home */
  legStats: LegStats[];
  /** Wait time (minutes) before each meeting. Negative = arriving late. */
  waitTimeBeforeMeetingMin: number[];
  /** Stress per leg arriving at a meeting: 'ok' | 'tight' | 'late' for map/list coloring */
  legStress: ('ok' | 'tight' | 'late')[];
  homeBase: { lat: number; lon: number };
  homeBaseLabel: string;
  preBuffer: number;
  postBuffer: number;
  refetchRouteIfNeeded: () => void;
};

export function useRouteData(): UseRouteDataResult {
  const [osrmRoute, setOsrmRoute] = useState<OSRMRoute | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
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
        (a): a is CoordAppointment => a.coordinates != null
      ),
    [appointments]
  );

  const waypoints = useMemo(() => {
    const home = { latitude: homeBase.lat, longitude: homeBase.lon };
    if (coords.length === 0) return [];
    const meetingCoords = coords.map((a) => a.coordinates);
    return [home, ...meetingCoords, home];
  }, [coords, homeBase]);

  const waypointsKey = useMemo(
    () =>
      waypoints.map((w) => `${w.latitude.toFixed(6)},${w.longitude.toFixed(6)}`).join('|'),
    [waypoints]
  );

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (waypoints.length < 2) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setOsrmRoute(null);
      setRouteLoading(false);
      return;
    }

    // Show loading immediately but debounce the actual fetch (avoids rapid re-fetches during drag/reorder)
    setRouteLoading(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    let cancelled = false;
    debounceRef.current = setTimeout(() => {
      fetchRoute(waypoints)
        .then((route) => {
          if (!cancelled) setOsrmRoute(route);
        })
        .catch(() => {
          if (!cancelled) setOsrmRoute(null);
        })
        .finally(() => {
          if (!cancelled) setRouteLoading(false);
        });
    }, 350);

    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [waypointsKey]);

  const refetchRouteIfNeeded = useCallback(() => {
    if (waypoints.length >= 2 && !osrmRoute && !routeLoading) {
      setRouteLoading(true);
      fetchRoute(waypoints)
        .then((route) => setOsrmRoute(route))
        .catch(() => setOsrmRoute(null))
        .finally(() => setRouteLoading(false));
    }
  }, [waypointsKey, waypoints, osrmRoute, routeLoading]);

  const {
    departByMs,
    returnByMs,
    allCoordsForFit,
    fullPolyline,
    etas,
    meetingDurations,
    legStats,
    waitTimeBeforeMeetingMin,
    legStress,
  } = useMemo(() => {
    const home = { lat: homeBase.lat, lon: homeBase.lon };
    let departByMs = 0;
    let returnByMs = 0;
    const etas: number[] = [];
    const meetingDurations: string[] = [];
    const legStats: LegStats[] = [];
    const waitTimeBeforeMeetingMin: number[] = [];
    const legStress: ('ok' | 'tight' | 'late')[] = [];

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

      if (osrmRoute && osrmRoute.legs.length >= 1) {
        for (let i = 0; i < osrmRoute.legs.length; i++) {
          const leg = osrmRoute.legs[i]!;
          legStats.push({ durationSec: leg.duration, distanceM: leg.distance });
        }
        const leg0DurMs = osrmRoute.legs[0]!.duration * 1000;
        const lastLegIdx = osrmRoute.legs.length - 1;
        const lastLegDurMs = osrmRoute.legs[lastLegIdx]!.duration * 1000;
        departByMs = firstStartMs - preBuffer * 60 * 1000 - leg0DurMs;
        returnByMs = lastEndMs + postBuffer * 60 * 1000 + lastLegDurMs;

        let arrivalMs = departByMs + leg0DurMs;
        for (let i = 0; i < coords.length; i++) {
          etas.push(arrivalMs);
          const startMs = coords[i]!.startIso
            ? new Date(coords[i]!.startIso).getTime()
            : parseTimeToDayMs(coords[i]!.time, coords[i]!.startIso ?? coords[i]!.endIso ?? undefined);
          const waitMin = (startMs - arrivalMs) / (60 * 1000);
          waitTimeBeforeMeetingMin.push(waitMin);
          legStress.push(waitMin < 0 ? 'late' : waitMin < 5 ? 'tight' : 'ok');
          meetingDurations.push(formatDurationMinutes(coords[i]!.startIso, coords[i]!.endIso));
          if (i < coords.length - 1 && osrmRoute.legs[i + 1]) {
            const meetingEndMs = coords[i]!.endIso
              ? new Date(coords[i]!.endIso).getTime()
              : parseTimeToDayMs(
                  coords[i]!.time,
                  coords[i]!.startIso ?? coords[i]!.endIso ?? undefined,
                  true
                );
            arrivalMs =
              meetingEndMs +
              postBuffer * 60 * 1000 +
              osrmRoute.legs[i + 1]!.duration * 1000;
          }
        }
      } else {
        const travelToFirstMin = getTravelMinutes(home, firstCoord, firstStartMs);
        const travelToFirstMs = travelToFirstMin * 60 * 1000;
        const travelFromLastMin = getTravelMinutes(lastCoord, home, lastEndMs);
        const travelFromLastMs = travelFromLastMin * 60 * 1000;
        legStats.push({
          durationSec: travelToFirstMin * 60,
          distanceM: 0,
        });
        departByMs = firstStartMs - preBuffer * 60 * 1000 - travelToFirstMs;
        returnByMs = lastEndMs + postBuffer * 60 * 1000 + travelFromLastMs;
        for (let i = 0; i < coords.length; i++) {
          meetingDurations.push(formatDurationMinutes(coords[i]!.startIso, coords[i]!.endIso));
          if (i === 0) {
            etas.push(departByMs + travelToFirstMs);
            const startMs = coords[i]!.startIso
              ? new Date(coords[i]!.startIso).getTime()
              : parseTimeToDayMs(coords[i]!.time, coords[i]!.startIso ?? coords[i]!.endIso ?? undefined);
            const waitMin0 = (startMs - (departByMs + travelToFirstMs)) / (60 * 1000);
            waitTimeBeforeMeetingMin.push(waitMin0);
            legStress.push(waitMin0 < 0 ? 'late' : waitMin0 < 5 ? 'tight' : 'ok');
          } else {
            const prev = {
              lat: coords[i - 1]!.coordinates.latitude,
              lon: coords[i - 1]!.coordinates.longitude,
            };
            const curr = {
              lat: coords[i]!.coordinates.latitude,
              lon: coords[i]!.coordinates.longitude,
            };
            const prevEndMs = coords[i - 1]!.endIso
              ? new Date(coords[i - 1]!.endIso).getTime()
              : parseTimeToDayMs(
                  coords[i - 1]!.time,
                  coords[i - 1]!.startIso ?? coords[i - 1]!.endIso ?? undefined,
                  true
                );
            const departPrev = prevEndMs + postBuffer * 60 * 1000;
            const travelMin = getTravelMinutes(prev, curr, prevEndMs);
            const travelMs = travelMin * 60 * 1000;
            legStats.push({ durationSec: travelMin * 60, distanceM: 0 });
            etas.push(departPrev + travelMs);
            const startMs = coords[i]!.startIso
              ? new Date(coords[i]!.startIso).getTime()
              : parseTimeToDayMs(coords[i]!.time, coords[i]!.startIso ?? coords[i]!.endIso ?? undefined);
            const waitMinI = (startMs - (departPrev + travelMs)) / (60 * 1000);
            waitTimeBeforeMeetingMin.push(waitMinI);
            legStress.push(waitMinI < 0 ? 'late' : waitMinI < 5 ? 'tight' : 'ok');
          }
        }
        legStats.push({
          durationSec: travelFromLastMin * 60,
          distanceM: 0,
        });
      }
    }

    const homeLatLng = { latitude: homeBase.lat, longitude: homeBase.lon };
    const meetingCoords = coords.map((a) => a.coordinates);
    const allCoordsForFit =
      meetingCoords.length > 0 ? [homeLatLng, ...meetingCoords, homeLatLng] : [homeLatLng];
    const fullPolyline =
      meetingCoords.length > 0 ? [homeLatLng, ...meetingCoords, homeLatLng] : [];

    return {
      departByMs,
      returnByMs,
      allCoordsForFit,
      fullPolyline,
      etas,
      meetingDurations,
      legStats,
      waitTimeBeforeMeetingMin,
      legStress,
    };
  }, [coords, homeBase, preBuffer, postBuffer, osrmRoute]);

  return {
    appointments,
    coords,
    waypoints,
    osrmRoute,
    routeLoading,
    departByMs,
    returnByMs,
    allCoordsForFit,
    fullPolyline,
    etas,
    meetingDurations,
    legStats,
    waitTimeBeforeMeetingMin,
    legStress,
    homeBase,
    homeBaseLabel,
    preBuffer,
    postBuffer,
    refetchRouteIfNeeded,
  };
}
