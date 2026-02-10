import React from 'react';
import { useAuth } from '../context/AuthContext';
import LoginScreen from '../screens/LoginScreen';
import AppNavigator from './AppNavigator';

export default function RootNavigator() {
  const { userToken } = useAuth();

  if (!userToken) {
    return <LoginScreen />;
  }

  return <AppNavigator />;
}
