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
