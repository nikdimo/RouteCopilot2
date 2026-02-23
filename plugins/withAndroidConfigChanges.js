const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

const CONFIG_CHANGES = 'keyboard|keyboardHidden|orientation|screenSize|uiMode';

/**
 * Set android:configChanges on the main Activity so the app is not destroyed
 * on orientation/screen size change. Prevents crash when rotating the device
 * (e.g. with react-native-maps on screen).
 */
function setConfigChanges(androidManifest) {
  const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(androidManifest);
  mainActivity.$['android:configChanges'] = CONFIG_CHANGES;
  return androidManifest;
}

function withAndroidConfigChanges(config) {
  return withAndroidManifest(config, (config) => {
    config.modResults = setConfigChanges(config.modResults);
    return config;
  });
}

module.exports = withAndroidConfigChanges;
