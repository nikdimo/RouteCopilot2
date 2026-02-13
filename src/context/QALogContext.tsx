import React, { createContext, useContext, useState, useCallback } from 'react';

/** Single slot evaluation for QA: accepted (proposed) or rejected. Compatible with scheduler QASlotConsidered. */
export type QASlotEntry = {
  dayIso: string;
  dayLabel: string;
  timeRange: string;
  status: 'accepted' | 'rejected';
  reason?: string;
  /** Detour in km (extra distance vs direct prev→next). */
  detourKm?: number;
  /** Extra minutes added to route. */
  addToRouteMin?: number;
  baselineMin?: number;
  newPathMin?: number;
  slackMin?: number;
  score?: number;
  label?: string;
  prev?: string;
  next?: string;
  /** Human-readable summary. */
  summary?: string;
};

/** Existing meeting at creation time (by day). */
export type QAExistingMeeting = {
  title: string;
  time: string;
  location: string;
};

export type QALogEntry = {
  id: string;
  createdAt: string;
  newMeeting: {
    title: string;
    location: string;
    durationMin: number;
  };
  selectedSlot: {
    dayIso: string;
    timeRange: string;
    dayLabel: string;
  };
  existingByDay: Record<string, QAExistingMeeting[]>;
  slotsConsidered: QASlotEntry[];
};

type QALogContextValue = {
  entries: QALogEntry[];
  addEntry: (entry: Omit<QALogEntry, 'id' | 'createdAt'>) => void;
  clearLog: () => void;
};

const QALogContext = createContext<QALogContextValue | null>(null);

export function QALogProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<QALogEntry[]>([]);

  const addEntry = useCallback((entry: Omit<QALogEntry, 'id' | 'createdAt'>) => {
    const log: QALogEntry = {
      ...entry,
      id: `qa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
    };
    setEntries((prev) => [log, ...prev].slice(0, 50));
  }, []);

  const clearLog = useCallback(() => setEntries([]), []);

  return (
    <QALogContext.Provider value={{ entries, addEntry, clearLog }}>
      {children}
    </QALogContext.Provider>
  );
}

export function useQALog() {
  const ctx = useContext(QALogContext);
  if (!ctx) return null;
  return ctx;
}
