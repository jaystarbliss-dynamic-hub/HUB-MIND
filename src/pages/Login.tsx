import React, { useEffect, useState } from 'react';
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { auth } from '../firebaseConfig';
import { useNavigate, useLocation } from 'react-router-dom';
import { Loader2, LogIn, AlertCircle, ArrowLeft, Mail, Lock } from 'lucide-react';
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
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'Email or password did not match. If your account uses Google Sign-In, click "Continue with Google" above.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Sign in with your password or click "Continue with Google".';
    case 'auth/weak-password':
      return 'Choose a stronger password with at least 6 characters.';
    case 'auth/account-exists-with-different-credential':
      return 'This email is already registered with Google Sign-In. Click "Continue with Google" above.';
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
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteMode, setInviteMode] = useState<'signin' | 'create'>('signin');
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
    if (!authLoading && (!user || !profile)) {
      setLoading(false);
    }
  }, [authLoading, user, profile]);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError('');
    setNotice('');
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

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      if (invite && inviteMode === 'create') {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (err: any) {
      setError(formatAuthError(err, 'Failed to sign in with email and password.'));
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setError('Enter your email address above first so we know where to send the reset link.');
      return;
    }
    setError('');
    setNotice('');
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      setNotice('If an email/password account exists for ' + cleanEmail + ', a password reset link has been sent.');
    } catch (err: any) {
      setError(formatAuthError(err, 'Could not send password reset email.'));
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
      <div className="flex flex-col items-center mb-6"><img src="/hub-mind%20logo.png" alt="Hub-Mind" className="w-20 h-20 object-contain mb-4" width={80} height={80} /><h1 className="text-2xl font-bold text-slate-100">Welcome back</h1><p className="text-sm text-slate-400 mt-2 text-center">Sign in to open your Hub-Mind workspace.</p></div>
      {invite && <div className="mb-5 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20"><p className="text-sm text-emerald-300 font-medium">Invitation detected</p><p className="text-xs text-slate-400 mt-1">Sign in with the email address that received the invitation. Your invitation will be verified before access is granted.</p></div>}
      {notice && <div role="status" className="p-3 mb-5 bg-teal-950/40 border border-teal-800/60 rounded-xl text-teal-200 text-xs">{notice}</div>}
      {error && <div role="alert" className="p-3 mb-5 bg-rose-950/40 border border-rose-800/60 rounded-xl text-rose-300 text-sm flex items-start gap-2"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span></div>}
      <button type="button" onClick={handleGoogleLogin} disabled={isBusy} className="w-full flex items-center justify-center gap-2 bg-white hover:bg-slate-100 text-slate-900 font-semibold py-3 px-4 rounded-xl disabled:opacity-60 transition-colors cursor-pointer">{isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}{isBusy ? 'Signing in…' : 'Continue with Google'}</button>

      {invite && (
        <div className="grid grid-cols-2 gap-1.5 mb-3 rounded-xl bg-slate-950 p-1 border border-slate-800">
          <button
            type="button"
            onClick={() => { setInviteMode('signin'); setError(''); }}
            className={`py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${inviteMode === 'signin' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'}`}
          >
            Existing password
          </button>
          <button
            type="button"
            onClick={() => { setInviteMode('create'); setError(''); }}
            className={`py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${inviteMode === 'create' ? 'bg-teal-500/20 text-teal-300' : 'text-slate-400 hover:text-slate-200'}`}
          >
            Set new password
          </button>
        </div>
      )}

      <form onSubmit={handleEmailLogin} className="space-y-3">
        <div className="relative">
          <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Studio email"
            autoComplete="email"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-teal-500"
          />
        </div>
        <div className="relative">
          <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder={invite && inviteMode === 'create' ? 'Create a password (min 6 chars)' : 'Password'}
            autoComplete={invite && inviteMode === 'create' ? 'new-password' : 'current-password'}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-teal-500"
          />
        </div>
        <button
          type="submit"
          disabled={isBusy || !email.trim() || !password}
          className="w-full flex items-center justify-center gap-2 bg-teal-500 hover:bg-teal-400 text-slate-950 font-semibold py-2.5 px-4 rounded-xl disabled:opacity-50 transition-colors text-sm cursor-pointer"
        >
          {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {invite && inviteMode === 'create' ? 'Accept Invite & Create Account' : 'Sign In with Email'}
        </button>
      </form>

      <div className="mt-3 flex justify-end">
        <button type="button" onClick={handleForgotPassword} className="text-[11px] text-slate-400 hover:text-teal-300 cursor-pointer">
          Forgot password?
        </button>
      </div>

      <p className="text-[11px] leading-relaxed text-slate-500 mt-4 text-center">Hub-Mind is a private workspace. New members need a valid invitation.</p>
    </section>
  </main>;
}
