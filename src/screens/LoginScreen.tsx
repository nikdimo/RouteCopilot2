import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import {
  useAuthRequest,
  useAutoDiscovery,
  makeRedirectUri,
  exchangeCodeAsync,
} from 'expo-auth-session';
import Constants from 'expo-constants';
import { MS_CLIENT_ID, MS_SCOPES } from '../config/auth';
import { useAuth } from '../context/AuthContext';

const PKCE_VERIFIER_KEY = 'oauth_code_verifier';
const PKCE_REDIRECT_KEY = 'oauth_redirect_uri';
// Use localStorage so it persists across redirect chains (e.g. Microsoft -> wiseplan.dk/ -> landing forwards to /app/)
function getStored(key: string): string | null {
  try {
    return (typeof localStorage !== 'undefined' ? localStorage : typeof sessionStorage !== 'undefined' ? sessionStorage : null)?.getItem(key) ?? null;
  } catch { return null; }
}
function setStored(key: string, value: string): void {
  try {
    (typeof localStorage !== 'undefined' ? localStorage : typeof sessionStorage !== 'undefined' ? sessionStorage : null)?.setItem(key, value);
  } catch {}
}
function removeStored(key: string): void {
  try {
    (typeof localStorage !== 'undefined' ? localStorage : typeof sessionStorage !== 'undefined' ? sessionStorage : null)?.removeItem(key);
  } catch {}
}

// Dismiss auth session and pass redirect to useAuthRequest. Web: skipRedirectCheck when ?code=
// to avoid trailing-slash/URL normalization mismatches (Azure + Cloudflare).
// Guard window.location: it exists on web but is undefined on React Native.
if (typeof window !== 'undefined' && window.location?.search?.includes('code=')) {
  WebBrowser.maybeCompleteAuthSession({ skipRedirectCheck: true });
} else {
  WebBrowser.maybeCompleteAuthSession();
}

function isMobileWeb(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

export default function LoginScreen() {
  const { signIn, signOut, getValidToken } = useAuth();
  const discovery = useAutoDiscovery(
    'https://login.microsoftonline.com/common/v2.0'
  );

  // Expo Go uses exp://... (makeRedirectUri); standalone uses wiseplan://auth
  const isExpoGo = Constants.appOwnership === 'expo';
  const baseRedirect =
    Platform.OS === 'web'
      ? makeRedirectUri({ preferLocalhost: true })
      : isExpoGo
        ? makeRedirectUri()
        : 'wiseplan://auth';
  let redirectUri = Platform.OS === 'web' && baseRedirect && !baseRedirect.includes('/app')
    ? baseRedirect.replace(/(\/)?$/, '/app$1')
    : baseRedirect;
  // Production: force https://wiseplan.dk/app/ so Microsoft redirects to app, not landing root
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.hostname === 'wiseplan.dk') {
    redirectUri = 'https://wiseplan.dk/app/';
  }

  if (__DEV__ && Platform.OS === 'web') {
    console.log('[Login] redirectUri sent to Microsoft:', redirectUri);
  }
  if (__DEV__ && Platform.OS !== 'web' && isExpoGo) {
    console.log('[Login] Expo Go redirectUri (add to Azure):', redirectUri);
  }

  const [exchangeError, setExchangeError] = useState<string | null>(null);
  const [authDebug, setAuthDebug] = useState<string>('');
  const [isRedirecting, setIsRedirecting] = useState(false);
  const showDebug =
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    (window.location?.search?.includes('debug=1') ?? false);

  const useRedirectFlow = Platform.OS === 'web' && isMobileWeb();

  const [request, response, promptAsync] = useAuthRequest(
    {
      clientId: MS_CLIENT_ID,
      scopes: [...MS_SCOPES],
      redirectUri,
    },
    discovery ?? undefined
  );

  // Handle return from redirect flow (mobile web): we landed with ?code= and have verifier in sessionStorage
  useEffect(() => {
    if (Platform.OS !== 'web' || !discovery?.tokenEndpoint) return;
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location?.search ?? '') : null;
    const code = params?.get('code');
    if (!code) return;
    const verifier = getStored(PKCE_VERIFIER_KEY);
    const storedRedirect = getStored(PKCE_REDIRECT_KEY);
    const finalRedirect = storedRedirect || redirectUri;
    if (!verifier) {
      // Landed with ?code= but no verifier (e.g. redirect via landing page lost storage, or stale link)
      setExchangeError('Your session expired. Please tap "Sign in with Microsoft" again.');
      if (typeof window !== 'undefined' && window.history?.replaceState) {
        window.history.replaceState({}, '', window.location?.pathname ?? '/app');
      }
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const tokenResponse = await exchangeCodeAsync(
          { clientId: MS_CLIENT_ID, redirectUri: finalRedirect, code, extraParams: { code_verifier: verifier } },
          discovery
        );
        removeStored(PKCE_VERIFIER_KEY);
        removeStored(PKCE_REDIRECT_KEY);
        if (typeof window !== 'undefined' && window.history?.replaceState) {
          const path = window.location?.pathname ?? '/app';
          window.history.replaceState({}, '', path);
        }
        if (!cancelled) await signIn(tokenResponse.accessToken, (tokenResponse as { refreshToken?: string }).refreshToken);
      } catch (e) {
        if (!cancelled) setExchangeError(e instanceof Error ? e.message : 'Login failed.');
      }
    })();
    return () => { cancelled = true; };
  }, [discovery, redirectUri, signIn]);

  useEffect(() => {
    if (showDebug && response) {
      setAuthDebug(
        `response: ${response.type}\n` +
          (response.type === 'error' ? `error: ${JSON.stringify((response as { error?: string }).error ?? response)}` : '') +
          (response.type === 'dismiss' ? '\nPopup was closed or cancelled.' : '')
      );
    }
  }, [response, showDebug]);

  const handleSignIn = useCallback(async () => {
    if (useRedirectFlow && request && discovery && request.url) {
      try {
        setIsRedirecting(true);
        setStored(PKCE_VERIFIER_KEY, request.codeVerifier ?? '');
        setStored(PKCE_REDIRECT_KEY, redirectUri);
        if (typeof window !== 'undefined') window.location.href = request.url;
      } catch (e) {
        setIsRedirecting(false);
        setExchangeError(e instanceof Error ? e.message : 'Failed to start login');
      }
    } else {
      await promptAsync();
    }
  }, [useRedirectFlow, request, discovery, redirectUri, promptAsync]);

  useEffect(() => {
    setExchangeError(null);
    if (response?.type !== 'success' || !discovery?.tokenEndpoint) return;

    const getToken = async () => {
      let token: string | null = null;
      let refreshToken: string | undefined;
      if (response.authentication?.accessToken) {
        token = response.authentication.accessToken;
        refreshToken = (response.authentication as { refreshToken?: string }).refreshToken;
      } else if (response.params?.code && request?.codeVerifier) {
        try {
          const tokenResponse = await exchangeCodeAsync(
            {
              clientId: MS_CLIENT_ID,
              redirectUri,
              code: response.params.code,
              extraParams: { code_verifier: request.codeVerifier },
            },
            discovery
          );
          token = tokenResponse.accessToken;
          refreshToken = (tokenResponse as { refreshToken?: string }).refreshToken;
        } catch (e) {
          console.warn('Code exchange failed:', e);
          setExchangeError(
            e instanceof Error ? e.message : 'Login failed. Try "Clear cache / Reset" then sign in again.'
          );
          return;
        }
      } else if (response.params?.code && !request?.codeVerifier) {
        setExchangeError('Session expired. Click "Clear cache / Reset" then sign in again.');
      }
      if (token) {
        await signIn(token, refreshToken);
      }
    };

    getToken();
  }, [response, discovery, request?.codeVerifier, redirectUri, signIn]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome to Route Copilot</Text>
      <Text style={styles.subtitle}>Your AI Logistics Assistant</Text>
      <TouchableOpacity
        style={styles.button}
        onPress={handleSignIn}
        disabled={!request || isRedirecting}
        activeOpacity={0.85}
      >
        <Text style={styles.buttonText}>
          {isRedirecting ? 'Redirecting…' : 'Sign in with Microsoft'}
        </Text>
      </TouchableOpacity>
      {exchangeError ? (
        <Text style={styles.errorText}>{exchangeError}</Text>
      ) : null}
      {__DEV__ && Platform.OS !== 'web' && isExpoGo ? (
        <Text style={styles.expoGoHint}>
          Add this to Azure redirect URIs:{'\n'}
          {redirectUri}
        </Text>
      ) : null}
      {showDebug ? (
        <View style={styles.debugBox}>
          <Text style={styles.debugTitle}>Debug (?debug=1)</Text>
          <Text style={styles.debugText}>redirectUri: {redirectUri}</Text>
          <Text style={styles.debugText}>origin: {typeof window !== 'undefined' ? window.location?.origin : '—'}</Text>
          <Text style={styles.debugText}>flow: {useRedirectFlow ? 'redirect (mobile)' : 'popup'}</Text>
          {authDebug ? <Text style={styles.debugText}>{authDebug}</Text> : <Text style={styles.debugText}>No response yet. Tap Sign in.</Text>}
        </View>
      ) : null}
      <TouchableOpacity
        style={styles.resetButton}
        onPress={() => {
          setExchangeError(null);
          signOut();
          if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.search) {
            window.history.replaceState({}, '', window.location.pathname);
          }
        }}
        activeOpacity={0.7}
      >
        <Text style={styles.resetButtonText}>Clear cache / Reset</Text>
      </TouchableOpacity>
      {__DEV__ && (
        <TouchableOpacity
          style={[styles.resetButton, styles.devButton]}
          onPress={async () => {
            const token = getValidToken ? await getValidToken() : null;
            if (token) await signIn(token);
          }}
          activeOpacity={0.7}
        >
          <Text style={styles.devButtonText}>Dev: Restore session</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F2F1',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#1a1a1a',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#605E5C',
    textAlign: 'center',
    marginBottom: 48,
  },
  button: {
    backgroundColor: '#0078D4',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 8,
    minWidth: 280,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  buttonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
  },
  errorText: {
    fontSize: 14,
    color: '#c53030',
    textAlign: 'center',
    marginTop: 16,
    paddingHorizontal: 24,
  },
  expoGoHint: {
    fontSize: 11,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 12,
    paddingHorizontal: 16,
    fontFamily: 'monospace',
  },
  resetButton: {
    marginTop: 24,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  resetButtonText: {
    fontSize: 14,
    color: '#605E5C',
  },
  devButton: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#94a3b8',
  },
  devButtonText: {
    fontSize: 13,
    color: '#64748b',
  },
  debugBox: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    maxWidth: 320,
    alignSelf: 'center',
  },
  debugTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#444',
    marginBottom: 8,
  },
  debugText: {
    fontSize: 11,
    color: '#666',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
});
