import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F8FAFC', // light slate background
    },
    content: {
        padding: 20,
        paddingBottom: 40,
        width: '100%',
        maxWidth: 700,
        alignSelf: 'center',
    },

    // Header
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24,
    },
    headerTitle: {
        fontSize: 28,
        fontWeight: '800',
        color: '#0F172A',
        marginBottom: 4,
    },
    planRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    planText: {
        fontSize: 14,
        color: '#64748B',
        marginLeft: 6,
        fontWeight: '500',
    },
    avatarPill: {
        width: 48,
        height: 48,
        borderRadius: 16,
        backgroundColor: '#EFF6FF',
        borderWidth: 2,
        borderColor: '#3B82F6',
        alignItems: 'center',
        justifyContent: 'center',
    },
    accountPill: {
        width: 'auto',
        maxWidth: 220,
        minHeight: 44,
        height: 44,
        borderRadius: 14,
        paddingHorizontal: 12,
    },
    avatarText: {
        fontSize: 18,
        fontWeight: '700',
        color: '#2563EB',
    },
    accountPillText: {
        fontSize: 12,
        fontWeight: '600',
    },

    // Banner
    bannerCard: {
        backgroundColor: '#2563EB', // Vibrant Blue
        borderRadius: 16,
        padding: 20,
        marginBottom: 24,
        overflow: 'hidden',
    },
    bannerPill: {
        backgroundColor: '#60A5FA40',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        alignSelf: 'flex-start',
        marginBottom: 12,
        flexDirection: 'row',
        alignItems: 'center',
    },
    bannerPillDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: '#34D399',
        marginLeft: 6,
    },
    bannerPillText: {
        color: '#FFFFFF',
        fontSize: 10,
        fontWeight: '700',
        letterSpacing: 0.5,
    },
    bannerTitle: {
        fontSize: 22,
        fontWeight: '700',
        color: '#FFFFFF',
        marginBottom: 8,
    },
    bannerSubtitle: {
        fontSize: 13,
        color: '#BFDBFE',
        lineHeight: 20,
        marginBottom: 16,
        maxWidth: '85%',
    },
    bannerButton: {
        backgroundColor: '#FFFFFF',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 20,
        alignSelf: 'flex-start',
    },
    bannerButtonText: {
        color: '#2563EB',
        fontWeight: '600',
        fontSize: 14,
    },

    // Sections
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
        marginTop: 8,
    },
    sectionIconBox: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 10,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#0F172A',
    },
    sectionCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 16,
        marginBottom: 24,
        borderWidth: 1,
        borderColor: '#F1F5F9',
    },

    // Smart Logistics specifically inside card
    formLabelTop: {
        fontSize: 11,
        fontWeight: '700',
        color: '#64748B',
        letterSpacing: 0.5,
        marginBottom: 4,
    },
    formRowBetween: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    formValueBold: {
        fontSize: 16,
        fontWeight: '600',
        color: '#0F172A',
    },
    changePill: {
        borderWidth: 1,
        borderColor: '#E2E8F0',
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingVertical: 4,
    },
    changePillText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#0F172A',
    },
    dashedBox: {
        borderWidth: 1,
        borderColor: '#CBD5E1',
        borderStyle: 'dashed',
        borderRadius: 12,
        padding: 12,
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 12,
        marginBottom: 20,
        backgroundColor: '#F8FAFC',
    },
    dashedBoxText: {
        fontSize: 13,
        color: '#475569',
        marginLeft: 8,
        flex: 1,
    },
    divider: {
        height: 1,
        backgroundColor: '#F1F5F9',
        marginVertical: 16,
    },

    toggleRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginVertical: 4,
    },
    toggleTextCol: {
        flex: 1,
        paddingRight: 16,
    },
    toggleTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: '#0F172A',
        marginBottom: 4,
        flexDirection: 'row',
        alignItems: 'center',
    },
    toggleSubtitle: {
        fontSize: 13,
        color: '#64748B',
        lineHeight: 18,
    },
    badgePill: {
        backgroundColor: '#EFF6FF',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 8,
        marginLeft: 8,
    },
    badgePillText: {
        fontSize: 9,
        fontWeight: '700',
        color: '#2563EB',
    },
    badgePillPro: {
        backgroundColor: '#6366F1', // Indigo
    },
    badgePillTextPro: {
        color: '#FFFFFF',
    },
    badgePillPremium: {
        backgroundColor: '#D946EF', // Fuchsia
    },

    // Buffer Intervals
    sliderLabelRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        marginBottom: 8,
    },
    sliderValueText: {
        fontSize: 20,
        fontWeight: '700',
        color: '#2563EB',
    },
    sliderValueUnit: {
        fontSize: 12,
        fontWeight: '600',
        color: '#64748B',
        marginBottom: 3,
    },
    sliderMarksRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: -8,
    },
    sliderMarkText: {
        fontSize: 10,
        fontWeight: '500',
        color: '#94A3B8',
    },
    sliderBlock: {
        marginBottom: 24,
    },
    rangeTrack: {
        width: '100%',
        backgroundColor: '#E2E8F0',
        borderRadius: 4,
        position: 'relative',
    },
    rangeFill: {
        backgroundColor: '#2563EB',
        borderRadius: 4,
        top: 0,
    },
    rangeThumb: {
        backgroundColor: '#FFFFFF',
        borderWidth: 2,
        borderColor: '#2563EB',
    },

    // Footer Items
    footerLinkCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 16,
        marginBottom: 24,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#F1F5F9',
    },
    footerLinkText: {
        fontSize: 15,
        fontWeight: '600',
        color: '#334155',
        marginLeft: 12,
    },
    signOutButton: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 8,
        marginBottom: 24,
    },
    signOutText: {
        color: '#EF4444', // Red
        fontWeight: '600',
        fontSize: 15,
        marginLeft: 8,
    },
    deleteAccountButton: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#B91C1C',
        borderRadius: 12,
        paddingVertical: 12,
        marginBottom: 20,
    },
    deleteAccountText: {
        color: '#FFFFFF',
        fontWeight: '700',
        fontSize: 14,
        marginLeft: 8,
    },
    versionBox: {
        alignItems: 'center',
        marginBottom: 40,
    },
    versionTitle: {
        fontSize: 11,
        fontWeight: '700',
        color: '#94A3B8',
        letterSpacing: 1,
        marginBottom: 4,
    },
    versionSubtitle: {
        fontSize: 11,
        color: '#94A3B8',
    },

    // Working Days ( retained functionality )
    workingDaysRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 8,
    },
    dayPill: {
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        backgroundColor: '#F1F5F9',
        minWidth: 40,
        alignItems: 'center',
    },
    dayPillActive: {
        backgroundColor: '#2563EB',
    },
    dayPillText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#64748B',
    },
    dayPillTextActive: {
        color: '#FFFFFF',
    },
});
