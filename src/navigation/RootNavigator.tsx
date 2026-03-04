import React, { useEffect, useRef, useState } from 'react';
import { Platform, View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useAuth } from '../context/AuthContext';
import { useRoute } from '../context/RouteContext';
import { useUserPreferences } from '../context/UserPreferencesContext';
import AppNavigator from './AppNavigator';
import SelectedDateSync from '../components/SelectedDateSync';
import OutlookConnectModal from '../components/OutlookConnectModal';
import { hasValidGraphSession, isMagicAuthToken } from '../services/graphAuth';
import { MS_CLIENT_ID } from '../config/auth';
import { BACKEND_API_ENABLED } from '../config/backend';
import { backendUpdateProfileSettings } from '../services/backendApi';

export default function RootNavigator() {
  const { isRestoringSession, userToken, getValidToken } = useAuth();
  const { triggerRefresh } = useRoute();
  const { updatePreferences } = useUserPreferences();
  const [showOutlookConnectModal, setShowOutlookConnectModal] = useState(false);
  const [hasCheckedMagicGraphPrompt, setHasCheckedMagicGraphPrompt] = useState(false);
  const [showOutlookConnectedBanner, setShowOutlookConnectedBanner] = useState(false);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      SplashScreen.hideAsync();
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!userToken) {
      setHasCheckedMagicGraphPrompt(false);
      setShowOutlookConnectModal(false);
      setShowOutlookConnectedBanner(false);
      return () => {
        cancelled = true;
      };
    }

    if (hasCheckedMagicGraphPrompt) {
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      if (!isMagicAuthToken(userToken)) {
        if (!cancelled) {
          setHasCheckedMagicGraphPrompt(true);
        }
        return;
      }
      const connected = await hasValidGraphSession(MS_CLIENT_ID);
      if (cancelled) return;
      setHasCheckedMagicGraphPrompt(true);
      if (!connected) {
        setShowOutlookConnectModal(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasCheckedMagicGraphPrompt, userToken]);

  useEffect(() => {
    return () => {
      if (bannerTimerRef.current) {
        clearTimeout(bannerTimerRef.current);
      }
    };
  }, []);

  const handleOutlookConnected = () => {
    setShowOutlookConnectModal(false);
    setShowOutlookConnectedBanner(true);
    updatePreferences({
      calendarConnected: true,
      calendarProvider: 'outlook',
    });
    triggerRefresh();
    if (bannerTimerRef.current) {
      clearTimeout(bannerTimerRef.current);
    }
    bannerTimerRef.current = setTimeout(() => {
      setShowOutlookConnectedBanner(false);
      bannerTimerRef.current = null;
    }, 4000);

    void (async () => {
      if (!BACKEND_API_ENABLED) return;
      const token = userToken ?? (getValidToken ? await getValidToken() : null);
      if (!token) return;
      await backendUpdateProfileSettings(
        {
          calendarConnected: true,
          calendarProvider: 'outlook',
        },
        token
      ).catch(() => {
        // non-blocking: profile can still connect later if backend patch fails
      });
    })();
  };

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

  return (
    <>
      <SelectedDateSync />
      <AppNavigator />
      {showOutlookConnectedBanner ? (
        <View style={styles.connectedBannerWrap} pointerEvents="none">
          <View style={styles.connectedBanner}>
            <Text style={styles.connectedBannerText}>Outlook connected. Calendar sync is active.</Text>
          </View>
        </View>
      ) : null}
      <OutlookConnectModal
        visible={showOutlookConnectModal}
        onClose={() => setShowOutlookConnectModal(false)}
        onConnected={handleOutlookConnected}
      />
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
  connectedBannerWrap: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    zIndex: 60,
    alignItems: 'center',
  },
  connectedBanner: {
    backgroundColor: '#0F766E',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 3,
    maxWidth: 540,
    width: '100%',
  },
  connectedBannerText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
});
