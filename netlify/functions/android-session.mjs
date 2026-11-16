import { createFirebaseCustomToken } from '../../src/server/firebaseAdminRest.ts';
import { getBearer, json, verifyFirebaseUser } from './lib/googleOAuth.mjs';

/**
 * Turns the Android app's already-authenticated Firebase session into a
 * short-lived custom token for the embedded Web Workspace. This is a silent
 * identity bridge, not a second sign-in.
 */
export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const nativeIdToken = getBearer(req);
    const user = await verifyFirebaseUser(nativeIdToken);
    const body = await req.json().catch(() => ({}));
    const expectedUid = String(body?.expectedUid || '').trim();

    if (!expectedUid || expectedUid !== user.localId) {
      return json({ error: 'The Android session does not match the requested Hub-Mind account.' }, 403);
    }

    const customToken = createFirebaseCustomToken(user.localId);
    return json({
      customToken,
      uid: user.localId,
      expiresIn: 55 * 60,
    });
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) console.error('Android Workspace session exchange failed:', error?.message || error);
    return json({
      error: error?.message || 'Could not connect the Android session to Workspace.',
    }, status);
  }
}

export const config = { path: '/api/android-session' };
