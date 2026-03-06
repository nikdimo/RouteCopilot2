import React from 'react';
import { View, StyleSheet, Text, TouchableOpacity, useWindowDimensions } from 'react-native';
import { MockMap } from './MockMap';
import { MockSchedule } from './MockSchedule';
import { useIsWideScreen } from '../../hooks/useIsWideScreen';
import { useEmptyStateAnimation } from './useEmptyStateAnimation';
import { CalendarDays, X } from 'lucide-react-native';

type EmptyStateScannerProps = {
    onSignInAndSync?: () => void;
    ctaVisible?: boolean;
    onDismissCta?: () => void;
    animate?: boolean;
};

const CTA_STACK_BREAKPOINT = 560;

export const EmptyStateScanner = ({ onSignInAndSync, ctaVisible, onDismissCta, animate = true }: EmptyStateScannerProps) => {
    const { width, height } = useWindowDimensions();
    const animationState = useEmptyStateAnimation(animate);
    const isWideScreen = useIsWideScreen();
    const [internalCtaVisible, setInternalCtaVisible] = React.useState(true);
    const effectiveCtaVisible = ctaVisible ?? internalCtaVisible;
    const isCompactCta = !isWideScreen && width < CTA_STACK_BREAKPOINT;
    const isCompactHeight = !isWideScreen && height < 760;
    const portraitMapFlex = isCompactHeight ? 0.4 : 0.45;
    const portraitScheduleFlex = 1 - portraitMapFlex;

    const handleDismissCta = React.useCallback(() => {
        if (onDismissCta) {
            onDismissCta();
            return;
        }
        setInternalCtaVisible(false);
    }, [onDismissCta]);

    return (
        <View style={styles.outerContainer}>
            <View style={[styles.innerContainer, isWideScreen ? styles.landscapeContainer : styles.portraitContainer]}>
                {isWideScreen ? (
                    <>
                        <View style={styles.schedulePanel}>
                            <MockSchedule animationState={animationState} />
                        </View>
                        <View style={styles.mapPanel}>
                            <MockMap animationState={animationState} />
                        </View>
                    </>
                ) : (
                    <>
                        <View style={[styles.mapPanelMobile, { flex: portraitMapFlex }]}>
                            <MockMap animationState={animationState} />
                        </View>
                        <View
                            style={[
                                styles.schedulePanelMobile,
                                { flex: portraitScheduleFlex, marginTop: isCompactCta ? -12 : -18 },
                            ]}
                        >
                            <View style={styles.drawerHandleIndicator} />
                            <MockSchedule animationState={animationState} />
                        </View>
                    </>
                )}

                {/* Floating Onboarding CTA (Option 1) */}
                {effectiveCtaVisible && (
                    <View
                        style={[
                            styles.floatingCtaContainer,
                            isCompactCta && styles.floatingCtaContainerCompact,
                        ]}
                    >
                        <View
                            style={[
                                styles.floatingCtaInner,
                                isCompactCta && styles.floatingCtaInnerCompact,
                            ]}
                        >

                            <View style={[styles.ctaIconBadge, isCompactCta && styles.ctaIconBadgeCompact]}>
                                <CalendarDays size={20} color="#3b82f6" />
                            </View>

                            <View style={[styles.ctaTextContainer, isCompactCta && styles.ctaTextContainerCompact]}>
                                <Text style={[styles.ctaHeadline, isCompactCta && styles.ctaHeadlineCompact]}>Unlock Proactive Scheduling</Text>
                                <Text style={[styles.ctaSubtext, isCompactCta && styles.ctaSubtextCompact]}>Find the best slots for your upcoming meetings dynamically. Sync your calendar to start your free 30-day trial.</Text>
                            </View>

                            <TouchableOpacity style={[styles.ctaButton, isCompactCta && styles.ctaButtonCompact]} onPress={onSignInAndSync}>
                                <Text style={styles.ctaButtonText}>Sign In & Sync</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={styles.ctaCloseButton}
                                onPress={handleDismissCta}
                                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            >
                                <X size={16} color="#94a3b8" />
                            </TouchableOpacity>

                        </View>
                    </View>
                )}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    outerContainer: {
        flex: 1,
        backgroundColor: '#e2e8f0',
        alignItems: 'stretch',
        justifyContent: 'flex-start',
        padding: 0,
    },
    innerContainer: {
        flex: 1,
        backgroundColor: '#f8f9fa',
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.1,
        shadowRadius: 20,
        elevation: 10,
        maxWidth: 1200,
        width: '100%',
        borderRadius: 0,
    },
    landscapeContainer: {
        flexDirection: 'row',
        height: '100%',
    },
    schedulePanel: {
        flex: 0.42,
        borderRightWidth: 1,
        borderRightColor: '#e2e8f0',
    },
    mapPanel: {
        flex: 0.58,
    },
    portraitContainer: {
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        borderRadius: 0,
    },
    mapPanelMobile: {
        minHeight: 180,
    },
    schedulePanelMobile: {
        minHeight: 220,
        backgroundColor: '#fff',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 10,
    },
    drawerHandleIndicator: {
        width: 40,
        height: 4,
        backgroundColor: '#cbd5e1',
        borderRadius: 2,
        alignSelf: 'center',
        marginTop: 12,
        marginBottom: -20,
        zIndex: 10,
    },
    floatingCtaContainer: {
        position: 'absolute',
        bottom: 24,
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 100,
        paddingHorizontal: 16,
    },
    floatingCtaContainerCompact: {
        bottom: 16,
        paddingHorizontal: 12,
    },
    floatingCtaInner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        paddingVertical: 12,
        paddingLeft: 12,
        paddingRight: 40, // Space for close button
        borderRadius: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.15,
        shadowRadius: 24,
        elevation: 12,
        maxWidth: 700,
        width: '100%',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.5)',
    },
    floatingCtaInnerCompact: {
        flexDirection: 'column',
        alignItems: 'stretch',
        paddingRight: 12,
        borderRadius: 16,
        gap: 10,
    },
    ctaIconBadge: {
        width: 44,
        height: 44,
        borderRadius: 12,
        backgroundColor: '#eff6ff',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 16,
    },
    ctaIconBadgeCompact: {
        marginRight: 0,
        alignSelf: 'center',
    },
    ctaTextContainer: {
        flex: 1,
        marginRight: 16,
    },
    ctaTextContainerCompact: {
        marginRight: 0,
        alignItems: 'center',
    },
    ctaHeadline: {
        fontSize: 15,
        fontWeight: '700',
        color: '#1e293b',
        marginBottom: 4,
    },
    ctaHeadlineCompact: {
        textAlign: 'center',
    },
    ctaSubtext: {
        fontSize: 13,
        color: '#64748b',
        lineHeight: 18,
    },
    ctaSubtextCompact: {
        textAlign: 'center',
    },
    ctaButton: {
        backgroundColor: '#3b82f6',
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 12,
    },
    ctaButtonCompact: {
        alignSelf: 'center',
        minWidth: 170,
        alignItems: 'center',
    },
    ctaButtonText: {
        color: '#ffffff',
        fontSize: 14,
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
});
