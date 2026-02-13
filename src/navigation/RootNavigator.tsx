import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useAuth } from '../context/AuthContext';
import LoginScreen from '../screens/LoginScreen';
import AppNavigator from './AppNavigator';

export default function RootNavigator() {
  const { userToken, isRestoringSession } = useAuth();

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

  return <AppNavigator />;
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
