/**
 * Expo app config. Loads app.json and injects Android Google Maps API key
 * from GOOGLE_MAPS_API_KEY so the native Maps SDK can find it in the manifest.
 * Set GOOGLE_MAPS_API_KEY in EAS secrets or .env for builds.
 */
const appJson = require('./app.json');

module.exports = ({ config }) => {
  // EAS may pass the expo block only (no .expo wrapper); support both shapes.
  const expoBlock = config?.expo ?? config ?? appJson.expo;

  // Prefer ANDROID_GOOGLE_MAPS_API_KEY (EAS secret/env), fall back to legacy name.
  const mapsApiKey =
    process.env.ANDROID_GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    '';

  const plugins = (expoBlock.plugins || []).map((p) => {
    if (Array.isArray(p) && p[0] === 'react-native-maps') {
      return [
        'react-native-maps',
        {
          androidGoogleMapsApiKey: mapsApiKey,
        },
      ];
    }
    return p;
  });

  const androidConfig = {
    ...expoBlock.android,
    config: {
      ...(expoBlock.android?.config || {}),
      googleMaps: { apiKey: mapsApiKey },
    },
  };

  return {
    expo: {
      ...expoBlock,
      android: androidConfig,
      plugins,
    },
  };
};
