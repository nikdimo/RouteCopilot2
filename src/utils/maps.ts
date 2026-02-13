import { Linking, Platform } from 'react-native';

/** Open directions to a location. Uses Google Maps on web, native apps on mobile. */
export function openNativeDirections(
  latitude: number,
  longitude: number,
  label: string
): void {
  if (Platform.OS === 'web') {
    const url = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  const url =
    Platform.OS === 'ios'
      ? `http://maps.apple.com/?daddr=${latitude},${longitude}`
      : `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
  Linking.openURL(url).catch(() => {});
}
