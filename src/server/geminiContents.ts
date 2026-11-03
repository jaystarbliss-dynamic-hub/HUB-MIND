export type GeminiContentPart = Record<string, unknown> & {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  fileData?: { mimeType: string; fileUri: string };
  functionCall?: { name: string; args: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: unknown; id?: string };
};

export type GeminiContent = {
  role: 'user' | 'model';
  parts: GeminiContentPart[];
};

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;

const nonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

const firstValue = (record: UnknownRecord, camel: string, snake: string): unknown =>
  record[camel] ?? record[snake];

function normalizePart(value: unknown): GeminiContentPart[] {
  if (typeof value === 'string') {
    return nonEmptyString(value) ? [{ text: value }] : [];
  }

  const part = asRecord(value);
  if (!part) return [];

  const output: GeminiContentPart[] = [];
  const thoughtSignature = nonEmptyString(firstValue(part, 'thoughtSignature', 'thought_signature'));

  const text = nonEmptyString(part.text);
  if (text) output.push({ text });

  const inlineData = asRecord(firstValue(part, 'inlineData', 'inline_data'));
  const inlineMimeType = nonEmptyString(inlineData?.mimeType ?? inlineData?.mime_type);
  const inlineBytes = nonEmptyString(inlineData?.data);
  if (inlineMimeType && inlineBytes) {
    output.push({ inlineData: { mimeType: inlineMimeType, data: inlineBytes } });
  }

  const fileData = asRecord(firstValue(part, 'fileData', 'file_data'));
  const fileMimeType = nonEmptyString(fileData?.mimeType ?? fileData?.mime_type);
  const fileUri = nonEmptyString(fileData?.fileUri ?? fileData?.file_uri);
  if (fileMimeType && fileUri) {
    output.push({ fileData: { mimeType: fileMimeType, fileUri } });
  }

  const functionCall = asRecord(firstValue(part, 'functionCall', 'function_call'));
  const functionName = nonEmptyString(functionCall?.name);
  if (functionCall && functionName) {
    const args = asRecord(functionCall.args) || {};
    const normalized: GeminiContentPart = {
      functionCall: { name: functionName, args: { ...args } },
    };
    const callId = nonEmptyString(functionCall.id);
    if (callId) (normalized.functionCall as Record<string, unknown>).id = callId;
    if (thoughtSignature) normalized.thoughtSignature = thoughtSignature;
    output.push(normalized);
  }

  const functionResponse = asRecord(firstValue(part, 'functionResponse', 'function_response'));
  const responseName = nonEmptyString(functionResponse?.name);
  if (functionResponse && responseName && functionResponse.response !== undefined) {
    const normalized: GeminiContentPart = {
      functionResponse: {
        name: responseName,
        response: functionResponse.response,
      },
    };
    const responseId = nonEmptyString(functionResponse.id);
    if (responseId) (normalized.functionResponse as Record<string, unknown>).id = responseId;
    output.push(normalized);
  }

  const executableCode = asRecord(firstValue(part, 'executableCode', 'executable_code'));
  const executableSource = nonEmptyString(executableCode?.code);
  const executableLanguage = nonEmptyString(executableCode?.language);
  if (executableCode && executableSource && executableLanguage) {
    output.push({
      executableCode: { code: executableSource, language: executableLanguage },
      ...(thoughtSignature ? { thoughtSignature } : {}),
    });
  }

  const codeExecutionResult = asRecord(firstValue(part, 'codeExecutionResult', 'code_execution_result'));
  const outcome = nonEmptyString(codeExecutionResult?.outcome);
  if (codeExecutionResult && outcome) {
    output.push({
      codeExecutionResult: {
        outcome,
        ...(typeof codeExecutionResult.output === 'string' ? { output: codeExecutionResult.output } : {}),
      },
      ...(thoughtSignature ? { thoughtSignature } : {}),
    });
  }

  return output;
}

function messageParts(message: UnknownRecord): unknown[] {
  if (Array.isArray(message.parts)) return message.parts;

  const content = message.content;
  if (Array.isArray(content)) return content;

  const contentRecord = asRecord(content);
  if (contentRecord && Array.isArray(contentRecord.parts)) return contentRecord.parts;

  if (typeof content === 'string' && content.trim()) return [{ text: content }];
  if (typeof message.text === 'string' && message.text.trim()) return [{ text: message.text }];

  // Some older clients wrapped a single Gemini part directly in "content".
  if (contentRecord) return [contentRecord];
  return [];
}

/**
 * Converts Hub-Mind's historical chat payloads into valid Gemini Content objects.
 *
 * Older Android builds sent { role, content: "..." } while the Gemini SDK expects
 * { role, parts: [{ text: "..." }] }. Invalid/empty Part objects are dropped before
 * reaching the SDK so Gemini never receives an uninitialized Part.data oneof.
 */
export function normalizeGeminiContents(input: unknown): GeminiContent[] {
  if (!Array.isArray(input)) return [];

  const contents: GeminiContent[] = [];
  for (const item of input) {
    if (typeof item === 'string') {
      const text = nonEmptyString(item);
      if (text) contents.push({ role: 'user', parts: [{ text }] });
      continue;
    }

    const message = asRecord(item);
    if (!message) continue;

    const rawRole = String(message.role ?? message.speaker ?? 'user').trim().toLowerCase();
    if (rawRole === 'system' || rawRole === 'developer') continue;
    const role: GeminiContent['role'] =
      rawRole === 'model' || rawRole === 'assistant' || rawRole === 'jess'
        ? 'model'
        : 'user';

    const parts = messageParts(message).flatMap(normalizePart);
    if (parts.length) contents.push({ role, parts });
  }

  return contents;
}

export function geminiContentText(content: GeminiContent): string {
  return content.parts
    .map((part) => typeof part.text === 'string' ? part.text : '')
    .filter((value) => value.trim().length > 0)
    .join('\n');
}
