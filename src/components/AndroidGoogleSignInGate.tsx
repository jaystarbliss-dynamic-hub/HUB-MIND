import React, { useEffect, useRef, useState } from 'react';

type AndroidGoogleSignInGateProps = {
  checking?: boolean;
  message?: string | null;
  title?: string;
  subtitle?: string;
};

/** Android signs in through its native account session, never a WebView popup. */
export function AndroidGoogleSignInGate({
  checking = false,
  message = null,
  title = 'Sign in to Hub-Mind',
  subtitle = 'Choose a Google account on this device to continue.',
}: AndroidGoogleSignInGateProps) {
  const [busy, setBusy] = useState(false);
  const [eventMessage, setEventMessage] = useState('');
  const timeoutRef = useRef<number | null>(null);
  const visibleMessage = eventMessage || message;

  const clearPendingTimeout = () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  };

  useEffect(() => {
    const onTokenError = (event: Event) => {
      clearPendingTimeout();
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      setEventMessage(detail?.message || 'Google sign-in could not be completed. Please try again.');
      setBusy(false);
    };
    const onTokenReady = () => {
      // A token is ready for Firebase exchange; it is not proof of completed auth.
      // Keep the retry control available until the authenticated route replaces this screen.
      clearPendingTimeout();
      setEventMessage('');
      setBusy(false);
    };
    window.addEventListener('hubmind-native-token-error', onTokenError);
    window.addEventListener('hubmind-native-token-ready', onTokenReady);
    return () => {
      clearPendingTimeout();
      window.removeEventListener('hubmind-native-token-error', onTokenError);
      window.removeEventListener('hubmind-native-token-ready', onTokenReady);
    };
  }, []);

  useEffect(() => {
    if (!checking || visibleMessage) setBusy(false);
  }, [checking, visibleMessage]);

  const chooseGoogleAccount = () => {
    const bridge = (window as any).HubMindAndroid;
    if (typeof bridge?.startGoogleSignIn !== 'function') {
      setEventMessage('The native Google sign-in service is unavailable in this app build. Update Hub-Mind and try again.');
      return;
    }
    clearPendingTimeout();
    setBusy(true);
    setEventMessage('');
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      setBusy(false);
      setEventMessage('Google sign-in did not return a response. Your existing account has not been signed out. Please try again.');
    }, 25000);
    try {
      bridge.startGoogleSignIn();
    } catch (error: any) {
      clearPendingTimeout();
      setBusy(false);
      setEventMessage(error?.message || 'Could not open the Google account chooser.');
    }
  };

  return (
    <main className="flex min-h-[100dvh] w-full items-center justify-center bg-slate-950 px-6 py-10 text-slate-100">
      <div className="flex w-full max-w-sm flex-col items-center text-center">
        <img src="/hub-mind%20logo.png" alt="Hub-Mind" className="mb-5 h-20 w-20 object-contain" width={80} height={80} />
        <h1 className="mb-2 text-2xl font-bold text-white">{title}</h1>
        <p className="mb-6 text-sm leading-relaxed text-slate-400">{subtitle}</p>
        {checking && !visibleMessage && (
          <p className="mb-4 text-xs text-teal-300" role="status">Restoring your saved Hub-Mind session…</p>
        )}
        {visibleMessage && (
          <div className="mb-5 w-full text-center text-sm text-amber-200" role="alert">{visibleMessage}</div>
        )}
        <button
          type="button"
          onClick={chooseGoogleAccount}
          disabled={busy}
          className="flex min-h-12 w-full items-center justify-center gap-3 rounded-xl bg-white px-5 py-3.5 font-semibold text-slate-900 transition-colors hover:bg-slate-100 disabled:cursor-wait disabled:opacity-70"
        >
          {busy ? (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" aria-hidden="true" />
          ) : (
            <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.01 13.22l7.98 6.19C11.9 13.72 17.45 9.5 24 9.5Z" />
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.93c-.58 2.96-2.25 5.47-4.72 7.16l7.35 5.7c4.28-3.95 7.42-9.77 7.42-17.33Z" />
              <path fill="#FBBC05" d="M9.99 28.59A14.42 14.42 0 0 1 9.2 24c0-1.59.28-3.13.78-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.9.94 7.59 2.6 10.78l7.39-6.19Z" />
              <path fill="#34A853" d="M24 48c6.48 0 11.94-2.13 15.92-6.12l-7.35-5.7c-2.04 1.38-4.64 2.2-8.57 2.2-6.55 0-12.1-4.22-14.01-10.09l-7.39 6.19C6.51 42.62 14.62 48 24 48Z" />
            </svg>
          )}
          {busy ? 'Connecting to Google…' : 'Continue with Google'}
        </button>
        <p className="mt-5 text-center text-xs text-slate-500">
          Hub-Mind uses your authorised Google account. No studio email or password is required.
        </p>
      </div>
    </main>
  );
}
