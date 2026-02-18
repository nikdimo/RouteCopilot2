import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export type ViewMode = 'list' | 'timeline';

export default function ViewModeToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.segment, value === 'list' && styles.segmentActive]}
        onPress={() => onChange('list')}
        activeOpacity={0.8}
      >
        <Text style={[styles.segmentText, value === 'list' && styles.segmentTextActive]}>
          List
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.segment, value === 'timeline' && styles.segmentActive]}
        onPress={() => onChange('timeline')}
        activeOpacity={0.8}
      >
        <Text style={[styles.segmentText, value === 'timeline' && styles.segmentTextActive]}>
          Timeline
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#E8E8E8',
    borderRadius: 8,
    padding: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  segmentActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#605E5C',
  },
  segmentTextActive: {
    color: '#0078D4',
  },
});
