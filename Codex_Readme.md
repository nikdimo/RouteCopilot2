# Codex Session Context (Read First)

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
