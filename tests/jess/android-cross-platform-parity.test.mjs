import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('Android screen sharing is explicitly consented and uses the foreground MediaProjection service', async () => {
  const [home, capture, service, manifest, repository, live] = await Promise.all([
    read('../../android/app/src/main/java/com/example/hubmind/ui/screens/home/JessHomeScreen.kt'),
    read('../../android/app/src/main/java/com/example/hubmind/agent/AndroidScreenCaptureManager.kt'),
    read('../../android/app/src/main/java/com/example/hubmind/agent/HubMindAgentForegroundService.kt'),
    read('../../android/app/src/main/AndroidManifest.xml'),
    read('../../android/app/src/main/java/com/example/hubmind/data/repository/RepositoryImpls.kt'),
    read('../../android/app/src/main/java/com/example/hubmind/voice/GeminiLiveAudioSession.kt'),
  ]);

  assert.match(home, /createScreenCaptureIntent\(\)/);
  assert.match(home, /Share screen with Jess/);
  assert.match(home, /Stop screen sharing/);
  assert.match(capture, /getMediaProjection\(resultCode, resultData\)/);
  assert.match(capture, /createVirtualDisplay/);
  assert.match(capture, /registerCallback/);
  assert.match(service, /ACTION_START_SCREEN_CAPTURE/);
  assert.match(service, /FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION/);
  assert.match(service, /FOREGROUND_SERVICE_TYPE_MICROPHONE/);
  assert.match(manifest, /FOREGROUND_SERVICE_MEDIA_PROJECTION/);
  assert.match(manifest, /FOREGROUND_SERVICE_MICROPHONE/);
  assert.match(manifest, /specialUse\|mediaProjection\|microphone/);
  assert.match(repository, /AndroidScreenShareEvents\.events\.collect/);
  assert.match(repository, /sendVideoFrame\(encodedFrame\)/);
  assert.match(live, /realtimeInput/);
  assert.match(live, /mimeType.*image\/jpeg/);
});

test('Android Jess captions are displayed in a non-focusable, non-touchable overlay', async () => {
  const [overlay, repository] = await Promise.all([
    read('../../android/app/src/main/java/com/example/hubmind/agent/JessTranscriptOverlayManager.kt'),
    read('../../android/app/src/main/java/com/example/hubmind/data/repository/RepositoryImpls.kt'),
  ]);
  assert.match(overlay, /FLAG_NOT_FOCUSABLE/);
  assert.match(overlay, /FLAG_NOT_TOUCHABLE/);
  assert.match(overlay, /PixelFormat\.TRANSLUCENT/);
  assert.match(repository, /transcriptOverlay\?\.show\("YOU"/);
  assert.match(repository, /transcriptOverlay\?\.show\("JESS"/);
  assert.match(repository, /transcriptOverlay\?\.hide\(\)/);
});

test('Windows desktop relay uses the main repo device API and local Full Control gate', async () => {
  const [main, preload, auth, agentBridge] = await Promise.all([
    read('../../electron/main.cjs'),
    read('../../electron/preload.cjs'),
    read('../../src/lib/auth.tsx'),
    read('../../electron/agentBridge.cjs'),
  ]);
  assert.match(main, /function registerDesktopDevice/);
  assert.match(main, /function pollDesktopDeviceCommands/);
  assert.match(main, /\/api\/devices\/commands\?targetDeviceId=/);
  assert.match(main, /action: 'ack'/);
  assert.match(main, /command\?\.lifecycleState \|\| ''\)\.toUpperCase\(\) === 'DISPATCHED'/);
  assert.match(main, /lifecycleState,\s*resultSuccess/);
  assert.match(main, /!fullControlActive \|\| !controlSessionSecret/);
  assert.match(main, /hubmind:set-device-session/);
  assert.doesNotMatch(main, /\/api\/devices\/poll|\/api\/devices\/result/);
  assert.match(preload, /setDeviceSession/);
  assert.match(auth, /onIdTokenChanged/);
  assert.match(auth, /getLocalDeviceId\(\)/);
  assert.match(agentBridge, /sent_unverified/);
  assert.match(agentBridge, /action-timeout-unconfirmed/);
});

test('Jess routes an explicit device action to the selected online phone or workstation', async () => {
  const [assistant, tools] = await Promise.all([
    read('../../src/components/JessFloatingAssistant.tsx'),
    read('../../src/lib/jessTools.ts'),
  ]);
  assert.match(assistant, /Control target device/);
  assert.match(assistant, /activeTargetDeviceId/);
  assert.match(assistant, /collection\(db, 'users', profile\.id, 'devices'\)/);
  assert.match(assistant, /attachActiveDeviceTarget\(fc\.name, toolArgs/);
  assert.match(assistant, /const stopCrossDevice = isDesktopShell \? \(\(\) => \{\}\) : startCrossDeviceAgentLoop/);
  assert.match(tools, /name: 'dispatch_device_command'/);
  assert.match(tools, /case 'dispatch_device_command'/);
  assert.match(tools, /args\?\.userExplicitlyRequested !== true/);
  assert.match(tools, /target\.fullControlActive !== true/);
  assert.match(tools, /dispatchCrossDeviceCommand\(user\.id, target\.deviceId/);
});

test('Gemini Live starts with a newly minted ephemeral token for each session', async () => {
  const live = await read('../../src/services/liveAudioClient.ts');
  assert.doesNotMatch(live, /private static cachedToken/);
  assert.match(live, /private async getEphemeralToken\(\)/);
  assert.match(live, /fetch\('\/api\/live-token'/);
  assert.match(live, /cache: 'no-store'/);
});

test('Firestore REST encoder supports nested device-command data', async () => {
  const [rest, regression] = await Promise.all([
    read('../../src/server/firebaseAdminRest.ts'),
    read('../../tests/security/firebase-admin-rest-encoding.test.ts'),
  ]);
  assert.match(rest, /function encodeFirestoreValue/);
  assert.match(rest, /arrayValue/);
  assert.match(rest, /mapValue/);
  assert.match(regression, /round-trips nested Android command payloads/);
});

test('Android floating orb can be dragged to a temporary hide target and fades while idle', async () => {
  const [overlay, service] = await Promise.all([
    read('../../android/app/src/main/java/com/example/hubmind/agent/JessOrbOverlayManager.kt'),
    read('../../android/app/src/main/java/com/example/hubmind/agent/HubMindAgentForegroundService.kt'),
  ]);
  assert.match(overlay, /dismissedUntilNextMinimize/);
  assert.match(overlay, /dismissed_until_next_minimize/);
  assert.match(overlay, /positionPrefs\.edit\(\)\.putBoolean/);
  assert.match(overlay, /val wasIdle = orbState == "idle" \|\| orbState == "muted"/);
  assert.match(overlay, /if \(isIdle && !wasIdle\) scheduleIdleFade\(\)/);
  assert.match(overlay, /isInsideDismissTarget/);
  assert.match(overlay, /showDismissTarget/);
  assert.match(overlay, /Hide Jess/);
  assert.match(overlay, /resetDismissalForNextMinimize/);
  assert.match(overlay, /IDLE_FADE_DELAY_MS/);
  assert.match(overlay, /IDLE_ALPHA = 0\.32f/);
  assert.match(service, /jessOrbOverlayManager\.resetDismissalForNextMinimize\(\)/);
});

test('Android Workspace silently joins the authenticated native Firebase user and never opens a second Google picker', async () => {
  const [gate, app, login, auth, workspace] = await Promise.all([
    read('../../src/components/AndroidGoogleSignInGate.tsx'),
    read('../../src/App.tsx'),
    read('../../src/pages/Login.tsx'),
    read('../../src/lib/auth.tsx'),
    read('../../android/app/src/main/java/com/example/hubmind/ui/screens/workspace/WorkspaceScreen.kt'),
  ]);

  assert.match(app, /requestWorkspaceSession/);
  assert.match(login, /requestWorkspaceSession/);
  assert.match(auth, /signInWithCustomToken/);
  assert.match(auth, /hubmind-native-session-token/);
  assert.match(auth, /expectedUid: nativeUid/);
  assert.match(auth, /payload\\.uid !== nativeUid/);
  assert.match(workspace, /getFreshIdToken\\(forceRefresh = true\\)/);
  assert.match(workspace, /requestWorkspaceSession/);
  assert.match(workspace, /hubmind-native-session-token/);
  assert.doesNotMatch(workspace, /startGoogleSignIn|GoogleSignIn\\.getClient|NativeWebAuthTokenHolder/);
  assert.doesNotMatch(gate, /startGoogleSignIn|Continue with Google|25000/);
  assert.match(gate, /Retry Workspace Connection/);
  assert.match(gate, /same account/);
  assert.doesNotMatch(app, /getGoogleIdToken|startGoogleSignIn/);
  assert.doesNotMatch(login, /getGoogleIdToken|startGoogleSignIn/);
});

