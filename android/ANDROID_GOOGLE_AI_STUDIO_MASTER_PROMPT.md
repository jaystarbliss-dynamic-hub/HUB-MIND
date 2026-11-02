# Google AI Studio Master Prompt — Complete Hub-Mind Android Integration

You are continuing the EXISTING Hub-Mind project in this repository. The original Hub-Mind application is the canonical project. A new `/android` directory has been added containing the native Android application and its prior architecture, integration, testing, and release work. Do not create a second Hub-Mind product, a second Firebase project, a second Gemini identity, or a disconnected mobile assistant.

## Mission

Finish the Android application so it behaves as the mobile endpoint of the SAME Hub-Mind and the SAME assistant, Jess, that already works in the original web/Windows desktop application. Deliver a reliable, installable, privately distributed Android APK and prepare a safe download/update path on the existing Hub-Mind website.

The Android app must use the existing Hub-Mind Firebase project, Firestore database, account model, backend APIs, Gemini configuration, Jess instructions, tool policy, memory, conversations, and cross-device identity. The Android app must have genuine native Android functionality, not mock responses or simulated success.

## Non-negotiable repository rules

1. Read the original root project before changing anything. Inspect `package.json`, `server.ts`, `netlify.toml`, `netlify/functions/config.ts`, `netlify/functions/live-token.mjs`, `netlify/functions/chat.ts`, `src/firebaseConfig.ts`, `src/services`, `src/lib/jessTools.ts`, `src/shared/jessNativeToolNames.ts`, `electron/main.cjs`, `electron/preload.cjs`, `electron/agentBridge.cjs`, and `firestore.rules`.
2. Read every file in `/android`, especially `INTEGRATION_HANDOFF.md`, the architecture/status/test-readiness docs, Android Gradle files, manifest, repositories, transport, voice manager, accessibility service, and UI/viewmodels.
3. Preserve the existing root application and desktop behavior. Do not replace working root code with Android copies. Do not duplicate the web app, Electron app, backend server, or Firestore rules inside `/android`.
4. `/android` is the native Android project. Keep its build files and native Kotlin code self-contained there. Shared contracts and prompt/tool definitions should be reused from the root through a deliberate, testable boundary rather than copied into competing versions.
5. Work in small, reviewable phases. Build and test after each phase. Keep a written audit of changed files, tests, failures, and unresolved blockers. Do not report a feature as working because a UI element exists or a mock test passes.
6. Do not commit secrets, signing keys, keystores, service-account JSON, Gemini API keys, OAuth client secrets, bearer tokens, or production credentials. Do not print secret values in logs or reports.

## Verified starting-point defects to fix first

The current Android source contains critical mock implementations. Treat these as release blockers:
- `MainActivity` initializes `isAuthenticated = true`; authentication must be real and required.
- `AuthRepositoryImpl` fabricates user identities and hard-codes admin access; remove this mock path.
- Google sign-in passes a literal mock token; implement real Android Google sign-in and Firebase credential exchange.
- `ConversationRepositoryImpl` and `DeviceRegistryRepositoryImpl` use hard-coded sample data; connect to the real user's Firestore data.
- `DeviceControlRepositoryImpl` waits and returns success without executing a command; replace it with real command routing and verified execution.
- `HubMindControlPlaneTransportImpl` marks itself connected and returns success without network I/O; implement authenticated transport and real acknowledgements.
- `PermissionStatusRepositoryImpl` initializes microphone/notification permissions as granted; derive every permission from Android's actual runtime/service state.
- `VoiceInteractionManager` currently uses SpeechRecognizer + TextToSpeech only; it is not connected to Jess/Gemini Live.
- Android Gradle dependencies currently do not include Firebase Auth/Firestore, Google sign-in, Gemini Live transport, Retrofit/OkHttp, or required WebSocket dependencies.
- There is no Gradle wrapper committed. Add a pinned, reproducible wrapper and CI build.
- `app/build.gradle.kts` currently says versionCode 1/versionName 1.0.0, while the release document claims 240/2.4.0. Reconcile versioning and document the chosen baseline.
- Release signing currently points at a debug keystore. Remove this from release configuration. Require a private signing keystore supplied through secure local/CI secrets.
- Validate package namespace/applicationId and all manifest resource references. Ensure all declared Android services have the correct metadata and lifecycle.

## Firebase and Gemini integration: use the original backend

The original project already has:
- `GET /api/config`, implemented by `netlify/functions/config.ts`, for runtime Firebase client configuration.
- `POST /api/live-token`, implemented by `netlify/functions/live-token.mjs`, which requires a Firebase ID token, verifies the user, and mints a short-lived Gemini Live ephemeral token using server-side `GEMINI_API_KEY`.
- Existing chat/backend code and Jess tool definitions in the original root.
- The Firebase project/database settings and security rules in the original root.

Implement Android against these canonical services. Verify actual deployed environment values and runtime responses; do not assume defaults are production credentials.

Important security distinction:
- Firebase client API key/config is public client configuration and may be delivered at runtime to initialize the Android Firebase client.
- `GEMINI_API_KEY` is a server secret. It MUST remain on the server. Android must call authenticated `/api/live-token` and use the short-lived ephemeral token for Live sessions. Never embed the Gemini key in Kotlin, BuildConfig, resources, assets, APK, or Git.
- The existing `/api/config` function has development fallback values such as `dev-api-key`. Fail closed on Android if config is missing, invalid, or contains a placeholder. Do not silently initialize Firebase with fake values. Review/fix the server fallback so production deployment cannot serve a fake configuration as if it were valid.
- Initialize Android Firebase against the same project ID and Firestore database ID returned by the original config endpoint. Use Firebase Android SDKs with a deliberate runtime configuration strategy or the correct generated Android app configuration. Do not create a second Firebase project.
- Firebase Auth is the source of truth for signed-in identity. Read the user profile from the existing `users/{uid}` schema and enforce existing account status/role rules. Do not grant admin based only on a client-side email check.
- Use authenticated ID tokens for backend requests. Verify authorization server-side. Respect Firestore rules. Do not weaken rules to make the app work.

## Jess voice and intelligence

Make Jess the SAME assistant across Web, Windows desktop, and Android:
- Reuse the canonical Jess system prompt, identity, personality, user recognition, safety/approval policy, tool definitions, conversation schema, memory schema, and execution semantics from the root.
- The Android client must support real text chat and natural voice conversation. Implement microphone capture, streaming audio input, partial transcript, response audio playback, interruption/barge-in, cancellation, reconnect, timeouts, and clear live states.
- Use the existing `/api/live-token` flow. Connect the native Android Live client with the short-lived token and the correct Gemini Live API protocol/model. If the existing production deployment cannot support the WebSocket architecture, do not pretend Netlify Functions support a persistent WebSocket. Either connect Android directly to Gemini Live using the ephemeral token, or deploy a separate authenticated WebSocket-capable relay and document its URL/configuration.
- Inspect how the original desktop app connects to Jess Live before choosing the Android protocol. Preserve protocol compatibility where appropriate.
- Jess must be able to call tools. Implement a native Android tool executor for phone-local capabilities and a cross-device dispatcher for Windows tools. Advertise only capabilities that are actually available and authorized on the target device.
- The same conversation should remain available when the user moves between phone and PC. Use the original conversation/message schema; do not create a separate Android-only history or memory silo.
- Use the existing cross-client session lease behavior where applicable so two devices do not unexpectedly speak over each other. Respect lease expiration, renewal, handoff, and release.

## Native Android control engine

Build the native Android capability layer inside `/android`. Use the existing Kotlin files as a starting point, not as proof that every capability works. Audit and test each action:
- App discovery and launching through Android intents/PackageManager.
- Accessibility hierarchy inspection and semantic node actions.
- Tap, double tap, long press, swipe, scroll, text entry, back/home/recents, notifications/quick settings where permitted.
- Clipboard operations with Android-version-specific restrictions.
- Battery, charging, audio volume, device state and safe telemetry.
- Screen capture only through MediaProjection/user consent; do not claim capture works unless an actual capture result is returned.
- Notification access only if a feature truly requires it and after explicit user authorization.
- Background agent operation only within current Android foreground-service, battery, and background-start restrictions.
- Use Android Keystore for device identity and signed pairing challenges. Never use a static fake fingerprint or treat a generated key as proof of successful pairing without verifying it.
- Implement command expiry, replay protection, idempotency, authorization, cancellation, confirmation policy, result verification, and auditable outcomes.
- Return failure when AccessibilityService is unavailable or a gesture was cancelled. Wait for the actual gesture callback before reporting success. Do not mark dispatch as verified merely because a gesture was queued.
- Respect lock screen, biometrics, secure settings, permission prompts, protected apps, and Android OS boundaries. Never attempt to bypass them.
- Treat Shizuku/root/ADB-only features as optional, explicitly configured advanced modes. The standard APK must work safely without root and must not claim privileged access it does not have.

## Cross-device device mesh

The product goal is one Jess controlling the paired phone and PC from either endpoint:
- From Android, Jess can act on the phone locally or send a command to the paired Windows desktop agent.
- From Windows, Jess can send commands to the paired Android agent.
- Maintain one authenticated user/device registry, capability model, pairing state, online presence, command lifecycle, and audit trail.
- Inspect existing Firestore rules and current root services before finalizing collection names. Existing Android docs mention `users/{uid}/devices` and `users/{uid}/deviceCommands`, but do not assume those collections are already implemented or permitted.
- Implement server-side ownership checks and scoped device authorization. A client must not be able to send commands to another user's device by changing a device ID.
- Prefer a secure direct local transport for large/low-latency traffic when both devices share a LAN, with authenticated cloud relay fallback. Never trust a LAN IP alone. Pin/verify identity and authenticate the session.
- Implement the Windows receiver in the original Electron/native agent architecture, not as a second Android-side copy of desktop code. Use the existing native bridge and permission/audit patterns.
- Add explicit pairing, device naming, revoke, lost-device handling, presence heartbeat, last-seen, reconnect, command timeout, cancellation, and execution logs.
- Avoid Firestore polling for high-frequency screen/audio streams. Use Firestore for identity, presence, durable command metadata, and audit; use an authenticated streaming transport for interactive media/control.

## Website APK distribution

Use the existing Hub-Mind website/deployment configuration. First verify the canonical production domain and current Netlify project from repository/deployment configuration.
- Create a stable public download route and version manifest, e.g. a versioned APK under `public/downloads/` plus `/app-version.json`, and a clear download page/CTA.
- Do not overwrite or publish an APK until a real signed release build has passed installation and smoke tests on a physical Android device.
- Configure Android package/version continuity so future APK updates install over the previous build without uninstalling or losing app data.
- Implement checksum (SHA-256), release notes, version code/name, minimum Android version, and a safe update prompt.
- Package installation must use Android's legitimate Package Installer flow and request unknown-app install permission only when needed.
- Do not commit a release keystore. Use secure CI secrets or a private local signing configuration.
- The website must not point at a missing APK or a debug APK. Keep the release status explicit: NOT BUILT, BUILT, SIGNED, TESTED, PUBLISHED.

## Required execution phases

### Phase 1 — Re-audit and build reproducibility
Produce a file-by-file audit. Add a pinned Gradle wrapper, verify SDK/AGP/Kotlin versions, validate namespace/applicationId, manifest, resource IDs, and dependencies. Run Gradle compilation and unit tests. Fix compile errors before backend work.

### Phase 2 — Real Firebase identity and data
Replace mocks with Firebase Auth, Firestore repositories, Google sign-in, real permission state, and real profile/status checks. Confirm the Android user ID equals the web/desktop user ID for the same account. Test sign-in, sign-out, token refresh, offline/reconnect, and access denial.

### Phase 3 — Jess text and Gemini Live voice
Connect text chat to the canonical backend. Connect voice using authenticated ephemeral-token provisioning. Test real two-way speech on a physical phone, interruption, reconnect, session handoff, and same conversation history.

### Phase 4 — Android-native control
Implement and physically test each capability separately. Add truthful execution verification and explicit permission onboarding. Add tool schemas and capability checks to Jess.

### Phase 5 — Cross-device routing
Implement real device registration, pairing, presence, Android-to-Windows commands, Windows-to-Android commands, result delivery, approvals, cancellation, and audit logs. Test both directions across Wi-Fi and mobile internet.

### Phase 6 — Release and website
Build a signed release APK, verify signature/package/version, install/update on the user's phone, test core flows, upload to the verified Hub-Mind website, publish version metadata/checksum/release notes, and test download from the website on mobile data and Wi-Fi.

## Acceptance criteria — do not declare complete until all pass

1. Fresh install opens a real sign-in screen; no automatic/mock authenticated state.
2. Existing Hub-Mind account signs in through Firebase Auth and loads the same user profile/role/status as desktop.
3. A chat started on Android appears in the same user's Hub-Mind conversation history and vice versa.
4. Jess uses the existing backend/Gemini configuration; no Gemini API key is present in the APK.
5. Real voice conversation works in both directions with Jess audio playback and interruption.
6. Jess can open a selected app on the Android phone and report success only after launch is confirmed.
7. Accessibility hierarchy/action tests work after the user explicitly enables the service; gesture completion is awaited and verified.
8. The Android phone appears in the same device registry and can be paired/revoked.
9. From Android, Jess can issue a real command to the online Windows desktop and receive its actual result.
10. From Windows, Jess can issue a real command to the Android phone and receive its actual result.
11. Device offline, permission revoked, expired command, invalid auth, and denied confirmation all fail safely and transparently.
12. Build and unit tests pass from a clean checkout with the committed wrapper.
13. A signed APK installs and updates on a physical phone.
14. The Hub-Mind website serves the tested signed APK and accurate version/checksum metadata.

## Working style and reporting

Start by reading the repository and running an audit. Then implement, do not merely write another architecture proposal. Fix real defects in order, run tests, and show evidence. Never invent test results, device names, API responses, deployment URLs, or release status. If a feature is blocked by a missing secret, external deployment, Android permission, physical device, or user approval, implement the safe surrounding code and clearly identify the exact remaining action. Keep the original desktop app working throughout.
