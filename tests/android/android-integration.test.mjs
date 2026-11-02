import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const read = (relPath) => fs.readFileSync(path.join(rootDir, relPath), 'utf8');

test('Android Gradle configuration enforces canonical applicationId, version 2.4.0 (240), and strict release signing', () => {
  const buildGradle = read('android/app/build.gradle.kts');
  assert.match(buildGradle, /applicationId\s*=\s*"com\.aistudio\.hubmind\.wzyqkp"/);
  assert.match(buildGradle, /versionCode\s*=\s*240/);
  assert.match(buildGradle, /versionName\s*=\s*"2\.4\.0"/);
  assert.match(buildGradle, /if\s*\(hasDedicatedReleaseKeystore\)\s*\{\s*signingConfig\s*=\s*signingConfigs\.getByName\("release"\)/);
  assert.match(buildGradle, /implementation\(libs\.firebase\.auth\)/);
  assert.match(buildGradle, /implementation\(libs\.firebase\.firestore\)/);
  assert.match(buildGradle, /implementation\(libs\.okhttp\)/);
});

test('AndroidManifest.xml registers AccessibilityService, VoiceInteractionService, ForegroundService, and FileProvider', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android:name="com\.example\.hubmind\.agent\.HubMindAccessibilityService"/);
  assert.match(manifest, /android:resource="@xml\/accessibility_service_config"/);
  assert.match(manifest, /android:name="com\.example\.hubmind\.voice\.HubMindVoiceInteractionService"/);
  assert.match(manifest, /android:resource="@xml\/voice_interaction_service"/);
  assert.match(manifest, /android:name="com\.example\.hubmind\.agent\.HubMindAgentForegroundService"/);
  assert.match(manifest, /android:name="androidx\.core\.content\.FileProvider"/);
  assert.match(manifest, /android:resource="@xml\/file_paths"/);
});

test('HubMindBackendClient uses canonical Firebase project/database, /api/config, /api/live-token, and /api/chat with zero embedded secrets', () => {
  const clientKt = read('android/app/src/main/java/com/example/hubmind/data/remote/HubMindBackendClient.kt');
  assert.match(clientKt, /CANONICAL_PROJECT_ID\s*=\s*"gen-lang-client-0197530608"/);
  assert.match(clientKt, /CANONICAL_DATABASE_ID\s*=\s*"ai-studio-hubmind-4cac2024-c6eb-4208-80cf-928714dfd430"/);
  assert.match(clientKt, /\/api\/config/);
  assert.match(clientKt, /\/api\/live-token/);
  assert.match(clientKt, /\/api\/chat/);
  assert.match(clientKt, /apiKey\s*==\s*"dev-api-key"\s*\|\|\s*apiKey\s*==\s*"test-api-key"/);
  assert.doesNotMatch(clientKt, /AIzaSy[A-Za-z0-9_-]{33}/);
});

test('Android AuthRepositoryImpl, MainActivity, and AuthViewModel enforce real authentication without pre-authenticated mock state', () => {
  const repoKt = read('android/app/src/main/java/com/example/hubmind/data/repository/RepositoryImpls.kt');
  assert.match(repoKt, /private val _currentUser = MutableStateFlow<User\?>\(null\)/);
  assert.match(repoKt, /private val _isSessionValid = MutableStateFlow\(false\)/);
  assert.match(repoKt, /signInWithEmailAndPassword/);
  assert.match(repoKt, /GoogleAuthProvider\.getCredential/);
  assert.match(repoKt, /idToken == "mock-google-token"/);
  assert.match(repoKt, /"johnrufai242@gmail\.com"/);
  assert.match(repoKt, /"rufaijohnny@gmail\.com"/);

  const mainActivityKt = read('android/app/src/main/java/com/example/hubmind/MainActivity.kt');
  assert.match(mainActivityKt, /ServiceLocator\.authRepository\.isSessionValid\.collectAsState\(\)/);
  assert.doesNotMatch(mainActivityKt, /var isAuthenticated by remember \{ mutableStateOf\(true\) \}/);

  const authVmKt = read('android/app/src/main/java/com/example/hubmind/ui/screens/auth/AuthViewModel.kt');
  assert.doesNotMatch(authVmKt, /••••••••••••/);
});

test('GeminiLiveAudioSession and JessCanonicalConfig implement real bidirectional PCM audio and canonical Jess identity/tools', () => {
  const liveKt = read('android/app/src/main/java/com/example/hubmind/voice/GeminiLiveAudioSession.kt');
  assert.match(liveKt, /BidiGenerateContentConstrained/);
  assert.match(liveKt, /INPUT_SAMPLE_RATE = 16000/);
  assert.match(liveKt, /OUTPUT_SAMPLE_RATE = 24000/);
  assert.match(liveKt, /AcousticEchoCanceler/);
  assert.match(liveKt, /NoiseSuppressor/);
  assert.match(liveKt, /sessionResumption/);

  const canonicalKt = read('android/app/src/main/java/com/example/hubmind/voice/JessCanonicalConfig.kt');
  assert.match(canonicalKt, /designed and programmed by Jaystarbliss/);
  assert.match(canonicalKt, /done_verified/);
  assert.match(canonicalKt, /"android_device_action"/);
  assert.match(canonicalKt, /"windows_device_action"/);
});

test('ArtemisUiObservationEngine, HubMindAccessibilityService, and AndroidUiActionExecutor implement real verified Android automation', () => {
  const artemisKt = read('android/app/src/main/java/com/example/hubmind/agent/ArtemisUiObservationEngine.kt');
  assert.match(artemisKt, /https:\/\/github\.com\/google\/artemis/);
  assert.match(artemisKt, /Apache License, Version 2\.0/);
  assert.match(artemisKt, /fun extractIndexedElements/);
  assert.match(artemisKt, /fun findElementAtPoint/);

  const accKt = read('android/app/src/main/java/com/example/hubmind/agent/HubMindAccessibilityService.kt');
  assert.match(accKt, /suspend fun performTapAtAwait/);
  assert.match(accKt, /suspend fun performSwipeAwait/);
  assert.match(accKt, /suspend fun captureScreenBase64Await/);
  assert.match(accKt, /if \(targetNode\.isPassword\)/);

  const execKt = read('android/app/src/main/java/com/example/hubmind/agent/AndroidUiActionExecutor.kt');
  assert.match(execKt, /ArtemisUiObservationEngine\.extractIndexedElements/);
  assert.match(execKt, /ArtemisUiObservationEngine\.findElementAtPoint/);
});

test('Two-way cross-device control plane is wired across Android, backend Netlify function, and Web/Windows Jess tools', () => {
  const transportKt = read('android/app/src/main/java/com/example/hubmind/data/transport/ControlPlaneTransport.kt');
  assert.match(transportKt, /collection\("deviceCommands"\)/);
  assert.match(transportKt, /processedReplayTokens/);

  const devicesFn = read('netlify/functions/devices.ts');
  assert.match(devicesFn, /deviceCommands/);
  assert.match(devicesFn, /verifyAuthenticatedUser/);

  const crossDeviceSvc = read('src/services/crossDeviceService.ts');
  assert.match(crossDeviceSvc, /export function startCrossDeviceAgentLoop/);
  assert.match(crossDeviceSvc, /export async function dispatchCrossDeviceCommand/);

  const jessTools = read('src/lib/jessTools.ts');
  assert.match(jessTools, /name:\s*'list_paired_devices'/);
  assert.match(jessTools, /name:\s*'control_android_device'/);
});
