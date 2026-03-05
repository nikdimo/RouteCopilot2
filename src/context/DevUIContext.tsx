import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

const MOCK_MAP_STYLE_COUNT = 5;

type DevUIContextValue = {
  showOldUI: boolean;
  setShowOldUI: (value: boolean) => void;
  mockMapStyleIndex: number;
  setMockMapStyleIndex: (index: number) => void;
  mockMapStyleCount: number;
};

const DevUIContext = createContext<DevUIContextValue | null>(null);

function clampMockMapStyleIndex(index: number) {
  if (!Number.isFinite(index)) return 0;
  const asInt = Math.trunc(index);
  return Math.max(0, Math.min(MOCK_MAP_STYLE_COUNT - 1, asInt));
}

export function DevUIProvider({ children }: { children: React.ReactNode }) {
  const [showOldUI, setShowOldUI] = useState(false);
  const [mockMapStyleIndex, setMockMapStyleIndexState] = useState(0);

  const setMockMapStyleIndex = useCallback((index: number) => {
    setMockMapStyleIndexState(clampMockMapStyleIndex(index));
  }, []);

  const value = useMemo<DevUIContextValue>(
    () => ({
      showOldUI,
      setShowOldUI,
      mockMapStyleIndex,
      setMockMapStyleIndex,
      mockMapStyleCount: MOCK_MAP_STYLE_COUNT,
    }),
    [showOldUI, mockMapStyleIndex, setMockMapStyleIndex]
  );

  return <DevUIContext.Provider value={value}>{children}</DevUIContext.Provider>;
}

export function useDevUI() {
  const ctx = useContext(DevUIContext);
  if (!ctx) {
    throw new Error('useDevUI must be used inside DevUIProvider');
  }
  return ctx;
}
