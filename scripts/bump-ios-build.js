/**
 * Increment expo.ios.buildNumber in app.json so each EAS build gets a new build number.
 * Run before: eas build --platform ios
 */
const fs = require('fs');
const path = require('path');

const appJsonPath = path.join(__dirname, '..', 'app.json');
const app = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));

if (!app.expo || !app.expo.ios) {
  console.error('app.json: expo.ios not found');
  process.exit(1);
}

const current = app.expo.ios.buildNumber;
const next = String((parseInt(current, 10) || 0) + 1);
app.expo.ios.buildNumber = next;

fs.writeFileSync(appJsonPath, JSON.stringify(app, null, 2) + '\n', 'utf8');
console.log('iOS build number: %s -> %s', current, next);
