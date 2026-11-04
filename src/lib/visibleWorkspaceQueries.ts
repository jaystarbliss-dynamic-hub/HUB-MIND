import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  query,
  where,
  type DocumentData,
  type Query,
  type QueryConstraint,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebaseConfig';

export interface WorkspaceQueryUser {
  id: string;
  role?: 'admin' | 'staff' | string;
}

export interface VisibleWorkspaceQueryOptions {
  includeAssignedTo?: boolean;
  maxPerQuery?: number;
  extraConstraints?: QueryConstraint[];
  filter?: (item: any) => boolean;
  sort?: (a: any, b: any) => number;
}

/**
 * Builds Firestore queries that strictly satisfy `firestore.rules` `visibleList()`
 * for non-admin workspace members while allowing full collection queries for admins.
 */
export function buildVisibleWorkspaceQueries(
  collectionName: string,
  user: WorkspaceQueryUser,
  options: VisibleWorkspaceQueryOptions = {}
): Query<DocumentData>[] {
  const colRef = collection(db, collectionName);
  const extra = options.extraConstraints || [];
  const limitConstraint = options.maxPerQuery ? [limit(options.maxPerQuery)] : [];

  if (user.role === 'admin') {
    return [query(colRef, ...extra, ...limitConstraint)];
  }

  const uid = user.id;
  if (!uid) return [];

  const includeAssignedTo = options.includeAssignedTo ?? collectionName === 'tasks';

  const slices: Query<DocumentData>[] = [
    query(colRef, where('ownerId', '==', uid), ...extra, ...limitConstraint),
    query(colRef, where('createdBy', '==', uid), ...extra, ...limitConstraint),
    query(colRef, where('visibility', '==', 'workspace'), ...extra, ...limitConstraint),
    query(colRef, where('sharedWith', 'array-contains', uid), ...extra, ...limitConstraint),
    query(colRef, where(`sharedWith.${uid}`, 'in', ['read', 'write', 'view', 'edit']), ...extra, ...limitConstraint),
    query(colRef, where(`permissions.${uid}`, 'in', ['read', 'write', 'view', 'edit']), ...extra, ...limitConstraint),
  ];

  if (includeAssignedTo) {
    slices.push(query(colRef, where('assignedTo', '==', uid), ...extra, ...limitConstraint));
  }

  return slices;
}

/**
 * Builds Firestore queries for owner-scoped collections (`recurringMeetingTemplates`, `recurringTaskTemplates`)
 * that strictly satisfy `allow list: if admin() || (member() && resource.data.ownerId == request.auth.uid)`.
 */
export function buildOwnerScopedQueries(
  collectionName: string,
  user: WorkspaceQueryUser,
  extraConstraints: QueryConstraint[] = []
): Query<DocumentData>[] {
  const colRef = collection(db, collectionName);
  if (user.role === 'admin') {
    return [query(colRef, ...extraConstraints)];
  }
  if (!user.id) return [];
  return [query(colRef, where('ownerId', '==', user.id), ...extraConstraints)];
}

/**
 * Subscribes to all rule-compliant visible slices of a workspace collection,
 * deduplicates documents by ID, applies optional client-side filters/sorting,
 * and invokes `onData` whenever any slice updates.
 */
export function subscribeVisibleWorkspaceCollection<T extends { id: string }>(
  collectionName: string,
  user: WorkspaceQueryUser,
  onData: (items: T[]) => void,
  onError?: (error: Error) => void,
  options: VisibleWorkspaceQueryOptions = {}
): Unsubscribe {
  const queries = buildVisibleWorkspaceQueries(collectionName, user, options);
  if (queries.length === 0) {
    onData([]);
    return () => {};
  }

  const sliceSnapshots = new Map<number, T[]>();
  let hasDeliveredInitial = false;

  const emitMerged = () => {
    const mergedMap = new Map<string, T>();
    sliceSnapshots.forEach(items => {
      items.forEach(item => {
        mergedMap.set(item.id, item);
      });
    });

    let list = Array.from(mergedMap.values());
    if (options.filter) {
      list = list.filter(options.filter);
    }
    if (options.sort) {
      list.sort(options.sort);
    }
    hasDeliveredInitial = true;
    onData(list);
  };

  const unsubs = queries.map((q, index) =>
    onSnapshot(
      q,
      snapshot => {
        const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as T));
        sliceSnapshots.set(index, docs);
        emitMerged();
      },
      err => {
        // Keep other slices active even if one slice encounters a transient or index issue
        console.warn(`[HubMind] Visible slice ${index} warning on ${collectionName}:`, err?.message || err);
        if (!sliceSnapshots.has(index)) {
          sliceSnapshots.set(index, []);
        }
        if (!hasDeliveredInitial && sliceSnapshots.size === queries.length) {
          emitMerged();
        }
        onError?.(err as Error);
      }
    )
  );

  return () => {
    unsubs.forEach(unsub => {
      try {
        unsub();
      } catch {}
    });
  };
}

/**
 * Fetches and deduplicates all rule-compliant visible documents from a workspace collection.
 */
export async function getVisibleWorkspaceDocs<T extends { id: string }>(
  collectionName: string,
  user: WorkspaceQueryUser,
  options: VisibleWorkspaceQueryOptions = {}
): Promise<T[]> {
  const queries = buildVisibleWorkspaceQueries(collectionName, user, options);
  if (queries.length === 0) return [];

  const mergedMap = new Map<string, T>();
  await Promise.all(
    queries.map(async q => {
      try {
        const snap = await getDocs(q);
        snap.docs.forEach(d => {
          mergedMap.set(d.id, { id: d.id, ...d.data() } as T);
        });
      } catch (err: any) {
        console.warn(`[HubMind] getVisibleWorkspaceDocs slice warning on ${collectionName}:`, err?.message || err);
      }
    })
  );

  let list = Array.from(mergedMap.values());
  if (options.filter) {
    list = list.filter(options.filter);
  }
  if (options.sort) {
    list.sort(options.sort);
  }
  return list;
}

/**
 * Subscribes to an owner-scoped collection (`recurringMeetingTemplates` or `recurringTaskTemplates`)
 * in compliance with Firestore security rules.
 */
export function subscribeOwnerScopedCollection<T extends { id: string }>(
  collectionName: string,
  user: WorkspaceQueryUser,
  onData: (items: T[]) => void,
  onError?: (error: Error) => void,
  extraConstraints: QueryConstraint[] = []
): Unsubscribe {
  const queries = buildOwnerScopedQueries(collectionName, user, extraConstraints);
  if (queries.length === 0) {
    onData([]);
    return () => {};
  }

  const unsubs = queries.map(q =>
    onSnapshot(
      q,
      snapshot => {
        const items = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as T));
        onData(items);
      },
      err => {
        console.warn(`[HubMind] Owner-scoped subscription warning on ${collectionName}:`, err?.message || err);
        onError?.(err as Error);
      }
    )
  );

  return () => {
    unsubs.forEach(unsub => {
      try {
        unsub();
      } catch {}
    });
  };
}
