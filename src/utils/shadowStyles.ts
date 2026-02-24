import { Platform } from 'react-native';

/**
 * Cross-platform shadow style. On web uses boxShadow (avoids "shadow* is deprecated" warning);
 * on native uses shadowColor/shadowOffset/shadowOpacity/shadowRadius.
 */
export function shadowStyle(
  offsetWidth: number,
  offsetHeight: number,
  opacity: number,
  radius: number,
  color: string = '#000'
): Record<string, unknown> {
  if (Platform.OS === 'web') {
    const hex = color.startsWith('#') ? color.slice(1) : '000000';
    const r = hex.length >= 6 ? parseInt(hex.slice(0, 2), 16) : 0;
    const g = hex.length >= 6 ? parseInt(hex.slice(2, 4), 16) : 0;
    const b = hex.length >= 6 ? parseInt(hex.slice(4, 6), 16) : 0;
    return {
      boxShadow: `${offsetWidth}px ${offsetHeight}px ${radius}px rgba(${r},${g},${b},${opacity})`,
    };
  }
  return {
    shadowColor: color,
    shadowOffset: { width: offsetWidth, height: offsetHeight },
    shadowOpacity: opacity,
    shadowRadius: radius,
  };
}
