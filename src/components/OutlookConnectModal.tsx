import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Link2, X } from 'lucide-react-native';
import * as WebBrowser from 'expo-web-browser';
import {
  exchangeCodeAsync,
  makeRedirectUri,
  useAuthRequest,
  useAutoDiscovery,
} from 'expo-auth-session';
import Constants from 'expo-constants';
import { MS_CLIENT_ID, MS_SCOPES } from '../config/auth';
import { saveGraphSession } from '../services/graphAuth';

const WEB_OAUTH_FALLBACK_REDIRECT_KEY = 'wiseplanOAuthFallbackRedirectUrl';
const WEB_OAUTH_PKCE_VERIFIER_KEY = 'wiseplanOAuthPkceVerifier';
const WEB_OAUTH_EXPECTED_STATE_KEY = 'wiseplanOAuthExpectedState';
const WEB_OUTLOOK_POPUP_PREFIX = 'wiseplan-outlook-auth';
const WEB_EXPO_OAUTH_EXACT_KEYS = ['ExpoWebBrowserRedirectHandle'];
const WEB_EXPO_OAUTH_PREFIXES = ['ExpoWebBrowser_OriginUrl_', 'ExpoWebBrowser_RedirectUrl_'];

type OutlookConnectModalProps = {
  visible: boolean;
  onClose: () => void;
  onConnected?: () => void;
};

export default function OutlookConnectModal({
  visible,
  onClose,
  onConnected,
}: OutlookConnectModalProps) {
  const discovery = useAutoDiscovery('https://login.microsoftonline.com/common/v2.0');
  const isExpoGo = Constants.appOwnership === 'expo';

  const redirectUri = useMemo(() => {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.location?.origin) {
        const origin = window.location.origin.replace(/\/+$/, '');
        return `${origin}/app/`;
      }
      return makeRedirectUri({ path: 'app/' });
    }
    if (isExpoGo) {
      return makeRedirectUri();
    }
    return 'wiseplan://auth';
  }, [isExpoGo]);

  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [webAuthInFlight, setWebAuthInFlight] = useState(false);
  const authHandledRef = useRef(false);
  const webAuthDeadlineRef = useRef<number | null>(null);

  const clearWebOauthTransient = () => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    try {
      window.localStorage?.removeItem(WEB_OAUTH_FALLBACK_REDIRECT_KEY);
      window.localStorage?.removeItem(WEB_OAUTH_PKCE_VERIFIER_KEY);
      window.localStorage?.removeItem(WEB_OAUTH_EXPECTED_STATE_KEY);
      for (const key of WEB_EXPO_OAUTH_EXACT_KEYS) {
        window.localStorage?.removeItem(key);
      }

      const keysToRemove: string[] = [];
      const storage = window.localStorage;
      if (storage) {
        for (let i = 0; i < storage.length; i += 1) {
          const key = storage.key(i);
          if (!key) continue;
          if (WEB_EXPO_OAUTH_PREFIXES.some((prefix) => key.startsWith(prefix))) {
            keysToRemove.push(key);
          }
        }
        for (const key of keysToRemove) {
          storage.removeItem(key);
        }
      }
    } catch {
      // ignore localStorage cleanup failures
    }
  };

  const getWebStoredPkceVerifier = () => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return '';
    try {
      return (window.localStorage?.getItem(WEB_OAUTH_PKCE_VERIFIER_KEY) ?? '').trim();
    } catch {
      return '';
    }
  };

  const getWebStoredState = () => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return '';
    try {
      return (window.localStorage?.getItem(WEB_OAUTH_EXPECTED_STATE_KEY) ?? '').trim();
    } catch {
      return '';
    }
  };

  const [request, response, promptAsync] = useAuthRequest(
    {
      clientId: MS_CLIENT_ID,
      scopes: [...MS_SCOPES],
      redirectUri,
    },
    discovery ?? null
  );

  useEffect(() => {
    if (!visible) return;
    setErrorMsg('');
    setLoading(false);
    setSuccess(false);
    setWebAuthInFlight(false);
    authHandledRef.current = false;
  }, [visible]);

  useEffect(() => {
    if (!webAuthInFlight) {
      webAuthDeadlineRef.current = null;
      return;
    }
    webAuthDeadlineRef.current = Date.now() + 60_000;
  }, [webAuthInFlight]);

  useEffect(() => {
    if (!visible) return;
    if (!response) return;
    if (authHandledRef.current) return;

    const finishConnect = async () => {
      try {
        if (response.type !== 'success') {
          if (Platform.OS === 'web' && webAuthInFlight && response.type !== 'error') {
            // Popup can resolve as dismiss before fallback callback is consumed.
            // Keep waiting for localStorage fallback processing.
            return;
          }
          setLoading(false);
          setWebAuthInFlight(false);
          if (response.type === 'error') {
            setErrorMsg('Outlook connect failed. Please try again.');
          }
          clearWebOauthTransient();
          return;
        }

        authHandledRef.current = true;

        if (response.authentication?.accessToken) {
          await saveGraphSession(
            response.authentication.accessToken,
            (response.authentication as { refreshToken?: string }).refreshToken,
            (response.authentication as { expiresIn?: number }).expiresIn
          );
          setWebAuthInFlight(false);
          clearWebOauthTransient();
          setSuccess(true);
          setLoading(false);
          onConnected?.();
          return;
        }

        const responseCodeVerifier = (request?.codeVerifier ?? getWebStoredPkceVerifier()).trim();
        if (response.params?.code && responseCodeVerifier && discovery) {
          const tokenResponse = await exchangeCodeAsync(
            {
              clientId: MS_CLIENT_ID,
              redirectUri,
              code: response.params.code,
              extraParams: { code_verifier: responseCodeVerifier },
            },
            discovery
          );
          await saveGraphSession(
            tokenResponse.accessToken,
            (tokenResponse as { refreshToken?: string }).refreshToken,
            tokenResponse.expiresIn
          );
          setWebAuthInFlight(false);
          clearWebOauthTransient();
          setSuccess(true);
          setLoading(false);
          onConnected?.();
          return;
        }

        setErrorMsg('Outlook connect failed. Please try again.');
        setLoading(false);
        setWebAuthInFlight(false);
        clearWebOauthTransient();
      } catch (error) {
        setLoading(false);
        setWebAuthInFlight(false);
        setErrorMsg(error instanceof Error ? error.message : 'Outlook connect failed.');
        clearWebOauthTransient();
      }
    };

    void finishConnect();
  }, [discovery, onConnected, redirectUri, request?.codeVerifier, response, visible, webAuthInFlight]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (!visible || !webAuthInFlight) return;
    if (!discovery) return;

    let cancelled = false;

    const processFallbackRedirect = async () => {
      if (cancelled || authHandledRef.current || typeof window === 'undefined') return;
      const fallbackUrl = (() => {
        try {
          return window.localStorage?.getItem(WEB_OAUTH_FALLBACK_REDIRECT_KEY) ?? null;
        } catch {
          return null;
        }
      })();
      if (!fallbackUrl || cancelled || authHandledRef.current) return;

      if (webAuthDeadlineRef.current && Date.now() > webAuthDeadlineRef.current) {
        setLoading(false);
        setWebAuthInFlight(false);
        setErrorMsg('Outlook connect timed out. Please try again.');
        clearWebOauthTransient();
        return;
      }

      try {
        const callbackUrl = new URL(fallbackUrl);
        const error = callbackUrl.searchParams.get('error');
        const code = callbackUrl.searchParams.get('code');
        const returnedState = (callbackUrl.searchParams.get('state') ?? '').trim();
        const expectedState = getWebStoredState();
        if (expectedState && returnedState && expectedState !== returnedState) {
          return;
        }
        const fallbackCodeVerifier = (request?.codeVerifier ?? getWebStoredPkceVerifier()).trim();
        if (error) {
          setLoading(false);
          setWebAuthInFlight(false);
          setErrorMsg('Outlook connect failed. Please try again.');
          clearWebOauthTransient();
          return;
        }
        if (!code || !fallbackCodeVerifier) {
          // Still waiting for a complete callback payload.
          return;
        }

        authHandledRef.current = true;
        const tokenResponse = await exchangeCodeAsync(
          {
            clientId: MS_CLIENT_ID,
            redirectUri,
            code,
            extraParams: { code_verifier: fallbackCodeVerifier },
          },
          discovery
        );
        await saveGraphSession(
          tokenResponse.accessToken,
          (tokenResponse as { refreshToken?: string }).refreshToken,
          tokenResponse.expiresIn
        );
        setWebAuthInFlight(false);
        clearWebOauthTransient();
        if (cancelled) return;
        setSuccess(true);
        setLoading(false);
        onConnected?.();
      } catch (error) {
        if (cancelled) return;
        setLoading(false);
        setWebAuthInFlight(false);
        setErrorMsg(error instanceof Error ? error.message : 'Outlook connect failed.');
        clearWebOauthTransient();
      }
    };

    const interval = setInterval(() => {
      void processFallbackRedirect();
    }, 500);
    void processFallbackRedirect();

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [discovery, onConnected, redirectUri, request?.codeVerifier, visible, webAuthInFlight]);

  const handleConnect = async () => {
    if (!request || !discovery) return;
    setErrorMsg('');
    setLoading(true);
    setWebAuthInFlight(Platform.OS === 'web');
    authHandledRef.current = false;
    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        clearWebOauthTransient();
        try {
          if (request.codeVerifier) {
            window.localStorage?.setItem(WEB_OAUTH_PKCE_VERIFIER_KEY, request.codeVerifier);
          }
          if (request.state) {
            window.localStorage?.setItem(WEB_OAUTH_EXPECTED_STATE_KEY, request.state);
          }
        } catch {
          // ignore localStorage write failures
        }
        void promptAsync({
          windowName: `${WEB_OUTLOOK_POPUP_PREFIX}-${Date.now()}`,
          windowFeatures: {
            width: 520,
            height: 760,
          },
        }).catch((error) => {
          setLoading(false);
          setErrorMsg(error instanceof Error ? error.message : 'Could not start Outlook connection.');
        });
        return;
      }
      setWebAuthInFlight(false);
      await promptAsync();
    } catch (error) {
      setLoading(false);
      setWebAuthInFlight(false);
      setErrorMsg(error instanceof Error ? error.message : 'Could not start Outlook connection.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.overlayTapTarget} onPress={onClose} />
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={onClose}
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
          >
            <X size={20} color="#64748B" />
          </TouchableOpacity>

          <View style={styles.iconCircle}>
            <Link2 size={24} color="#0078D4" />
          </View>
          <Text style={styles.title}>Connect Outlook</Text>
          <Text style={styles.subtitle}>
            Connect your Microsoft account to sync contacts and calendar data into WisePlan.
          </Text>

          {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
          {success ? (
            <Text style={styles.successText}>Outlook connected successfully.</Text>
          ) : null}

          <TouchableOpacity
            style={[styles.primaryButton, (loading || !request) && styles.primaryButtonDisabled]}
            disabled={loading || !request}
            onPress={handleConnect}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Connect Microsoft</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  overlayTapTarget: {
    ...StyleSheet.absoluteFillObject,
  },
  card: {
    position: 'relative',
    zIndex: 1,
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  closeButton: {
    position: 'absolute',
    top: 14,
    right: 14,
    zIndex: 2,
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#475569',
    marginBottom: 14,
  },
  errorText: {
    color: '#DC2626',
    fontSize: 13,
    marginBottom: 10,
  },
  successText: {
    color: '#15803D',
    fontSize: 13,
    marginBottom: 10,
  },
  primaryButton: {
    marginTop: 8,
    backgroundColor: '#0078D4',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
