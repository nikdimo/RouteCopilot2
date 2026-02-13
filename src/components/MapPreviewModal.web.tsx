import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import { X } from 'lucide-react-native';

export type MapPreviewModalProps = {
  visible: boolean;
  onClose: () => void;
  dayEvents: unknown[];
  insertionCoord: { lat: number; lon: number };
  slot: unknown;
  homeBase: { lat: number; lon: number };
};

export default function MapPreviewModal({
  visible,
  onClose,
}: MapPreviewModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.webPlaceholder}>
          <Text style={styles.placeholderText}>Map preview available on mobile</Text>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <X color="#fff" size={24} />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  closeBtn: {
    padding: 4,
  },
  webPlaceholder: {
    backgroundColor: '#323130',
    padding: 24,
    borderRadius: 12,
    margin: 16,
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 16,
    color: '#fff',
    marginBottom: 12,
  },
});
