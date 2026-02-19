import React, { useEffect, useState } from 'react';
import { Platform, View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useAuth } from '../context/AuthContext';
import { useLoadAppointmentsForDate } from '../hooks/useLoadAppointmentsForDate';
import LoginScreen from '../screens/LoginScreen';
import AppNavigator from './AppNavigator';
import SelectedDateSync from '../components/SelectedDateSync';

export default function RootNavigator() {
  const { userToken, isRestoringSession } = useAuth();
  const { load } = useLoadAppointmentsForDate(undefined);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      SplashScreen.hideAsync();
    }
  }, []);

  // When we get a token, run initial appointments load once; don't show app until done.
  useEffect(() => {
    if (!userToken) {
      setInitialLoadComplete(false);
      return;
    }
    let cancelled = false;
    load().finally(() => {
      if (!cancelled) setInitialLoadComplete(true);
    });
    return () => {
      cancelled = true;
    };
  }, [userToken, load]);

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

  // One loader: show Loading until initial schedule is loaded, then show app.
  if (!initialLoadComplete) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#0078D4" />
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
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
