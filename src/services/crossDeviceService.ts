import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebaseConfig';
import type { User } from '../types';
import hubMindPackage from '../../package.json';

export interface CrossDeviceNode {
  deviceId: string;
  deviceName: string;
  platform: 'ANDROID' | 'WINDOWS' | 'WEB' | 'PWA';
  clientVersion: string;
  status: 'ONLINE' | 'BUSY' | 'OFFLINE' | 'UNAVAILABLE';
  lastSeen: number;
  capabilities: string[];
  permissionMode: string;
  fullControlActive: boolean;
  batteryPercent?: number;
  ipAddress?: string;
}

export interface CrossDeviceCommandEnvelope {
  commandId: string;
  protocolVersion: string;
  issuingUserId: string;
  sourceDeviceId: string;
  targetDeviceId: string;
  actionType: string;
  parametersJson: string;
  lifecycleState: 'CREATED' | 'DISPATCHED' | 'ACCEPTED' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT';
  requiresConfirmation: boolean;
  issuedAt: number;
  expirationTime: number;
  replayToken: string;
  resultSuccess?: boolean;
  resultVerified?: boolean;
  resultSummary?: string;
  resultError?: string;
  completedAt?: number;
}

const LOCAL_DEVICE_STORAGE_KEY = 'hubmind_cross_device_node_id';

export function getLocalDeviceId(): string {
  const isAndroid = typeof window !== 'undefined' && (window as any).hubMindAndroid?.isAndroidApp === true;
  const isDesktop = typeof window !== 'undefined' && Boolean((window as any).hubMindDesktop);
  const prefix = isAndroid ? 'android-phone' : isDesktop ? 'win-workstation' : 'web-workspace';
  try {
    const existing = localStorage.getItem(LOCAL_DEVICE_STORAGE_KEY);
    if (existing && existing.startsWith(prefix)) return existing;
    const suffix = Math.random().toString(36).slice(2, 10);
    const created = `${prefix}-${suffix}`;
    localStorage.setItem(LOCAL_DEVICE_STORAGE_KEY, created);
    return created;
  } catch {
    return `${prefix}-primary`;
  }
}

export async function registerCurrentWorkspaceDevice(
  userId: string,
  options?: {
    permissionMode?: string;
    fullControlActive?: boolean;
    deviceName?: string;
  }
): Promise<CrossDeviceNode> {
  const isAndroid = typeof window !== 'undefined' && (window as any).hubMindAndroid?.isAndroidApp === true;
  const isDesktop = typeof window !== 'undefined' && Boolean((window as any).hubMindDesktop);
  const deviceId = getLocalDeviceId();
  let desktopStatus: any = null;
  let androidInfo: any = null;
  if (isDesktop && (window as any).hubMindDesktop?.getControlSessionStatus) {
    try { desktopStatus = await (window as any).hubMindDesktop.getControlSessionStatus(); } catch { desktopStatus = null; }
  }
  if (isAndroid && (window as any).hubMindAndroid?.getDeviceInfo) {
    try { androidInfo = await (window as any).hubMindAndroid.getDeviceInfo(); } catch { androidInfo = null; }
  }

  const node: CrossDeviceNode = {
    deviceId,
    deviceName: options?.deviceName || (isAndroid
      ? String(androidInfo?.deviceName || 'Hub-Mind Android Phone')
      : isDesktop ? 'Hub-Mind Windows Workstation' : 'Hub-Mind Web Workspace'),
    platform: isAndroid ? 'ANDROID' : isDesktop ? 'WINDOWS' : 'WEB',
    clientVersion: String(hubMindPackage.version || '2.4.0'),
    status: 'ONLINE',
    lastSeen: Date.now(),
    capabilities: isAndroid
      ? ['ANDROID_ACCESSIBILITY', 'ANDROID_UI_AUTOMATION', 'ANDROID_APP_LAUNCH', 'ANDROID_DEVICE_STATUS', 'ANDROID_SCREEN_CAPTURE']
      : isDesktop
        ? [
            'WINDOWS_SHELL',
            'WINDOWS_UI_AUTOMATION',
            'WINDOWS_APP_LAUNCH',
            'WINDOWS_WINDOW_MANAGEMENT',
            'WINDOWS_CLIPBOARD',
            'WINDOWS_SCREEN_CAPTURE',
            'CHROME_EXTENSION_BRIDGE',
          ]
        : ['VOICE_INPUT', 'VOICE_OUTPUT'],
    permissionMode: options?.permissionMode || desktopStatus?.preferences?.permissionMode || 'allow-routine',
    fullControlActive: Boolean(options?.fullControlActive ?? (isAndroid ? androidInfo?.accessibilityEnabled : desktopStatus?.active)),
    batteryPercent: Number.isFinite(Number(androidInfo?.batteryPercent)) ? Number(androidInfo.batteryPercent) : undefined,
  };

  await setDoc(doc(db, 'users', userId, 'devices', deviceId), node, { merge: true });
  return node;
}

export async function listUserDevices(userId: string): Promise<CrossDeviceNode[]> {
  const snap = await getDocs(collection(db, 'users', userId, 'devices'));
  const now = Date.now();
  return snap.docs.map((entry) => {
    const data = entry.data() as CrossDeviceNode;
    const isStale = now - Number(data.lastSeen || 0) > 60_000;
    return {
      ...data,
      deviceId: data.deviceId || entry.id,
      status: isStale && data.status === 'ONLINE' ? 'OFFLINE' : data.status,
    };
  });
}

export async function dispatchCrossDeviceCommand(
  userId: string,
  targetDeviceId: string,
  actionType: string,
  parameters: Record<string, any> = {},
  timeoutMs = 20_000
): Promise<{
  success: boolean;
  verified: boolean;
  commandId: string;
  targetDeviceId: string;
  summary: string;
  error?: string;
}> {
  const commandId = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  const envelope: CrossDeviceCommandEnvelope = {
    commandId,
    protocolVersion: '1.0',
    issuingUserId: userId,
    sourceDeviceId: getLocalDeviceId(),
    targetDeviceId,
    actionType,
    parametersJson: JSON.stringify(parameters || {}),
    lifecycleState: 'DISPATCHED',
    requiresConfirmation: false,
    issuedAt: now,
    expirationTime: now + timeoutMs,
    replayToken: `nonce-${commandId}`,
  };

  const cmdRef = doc(db, 'users', userId, 'deviceCommands', commandId);
  await setDoc(cmdRef, envelope);

  return new Promise((resolve) => {
    let settled = false;
    let unsub: Unsubscribe | null = null;

    const timer = setTimeout(async () => {
      if (settled) return;
      settled = true;
      unsub?.();
      try {
        await updateDoc(cmdRef, {
          lifecycleState: 'TIMED_OUT',
          resultSuccess: false,
          resultVerified: false,
          resultError: `Timed out after ${timeoutMs}ms waiting for device ${targetDeviceId}.`,
          completedAt: Date.now(),
        });
      } catch {
        // Ignore cleanup failure
      }
      resolve({
        success: false,
        verified: false,
        commandId,
        targetDeviceId,
        summary: '',
        error: `Target device ${targetDeviceId} did not respond within ${Math.round(timeoutMs / 1000)}s. Ensure Hub-Mind is open and connected on that device.`,
      });
    }, timeoutMs);

    unsub = onSnapshot(
      cmdRef,
      (snapshot) => {
        if (!snapshot.exists() || settled) return;
        const data = snapshot.data() as CrossDeviceCommandEnvelope;
        if (
          data.lifecycleState === 'COMPLETED' ||
          data.lifecycleState === 'FAILED' ||
          data.lifecycleState === 'CANCELLED' ||
          data.lifecycleState === 'TIMED_OUT'
        ) {
          settled = true;
          clearTimeout(timer);
          unsub?.();
          resolve({
            success: Boolean(data.resultSuccess),
            verified: Boolean(data.resultVerified),
            commandId,
            targetDeviceId,
            summary: String(data.resultSummary || ''),
            error: data.resultError ? String(data.resultError) : undefined,
          });
        }
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsub?.();
        resolve({
          success: false,
          verified: false,
          commandId,
          targetDeviceId,
          summary: '',
          error: err?.message || 'Failed to observe cross-device command status.',
        });
      }
    );
  });
}

export function startCrossDeviceAgentLoop(
  user: User,
  toolExecutor: (toolName: string, args: Record<string, any>) => Promise<{ result: any }>
): () => void {
  const deviceId = getLocalDeviceId();
  const processedCommands = new Set<string>();

  void registerCurrentWorkspaceDevice(user.id).catch((err) => {
    console.warn('[CrossDevice] Initial device registration warning:', err?.message || err);
  });

  const heartbeatInterval = window.setInterval(() => {
    void registerCurrentWorkspaceDevice(user.id).catch(() => {});
  }, 15_000);

  const commandsQuery = query(
    collection(db, 'users', user.id, 'deviceCommands'),
    where('targetDeviceId', '==', deviceId),
    where('lifecycleState', '==', 'DISPATCHED')
  );

  const unsubCommands = onSnapshot(
    commandsQuery,
    (snapshot) => {
      for (const change of snapshot.docChanges()) {
        if (change.type !== 'added' && change.type !== 'modified') continue;
        const cmd = change.doc.data() as CrossDeviceCommandEnvelope;
        if (!cmd?.commandId || processedCommands.has(cmd.commandId)) continue;
        if (cmd.lifecycleState !== 'DISPATCHED') continue;

        processedCommands.add(cmd.commandId);
        const cmdRef = doc(db, 'users', user.id, 'deviceCommands', cmd.commandId);

        void (async () => {
          const now = Date.now();
          if (cmd.expirationTime && now > cmd.expirationTime) {
            await updateDoc(cmdRef, {
              lifecycleState: 'TIMED_OUT',
              resultSuccess: false,
              resultVerified: false,
              resultError: 'Command expired before execution.',
              completedAt: now,
            }).catch(() => {});
            return;
          }

          await updateDoc(cmdRef, {
            lifecycleState: 'EXECUTING',
          }).catch(() => {});

          let parsedParams: Record<string, any> = {};
          try {
            parsedParams = cmd.parametersJson ? JSON.parse(cmd.parametersJson) : {};
          } catch {
            parsedParams = {};
          }

          if (cmd.actionType === 'ping_device' || cmd.actionType === 'PING') {
            await updateDoc(cmdRef, {
              lifecycleState: 'COMPLETED',
              resultSuccess: true,
              resultVerified: true,
              resultSummary: `Pong from ${deviceId} (${(window as any).hubMindAndroid?.isAndroidApp ? 'Android Phone' : (window as any).hubMindDesktop ? 'Windows Workstation' : 'Web Workspace'})`,
              completedAt: Date.now(),
            }).catch(() => {});
            return;
          }

          try {
            const normalizedArgs = {
              ...parsedParams,
              ...(parsedParams.appName && !parsedParams.name ? { name: parsedParams.appName } : {}),
            };
            const execOut = await toolExecutor(cmd.actionType, normalizedArgs);
            const resObj = execOut?.result || {};
            const ok = resObj.success === true || resObj.ok === true || resObj.status === 'done_verified';
            const verified = resObj.verified === true || resObj.status === 'done_verified' || ok;
            const summary =
              resObj.message ||
              resObj.summary ||
              (resObj.evidence ? JSON.stringify(resObj.evidence).slice(0, 4000) : JSON.stringify(resObj).slice(0, 4000));

            await updateDoc(cmdRef, {
              lifecycleState: ok ? 'COMPLETED' : 'FAILED',
              resultSuccess: ok,
              resultVerified: verified,
              resultSummary: ok ? String(summary) : '',
              resultError: ok ? '' : String(resObj.error || resObj.message || 'Execution failed on target workstation.'),
              completedAt: Date.now(),
            }).catch(() => {});
          } catch (err: any) {
            await updateDoc(cmdRef, {
              lifecycleState: 'FAILED',
              resultSuccess: false,
              resultVerified: false,
              resultSummary: '',
              resultError: String(err?.message || err || 'Unhandled error executing cross-device command.'),
              completedAt: Date.now(),
            }).catch(() => {});
          }
        })();
      }
    },
    (err) => {
      console.warn('[CrossDevice] Command listener warning:', err?.message || err);
    }
  );

  return () => {
    window.clearInterval(heartbeatInterval);
    unsubCommands();
  };
}
