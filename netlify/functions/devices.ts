import { decodeFirestoreFields, encodeFirestoreFields } from '../../src/server/firebaseAdminRest';

const DEFAULT_PROJECT_ID = 'gen-lang-client-0197530608';
const DEFAULT_DATABASE_ID = 'ai-studio-hubmind-4cac2024-c6eb-4208-80cf-928714dfd430';

function getProjectId() {
  return process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
}

function getDatabaseId() {
  return process.env.FIRESTORE_DATABASE_ID || process.env.VITE_FIRESTORE_DATABASE_ID || DEFAULT_DATABASE_ID;
}

function userFirestoreUrl(path: string) {
  const projectId = encodeURIComponent(getProjectId());
  const databaseId = encodeURIComponent(getDatabaseId());
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/${path}`;
}

function encodeValue(item: any): any {
  if (typeof item === 'string') return { stringValue: item };
  if (typeof item === 'boolean') return { booleanValue: item };
  if (typeof item === 'number' && Number.isInteger(item)) return { integerValue: String(item) };
  if (typeof item === 'number') return { doubleValue: item };
  if (Array.isArray(item)) return { arrayValue: { values: item.map(encodeValue) } };
  if (item && typeof item === 'object') {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(item)) {
      if (v !== undefined) fields[k] = encodeValue(v);
    }
    return { mapValue: { fields } };
  }
  return { nullValue: null };
}

function encodeDocumentFields(record: Record<string, any>) {
  const base = encodeFirestoreFields(record);
  for (const [key, value] of Object.entries(record)) {
    if (Array.isArray(value) || (value && typeof value === 'object')) {
      base[key] = encodeValue(value);
    }
  }
  return base;
}

async function verifyAuthenticatedUser(authHeader: string) {
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!idToken || idToken.length > 10000) {
    const err: any = new Error('Authentication required. Provide a valid Bearer ID token.');
    err.status = 401;
    throw err;
  }
  const firebaseApiKey =
    process.env.FIREBASE_WEB_API_KEY ||
    process.env.VITE_FIREBASE_WEB_API_KEY ||
    process.env.FIREBASE_API_KEY ||
    process.env.VITE_FIREBASE_API_KEY;
  if (!firebaseApiKey || firebaseApiKey === 'dev-api-key' || firebaseApiKey === 'test-api-key') {
    const err: any = new Error('Firebase token verification is not configured on this server.');
    err.status = 503;
    throw err;
  }

  const lookupRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseApiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
      signal: AbortSignal.timeout(10_000),
    }
  );
  if (!lookupRes.ok) {
    const err: any = new Error('Invalid or expired Firebase ID token.');
    err.status = 401;
    throw err;
  }
  const data: any = await lookupRes.json().catch(() => ({}));
  const user = data?.users?.[0];
  if (!user?.localId || user.disabled) {
    const err: any = new Error('Your Hub-Mind account is unavailable.');
    err.status = 401;
    throw err;
  }
  return { uid: String(user.localId), email: String(user.email || ''), idToken };
}

export const handler = async (event: any) => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };

  try {
    const authHeader = String(event.headers?.authorization || event.headers?.Authorization || '');
    const caller = await verifyAuthenticatedUser(authHeader);
    const method = String(event.httpMethod || 'GET').toUpperCase();
    const rawPath = String(event.path || '');
    const body = event.body ? JSON.parse(event.body) : {};

    if (method === 'GET' && rawPath.endsWith('/commands')) {
      const targetDeviceId = event.queryStringParameters?.targetDeviceId;
      const listRes = await fetch(
        userFirestoreUrl(`users/${encodeURIComponent(caller.uid)}/deviceCommands?pageSize=50`),
        {
          headers: { Authorization: `Bearer ${caller.idToken}` },
          signal: AbortSignal.timeout(10_000),
        }
      );
      const listData: any = await listRes.json().catch(() => ({}));
      if (!listRes.ok) {
        return {
          statusCode: listRes.status,
          headers,
          body: JSON.stringify({ error: listData?.error?.message || 'Failed to list device commands.' }),
        };
      }
      const commands = (listData.documents || [])
        .map((doc: any) => decodeFirestoreFields(doc.fields || {}))
        .filter((cmd: any) => !targetDeviceId || cmd.targetDeviceId === targetDeviceId);
      return { statusCode: 200, headers, body: JSON.stringify({ commands }) };
    }

    if (method === 'GET') {
      const listRes = await fetch(
        userFirestoreUrl(`users/${encodeURIComponent(caller.uid)}/devices?pageSize=50`),
        {
          headers: { Authorization: `Bearer ${caller.idToken}` },
          signal: AbortSignal.timeout(10_000),
        }
      );
      const listData: any = await listRes.json().catch(() => ({}));
      if (!listRes.ok) {
        return {
          statusCode: listRes.status,
          headers,
          body: JSON.stringify({ error: listData?.error?.message || 'Failed to fetch devices.' }),
        };
      }
      const now = Date.now();
      const devices = (listData.documents || []).map((doc: any) => {
        const decoded = decodeFirestoreFields(doc.fields || {});
        const lastSeen = Number(decoded.lastSeen || 0);
        const isStale = now - lastSeen > 45_000;
        return {
          ...decoded,
          status: isStale && decoded.status === 'ONLINE' ? 'OFFLINE' : decoded.status,
        };
      });
      return { statusCode: 200, headers, body: JSON.stringify({ devices }) };
    }

    if (method === 'POST' && (rawPath.endsWith('/register') || body.action === 'register')) {
      const deviceId = String(body.deviceId || '').trim();
      const deviceName = String(body.deviceName || '').trim().slice(0, 160);
      const platform = String(body.platform || 'ANDROID').toUpperCase();
      if (!/^[A-Za-z0-9._-]{3,128}$/.test(deviceId) || !deviceName) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Valid deviceId and deviceName are required.' }) };
      }
      if (!['ANDROID', 'WINDOWS', 'WEB', 'PWA'].includes(platform)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unsupported device platform.' }) };
      }

      const payload: Record<string, any> = {
        deviceId,
        deviceName,
        platform,
        clientVersion: String(body.clientVersion || '2.4.0').slice(0, 50),
        status: ['ONLINE', 'BUSY', 'OFFLINE', 'UNAVAILABLE'].includes(String(body.status)) ? String(body.status) : 'ONLINE',
        lastSeen: Date.now(),
        capabilities: Array.isArray(body.capabilities) ? body.capabilities.map((c: any) => String(c)) : [],
        permissionMode: ['ask', 'allow-routine', 'allow-everything', 'always-allow'].includes(String(body.permissionMode))
          ? String(body.permissionMode)
          : 'allow-routine',
        fullControlActive: Boolean(body.fullControlActive),
        ...(typeof body.batteryPercent === 'number' ? { batteryPercent: Math.round(body.batteryPercent) } : {}),
        ...(typeof body.ipAddress === 'string' && body.ipAddress ? { ipAddress: body.ipAddress.slice(0, 100) } : {}),
        ...(typeof body.publicKeyFingerprint === 'string' && body.publicKeyFingerprint
          ? { publicKeyFingerprint: body.publicKeyFingerprint.slice(0, 256) }
          : {}),
      };

      const saveRes = await fetch(
        userFirestoreUrl(`users/${encodeURIComponent(caller.uid)}/devices/${encodeURIComponent(deviceId)}`),
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${caller.idToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fields: encodeDocumentFields(payload) }),
          signal: AbortSignal.timeout(10_000),
        }
      );
      const saveData: any = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok) {
        return {
          statusCode: saveRes.status,
          headers,
          body: JSON.stringify({ error: saveData?.error?.message || 'Device registration failed.' }),
        };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, device: payload }) };
    }

    if (method === 'POST' && (rawPath.endsWith('/dispatch') || body.action === 'dispatch')) {
      const commandId = String(body.commandId || '').trim();
      const sourceDeviceId = String(body.sourceDeviceId || '').trim();
      const targetDeviceId = String(body.targetDeviceId || '').trim();
      const actionType = String(body.actionType || '').trim();
      if (!commandId || !sourceDeviceId || !targetDeviceId || !actionType) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'commandId, sourceDeviceId, targetDeviceId, and actionType are required.' }),
        };
      }

      const [sourceRes, targetRes] = await Promise.all([
        fetch(userFirestoreUrl('users/' + encodeURIComponent(caller.uid) + '/devices/' + encodeURIComponent(sourceDeviceId)), {
          headers: { Authorization: 'Bearer ' + caller.idToken },
          signal: AbortSignal.timeout(10_000),
        }),
        fetch(userFirestoreUrl('users/' + encodeURIComponent(caller.uid) + '/devices/' + encodeURIComponent(targetDeviceId)), {
          headers: { Authorization: 'Bearer ' + caller.idToken },
          signal: AbortSignal.timeout(10_000),
        }),
      ]);
      if (!sourceRes.ok || !targetRes.ok) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ error: 'Both source and target devices must be registered to this Hub-Mind account before dispatch.' }),
        };
      }
      const [sourceDoc, targetDoc] = await Promise.all([sourceRes.json(), targetRes.json()]);
      const source = decodeFirestoreFields(sourceDoc.fields || {});
      const target = decodeFirestoreFields(targetDoc.fields || {});
      if (source.deviceId !== sourceDeviceId || target.deviceId !== targetDeviceId) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'The requested source or target device identity is invalid.' }) };
      }

      const now = Date.now();
      const expirationTime = Number(body.expirationTime || now + 30_000);
      if (!Number.isFinite(expirationTime) || expirationTime <= now || expirationTime > now + 120_000) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Command expiry must be in the next two minutes.' }) };
      }
      const replayToken = String(body.replayToken || '').trim();
      if (!replayToken || replayToken.length > 256) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'A valid replay token is required.' }) };
      }
      const envelope: Record<string, any> = {
        commandId,
        protocolVersion: String(body.protocolVersion || '1.0'),
        issuingUserId: caller.uid,
        sourceDeviceId,
        targetDeviceId,
        actionType,
        parametersJson: typeof body.parameters === 'object' ? JSON.stringify(body.parameters || {}) : String(body.parametersJson || '{}'),
        lifecycleState: 'DISPATCHED',
        requiresConfirmation: Boolean(body.requiresConfirmation),
        issuedAt: Number(body.issuedAt || now),
        expirationTime,
        replayToken,
      };

      const saveRes = await fetch(
        userFirestoreUrl(`users/${encodeURIComponent(caller.uid)}/deviceCommands/${encodeURIComponent(commandId)}`),
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${caller.idToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fields: encodeDocumentFields(envelope) }),
          signal: AbortSignal.timeout(10_000),
        }
      );
      const saveData: any = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok) {
        return {
          statusCode: saveRes.status,
          headers,
          body: JSON.stringify({ error: saveData?.error?.message || 'Command dispatch failed.' }),
        };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, command: envelope }) };
    }

    if (method === 'PATCH' || (method === 'POST' && body.action === 'ack')) {
      const commandId = String(body.commandId || '').trim();
      const lifecycleState = String(body.lifecycleState || 'COMPLETED').toUpperCase();
      if (!commandId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'commandId is required.' }) };
      }
      const existingRes = await fetch(
        userFirestoreUrl(`users/${encodeURIComponent(caller.uid)}/deviceCommands/${encodeURIComponent(commandId)}`),
        {
          headers: { Authorization: `Bearer ${caller.idToken}` },
          signal: AbortSignal.timeout(10_000),
        }
      );
      if (!existingRes.ok) {
        return { statusCode: existingRes.status, headers, body: JSON.stringify({ error: 'Command not found.' }) };
      }
      const existingDoc: any = await existingRes.json();
      const existing = decodeFirestoreFields(existingDoc.fields || {});
      const reportingDeviceId = String(body.deviceId || '').trim();
      const terminalStates = ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'];
      const allowedReporters = lifecycleState === 'TIMED_OUT' || lifecycleState === 'CANCELLED'
        ? [existing.sourceDeviceId, existing.targetDeviceId]
        : [existing.targetDeviceId];
      if (!terminalStates.includes(lifecycleState) || !reportingDeviceId || !allowedReporters.includes(reportingDeviceId)) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Only a registered source/target device may report a terminal result for this command.' }) };
      }
      const reporterRes = await fetch(
        userFirestoreUrl('users/' + encodeURIComponent(caller.uid) + '/devices/' + encodeURIComponent(reportingDeviceId)),
        {
          headers: { Authorization: 'Bearer ' + caller.idToken },
          signal: AbortSignal.timeout(10_000),
        }
      );
      if (!reporterRes.ok) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Reporting device is not registered to this account.' }) };
      }
      const updated = {
        ...existing,
        lifecycleState,
        resultSuccess: Boolean(body.resultSuccess),
        resultVerified: Boolean(body.resultVerified),
        resultSummary: String(body.resultSummary || '').slice(0, 10000),
        resultError: String(body.resultError || '').slice(0, 5000),
        completedAt: Date.now(),
      };

      const updateRes = await fetch(
        userFirestoreUrl(`users/${encodeURIComponent(caller.uid)}/deviceCommands/${encodeURIComponent(commandId)}`),
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${caller.idToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fields: encodeDocumentFields(updated) }),
          signal: AbortSignal.timeout(10_000),
        }
      );
      if (!updateRes.ok) {
        const errData: any = await updateRes.json().catch(() => ({}));
        return {
          statusCode: updateRes.status,
          headers,
          body: JSON.stringify({ error: errData?.error?.message || 'Command update failed.' }),
        };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, command: updated }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed.' }) };
  } catch (error: any) {
    const status = Number(error?.status) || 500;
    return {
      statusCode: status,
      headers,
      body: JSON.stringify({ error: error?.message || 'Device control plane error.' }),
    };
  }
};
