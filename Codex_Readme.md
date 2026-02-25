# Codex Session Context (Read First)

## Latest Session Update (2026-02-25)
- Android Studio APK build is now confirmed working end-to-end without recurring issues.
- Current baseline is stable for local debug APK generation; continue regular project work from this state.
- `Build_android.APK.nuclear.bat` refinements (evening):
  - Args: first arg numeric → port; otherwise AVD. Second arg (if present) is port.
  - PASS 1 pre-cleans locked build dirs: `android/app/build`, `android/build`, `node_modules\expo-constants|react-native-reanimated|react-native-svg\android\build`.
  - Nuke helper now retries via PowerShell delete after `takeown/icacls`; fixes `: was unexpected at this time` lock errors.
  - Label lookup robustness: build-env helper renamed to `BUILD_ENV_SETUP` and file re-saved as ASCII to avoid missing-label errors.
  - Emulator detection avoids `findstr` pipe to prevent `'C:\Users\Nikola' is not recognized` noise.
  - Requires elevated PowerShell; run from repo root: `.\Build_android.APK.nuclear.bat 8082` (or `"MyAVD" 8082`). UAC must be accepted for the run to proceed.

## Current Session Follow-Up (2026-02-25, later)
- Issue reported:
  - `Build_android.APK.nuclear.bat` kept restarting/re-entering NUCLEAR flow repeatedly.
- Work completed:
  1. Hardened admin detection in `Build_android.APK.nuclear.bat` using a PowerShell Administrator check (`WindowsBuiltInRole::Administrator`) instead of token-group matching.
  2. Added elevation sentinel argument `__ELEVATED__` to prevent recursive self-relaunch if elevation is not actually granted.
  3. Added NUCLEAR-run guard file:
     - `%TEMP%\RouteCopilot2.nuclear.inprogress.flag`
     - Script now blocks immediate repeated NUCLEAR runs and exits with a clear error (`exit /b 90`) when a prior run marker is still active.
  4. Added guaranteed cleanup of the NUCLEAR marker on all PASS 2 exits (success and failure paths).
  5. Reduced aggressive process killing in PASS 2:
     - Removed forced kills of `studio64.exe`, `studio.exe`, `code.exe`, `devenv.exe`.
     - Kept emulator + Java/Gradle/Node/ADB cleanup.
- Current status:
  - Script logic is patched to prevent infinite restart loops.
  - End-to-end behavior is now confirmed stable in your environment.
  - BAT build flow issues from this thread are treated as completed.

## Current Open Issue (2026-02-25, latest)
- Platform/scope:
  - Android emulator only (APK/dev client path).
- What works:
  - Route data loads correctly (appointments/waypoints/polyline/OSRM present in Route QC overlay).
  - Map camera bounds/fit works (date change zooms to the correct region).
  - Real Android device and web render route overlays correctly.
- What fails (emulator only):
  - Route polyline is not visible.
  - Route markers/waypoints are not visible.
  - Only base map tiles are visible.
- Current conclusion:
  - Data and fit logic are working; rendering of map overlays (Polyline/Marker layer) was failing specifically on Android emulator.
  - A targeted fix has now been applied in code and is pending emulator verification.

## Map Overlay Fix Applied (2026-02-25, latest)
- Implemented changes:
  1. `src/screens/MapScreen.tsx`
     - Forced Android map to Google provider + legacy renderer:
       - `provider={PROVIDER_GOOGLE}`
       - `googleRenderer="LEGACY"`
     - Added Android `mapReady` safety fallback timer (1600 ms) so overlays are not permanently blocked if native ready callbacks are flaky.
     - Added `onMapLoaded={() => setMapReady(true)}` as an extra native-ready signal.
     - Added `mapReady` to Route QC overlay for live debugging.
  2. `src/components/PlanVisitMapPanel.tsx`
     - Applied same Android provider + legacy renderer settings for consistency.
  3. `src/components/MapPreviewModal.tsx`
     - Applied same Android provider + legacy renderer settings for consistency.
- Scope:
  - Rendering-path fix only. No route data / OSRM / bounds calculation logic was changed.
- Verification status:
  - Pending full emulator retest on your machine.
  - Local `tsc` run in this shell failed due runtime/tooling limits (Node OOM and TypeScript stack overflow), so static type-check completion is not yet available from this session.

## Pending Security Follow-Up (Google Maps Key)
- Status:
  - Old hardcoded key was removed from tracked config.
  - EAS secret `ANDROID_GOOGLE_MAPS_API_KEY` is configured with a new key.
- Do later (required for secure production use):
  1. In Google Cloud Console, use key restriction type `Android apps` (not `Websites`).
  2. Add package name: `com.wiseplan.app`.
  3. Add SHA-1 fingerprints:
     - Debug SHA-1 (local/dev):
       - `keytool -list -v -keystore "%USERPROFILE%\.android\debug.keystore" -alias androiddebugkey -storepass android -keypass android`
     - Release SHA-1 (EAS/Play): from Play Console > App Integrity (App signing certificate).
  4. Keep API restrictions minimal:
     - Map render key: `Maps SDK for Android` only.
     - If Google address search is used, prefer a separate key for `Places API (New)` + `Geocoding API`.
- Notes:
  - Do not store Google Maps key in `telegram-bot/.env`.
  - Local shell for Android builds can set:
    - `$env:ANDROID_GOOGLE_MAPS_API_KEY="<YOUR_KEY>"`

## Goal
- Get local Android dev build running reliably on emulator (Expo dev client).
- Persist native CMake fixes through `npm install`.

## What Was Done
- Added required Android Gradle flags in `android/gradle.properties`:
  - `org.gradle.parallel=false`
  - `newArchEnabled=false`
- Added `patch-package` workflow:
  - `postinstall` script in `package.json`: `"patch-package"`
  - Created patches:
    - `patches/expo-modules-core+3.0.29.patch`
    - `patches/react-native-reanimated+3.19.5.patch`
    - `patches/react-native-screens+4.16.0.patch`
- Verified patch apply flow:
  - `npm install` runs `postinstall` and applies all 3 patches.
  - `npx patch-package --error-on-fail` succeeds.
- Added docs note in `docs/ANDROID_BUILD_STEPS.md` about patch-package and required gradle flags.
- Created commit with patch setup:
  - `434959f` (`android: persist CMake fixes with patch-package`)

## Current Runtime Notes (Emulator)
- Metro may auto-switch ports if busy (`8083` -> `8084`).
- If app is stuck on white screen / `Bundling 100%...`, treat as stuck after ~2 minutes.
- Preferred clean relaunch flow:
  1. Keep Metro terminal open on chosen port.
  2. Run:
     - `adb reverse --remove-all`
     - `adb reverse tcp:<PORT> tcp:<PORT>`
     - `adb shell am force-stop com.wiseplan.app`
     - `adb shell am start -a android.intent.action.VIEW -d "exp+wiseplan://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A<PORT>" com.wiseplan.app`

## Important
- Do not remove the 3 patch files or `postinstall: patch-package`.
- Keep the two gradle flags above for local Android dev stability.

## Latest Local Build Notes (2026-02-24)
- Java: use JDK 17 installed at `C:\Program Files\Microsoft\jdk-17.0.18.8-hotspot`. `android/gradle.properties` already pins `org.gradle.java.home` to this; keep it.
- Environment to set per shell before building:
  - `JAVA_HOME` = `C:\Program Files\Microsoft\jdk-17.0.18.8-hotspot`
  - `ORG_GRADLE_JAVA_HOME` same as `JAVA_HOME`
  - `ANDROID_HOME` / `ANDROID_SDK_ROOT` = `%LOCALAPPDATA%\Android\Sdk`
  - `ANDROID_USER_HOME` = `C:\AndroidPrefs\RouteCopilot2` (shared writable prefs path)
  - Ensure `ANDROID_PREFS_ROOT` and `ANDROID_SDK_HOME` are unset (Machine and User scope) to avoid Android prefs path conflicts.
  - `GRADLE_USER_HOME` = `<repo>\.gradle`
  - `NODE_ENV` = `development`
  - `KOTLIN_COMPILER_EXECUTION_STRATEGY` = `in-process`
  - `ANDROID_GOOGLE_MAPS_API_KEY` set to a real key (needed for MapView; app.config.js injects it into manifest and react-native-maps plugin).
- Clean stuck build artifacts before rerun (prevents "Unable to delete directory ...intermediates\javac"):
  - `rmdir /s /q node_modules\react-native-reanimated\android\build`
  - `rmdir /s /q node_modules\react-native-svg\android\build`
  - If Windows refuses to delete, `Rename-Item build build_old` then `robocopy empty_dir build_old /MIR` and delete; closing Android Studio/antivirus helps.
- Build locally (dev client, no JS bundle):
  - `cd android`
  - `.\gradlew.bat app:assembleDebug -x lint -x test --configure-on-demand --build-cache -PreactNativeDevServerPort=8082 -PreactNativeArchitectures='x86_64,arm64-v8a'`
- After build succeeds:
  - Install: `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`
  - Start Metro: `npx expo start --port 8082`
  - Reverse + launch dev client:
    - `adb reverse --remove-all`
    - `adb reverse tcp:8082 tcp:8082`
    - `adb shell am force-stop com.wiseplan.app`
    - `adb shell am start -a android.intent.action.VIEW -d "exp+wiseplan://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8082" com.wiseplan.app`
- Status: build runs through Gradle with JDK 17. Android Studio APK build is now working reliably without issues.

## Resolved Windows Env/ACL Issues (2026-02-24, later session)
- Root cause found:
  - Machine-level `ANDROID_PREFS_ROOT` and `ANDROID_SDK_HOME` were set to `C:\Users\Nikola Dimovski\.android`.
  - Codex build user (`desktop-1ngo64l\codexsandboxoffline`) could not write there, causing `analytics.settings` access errors and AGP init failures.
- Permanent env fix applied:
  - Removed Machine vars:
    - `[Environment]::SetEnvironmentVariable('ANDROID_PREFS_ROOT', $null, 'Machine')`
    - `[Environment]::SetEnvironmentVariable('ANDROID_SDK_HOME',  $null, 'Machine')`
  - Also remove User-scope values for same two vars if present.
  - Use only `ANDROID_USER_HOME` for prefs location.
- Shared writable prefs path created:
  - `C:\AndroidPrefs\RouteCopilot2`
  - ACL granted to local Users group (`*S-1-5-32-545`) with modify rights.
- Old blocked file cleanup:
  - Removed `C:\Users\Nikola Dimovski\.android\analytics.settings` after env migration.
- Additional locked-folder fix:
  - If build fails in `react-native-screens:mergeDebugNativeLibs` with `AccessDeniedException`, stop Gradle/Java and delete:
    - `node_modules\react-native-screens\android\build`
  - Reset ownership/ACL first if needed (`takeown` + `icacls`), then rebuild.
- Defender exclusions added to reduce random file-lock failures:
  - `C:\Users\Nikola Dimovski\RouteCopilot2`
  - `C:\AndroidPrefs\RouteCopilot2`
  - `C:\Users\Nikola Dimovski\.android`
  - `C:\Users\Nikola Dimovski\.gradle`
  - Android SDK + Android Studio paths

## Known-Good Build Shell Setup
- In a fresh PowerShell session before build:
  - `$env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-17.0.18.8-hotspot"`
  - `$env:ORG_GRADLE_JAVA_HOME = $env:JAVA_HOME`
  - `$env:ANDROID_PREFS_ROOT = $null`
  - `$env:ANDROID_SDK_HOME = $null`
  - `$env:ANDROID_USER_HOME = "C:\AndroidPrefs\RouteCopilot2"`
  - `$env:ANDROID_SDK_ROOT = "$env:LOCALAPPDATA\Android\Sdk"`
  - `$env:ANDROID_HOME = $env:ANDROID_SDK_ROOT`
  - `cd android`
  - `.\gradlew.bat --stop`
  - `.\gradlew.bat :app:assembleDebug --no-daemon --stacktrace`
