# Hub-Mind Android Release & Signing Status

- **Application ID**: `com.aistudio.hubmind.wzyqkp`
- **Version Name**: `2.4.0`
- **Version Code**: `240`
- **Canonical Firebase Project**: `gen-lang-client-0197530608`
- **Canonical Firestore Database**: `ai-studio-hubmind-4cac2024-c6eb-4208-80cf-928714dfd430`
- **In-App Update Manifest**: `/api/app-version.json` (`https://hub-mind.netlify.app/api/app-version.json`)

## Signing Configuration (`/android/app/build.gradle.kts`)
- **Debug Builds (`assembleDebug`)**: Signed with `android/debug.keystore` for local sideloading and on-device testing.
- **Release Builds (`assembleRelease`)**: Never signed with `debug.keystore`. Release signing is enabled strictly when a dedicated private release keystore is supplied via environment variables (`HUBMIND_RELEASE_STORE_FILE`, `HUBMIND_RELEASE_STORE_PASSWORD`, `HUBMIND_RELEASE_KEY_ALIAS`, `HUBMIND_RELEASE_KEY_PASSWORD`) or `android/keystore.properties` (excluded from Git via `.gitignore`).

## Building the APK Locally or in CI
```bash
cd android
./gradlew testDebugUnitTest assembleDebug assembleRelease
```
