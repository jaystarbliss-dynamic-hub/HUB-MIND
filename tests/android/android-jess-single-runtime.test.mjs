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
  assert.match(app, /setJessOpen\(open\)/);
  assert.match(app, /data-hubmind-android-jess-tab/);
  assert.match(app, /<CompanionPage \/>/);
  assert.match(app, /desktopOverlayRoute \|\| \(publicOrLoginRoute && !isDesktopShell\)/);
  assert.doesNotMatch(app, /navigate\('\/orb'/);
  assert.match(companion, /postMessage\(\{ type: 'toggle' \}\)/);
  assert.match(floating, /setAndroidJessTabOpen/);
  assert.match(floating, /new LiveAudioClient\(/);
  assert.match(floating, /hubmind-native-jess-toggle/);
});
test('Android floating orb is a transparent system overlay that forwards gestures to the existing WebView', () => {
  const overlay = read('android/app/src/main/java/com/example/hubmind/agent/JessOrbOverlayManager.kt');
  const events = read('android/app/src/main/java/com/example/hubmind/agent/HubMindJessNativeEvents.kt');
  const service = read('android/app/src/main/java/com/example/hubmind/agent/HubMindAgentForegroundService.kt');
  const workspace = read('android/app/src/main/java/com/example/hubmind/ui/screens/workspace/WorkspaceScreen.kt');
  const activity = read('android/app/src/main/java/com/example/hubmind/MainActivity.kt');
  const manifest = read('android/app/src/main/AndroidManifest.xml');

  assert.match(manifest, /android\.permission\.SYSTEM_ALERT_WINDOW/);
  assert.match(overlay, /TYPE_APPLICATION_OVERLAY/);
  assert.match(overlay, /PixelFormat\.TRANSLUCENT/);
  assert.match(overlay, /MotionEvent\.ACTION_MOVE/);
  assert.match(overlay, /windowManager\.updateViewLayout\(view, params\)/);
  assert.match(overlay, /positionPrefs\.edit\(\)/);
  assert.match(overlay, /LONG_PRESS_MS/);
  assert.match(overlay, /view\.performClick\(\)/);
  assert.match(overlay, /HubMindJessNativeEvents\.dispatch\(gesture\)/);
  assert.match(events, /MutableStateFlow<HubMindJessNativeGesture\?>/);
  assert.match(events, /fun consume\(/);
  assert.match(service, /JessOrbOverlayManager\(applicationContext\)/);
  assert.match(service, /jessOrbOverlayManager\.show\(\)/);
  assert.match(service, /fun setHubMindActivityVisible\(context: Context, visible: Boolean\)/);
  assert.match(activity, /setHubMindActivityVisible\(applicationContext, true\)/);
  assert.match(activity, /setHubMindActivityVisible\(applicationContext, false\)/);
  assert.match(activity, /override fun onUserLeaveHint\(\)/);
  assert.doesNotMatch(activity, /HubMindAgentForegroundService\.refreshJessOverlay\(applicationContext\)/);
  assert.match(service, /!jessMicrophoneActive &&\s*!screenCaptureManager\.isCaptureActive &&\s*hubMindActivityVisible/);
  assert.match(service, /stopForeground\(STOP_FOREGROUND_REMOVE\)/);
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

test('Android restores the already-authorized Google account silently instead of reopening a second sign-in form', () => {
  const workspace = read('android/app/src/main/java/com/example/hubmind/ui/screens/workspace/WorkspaceScreen.kt');
  const auth = read('src/lib/auth.tsx');
  const app = read('src/App.tsx');

  assert.match(workspace, /fun requestGoogleIdToken\(\)/);
  assert.match(workspace, /GoogleSignIn\.getClient\(context, options\)\.silentSignIn\(\)/);
  assert.match(workspace, /fun getNativeUserId\(\): String/);
  assert.match(workspace, /fun signOutNative\(\)/);
  assert.match(workspace, /NativeWebAuthTokenHolder\.store\(token\)/);
  assert.match(workspace, /hubmind-native-token-ready/);
  assert.match(workspace, /hubmind-native-token-error/);
  assert.match(auth, /bridge\.requestGoogleIdToken\(\)/);
  assert.match(auth, /signInWithCredential\(auth, GoogleAuthProvider\.credential\(googleIdToken\)\)/);
  assert.match(auth, /nativeAuthBootstrapPending\.current = true/);
  assert.match(auth, /getNativeUserId/);
  assert.match(auth, /signOutNative/);
  assert.match(auth, /nativeUserId && firebaseUser\.uid !== nativeUserId/);
  assert.match(auth, /completeGoogleSignIn/);
  assert.match(app, /nativeAuthError/);
  assert.match(app, /Retry secure session/);
});

test('Hub-Mind uses Google-only authentication and Android launches the native account picker', () => {
  const login = read('src/pages/Login.tsx');
  const gate = read('src/components/AndroidGoogleSignInGate.tsx');
  const app = read('src/App.tsx');
  const nativeLogin = read('android/app/src/main/java/com/example/hubmind/ui/screens/auth/AuthScreen.kt');
  const nativeActivity = read('android/app/src/main/java/com/example/hubmind/MainActivity.kt');
  const workspace = read('android/app/src/main/java/com/example/hubmind/ui/screens/workspace/WorkspaceScreen.kt');
  const viewModel = read('android/app/src/main/java/com/example/hubmind/ui/screens/auth/AuthViewModel.kt');

  assert.match(login, /Continue with Google/);
  assert.doesNotMatch(login, /signInWithEmailAndPassword|createUserWithEmailAndPassword|sendPasswordResetEmail/);
  assert.doesNotMatch(login, /Studio email|type="password"|Forgot password/);
  assert.match(login, /AndroidGoogleSignInGate/);
  assert.match(gate, /HubMindAndroid/);
  assert.match(gate, /startGoogleSignIn/);
  assert.match(app, /AndroidGoogleSignInGate/);
  assert.match(app, /loading \|\| !user \|\| !profile/);
  assert.match(nativeLogin, /LaunchedEffect\(Unit\)/);
  assert.match(nativeLogin, /launchGoogleAccountPicker\(\)/);
  assert.match(viewModel, /fun beginGoogleSignIn\(\)/);
  assert.match(workspace, /fun startGoogleSignIn\(\)/);
  assert.match(workspace, /onRequestInteractiveGoogleSignIn/);
  assert.match(workspace, /launchInteractiveGoogleSignIn\(\)/);
  assert.match(nativeActivity, /workspaceGoogleSignInLauncher/);
  assert.match(nativeActivity, /ServiceLocator\.authRepository\.signInWithGoogle\(idToken\)/);
  assert.match(nativeActivity, /onRequestGoogleSignIn = ::launchWorkspaceGoogleSignIn/);
});
