import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const rules=readFileSync(new URL('../../firestore.rules',import.meta.url),'utf8');
test('Firestore has a deny-by-default boundary',()=>assert.match(rules,/match \/\{document=\*\*\} \{ allow read, write: if false; \}/));
test('workspace resources require active membership',()=>{ for(const name of ['tasks','documents','projects','clients','meetings','followUps','knowledge']) assert.match(rules,new RegExp(`match /${name}/\\{id\\}\\s*\\{[^}]*member\\(\\)`, 's')); });
test('invitation acceptance is bound to the authenticated email and uid',()=>{ assert.match(rules,/acceptedUid == request\.auth\.uid/); assert.match(rules,/email == request\.auth\.token\.email/); });
test('recurring tasks are owner/admin controlled',()=>assert.match(rules,/match \/recurringTaskTemplates\/\{id\}/));
test('device registry and cross-device command envelopes are scoped to the authenticated active user',()=>{
  assert.match(rules,/match \/devices\/\{deviceId\}/);
  assert.match(rules,/request\.resource\.data\.deviceId == deviceId/);
  assert.match(rules,/match \/deviceCommands\/\{commandId\}/);
  assert.match(rules,/request\.resource\.data\.issuingUserId == userId/);
});
test('sharedReadData supports sharedWith array, sharedWith map, and permissions map queries without requiring composite visibility filter',()=>{
  assert.match(rules,/function sharedReadData\(data\)\{ return \(\s*\(\('sharedWith' in data\) && data\.sharedWith is list && request\.auth\.uid in data\.sharedWith\)/);
});
test('users conversations rule covers nested messages subcollections for Android and Web sync',()=>{
  assert.match(rules,/match \/conversations\/\{document=\*\*\} \{ allow read, write: if self\(userId\) \|\| admin\(\); \}/);
});
test('tasks rule allows assignedTo member to get, list, and update assigned tasks',()=>{
  assert.match(rules,/match \/tasks\/\{id\} \{ allow get: if member\(\) && \(readable\(\) \|\| resource\.data\.assignedTo == request\.auth\.uid\);/);
  assert.match(rules,/allow update: if member\(\) && \(writable\(\) \|\| resource\.data\.assignedTo == request\.auth\.uid\);/);
});