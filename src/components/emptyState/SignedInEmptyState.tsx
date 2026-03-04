import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ImageBackground } from 'react-native';
import { CalendarX2, Map } from 'lucide-react-native';

export const SignedInEmptyStateLeft = ({ onAddMeeting }: { onAddMeeting: () => void }) => {
    return (
        <View style={leftStyles.container}>
            <View style={leftStyles.iconWrapper}>
                <CalendarX2 size={40} color="#94a3b8" />
            </View>
            <Text style={leftStyles.title}>No meeting scheduled</Text>
            <Text style={leftStyles.subtitle}>
                There are no stops or meetings planned for this date. Take a break or add a new meeting!
            </Text>
            <TouchableOpacity style={leftStyles.button} onPress={onAddMeeting} activeOpacity={0.8}>
                <Text style={leftStyles.buttonText}>Create New Meeting</Text>
            </TouchableOpacity>
        </View>
    );
};

export const SignedInEmptyStateRight = () => {
    return (
        <View style={rightStyles.container}>
            {/* Background Grid Lines & Abstract Route SVG can go here */}
            {/* For now, a subtle background representing the map module */}

            <View style={rightStyles.card}>
                <View style={rightStyles.iconWrapper}>
                    <Map size={32} color="#ffffff" />
                </View>
                <Text style={rightStyles.title}>Interactive Map View</Text>
                <Text style={rightStyles.subtitle}>
                    This area will display the real-time route plotting, traffic data, and interactive location pins.
                </Text>
                <View style={rightStyles.badge}>
                    <Text style={rightStyles.badgeText}>Map Module Pending</Text>
                </View>
            </View>
        </View>
    );
};

const leftStyles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#ffffff',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
    },
    iconWrapper: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: '#f1f5f9',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 24,
    },
    title: {
        fontSize: 22,
        fontWeight: '800',
        color: '#0f172a',
        marginBottom: 12,
        textAlign: 'center',
    },
    subtitle: {
        fontSize: 15,
        color: '#64748b',
        textAlign: 'center',
        lineHeight: 22,
        marginBottom: 32,
        maxWidth: 300,
    },
    button: {
        backgroundColor: '#3b82f6',
        paddingVertical: 14,
        paddingHorizontal: 32,
        borderRadius: 12,
        shadowColor: '#3b82f6',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 4,
    },
    buttonText: {
        color: '#ffffff',
        fontSize: 15,
        fontWeight: '700',
    },
});

const rightStyles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8fafc',
        justifyContent: 'center',
        alignItems: 'center',
        // Optional subtle grid image
        // backgroundImage: 'url("data:image/svg+xml,...")',
    },
    card: {
        backgroundColor: '#ffffff',
        borderRadius: 24,
        padding: 40,
        alignItems: 'center',
        maxWidth: 400,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 20 },
        shadowOpacity: 0.05,
        shadowRadius: 32,
        elevation: 10,
        borderWidth: 1,
        borderColor: '#f1f5f9',
    },
    iconWrapper: {
        width: 64,
        height: 64,
        borderRadius: 20,
        backgroundColor: '#3b82f6',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 24,
        shadowColor: '#3b82f6',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.3,
        shadowRadius: 16,
        elevation: 8,
    },
    title: {
        fontSize: 20,
        fontWeight: '800',
        color: '#0f172a',
        marginBottom: 12,
        textAlign: 'center',
    },
    subtitle: {
        fontSize: 14,
        color: '#64748b',
        textAlign: 'center',
        lineHeight: 22,
        marginBottom: 32,
    },
    badge: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: '#eff6ff',
        borderRadius: 20,
    },
    badgeText: {
        color: '#3b82f6',
        fontSize: 13,
        fontWeight: '700',
    },
});
