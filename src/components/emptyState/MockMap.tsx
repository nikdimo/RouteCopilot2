import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, Text, Image, type LayoutChangeEvent } from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    useAnimatedProps,
    withTiming,
    withDelay,
    Easing,
    interpolate,
    withRepeat,
    withSequence,
    cancelAnimation
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { useDevUI } from '../../context/DevUIContext';

const AnimatedPath = Animated.createAnimatedComponent(Path);

interface MockMapProps {
    animationState: number; // 0=Gap1, 1=Gap2, 2=Gap3, 3=Gap3(Locked)
}

const RADAR_POINTS = {
    p1: { x: 100, y: 100 }, p2: { x: 200, y: 80 }, p3: { x: 300, y: 200 }, p4: { x: 100, y: 300 },
    np: { x: 180, y: 230 }
};

const MAP_STYLES = [
    {
        name: 'Classic Teardrop',
        bg: '#f8f9fa',
        inactivePin: '#3b82f6', // Solid blue
        activePin: '#3b82f6',
        activeFinalPin: '#16a34a', // Solid green
        pathConsidered: '#00A3FF',
        pathFinal: '#10b981',
        pathPossible: '#e2e8f0',
        strokeWidthBg: 8,
        strokeWidthActive: 6,
        pinType: 'circle',
        lineStyle: 'solid',
        linecap: 'round',
        ...RADAR_POINTS
    },
    {
        name: 'Radar Dots',
        bg: '#f8f9fa',
        inactivePin: '#3b82f6',
        activePin: '#3b82f6',
        activeFinalPin: '#22c55e',
        pathConsidered: '#3b82f6',
        pathFinal: '#22c55e',
        pathPossible: '#cbd5e1',
        strokeWidthBg: 6,
        strokeWidthActive: 8,
        pinType: 'circle',
        lineStyle: 'dotted',
        linecap: 'round',
        ...RADAR_POINTS
    },
    {
        name: 'Minimal City Grid',
        bg: '#ffffff',
        inactivePin: '#6366f1',
        activePin: '#6366f1',
        activeFinalPin: '#059669',
        pathConsidered: '#6366f1',
        pathFinal: '#059669',
        pathPossible: '#f1f5f9',
        strokeWidthBg: 12,
        strokeWidthActive: 8,
        pinType: 'circle',
        lineStyle: 'solid',
        linecap: 'square',
        ...RADAR_POINTS
    },
    {
        name: 'Blueprint Dashes',
        bg: '#f8fafc',
        inactivePin: '#0ea5e9',
        activePin: '#0ea5e9',
        activeFinalPin: '#16a34a',
        pathConsidered: '#0ea5e9',
        pathFinal: '#16a34a',
        pathPossible: '#e2e8f0',
        strokeWidthBg: 5,
        strokeWidthActive: 5,
        pinType: 'circle',
        lineStyle: 'dashed',
        linecap: 'butt',
        ...RADAR_POINTS
    },
    {
        name: 'Geometric Sharp',
        bg: '#f1f5f9',
        inactivePin: '#0284c7',
        activePin: '#0284c7',
        activeFinalPin: '#15803d',
        pathConsidered: '#0284c7',
        pathFinal: '#15803d',
        pathPossible: '#cbd5e1',
        strokeWidthBg: 3,
        strokeWidthActive: 4,
        pinType: 'circle',
        lineStyle: 'solid',
        linecap: 'butt',
        ...RADAR_POINTS
    }
];

export const MockMap: React.FC<MockMapProps> = ({ animationState }) => {
    const { mockMapStyleIndex } = useDevUI();
    const [mapViewport, setMapViewport] = useState({ width: 400, height: 400 });
    const layoutIndex = mockMapStyleIndex;
    const styleDef = MAP_STYLES[layoutIndex] as any;
    const mapCanvasSize = Math.max(
        220,
        Math.min(420, Math.floor(Math.min(mapViewport.width, mapViewport.height) * 0.94))
    );

    const handleLayout = useCallback((event: LayoutChangeEvent) => {
        const { width, height } = event.nativeEvent.layout;
        if (width <= 0 || height <= 0) return;
        setMapViewport((prev) => {
            if (Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1) {
                return prev;
            }
            return { width, height };
        });
    }, []);

    // Background existing booked active route (1 -> 2 -> 3 -> 4)
    const baseBookedRoute = `M ${styleDef.p1.x} ${styleDef.p1.y} L ${styleDef.p2.x} ${styleDef.p2.y} L ${styleDef.p3.x} ${styleDef.p3.y} L ${styleDef.p4.x} ${styleDef.p4.y}`;

    // Active routes tested (Modifying the solid route to include X)
    const path0D = `M ${styleDef.p1.x} ${styleDef.p1.y} L ${styleDef.np.x} ${styleDef.np.y} L ${styleDef.p2.x} ${styleDef.p2.y} L ${styleDef.p3.x} ${styleDef.p3.y} L ${styleDef.p4.x} ${styleDef.p4.y}`;
    const path1D = `M ${styleDef.p1.x} ${styleDef.p1.y} L ${styleDef.p2.x} ${styleDef.p2.y} L ${styleDef.np.x} ${styleDef.np.y} L ${styleDef.p3.x} ${styleDef.p3.y} L ${styleDef.p4.x} ${styleDef.p4.y}`;
    const path2D = `M ${styleDef.p1.x} ${styleDef.p1.y} L ${styleDef.p2.x} ${styleDef.p2.y} L ${styleDef.p3.x} ${styleDef.p3.y} L ${styleDef.np.x} ${styleDef.np.y} L ${styleDef.p4.x} ${styleDef.p4.y}`;

    const path0Progress = useSharedValue(0);
    const path1Progress = useSharedValue(0);
    const path2Progress = useSharedValue(0);

    // Camera panning
    const cameraX = useSharedValue(0);
    const cameraY = useSharedValue(0);
    const cameraScale = useSharedValue(1);

    // Floating interaction
    const newPinFloatY = useSharedValue(0);
    const newPinScale = useSharedValue(1); // Set to 1 initially so it is visible

    const isHovering = animationState <= 2;

    useEffect(() => {
        path0Progress.value = 0;
        path1Progress.value = 0;
        path2Progress.value = 0;

        if (isHovering) {
            // Continually bob up and down
            newPinFloatY.value = withRepeat(
                withSequence(
                    withTiming(-20, { duration: 600, easing: Easing.inOut(Easing.ease) }),
                    withTiming(-5, { duration: 600, easing: Easing.inOut(Easing.ease) }) // never quite land
                ),
                -1,
                true
            );
        } else {
            // Cancel the float and drop into place
            cancelAnimation(newPinFloatY);
            newPinFloatY.value = withTiming(0, { duration: 300, easing: Easing.out(Easing.elastic(1.5)) });
            newPinScale.value = withTiming(1.3, { duration: 300 });
            newPinScale.value = withDelay(300, withTiming(1, { duration: 200 }));
        }

        if (animationState === 0) { // Hover Gap 1
            path0Progress.value = withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) });
            cameraX.value = withTiming(-10, { duration: 1500, easing: Easing.out(Easing.ease) });
            cameraY.value = withTiming(-5, { duration: 1500, easing: Easing.out(Easing.ease) });
            cameraScale.value = withTiming(0.95, { duration: 1500 });

        } else if (animationState === 1) { // Hover Gap 2
            path1Progress.value = withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) });
            cameraX.value = withTiming(10, { duration: 1500, easing: Easing.out(Easing.ease) });
            cameraY.value = withTiming(5, { duration: 1500, easing: Easing.out(Easing.ease) });
            cameraScale.value = withTiming(0.95, { duration: 1500 });

        } else if (animationState === 2) { // Hover Gap 3
            path2Progress.value = withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) });
            cameraX.value = withTiming(0, { duration: 1500, easing: Easing.out(Easing.ease) });
            cameraY.value = withTiming(10, { duration: 1500, easing: Easing.out(Easing.ease) });
            cameraScale.value = withTiming(0.95, { duration: 1500 });

        } else if (animationState === 3) { // Final Match Gap 3 (Lock)
            path2Progress.value = withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) });
            cameraX.value = withTiming(0, { duration: 1000, easing: Easing.out(Easing.ease) });
            cameraY.value = withTiming(0, { duration: 1000, easing: Easing.out(Easing.ease) });
            cameraScale.value = withTiming(1, { duration: 1000 });
        }
    }, [animationState, layoutIndex]);

    const cameraStyle = useAnimatedStyle(() => ({
        transform: [
            { translateX: cameraX.value },
            { translateY: cameraY.value },
            { scale: cameraScale.value }
        ]
    }));

    // For solid, dashed, dotted logic
    const getStrokeArray = (type: string, active: boolean) => {
        const length = active ? 2500 : 0;
        if (type === 'dotted') return active ? `1 15` : '1 15';
        if (type === 'dashed') return active ? `15 15` : '15 15';
        return active ? `${length} ${length}` : 'none';
    };

    const path0Props = useAnimatedProps(() => ({
        strokeDashoffset: interpolate(path0Progress.value, [0, 1], [2500, 0]),
        opacity: interpolate(path0Progress.value, [0, 0.1], [0, 1]),
    }));
    const path1Props = useAnimatedProps(() => ({
        strokeDashoffset: interpolate(path1Progress.value, [0, 1], [2500, 0]),
        opacity: interpolate(path1Progress.value, [0, 0.1], [0, 1]),
    }));
    const path2Props = useAnimatedProps(() => ({
        strokeDashoffset: interpolate(path2Progress.value, [0, 1], [2500, 0]),
        opacity: interpolate(path2Progress.value, [0, 0.1], [0, 1]),
    }));

    const anchor = { x: -12, y: -26 }; // Offset so the shadow is at the sharp tip
    const activeColor = isHovering ? styleDef.activePin : styleDef.activeFinalPin;

    const MapPin = ({ x, y, color, label }: { x: number, y: number, color: string, label: string }) => {
        let textY = '14'; // Higher up to sit in the bulk of the teardrop

        const isNewPin = label === 'X';
        const renderColor = isNewPin ? '#16a34a' : color;

        const shapeSvg = (
            <Svg width="24" height="30" viewBox="0 0 24 30">
                <Path d="M12 0C5.373 0 0 5.373 0 12c0 9 12 18 12 18s12-9 12-18c0-6.627-5.373-12-12-12z" fill={renderColor} />
            </Svg>
        );

        const animatedPinStyle = useAnimatedStyle(() => {
            const isNewPin = label === 'X';
            return {
                transform: [
                    { translateX: anchor.x },
                    { translateY: anchor.y + (isNewPin ? newPinFloatY.value : 0) },
                    { scale: isNewPin ? newPinScale.value : 1 }
                ],
            };
        });

        return (
            <Animated.View style={[styles.customPinWrapper, { left: `${(x / 400) * 100}%` as any, top: `${(y / 400) * 100}%` as any }, animatedPinStyle]}>
                {shapeSvg}
                {/* Visual Label (1, 2, 3, 4, X) in White */}
                <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'flex-start', paddingTop: parseInt(textY) - 10 }]}>
                    <Text style={{ color: '#ffffff', fontSize: isNewPin ? 13 : 11, fontWeight: '800' }}>{label}</Text>
                </View>
            </Animated.View>
        );
    };

    return (
        <View style={[styles.container, { backgroundColor: styleDef.bg }]} onLayout={handleLayout}>

            {/* Beautiful Abstract Map Background spreading entire container */}
            <View style={[StyleSheet.absoluteFill, { zIndex: 0 }]}>
                <Image
                    source={require('../../../assets/map_bg.png')}
                    style={{ width: '100%', height: '100%', opacity: 0.45 }}
                    resizeMode="cover"
                />
            </View>

            <Animated.View style={[styles.mapContent, cameraStyle, { width: mapCanvasSize, height: mapCanvasSize, zIndex: 1 }]}>

                <Svg width="100%" height="100%" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid meet" style={StyleSheet.absoluteFill}>

                    {/* Existing Base Booked Route */}
                    <Path d={baseBookedRoute} fill="none" stroke={styleDef.pathPossible} strokeWidth={styleDef.strokeWidthBg} strokeLinecap={styleDef.linecap} strokeLinejoin="round" />

                    {/* Active Route Tests (Blue for considered, Green for final) */}
                    <AnimatedPath
                        d={path0D}
                        fill="none"
                        stroke={styleDef.pathConsidered}
                        strokeWidth={styleDef.strokeWidthActive}
                        strokeLinecap={styleDef.linecap}
                        strokeLinejoin="round"
                        strokeDasharray={styleDef.lineStyle === 'solid' ? '2500 2500' : getStrokeArray(styleDef.lineStyle, true)}
                        animatedProps={path0Props as any}
                    />

                    <AnimatedPath
                        d={path1D}
                        fill="none"
                        stroke={styleDef.pathConsidered}
                        strokeWidth={styleDef.strokeWidthActive}
                        strokeLinecap={styleDef.linecap}
                        strokeLinejoin="round"
                        strokeDasharray={styleDef.lineStyle === 'solid' ? '2500 2500' : getStrokeArray(styleDef.lineStyle, true)}
                        animatedProps={path1Props as any}
                    />

                    <AnimatedPath
                        d={path2D}
                        fill="none"
                        stroke={animationState === 3 ? styleDef.pathFinal : styleDef.pathConsidered}
                        strokeWidth={styleDef.strokeWidthActive}
                        strokeLinecap={styleDef.linecap}
                        strokeLinejoin="round"
                        strokeDasharray={styleDef.lineStyle === 'solid' ? '2500 2500' : getStrokeArray(styleDef.lineStyle, true)}
                        animatedProps={path2Props as any}
                    />
                </Svg>

                <View style={styles.pinsWrapper}>
                    {/* The existing stable, numbered pins */}
                    <MapPin x={styleDef.p1.x} y={styleDef.p1.y} color={styleDef.inactivePin} label="1" />
                    <MapPin x={styleDef.p2.x} y={styleDef.p2.y} color={styleDef.inactivePin} label="2" />
                    <MapPin x={styleDef.p3.x} y={styleDef.p3.y} color={styleDef.inactivePin} label="3" />
                    <MapPin x={styleDef.p4.x} y={styleDef.p4.y} color={styleDef.inactivePin} label="4" />

                    {/* The new meeting is a stable node, permanently at np, colored to match the phase */}
                    <MapPin x={styleDef.np.x} y={styleDef.np.y} color={activeColor} label="X" />
                </View>
            </Animated.View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    mapContent: {
        position: 'relative',
        transformOrigin: 'center center',
    },
    pinsWrapper: {
        ...StyleSheet.absoluteFillObject,
    },
    customPinWrapper: {
        position: 'absolute',
    },
});
