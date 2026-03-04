import React from 'react';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { MockMap } from './MockMap';
import { MockSchedule } from './MockSchedule';
import { useIsWideScreen } from '../../hooks/useIsWideScreen';
import { useEmptyStateAnimation } from './useEmptyStateAnimation';
import { CalendarDays, X } from 'lucide-react-native';

type EmptyStateScannerProps = {
    onSignInAndSync?: () => void;
};

export const EmptyStateScanner = ({ onSignInAndSync }: EmptyStateScannerProps) => {
    const animationState = useEmptyStateAnimation(true);
    const isWideScreen = useIsWideScreen();
    const [ctaVisible, setCtaVisible] = React.useState(true);

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
                        <View style={styles.mapPanelMobile}>
                            <MockMap animationState={animationState} />
                        </View>
                        <View style={styles.schedulePanelMobile}>
                            <View style={styles.drawerHandleIndicator} />
                            <MockSchedule animationState={animationState} />
                        </View>
                    </>
                )}

                {/* Floating Onboarding CTA (Option 1) */}
                {ctaVisible && (
                    <View style={styles.floatingCtaContainer}>
                        <View style={styles.floatingCtaInner}>

                            <View style={styles.ctaIconBadge}>
                                <CalendarDays size={20} color="#3b82f6" />
                            </View>

                            <View style={styles.ctaTextContainer}>
                                <Text style={styles.ctaHeadline}>Unlock Proactive Scheduling</Text>
                                <Text style={styles.ctaSubtext}>Find the best slots for your upcoming meetings dynamically. Sync your calendar to start your free 30-day trial.</Text>
                            </View>

                            <TouchableOpacity style={styles.ctaButton} onPress={onSignInAndSync}>
                                <Text style={styles.ctaButtonText}>Sign In & Sync</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={styles.ctaCloseButton}
                                onPress={() => setCtaVisible(false)}
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
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
    },
    innerContainer: {
        backgroundColor: '#f8f9fa',
        borderRadius: 24,
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
        height: '90%',
        minHeight: 600,
    },
    schedulePanel: {
        flex: 0.4,
        borderRightWidth: 1,
        borderRightColor: '#e2e8f0',
    },
    mapPanel: {
        flex: 0.6,
    },
    portraitContainer: {
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        borderRadius: 0,
    },
    mapPanelMobile: {
        flex: 0.5,
    },
    schedulePanelMobile: {
        flex: 0.5,
        backgroundColor: '#fff',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        marginTop: -20,
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
        padding: 0,
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
    ctaIconBadge: {
        width: 44,
        height: 44,
        borderRadius: 12,
        backgroundColor: '#eff6ff',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 16,
    },
    ctaTextContainer: {
        flex: 1,
        marginRight: 16,
    },
    ctaHeadline: {
        fontSize: 15,
        fontWeight: '700',
        color: '#1e293b',
        marginBottom: 4,
    },
    ctaSubtext: {
        fontSize: 13,
        color: '#64748b',
        lineHeight: 18,
    },
    ctaButton: {
        backgroundColor: '#3b82f6',
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 12,
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

