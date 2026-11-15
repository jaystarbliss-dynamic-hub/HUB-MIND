import React, { useEffect, useState } from 'react';
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
} from 'firebase/auth';
import { auth } from '../firebaseConfig';
import { useNavigate, useLocation } from 'react-router-dom';
import { Loader2, LogIn, AlertCircle, ArrowLeft } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { isJessInstalledApp } from '../services/jessWakeListener';
import { AndroidGoogleSignInGate } from '../components/AndroidGoogleSignInGate';

const PENDING_INVITE_STORAGE_KEY = 'hubmind_pending_invite';

function formatAuthError(err: any, fallback: string): string {
  const code = String(err?.code || '');
  switch (code) {
    case 'auth/popup-closed-by-user':
      return 'The Google account chooser was closed before sign-in finished. Please try again.';
    case 'auth/cancelled-popup-request':
      return 'Another Google sign-in attempt interrupted this one. Please try again.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google sign-in window. Allow popups for this site or try again.';
    case 'auth/account-exists-with-different-credential':
      return 'This email is already registered with another sign-in provider. Use the Google account linked to your Hub-Mind invitation.';
    case 'auth/too-many-requests':
      return 'Too many sign-in attempts. Wait a moment and try again.';
    case 'auth/network-request-failed':
      return 'Network error while contacting Google sign-in. Check your internet connection and retry.';
    default:
      return err?.message || fallback;
  }
}

export function Login() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const {
    user,
    profile,
    loading: authLoading,
    authorizationError,
    nativeAuthError,
  } = useAuth();
  const invite = new URLSearchParams(location.search).get('invite');
  const androidBridge = (window as any).HubMindAndroid;
  const isAndroidApp = androidBridge?.isAndroidApp?.() === true ||
    (typeof androidBridge?.getGoogleIdToken === 'function' &&
      typeof androidBridge?.startGoogleSignIn === 'function');

  useEffect(() => {
    if (invite && typeof window !== 'undefined') {
      try {
        window.sessionStorage.setItem(PENDING_INVITE_STORAGE_KEY, invite);
      } catch {}
    }
  }, [invite]);

  useEffect(() => {
    if (isAndroidApp) return;
    void getRedirectResult(auth).catch((err: any) => {
      if (err) {
        setError(formatAuthError(err, 'Failed to complete Google sign-in.'));
        setLoading(false);
      }
    });
  }, [isAndroidApp]);

  useEffect(() => {
    if (user && profile?.status === 'active') {
      navigate('/workspace', { replace: true });
    }
  }, [user, profile, navigate]);

  useEffect(() => {
    if (authorizationError) {
      setError(authorizationError);
      setLoading(false);
    }
  }, [authorizationError]);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError('');
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      const code = String(err?.code || '');
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        try {
          const provider = new GoogleAuthProvider();
          provider.setCustomParameters({ prompt: 'select_account' });
          await signInWithRedirect(auth, provider);
          return;
        } catch (redirectErr: any) {
          setError(formatAuthError(redirectErr, 'Failed to sign in with Google.'));
          setLoading(false);
          return;
        }
      }
      setError(formatAuthError(err, 'Failed to sign in with Google.'));
      setLoading(false);
    }
  };

  if (isAndroidApp) {
    return (
      <AndroidGoogleSignInGate
        checking={authLoading}
        message={nativeAuthError || authorizationError}
        title="Sign in to Hub-Mind"
        subtitle={invite
          ? 'Choose the Google account associated with your Hub-Mind invitation.'
          : 'Choose a Google account registered on this device to continue.'}
      />
    );
  }

  const isBusy = loading || (Boolean(user) && authLoading);

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
      <section className="flex w-full max-w-sm flex-col items-center text-center text-slate-100">
        {!isJessInstalledApp() && (
          <button
            type="button"
            onClick={() => navigate('/')}
            className="mb-7 inline-flex items-center justify-center gap-2 text-xs text-slate-400 hover:text-teal-300"
          >
            <ArrowLeft size={14} /> Back to Hub-Mind
          </button>
        )}

        <div className="mb-6 flex flex-col items-center">
          <img
            src="/hub-mind%20logo.png"
            alt="Hub-Mind"
            className="mb-4 h-20 w-20 object-contain"
            width={80}
            height={80}
          />
          <h1 className="text-2xl font-bold text-white">Welcome to Hub-Mind</h1>
          <p className="mt-2 text-center text-sm text-slate-400">
            Sign in securely with your Google account.
          </p>
        </div>

        {invite && (
          <div className="mb-5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
            <p className="text-sm font-medium text-emerald-300">Invitation detected</p>
            <p className="mt-1 text-xs text-slate-400">
              Continue with the Google account that received this invitation. Hub-Mind will verify access before opening your workspace.
            </p>
          </div>
        )}

        {error && (
          <div role="alert" className="mb-5 flex items-start gap-2 rounded-xl border border-rose-800/60 bg-rose-950/40 p-3 text-sm text-rose-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={isBusy}
          className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 font-semibold text-slate-900 transition-colors hover:bg-slate-100 disabled:opacity-60"
        >
          {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
          {isBusy ? 'Signing in…' : 'Continue with Google'}
        </button>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-500">
          Hub-Mind is a private workspace. New members need a valid invitation. Email and password sign-in are not used.
        </p>
      </section>
    </main>
  );
}
