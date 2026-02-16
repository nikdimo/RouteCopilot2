import { useWindowDimensions } from 'react-native';

/** Breakpoint for split layout: schedule | map side by side. 600 = phone landscape. */
const WIDE_BREAKPOINT = 600;

/**
 * Returns true when the screen is wide enough for split layout
 * (e.g. tablet, desktop, or phone in landscape).
 */
export function useIsWideScreen(): boolean {
  const { width } = useWindowDimensions();
  return width >= WIDE_BREAKPOINT;
}
