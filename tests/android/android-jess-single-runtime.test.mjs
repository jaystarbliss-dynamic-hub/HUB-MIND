import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Android tabs keep one workspace WebView alive and no longer mount the separate native Jess stack', () => {
  const activity = read('android/app/src/main/java/com/example/hubmind/MainActivity.kt');
  const workspace = read('android/app/src/main/java/com/example/hubmind/ui/screens/workspace/WorkspaceScreen.kt');

  assert.match(activity, /WorkspaceScreen\(\s*currentNativeTab\s*=\s*currentTab\.name/);
  assert.match(activity, /HubMindNavDestination\.JESS,\s*HubMindNavDestination\.WORKSPACE\s*->\s*Unit/);
  assert.doesNotMatch(activity, /JessHomeScreen\s*\(/);
  assert.doesNotMatch(activity, /JessHomeViewModel\s*\(/);
  assert.match(workspace, /LaunchedEffect\(webView, currentNativeTab\)/);
  assert.match(workspace, /hubmind-android-tab-change/);
  assert.match(workspace, /HubMindJessNativeEvents\.events\.collect/);
});

test('Android Jess tab overlays the current workspace route and reuses the existing Jess Live client', () => {
  const app = read('src/App.tsx');
  const companion = read('src/pages/CompanionPage.tsx');
  const floating = read('src/components/JessFloatingAssistant.tsx');

  assert.match(app, /function AndroidNativeTabNavigationBridge/);
  assert.match(app, /setJessOpen\\(open\\)/);
  assert.match(app, /data-hubmind-android-jess-tab/);
  assert.match(app, /<CompanionPage \\/>/);
  assert.match(app, /desktopOverlayRoute \\|\\| \\(publicOrLoginRoute && !isDesktopShell\\)/);
  assert.doesNotMatch(app, /navigate\\('\\/orb'/);
  assert.match(companion, /postMessage\\(\\{ type: 'toggle' \\}\\)/);
  assert.match(floating, /setAndroidJessTabOpen/);
  assert.match(floating, /new LiveAudioClient\\(/);
  assert.match(floating, /hubmind-native-jess-toggle/);
});
test('Android floating orb is a transparent system overlay that forwards gestures to the existing WebView', () => {
  const overlay = read('android/app/src/main/java/com/example/hubmind/agent/JessOrbOverlayManager.kt');
  const events = read('android/app/src/main/java/com/example/hubmind/agent/HubMindJessNativeEvents.kt');
  const service = read('android/app/src/main/java/com/example/hubmind/agent/HubMindAgentForegroundService.kt');
  const workspace = read('android/app/src/main/java/com/example/hubmind/ui/screens/workspace/WorkspaceScreen.kt');
  const manifest = read('android/app/src/main/AndroidManifest.xml');

  assert.match(manifest, /android\.permission\.SYSTEM_ALERT_WINDOW/);
  assert.match(overlay, /TYPE_APPLICATION_OVERLAY/);
  assert.match(overlay, /PixelFormat\.TRANSLUCENT/);
  assert.match(overlay, /onGesture\("toggle"\)/);
  assert.match(overlay, /onGesture\("stop"\)/);
  assert.match(overlay, /HubMindJessNativeEvents\.dispatch\(gesture\)/);
  assert.match(events, /MutableStateFlow<HubMindJessNativeGesture\?>/);
  assert.match(events, /fun consume\(/);
  assert.match(service, /JessOrbOverlayManager\(applicationContext\)/);
  assert.match(service, /jessOrbOverlayManager\.show\(\)/);
  assert.match(workspace, /hubmind-native-jess-toggle/);
});

test('Jess Live state controls Android microphone foreground state and mirrors real levels to the overlay', () => {
  const floating = read('src/components/JessFloatingAssistant.tsx');
  const workspace = read('android/app/src/main/java/com/example/hubmind/ui/screens/workspace/WorkspaceScreen.kt');
  const service = read('android/app/src/main/java/com/example/hubmind/agent/HubMindAgentForegroundService.kt');

  assert.match(floating, /setJessMicrophoneActive\(connection === 'connected' \|\| connection === 'connecting'\)/);
  assert.match(floating, /setJessVisualState\(/);
  assert.match(workspace, /fun setJessMicrophoneActive\(active: Boolean\)/);
  assert.match(workspace, /fun setJessVisualState\(/);
  assert.match(service, /fun updateJessOverlayState\(/);
});

test('Sign-in screen removes the visible “or email” divider but preserves existing email-account access', () => {
  const login = read('src/pages/Login.tsx');
  const app = read('src/App.tsx');
  const nativeLogin = read('android/app/src/main/java/com/example/hubmind/ui/screens/auth/AuthScreen.kt');

  assert.doesNotMatch(login, />\s*or email\s*</i);
  assert.match(login, /signInWithEmailAndPassword/);
  assert.match(login, /Continue with Google/);
  assert.doesNotMatch(nativeLogin, /or email/i);
  // Windows desktop uses the same hosted React Login route as Web.
  assert.match(app, /import\('\.\/pages\/Login'\)/);
});
