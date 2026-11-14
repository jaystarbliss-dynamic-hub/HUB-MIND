# Jess Android Voice & Native Device Control

## 1. One Jess, shared across Hub-Mind

The Android app is a native endpoint of the same Hub-Mind account and Jess assistant used by the web workspace and Windows desktop companion. It uses the canonical Firebase account, Firestore database, conversation history, user memories, and paired-device registry.

The production voice path is Gemini Live, not a local speech-recognition demo:

- The Android client obtains a Firebase ID token and requests a short-lived Gemini Live credential from the authenticated `POST /api/live-token` endpoint.
- Audio is captured from the phone microphone as 16 kHz PCM and streamed directly to Gemini Live over the authenticated session.
- Jess audio responses are played through Android audio output at 24 kHz PCM.
- Live transcripts, turn completion, interruption, reconnect/session-resumption, and function calls are handled by `GeminiLiveAudioSession.kt`.
- Jess uses the canonical prompt and the same user memories/device inventory as the rest of Hub-Mind.

## 2. Voice commands can target either endpoint

Jess chooses the device from the user's request and the selected target device:

- **This Android phone:** `android_device_action` is executed locally through `AndroidUiActionExecutor`, `HubMindAccessibilityService`, Android system controllers, and `PackageManager`.
- **Paired Windows PC:** `windows_device_action` is dispatched through the shared Hub-Mind device command control plane to the paired Windows agent.

Examples include opening an app on the phone, navigating Back/Home, tapping a labelled screen element, reading the current UI hierarchy, capturing a consented screen image, launching an app on the PC, or typing text into the active Windows application.

Every action must return its actual result. Jess may say an action is complete only when the executor verifies the postcondition (`done_verified`). A request that lacks permissions, confirmation, a paired device, Full Control, or network connectivity must fail honestly rather than claiming success.

## 3. Android permissions and consent

The phone's own control capabilities are governed by Android:

- Microphone permission is required for live voice.
- The owner must explicitly enable Hub-Mind Agent under Android Accessibility settings for semantic taps, gestures, and UI observation.
- Screen sharing requires the Android MediaProjection system consent flow and a visible foreground service.
- Overlay permission is optional and only used for the floating Jess transcript/companion experience.
- Notification permission controls ongoing session notifications on Android versions that require it.

Jess must not bypass lock screens, biometric prompts, password or payment fields, Android permission dialogs, or other OS security boundaries.

## 4. Background session and interruption

An active voice or screen-share session runs through the owner-visible `HubMindAgentForegroundService`. The user can end the session from the app or the persistent notification. The session lease at `users/{uid}/private/jessActiveSession` prevents the same user from unintentionally running competing live Jess speakers on Android, web, and desktop.

Voice-only operation, background microphone behavior, Bluetooth changes, interruption, and reconnection must still be acceptance-tested on a physical Android phone before a release is treated as fully verified.
