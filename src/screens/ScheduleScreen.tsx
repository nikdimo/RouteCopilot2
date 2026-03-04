import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Layers } from 'lucide-react-native';

import ScheduleScreenNew from './ScheduleScreenNew';
import ScheduleScreenOld from './ScheduleScreenOld';

export default function ScheduleScreen() {
    const [showOldUI, setShowOldUI] = useState(false);

    return (
        <View style={styles.container}>
            {/* Conditionally render the entire UI tree */}
            {showOldUI ? <ScheduleScreenOld /> : <ScheduleScreenNew />}

            {/* Floating Toggle Button */}
            <TouchableOpacity
                style={styles.floatingToggle}
                activeOpacity={0.8}
                onPress={() => setShowOldUI((prev) => !prev)}
            >
                <Layers color="#fff" size={20} />
                <Text style={styles.toggleText}>
                    {showOldUI ? 'Switch to New UI' : 'Switch to Old UI'}
                </Text>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    floatingToggle: {
        position: 'absolute',
        bottom: 24,
        right: 24,
        backgroundColor: '#0F172A', // Dark pill bubble
        borderRadius: 24,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
        elevation: 8, // for Android
        gap: 8,
    },
    toggleText: {
        color: '#ffffff',
        fontWeight: '700',
        fontSize: 14,
    },
});
