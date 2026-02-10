import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Calendar, Map, User, Code } from 'lucide-react-native';
import ScheduleStack from './ScheduleStack';
import MapScreen from '../screens/MapScreen';
import ProfileScreen from '../screens/ProfileScreen';
import DevDocsScreen from '../screens/DevDocsScreen';

const MS_BLUE = '#0078D4';

export type BottomTabParamList = {
  Schedule: undefined;
  Map: undefined;
  Profile: undefined;
  Dev: undefined;
};

const Tab = createBottomTabNavigator<BottomTabParamList>();

export default function AppNavigator() {
  return (
    <Tab.Navigator
      initialRouteName="Schedule"
      screenOptions={{
        headerStyle: { backgroundColor: MS_BLUE },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '600' },
        tabBarActiveTintColor: MS_BLUE,
        tabBarInactiveTintColor: '#94a3b8',
        tabBarStyle: { paddingBottom: 4, height: 56 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      <Tab.Screen
        name="Schedule"
        component={ScheduleStack}
        options={{
          title: 'Schedule',
          tabBarLabel: 'Schedule',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Calendar color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="Map"
        component={MapScreen}
        options={{
          title: 'Map',
          tabBarLabel: 'Map',
          tabBarIcon: ({ color, size }) => <Map color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          title: 'Profile',
          tabBarLabel: 'Profile',
          tabBarIcon: ({ color, size }) => <User color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Dev"
        component={DevDocsScreen}
        options={{
          title: 'Dev',
          tabBarLabel: 'Dev',
          tabBarIcon: ({ color, size }) => <Code color={color} size={size} />,
        }}
      />
    </Tab.Navigator>
  );
}
