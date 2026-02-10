import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import {
  useAuthRequest,
  useAutoDiscovery,
  makeRedirectUri,
  exchangeCodeAsync,
} from 'expo-auth-session';
import { MS_CLIENT_ID, MS_SCOPES } from '../config/auth';
import { useAuth } from '../context/AuthContext';

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const { signIn } = useAuth();
  const discovery = useAutoDiscovery(
    'https://login.microsoftonline.com/common/v2.0'
  );

  const redirectUri = makeRedirectUri({ preferLocalhost: true });

  const [request, response, promptAsync] = useAuthRequest(
    {
      clientId: MS_CLIENT_ID,
      scopes: [...MS_SCOPES],
      redirectUri,
    },
    discovery ?? undefined
  );

  useEffect(() => {
    if (response?.type !== 'success' || !discovery?.tokenEndpoint) return;

    const getToken = async () => {
      let token: string | null = null;
      if (response.authentication?.accessToken) {
        token = response.authentication.accessToken;
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
        } catch (e) {
          console.warn('Code exchange failed:', e);
          return;
        }
      }
      if (token) {
        console.log('Login Successful!');
        await signIn(token);
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
});
