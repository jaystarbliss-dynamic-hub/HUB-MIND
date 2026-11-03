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
  assert.doesNotMatch(repoKt, /signInWithEmailAndPassword/);
  assert.match(repoKt, /GoogleAuthProvider\.getCredential/);
  assert.match(repoKt, /idToken == "mock-google-token"/);
  assert.match(repoKt, /"johnrufai242@gmail\.com"/);
  assert.match(repoKt, /"rufaijohnny@gmail\.com"/);

  const mainActivityKt = read('android/app/src/main/java/com/example/hubmind/MainActivity.kt');
  assert.match(mainActivityKt, /ServiceLocator\.authRepository\.isSessionValid\.collectAsState\(\)/);
  assert.doesNotMatch(mainActivityKt, /var isAuthenticated by remember \{ mutableStateOf\(true\) \}/);

  const authContractKt = read('android/app/src/main/java/com/example/hubmind/data/repository/Repositories.kt');
  assert.doesNotMatch(authContractKt, /suspend fun signIn\(email: String, password: String\)/);

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


test('Android device transport uses the same lifecycle, timestamp, and payload fields as Web/Windows', () => {
  const transport = read('android/app/src/main/java/com/example/hubmind/data/transport/ControlPlaneTransport.kt');
  assert.match(transport, /whereEqualTo\("lifecycleState", "DISPATCHED"\)/);
  assert.match(transport, /getString\("parametersJson"\)/);
  assert.match(transport, /getLong\("expirationTime"\)/);
  assert.match(transport, /"issuingUserId" to uid/);
  assert.match(transport, /"lifecycleState" to "DISPATCHED"/);
  assert.match(transport, /"resultSuccess"/);
  assert.match(transport, /"resultVerified"/);
  assert.match(transport, /"resultSummary"/);
  assert.match(transport, /"resultError"/);
  assert.doesNotMatch(transport, /getString\("status"\)/);
  assert.doesNotMatch(transport, /"expiresAt" to envelope\.expirationTime/);
  assert.doesNotMatch(transport, /Executed .* successfully\./);
});

test('Android rejects confirmation-gated and unsupported native actions instead of claiming success', () => {
  const transport = read('android/app/src/main/java/com/example/hubmind/data/transport/ControlPlaneTransport.kt');
  const executor = read('android/app/src/main/java/com/example/hubmind/agent/AndroidUiActionExecutor.kt');
  assert.match(transport, /envelope\.requiresConfirmation/);
  assert.match(transport, /Unsupported Android action/);
  assert.match(executor, /command\.requiresConfirmation/);
  assert.match(executor, /No confirmation was provided/);
});

test('Android profile bootstrap follows the canonical invitation/admin access policy', () => {
  const repoKt = read('android/app/src/main/java/com/example/hubmind/data/repository/RepositoryImpls.kt');
  assert.match(repoKt, /if \(!isBootstrapAdmin\)/);
  assert.match(repoKt, /has not been authorized for Hub-Mind/);
  assert.match(repoKt, /"id" to uid/);
});

test('Android updater only offers a published matching app with a valid SHA-256 checksum', () => {
  const checker = read('android/app/src/main/java/com/example/hubmind/data/updater/HubMindUpdateChecker.kt');
  const manifest = JSON.parse(read('public/api/app-version.json'));
  assert.match(checker, /releaseStatus/);
  assert.match(checker, /applicationId != context\.packageName/);
  assert.match(checker, /verifyApkChecksum/);
  assert.equal(manifest.releaseStatus, 'NOT_PUBLISHED');
  assert.equal(manifest.applicationId, 'com.aistudio.hubmind.wzyqkp');
  assert.equal(manifest.versionCode, 240);
  assert.equal(manifest.versionName, '2.4.0');
});

test('Android CI fixes Metaspace and fingerprints the built APK instead of assuming a runner debug keystore', () => {
  const gradle = read('android/gradle.properties');
  const workflow = read('.github/workflows/android-apk.yml');
  assert.match(gradle, /MaxMetaspaceSize=1g/);
  assert.match(workflow, /verify --print-certs/);
  assert.match(workflow, /android-actions\/setup-android@v4/);
  assert.match(read('android/gradlew'), /MaxMetaspaceSize=1g/);
  assert.match(workflow, /Hub-Mind-Android-v2\.4\.0-debug\.apk/);
  assert.match(workflow, /release_signing_available != 'true'/);
  assert.match(workflow, /release_signing_available == 'true'/);
  assert.match(workflow, /publish-android-release/);
  assert.match(workflow, /softprops\/action-gh-release@v2/);
  assert.match(workflow, /prerelease:\s*false/);
  assert.match(workflow, /Hub-Mind-Android-v\$VERSION_NAME\.apk/);
  assert.match(workflow, /actions\/github-script@v7/);
  assert.match(workflow, /releaseStatus:\s*'PUBLISHED'/);
  assert.match(workflow, /APK_SHA256/);
  assert.doesNotMatch(workflow, /\.android\/debug\.keystore/);
  assert.match(workflow, /if: steps\.signing\.outputs\.available == 'true'/);
});

test('Version history has separate Windows/Android tabs and uses a viewport-safe mobile modal', () => {
  const modal = read('src/components/DesktopUpdatesModal.tsx');
  assert.match(modal, /activeTab === 'android'/);
  assert.match(modal, /Windows \(/);
  assert.match(modal, /Android \(/);
  assert.match(modal, /h-\[100dvh\]/);
  assert.match(modal, /overflow-x-auto whitespace-nowrap/);
  assert.match(modal, /sm:max-h-\[90vh\]/);
  assert.match(modal, /github\.com\/jaystarbliss-dynamic-hub\/HUB-MIND/);
});


test('Android updater downloads to app-private cache, verifies checksum, and exposes a guarded installer action', () => {
  const checker = read('android/app/src/main/java/com/example/hubmind/data/updater/HubMindUpdateChecker.kt');
  const viewModel = read('android/app/src/main/java/com/example/hubmind/ui/screens/settings/SettingsViewModel.kt');
  const screen = read('android/app/src/main/java/com/example/hubmind/ui/screens/settings/SettingsScreen.kt');
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  assert.match(checker, /suspend fun downloadAndVerifyApk/);
  assert.match(checker, /verifyApkChecksum\(apkFile, update\.sha256\)/);
  assert.match(checker, /APK checksum verification failed/);
  assert.match(checker, /canRequestPackageInstalls/);
  assert.match(viewModel, /downloadAndInstallUpdate/);
  assert.match(screen, /Download & Install v/);
  assert.match(manifest, /android\.permission\.REQUEST_INSTALL_PACKAGES/);
});

test('Website lists CI-published Android debug prereleases as clearly labelled test downloads without enabling in-app updates', () => {
  const workflow = read('.github/workflows/android-apk.yml');
  const modal = read('src/components/DesktopUpdatesModal.tsx');
  const manifest = JSON.parse(read('public/api/app-version.json'));

  assert.match(workflow, /publish-android-debug-prerelease/);
  assert.match(workflow, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /contents:\s*write/);
  assert.match(workflow, /prerelease:\s*true/);
  assert.match(workflow, /Hub-Mind-Android-v2\.4\.0-debug\.apk/);
  assert.match(modal, /isPrerelease:\s*Boolean\(rel\.prerelease\)/);
  assert.match(modal, /TEST BUILD · DEBUG SIGNED/);
  assert.match(modal, /cannot update an installation signed with a different certificate/i);
  assert.match(modal, /Download Android test APK/);
  assert.equal(manifest.releaseStatus, 'NOT_PUBLISHED');
  assert.equal(manifest.apkUrl, '');
  assert.match(workflow, /publish-android-release/);
  assert.match(workflow, /prerelease:\s*false/);
  assert.match(workflow, /releaseStatus:\s*'PUBLISHED'/);
  assert.match(workflow, /APK_URL:/);
  assert.match(modal, /setExpandedRelease\(latestStableRelease\?\.tag \|\| androidReleases\[0\]\.tag\)/);
});

test('Firebase Google Sign-In Web OAuth client ID is separated from Google Drive/Calendar OAuth client ID across backend, web, and Android', () => {
  const configFn = read('netlify/functions/config.ts');
  const serverTs = read('server.ts');
  const fbConfigTs = read('src/firebaseConfig.ts');
  const clientKt = read('android/app/src/main/java/com/example/hubmind/data/remote/HubMindBackendClient.kt');
  const authScreenKt = read('android/app/src/main/java/com/example/hubmind/ui/screens/auth/AuthScreen.kt');

  assert.match(configFn, /CANONICAL_PROJECT_NUMBER\s*=\s*'691762959980'/);
  assert.match(configFn, /CANONICAL_WEB_APP_ID\s*=\s*'1:691762959980:web:0979e7745677270cc92a49'/);
  assert.match(configFn, /firebaseGoogleClientId/);
  assert.match(serverTs, /firebaseGoogleClientId/);
  assert.match(fbConfigTs, /export let FIREBASE_GOOGLE_CLIENT_ID/);
  assert.match(clientKt, /val firebaseGoogleClientId: String/);
  assert.match(authScreenKt, /cfg\.firebaseGoogleClientId/);
});

test('Android HubMindBackendClient strictly enforces canonical named Firestore database and never falls back to default database', () => {
  const clientKt = read('android/app/src/main/java/com/example/hubmind/data/remote/HubMindBackendClient.kt');
  assert.match(clientKt, /Refusing to fall back to the default database/);
  assert.match(clientKt, /FirebaseFirestore\.getInstance\(app, cfg\.firestoreDatabaseId\)/);
  assert.doesNotMatch(clientKt, /catch \(_: Throwable\) \{\s*FirebaseFirestore\.getInstance\(app\)\s*\}/);
});

test('Android Gradle files configure com.google.gms.google-services plugin safely', () => {
  const libsToml = read('android/gradle/libs.versions.toml');
  const rootGradle = read('android/build.gradle.kts');
  const appGradle = read('android/app/build.gradle.kts');

  assert.match(libsToml, /com\.google\.gms\.google-services/);
  assert.match(rootGradle, /alias\(libs\.plugins\.google\.services\) apply false/);
  assert.match(appGradle, /alias\(libs\.plugins\.google\.services\)/);
  assert.ok(fs.existsSync(path.join(rootDir, 'android/app/google-services.json')));
  assert.match(libsToml, /googleServices\s*=\s*"4\.5\.0"/);
  assert.match(libsToml, /firebaseBom\s*=\s*"35\.1\.0"/);
});

test('Web workspace services and pages use rule-compliant visibleWorkspaceQueries', () => {
  const visibleQueries = read('src/lib/visibleWorkspaceQueries.ts');
  assert.match(visibleQueries, /export function buildVisibleWorkspaceQueries/);
  assert.match(visibleQueries, /export function subscribeVisibleWorkspaceCollection/);
  assert.match(visibleQueries, /export async function getVisibleWorkspaceDocs/);
  assert.match(visibleQueries, /export function subscribeOwnerScopedCollection/);

  for (const rel of [
    'src/services/projectService.ts',
    'src/services/taskService.ts',
    'src/services/clientService.ts',
    'src/services/followUpService.ts',
    'src/services/documentService.ts',
    'src/pages/Documents.tsx',
    'src/pages/Projects.tsx',
    'src/pages/Tasks.tsx',
    'src/pages/Clients.tsx',
    'src/pages/Calendar.tsx',
    'src/pages/FollowUps.tsx',
    'src/pages/Dashboard.tsx',
    'src/pages/Knowledge.tsx',
    'src/pages/Inbox.tsx',
    'src/pages/ProjectDetail.tsx',
    'src/pages/ClientDetail.tsx',
    'src/components/RecurringSchedulePanel.tsx',
    'src/components/RecurringTasksPanel.tsx',
  ]) {
    const content = read(rel);
    assert.match(content, /visibleWorkspaceQueries/, `${rel} should use visibleWorkspaceQueries`);
  }
});


test('Android sign-in UI exposes Google authentication only', () => {
  const screen = read('android/app/src/main/java/com/example/hubmind/ui/screens/auth/AuthScreen.kt');
  const viewModel = read('android/app/src/main/java/com/example/hubmind/ui/screens/auth/AuthViewModel.kt');

  assert.match(screen, /google_sign_in_button/);
  assert.match(screen, /Continue with Google/);
  assert.doesNotMatch(screen, /Studio Email|Password|email_input|password_input|testTag\("sign_in_button"\)|Text\("Sign In to Hub-Mind"/);
  assert.doesNotMatch(viewModel, /email: String|password: String|fun signIn\(/);
  assert.match(viewModel, /signInWithGoogleIdToken/);
});

test('Checked-in google-services.json matches registered Hub-Mind Android app and debug signing certificate', () => {
  const config = JSON.parse(read('android/app/google-services.json'));
  assert.equal(config.project_info.project_id, 'gen-lang-client-0197530608');
  assert.equal(config.project_info.project_number, '691762959980');
  const client = config.client.find(item =>
    item.client_info.android_client_info.package_name === 'com.aistudio.hubmind.wzyqkp'
  );
  assert.ok(client, 'registered Hub-Mind Android package must be present');
  assert.equal(client.client_info.mobilesdk_app_id, '1:691762959980:android:deaa0117684e641ec92a49');
  assert.ok(client.oauth_client.some(item =>
    item.client_type === 1 &&
    item.client_id === '691762959980-lpau2iqkss2qgt8b43p3nbefgq90fkln.apps.googleusercontent.com' &&
    item.android_info.certificate_hash === 'bf5d7fccbaa809ca12b92eafc4ccba267f03cfbc'
  ));
  assert.ok(client.oauth_client.some(item =>
    item.client_type === 3 &&
    item.client_id === '691762959980-2jsohrd8s1elb4f84t3592vl728nhek7.apps.googleusercontent.com'
  ));
});
