import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { AuthProvider } from './src/context/AuthContext';
import { RouteProvider } from './src/context/RouteContext';
import { QALogProvider } from './src/context/QALogContext';
import { UserPreferencesProvider } from './src/context/UserPreferencesContext';
import RootNavigator from './src/navigation/RootNavigator';

export default function App() {
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
