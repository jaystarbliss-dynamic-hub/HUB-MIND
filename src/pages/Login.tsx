import React, { useEffect, useState } from 'react';
import {
  signInWithPopup,
  GoogleAuthProvider,
  getAdditionalUserInfo,
  signOut,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { auth } from '../firebaseConfig';
import { useNavigate, useLocation } from 'react-router-dom';
import { Loader2, LogIn, AlertCircle, ArrowLeft, Mail, Lock } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { isJessInstalledApp } from '../services/jessWakeListener';

export function Login() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile, authorizationError } = useAuth();
  const invite = new URLSearchParams(location.search).get('invite');

  useEffect(() => {
    if (user && profile?.status === 'active') navigate('/workspace', { replace: true });
  }, [user, profile, navigate]);

  useEffect(() => {
    if (authorizationError) setError(authorizationError);
  }, [authorizationError]);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError('');
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await signInWithPopup(auth, provider);
      const isNewFirebaseUser = getAdditionalUserInfo(result)?.isNewUser === true;

      if (isNewFirebaseUser && !invite) {
        await signOut(auth);
        setError('This Google account is not registered for Hub-Mind yet. Ask an administrator for an invitation before signing in.');
        setLoading(false);
        return;
      }

      if (result.user) {
        navigate(invite ? '/login?invite=' + encodeURIComponent(invite) : '/workspace', { replace: true });
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to sign in with Google.');
      setLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    setError('');
    try {
      const result = await signInWithEmailAndPassword(auth, email.trim(), password);
      if (result.user) {
        navigate(invite ? '/login?invite=' + encodeURIComponent(invite) : '/workspace', { replace: true });
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to sign in with email and password.');
      setLoading(false);
    }
  };

  return <main className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
    <section className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
      {!isJessInstalledApp() && (
        <button onClick={() => navigate('/')} className="text-xs text-slate-400 hover:text-teal-300 inline-flex items-center gap-2 mb-7">
          <ArrowLeft size={14}/> Back to Hub-Mind
        </button>
      )}
      <div className="flex flex-col items-center mb-6"><img src="/hub-mind%20logo.png" alt="Hub-Mind" className="w-20 h-20 object-contain mb-4" width={80} height={80} /><h1 className="text-2xl font-bold text-slate-100">Welcome back</h1><p className="text-sm text-slate-400 mt-2 text-center">Sign in to open your Hub-Mind workspace.</p></div>
      {invite && <div className="mb-5 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20"><p className="text-sm text-emerald-300 font-medium">Invitation detected</p><p className="text-xs text-slate-400 mt-1">Sign in with the account that received the invitation. Your invitation will be verified before access is granted.</p></div>}
      {error && <div role="alert" className="p-3 mb-5 bg-rose-950/40 border border-rose-800/60 rounded-xl text-rose-300 text-sm flex items-start gap-2"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span></div>}
      <button type="button" onClick={handleGoogleLogin} disabled={loading} className="w-full flex items-center justify-center gap-2 bg-white hover:bg-slate-100 text-slate-900 font-semibold py-3 px-4 rounded-xl disabled:opacity-60 transition-colors">{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}{loading ? 'Signing in…' : 'Continue with Google'}</button>

      <div className="relative my-5 flex items-center justify-center">
        <div className="border-t border-slate-800 w-full" />
        <span className="bg-slate-900 px-3 text-[11px] uppercase tracking-wider text-slate-500">or email</span>
        <div className="border-t border-slate-800 w-full" />
      </div>

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
            placeholder="Password"
            autoComplete="current-password"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-teal-500"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !email.trim() || !password}
          className="w-full flex items-center justify-center gap-2 bg-teal-500 hover:bg-teal-400 text-slate-950 font-semibold py-2.5 px-4 rounded-xl disabled:opacity-50 transition-colors text-sm"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Sign In with Email
        </button>
      </form>

      <p className="text-[11px] leading-relaxed text-slate-500 mt-5 text-center">Hub-Mind is a private workspace. New members need a valid invitation.</p>
    </section>
  </main>;
}
