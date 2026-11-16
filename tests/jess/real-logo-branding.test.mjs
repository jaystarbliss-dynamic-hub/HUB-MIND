import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the official Hub-Mind logo is used consistently in public, login, and workspace branding', () => {
  const login = read('../../src/pages/Login.tsx');
  const sidebar = read('../../src/components/DesktopSidebar.tsx');
  const publicHome = read('../../src/pages/PublicHome.tsx');
  const index = read('../../index.html');
  const vite = read('../../vite.config.ts');

  assert.match(login, /src="\/hub-mind%20logo\.png"/);
  assert.doesNotMatch(login, /src="\/icon\.svg"/);
  assert.match(sidebar, /src="\/hub-mind%20logo\.png"/);
  assert.doesNotMatch(sidebar, /<Brain\s/);
  assert.match(publicHome, /src="\/hub-mind%20logo\.png"/);
  assert.match(index, /rel="icon" type="image\/png" href="\/hub-mind%20logo\.png"/);
  assert.match(vite, /src: '\/hub-mind%20logo\.png'/);
});


test('Android native shell uses the exact official workspace logo', () => {
  const gradle = read('../../android/app/build.gradle.kts');
  const manifest = read('../../android/app/src/main/AndroidManifest.xml');
  const authScreen = read('../../android/app/src/main/java/com/example/hubmind/ui/screens/auth/AuthScreen.kt');
  const common = read('../../android/app/src/main/java/com/example/hubmind/ui/components/CommonComponents.kt');
  const mainActivity = read('../../android/app/src/main/java/com/example/hubmind/MainActivity.kt');

  assert.match(gradle, /public\/hub-mind%20logo\.png/);
  assert.match(gradle, /hubMindLogoGitBlobSha = "da03d94848e34f177ba0aa55869a487c994a3dc8"/);
  assert.match(gradle, /drawable-nodpi\/hub_mind_logo\.png/);
  assert.match(authScreen, /R\.drawable\.hub_mind_logo/);
  assert.match(common, /R\.drawable\.hub_mind_logo/);
  assert.doesNotMatch(authScreen, /Icons\.Filled\.Hub/);
  assert.doesNotMatch(common, /Icons\.Filled\.Hub/);
  assert.match(manifest, /android:icon="@drawable\/hub_mind_logo"/);
  assert.match(manifest, /android:roundIcon="@drawable\/hub_mind_logo"/);
  assert.match(mainActivity, /R\.drawable\.hub_mind_logo/);
});

test('Android opens Workspace inside the authenticated native Firebase session and never routes public home', () => {
  const mainActivity = read('../../android/app/src/main/java/com/example/hubmind/MainActivity.kt');
  const nav = read('../../android/app/src/main/java/com/example/hubmind/ui/components/CommonComponents.kt');
  const workspace = read('../../android/app/src/main/java/com/example/hubmind/ui/screens/workspace/WorkspaceScreen.kt');
  const installed = read('../../src/services/jessWakeListener.ts');
  const auth = read('../../src/lib/auth.tsx');
  const login = read('../../src/pages/Login.tsx');
  const repository = read('../../android/app/src/main/java/com/example/hubmind/data/repository/RepositoryImpls.kt');

  assert.ok(mainActivity.includes('mutableStateOf(HubMindNavDestination.WORKSPACE)'));
  assert.ok(mainActivity.includes('isSessionReady'));
  assert.ok(nav.includes('WORKSPACE("Workspace"'));
  assert.ok(nav.includes('JESS("Jess"'));
  assert.ok(nav.includes('DEVICES("Devices"'));
  assert.ok(nav.includes('ACTIVITY("Activity"'));
  assert.ok(nav.includes('SETTINGS("Settings"'));
  assert.ok(installed.includes('androidBridge?.isAndroidApp'));
  assert.ok(installed.includes('return android || native || standalone || desktop'));
  assert.ok(login.includes('!isJessInstalledApp()'));
  assert.ok(workspace.includes('requestWorkspaceSession'));
  assert.ok(workspace.includes('hubmind-native-session-token'));
  assert.ok(workspace.includes('view.loadUrl(HUB_MIND_WORKSPACE_URL)'));
  assert.ok(auth.includes('nativeAuthBootstrapPending'));
  assert.ok(auth.includes('signInWithCustomToken'));
  assert.ok(auth.includes('if (!firebaseUser && nativeAuthBootstrapPending.current) return'));
  assert.ok(repository.includes('isSessionReady'));
});

test('Android exposes the existing native Firebase session to Workspace after native sign-in', () => {
  const viewModel = read('../../android/app/src/main/java/com/example/hubmind/ui/screens/auth/AuthViewModel.kt');
  const workspace = read('../../android/app/src/main/java/com/example/hubmind/ui/screens/workspace/WorkspaceScreen.kt');
  const webAuth = read('../../src/lib/auth.tsx');
  const endpoint = read('../../netlify/functions/android-session.mjs');
  const repository = read('../../android/app/src/main/java/com/example/hubmind/data/repository/RepositoryImpls.kt');

  assert.ok(viewModel.includes('authRepository.signInWithGoogle(idToken)'));
  assert.doesNotMatch(viewModel, /NativeWebAuthTokenHolder/);
  assert.ok(workspace.includes('getFreshIdToken(forceRefresh = true)'));
  assert.ok(workspace.includes('requestWorkspaceSession'));
  assert.ok(webAuth.includes('signInWithCustomToken'));
  assert.ok(webAuth.includes('hubmind-native-session-token'));
  assert.ok(endpoint.includes('verifyFirebaseUser'));
  assert.ok(endpoint.includes('createFirebaseCustomToken'));
  assert.ok(repository.includes('override val isSessionReady: StateFlow<Boolean>'));
});
test('Android Workspace shares the native device identity with Jess and avoids duplicate WEB agents', () => {
  const workspace = read('../../android/app/src/main/java/com/example/hubmind/ui/screens/workspace/WorkspaceScreen.kt');
  const crossDevice = read('../../src/services/crossDeviceService.ts');
  const jess = read('../../src/components/JessFloatingAssistant.tsx');
  const nativeRepo = read('../../android/app/src/main/java/com/example/hubmind/data/repository/RepositoryImpls.kt');

  assert.match(workspace, /addJavascriptInterface\(androidDeviceBridge, "HubMindNative"\)/);
  assert.match(workspace, /fun getAndroidDeviceId\(\): String/);
  assert.match(workspace, /fun onTargetDeviceSelected\(deviceId: String\)/);
  assert.match(workspace, /ServiceLocator\.deviceRegistryRepository\.localDeviceId/);
  assert.match(workspace, /selectTargetDevice\(target\)/);
  assert.match(crossDevice, /HubMindNative\?\.getAndroidDeviceId\?\.\(\)/);
  assert.match(crossDevice, /nativeAndroidId/);
  assert.match(crossDevice, /second renderer-side command consumer/);
  assert.match(jess, /activeIsOldEmbeddedWebDevice/);
  assert.match(jess, /persistActiveDeviceTarget\(nativeId\)/);
  assert.match(nativeRepo, /val localDeviceId: String by lazy/);
});

