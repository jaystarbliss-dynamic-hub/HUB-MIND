import { addDoc, collection, doc, getDoc, getDocs, query, runTransaction, where } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { Invitation } from '../types';
import { isValidUsername, normalizeUsername } from './hubMindArchitecture';

const INVITE_DAYS = 7;

export async function createInvitation(input: { username: string; displayName: string; email: string; phone?: string; invitedBy: string }) {
  const username = normalizeUsername(input.username);
  if (!isValidUsername(username)) throw new Error('Username must be 3–30 characters using lowercase letters, numbers, or underscores.');
  const existing = await getDocs(query(collection(db, 'users'), where('username', '==', username)));
  if (!existing.empty) throw new Error('That username is already in use.');
  const pending = await getDocs(query(collection(db, 'invitations'), where('username', '==', username), where('status', '==', 'invited')));
  if (!pending.empty) throw new Error('An active invitation already exists for that username.');
  const now = new Date(); const expires = new Date(now.getTime() + INVITE_DAYS * 86400000);
  const ref = await addDoc(collection(db, 'invitations'), { username, displayName: input.displayName.trim(), email: input.email.trim().toLowerCase(), phone: input.phone?.trim() || undefined, role: 'staff', status: 'invited', invitedBy: input.invitedBy, createdAt: now.toISOString(), expiresAt: expires.toISOString() });
  return { id: ref.id, expiresAt: expires.toISOString(), link: `${window.location.origin}/login?invite=${ref.id}` };
}

export async function getInvitation(id: string) {
  const snap = await getDoc(doc(db, 'invitations', id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as Invitation;
}

export function validateInvitationAcceptance(invitation: Invitation, uid: string, email: string, now = Date.now()) {
  const normalizedEmail = email.trim().toLowerCase();
  const invitedEmail = String(invitation.email || '').trim().toLowerCase();
  if (invitation.status === 'accepted') {
    if (Boolean(invitation.acceptedUid) && invitation.acceptedUid === uid && invitedEmail === normalizedEmail) {
      return;
    }
    throw new Error('This invitation is no longer active.');
  }
  if (invitation.status !== 'invited') throw new Error('This invitation is no longer active.');
  if (new Date(invitation.expiresAt).getTime() <= now) throw new Error('This invitation has expired.');
  if (invitedEmail !== normalizedEmail) throw new Error('Please sign in with the Google account that was invited.');
}

export async function acceptInvitation(invitationId: string, uid: string, email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const ref = doc(db, 'invitations', invitationId);
  const acceptedAt = new Date().toISOString();
  return runTransaction(db, async transaction => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) throw new Error('Invitation not found.');
    const invitation = { id: snap.id, ...snap.data() } as Invitation;
    validateInvitationAcceptance(invitation, uid, normalizedEmail);
    if (invitation.status !== 'accepted') {
      transaction.update(ref, { status: 'accepted', acceptedAt, acceptedUid: uid });
    }
    return invitation;
  });
}

export async function findInvitationIdForUser(uid: string, authEmail?: string | null): Promise<string | null> {
  const now = Date.now();
  const candidates: Invitation[] = [];

  try {
    const claimedSnap = await getDocs(query(collection(db, 'invitations'), where('acceptedUid', '==', uid)));
    claimedSnap.docs.forEach(d => candidates.push({ id: d.id, ...(d.data() as any) } as Invitation));
  } catch {}

  const rawEmail = String(authEmail || '').trim();
  const emailCandidates = Array.from(new Set([rawEmail, rawEmail.toLowerCase()].filter(Boolean)));
  for (const candidateEmail of emailCandidates) {
    try {
      const emailSnap = await getDocs(query(collection(db, 'invitations'), where('email', '==', candidateEmail)));
      emailSnap.docs.forEach(d => {
        if (!candidates.some(existing => existing.id === d.id)) {
          candidates.push({ id: d.id, ...(d.data() as any) } as Invitation);
        }
      });
    } catch {}
  }

  const activeInvited = candidates
    .filter(inv => inv.status === 'invited' && (!inv.expiresAt || new Date(inv.expiresAt).getTime() > now))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  if (activeInvited[0]) return activeInvited[0].id;

  const recoverableAccepted = candidates
    .filter(inv => inv.status === 'accepted' && inv.acceptedUid === uid)
    .sort((a, b) => String(b.acceptedAt || b.createdAt || '').localeCompare(String(a.acceptedAt || a.createdAt || '')));
  if (recoverableAccepted[0]) return recoverableAccepted[0].id;

  return null;
}
