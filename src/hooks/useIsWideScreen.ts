import { useWindowDimensions } from 'react-native';

/**
 * Returns true when the screen is in landscape mode or wide enough for split layout.
 * Ensures Portrait mode only shows meetings, while Landscape shows meetings AND map.
 */
export function useIsWideScreen(): boolean {
  const { width, height } = useWindowDimensions();
  // Strictly enforce landscape mode (width > height) for mobile devices, or very wide monitors
  return width > height && width >= 480;
}
