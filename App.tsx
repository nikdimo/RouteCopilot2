import { useEffect } from 'react';
import { Linking, Platform, Text, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import * as WebBrowser from 'expo-web-browser';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { AuthProvider } from './src/context/AuthContext';
import { RouteProvider } from './src/context/RouteContext';
import { QALogProvider } from './src/context/QALogContext';
import { UserPreferencesProvider } from './src/context/UserPreferencesContext';
import { DevUIProvider } from './src/context/DevUIContext';
import RootNavigator from './src/navigation/RootNavigator';

const WEB_OAUTH_FALLBACK_REDIRECT_KEY = 'wiseplanOAuthFallbackRedirectUrl';
const WEB_OUTLOOK_POPUP_PREFIX = 'wiseplan-outlook-auth';
const OAUTH_POPUP_CLOSE_RETRY_DELAYS_MS = [30, 180, 450];

function hasOAuthCallbackParams() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  try {
    const currentUrl = new URL(window.location.href);
    const queryParams = currentUrl.searchParams;
    const hashParams = new URLSearchParams(currentUrl.hash.replace(/^#/, ''));
    const callbackParamKeys = ['code', 'state', 'error', 'error_description', 'id_token', 'access_token'];
    return callbackParamKeys.some((key) => queryParams.has(key) || hashParams.has(key));
  } catch {
    return false;
  }
}

function isOAuthPopupContext() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  try {
    const popupName = (window.name ?? '').toLowerCase();
    const hasNamedPopup = popupName.startsWith(WEB_OUTLOOK_POPUP_PREFIX);
    const hasOpener = Boolean(window.opener && window.opener !== window);
    return hasNamedPopup || hasOpener;
  } catch {
    return false;
  }
}

function cacheOAuthFallbackRedirectUrl() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(WEB_OAUTH_FALLBACK_REDIRECT_KEY, window.location.href);
  } catch {
    // ignore localStorage write failures
  }
}

function closeOAuthPopupIfPossible() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    const popupName = (window.name ?? '').toLowerCase();
    const hasOpener = Boolean(window.opener && window.opener !== window);
    const looksLikeAuthPopup = popupName.startsWith(WEB_OUTLOOK_POPUP_PREFIX);
    if (looksLikeAuthPopup || hasOpener || hasOAuthCallbackParams()) {
      window.close();
    }
  } catch {
    // ignore popup close failures
  }
}

function maybeCompleteAuthSessionSafely() {
  const webHasCallbackParams = hasOAuthCallbackParams();
  const webPopupContext = isOAuthPopupContext();

  if (Platform.OS === 'web' && webHasCallbackParams) {
    cacheOAuthFallbackRedirectUrl();
  }

  try {
    const result = WebBrowser.maybeCompleteAuthSession({ skipRedirectCheck: true });
    if (Platform.OS === 'web' && result.type === 'failed' && webHasCallbackParams) {
      closeOAuthPopupIfPossible();
    }
  } catch {
    if (Platform.OS === 'web' && webHasCallbackParams) {
      closeOAuthPopupIfPossible();
    }
  } finally {
    if (Platform.OS === 'web' && webHasCallbackParams) {
      for (const delay of OAUTH_POPUP_CLOSE_RETRY_DELAYS_MS) {
        setTimeout(() => closeOAuthPopupIfPossible(), delay);
      }
      if (!webPopupContext) {
        setTimeout(() => closeOAuthPopupIfPossible(), 800);
      }
    }
  }
}

if (Platform.OS !== 'web') {
  SplashScreen.preventAutoHideAsync();
}
maybeCompleteAuthSessionSafely();

export default function App() {
  const showOAuthCallbackShell = Platform.OS === 'web' && hasOAuthCallbackParams();

  useEffect(() => {
    const handleUrl = () => maybeCompleteAuthSessionSafely();
    const sub = Linking.addEventListener('url', handleUrl);
    Linking.getInitialURL().then((url) => url && handleUrl());
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!showOAuthCallbackShell) return;
    maybeCompleteAuthSessionSafely();
    const timers = [
      setTimeout(() => closeOAuthPopupIfPossible(), 0),
      setTimeout(() => closeOAuthPopupIfPossible(), 200),
      setTimeout(() => closeOAuthPopupIfPossible(), 600),
    ];
    return () => {
      for (const timerId of timers) {
        clearTimeout(timerId);
      }
    };
  }, [showOAuthCallbackShell]);

  if (showOAuthCallbackShell) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 20,
          backgroundColor: '#F8FAFC',
        }}
      >
        <Text style={{ color: '#0F172A', fontSize: 18, fontWeight: '700', marginBottom: 10 }}>
          Completing Microsoft sign-in...
        </Text>
        <Text style={{ color: '#334155', fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
          If this window does not close automatically, you can close it now and continue in WisePlan.
        </Text>
      </View>
    );
  }

  // GestureHandlerRootView breaks click events on web - use regular View instead
  const RootWrapper = Platform.OS === 'web' ? View : GestureHandlerRootView;

  return (
    <ErrorBoundary>
    <SafeAreaProvider>
    <RootWrapper style={{ flex: 1 }}>
      <AuthProvider>
      <UserPreferencesProvider>
      <DevUIProvider>
        <RouteProvider>
          <QALogProvider>
          <NavigationContainer>
            <RootNavigator />
            <StatusBar style="auto" />
            </NavigationContainer>
          </QALogProvider>
        </RouteProvider>
      </DevUIProvider>
      </UserPreferencesProvider>
    </AuthProvider>
    </RootWrapper>
    </SafeAreaProvider>
    </ErrorBoundary>
  );
}
