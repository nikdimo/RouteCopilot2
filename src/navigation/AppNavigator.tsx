import React from 'react';
import { View, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Calendar, Map, User, Code, Plus } from 'lucide-react-native';
import ScheduleStack from './ScheduleStack';
import MapScreen from '../screens/MapScreen';
import ProfileScreen from '../screens/ProfileScreen';
import DevDocsScreen from '../screens/DevDocsScreen';

const MS_BLUE = '#0078D4';

export type BottomTabParamList = {
  Schedule: undefined;
  Map: undefined;
  Add: undefined;
  Profile: undefined;
  Dev: undefined;
};

const Tab = createBottomTabNavigator<BottomTabParamList>();

function AddPlaceholder() {
  return null;
}

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
        tabBarShowLabel: false,
        tabBarStyle: { paddingBottom: 4, height: 56 },
      }}
    >
      <Tab.Screen
        name="Schedule"
        component={ScheduleStack}
        options={{
          title: 'Schedule',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Calendar color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="Map"
        component={MapScreen}
        initialParams={{ triggerLoadWhenEmpty: true }}
        options={{
          title: 'Map',
          tabBarIcon: ({ color, size }) => <Map color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Add"
        component={AddPlaceholder}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate('Schedule', { screen: 'AddMeeting' });
          },
        })}
        options={{
          title: 'Add',
          tabBarIcon: () => (
            <View style={styles.addButton}>
              <Plus color="#fff" size={24} strokeWidth={2.5} />
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <User color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Dev"
        component={DevDocsScreen}
        options={{
          title: 'Dev',
          tabBarIcon: ({ color, size }) => <Code color={color} size={size} />,
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  addButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: MS_BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
