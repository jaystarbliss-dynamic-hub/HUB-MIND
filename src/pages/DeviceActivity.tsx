import React, { useEffect, useMemo, useState } from 'react';
import { collection, deleteField, doc, limit, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { Activity, CheckCircle2, CircleAlert, Clock3, Loader2, RefreshCw, Smartphone, Monitor, RadioTower, Camera } from 'lucide-react';
import { db } from '../firebaseConfig';
import { useAuth } from '../lib/auth';
import { dispatchCrossDeviceCommand } from '../services/crossDeviceService';

type DeviceCommandRecord = {
  id: string;
  commandId?: string;
  sourceDeviceId?: string;
  targetDeviceId?: string;
  actionType?: string;
  lifecycleState?: string;
  resultSuccess?: boolean;
  resultVerified?: boolean;
  resultSummary?: string;
  resultError?: string;
  resultScreenshotBase64?: string;
  resultScreenshotCapturedAt?: number;
  issuedAt?: number;
  completedAt?: number;
  expirationTime?: number;
  requiresConfirmation?: boolean;
};

type PairedDevice = {
  id: string;
  deviceId?: string;
  deviceName?: string;
  platform?: string;
  status?: string;
  batteryPercent?: number | null;
};

function formatTime(value?: number): string {
  if (!value || !Number.isFinite(value)) return 'Time not recorded';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(value));
}

function stateLabel(item: DeviceCommandRecord): string {
  if (item.resultSuccess === true && item.resultVerified === true) return 'Completed · verified';
  if (item.resultSuccess === true) return 'Completed · unverified';
  const state = String(item.lifecycleState || 'UNKNOWN').toUpperCase();
  return state.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, value => value.toUpperCase());
}

function stateTone(item: DeviceCommandRecord): string {
  if (item.resultSuccess === true && item.resultVerified === true) return 'text-emerald-300 border-emerald-500/25 bg-emerald-500/10';
  if (item.resultSuccess === false || ['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(String(item.lifecycleState || '').toUpperCase())) return 'text-rose-300 border-rose-500/25 bg-rose-500/10';
  if (item.resultSuccess === true) return 'text-amber-300 border-amber-500/25 bg-amber-500/10';
  return 'text-sky-300 border-sky-500/25 bg-sky-500/10';
}

export function DeviceActivity() {
  const { user, profile } = useAuth();
  const [records, setRecords] = useState<DeviceCommandRecord[]>([]);
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [selectedAndroidId, setSelectedAndroidId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'android' | 'windows'>('all');
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [capturingScreen, setCapturingScreen] = useState(false);
  const [captureMessage, setCaptureMessage] = useState('');
  const [lastCapturedFrame, setLastCapturedFrame] = useState<{ dataUrl: string; deviceName: string; capturedAt: number } | null>(null);

  useEffect(() => {
    if (!user?.uid) {
      setRecords([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    const commandQuery = query(
      collection(db, 'users', user.uid, 'deviceCommands'),
      orderBy('issuedAt', 'desc'),
      limit(60)
    );

    const unsubscribe = onSnapshot(commandQuery, snapshot => {
      const nextRecords: DeviceCommandRecord[] = [];
      for (const entry of snapshot.docs) {
        const data = entry.data() as Omit<DeviceCommandRecord, 'id'>;
        if (typeof data.resultScreenshotBase64 === 'string' && data.resultScreenshotBase64.length > 0) {
          const target = String(data.targetDeviceId || 'Android phone');
          setLastCapturedFrame({
            dataUrl: 'data:image/jpeg;base64,' + data.resultScreenshotBase64,
            deviceName: devices.find(device => device.id === target || device.deviceId === target)?.deviceName || target,
            capturedAt: Number(data.resultScreenshotCapturedAt || data.completedAt || Date.now()),
          });
          // The user-requested preview is copied into this page's transient state,
          // then removed from the durable command record to avoid retaining a phone
          // screenshot in the activity history.
          void updateDoc(doc(db, 'users', user.uid, 'deviceCommands', entry.id), {
            resultScreenshotBase64: deleteField(),
            resultScreenshotCapturedAt: deleteField(),
          }).catch(err => console.warn('[DeviceActivity] Could not clear transient phone preview:', err));
        }
        const { resultScreenshotBase64: _image, resultScreenshotCapturedAt: _capturedAt, ...record } = data;
        nextRecords.push({ id: entry.id, ...record });
      }
      setRecords(nextRecords);
      setLastUpdate(Date.now());
      setLoading(false);
      setError('');
    }, err => {
      console.error('[DeviceActivity] Live command feed failed:', err);
      setError(err?.message || 'The live device activity feed could not be loaded.');
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user?.uid, devices]);

  useEffect(() => {
    if (!user?.uid) {
      setDevices([]);
      return;
    }
    const deviceQuery = query(collection(db, 'users', user.uid, 'devices'), limit(100));
    return onSnapshot(deviceQuery, snapshot => {
      const next = snapshot.docs.map(entry => ({
        id: entry.id,
        ...(entry.data() as Omit<PairedDevice, 'id'>),
      }));
      setDevices(next);
      const onlineAndroid = next.filter(device =>
        String(device.platform || '').toUpperCase() === 'ANDROID' &&
        String(device.status || '').toUpperCase() === 'ONLINE'
      );
      setSelectedAndroidId(current =>
        onlineAndroid.some(device => device.id === current) ? current : (onlineAndroid[0]?.id || '')
      );
    }, err => {
      console.warn('[DeviceActivity] Could not load paired devices:', err);
    });
  }, [user?.uid]);

  const onlineAndroidDevices = useMemo(() => devices.filter(device =>
    String(device.platform || '').toUpperCase() === 'ANDROID' &&
    String(device.status || '').toUpperCase() === 'ONLINE'
  ), [devices]);

  const capturePhoneScreen = async () => {
    if (!user?.uid || !selectedAndroidId || capturingScreen) return;
    setCapturingScreen(true);
    setCaptureMessage('Requesting a screenshot from the selected Android phone…');
    try {
      const result = await dispatchCrossDeviceCommand(
        user.uid,
        selectedAndroidId,
        'CAPTURE_SCREEN',
        {},
        20_000
      );
      if (!result.success) {
        setCaptureMessage(result.error || 'The Android phone could not capture its screen.');
      } else {
        setCaptureMessage('The phone confirmed the capture. Loading the preview…');
      }
    } catch (err: any) {
      setCaptureMessage(err?.message || 'The screenshot request failed.');
    } finally {
      setCapturingScreen(false);
    }
  };

  const filtered = useMemo(() => records.filter(item => {
    if (filter === 'all') return true;
    const id = String(item.targetDeviceId || '').toLowerCase();
    const action = String(item.actionType || '').toLowerCase();
    if (filter === 'android') return id.startsWith('android-') || action.includes('android') || action === 'capture_screen';
    if (filter === 'windows') return id.startsWith('win-') || action.includes('windows') || action.includes('chrome_');
    return true;
  }), [records, filter]);

  const activeCount = records.filter(item => ['DISPATCHED', 'ACCEPTED', 'EXECUTING'].includes(String(item.lifecycleState || '').toUpperCase())).length;

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-6 overflow-y-auto p-4 md:p-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.18em] text-teal-300">
            <RadioTower size={15} /> Cross-device control plane
          </div>
          <h1 className="flex items-center gap-3 text-2xl font-bold text-white md:text-3xl">
            <Activity className="h-7 w-7 text-teal-400" /> Live Device Activity
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
            Follow commands sent between Hub-Mind and your connected devices. Statuses and results update live as each device reports progress.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3">
          <div className="relative">
            <span className="block h-2.5 w-2.5 rounded-full bg-emerald-400" />
            <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/50" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-200">Live feed</p>
            <p className="text-[11px] text-slate-500">{lastUpdate ? 'Updated ' + new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' }).format(new Date(lastUpdate)) : 'Connecting…'}</p>
          </div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <p className="text-xs text-slate-500">Recent commands</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-white">{records.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <p className="text-xs text-slate-500">Currently active</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-sky-300">{activeCount}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <p className="text-xs text-slate-500">Signed-in account</p>
          <p className="mt-1 truncate text-sm font-semibold text-white">{profile?.displayName || user?.email || 'Hub-Mind user'}</p>
          <p className="text-[11px] text-slate-500">{user?.email || ''}</p>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 md:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Smartphone size={16} className="text-teal-300" /> Android phone screen preview
            </p>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
              Request a one-time screenshot from an online paired phone. The phone must be unlocked and have Hub-Mind Accessibility enabled. Nothing is captured until you press the button.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={selectedAndroidId}
              onChange={event => setSelectedAndroidId(event.target.value)}
              disabled={!onlineAndroidDevices.length || capturingScreen}
              className="min-w-0 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-slate-200 disabled:opacity-50"
              aria-label="Select Android phone"
            >
              {onlineAndroidDevices.length
                ? onlineAndroidDevices.map(device => <option key={device.id} value={device.id}>{device.deviceName || device.id}</option>)
                : <option value="">No online Android phone</option>}
            </select>
            <button
              type="button"
              onClick={() => void capturePhoneScreen()}
              disabled={!selectedAndroidId || capturingScreen}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-teal-400/30 bg-teal-400/10 px-4 py-2.5 text-xs font-semibold text-teal-200 transition-colors hover:bg-teal-400/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {capturingScreen ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
              {capturingScreen ? 'Capturing…' : 'Capture phone screen'}
            </button>
          </div>
        </div>
        {captureMessage ? <p className="mt-3 text-xs text-slate-400">{captureMessage}</p> : null}
        {lastCapturedFrame ? (
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2 text-[11px] text-slate-400">
              <span>{lastCapturedFrame.deviceName}</span>
              <span>Captured {formatTime(lastCapturedFrame.capturedAt)}</span>
            </div>
            <img src={lastCapturedFrame.dataUrl} alt="One-time screenshot captured from the paired Android phone" className="mx-auto max-h-[560px] max-w-full object-contain" />
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-slate-800 bg-slate-950/60 p-8 text-center text-xs text-slate-500">
            No phone screenshot has been requested in this session.
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(['all', 'android', 'windows'] as const).map(value => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`rounded-full border px-3.5 py-2 text-xs font-medium transition-colors ${filter === value ? 'border-teal-400/40 bg-teal-400/10 text-teal-200' : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'}`}
            >
              {value === 'all' ? 'All activity' : value === 'android' ? 'Android phone' : 'Windows desktop'}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setLastUpdate(Date.now())}
          className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200"
          title="Refresh the feed status"
        >
          <RefreshCw size={13} /> Feed status
        </button>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-200">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div><strong className="block">Activity feed unavailable</strong><span className="text-rose-200/80">{error}</span></div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-12 text-sm text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin text-teal-300" /> Connecting to the live device activity stream…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/60 p-12 text-center">
          <Activity className="mx-auto mb-3 h-8 w-8 text-slate-600" />
          <p className="font-medium text-slate-200">No device activity yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">When Jess sends a command to an online phone or Windows workstation, its status and returned result will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(item => {
            const android = String(item.targetDeviceId || '').toLowerCase().startsWith('android-') || String(item.actionType || '').toUpperCase() === 'CAPTURE_SCREEN';
            const done = item.resultSuccess === true;
            return (
              <article key={item.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-4 md:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-slate-300">
                      {android ? <Smartphone size={19} /> : <Monitor size={19} />}
                    </div>
                    <div className="min-w-0">
                      <h2 className="break-words text-sm font-semibold text-white">{String(item.actionType || 'Device action').replace(/_/g, ' ')}</h2>
                      <p className="mt-1 break-all text-xs text-slate-500">Target: {item.targetDeviceId || 'Unknown device'}</p>
                      <p className="mt-1 text-[11px] text-slate-500">Command {item.commandId || item.id}</p>
                    </div>
                  </div>
                  <span className={`inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-medium ${stateTone(item)}`}>
                    {done && item.resultVerified ? <CheckCircle2 size={12} /> : <Clock3 size={12} />}
                    {stateLabel(item)}
                  </span>
                </div>
                {(item.resultSummary || item.resultError) && (
                  <div className={`mt-4 rounded-xl p-3 text-xs leading-relaxed ${item.resultError ? 'bg-rose-500/5 text-rose-200' : 'bg-slate-950/70 text-slate-300'}`}>
                    {item.resultError || item.resultSummary}
                  </div>
                )}
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-500">
                  <span>Sent: {formatTime(item.issuedAt)}</span>
                  {item.completedAt ? <span>Completed: {formatTime(item.completedAt)}</span> : null}
                  {item.requiresConfirmation ? <span className="text-amber-300">Confirmation-gated</span> : null}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-slate-600">
        The activity timeline updates as commands finish. Phone screen previews are one-time, user-requested snapshots; continuous screen sharing still requires the Android owner to approve the system MediaProjection prompt.
      </p>
    </div>
  );
}
