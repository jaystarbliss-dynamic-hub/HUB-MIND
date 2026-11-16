import React, { useEffect, useState } from 'react';

type AndroidGoogleSignInGateProps = {
  checking?: boolean;
  message?: string | null;
  title?: string;
  subtitle?: string;
  onRetry?: () => void;
};

/**
 * Android has already authenticated through the native app shell. This screen
 * only waits for that same Firebase identity to connect to the embedded
 * Workspace; it must never present a second Google sign-in action.
 */
export function AndroidGoogleSignInGate({
  checking = false,
  message = null,
  title = 'Connecting to Workspace',
  subtitle = 'Your Hub-Mind account is already signed in. Workspace is opening with that same account.',
  onRetry,
}: AndroidGoogleSignInGateProps) {
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (checking) setRetrying(false);
  }, [checking]);

  const retryConnection = () => {
    if (retrying || checking) return;
    setRetrying(true);
    onRetry?.();
  };

  return (
    <main className="flex min-h-[100dvh] w-full items-center justify-center bg-slate-950 px-6 py-10 text-slate-100">
      <div className="flex w-full max-w-sm flex-col items-center text-center">
        <img src="/hub-mind%20logo.png" alt="Hub-Mind" className="mb-5 h-20 w-20 object-contain" width={80} height={80} />
        <h1 className="mb-2 text-2xl font-bold text-white">{title}</h1>
        <p className="mb-6 text-sm leading-relaxed text-slate-400">{subtitle}</p>
        {checking && !message && (
          <div className="flex items-center justify-center gap-3 text-sm text-teal-300" role="status">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-teal-900 border-t-teal-300" aria-hidden="true" />
            Connecting your existing Hub-Mind session…
          </div>
        )}
        {message && (
          <div className="mb-5 w-full text-center text-sm text-amber-200" role="alert">{message}</div>
        )}
        {message && (
          <button
            type="button"
            onClick={retryConnection}
            disabled={checking || retrying}
            className="flex min-h-12 w-full items-center justify-center gap-3 rounded-xl bg-white px-5 py-3.5 font-semibold text-slate-900 transition-colors hover:bg-slate-100 disabled:cursor-wait disabled:opacity-70"
          >
            {retrying || checking ? 'Reconnecting…' : 'Retry Workspace Connection'}
          </button>
        )}
        <p className="mt-5 text-center text-xs text-slate-500">
          One Google sign-in opens the Android app and Workspace together. You will not be asked to sign in again here.
        </p>
      </div>
    </main>
  );
}
