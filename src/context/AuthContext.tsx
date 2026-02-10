import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';

export type UserData = {
  displayName: string | null;
  mail: string | null;
};

type AuthContextValue = {
  userToken: string | null;
  userData: UserData | null;
  signIn: (token: string) => Promise<void>;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const ME_URL = 'https://graph.microsoft.com/v1.0/me';
const ME_SELECT = 'displayName,mail';
const TOKEN_KEY = 'userToken';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [userToken, setUserToken] = useState<string | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);

  const fetchUserData = useCallback(async (token: string) => {
    try {
      const res = await fetch(`${ME_URL}?$select=${ME_SELECT}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setUserData(null);
        return;
      }
      const data = await res.json();
      setUserData({
        displayName: data.displayName ?? null,
        mail: data.mail ?? data.userPrincipalName ?? null,
      });
    } catch {
      setUserData(null);
    }
  }, []);

  const signIn = useCallback(async (token: string) => {
    setUserToken(token);
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    await fetchUserData(token);
  }, [fetchUserData]);

  const signOut = useCallback(async () => {
    setUserToken(null);
    setUserData(null);
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }, []);

  useEffect(() => {
    SecureStore.getItemAsync(TOKEN_KEY).then((stored) => {
      if (stored) {
        setUserToken(stored);
        fetchUserData(stored);
      }
    });
  }, [fetchUserData]);

  const value: AuthContextValue = {
    userToken,
    userData,
    signIn,
    signOut,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
