import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  Bell,
  ExternalLink,
  FileText,
  Inbox,
  Loader2,
  Mail,
  MessageSquare,
  Plus,
  Send,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import { db } from '../firebaseConfig';
import { useAuth } from '../lib/auth';
import {
  subscribeToSharesForUser,
  getResourceActionUrl,
  formatResourceTypeLabel,
} from '../services/sharingService';
import { ResourceShare } from '../types';
import './inbox-communication.css';

type InboxTab = 'received' | 'shared' | 'sent' | 'drafts' | 'notifications';
type WorkspaceUser = {
  id: string;
  name?: string;
  displayName?: string;
  username?: string;
  email?: string;
  status?: string;
  role?: string;
};
type WorkspaceMessage = {
  id: string;
  senderId: string;
  recipientId: string;
  senderName?: string;
  recipientName?: string;
  subject?: string;
  text: string;
  type?: string;
  resourceType?: string;
  resourceId?: string;
  resourceTitle?: string;
  permission?: 'read' | 'write' | string;
  actionUrl?: string;
  createdAt: string;
  updatedAt?: string;
  read?: boolean;
  readAt?: string;
};
type MessageDraft = {
  id: string;
  userId: string;
  recipientId?: string;
  recipientName?: string;
  subject?: string;
  text?: string;
  updatedAt?: string;
  createdAt?: string;
};
type InboxNotification = {
  id: string;
  userId: string;
  title?: string;
  body?: string;
  message?: string;
  type?: string;
  messageId?: string;
  resourceType?: string;
  resourceId?: string;
  resourceTitle?: string;
  permission?: 'read' | 'write' | string;
  actionUrl?: string;
  createdAt?: string;
  read?: boolean;
  readAt?: string;
};

const tabs: { id: InboxTab; label: string; icon: React.ElementType }[] = [
  { id: 'received', label: 'Received', icon: Inbox },
  { id: 'shared', label: 'Shared with me', icon: Share2 },
  { id: 'sent', label: 'Sent', icon: Send },
  { id: 'drafts', label: 'Drafts', icon: FileText },
  { id: 'notifications', label: 'Notifications', icon: Bell },
];

export function InboxCommunication() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<InboxTab>('received');
  const [users, setUsers] = useState<WorkspaceUser[]>([]);
  const [receivedMessages, setReceivedMessages] = useState<WorkspaceMessage[]>([]);
  const [sentMessages, setSentMessages] = useState<WorkspaceMessage[]>([]);
  const [sharesWithMe, setSharesWithMe] = useState<ResourceShare[]>([]);
  const [drafts, setDrafts] = useState<MessageDraft[]>([]);
  const [notifications, setNotifications] = useState<InboxNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [composeOpen, setComposeOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedMessage, setSelectedMessage] = useState<WorkspaceMessage | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [recipientId, setRecipientId] = useState('');
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');

  useEffect(() => {
    if (!profile?.id) return;
    return onSnapshot(
      collection(db, 'users'),
      snapshot => {
        setUsers(
          snapshot.docs
            .map(item => ({ id: item.id, ...(item.data() as any) } as WorkspaceUser))
            .filter(item => item.id !== profile.id && item.status === 'active')
        );
      },
      err => console.warn('[Inbox] Workspace contacts unavailable:', err?.message || err)
    );
  }, [profile?.id]);

  // Real-time subscription to notifications
  useEffect(() => {
    if (!profile?.id) return;
    return onSnapshot(
      query(collection(db, 'notifications'), where('userId', '==', profile.id)),
      snapshot => {
        const list = snapshot.docs.map(
          item => ({ id: item.id, ...(item.data() as any) } as InboxNotification)
        );
        list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        setNotifications(list);
      },
      err => console.warn('[Inbox] Notification badge could not update:', err?.message || err)
    );
  }, [profile?.id]);

  // Real-time subscription to active resource shares for this user
  useEffect(() => {
    if (!profile?.id) return;
    return subscribeToSharesForUser(profile.id, list => {
      setSharesWithMe(list);
    });
  }, [profile?.id]);

  // Real-time subscription to received messages (so Received and Shared With Me always stay live)
  useEffect(() => {
    if (!profile?.id) return;
    setLoading(true);
    const stopReceived = onSnapshot(
      query(collection(db, 'messages'), where('recipientId', '==', profile.id)),
      snapshot => {
        const list = snapshot.docs.map(
          item => ({ id: item.id, ...(item.data() as any) } as WorkspaceMessage)
        );
        list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        setReceivedMessages(list);
        setLoading(false);
      },
      err => {
        console.error('[Inbox] Received messages unavailable:', err);
        setLoading(false);
      }
    );
    return () => stopReceived();
  }, [profile?.id]);

  // Sent & Drafts subscriptions when their tabs are active
  useEffect(() => {
    if (!profile?.id) return;
    if (tab === 'sent') {
      setLoading(true);
      const stopSent = onSnapshot(
        query(collection(db, 'messages'), where('senderId', '==', profile.id)),
        snapshot => {
          const list = snapshot.docs.map(
            item => ({ id: item.id, ...(item.data() as any) } as WorkspaceMessage)
          );
          list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
          setSentMessages(list);
          setLoading(false);
        },
        err => {
          console.error('[Inbox] Sent messages unavailable:', err);
          setError('Could not load sent messages.');
          setLoading(false);
        }
      );
      return () => stopSent();
    }
    if (tab === 'drafts') {
      setLoading(true);
      const stopDrafts = onSnapshot(
        query(collection(db, 'messageDrafts'), where('userId', '==', profile.id)),
        snapshot => {
          const list = snapshot.docs.map(
            item => ({ id: item.id, ...(item.data() as any) } as MessageDraft)
          );
          list.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
          setDrafts(list);
          setLoading(false);
        },
        err => {
          console.error('[Inbox] Drafts unavailable:', err);
          setError('Could not load drafts.');
          setLoading(false);
        }
      );
      return () => stopDrafts();
    }
  }, [profile?.id, tab]);

  // Synthesize received items: include both received messages AND any active shares that didn't have a message yet
  const combinedReceivedItems = useMemo(() => {
    const existingShareKeys = new Set(
      receivedMessages
        .filter(m => m.resourceType && m.resourceId)
        .map(m => `${m.resourceType}:${m.resourceId}`)
    );

    const syntheticShareMessages: WorkspaceMessage[] = sharesWithMe
      .filter(s => !existingShareKeys.has(`${s.resourceType}:${s.resourceId}`))
      .map(s => {
        const ownerUser = users.find(u => u.id === s.ownerId);
        const senderName =
          (s as any).ownerName ||
          ownerUser?.displayName ||
          ownerUser?.name ||
          (ownerUser?.username ? `@${ownerUser.username}` : 'Workspace Colleague');
        const permLabel =
          s.permission === 'write' || (s.permission as string) === 'edit'
            ? 'Can Edit'
            : 'Read Only';
        const typeLabel = formatResourceTypeLabel(s.resourceType);
        return {
          id: `synthetic_${s.id}`,
          senderId: s.ownerId,
          recipientId: s.recipientUserId,
          senderName,
          recipientName: profile?.displayName || profile?.name || profile?.username || 'You',
          subject: `Shared ${typeLabel}: ${s.resourceTitle || 'Untitled'} (${permLabel})`,
          text: `${senderName} shared the ${s.resourceType} "${
            s.resourceTitle || 'Untitled'
          }" with you (${permLabel}).`,
          type: 'resource_share',
          resourceType: s.resourceType,
          resourceId: s.resourceId,
          resourceTitle: s.resourceTitle || 'Untitled',
          permission: s.permission,
          actionUrl: getResourceActionUrl(s.resourceType, s.resourceId),
          createdAt: s.updatedAt || s.createdAt,
          updatedAt: s.updatedAt || s.createdAt,
          read: true,
        };
      });

    const merged = [...receivedMessages, ...syntheticShareMessages];
    merged.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return merged;
  }, [receivedMessages, sharesWithMe, users, profile]);

  const unreadReceivedCount = useMemo(
    () => receivedMessages.filter(item => !item.read).length,
    [receivedMessages]
  );
  const unreadNotifCount = useMemo(
    () => notifications.filter(item => !item.read).length,
    [notifications]
  );

  const navigateToSharedResource = (
    resourceType?: string,
    resourceId?: string,
    actionUrl?: string
  ) => {
    const targetUrl =
      actionUrl || (resourceType && resourceId ? getResourceActionUrl(resourceType, resourceId) : '');
    if (!targetUrl) return;
    setSelectedMessage(null);
    navigate(targetUrl);
  };

  const resetComposer = () => {
    setDraftId(null);
    setRecipientId('');
    setSubject('');
    setText('');
    setError('');
  };

  const openCompose = (draft?: MessageDraft) => {
    setError('');
    setNotice('');
    if (draft) {
      setDraftId(draft.id);
      setRecipientId(draft.recipientId || '');
      setSubject(draft.subject || '');
      setText(draft.text || '');
    } else resetComposer();
    setComposeOpen(true);
  };

  const saveDraft = async () => {
    if (!profile?.id) return;
    setSaving(true);
    setError('');
    setNotice('');
    const recipient = users.find(item => item.id === recipientId);
    const now = new Date().toISOString();
    const payload = {
      userId: profile.id,
      recipientId: recipientId || '',
      recipientName:
        recipient?.name || recipient?.displayName || recipient?.username || '',
      subject: subject.trim(),
      text: text.slice(0, 12000),
      updatedAt: now,
    };
    try {
      if (draftId) await updateDoc(doc(db, 'messageDrafts', draftId), payload);
      else {
        const ref = await addDoc(collection(db, 'messageDrafts'), {
          ...payload,
          createdAt: now,
        });
        setDraftId(ref.id);
      }
      setNotice('Draft saved.');
    } catch (err: any) {
      setError(err?.message || 'Could not save this draft.');
    } finally {
      setSaving(false);
    }
  };

  const send = async () => {
    if (!profile?.id || !recipientId || !text.trim()) {
      setError('Choose a recipient and write a message before sending.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    const recipient = users.find(item => item.id === recipientId);
    const senderName =
      profile.preferredName ||
      profile.displayName ||
      profile.name ||
      profile.username ||
      profile.email;
    const recipientName =
      recipient?.name ||
      recipient?.displayName ||
      recipient?.username ||
      recipient?.email ||
      'Workspace member';
    const now = new Date().toISOString();
    try {
      const messageRef = await addDoc(collection(db, 'messages'), {
        senderId: profile.id,
        recipientId,
        senderName,
        recipientName,
        subject: subject.trim() || 'No subject',
        text: text.trim().slice(0, 12000),
        createdAt: now,
        updatedAt: now,
        read: false,
      });
      try {
        await addDoc(collection(db, 'notifications'), {
          userId: recipientId,
          createdBy: profile.id,
          senderId: profile.id,
          senderName,
          messageId: messageRef.id,
          type: 'message',
          title: 'New message from ' + senderName,
          body: (subject.trim() || text.trim()).slice(0, 180),
          message: (subject.trim() || text.trim()).slice(0, 180),
          createdAt: now,
          read: false,
        });
      } catch (notificationError) {
        console.warn(
          '[Inbox] Message sent but notification creation failed:',
          notificationError
        );
      }
      if (draftId) await deleteDoc(doc(db, 'messageDrafts', draftId)).catch(() => {});
      setComposeOpen(false);
      resetComposer();
      setTab('sent');
      setNotice('Message sent.');
    } catch (err: any) {
      setError(err?.message || 'Could not send this message.');
    } finally {
      setSaving(false);
    }
  };

  const openMessage = async (message: WorkspaceMessage) => {
    setSelectedMessage(message);
    if (
      tab === 'received' &&
      !message.read &&
      profile?.id &&
      !message.id.startsWith('synthetic_')
    ) {
      await updateDoc(doc(db, 'messages', message.id), {
        read: true,
        readAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).catch(err => console.warn('[Inbox] Read receipt failed:', err));
    }
  };

  const markNotificationRead = async (item: InboxNotification) => {
    if (!item.read) {
      await updateDoc(doc(db, 'notifications', item.id), {
        read: true,
        readAt: new Date().toISOString(),
      }).catch(err => console.warn('[Inbox] Could not mark notification read:', err));
    }
    if (item.resourceType && item.resourceId) {
      navigateToSharedResource(item.resourceType, item.resourceId, item.actionUrl);
      return;
    }
    if (item.actionUrl) {
      navigate(item.actionUrl);
      return;
    }
    if (item.messageId) {
      try {
        const snapshot = await getDoc(doc(db, 'messages', item.messageId));
        if (snapshot.exists()) {
          const message = {
            id: snapshot.id,
            ...(snapshot.data() as any),
          } as WorkspaceMessage;
          setSelectedMessage(message);
          if (!message.read) {
            await updateDoc(doc(db, 'messages', message.id), {
              read: true,
              readAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }).catch(() => {});
          }
        }
      } catch (err) {
        console.warn('[Inbox] Linked message could not be opened:', err);
      }
    }
  };

  const activeMessagesList = tab === 'received' ? combinedReceivedItems : sentMessages;

  return (
    <section className="hm-inbox-communications">
      <div className="hm-inbox-heading">
        <div>
          <p className="hm-inbox-eyebrow">YOUR COMMUNICATIONS</p>
          <h2>Messages, shared items & notifications</h2>
          <p>
            Open shared documents, tasks and projects directly from your inbox or send updates to colleagues.
          </p>
        </div>
        <button type="button" className="hm-inbox-compose" onClick={() => openCompose()}>
          <Plus size={16} /> Compose
        </button>
      </div>

      <nav className="hm-inbox-tabs" aria-label="Inbox folders">
        {tabs.map(item => {
          const Icon = item.icon;
          const badgeCount =
            item.id === 'received'
              ? unreadReceivedCount
              : item.id === 'shared'
                ? sharesWithMe.length
                : item.id === 'notifications'
                  ? unreadNotifCount
                  : 0;
          return (
            <button
              type="button"
              key={item.id}
              onClick={() => {
                setTab(item.id);
                setError('');
                setNotice('');
              }}
              className={tab === item.id ? 'is-active' : ''}
            >
              <Icon size={15} />
              <span>{item.label}</span>
              {badgeCount > 0 && <b>{badgeCount}</b>}
            </button>
          );
        })}
      </nav>

      {notice && (
        <div role="status" className="hm-inbox-notice">
          {notice}
        </div>
      )}
      {error && (
        <div role="alert" className="hm-inbox-error">
          {error}
        </div>
      )}

      <div className="hm-inbox-list">
        {loading ? (
          <div className="hm-inbox-empty">
            <Loader2 size={20} className="animate-spin" /> Loading your {tab}…
          </div>
        ) : tab === 'shared' ? (
          sharesWithMe.length > 0 ? (
            sharesWithMe.map(share => {
              const ownerUser = users.find(u => u.id === share.ownerId);
              const ownerDisplay =
                (share as any).ownerName ||
                ownerUser?.displayName ||
                ownerUser?.name ||
                (ownerUser?.username ? `@${ownerUser.username}` : 'Colleague');
              const isEditable =
                share.permission === 'write' || (share.permission as string) === 'edit';
              const typeLabel = formatResourceTypeLabel(share.resourceType);

              return (
                <div key={share.id} className="hm-inbox-row">
                  <span className="hm-inbox-row-icon">
                    <Share2 size={17} />
                  </span>
                  <button
                    type="button"
                    className="hm-inbox-row-main hm-inbox-row-open"
                    onClick={() =>
                      navigateToSharedResource(
                        share.resourceType,
                        share.resourceId,
                        (share as any).actionUrl
                      )
                    }
                  >
                    <strong>
                      {share.resourceTitle || `Untitled ${typeLabel}`}
                    </strong>
                    <span>
                      Shared by {ownerDisplay} · {typeLabel} ·{' '}
                      {isEditable ? 'Can Edit' : 'Read Only'}
                    </span>
                    <small>
                      {share.updatedAt || share.createdAt
                        ? new Date(share.updatedAt || share.createdAt).toLocaleString()
                        : ''}
                    </small>
                  </button>
                  <button
                    type="button"
                    className="hm-inbox-compose"
                    onClick={() =>
                      navigateToSharedResource(
                        share.resourceType,
                        share.resourceId,
                        (share as any).actionUrl
                      )
                    }
                  >
                    <ExternalLink size={13} />
                    <span>
                      {share.resourceType === 'document' && isEditable
                        ? 'Open & Edit'
                        : `Open ${typeLabel}`}
                    </span>
                  </button>
                </div>
              );
            })
          ) : (
            <div className="hm-inbox-empty">
              <Share2 size={22} />
              <strong>No items shared with you yet</strong>
              <span>
                When a colleague shares a document, task, or project with you, it will appear right here and in your Received inbox.
              </span>
            </div>
          )
        ) : tab === 'notifications' ? (
          notifications.length ? (
            notifications.map(item => {
              const hasResource = Boolean(
                (item.resourceType && item.resourceId) || item.actionUrl
              );
              const isEditable =
                item.permission === 'write' || item.permission === 'edit';
              const typeLabel = item.resourceType
                ? formatResourceTypeLabel(item.resourceType)
                : 'Item';
              return (
                <div
                  key={item.id}
                  className={'hm-inbox-row ' + (!item.read ? 'is-unread' : '')}
                >
                  <span className="hm-inbox-row-icon">
                    {item.resourceType ? <Share2 size={17} /> : <Bell size={17} />}
                  </span>
                  <button
                    type="button"
                    className="hm-inbox-row-main hm-inbox-row-open"
                    onClick={() => void markNotificationRead(item)}
                  >
                    <strong>{item.title || 'Workspace Notification'}</strong>
                    <span>
                      {item.body ||
                        item.message ||
                        'You have an update in Hub-Mind.'}
                    </span>
                    <small>
                      {item.createdAt
                        ? new Date(item.createdAt).toLocaleString()
                        : ''}
                    </small>
                  </button>
                  {hasResource && (
                    <button
                      type="button"
                      className="hm-inbox-compose"
                      onClick={() => void markNotificationRead(item)}
                    >
                      <ExternalLink size={13} />
                      <span>
                        {item.resourceType === 'document' && isEditable
                          ? 'Open & Edit'
                          : `Open ${typeLabel}`}
                      </span>
                    </button>
                  )}
                  {!item.read && <i className="hm-inbox-unread-dot" />}
                </div>
              );
            })
          ) : (
            <div className="hm-inbox-empty">
              <Bell size={22} />
              <strong>You’re all caught up</strong>
              <span>New messages and shared workspace updates will appear here.</span>
            </div>
          )
        ) : tab === 'drafts' ? (
          drafts.length ? (
            drafts.map(item => (
              <div key={item.id} className="hm-inbox-row">
                <button
                  type="button"
                  className="hm-inbox-row-main hm-inbox-row-open"
                  onClick={() => openCompose(item)}
                >
                  <strong>{item.subject || 'Untitled draft'}</strong>
                  <span>{item.text || 'No message content yet.'}</span>
                  <small>
                    Draft · Updated{' '}
                    {item.updatedAt
                      ? new Date(item.updatedAt).toLocaleString()
                      : 'recently'}
                  </small>
                </button>
                <button
                  type="button"
                  className="hm-inbox-icon-action is-danger"
                  onClick={() => void deleteDoc(doc(db, 'messageDrafts', item.id))}
                  aria-label="Delete draft"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))
          ) : (
            <div className="hm-inbox-empty">
              <FileText size={22} />
              <strong>No drafts yet</strong>
              <span>Start a message and save it to finish later.</span>
            </div>
          )
        ) : activeMessagesList.length ? (
          activeMessagesList.map(item => {
            const otherName =
              tab === 'received'
                ? item.senderName || item.senderId
                : item.recipientName || item.recipientId;
            const hasSharedResource = Boolean(item.resourceType && item.resourceId);
            const isEditable =
              item.permission === 'write' || item.permission === 'edit';
            const typeLabel = item.resourceType
              ? formatResourceTypeLabel(item.resourceType)
              : 'Resource';

            return (
              <div
                key={item.id}
                className={
                  'hm-inbox-row ' +
                  (tab === 'received' && !item.read ? 'is-unread' : '')
                }
              >
                <span className="hm-inbox-row-icon">
                  {hasSharedResource ? (
                    <Share2 size={17} />
                  ) : tab === 'received' ? (
                    <Mail size={17} />
                  ) : (
                    <Send size={17} />
                  )}
                </span>
                <button
                  type="button"
                  className="hm-inbox-row-main hm-inbox-row-open"
                  onClick={() => void openMessage(item)}
                >
                  <strong>{item.subject || 'No subject'}</strong>
                  <span>
                    {tab === 'received' ? 'From ' : 'To '}
                    {otherName} · {item.text}
                  </span>
                  <small>
                    {item.createdAt
                      ? new Date(item.createdAt).toLocaleString()
                      : ''}
                  </small>
                </button>
                {hasSharedResource && (
                  <button
                    type="button"
                    className="hm-inbox-compose"
                    onClick={e => {
                      e.stopPropagation();
                      if (
                        tab === 'received' &&
                        !item.read &&
                        !item.id.startsWith('synthetic_')
                      ) {
                        void updateDoc(doc(db, 'messages', item.id), {
                          read: true,
                          readAt: new Date().toISOString(),
                          updatedAt: new Date().toISOString(),
                        }).catch(() => {});
                      }
                      navigateToSharedResource(
                        item.resourceType,
                        item.resourceId,
                        item.actionUrl
                      );
                    }}
                  >
                    <ExternalLink size={13} />
                    <span>
                      {item.resourceType === 'document' && isEditable
                        ? 'Open & Edit'
                        : `Open ${typeLabel}`}
                    </span>
                  </button>
                )}
                {tab === 'received' && !item.read && (
                  <i className="hm-inbox-unread-dot" />
                )}
              </div>
            );
          })
        ) : (
          <div className="hm-inbox-empty">
            <MessageSquare size={22} />
            <strong>
              {tab === 'received' ? 'Your inbox is clear' : 'Nothing sent yet'}
            </strong>
            <span>
              {tab === 'received'
                ? 'Messages and shared documents/tasks sent to you will show up here.'
                : 'Messages and shared items you send will appear here.'}
            </span>
            <button type="button" onClick={() => openCompose()}>
              <Plus size={14} /> Compose a message
            </button>
          </div>
        )}
      </div>

      {composeOpen && (
        <div
          className="hm-inbox-modal-backdrop"
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget) {
              setComposeOpen(false);
            }
          }}
        >
          <section
            className="hm-inbox-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="hm-compose-title"
          >
            <header>
              <div>
                <span className="hm-inbox-modal-kicker">WORKSPACE MESSAGE</span>
                <h3 id="hm-compose-title">
                  {draftId ? 'Edit draft' : 'Compose a message'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setComposeOpen(false)}
                aria-label="Close composer"
              >
                <X size={18} />
              </button>
            </header>
            <label>
              To
              <select
                value={recipientId}
                onChange={event => setRecipientId(event.target.value)}
              >
                <option value="">Choose a workspace member…</option>
                {users.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name ||
                      item.displayName ||
                      item.username ||
                      item.email}{' '}
                    · {item.email}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Subject
              <input
                value={subject}
                onChange={event => setSubject(event.target.value)}
                maxLength={180}
                placeholder="What is this about?"
              />
            </label>
            <label>
              Message
              <textarea
                value={text}
                onChange={event => setText(event.target.value)}
                maxLength={12000}
                rows={7}
                placeholder="Write your message…"
              />
            </label>
            {error && (
              <div role="alert" className="hm-inbox-error">
                {error}
              </div>
            )}
            <footer>
              <span>{text.length}/12000</span>
              <div>
                <button
                  type="button"
                  className="hm-inbox-secondary"
                  onClick={() => void saveDraft()}
                  disabled={saving}
                >
                  {saving ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <FileText size={14} />
                  )}{' '}
                  Save draft
                </button>
                <button
                  type="button"
                  className="hm-inbox-compose"
                  onClick={() => void send()}
                  disabled={saving}
                >
                  {saving ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Send size={14} />
                  )}{' '}
                  Send message
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}

      {selectedMessage && (
        <div
          className="hm-inbox-modal-backdrop"
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setSelectedMessage(null);
          }}
        >
          <section
            className="hm-inbox-modal hm-inbox-message-detail"
            role="dialog"
            aria-modal="true"
            aria-labelledby="hm-message-title"
          >
            <header>
              <div>
                <span className="hm-inbox-modal-kicker">
                  {selectedMessage.resourceType
                    ? `SHARED ${formatResourceTypeLabel(
                        selectedMessage.resourceType
                      ).toUpperCase()}`
                    : tab === 'received' || tab === 'notifications'
                      ? 'RECEIVED MESSAGE'
                      : 'SENT MESSAGE'}
                </span>
                <h3 id="hm-message-title">
                  {selectedMessage.subject || 'No subject'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMessage(null)}
                aria-label="Close message"
              >
                <X size={18} />
              </button>
            </header>
            <div className="hm-inbox-message-meta">
              <span>
                {tab === 'sent' ? 'To' : 'From'}{' '}
                <strong>
                  {tab === 'sent'
                    ? selectedMessage.recipientName ||
                      selectedMessage.recipientId
                    : selectedMessage.senderName || selectedMessage.senderId}
                </strong>
              </span>
              <time>
                {selectedMessage.createdAt
                  ? new Date(selectedMessage.createdAt).toLocaleString()
                  : ''}
              </time>
            </div>
            <p className="hm-inbox-message-body">{selectedMessage.text}</p>

            {selectedMessage.resourceType && selectedMessage.resourceId && (
              <div className="rounded-xl border border-teal-500/30 bg-teal-950/25 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-teal-400">
                    Shared {formatResourceTypeLabel(selectedMessage.resourceType)} •{' '}
                    {selectedMessage.permission === 'write' ||
                    selectedMessage.permission === 'edit'
                      ? 'Can Edit'
                      : 'Read Only'}
                  </div>
                  <div className="text-sm font-bold text-white">
                    {selectedMessage.resourceTitle || selectedMessage.subject}
                  </div>
                </div>
                <button
                  type="button"
                  className="hm-inbox-compose"
                  onClick={() =>
                    navigateToSharedResource(
                      selectedMessage.resourceType,
                      selectedMessage.resourceId,
                      selectedMessage.actionUrl
                    )
                  }
                >
                  <ExternalLink size={14} />
                  <span>
                    {selectedMessage.resourceType === 'document' &&
                    (selectedMessage.permission === 'write' ||
                      selectedMessage.permission === 'edit')
                      ? 'Open & Edit Document'
                      : `Open ${formatResourceTypeLabel(
                          selectedMessage.resourceType
                        )}`}
                  </span>
                </button>
              </div>
            )}

            <footer>
              <button
                type="button"
                className="hm-inbox-secondary"
                onClick={() => setSelectedMessage(null)}
              >
                Close
              </button>
              <div>
                {selectedMessage.resourceType && selectedMessage.resourceId && (
                  <button
                    type="button"
                    className="hm-inbox-compose"
                    onClick={() =>
                      navigateToSharedResource(
                        selectedMessage.resourceType,
                        selectedMessage.resourceId,
                        selectedMessage.actionUrl
                      )
                    }
                  >
                    <ExternalLink size={14} />
                    <span>
                      {selectedMessage.resourceType === 'document' &&
                      (selectedMessage.permission === 'write' ||
                        selectedMessage.permission === 'edit')
                        ? 'Open & Edit Document'
                        : `Open ${formatResourceTypeLabel(
                            selectedMessage.resourceType
                          )}`}
                    </span>
                  </button>
                )}
                {tab !== 'sent' && (
                  <button
                    type="button"
                    className="hm-inbox-secondary"
                    onClick={() => {
                      setSubject('Re: ' + (selectedMessage.subject || ''));
                      setRecipientId(selectedMessage.senderId);
                      setText('');
                      setSelectedMessage(null);
                      setDraftId(null);
                      setComposeOpen(true);
                    }}
                  >
                    <MessageSquare size={14} /> Reply
                  </button>
                )}
              </div>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
