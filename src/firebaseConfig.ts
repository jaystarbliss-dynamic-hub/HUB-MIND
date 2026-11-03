import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import {
  initializeAuth, getAuth, browserLocalPersistence, browserSessionPersistence,
  indexedDBLocalPersistence, browserPopupRedirectResolver, Auth
} from 'firebase/auth';
import {
  initializeFirestore, getFirestore, persistentLocalCache,
  persistentMultipleTabManager, Firestore
} from 'firebase/firestore';

export type RuntimeConfig = {
  firebase: {
    apiKey: string;
    projectId: string;
    appId: string;
    authDomain: string;
    storageBucket: string;
    messagingSenderId: string;
    firestoreDatabaseId?: string;
  };
  googleClientId?: string;
  firebaseGoogleClientId?: string;
};

const isBrowser = typeof window !== 'undefined';

export const CANONICAL_FIRESTORE_DATABASE_ID = 'ai-studio-hubmind-4cac2024-c6eb-4208-80cf-928714dfd430';
export const CANONICAL_FIREBASE_PROJECT_ID = 'gen-lang-client-0197530608';
export const CANONICAL_FIREBASE_GOOGLE_CLIENT_ID = '691762959980-2jsohrd8s1elb4f84t3592vl728nhek7.apps.googleusercontent.com';

export let FIRESTORE_DATABASE_ID = CANONICAL_FIRESTORE_DATABASE_ID;
export let FIREBASE_PROJECT_ID = CANONICAL_FIREBASE_PROJECT_ID;
export let GOOGLE_CLIENT_ID = '';
export let FIREBASE_GOOGLE_CLIENT_ID = CANONICAL_FIREBASE_GOOGLE_CLIENT_ID;

export let app: FirebaseApp;
export let auth: Auth;
export let db: Firestore;

const createFirebaseInstances = (runtimeConfig: RuntimeConfig) => {
  if (app) return;

  const firebaseConfig = runtimeConfig.firebase;
  FIRESTORE_DATABASE_ID = firebaseConfig.firestoreDatabaseId || CANONICAL_FIRESTORE_DATABASE_ID;
  FIREBASE_PROJECT_ID = firebaseConfig.projectId || CANONICAL_FIREBASE_PROJECT_ID;
  GOOGLE_CLIENT_ID = runtimeConfig.googleClientId || runtimeConfig.firebaseGoogleClientId || '';
  FIREBASE_GOOGLE_CLIENT_ID = runtimeConfig.firebaseGoogleClientId || runtimeConfig.googleClientId || CANONICAL_FIREBASE_GOOGLE_CLIENT_ID;

  app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

  try {
    auth = initializeAuth(app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch {
    auth = getAuth(app);
  }

  try {
    db = initializeFirestore(
      app,
      { experimentalAutoDetectLongPolling: true, localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) },
      FIRESTORE_DATABASE_ID === '(default)' ? undefined : FIRESTORE_DATABASE_ID
    );
  } catch {
    try {
      db = FIRESTORE_DATABASE_ID === '(default)'
        ? getFirestore(app)
        : getFirestore(app, FIRESTORE_DATABASE_ID);
    } catch {
      db = initializeFirestore(
        app, {}, FIRESTORE_DATABASE_ID === '(default)' ? undefined : FIRESTORE_DATABASE_ID
      );
    }
  }
};

export async function initializeFirebaseConfig(config?: RuntimeConfig) {
  if (app) return;

  if (config) {
    createFirebaseInstances(config);
    return;
  }

  if (!isBrowser) {
    createFirebaseInstances({
      firebase: {
        apiKey: 'test-api-key',
        projectId: 'test-project',
        appId: 'test-app-id',
        authDomain: 'test-project.firebaseapp.com',
        storageBucket: 'test-project.firebasestorage.app',
        messagingSenderId: 'test-sender-id',
        firestoreDatabaseId: '(default)',
      },
      googleClientId: '',
    });
    return;
  }

  try {
    const response = await fetch('/api/config', {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });

    if (response.ok) {
      const data = await response.json() as RuntimeConfig;
      if (data?.firebase?.projectId && data?.firebase?.apiKey) {
        createFirebaseInstances(data);
        return;
      }
    }
  } catch (err) {
    console.warn('[HubMind] /api/config fetch warning, using client runtime defaults:', err);
  }

  // Graceful fallback if /api/config is unreachable
  createFirebaseInstances({
    firebase: {
      apiKey: 'test-api-key',
      projectId: 'test-project',
      appId: 'test-app-id',
      messagingSenderId: 'test-sender-id',
      authDomain: 'test-project.firebaseapp.com',
      storageBucket: 'test-project.firebasestorage.app',
      firestoreDatabaseId: '(default)',
    },
    googleClientId: '',
  });
}

// Node-based tests need Firebase bindings immediately; browser startup is
// explicitly bootstrapped by src/main.tsx after /api/config is fetched.
if (!isBrowser) {
  createFirebaseInstances({
    firebase: {
      apiKey: 'test-api-key',
      projectId: 'test-project',
      appId: 'test-app-id',
      authDomain: 'test-project.firebaseapp.com',
      storageBucket: 'test-project.firebasestorage.app',
      messagingSenderId: 'test-sender-id',
      firestoreDatabaseId: '(default)',
    },
    googleClientId: '',
  });
}
