# Loom for Android

Loom's Android app renders the conversation, Computer Modern text, KaTeX, and interactive lessons on the phone. It connects to desktop Loom for subscription model responses, Jev checks, and the shared textbook library. It does not contain provider credentials or a server that runs subscription CLIs on Android.

## Install and pair

1. Install the signed `loom-android-0.1.0.apk` from the GitHub release. Android may ask you to allow installation from the browser or file manager you use.
2. Relaunch the updated desktop Loom. Open **Settings → Phone → Enable phone connection**.
3. Keep the computer and phone on the same Wi-Fi, or on a private VPN that gives them reachable IPv4 addresses. Keep desktop Loom open.
4. Open Android Loom, choose **Connect desktop**, scan the QR code, and press **Connect**. You can also paste the code copied from the desktop. Scanning or opening a `loom://pair` link fills the form; it does not authorize pairing by itself.
5. If several addresses appear in desktop Settings, choose the computer's Wi-Fi or reachable VPN address before scanning. Windows Firewall may require allowing Loom on your private network.

The phone shows the desktop's projects, chats, model catalog, and supported thinking levels. **Enter** sends or steers a response; **Shift+Enter** inserts a line break. Use the attachment button for Android's file picker. PDFs and images have previews. Project files can be read from Settings. Projects and disk folders created on the phone are stored on the computer.

Opened lessons and their interaction state are cached privately on the phone. They remain readable and interactive after an offline restart. Exact quizzes run locally. Free-form Jev checks and new model responses require the desktop connection. Offline lesson answers sync on reconnect; they do not trigger an automatic model request. The local Signal lab sample also works before pairing.

To revoke phones, use **Revoke paired phones** in desktop Settings. This ends their streams and replaces the pairing token. **Disable phone connection** closes the listener. **Forget desktop and cached lessons** on Android removes the local pairing and lesson cache.

## Platform limits

- Android 8.0 (API 26) or later, with an updated Android System WebView that supports the origin-scoped message bridge.
- This release is a desktop companion. It has no independent subscription sign-in, remote relay, background model service, voice chat, or dictation.
- The desktop computer must remain awake and reachable for models, shared files, and Jev. Switching Android apps pauses its event connection; returning refreshes state rather than replaying model requests.
- Attachments are limited to 20 MB per file and ten per message. PDF parsing and rendering happen on the desktop; opened lesson HTML renders locally.
- Offline storage is bounded. Older unopened or evicted lessons need the computer again. The phone is a cache of the desktop workspace, not a full backup.
- Model availability, thinking, and speed options depend on the desktop provider catalog. Account sign-in and provider/judge configuration remain in desktop Settings.
- Tests use an Android 16 emulator. Physical devices, OEM camera implementations, and all Android versions are not yet verified.

## Build

Install Node 24+, JDK 17 or 21, and an Android SDK with platform 36 and build tools 35/36. Set `JAVA_HOME` and `ANDROID_HOME` if they are not in the local Loom tooling directory. No Autoum checkout is required.

```sh
npm ci
npm run typecheck
npm run apk           # signed release APK
npm run apk:debug     # debuggable local test APK
```

Artifacts and their SHA-256 files appear in `release/android/`. The Gradle wrapper pins 8.13 and verifies its published distribution checksum. The native build uses AGP 8.13.2 and targets API 36.

The release build creates and reuses a private signing key under `~/.local/share/loom-android-signing/`, outside the repository. `LOOM_ANDROID_SIGNING_DIR` can select another private directory. Back up that directory privately: Android updates must use the same key. The key and password are never application assets, Git files, or release attachments. Do not delete them between builds.

With an Android emulator/device visible to `adb`, install the debug APK and run:

```sh
adb install -r release/android/loom-android-0.1.0-debug.apk
ANDROID_SERIAL=emulator-5554 node --import tsx tests/android-e2e.ts
```

The test clears only the selected device's Loom test installation. It uses temporary local TLS/provider/classifier fixtures, checks native file uploads one at a time, and makes no paid model requests. `test-results/android-e2e-report.json` records results and measured interaction times.

The signed release also passes the same 20 checks with `--release` on a userdebug emulator. That option clears the emulator's release app data and refuses physical devices. Chromium forces WebView inspection on userdebug Android builds; the release APK itself has no debuggable flag and rejects `run-as`. On the Android 16 emulator, the release painted content in 1.24 seconds and updated a lesson slider in 18 ms. These are local emulator measurements, not guarantees for every phone or provider.

The packaged desktop pairing checks use `node --import tsx tests/phone-desktop.ts` after `npm run package`. They cover the real worker, projects and disk folders, attachments, draft updates, saved lessons, desktop restart, revocation, and disabling the listener.

## Security boundary

The desktop listener is disabled by default. Enabling it creates a private certificate and random bearer token. Its HTTPS API accepts authenticated local/private-VPN peers, rejects browser-origin requests, and excludes account sign-in/import and arbitrary disk-open actions. Pairing codes are sensitive while valid; share the APK, not your pairing code.

Android pins the exact desktop certificate and rejects changed pins, expired certificates, redirects, and public pairing addresses. Its token stays in native preferences encrypted with an Android Keystore AES-GCM key. Backups and device transfers of app data are excluded.

The main UI loads from Android's local asset origin and retains a strict script policy. Generated lesson documents load from a separate, intercepted local origin, in `allow-scripts` sandbox frames. Their CSP blocks network connections, forms, and nested frames. The native bridge accepts only the trusted asset origin **and the main frame**; generated HTML cannot use it. Bundled fonts, math, figures, and scripts remain available to the lesson. No `addJavascriptInterface`, unrestricted plugin bridge, or SSL-error bypass is used.

Sources: [Android WebView native bridge guidance](https://developer.android.com/develop/ui/views/layout/webapps/native-api-access-jsbridge), [WebViewAssetLoader](https://developer.android.com/reference/androidx/webkit/WebViewAssetLoader), [WebMessageListener](https://developer.android.com/reference/androidx/webkit/WebViewCompat.WebMessageListener), [Android Keystore](https://developer.android.com/privacy-and-security/keystore).
