# Android integration handoff

Source: https://github.com/Jaystarbliss-studios/HUB-MIND-ANDROID (main, commit 798e2993b3e48236ea1308d617eb6afb62f25262)
Destination: /android in https://github.com/jaystarbliss-dynamic-hub/HUB-MIND

This directory preserves the Android-native project and its Android/Jess integration documents. It intentionally excludes the source repository's duplicated web/Electron application, generated .gradle cache, and temporary AI Studio media artifacts. The original Hub-Mind root remains authoritative for web, Electron, backend, Firebase rules, Gemini server configuration, and desktop native execution.

## Critical audit findings (verified from source)

1. Android repositories are mostly mocks:
   - MainActivity starts with isAuthenticated = true.
   - AuthRepositoryImpl fabricates users and grants roles using hard-coded email checks.
   - Google sign-in uses a literal mock token.
   - ConversationRepositoryImpl and DeviceRegistryRepositoryImpl use hard-coded sample data.
   - DeviceControlRepositoryImpl returns success after a delay without executing a remote command.
   - HubMindControlPlaneTransportImpl reports connected/success without network I/O.
   - PermissionStatusRepositoryImpl initializes microphone/notification flags as granted.
2. Android Gradle dependencies contain no Firebase Auth, Firestore, Google Sign-In, Firebase BoM, Gemini client, Retrofit/OkHttp, or WebSocket libraries. There is no Google Services Gradle plugin setup and no google-services.json.
3. VoiceInteractionManager currently wraps Android SpeechRecognizer and TextToSpeech. It does not connect to the Hub-Mind Gemini Live flow.
4. The original root has `GET /api/config` in `netlify/functions/config.ts` and authenticated `POST /api/live-token` in `netlify/functions/live-token.mjs`. The latter verifies a Firebase ID token and uses server-side GEMINI_API_KEY to mint a short-lived Live token.
5. The root `netlify.toml` routes `/api/live-token` to a Netlify Function but does not route `/api/live-ws`. The persistent `/api/live-ws` WebSocket handler exists in root `server.ts`, but that does not make it available through Netlify Functions. Verify production hosting before choosing the Android Live transport.
6. The root config function contains fallback values including `dev-api-key`. Android must reject placeholder config; the backend should fail closed rather than silently return fake Firebase configuration.
7. The documented Android release version (2.4.0 / code 240) does not match app/build.gradle.kts (1.0.0 / code 1). The release signing config points at a debug keystore.
8. No Gradle wrapper scripts, wrapper JAR, or wrapper properties are committed, so the claimed earlier compile checks cannot be independently reproduced from this repository as committed.
9. Android status documents identify server routes and an Electron Firestore command listener as required work, not completed work. Verify the original root before implementing; do not blindly duplicate backend or Electron code into this subtree.

## Required integration direction

- Keep the original Hub-Mind root as the source of truth for backend routes, Firebase project/configuration, Firestore rules, Gemini credentials, Jess system prompts, and desktop native execution.
- Treat this directory as the Android native client/module only. Use Firebase client authentication and short-lived server-issued Gemini Live credentials. Never embed Gemini API keys, Firebase service-account credentials, or admin secrets in the APK.
- Replace every mock repository/transport with real implementations and fail closed when authentication, device registration, or transport is unavailable.
- Preserve shared Jess identity, user-scoped conversation/memory model, device registry, and command-envelope semantics, but verify schemas and Firestore rules against the original root before writing.
- Integrate Android-native capabilities through explicit user-granted Android APIs. Add permission onboarding, revocation handling, action confirmation, and execution audit logs.
- Add a reproducible Gradle wrapper, CI build, debug APK build, separately signed release build, and physical-device test evidence before publishing an APK.
- Publish only a tested signed APK to the Hub-Mind website. Do not label a debug build or untested artifact as a release.

10. The original root `firestore.rules` has no match rules for `devices`, `deviceCommands`, or `jessActiveSession`; `server.ts` has no `/api/devices/dispatch` route; and `electron/main.cjs` has no `deviceCommands` listener. The cross-device registry/dispatch/Windows receiver described in architecture documents is therefore not yet implemented in the original root.
