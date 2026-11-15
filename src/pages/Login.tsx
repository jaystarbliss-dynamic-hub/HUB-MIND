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

const PENDING_INVITE_STORAGE_KEY = 'hubmind_pending_invite';

function formatAuthError(err: any, fallback: string): string {
  const code = String(err?.code || '');
  switch (code) {
    case 'auth/popup-closed-by-user':
      return 'The Google sign-in window was closed before finishing. Please try again.';
    case 'auth/cancelled-popup-request':
      return 'Another sign-in attempt interrupted this one. Please click Continue with Google again.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in popup. Allow popups for this site or try again.';
    case 'auth/account-exists-with-different-credential':
      return 'This account is registered with a different sign-in provider. Contact an administrator for help.';
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Wait a couple of minutes and try again.';
    case 'auth/network-request-failed':
      return 'Network error while contacting sign-in servers. Check your internet connection and retry.';
    default:
      return err?.message || fallback;
  }
}

export function Login() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile, loading: authLoading, authorizationError } = useAuth();
  const invite = new URLSearchParams(location.search).get('invite');

  useEffect(() => {
    if (invite && typeof window !== 'undefined') {
      try {
        window.sessionStorage.setItem(PENDING_INVITE_STORAGE_KEY, invite);
      } catch {}
    }
  }, [invite]);

  useEffect(() => {
    void getRedirectResult(auth).catch((err: any) => {
      if (err) {
        setError(formatAuthError(err, 'Failed to complete Google sign-in.'));
        setLoading(false);
      }
    });
  }, []);

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

  useEffect(() => {
    if (!authLoading && (!user || !profile)) setLoading(false);
  }, [authLoading, user, profile]);

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

  const isBusy = loading || (Boolean(user) && authLoading);

  return <main className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
    <section className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
      {!isJessInstalledApp() && (
        <button onClick={() => navigate('/')} className="text-xs text-slate-400 hover:text-teal-300 inline-flex items-center gap-2 mb-7">
          <ArrowLeft size={14}/> Back to Hub-Mind
        </button>
      )}
      <div className="flex flex-col items-center mb-7">
        <img src="/hub-mind%20logo.png" alt="Hub-Mind" className="w-20 h-20 object-contain mb-4" width={80} height={80} />
        <h1 className="text-2xl font-bold text-slate-100">Welcome back</h1>
        <p className="text-sm text-slate-400 mt-2 text-center">Sign in to open your Hub-Mind workspace.</p>
      </div>
      {invite && (
        <div className="mb-5 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
          <p className="text-sm text-emerald-300 font-medium">Invitation detected</p>
          <p className="text-xs text-slate-400 mt-1">Continue with the Google account that received the invitation. Your invitation will be verified before access is granted.</p>
        </div>
      )}
      {error && (
        <div role="alert" className="p-3 mb-5 bg-rose-950/40 border border-rose-800/60 rounded-xl text-rose-300 text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      <button
        type="button"
        onClick={handleGoogleLogin}
        disabled={isBusy}
        className="w-full flex items-center justify-center gap-2 bg-white hover:bg-slate-100 text-slate-900 font-semibold py-3 px-4 rounded-xl disabled:opacity-60 transition-colors cursor-pointer"
      >
        {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
        {isBusy ? 'Signing in…' : 'Continue with Google'}
      </button>
      <p className="text-[11px] leading-relaxed text-slate-500 mt-5 text-center">
        Hub-Mind is a private workspace. Use the Google account authorised for your workspace.
      </p>
    </section>
  </main>;
}
