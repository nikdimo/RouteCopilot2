# Android build: how to check what happened

If you still see the same issues after installing a new APK (tab bar under system buttons, list under tab bar, crash on rotation, map not on right), use this to verify what’s actually running and what to try next.

---

## 1. Confirm you’re on the latest build

**In the app:** Open the **Dev** tab, scroll to the bottom. You should see:

**Build: 2025-02-android-fixes**

- If you **don’t** see that line → you’re still on an **old** build. Uninstall the app, download the **new** APK from the latest EAS build, and install again.
- If you **do** see it → the new JS bundle is running. The problem is then either native (manifest/insets) or device-specific; continue below.

---

## 2. Verify which EAS build you installed

1. Go to [expo.dev](https://expo.dev) → your project → **Builds**.
2. Find the **Android** build you used (e.g. “preview”, “APK”).
3. Note the **build date/time** and **commit** (e.g. “Commit: abc123”).
4. On your PC, in the project folder run:
   ```powershell
   cd "c:\Users\Nikola Dimovski\RouteCopilot2"
   git log -1 --oneline
   ```
   The latest commit should match (or be after) the commit shown for that build. If the build is from an older commit, run a **new** EAS build after committing the latest code and install that APK.

---

## 3. Clean install (avoid old cache)

1. On the phone: **Uninstall** the WisePlan app completely.
2. Restart the phone (optional but can clear UI/inset cache).
3. Download the APK again from the **latest** EAS build (step 2).
4. Install and open the app.

---

## 4. What we changed (for reference)

| Fix | Where | What to expect |
|-----|--------|----------------|
| Tab bar above system nav | `AppNavigator.tsx` – `TabBarWithSafeArea` with `paddingBottom: max(insets.bottom, 24)` on Android | Schedule/Map/+/Profile/Dev bar above back/home/recent. |
| List above tab bar | `ScheduleScreen.tsx` – `listBottomPadding = max(100, tabBarHeight + insets.bottom + 16)` | Last route card fully visible above the tab bar. |
| Map pane right inset | `ScheduleScreen.tsx` – `paddingRight: insets.right` on map pane in wide layout | In landscape, map not under the right edge. |
| No crash on rotation | `plugins/withAndroidConfigChanges.js` → `android:configChanges` in `AndroidManifest.xml` | Rotating to landscape does not crash. |
| Map on right in landscape | Same + `key` on embedded MapScreen so it remounts on size change | Schedule left, map right when rotated. |

---

## 5. If the build tag is correct but issues remain

Then the running code is the new one; remaining causes can be:

- **Insets on your device:** Some Android builds report 0 for bottom inset (e.g. gesture nav). We added a minimum of 24px on Android for the tab bar. If it’s still under the system bar, we may need to raise that minimum (e.g. 32 or 48).
- **Rotation crash:** EAS runs `expo prebuild` in the cloud; the config plugin should add `configChanges` to the manifest. If it still crashes on rotate, we can double-check that the **built** `AndroidManifest.xml` in the EAS build artifact contains `android:configChanges="...orientation|screenSize..."`. You can download the build artifact from EAS and inspect `android/app/src/main/AndroidManifest.xml`.
- **Map not showing on right:** If rotation doesn’t crash but the map doesn’t appear on the right, the breakpoint (width ≥ 600) might not be met on your device in landscape, or there could be a layout bug; we can add a smaller breakpoint or logs next.

---

## 6. Next steps you can take

1. **Commit and run a new EAS build** (so the “Build: 2025-02-android-fixes” and the minimum 24px tab bar inset are included):
   ```powershell
   cd "c:\Users\Nikola Dimovski\RouteCopilot2"
   git add -A
   git commit -m "Android: build tag, min 24px tab bar inset, debugging doc"
   eas build --platform android --profile preview
   ```
2. **After the build:** Download the new APK, **uninstall** the old app, install the new APK.
3. **Check:** Open **Dev** tab → scroll to bottom → confirm **Build: 2025-02-android-fixes**.
4. **Report back:**  
   - Do you see the build tag?  
   - Which of the issues still happen (tab bar under system nav, list under tab bar, crash on rotate, map not on right)?

That will tell us whether the problem is “wrong/old build” or “fixes not enough on this device” so we can adjust (e.g. higher minimum inset, or checking the built manifest).
