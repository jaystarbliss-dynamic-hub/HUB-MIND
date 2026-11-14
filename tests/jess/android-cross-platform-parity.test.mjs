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
  assert.match(main, /lifecycleState: 'DISPATCHED'/);
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
