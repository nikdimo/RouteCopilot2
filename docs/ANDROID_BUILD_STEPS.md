# Get a new Android build with all fixes

Use this to get an APK on your phone where:
- Nothing is hidden behind the system buttons (tab bar and list content sit above them)
- Map screen works
- App does not crash when you rotate the phone
- In landscape, the map shows on the right side

---

## Prerequisites

- Node.js and npm installed
- Android phone with USB debugging **or** you will download the APK from EAS and install it
- (Optional) EAS CLI: `npm install -g eas-cli` and logged in (`eas login`)

---

## Step 1: Open the project in a terminal

1. Open **PowerShell** or **Command Prompt**.
2. Go to the project folder:
   ```text
   cd "c:\Users\Nikola Dimovski\RouteCopilot2"
   ```

---

## Step 2: Install dependencies (if needed)

1. Run:
   ```text
   npm install
   ```
2. Wait until it finishes without errors.

---

## Step 3: Commit your changes (required for EAS Build)

1. Check status:
   ```text
   git status
   ```
2. Add all changed files:
   ```text
   git add -A
   ```
3. Commit:
   ```text
   git commit -m "Android: fix tab bar under system nav, list padding, rotation crash"
   ```
4. If you use a remote (e.g. GitHub), push:
   ```text
   git push origin master
   ```
   (EAS can require a clean git state; committing ensures the build uses the latest code.)

---

## Step 4: Build the Android APK with EAS (recommended)

EAS runs **prebuild** for you, so the rotation fix (config plugin) is applied.

1. Make sure EAS CLI is installed and you are logged in:
   ```text
   eas whoami
   ```
   If not logged in:
   ```text
   eas login
   ```

2. Start a **preview** build (produces an APK you can install directly):
   ```text
   eas build --platform android --profile preview
   ```

3. When prompted:
   - **Generate a new Android Keystore?** Choose **Yes** if this is the first time or you don’t have one; otherwise **No** if you already have a keystore.
   - Answer any other prompts as needed.

4. Wait for the build to finish (often 10–20 minutes). You can close the terminal; build runs in the cloud.

5. When it’s done, EAS will print a link to the build page. Open it in the browser, or run:
   ```text
   eas build:list --platform android --limit 1
   ```
   to see the latest build and its link.

6. On the build page, **download the APK** (e.g. “Download” button).

---

## Step 5: Install the APK on your phone

**Option A – Download on phone**

1. On the build page (from the link in step 4), open the build and tap **Download** (or open the download link on your phone).
2. Open the downloaded APK. If Android says “Install blocked”, allow installation from that source (e.g. “Chrome” or “Downloads”) in Settings.
3. Tap **Install**, then **Open**.

**Option B – USB**

1. Copy the downloaded APK to your phone (e.g. via cable, cloud, or email).
2. On the phone, open the APK file and install as above.

---

## Step 6: Verify on the phone

1. Open the app.
2. **Tab bar above system buttons:** The Schedule / Map / + / Profile / Dev bar should sit **above** the system back/home/recent buttons, not under them.
3. **List not hidden:** On “Today’s Route”, scroll to the last stop; the last card and its buttons should be fully visible above the tab bar.
4. **Map tab:** Open the **Map** tab; the map should load.
5. **Rotation:** On “Today’s Route”, rotate the phone to **landscape**. The app should **not** crash and should show the **map on the right** and the schedule on the left.

---

## If you build locally instead of EAS

If you prefer to build on your machine and have **Android SDK and Java (JAVA_HOME)** set up:

1. **Prebuild** (already done; run again if you change config plugins):
   ```text
   npx expo prebuild --platform android --clean
   ```

2. **Build release APK**:
   ```text
   cd android
   .\gradlew.bat assembleRelease
   ```
   The APK is at `android\app\build\outputs\apk\release\app-release.apk`.

   Or build and install via Expo (requires device/emulator):
   ```text
   npx expo run:android
   ```
   APKs are under `android/app/build/outputs/apk/`.

---

## Troubleshooting

- **“Require commit” / uncommitted changes:** Complete Step 3 (commit and push if you use a remote).
- **Build fails at prebuild:** Check the build log on the EAS page for the exact error (e.g. plugin or config).
- **Old APK still installed:** Uninstall the previous app from the phone, then install the new APK from the latest build.
- **Map or rotation still wrong:** Ensure you installed the APK from the build that was made **after** all the fixes (new EAS build or new local build after prebuild).

---

## Local `expo run:android` CMake patch setup (important)

For local Android builds, CMake fixes are tracked with `patch-package` so they survive `npm install`.

1. Keep these lines in `android/gradle.properties`:
   ```text
   org.gradle.parallel=false
   newArchEnabled=false
   ```
2. Keep `postinstall` in `package.json`:
   ```text
   "postinstall": "patch-package"
   ```
3. Required patch files:
   - `patches/expo-modules-core+3.0.29.patch`
   - `patches/react-native-reanimated+3.19.5.patch`
   - `patches/react-native-screens+4.16.0.patch`

If package versions change, regenerate patches for the same CMakeLists targets.
