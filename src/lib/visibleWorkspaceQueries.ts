import {
  collection,
  onSnapshot,
  query,
  where,
  QueryDocumentSnapshot,
  DocumentData,
} from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { User } from '../types';

type ResourceUser = Pick<User, 'id' | 'role'>;

/**
 * Firestore rules are not post-query filters. A broad collection query followed
 * by client-side filtering is denied when any returned document is private.
 * Build one server-constrained query per visibility path, then merge snapshots.
 */
export function subscribeToVisibleWorkspaceRecords<T>(
  collectionName: string,
  currentUser: ResourceUser,
  callback: (records: T[]) => void,
  sortField: string,
  sortDirection: 'asc' | 'desc' = 'desc',
  onError?: (error: Error) => void,
  includeAssignedTo = false,
): () => void {
  const recordsRef = collection(db, collectionName);
  const isAdmin = currentUser.role?.toLowerCase() === 'admin';

  const queries = isAdmin
    ? [query(recordsRef)]
    : [
        query(recordsRef, where('ownerId', '==', currentUser.id)),
        query(recordsRef, where('createdBy', '==', currentUser.id)),
        query(recordsRef, where('visibility', '==', 'workspace')),
        query(recordsRef, where('visibility', '==', 'shared'), where('sharedWith', 'array-contains', currentUser.id)),
        query(recordsRef, where('visibility', '==', 'shared'), where(`sharedWith.${currentUser.id}`, 'in', ['read', 'write'])),
        query(recordsRef, where('visibility', '==', 'shared'), where(`permissions.${currentUser.id}`, 'in', ['read', 'write'])),
        ...(includeAssignedTo ? [query(recordsRef, where('assignedTo', '==', currentUser.id))] : []),
      ];

  const snapshots = new Map<number, QueryDocumentSnapshot<DocumentData>[]>();
  const emit = () => {
    const unique = new Map<string, T>();
    snapshots.forEach((docs) => {
      docs.forEach((snapshot) => {
        unique.set(snapshot.id, { id: snapshot.id, ...snapshot.data() } as T);
      });
    });

    const records = Array.from(unique.values());
    records.sort((a: any, b: any) => {
      const left = a?.[sortField];
      const right = b?.[sortField];
      const leftTime = left ? new Date(left).getTime() : 0;
      const rightTime = right ? new Date(right).getTime() : 0;
      return sortDirection === 'asc' ? leftTime - rightTime : rightTime - leftTime;
    });
    callback(records);
  };

  const unsubs = queries.map((resourceQuery, index) =>
    onSnapshot(resourceQuery, (snapshot) => {
      snapshots.set(index, snapshot.docs);
      emit();
    }, (error) => {
      console.warn(`[${collectionName}] Visible-record query ${index} failed:`, error);
      onError?.(error);
    })
  );

  return () => unsubs.forEach((unsubscribe) => unsubscribe());
}
