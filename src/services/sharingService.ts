import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore';
import { db, auth } from '../firebaseConfig';
import {
  ResourceShare,
  ResourceType,
  SharePermission,
  User,
} from '../types';
export type { ResourceType, SharePermission };
import { getUserByUsername, getUserProfile, getAllUsers } from './userService';

export function getCollectionName(resourceType: ResourceType | string): string {
  switch (resourceType) {
    case 'document':
      return 'documents';
    case 'task':
      return 'tasks';
    case 'meeting':
      return 'meetings';
    case 'project':
      return 'projects';
    case 'client':
      return 'clients';
    case 'followup':
      return 'followUps';
    default:
      return 'documents';
  }
}

export function getResourceActionUrl(resourceType: ResourceType | string, resourceId: string): string {
  if (!resourceId) return '/workspace/inbox';
  switch (resourceType) {
    case 'document':
      return `/workspace/documents/${resourceId}`;
    case 'task':
      return `/workspace/tasks/${resourceId}`;
    case 'project':
      return `/workspace/projects/${resourceId}`;
    case 'client':
      return `/workspace/clients/${resourceId}`;
    case 'meeting':
      return `/workspace/meetings/${resourceId}`;
    case 'followup':
      return `/workspace/follow-ups`;
    default:
      return `/workspace/documents/${resourceId}`;
  }
}

export function formatResourceTypeLabel(resourceType: ResourceType | string): string {
  switch (resourceType) {
    case 'document':
      return 'Document';
    case 'task':
      return 'Task';
    case 'project':
      return 'Project';
    case 'client':
      return 'Client';
    case 'meeting':
      return 'Meeting';
    case 'followup':
      return 'Follow-Up';
    default:
      return 'Resource';
  }
}

export async function findRecipientUser(identifier: string): Promise<User | null> {
  const raw = (identifier || '').trim();
  if (!raw) return null;
  const clean = raw.replace(/^@+/, '');

  // 1. By username
  try {
    const byUsername = await getUserByUsername(clean);
    if (byUsername) return byUsername;
  } catch {}

  // 2. By email
  if (raw.includes('@')) {
    try {
      const qEmail = query(collection(db, 'users'), where('email', '==', raw.toLowerCase()));
      const snapEmail = await getDocs(qEmail);
      if (!snapEmail.empty) {
        return { id: snapEmail.docs[0].id, ...snapEmail.docs[0].data() } as User;
      }
    } catch {}
  }

  // 3. By UID
  try {
    const byId = await getUserProfile(raw);
    if (byId) return byId;
  } catch {}

  // 4. Directory scan
  try {
    const all = await getAllUsers();
    const match = all.find(
      u =>
        (u.username && u.username.toLowerCase() === clean.toLowerCase()) ||
        (u.email && u.email.toLowerCase() === raw.toLowerCase()) ||
        (u.displayName && u.displayName.toLowerCase() === raw.toLowerCase()) ||
        (u.name && u.name.toLowerCase() === raw.toLowerCase())
    );
    if (match) return match;
  } catch {}

  return null;
}

export async function shareResourceWithUser(params: {
  resourceType: ResourceType;
  resourceId: string;
  resourceTitle?: string;
  ownerId: string;
  ownerName?: string;
  recipientUsernameOrId: string;
  permission: SharePermission;
  message?: string;
}): Promise<ResourceShare> {
  const recipient = await findRecipientUser(params.recipientUsernameOrId);

  if (!recipient) {
    throw new Error(`User "${params.recipientUsernameOrId}" not found in workspace directory.`);
  }

  const effectiveOwnerId = auth.currentUser?.uid || params.ownerId;
  if (recipient.id === effectiveOwnerId) {
    throw new Error('Cannot share resource with yourself.');
  }

  const normalizedPerm: SharePermission =
    String(params.permission).toLowerCase() === 'write' || String(params.permission).toLowerCase() === 'edit'
      ? 'write'
      : 'read';

  const shareId = `share_${params.resourceType}_${params.resourceId}_${recipient.id}`;
  const now = new Date().toISOString();
  const senderName = params.ownerName || 'Workspace Colleague';
  const recipientHandle =
    recipient.username ||
    (recipient.email ? recipient.email.split('@')[0] : recipient.displayName || recipient.name || 'colleague');
  const recipientDisplayName =
    recipient.displayName || recipient.name || `@${recipientHandle}`;
  const titleText = params.resourceTitle || 'Untitled Resource';
  const actionUrl = getResourceActionUrl(params.resourceType, params.resourceId);

  const share: ResourceShare & { ownerName?: string; actionUrl?: string } = {
    id: shareId,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    resourceTitle: titleText,
    ownerId: effectiveOwnerId,
    ownerName: senderName,
    recipientUserId: recipient.id,
    recipientUsername: recipientHandle,
    permission: normalizedPerm,
    status: 'active',
    actionUrl,
    createdAt: now,
    updatedAt: now,
  };

  await setDoc(doc(db, 'shares', shareId), share);

  // Update target resource's sharedWith array and permissions map for fast querying & security rules
  const collName = getCollectionName(params.resourceType);
  const resourceRef = doc(db, collName, params.resourceId);
  try {
    const snap = await getDoc(resourceRef);

    if (snap.exists()) {
      const data = snap.data();
      const existingSharedWithList: string[] = Array.isArray(data.sharedWith)
        ? [...data.sharedWith]
        : data.sharedWith && typeof data.sharedWith === 'object'
          ? Object.keys(data.sharedWith)
          : [];

      const existingPermissionsMap: Record<string, SharePermission> = {
        ...(data.sharedWith && typeof data.sharedWith === 'object' && !Array.isArray(data.sharedWith)
          ? data.sharedWith
          : {}),
        ...(data.permissions && typeof data.permissions === 'object' ? data.permissions : {}),
      };

      if (!existingSharedWithList.includes(recipient.id)) {
        existingSharedWithList.push(recipient.id);
      }
      existingPermissionsMap[recipient.id] = normalizedPerm;

      await updateDoc(resourceRef, {
        sharedWith: existingSharedWithList,
        permissions: existingPermissionsMap,
        visibility: 'shared',
        updatedAt: now,
      });
    }
  } catch (e) {
    console.warn('Resource permissions update note:', e);
  }

  // Deliver to recipient's Inbox (/messages) AND Notifications (/notifications)
  const permLabel = normalizedPerm === 'write' ? 'Can Edit' : 'Read Only';
  const typeLabel = formatResourceTypeLabel(params.resourceType);
  const subjectText = `Shared ${typeLabel}: ${titleText} (${permLabel})`;
  const bodyLines = [
    `${senderName} shared the ${params.resourceType} "${titleText}" with you.`,
    `Access level: ${permLabel}${normalizedPerm === 'write' ? ' — you have full edit access.' : ' — view access.'}`,
  ];
  if (params.message?.trim()) {
    bodyLines.push('', `Note from ${senderName}:`, params.message.trim());
  }
  const messageText = bodyLines.join('\n').slice(0, 12000);

  let createdMessageId: string | undefined;
  try {
    const msgRef = await addDoc(collection(db, 'messages'), {
      senderId: effectiveOwnerId,
      recipientId: recipient.id,
      senderName,
      recipientName: recipientDisplayName,
      subject: subjectText.slice(0, 180),
      text: messageText,
      type: 'resource_share',
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      resourceTitle: titleText,
      permission: normalizedPerm,
      actionUrl,
      shareId,
      createdAt: now,
      updatedAt: now,
      read: false,
    });
    createdMessageId = msgRef.id;
  } catch (e) {
    console.warn('Share inbox message delivery note:', e);
  }

  try {
    const notifSummary = `${senderName} shared ${params.resourceType} "${titleText}" with you (${permLabel}).`;
    const notifDoc: Record<string, any> = {
      userId: recipient.id,
      createdBy: effectiveOwnerId,
      senderId: effectiveOwnerId,
      senderName,
      type: 'resource_shared',
      title: `Shared ${typeLabel}: ${titleText}`,
      body: notifSummary,
      message: notifSummary,
      read: false,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      resourceTitle: titleText,
      permission: normalizedPerm,
      actionUrl,
      shareId,
      createdAt: now,
    };
    if (createdMessageId) {
      notifDoc.messageId = createdMessageId;
    }
    await addDoc(collection(db, 'notifications'), notifDoc);
  } catch (e) {
    console.warn('Share notification delivery note:', e);
  }

  return share;
}

export async function updateResourceSharePermission(
  shareId: string,
  permission: SharePermission
): Promise<void> {
  const shareRef = doc(db, 'shares', shareId);
  const snap = await getDoc(shareRef);
  if (!snap.exists()) return;

  const share = snap.data() as ResourceShare;
  const now = new Date().toISOString();
  const normalizedPerm: SharePermission =
    String(permission).toLowerCase() === 'write' || String(permission).toLowerCase() === 'edit'
      ? 'write'
      : 'read';

  await updateDoc(shareRef, {
    permission: normalizedPerm,
    status: 'active',
    updatedAt: now,
  });

  const collName = getCollectionName(share.resourceType);
  const resourceRef = doc(db, collName, share.resourceId);
  try {
    const resSnap = await getDoc(resourceRef);
    if (resSnap.exists()) {
      const data = resSnap.data();
      const currentSharedWith: string[] = Array.isArray(data.sharedWith)
        ? [...data.sharedWith]
        : [];
      if (!currentSharedWith.includes(share.recipientUserId)) {
        currentSharedWith.push(share.recipientUserId);
      }
      const currentPermissions = {
        ...(data.permissions || {}),
        [share.recipientUserId]: normalizedPerm,
      };
      await updateDoc(resourceRef, {
        sharedWith: currentSharedWith,
        permissions: currentPermissions,
        visibility: 'shared',
        updatedAt: now,
      });
    }
  } catch (e) {
    console.warn('Resource share permission update note:', e);
  }
}

export async function sendDirectInformation(params: {
  senderId: string;
  senderName: string;
  recipientId: string;
  recipientName?: string;
  type: 'document' | 'task' | 'project' | 'note' | 'briefing';
  title: string;
  content?: string;
  resourceId?: string;
  permission?: SharePermission;
}): Promise<void> {
  const now = new Date().toISOString();
  const effectiveSenderId = auth.currentUser?.uid || params.senderId;

  // If linking to a registered workspace resource, shareResourceWithUser handles
  // permissions, /shares, /messages (Inbox), and /notifications together.
  if (params.resourceId && params.type !== 'note' && params.type !== 'briefing') {
    await shareResourceWithUser({
      resourceType: params.type as ResourceType,
      resourceId: params.resourceId,
      resourceTitle: params.title,
      ownerId: effectiveSenderId,
      ownerName: params.senderName,
      recipientUsernameOrId: params.recipientId,
      permission: params.permission || 'write',
      message: params.content,
    });
  } else {
    // Direct Note or Briefing: deliver to recipient's Inbox (/messages) AND Notifications (/notifications)
    let createdMessageId: string | undefined;
    try {
      const msgRef = await addDoc(collection(db, 'messages'), {
        senderId: effectiveSenderId,
        recipientId: params.recipientId,
        senderName: params.senderName,
        recipientName: params.recipientName || 'Colleague',
        subject: params.title || 'Workspace Note',
        text: (params.content || params.title || '').slice(0, 12000),
        type: `shared_${params.type}`,
        createdAt: now,
        updatedAt: now,
        read: false,
      });
      createdMessageId = msgRef.id;
    } catch (e) {
      console.warn('Direct note inbox message delivery note:', e);
    }

    try {
      const summary = `${params.senderName} sent you a ${params.type}: "${params.title}"${
        params.content ? ` — ${params.content.slice(0, 120)}` : ''
      }`;
      const notifDoc: Record<string, any> = {
        userId: params.recipientId,
        createdBy: effectiveSenderId,
        senderId: effectiveSenderId,
        senderName: params.senderName,
        type: `shared_${params.type}`,
        title: `${params.senderName}: ${params.title}`,
        body: summary,
        message: summary,
        read: false,
        content: params.content || '',
        createdAt: now,
      };
      if (createdMessageId) {
        notifDoc.messageId = createdMessageId;
      }
      await addDoc(collection(db, 'notifications'), notifDoc);
    } catch (e) {
      console.warn('Direct note notification delivery note:', e);
    }
  }

  // Deliver activity log
  try {
    await addDoc(collection(db, 'activityLogs'), {
      userId: effectiveSenderId,
      userDisplayName: params.senderName,
      action: `shared ${params.type} "${params.title}" with`,
      details: params.recipientName || 'colleague',
      entityType: params.type,
      entityId: params.resourceId || '',
      createdAt: now,
    });
  } catch {}
}

export async function revokeResourceShare(shareId: string): Promise<void> {
  const shareRef = doc(db, 'shares', shareId);
  const snap = await getDoc(shareRef);
  if (!snap.exists()) return;

  const share = snap.data() as ResourceShare;
  await updateDoc(shareRef, { status: 'revoked', updatedAt: new Date().toISOString() });

  // Update parent resource permissions
  const collName = getCollectionName(share.resourceType);
  const resourceRef = doc(db, collName, share.resourceId);
  try {
    const resSnap = await getDoc(resourceRef);

    if (resSnap.exists()) {
      const data = resSnap.data();
      const currentSharedWith: string[] = Array.isArray(data.sharedWith)
        ? data.sharedWith.filter((uid: string) => uid !== share.recipientUserId)
        : [];
      const currentPermissions = { ...(data.permissions || {}) };
      delete currentPermissions[share.recipientUserId];

      await updateDoc(resourceRef, {
        sharedWith: currentSharedWith,
        permissions: currentPermissions,
        visibility:
          currentSharedWith.length === 0 && data.visibility === 'shared'
            ? 'private'
            : data.visibility,
        updatedAt: new Date().toISOString(),
      });
    }
  } catch (e) {
    console.warn('Resource share revoke note:', e);
  }
}

export function subscribeToResourceShares(
  resourceId: string,
  ownerId: string,
  callback: (shares: ResourceShare[]) => void
): () => void {
  if (!resourceId || !ownerId) {
    callback([]);
    return () => {};
  }
  const q = query(
    collection(db, 'shares'),
    where('resourceId', '==', resourceId),
    where('ownerId', '==', ownerId),
    where('status', '==', 'active')
  );
  return onSnapshot(
    q,
    snap => {
      callback(snap.docs.map(d => ({ id: d.id, ...d.data() } as ResourceShare)));
    },
    err => {
      console.warn('Shares subscription warning:', err);
    }
  );
}

export function subscribeToSharesForUser(
  userId: string,
  callback: (shares: ResourceShare[]) => void
): () => void {
  if (!userId) {
    callback([]);
    return () => {};
  }
  const q = query(
    collection(db, 'shares'),
    where('recipientUserId', '==', userId),
    where('status', '==', 'active')
  );
  return onSnapshot(
    q,
    snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as ResourceShare));
      items.sort((a, b) =>
        String(b.updatedAt || b.createdAt || '').localeCompare(
          String(a.updatedAt || a.createdAt || '')
        )
      );
      callback(items);
    },
    err => {
      console.warn('User shares subscription warning:', err);
    }
  );
}

export function subscribeToUserResourceShare(
  resourceType: ResourceType,
  resourceId: string,
  userId: string,
  callback: (share: ResourceShare | null) => void
): () => void {
  if (!resourceType || !resourceId || !userId) {
    callback(null);
    return () => {};
  }
  const shareId = `share_${resourceType}_${resourceId}_${userId}`;
  return onSnapshot(
    doc(db, 'shares', shareId),
    snap => {
      if (!snap.exists()) {
        callback(null);
        return;
      }
      const data = snap.data() as ResourceShare;
      if (data.status !== 'active') {
        callback(null);
        return;
      }
      callback({ id: snap.id, ...data });
    },
    err => {
      console.warn('Single resource share subscription note:', err);
    }
  );
}
