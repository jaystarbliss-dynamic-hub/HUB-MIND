import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGeminiContents, geminiContentText } from '../../src/server/geminiContents.ts';

test('normalizes legacy Android role/content messages into Gemini text Parts', () => {
  const contents = normalizeGeminiContents([
    { role: 'user', content: 'Hello Jess' },
    { role: 'model', content: 'Hello! How can I help?' },
    { role: 'user', content: '  ' },
  ]);

  assert.deepEqual(contents, [
    { role: 'user', parts: [{ text: 'Hello Jess' }] },
    { role: 'model', parts: [{ text: 'Hello! How can I help?' }] },
  ]);
  assert.equal(geminiContentText(contents[0]), 'Hello Jess');
});

test('preserves valid browser text and image Parts while removing empty Part objects', () => {
  const contents = normalizeGeminiContents([
    {
      role: 'user',
      parts: [
        { text: 'What is in this screenshot?' },
        {},
        { text: '' },
        { inlineData: { mimeType: 'image/jpeg', data: 'aGVsbG8=' } },
        { inlineData: { mimeType: 'image/jpeg', data: '' } },
      ],
    },
  ]);

  assert.equal(contents.length, 1);
  assert.deepEqual(contents[0].parts, [
    { text: 'What is in this screenshot?' },
    { inlineData: { mimeType: 'image/jpeg', data: 'aGVsbG8=' } },
  ]);
  for (const part of contents[0].parts) {
    assert.ok(
      ['text', 'inlineData', 'fileData', 'functionCall', 'functionResponse', 'executableCode', 'codeExecutionResult']
        .some((field) => Object.prototype.hasOwnProperty.call(part, field)),
      'every forwarded Gemini Part must initialize a supported data oneof field',
    );
  }
});

test('maps assistant/Jess roles to model and ignores system-only history messages', () => {
  const contents = normalizeGeminiContents([
    { role: 'system', content: 'System instructions are sent separately.' },
    { speaker: 'assistant', text: 'Assistant history' },
    { speaker: 'jess', text: 'Jess history' },
    { role: 'user', content: 'User history' },
  ]);

  assert.deepEqual(contents, [
    { role: 'model', parts: [{ text: 'Assistant history' }] },
    { role: 'model', parts: [{ text: 'Jess history' }] },
    { role: 'user', parts: [{ text: 'User history' }] },
  ]);
});

test('preserves valid Gemini function call and function response Parts', () => {
  const contents = normalizeGeminiContents([
    {
      role: 'model',
      parts: [{
        functionCall: { name: 'list_projects', args: { limit: 5 }, id: 'call-1' },
        thoughtSignature: 'signed-thought',
      }],
    },
    {
      role: 'user',
      parts: [{ functionResponse: { name: 'list_projects', id: 'call-1', response: { projects: [] } } }],
    },
  ]);

  assert.deepEqual(contents[0].parts[0], {
    functionCall: { name: 'list_projects', args: { limit: 5 }, id: 'call-1' },
    thoughtSignature: 'signed-thought',
  });
  assert.deepEqual(contents[1].parts[0], {
    functionResponse: { name: 'list_projects', id: 'call-1', response: { projects: [] } },
  });
});

test('splits accidental multi-field Part objects into valid oneof Parts and rejects empty conversations', () => {
  const contents = normalizeGeminiContents([
    {
      role: 'user',
      parts: [{
        text: 'Describe this image',
        inlineData: { mimeType: 'image/png', data: 'cG5n' },
      }],
    },
    { role: 'model', parts: [{}] },
    { role: 'user', content: '' },
  ]);

  assert.deepEqual(contents, [{
    role: 'user',
    parts: [
      { text: 'Describe this image' },
      { inlineData: { mimeType: 'image/png', data: 'cG5n' } },
    ],
  }]);
  assert.deepEqual(normalizeGeminiContents([{ role: 'user', parts: [{}, { text: '' }] }]), []);
});

test('both production and self-hosted Jess chat endpoints normalize content before calling Gemini', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = process.cwd();
  const netlifyChat = fs.readFileSync(path.join(root, 'netlify/functions/chat.ts'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server.ts'), 'utf8');

  assert.match(netlifyChat, /normalizeGeminiContents\(body\.messages\)/);
  assert.match(netlifyChat, /contents:\s*contents as any/);
  assert.match(server, /normalizeGeminiContents\(messages\)/);
  assert.match(server, /contents:\s*geminiContents/);
  assert.doesNotMatch(server, /contents:\s*messages\s*[,}]/);
});
