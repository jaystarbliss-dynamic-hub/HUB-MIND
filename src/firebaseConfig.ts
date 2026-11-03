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
};

const isBrowser = typeof window !== 'undefined';

export let FIRESTORE_DATABASE_ID = '(default)';
export let FIREBASE_PROJECT_ID = '';
export let GOOGLE_CLIENT_ID = '';

export let app: FirebaseApp;
export let auth: Auth;
export let db: Firestore;

const createFirebaseInstances = (runtimeConfig: RuntimeConfig) => {
  if (app) return;

  const firebaseConfig = runtimeConfig.firebase;
  if (isBrowser) {
    const required = ['apiKey', 'projectId', 'appId', 'messagingSenderId'] as const;
    const missing = required.filter((key) => !String(firebaseConfig[key] || '').trim());
    if (missing.length || /^(dev|test)-api-key$|^YOUR_/i.test(firebaseConfig.apiKey || '')) {
      throw new Error(`Production Firebase configuration is incomplete or contains placeholders (${missing.join(', ') || 'invalid API key'}). Check Netlify environment variables.`);
    }
  }
  FIRESTORE_DATABASE_ID = firebaseConfig.firestoreDatabaseId || '(default)';
  FIREBASE_PROJECT_ID = firebaseConfig.projectId;
  GOOGLE_CLIENT_ID = runtimeConfig.googleClientId || '';

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
    } catch (error) {
      // Never silently fall back to (default): Hub-Mind data is in a named DB.
      throw new Error(`Unable to initialize Firestore database '${FIRESTORE_DATABASE_ID}': ${error instanceof Error ? error.message : String(error)}`);
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

  throw new Error('Hub-Mind could not load production Firebase configuration from /api/config. Check the Netlify function and Firebase environment variables.');
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
