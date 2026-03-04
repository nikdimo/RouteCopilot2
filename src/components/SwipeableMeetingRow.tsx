import React, { useRef, memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Platform, Linking } from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { Trash2, Edit2, PhoneCall, Navigation } from 'lucide-react-native';
import MeetingCard, { type MeetingCardProps } from './MeetingCard';

const RED = '#EF4444'; // Modern Red
const BLUE = '#2563EB'; // Vibrant Blue

export type SwipeableMeetingRowProps = MeetingCardProps & {
  /** Called when user confirms delete */
  onDelete: () => void;
  /** Toggles edit screen; swipe right to reveal Edit action */
  onEdit?: () => void;
};

function SwipeableMeetingRow({
  onDelete,
  onEdit,
  onPress,
  ...cardProps
}: SwipeableMeetingRowProps) {
  const didDragRef = useRef(false);

  // When card is tapped, if we weren't just dragging, fire the tap (which now Highlights on map!)
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

  const handleEditPress = (swipeable: { close: () => void }) => {
    swipeable.close();
    onEdit?.();
  };

  // Right Swipe = Delete (Red)
  const renderRightActions = (
    _progress: unknown,
    _drag: unknown,
    swipeable: { close: () => void }
  ) => (
    <View style={styles.actionContainerRight}>
      <TouchableOpacity
        style={styles.deleteAction}
        onPress={() => handleDeletePress(swipeable)}
        activeOpacity={0.8}
      >
        <Trash2 color="#fff" size={24} />
        <Text style={styles.actionText}>Delete</Text>
      </TouchableOpacity>
    </View>
  );

  // Left Swipe = Contact, Navigate, Edit Details menu
  const renderLeftActions = (
    _progress: unknown,
    _drag: unknown,
    swipeable: { close: () => void }
  ) => {
    if (!onEdit) return null;
    const hasPhone = cardProps.phone != null && cardProps.phone.trim() !== '';

    return (
      <View style={styles.actionContainerLeft}>
        {cardProps.onNavigate && (
          <TouchableOpacity
            style={[styles.leftMenuAction, { backgroundColor: '#E2E8F0' }]}
            onPress={() => {
              swipeable.close();
              cardProps.onNavigate?.();
            }}
            activeOpacity={0.8}
          >
            <Navigation color="#1E293B" size={24} />
            <Text style={[styles.actionText, { color: '#1E293B' }]}>Route</Text>
          </TouchableOpacity>
        )}

        {hasPhone && (
          <TouchableOpacity
            style={[styles.leftMenuAction, { backgroundColor: '#E2E8F0' }]}
            onPress={() => {
              swipeable.close();
              Linking.openURL(`tel:${cardProps.phone!.trim()}`);
            }}
            activeOpacity={0.8}
          >
            <PhoneCall color="#1E293B" size={24} />
            <Text style={[styles.actionText, { color: '#1E293B' }]}>Call</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.leftMenuAction, { backgroundColor: BLUE }]}
          onPress={() => handleEditPress(swipeable)}
          activeOpacity={0.8}
        >
          <Edit2 color="#fff" size={24} />
          <Text style={styles.actionText}>Edit</Text>
        </TouchableOpacity>
      </View>
    );
  };

  // On web, Swipeable breaks all click events - use regular card instead
  if (Platform.OS === 'web') {
    return <MeetingCard {...cardProps} onPress={handleCardPress} />;
  }

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
  actionContainerRight: {
    paddingLeft: 74, // Matches the timelineCol + nodeCol width offset from MeetingCard
    marginBottom: 8,
  },
  actionContainerLeft: {
    paddingLeft: 74,
    marginBottom: 8,
    flexDirection: 'row',
    gap: 8,
    marginRight: 12,
  },
  deleteAction: {
    backgroundColor: RED,
    justifyContent: 'center',
    alignItems: 'center',
    width: 90,
    height: '100%',
    borderRadius: 16,
    marginLeft: 12,
  },
  leftMenuAction: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 70,
    height: '100%',
    borderRadius: 16,
  },
  actionText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 6,
  },
});
