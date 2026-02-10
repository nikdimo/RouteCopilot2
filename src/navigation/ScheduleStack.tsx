import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ScheduleScreen from '../screens/ScheduleScreen';
import AddMeetingScreen from '../screens/AddMeetingScreen';

const MS_BLUE = '#0078D4';

export type ScheduleStackParamList = {
  ScheduleHome: undefined;
  AddMeeting: undefined;
};

const Stack = createNativeStackNavigator<ScheduleStackParamList>();

export default function ScheduleStack() {
  return (
    <Stack.Navigator
      initialRouteName="ScheduleHome"
      screenOptions={{
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
    </Stack.Navigator>
  );
}
