import React, { useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { Trash2 } from 'lucide-react-native';
import MeetingCard, { type MeetingCardProps } from './MeetingCard';

const RED = '#D13438';

export type SwipeableMeetingRowProps = MeetingCardProps & {
  /** Called when user confirms delete */
  onDelete: () => void;
};

export default function SwipeableMeetingRow({
  onDelete,
  onPress,
  ...cardProps
}: SwipeableMeetingRowProps) {
  const didDragRef = useRef(false);

  const handleCardPress = () => {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    onPress?.();
  };

  const handleDeletePress = (swipeable: { close: () => void }) => {
    swipeable.close();
    Alert.alert(
      'Delete meeting',
      'Are you sure? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: onDelete },
      ]
    );
  };

  const renderRightActions = (
    _progress: unknown,
    _drag: unknown,
    swipeable: { close: () => void }
  ) => (
    <TouchableOpacity
      style={styles.deleteAction}
      onPress={() => handleDeletePress(swipeable)}
      activeOpacity={0.8}
    >
      <Trash2 color="#fff" size={22} />
      <Text style={styles.deleteActionText}>Delete</Text>
    </TouchableOpacity>
  );

  return (
    <Swipeable
      renderRightActions={renderRightActions}
      friction={2}
      rightThreshold={80}
      onSwipeableOpenStartDrag={() => {
        didDragRef.current = true;
      }}
      onSwipeableClose={() => {
        didDragRef.current = false;
      }}
    >
      <MeetingCard {...cardProps} onPress={handleCardPress} />
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  deleteAction: {
    backgroundColor: RED,
    justifyContent: 'center',
    alignItems: 'center',
    width: 90,
    marginBottom: 12,
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
  },
  deleteActionText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
});
