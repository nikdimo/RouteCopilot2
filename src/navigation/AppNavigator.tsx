import React, { Suspense } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Calendar, Map, User, Code, Plus } from 'lucide-react-native';
import Constants from 'expo-constants';
import ScheduleStack from './ScheduleStack';
import ProfileScreen from '../screens/ProfileScreen';
import DevDocsScreen from '../screens/DevDocsScreen';

const MS_BLUE = '#0078D4';
const isExpoGo = Constants.appOwnership === 'expo';

// Lazy-load MapScreen so react-native-maps is only loaded when Map tab is opened (and not in Expo Go)
const MapScreen = React.lazy(() => import('../screens/MapScreen'));

function MapScreenWithSuspense(props: React.ComponentProps<typeof MapScreen>) {
  return (
    <Suspense
      fallback={
        <View style={[styles.loadingContainer, { backgroundColor: '#f8fafc' }]}>
          <ActivityIndicator size="large" color={MS_BLUE} />
        </View>
      }
    >
      <MapScreen {...props} />
    </Suspense>
  );
}

/** Shown in Expo Go only – avoids loading react-native-maps (RNMapsAirModule not in Expo Go) */
function MapExpoGoPlaceholder() {
  return (
    <View style={[styles.loadingContainer, { backgroundColor: '#f8fafc' }]}>
      <Text style={styles.placeholderTitle}>Map</Text>
      <Text style={styles.placeholderText}>
        The map is available in the development build (EAS Build / TestFlight).
      </Text>
      <Text style={styles.placeholderSubtext}>
        Use Schedule and other tabs as usual in Expo Go.
      </Text>
    </View>
  );
}

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
      lazy={true}
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
        component={isExpoGo ? MapExpoGoPlaceholder : MapScreenWithSuspense}
        initialParams={isExpoGo ? undefined : { triggerLoadWhenEmpty: true }}
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  placeholderText: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  placeholderSubtext: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 8,
    paddingHorizontal: 24,
  },
  addButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: MS_BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
