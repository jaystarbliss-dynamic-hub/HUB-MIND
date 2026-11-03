import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('production bundle scan exempts public Firebase metadata but continues scanning credentials', () => {
  const buildScript = fs.readFileSync(
    path.resolve(process.cwd(), 'scripts/build.mjs'),
    'utf8'
  );

  for (const key of [
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_APP_ID',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIRESTORE_DATABASE_ID',
    'VITE_GOOGLE_CLIENT_ID',
  ]) {
    assert.match(buildScript, new RegExp(`'${key}'`), `${key} must be treated as public client configuration`);
  }

  const allowlist = buildScript.match(/const publicClientConfigKeys = new Set\(\[([\s\S]*?)\]\);/)?.[1] || '';
  assert.match(buildScript, /if \(publicClientConfigKeys\.has\(key\)\) continue;/);
  assert.match(buildScript, /'VITE_FIREBASE_WEB_API_KEY'/);
  assert.doesNotMatch(allowlist, /VITE_FIREBASE_WEB_API_KEY/);
  assert.match(buildScript, /AIzaSy[A-Za-z0-9_-]{20,}/);
});
