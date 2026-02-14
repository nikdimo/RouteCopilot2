import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import {
  useAuthRequest,
  useAutoDiscovery,
  makeRedirectUri,
  exchangeCodeAsync,
} from 'expo-auth-session';
import { MS_CLIENT_ID, MS_SCOPES } from '../config/auth';
import { useAuth } from '../context/AuthContext';

// Complete OAuth popup flow. When we land with ?code= we're the callback; use skipRedirectCheck
// to avoid failures from trailing-slash or URL normalization mismatches (common with Azure + Cloudflare).
if (typeof window !== 'undefined' && window.location.search.includes('code=')) {
  WebBrowser.maybeCompleteAuthSession({ skipRedirectCheck: true });
} else {
  WebBrowser.maybeCompleteAuthSession();
}

export default function LoginScreen() {
  const { signIn, signOut, getValidToken } = useAuth();
  const discovery = useAutoDiscovery(
    'https://login.microsoftonline.com/common/v2.0'
  );

  const baseRedirect = makeRedirectUri({ preferLocalhost: true });
  const redirectUri = Platform.OS === 'web' && baseRedirect && !baseRedirect.includes('/app')
    ? baseRedirect.replace(/(\/)?$/, '/app$1')
    : baseRedirect;

  const [exchangeError, setExchangeError] = useState<string | null>(null);
  const [request, response, promptAsync] = useAuthRequest(
    {
      clientId: MS_CLIENT_ID,
      scopes: [...MS_SCOPES],
      redirectUri,
    },
    discovery ?? undefined
  );

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
        onPress={() => promptAsync()}
        disabled={!request}
        activeOpacity={0.85}
      >
        <Text style={styles.buttonText}>Sign in with Microsoft</Text>
      </TouchableOpacity>
      {exchangeError ? (
        <Text style={styles.errorText}>{exchangeError}</Text>
      ) : null}
      <TouchableOpacity
        style={styles.resetButton}
        onPress={() => {
          setExchangeError(null);
          signOut();
          if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location.search) {
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
});
