# Android integration handoff

Source: https://github.com/Jaystarbliss-studios/HUB-MIND-ANDROID (main, commit 798e2993b3e48236ea1308d617eb6afb62f25262)
Destination: /android in https://github.com/jaystarbliss-dynamic-hub/HUB-MIND

This directory preserves the Android-native project and its Android/Jess integration documents. It intentionally excludes the source repository's duplicated web/Electron application, generated .gradle cache, and temporary AI Studio media artifacts. The original Hub-Mind root remains authoritative for web, Electron, backend, Firebase rules, Gemini server configuration, and desktop native execution.

## Critical audit findings (verified from source)

1. Android repositories are mostly mocks:
   - AuthRepositoryImpl fabricates a signed-in user and hard-codes admin status by email.
   - MainActivity starts with isAuthenticated = true.
   - Google sign-in passes a literal mock token.
   - ConversationRepositoryImpl and DeviceRegistryRepositoryImpl contain hard-coded sample data.
   - DeviceControlRepositoryImpl reports success after a delay without executing remote commands.
   - HubMindControlPlaneTransportImpl reports connected/success without network I/O.
   - PermissionStatusRepositoryImpl initializes microphone and notification flags as granted.
2. Android Gradle dependencies contain no Firebase Auth, Firestore, Google Sign-In, Firebase BoM, Gemini client, Retrofit/OkHttp, or WebSocket libraries. There is no Google Services Gradle plugin setup and no google-services.json.
3. VoiceInteractionManager currently wraps Android SpeechRecognizer and TextToSpeech. It does not connect to Hub-Mind /api/live-token or /api/live-ws and is not a completed Gemini Live Jess client.
4. The manifest declares an AccessibilityService and a foreground service. These require explicit user consent and Android-version-specific compliance; never bypass lock screens, biometrics, or protected-app security.
5. Release docs state version 2.4.0 / code 240, while app/build.gradle.kts states version 1.0.0 / code 1. The release signing config points to a debug keystore and is not suitable for production.
6. No Gradle wrapper scripts, wrapper JAR, or wrapper properties are committed, so the claimed earlier compile checks cannot be independently reproduced from this repository as committed.
7. Source status documents identify backend routes and an Electron Firestore command listener as required work, not completed work. Verify the original Hub-Mind root before implementing; do not blindly duplicate server.ts, Firestore rules, or Electron code into this subtree.

## Required integration direction

- Keep the original Hub-Mind root as the source of truth for backend routes, Firebase project/configuration, Firestore rules, Gemini credentials, Jess system prompts, and desktop native execution.
- Treat this directory as the Android native client/module only. Use Firebase client authentication and short-lived server-issued Gemini Live credentials. Never embed Gemini API keys, Firebase service-account credentials, or admin secrets in the APK.
- Replace every mock repository/transport with real implementations and fail closed when authentication, device registration, or transport is unavailable.
- Preserve the shared Jess identity, user-scoped conversation/memory model, device registry, and command-envelope semantics, but verify schemas and Firestore rules against the original root before writing.
- Integrate Android-native capabilities through explicit user-granted Android APIs (AccessibilityService, intents, clipboard, foreground service, MediaProjection, notification access only where needed). Add permission onboarding, revocation handling, action confirmation, and execution audit logs.
- Add a reproducible Gradle wrapper, CI build, debug APK build, separately signed release build, and physical-device test evidence before publishing an APK.
- Publish only a tested signed APK to the Hub-Mind website. Do not label a debug build or untested artifact as a release.

## Build

Open this folder as a standalone Android Gradle project in Android Studio after adding a pinned Gradle wrapper compatible with the committed Android Gradle Plugin. Do not run the web app build from this folder.
