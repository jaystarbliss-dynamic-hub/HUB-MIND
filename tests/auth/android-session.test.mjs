import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { signFirebaseCustomToken } from '../../src/server/firebaseAdminRest.ts';

const decode = value => JSON.parse(Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4), 'base64').toString('utf8'));

test('Android Workspace Firebase custom token is signed, short-lived and bound to the verified native UID', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const issuedAt = 1_800_000_000;
  const token = signFirebaseCustomToken('native-user-123', {
    project_id: 'gen-lang-client-0197530608',
    client_email: 'firebase-adminsdk@example.iam.gserviceaccount.com',
    private_key: privateKey,
  }, issuedAt);

  const [encodedHeader, encodedClaims, signature] = token.split('.');
  const header = decode(encodedHeader);
  const claims = decode(encodedClaims);
  assert.equal(header.alg, 'RS256');
  assert.equal(claims.uid, 'native-user-123');
  assert.equal(claims.iss, 'firebase-adminsdk@example.iam.gserviceaccount.com');
  assert.equal(claims.sub, claims.iss);
  assert.equal(claims.aud, 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit');
  assert.equal(claims.iat, issuedAt);
  assert.equal(claims.exp - claims.iat, 55 * 60);

  const verifier = createVerify('RSA-SHA256');
  verifier.update(encodedHeader + '.' + encodedClaims);
  verifier.end();
  assert.equal(verifier.verify(publicKey, Buffer.from(signature.replace(/-/g, '+').replace(/_/g, '/'), 'base64')), true);
});

test('Android Workspace custom-token signer rejects invalid UIDs and incomplete signing credentials', () => {
  const account = {
    project_id: 'gen-lang-client-0197530608',
    client_email: 'firebase-adminsdk@example.iam.gserviceaccount.com',
    private_key: 'not-a-private-key',
  };
  assert.throws(() => signFirebaseCustomToken('', account), /valid Firebase UID/);
  assert.throws(() => signFirebaseCustomToken('valid-user', { client_email: '', private_key: '' }), /incomplete/);
});

test('Android session endpoint verifies the native Firebase identity and requires exact UID matching', async () => {
  const fs = await import('node:fs');
  const endpoint = fs.readFileSync(new URL('../../netlify/functions/android-session.mjs', import.meta.url), 'utf8');
  assert.match(endpoint, /verifyFirebaseUser\(nativeIdToken\)/);
  assert.match(endpoint, /expectedUid !== user\.localId/);
  assert.match(endpoint, /createFirebaseCustomToken\(user\.localId\)/);
  assert.doesNotMatch(endpoint, /GoogleSignIn|signInWithPopup|startGoogleSignIn/);
});
