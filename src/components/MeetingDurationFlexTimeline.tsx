import React, { useCallback, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, Platform, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

type MeetingDurationFlexTimelineProps = {
  durationMinutes: number;
  flexBeforeMinutes: number;
  flexAfterMinutes: number;
  showFlexHandles: boolean;
  onDurationChange: (nextDurationMinutes: number) => void;
  onFlexBeforeChange: (nextFlexBeforeMinutes: number) => void;
  onFlexAfterChange: (nextFlexAfterMinutes: number) => void;
  maxMinutes?: number;
  stepMinutes?: number;
  maxFlexPerSideMinutes?: number;
  canEdit?: boolean;
};

const HANDLE_SIZE = 24;
const HIT_SIZE = HANDLE_SIZE + 16;
const TRACK_HEIGHT = 8;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function snapToStep(value: number, step: number) {
  const safeStep = Math.max(1, step);
  return Math.round(value / safeStep) * safeStep;
}

export default function MeetingDurationFlexTimeline({
  durationMinutes,
  flexBeforeMinutes,
  flexAfterMinutes,
  showFlexHandles,
  onDurationChange,
  onFlexBeforeChange,
  onFlexAfterChange,
  maxMinutes = 8 * 60,
  stepMinutes = 15,
  maxFlexPerSideMinutes,
  canEdit = true,
}: MeetingDurationFlexTimelineProps) {
  const trackRef = useRef<View>(null);
  const trackLayout = useRef({ x: 0, width: 300 });
  const [trackWidth, setTrackWidth] = useState(300);

  const safeDuration = useMemo(
    () => clamp(snapToStep(durationMinutes, stepMinutes), stepMinutes, maxMinutes),
    [durationMinutes, maxMinutes, stepMinutes]
  );

  const centerMinutes = maxMinutes / 2;
  const halfDuration = safeDuration / 2;
  const meetingStartMin = centerMinutes - halfDuration;
  const meetingEndMin = centerMinutes + halfDuration;

  const computedMaxFlexPerSide = Math.max(0, (maxMinutes - safeDuration) / 2);
  const safeMaxFlexPerSide = maxFlexPerSideMinutes != null
    ? clamp(maxFlexPerSideMinutes, 0, computedMaxFlexPerSide)
    : computedMaxFlexPerSide;

  const safeFlexBefore = clamp(snapToStep(flexBeforeMinutes, stepMinutes), 0, safeMaxFlexPerSide);
  const safeFlexAfter = clamp(snapToStep(flexAfterMinutes, stepMinutes), 0, safeMaxFlexPerSide);

  const flexStartMin = meetingStartMin - safeFlexBefore;
  const flexEndMin = meetingEndMin + safeFlexAfter;

  const onTrackLayout = useCallback((event: LayoutChangeEvent) => {
    const width = Math.max(1, event.nativeEvent.layout.width);
    setTrackWidth(width);
    trackRef.current?.measureInWindow((x) => {
      trackLayout.current = { x, width };
    });
  }, []);

  const minutesToLeft = useCallback((minutes: number) => {
    if (maxMinutes <= 0) return 0;
    return (clamp(minutes, 0, maxMinutes) / maxMinutes) * trackWidth;
  }, [maxMinutes, trackWidth]);

  const absoluteXToMinutes = useCallback((absoluteX: number) => {
    const { x, width } = trackLayout.current;
    if (width <= 0 || maxMinutes <= 0) return 0;
    const ratio = (absoluteX - x) / width;
    return clamp(ratio * maxMinutes, 0, maxMinutes);
  }, [maxMinutes]);

  const handleDurationDrag = useCallback((absoluteX: number) => {
    const pointerMinutes = absoluteXToMinutes(absoluteX);
    const nextHalf = Math.abs(centerMinutes - pointerMinutes);
    const nextDuration = clamp(
      snapToStep(nextHalf * 2, stepMinutes),
      stepMinutes,
      maxMinutes
    );
    onDurationChange(nextDuration);
  }, [absoluteXToMinutes, centerMinutes, maxMinutes, onDurationChange, stepMinutes]);

  const handleFlexBeforeDrag = useCallback((absoluteX: number) => {
    const pointerMinutes = absoluteXToMinutes(absoluteX);
    const rawFlex = meetingStartMin - pointerMinutes;
    const nextFlex = clamp(
      snapToStep(rawFlex, stepMinutes),
      0,
      safeMaxFlexPerSide
    );
    onFlexBeforeChange(nextFlex);
  }, [absoluteXToMinutes, meetingStartMin, onFlexBeforeChange, safeMaxFlexPerSide, stepMinutes]);

  const handleFlexAfterDrag = useCallback((absoluteX: number) => {
    const pointerMinutes = absoluteXToMinutes(absoluteX);
    const rawFlex = pointerMinutes - meetingEndMin;
    const nextFlex = clamp(
      snapToStep(rawFlex, stepMinutes),
      0,
      safeMaxFlexPerSide
    );
    onFlexAfterChange(nextFlex);
  }, [absoluteXToMinutes, meetingEndMin, onFlexAfterChange, safeMaxFlexPerSide, stepMinutes]);

  const durationGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(canEdit)
        .activeOffsetX([-4, 4])
        .failOffsetY([-20, 20])
        .onUpdate((event) => {
          runOnJS(handleDurationDrag)(event.absoluteX);
        }),
    [canEdit, handleDurationDrag]
  );

  const flexBeforeGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(canEdit && showFlexHandles)
        .activeOffsetX([-4, 4])
        .failOffsetY([-20, 20])
        .onUpdate((event) => {
          runOnJS(handleFlexBeforeDrag)(event.absoluteX);
        }),
    [canEdit, handleFlexBeforeDrag, showFlexHandles]
  );

  const flexAfterGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(canEdit && showFlexHandles)
        .activeOffsetX([-4, 4])
        .failOffsetY([-20, 20])
        .onUpdate((event) => {
          runOnJS(handleFlexAfterDrag)(event.absoluteX);
        }),
    [canEdit, handleFlexAfterDrag, showFlexHandles]
  );

  const meetingLeft = minutesToLeft(meetingStartMin);
  const meetingRight = minutesToLeft(meetingEndMin);
  const meetingWidth = Math.max(0, meetingRight - meetingLeft);
  const flexLeft = minutesToLeft(flexStartMin);
  const flexRight = minutesToLeft(flexEndMin);
  const flexWidth = Math.max(0, flexRight - flexLeft);

  const thumbShadow = useMemo(
    () =>
      Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.25,
          shadowRadius: 3,
        },
        android: { elevation: 4 },
        default: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.25,
          shadowRadius: 3,
        },
      }),
    []
  );

  return (
    <View style={styles.container}>
      <View
        ref={trackRef}
        onLayout={onTrackLayout}
        style={styles.trackWrap}
        pointerEvents="box-none"
      >
        <View style={styles.trackBase} pointerEvents="none" />
        {showFlexHandles && (
          <View
            style={[
              styles.flexRange,
              {
                left: flexLeft,
                width: flexWidth,
              },
            ]}
            pointerEvents="none"
          />
        )}
        <View
          style={[
            styles.meetingRange,
            {
              left: meetingLeft,
              width: meetingWidth,
            },
          ]}
          pointerEvents="none"
        />

        <GestureDetector gesture={durationGesture}>
          <View style={[styles.handleHit, { left: meetingLeft - HIT_SIZE / 2 + HANDLE_SIZE / 2 }]}>
            <View style={[styles.handle, styles.meetingHandle, thumbShadow]} />
          </View>
        </GestureDetector>
        <GestureDetector gesture={durationGesture}>
          <View style={[styles.handleHit, { left: meetingRight - HIT_SIZE / 2 + HANDLE_SIZE / 2 }]}>
            <View style={[styles.handle, styles.meetingHandle, thumbShadow]} />
          </View>
        </GestureDetector>

        {showFlexHandles && (
          <GestureDetector gesture={flexBeforeGesture}>
            <View style={[styles.handleHit, { left: flexLeft - HIT_SIZE / 2 + HANDLE_SIZE / 2 }]}>
              <View style={[styles.handle, styles.flexHandle, thumbShadow]} />
            </View>
          </GestureDetector>
        )}
        {showFlexHandles && (
          <GestureDetector gesture={flexAfterGesture}>
            <View style={[styles.handleHit, { left: flexRight - HIT_SIZE / 2 + HANDLE_SIZE / 2 }]}>
              <View style={[styles.handle, styles.flexHandle, thumbShadow]} />
            </View>
          </GestureDetector>
        )}
      </View>
      <View style={styles.scaleRow}>
        <Text style={styles.scaleText}>0h</Text>
        <Text style={styles.scaleText}>4h</Text>
        <Text style={styles.scaleText}>8h</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  trackWrap: {
    width: '100%',
    height: 44,
    justifyContent: 'center',
    position: 'relative',
  },
  trackBase: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: '#E2E8F0',
  },
  flexRange: {
    position: 'absolute',
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: '#F59E0B',
    opacity: 0.25,
  },
  meetingRange: {
    position: 'absolute',
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: '#2563EB',
  },
  handleHit: {
    position: 'absolute',
    top: (44 - HIT_SIZE) / 2,
    width: HIT_SIZE,
    height: HIT_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  handle: {
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
  },
  meetingHandle: {
    borderColor: '#2563EB',
  },
  flexHandle: {
    borderColor: '#D97706',
  },
  scaleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  scaleText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
});
