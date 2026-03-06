import React, { useEffect } from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    withSequence,
    withRepeat,
    withDelay,
    Easing,
    cancelAnimation
} from 'react-native-reanimated';
import { CheckCircle2 } from 'lucide-react-native';

interface MockScheduleProps {
    animationState: number; // 0=Gap1, 1=Gap2, 2=Gap3, 3=Gap3(Locked)
}

const EXISTING_MEETINGS = [
    { id: 'm1', time: '09:00', endTime: '10:00', title: 'Client A (Ringsted)' },
    { id: 'm2', time: '12:00', endTime: '13:00', title: 'Client B (Slagelse)' },
    { id: 'm3', time: '14:30', endTime: '15:30', title: 'Client C (Næstved)' },
    { id: 'm4', time: '16:00', endTime: '17:00', title: 'Client D (Køge)' },
];

const BASE_CARD_HEIGHT = 64;
const COMPACT_CARD_HEIGHT = 54;
const BASE_GAP = 8;
const COMPACT_GAP = 6;

export const MockSchedule: React.FC<MockScheduleProps> = ({ animationState }) => {
    const { width, height } = useWindowDimensions();
    const isCompact = width < 430 || height < 760;
    const cardHeight = isCompact ? COMPACT_CARD_HEIGHT : BASE_CARD_HEIGHT;
    const gap = isCompact ? COMPACT_GAP : BASE_GAP;
    const cardStep = cardHeight + gap;

    // Physical Y positions for the 4 existing meetings
    const m1Y = useSharedValue(0);
    const m2Y = useSharedValue(cardStep);
    const m3Y = useSharedValue(cardStep * 2);
    const m4Y = useSharedValue(cardStep * 3);

    // Initialize physical Y position for the floating new meeting directly at Gap 1 so it doesn't "drop" from 0
    const newMY = useSharedValue(cardStep);
    const newMScale = useSharedValue(1);
    const hoverFloat = useSharedValue(0);

    const isLocked = animationState === 3;

    useEffect(() => {
        // Base positions without the new meeting inserted
        const p1 = 0;
        const p2 = cardStep;
        const p3 = cardStep * 2;
        const p4 = cardStep * 3;
        const insertOffset = cardStep;

        const timingConfig = { duration: 600, easing: Easing.inOut(Easing.ease) };

        // Continuous hover effect if not locked
        if (!isLocked) {
            hoverFloat.value = withRepeat(
                withSequence(
                    withTiming(-6, { duration: 400 }),
                    withTiming(6, { duration: 400 })
                ),
                -1,
                true
            );
            newMScale.value = withTiming(1.02, { duration: 300 }); // pop out slightly when floating
        } else {
            cancelAnimation(hoverFloat);
            hoverFloat.value = withTiming(0, { duration: 300 });
            newMScale.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.back(2)) }); // lock in
        }
        const transitionConfig = isLocked ? { duration: 300, easing: Easing.out(Easing.ease) } : timingConfig;

        if (animationState === 0) {
            // Testing Gap 1 (Between m1 and m2)
            m1Y.value = withTiming(p1, transitionConfig);
            // shift remaining down
            m2Y.value = withTiming(p2 + insertOffset, transitionConfig);
            m3Y.value = withTiming(p3 + insertOffset, transitionConfig);
            m4Y.value = withTiming(p4 + insertOffset, transitionConfig);

            newMY.value = withTiming(p2, transitionConfig);

        } else if (animationState === 1) {
            // Testing Gap 2 (Between m2 and m3)
            m1Y.value = withTiming(p1, transitionConfig);
            m2Y.value = withTiming(p2, transitionConfig);
            // shift remaining down
            m3Y.value = withTiming(p3 + insertOffset, transitionConfig);
            m4Y.value = withTiming(p4 + insertOffset, transitionConfig);

            newMY.value = withTiming(p3, transitionConfig);

        } else if (animationState === 2 || animationState === 3) {
            // Testing & Locking Gap 3 (Between m3 and m4) - The Optimal Match
            m1Y.value = withTiming(p1, transitionConfig);
            m2Y.value = withTiming(p2, transitionConfig);
            m3Y.value = withTiming(p3, transitionConfig);
            // shift remaining down
            m4Y.value = withTiming(p4 + insertOffset, transitionConfig);

            newMY.value = withTiming(p4, transitionConfig);
        }

    }, [animationState, cardStep, isLocked, hoverFloat, m1Y, m2Y, m3Y, m4Y, newMScale, newMY]);

    const m1Style = useAnimatedStyle(() => ({ transform: [{ translateY: m1Y.value }] }));
    const m2Style = useAnimatedStyle(() => ({ transform: [{ translateY: m2Y.value }] }));
    const m3Style = useAnimatedStyle(() => ({ transform: [{ translateY: m3Y.value }] }));
    const m4Style = useAnimatedStyle(() => ({ transform: [{ translateY: m4Y.value }] }));

    const newMStyle = useAnimatedStyle(() => ({
        transform: [
            { translateY: newMY.value + hoverFloat.value },
            { scale: newMScale.value }
        ],
        zIndex: isLocked ? 1 : 10,
        shadowOpacity: isLocked ? 0 : 0.15,
    }));

    const detourText =
        animationState === 0 ? '+45m detour' :
            animationState === 1 ? '+32m detour' :
                '+5m detour';

    const newMeetingTime = animationState === 0 ? '10:30' : animationState === 1 ? '13:15' : '16:15';
    const newMeetingEndTime = animationState === 0 ? '11:30' : animationState === 1 ? '14:15' : '17:15';

    const ExistingCard = ({ meet, style }: { meet: any, style: any }) => (
        <Animated.View style={[styles.card, isCompact && styles.cardCompact, { height: cardHeight }, styles.existingCard, style]}>
            <View style={[styles.timeColumn, isCompact && styles.timeColumnCompact]}>
                <Text style={[styles.timeText, isCompact && styles.timeTextCompact]}>{meet.time}</Text>
                <Text style={[styles.timeTextSub, isCompact && styles.timeTextSubCompact]}>{meet.endTime}</Text>
            </View>
            <View style={styles.infoColumn}>
                <Text style={[styles.title, isCompact && styles.titleCompact]}>{meet.title}</Text>
                <Text style={[styles.subtitle, isCompact && styles.subtitleCompact]}>Existing Meeting</Text>
            </View>
        </Animated.View>
    );

    return (
        <View style={styles.container}>
            <View style={[styles.header, isCompact && styles.headerCompact]}>
                <Text style={[styles.headerTitle, isCompact && styles.headerTitleCompact]}>Calculating Route Options</Text>
                <Text style={[styles.headerSubtitle, isCompact && styles.headerSubtitleCompact]}>Evaluating gaps for optimum fit...</Text>
            </View>

            <View style={[styles.listContainer, isCompact && styles.listContainerCompact]}>
                <ExistingCard meet={EXISTING_MEETINGS[0]} style={m1Style} />
                <ExistingCard meet={EXISTING_MEETINGS[1]} style={m2Style} />
                <ExistingCard meet={EXISTING_MEETINGS[2]} style={m3Style} />
                <ExistingCard meet={EXISTING_MEETINGS[3]} style={m4Style} />

                {/* The Floating New Meeting Card */}
                <Animated.View style={[styles.card, isCompact && styles.cardCompact, { height: cardHeight }, styles.newCard, isLocked && styles.newCardLocked, newMStyle]}>
                    <View style={[styles.timeColumn, isCompact && styles.timeColumnCompact]}>
                        <Text style={[styles.timeText, isCompact && styles.timeTextCompact, styles.newTimeText, isLocked && styles.newTimeLocked]}>{newMeetingTime}</Text>
                        <Text style={[styles.timeTextSub, isCompact && styles.timeTextSubCompact, styles.newTimeSub, isLocked && styles.newTimeLocked]}>{newMeetingEndTime}</Text>
                    </View>
                    <View style={styles.infoColumn}>
                        <View style={styles.badgeRow}>
                            {isLocked ? (
                                <View style={[styles.badge, styles.badgeSuccess]}>
                                    <Text style={[styles.badgeTextSuccess, isCompact && styles.badgeTextCompact]}>BEST MATCH</Text>
                                </View>
                            ) : (
                                <View style={[styles.badge, styles.badgeEvaluating]}>
                                    <Text style={[styles.badgeTextEvaluating, isCompact && styles.badgeTextCompact]}>EVALUATING</Text>
                                </View>
                            )}
                            <Text style={[styles.detourText, isCompact && styles.detourTextCompact, { color: isLocked ? '#15803d' : '#0369a1' }]}>
                                {detourText}
                            </Text>
                        </View>
                        <Text style={[styles.title, isCompact && styles.titleCompact, styles.newTitle, isLocked && styles.newTitleLocked]}>New Prospect</Text>
                    </View>
                    {isLocked && (
                        <View style={styles.iconContainer}>
                            <CheckCircle2 color="#22c55e" size={isCompact ? 20 : 24} />
                        </View>
                    )}
                </Animated.View>

            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8fafc',
    },
    header: {
        padding: 16,
        paddingBottom: 12,
    },
    headerCompact: {
        paddingHorizontal: 12,
        paddingTop: 12,
        paddingBottom: 8,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#0f172a',
    },
    headerTitleCompact: {
        fontSize: 16,
    },
    headerSubtitle: {
        fontSize: 12,
        color: '#64748b',
        marginTop: 2,
    },
    headerSubtitleCompact: {
        fontSize: 11,
    },
    listContainer: {
        flex: 1,
        position: 'relative',
        marginHorizontal: 16,
    },
    listContainerCompact: {
        marginHorizontal: 12,
    },
    card: {
        position: 'absolute',
        left: 0,
        right: 0,
        flexDirection: 'row',
        borderRadius: 12,
        padding: 10,
    },
    cardCompact: {
        borderRadius: 10,
        padding: 8,
    },
    existingCard: {
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#e2e8f0',
        zIndex: 2,
    },
    newCard: {
        backgroundColor: '#e0f2fe', // Very light blue background
        borderWidth: 2,
        borderColor: '#38bdf8', // Light blue frame
        borderStyle: 'dotted', // Dotted frame
        shadowColor: '#0ea5e9',
        shadowOffset: { width: 0, height: 8 },
        shadowRadius: 12,
        elevation: 8,
    },
    newCardLocked: {
        backgroundColor: '#f0fdf4', // Light green
        borderColor: '#4ade80', // Green border
        borderStyle: 'solid', // Solid lock
        borderWidth: 2,
        shadowOpacity: 0,
        elevation: 2,
    },
    timeColumn: {
        width: 44,
        marginRight: 10,
        alignItems: 'center',
        justifyContent: 'center',
        borderRightWidth: 1,
        borderRightColor: '#f1f5f9',
        paddingRight: 10,
    },
    timeColumnCompact: {
        width: 40,
        marginRight: 8,
        paddingRight: 8,
    },
    timeText: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#475569',
    },
    timeTextCompact: {
        fontSize: 11,
    },
    timeTextSub: {
        fontSize: 11,
        color: '#94a3b8',
        marginTop: 1,
    },
    timeTextSubCompact: {
        fontSize: 10,
    },
    newTimeText: { color: '#0284c7' },
    newTimeSub: { color: '#38bdf8' },
    newTimeLocked: { color: '#16a34a' },
    infoColumn: {
        flex: 1,
        justifyContent: 'center',
    },
    title: {
        fontSize: 13,
        fontWeight: '700',
        color: '#1e293b',
    },
    titleCompact: {
        fontSize: 12,
    },
    newTitle: { color: '#0369a1' },
    newTitleLocked: { color: '#14532d' },
    subtitle: {
        fontSize: 11,
        color: '#64748b',
        marginTop: 1,
    },
    subtitleCompact: {
        fontSize: 10,
    },
    badgeRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4,
    },
    badge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    badgeEvaluating: {
        backgroundColor: '#bae6fd',
    },
    badgeSuccess: {
        backgroundColor: '#22c55e',
    },
    badgeTextEvaluating: {
        fontSize: 9,
        fontWeight: '800',
        color: '#0284c7',
        letterSpacing: 0.5,
    },
    badgeTextSuccess: {
        fontSize: 9,
        fontWeight: '800',
        color: '#ffffff',
        letterSpacing: 0.5,
    },
    detourText: {
        fontSize: 12,
        fontWeight: '900',
        letterSpacing: -0.2,
    },
    badgeTextCompact: {
        fontSize: 8,
    },
    detourTextCompact: {
        fontSize: 11,
    },
    iconContainer: {
        justifyContent: 'center',
        paddingLeft: 8,
    }
});
