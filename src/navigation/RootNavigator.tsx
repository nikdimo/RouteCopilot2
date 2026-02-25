import React, { useEffect } from 'react';
import { Platform, View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useAuth } from '../context/AuthContext';
import LoginScreen from '../screens/LoginScreen';
import AppNavigator from './AppNavigator';
import SelectedDateSync from '../components/SelectedDateSync';

export default function RootNavigator() {
  const { userToken, isRestoringSession } = useAuth();

  useEffect(() => {
    if (Platform.OS !== 'web') {
      SplashScreen.hideAsync();
    }
  }, []);

  // Today's appointments: SelectedDateSync is the single source (no duplicate load from here).
  // ScheduleScreen shows its own inline spinner via appointmentsLoading from RouteContext.

  if (isRestoringSession) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#0078D4" />
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  if (!userToken) {
    return <LoginScreen />;
  }

  return (
    <>
      <SelectedDateSync />
      <AppNavigator />
    </>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: '#F3F2F1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: '#605E5C',
  },
});
