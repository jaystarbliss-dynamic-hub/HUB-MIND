import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('production bundle secret scan allows only the public Firebase project ID', () => {
  const buildScript = fs.readFileSync(
    path.resolve(process.cwd(), 'scripts/build.mjs'),
    'utf8'
  );

  assert.match(
    buildScript,
    /const publicClientConfigKeys = new Set\(\[\s*'VITE_FIREBASE_PROJECT_ID',\s*\]\);/
  );
  assert.match(buildScript, /if \(publicClientConfigKeys\.has\(key\)\) continue;/);
  assert.match(buildScript, /'VITE_FIREBASE_WEB_API_KEY'/);
  assert.match(buildScript, /AIzaSy\[A-Za-z0-9_-\]\{20,\}/);
});
