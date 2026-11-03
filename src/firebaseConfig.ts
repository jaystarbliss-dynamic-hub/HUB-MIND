import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
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
export const CANONICAL_FIREBASE_WEB_APP_ID = '1:691762959980:web:0979e7745677270cc92a49';
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
  if (isBrowser) {
    const missing = ['apiKey', 'projectId', 'appId', 'messagingSenderId']
      .filter((key) => !String(firebaseConfig[key as keyof typeof firebaseConfig] || '').trim());
    if (missing.length) throw new Error(`Hub-Mind Firebase runtime configuration is missing: ${missing.join(', ')}.`);
    if (firebaseConfig.projectId !== CANONICAL_FIREBASE_PROJECT_ID) {
      throw new Error(`Unexpected Firebase project '${firebaseConfig.projectId}'. Expected '${CANONICAL_FIREBASE_PROJECT_ID}'.`);
    }
    if (firebaseConfig.appId !== CANONICAL_FIREBASE_WEB_APP_ID) {
      throw new Error('Hub-Mind Web Firebase app ID does not match the registered Web app.');
    }
    if (firebaseConfig.messagingSenderId !== '691762959980') {
      throw new Error('Hub-Mind Firebase messaging sender ID does not match the canonical project.');
    }
    if (firebaseConfig.firestoreDatabaseId !== CANONICAL_FIRESTORE_DATABASE_ID) {
      throw new Error('Hub-Mind Web app must use the canonical named Firestore database.');
    }
    if (/^(dev|test)-api-key$|^YOUR_/i.test(firebaseConfig.apiKey)) {
      throw new Error('Hub-Mind Firebase API key is missing or a placeholder. Check Netlify environment variables.');
    }
  }
  FIRESTORE_DATABASE_ID = firebaseConfig.firestoreDatabaseId || CANONICAL_FIRESTORE_DATABASE_ID;
  FIREBASE_PROJECT_ID = firebaseConfig.projectId || CANONICAL_FIREBASE_PROJECT_ID;
  GOOGLE_CLIENT_ID = runtimeConfig.googleClientId || runtimeConfig.firebaseGoogleClientId || '';
  FIREBASE_GOOGLE_CLIENT_ID = runtimeConfig.firebaseGoogleClientId || runtimeConfig.googleClientId || CANONICAL_FIREBASE_GOOGLE_CLIENT_ID;

  const existingApp = getApps().find((candidate) => candidate.name === '[DEFAULT]');
  if (existingApp) {
    if (isBrowser && (
      existingApp.options.projectId !== firebaseConfig.projectId ||
      existingApp.options.appId !== firebaseConfig.appId
    )) {
      throw new Error('An existing Firebase app is initialized with a different Hub-Mind project/app. Refusing to reuse it.');
    }
    app = existingApp;
  } else {
    app = initializeApp(firebaseConfig);
  }

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
      throw new Error(
        `Unable to initialize Hub-Mind Firestore database '${FIRESTORE_DATABASE_ID}': ${error instanceof Error ? error.message : String(error)}`
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
    console.error('[HubMind] Unable to load Firebase runtime configuration:', err);
    throw new Error('Hub-Mind could not load production Firebase configuration from /api/config. Check the Netlify function and Firebase environment variables.');
  }

  throw new Error('Hub-Mind /api/config returned an invalid or incomplete Firebase configuration. Refusing to initialize a placeholder project.');
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
