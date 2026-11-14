import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, onIdTokenChanged, GoogleAuthProvider, signInWithCredential, User as FirebaseUser, signOut } from 'firebase/auth';
import { doc, getDoc, getDocs, collection, limit, query, onSnapshot, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { User } from '../types';
import { acceptInvitation, findInvitationIdForUser } from './invitations';
import { isAdminEmail, extractHandleFromEmail, generateAvailableUsername } from '../services/userService';
import { handleFirestoreError, OperationType } from './firestoreErrorHandler';
import { getLocalDeviceId } from '../services/crossDeviceService';

interface AuthContextType {
  user: FirebaseUser | null;
  profile: User | null;
  loading: boolean;
  authorizationError: string | null;
  updatePreferredName: (preferredName: string) => Promise<void>;
  updateProfileData: (data: Partial<User>) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  authorizationError: null,
  updatePreferredName: async () => {},
  updateProfileData: async () => {},
  logout: async () => {},
});

const PENDING_INVITE_STORAGE_KEY = 'hubmind_pending_invite';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // The Android shell hands the same Google identity to the embedded Web
  // workspace once. The bridge only returns a token on the trusted Hub-Mind
  // origin and clears it immediately after consumption.
  useEffect(() => {
    const bridge = (window as any).HubMindAndroid;
    if (typeof bridge?.consumeGoogleIdToken !== 'function') return;

    let googleIdToken = '';
    try {
      googleIdToken = String(bridge.consumeGoogleIdToken() || '').trim();
    } catch (error) {
      console.warn('[Hub-Mind Android] Native sign-in handoff was unavailable:', error);
    }
    if (!googleIdToken) return;

    void signInWithCredential(auth, GoogleAuthProvider.credential(googleIdToken))
      .then(() => {
        // A protected route may have redirected to /login before Firebase
        // finished restoring this one-time native session.
        if (window.location.pathname === '/login') {
          window.location.replace('/workspace');
        }
      })
      .catch((error) => {
        console.error('[Hub-Mind Android] Workspace sign-in handoff failed:', error);
      });
  }, []);

  // Keep the Electron background command receiver aligned with Firebase auth.
  // The ID token is held in memory and refreshed automatically by Firebase.
  useEffect(() => {
    let disposed = false;
    const unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
      const bridge = (window as any).hubMindDesktop;
      if (!firebaseUser) {
        try { await bridge?.clearDeviceSession?.(); } catch {}
        return;
      }
      if (!bridge?.setDeviceSession) return;
      try {
        const idToken = await firebaseUser.getIdToken();
        if (disposed || auth.currentUser?.uid !== firebaseUser.uid) return;
        await bridge.setDeviceSession(firebaseUser.uid, idToken, getLocalDeviceId());
      } catch (error) {
        console.warn('[Hub-Mind desktop] Could not update the background device session:', error);
      }
    });
    return () => {
      disposed = true;
      unsubscribe();
      try { void (window as any).hubMindDesktop?.clearDeviceSession?.(); } catch {}
    };
  }, []);

  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authorizationError, setAuthorizationError] = useState<string | null>(null);

  useEffect(() => {
    let stopProfile: (() => void) | null = null;
    let disposed = false;

    const attachProfileListener = (profileRef: ReturnType<typeof doc>, firebaseUser: FirebaseUser) => {
      stopProfile?.();
      stopProfile = onSnapshot(profileRef, (snap) => {
        if (disposed) return;
        if (!snap.exists()) {
          setProfile(null);
          setAuthorizationError('Your Hub-Mind profile was removed. Please contact an administrator if you believe this is a mistake.');
          setLoading(false);
          void signOut(auth).catch(() => {});
          return;
        }
        const data = snap.data();
        if (data.status === 'inactive' || data.status === 'suspended') {
          setProfile(null);
          setAuthorizationError('Your Hub-Mind account is currently inactive. Please contact an administrator.');
          setLoading(false);
          return;
        }
        setProfile({
          ...data,
          id: firebaseUser.uid,
          email: firebaseUser.email || data.email,
          photoUrl: firebaseUser.photoURL || data.photoUrl,
        } as User);
      }, (err) => {
        console.warn('[AuthProvider] onSnapshot profile error:', err);
      });
    };

    const stopAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      stopProfile?.();
      stopProfile = null;
      if (disposed) return;
      setUser(firebaseUser);
      setProfile(null);
      setAuthorizationError(null);

      if (!firebaseUser) {
        setLoading(false);
        return;
      }

      setLoading(true);
      const profileRef = doc(db, 'users', firebaseUser.uid);

      let existingSnap;
      try {
        existingSnap = await getDoc(profileRef);
      } catch (err: any) {
        console.error('[AuthProvider] Error fetching user profile doc:', err);
        if (!disposed) {
          setAuthorizationError(
            err?.code === 'permission-denied'
              ? 'Unable to verify your Hub-Mind account permissions. Please sign out and sign in again.'
              : 'Could not reach Hub-Mind to load your profile. Check your connection and try again.'
          );
          setLoading(false);
        }
        return;
      }

      if (disposed) return;

      if (existingSnap && existingSnap.exists()) {
        const data = existingSnap.data();
        if (data.status === 'inactive' || data.status === 'suspended') {
          setAuthorizationError('Your Hub-Mind account is currently inactive. Please contact an administrator.');
          setLoading(false);
          return;
        }
        if (data.status && data.status !== 'active') {
          setAuthorizationError('Your Hub-Mind account is awaiting activation. Please contact an administrator.');
          setLoading(false);
          return;
        }

        const activeProfile: User = {
          ...data,
          status: data.status || 'active',
          id: firebaseUser.uid,
          email: firebaseUser.email || data.email,
          photoUrl: firebaseUser.photoURL || data.photoUrl,
        } as User;

        setProfile(activeProfile);
        setLoading(false);
        attachProfileListener(profileRef, firebaseUser);
        return;
      }

      // Only the configured administrator identity may bootstrap an admin profile.
      // A blank users collection is not proof of authorization; every other account
      // must present a valid, email-matched invitation.
      const userEmail = (firebaseUser.email || '').trim().toLowerCase();
      const isAdminByEmail = isAdminEmail(userEmail);

      if (isAdminByEmail) {
        try {
          const now = new Date().toISOString();
          const handle = extractHandleFromEmail(userEmail, firebaseUser.displayName || undefined);
          const username = await generateAvailableUsername(handle, firebaseUser.uid);

          const newAdminProfile: User = {
            id: firebaseUser.uid,
            username,
            name: firebaseUser.displayName || 'Administrator',
            displayName: firebaseUser.displayName || 'Administrator',
            email: userEmail,
            role: 'admin',
            status: 'active',
            photoUrl: firebaseUser.photoURL || undefined,
            createdAt: now,
            approvedAt: now,
            defaultVisibility: 'workspace',
          };

          await setDoc(profileRef, newAdminProfile);
          if (disposed) return;
          setProfile(newAdminProfile);
          setLoading(false);
          attachProfileListener(profileRef, firebaseUser);
          return;
        } catch (err: any) {
          console.error('[AuthProvider] Failed to auto-bootstrap admin profile:', err);
          if (!disposed) {
            setAuthorizationError(`Failed to initialize admin profile: ${err?.message || 'Database permission error'}`);
            setLoading(false);
          }
          return;
        }
      }

      let inviteId = new URLSearchParams(window.location.search).get('invite');
      if (!inviteId && typeof window !== 'undefined') {
        try {
          inviteId = window.sessionStorage.getItem(PENDING_INVITE_STORAGE_KEY);
        } catch {}
      }
      if (!inviteId) {
        inviteId = await findInvitationIdForUser(firebaseUser.uid, firebaseUser.email);
      }

      // Check for invitation link
      if (!inviteId) {
        await signOut(auth).catch(() => {});
        if (!disposed) {
          setUser(null);
          setAuthorizationError('This account has not been authorized for Hub-Mind yet. Ask an administrator for an invitation or sign in with your invited email.');
          setLoading(false);
        }
        return;
      }

      try {
        const invitation = await acceptInvitation(inviteId, firebaseUser.uid, userEmail);
        const now = new Date().toISOString();
        const newStaffProfile: User = {
          id: firebaseUser.uid,
          username: invitation.username,
          name: invitation.displayName,
          displayName: invitation.displayName,
          email: userEmail || invitation.email,
          role: 'staff',
          status: 'active',
          phone: invitation.phone || '',
          photoUrl: firebaseUser.photoURL || undefined,
          createdAt: now,
          approvedAt: now,
          approvedBy: invitation.invitedBy,
          invitationId: inviteId,
        };
        if (!newStaffProfile.phone) delete newStaffProfile.phone;
        if (!newStaffProfile.photoUrl) delete newStaffProfile.photoUrl;

        await setDoc(profileRef, newStaffProfile);
        if (typeof window !== 'undefined') {
          try { window.sessionStorage.removeItem(PENDING_INVITE_STORAGE_KEY); } catch {}
          if (window.location.search.includes('invite=')) {
            window.history.replaceState({}, '', window.location.pathname);
          }
        }
        if (disposed) return;
        setProfile(newStaffProfile);
        setLoading(false);
        attachProfileListener(profileRef, firebaseUser);
      } catch (error: any) {
        console.error('[AuthProvider] Staff invitation acceptance error:', error);
        await signOut(auth).catch(() => {});
        if (!disposed) {
          setUser(null);
          setAuthorizationError(error?.message || 'Unable to validate your Hub-Mind invitation.');
          setLoading(false);
        }
      }

    });

    return () => {
      disposed = true;
      stopProfile?.();
      stopAuth();
    };
  }, []);

  const updatePreferredName = async (preferredName: string) => {
    const clean = preferredName.trim();
    if (!profile || !clean) return;
    try {
      await setDoc(doc(db, 'users', profile.id), { preferredName: clean }, { merge: true });
      setProfile((p) => (p ? { ...p, preferredName: clean } : null));
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${profile.id}`);
    }
  };

  const updateProfileData = async (data: Partial<User>) => {
    if (!profile) return;
    try {
      await setDoc(doc(db, 'users', profile.id), data, { merge: true });
      setProfile((p) => (p ? ({ ...p, ...data } as User) : null));
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${profile.id}`);
    }
  };

  const logout = async () => {
    await signOut(auth);
    setUser(null);
    setProfile(null);
    setAuthorizationError(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        authorizationError,
        updatePreferredName,
        updateProfileData,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
