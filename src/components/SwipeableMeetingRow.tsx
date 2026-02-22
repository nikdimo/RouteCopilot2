import React, { useRef, memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { Trash2, Check } from 'lucide-react-native';
import MeetingCard, { type MeetingCardProps } from './MeetingCard';

const RED = '#D13438';
const GREEN = '#107C10';

export type SwipeableMeetingRowProps = MeetingCardProps & {
  /** Called when user confirms delete */
  onDelete: () => void;
  /** Toggles done state; swipe left to reveal Complete action */
  onToggleDone?: () => void;
};

function SwipeableMeetingRow({
  onDelete,
  onToggleDone,
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

  const handleCompletePress = (swipeable: { close: () => void }) => {
    swipeable.close();
    onToggleDone?.();
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

  const renderLeftActions = (
    _progress: unknown,
    _drag: unknown,
    swipeable: { close: () => void }
  ) =>
    onToggleDone ? (
      <TouchableOpacity
        style={styles.completeAction}
        onPress={() => handleCompletePress(swipeable)}
        activeOpacity={0.8}
      >
        <Check color="#fff" size={22} strokeWidth={3} />
        <Text style={styles.completeActionText}>Complete</Text>
      </TouchableOpacity>
    ) : null;

  return (
    <Swipeable
      renderRightActions={renderRightActions}
      renderLeftActions={renderLeftActions}
      friction={2}
      rightThreshold={80}
      leftThreshold={80}
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

export default memo(SwipeableMeetingRow);

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
  completeAction: {
    backgroundColor: GREEN,
    justifyContent: 'center',
    alignItems: 'center',
    width: 90,
    marginBottom: 12,
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
  },
  completeActionText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
});
