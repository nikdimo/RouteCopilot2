import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ScheduleScreen from '../screens/ScheduleScreen';
import AddMeetingScreen from '../screens/AddMeetingScreen';
import FindSlotScreen from '../screens/FindSlotScreen';
import MeetingDetailsScreen from '../screens/MeetingDetailsScreen';

const MS_BLUE = '#0078D4';

export type ScheduleStackParamList = {
  ScheduleHome: undefined;
  AddMeeting: undefined;
  FindSlot: {
    newLocation?: { lat: number; lon: number };
    durationMinutes?: number;
  };
  MeetingDetails: {
    eventId: string;
  };
};

const Stack = createNativeStackNavigator<ScheduleStackParamList>();

export default function ScheduleStack() {
  return (
    <Stack.Navigator
      initialRouteName="ScheduleHome"
      screenOptions={{
        headerShown: false,
        headerStyle: { backgroundColor: MS_BLUE },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <Stack.Screen
        name="ScheduleHome"
        component={ScheduleScreen}
        options={{ title: "Today's Route" }}
      />
      <Stack.Screen
        name="AddMeeting"
        component={AddMeetingScreen}
        options={{
          title: 'Plan Visit',
          headerBackTitle: 'Back',
        }}
      />
      <Stack.Screen
        name="FindSlot"
        component={FindSlotScreen}
        options={{
          title: 'Find Slot',
          headerBackTitle: 'Back',
        }}
      />
      <Stack.Screen
        name="MeetingDetails"
        component={MeetingDetailsScreen}
        options={{
          title: 'Meeting details',
          headerBackTitle: 'Back',
        }}
      />
    </Stack.Navigator>
  );
}
