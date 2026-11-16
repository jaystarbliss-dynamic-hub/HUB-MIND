import { collection, doc, getDoc, getDocs, query, runTransaction, where } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { Invitation } from '../types';
import { isValidUsername, normalizeUsername } from './hubMindArchitecture';

const INVITE_DAYS = 7;

const INVITATION_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateInvitationCode(): string {
  const random = new Uint8Array(12);
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('Secure invitation-code generation is unavailable in this browser.');
  }
  crypto.getRandomValues(random);
  // The alphabet has exactly 32 symbols, so masking avoids modulo bias.
  const raw = Array.from(random, byte => INVITATION_CODE_ALPHABET[byte & 31]).join('');
  return `HM-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

export async function createInvitation(input: { username: string; displayName: string; email: string; phone?: string; invitedBy: string }) {
  const username = normalizeUsername(input.username);
  if (!isValidUsername(username)) throw new Error('Username must be 3–30 characters using lowercase letters, numbers, or underscores.');
  const normalizedEmail = input.email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes('@')) throw new Error('A valid Google account email is required.');
  const existing = await getDocs(query(collection(db, 'users'), where('username', '==', username)));
  if (!existing.empty) throw new Error('That username is already in use.');
  const pending = await getDocs(query(collection(db, 'invitations'), where('username', '==', username), where('status', '==', 'invited')));
  if (!pending.empty) throw new Error('An active invitation already exists for that username.');

  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + INVITE_DAYS * 86400000).toISOString();
  const invitation = {
    username,
    displayName: input.displayName.trim(),
    email: normalizedEmail,
    ...(input.phone?.trim() ? { phone: input.phone.trim() } : {}),
    role: 'staff' as const,
    status: 'invited' as const,
    invitedBy: input.invitedBy,
    createdAt,
    expiresAt,
  };

  // The readable code is also the Firestore document ID. Existing email-bound
  // acceptance logic therefore validates the invited Google account as before.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateInvitationCode();
    const ref = doc(db, 'invitations', code);
    try {
      await runTransaction(db, async transaction => {
        const existingCode = await transaction.get(ref);
        if (existingCode.exists()) throw new Error('INVITATION_CODE_COLLISION');
        transaction.set(ref, invitation);
      });
      return {
        id: code,
        code,
        expiresAt,
        link: `${window.location.origin}/login?invite=${encodeURIComponent(code)}`,
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'INVITATION_CODE_COLLISION') continue;
      throw error;
    }
  }
  throw new Error('Could not generate a unique invitation code. Please try again.');
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
