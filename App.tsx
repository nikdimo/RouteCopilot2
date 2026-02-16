import { useEffect } from 'react';
import { Linking, Platform } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';

// Force HTTPS on production: localStorage is per-origin; http and https don't share it.
// If user lands on http after Microsoft redirects to https, we lose the code_verifier.
if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.hostname === 'wiseplan.dk' && window.location?.protocol === 'http:') {
  window.location.replace('https://wiseplan.dk' + (window.location.pathname || '/app/') + (window.location.search || ''));
}
import * as WebBrowser from 'expo-web-browser';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { AuthProvider } from './src/context/AuthContext';
import { RouteProvider } from './src/context/RouteContext';
import { QALogProvider } from './src/context/QALogContext';
import { UserPreferencesProvider } from './src/context/UserPreferencesContext';
import RootNavigator from './src/navigation/RootNavigator';

if (Platform.OS !== 'web') {
  SplashScreen.preventAutoHideAsync();
  WebBrowser.maybeCompleteAuthSession();
}

export default function App() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const handleUrl = () => WebBrowser.maybeCompleteAuthSession();
    const sub = Linking.addEventListener('url', handleUrl);
    Linking.getInitialURL().then((url) => url && handleUrl());
    return () => sub.remove();
  }, []);

  return (
    <ErrorBoundary>
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
      <UserPreferencesProvider>
        <RouteProvider>
          <QALogProvider>
          <NavigationContainer>
            <RootNavigator />
            <StatusBar style="auto" />
            </NavigationContainer>
          </QALogProvider>
        </RouteProvider>
      </UserPreferencesProvider>
    </AuthProvider>
    </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
