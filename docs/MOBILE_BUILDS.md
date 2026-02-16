# WisePlan – Mobile Builds (EAS)

**Target:** TestFlight (iOS) and Google Play Internal Testing (Android)

---

## Prerequisites

1. **Expo account** – `npx eas login` (or create at expo.dev)
2. **Apple Developer** – $99/year for App Store / TestFlight
3. **Google Play** – $25 one-time for Play Console

---

## 1. Configure EAS (first time)

```bash
npm install -g eas-cli
eas login
eas build:configure
```

If `eas.json` already exists, you can skip `eas build:configure`.

---

## 2. Azure – Add native redirect URIs

In **Azure Portal** → App registration → **Authentication** → add:

| Platform | Redirect URI |
|----------|--------------|
| iOS/Android (Public client) | `wiseplan://auth` |

Or add as **Mobile and desktop applications** redirect URIs. The app uses `wiseplan://auth` (path required by Azure).

---

## 3. Build for iOS (TestFlight)

```bash
eas build --platform ios --profile production
```

First run: EAS will create credentials (Apple Distribution cert, provisioning profile). You may be prompted for your Apple ID and to create an app in App Store Connect.

After the build succeeds:

```bash
eas submit --platform ios --profile production
```

**Update `eas.json`** before submit with your real values:

```json
"submit": {
  "production": {
    "ios": {
      "appleId": "your@apple-id.email",
      "ascAppId": "1234567890"
    }
  }
}
```

- `appleId`: Your Apple ID email
- `ascAppId`: App Store Connect → Your app → App Information → Apple ID (numeric)

---

## 4. Build for Android (Play internal)

```bash
eas build --platform android --profile production
```

EAS creates a keystore for you. Build produces an AAB ( Android App Bundle).

**Submit to Play internal track:**

```bash
eas submit --platform android --profile production
```

First time: Create the app in [Google Play Console](https://play.google.com/console), then either:

- **Option A – Manual:** Download the AAB from the EAS build page and upload in Play Console → Internal testing
- **Option B – Automated:** Create a service account in Google Cloud, grant Play Console access, place `google-service-account.json` in project root, and set `eas.json`:

```json
"android": {
  "serviceAccountKeyPath": "./google-service-account.json"
}
```

---

## 5. Build profiles (`eas.json`)

| Profile     | Use                    |
|-------------|------------------------|
| `development` | Dev client, internal testing |
| `preview`    | Internal APK (Android) or IPA (iOS) – no store |
| `production` | App Store / Play Store builds |

**Quick internal test (no store):**

```bash
# Android APK – share via link
eas build --platform android --profile preview

# iOS – requires TestFlight or internal distribution
eas build --platform ios --profile preview
```

---

## 6. After first builds

1. **TestFlight:** Add testers in App Store Connect → TestFlight
2. **Play internal:** Add testers in Play Console → Internal testing
3. **Landing page:** Add download links on wiseplan.dk when builds are live

---

## 7. Troubleshooting

| Issue | Fix |
|-------|-----|
| `redirect_uri is not valid` on device | Add `wiseplan://auth` to Azure → Mobile and desktop applications |
| Apple credential errors | Run `eas credentials` and follow prompts |
| Android build fails | Ensure `package` in `app.json` is `com.wiseplan.app` |
| Submit fails – missing ascAppId | Create app in App Store Connect first, copy Apple ID |
