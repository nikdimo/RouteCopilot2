/**
 * Parse time string (e.g. "09:00" or "09:00 - 10:00") to ms within the given day.
 */
export function parseTimeToDayMs(
  timeStr: string,
  isoFallback?: string,
  useEnd = false
): number {
  const ref = isoFallback ? new Date(isoFallback) : new Date();
  const dayStart = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()).getTime();
  if (!timeStr || typeof timeStr !== 'string') return dayStart + 9 * 60 * 60 * 1000;
  const parts = timeStr.split('-').map((p) => p.trim());
  const target = useEnd ? (parts[1] ?? parts[0]) : (parts[0] ?? '09:00');
  const [h = 9, m = 0] = target.split(':').map((x) => parseInt(x || '0', 10));
  return dayStart + (h * 60 + m) * 60 * 1000;
}

/**
 * Format duration in seconds to "X min" or "X h Y min".
 */
export function formatDurationSeconds(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h} h ${m} min` : `${h} h`;
}

/**
 * Format ms to "HH:MM".
 */
export function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

/**
 * Format meeting duration from ISO strings to "X min" or "Xh Ym".
 */
export function formatDurationMinutes(startIso?: string, endIso?: string): string {
  if (!startIso || !endIso) return '';
  try {
    const start = new Date(startIso).getTime();
    const end = new Date(endIso).getTime();
    const mins = Math.round((end - start) / 60_000);
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  } catch {
    return '';
  }
}

/**
 * Local-time day key: YYYY-MM-DD in the device's local timezone.
 * Use for all schedule grouping, filtering, and "which day" logic.
 * Do NOT use toISOString().slice(0,10) which produces UTC day keys and causes
 * midnight boundary bugs (e.g. showing Feb 11 when local time is Feb 12).
 */
export function toLocalDayKey(dateOrMs: Date | number): string {
  const d = typeof dateOrMs === 'number' ? new Date(dateOrMs) : dateOrMs;
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}
