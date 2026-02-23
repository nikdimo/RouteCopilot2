const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

const CONFIG_CHANGES = 'keyboard|keyboardHidden|orientation|screenSize|uiMode';

/**
 * Set android:configChanges on the main Activity so the app is not destroyed
 * on orientation/screen size change. Prevents crash when rotating the device
 * (e.g. with react-native-maps on screen).
 * Merges with any existing configChanges so other plugins are not overwritten.
 */
function setConfigChanges(androidManifest) {
  const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(androidManifest);
  const existing = mainActivity.$['android:configChanges'] || '';
  const merged = [...new Set([...existing.split('|'), ...CONFIG_CHANGES.split('|')].filter(Boolean))].join('|');
  mainActivity.$['android:configChanges'] = merged;
  return androidManifest;
}

function withAndroidConfigChanges(config) {
  return withAndroidManifest(config, (config) => {
    config.modResults = setConfigChanges(config.modResults);
    return config;
  });
}

module.exports = withAndroidConfigChanges;
