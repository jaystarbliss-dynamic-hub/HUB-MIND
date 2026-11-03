const CANONICAL_PROJECT_ID = 'gen-lang-client-0197530608';
const CANONICAL_PROJECT_NUMBER = '691762959980';
const CANONICAL_WEB_APP_ID = '1:691762959980:web:0979e7745677270cc92a49';
const CANONICAL_DATABASE_ID = 'ai-studio-hubmind-4cac2024-c6eb-4208-80cf-928714dfd430';
const CANONICAL_FIREBASE_GOOGLE_CLIENT_ID = '691762959980-2jsohrd8s1elb4f84t3592vl728nhek7.apps.googleusercontent.com';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  },
});

export function resolveFirebaseGoogleClientId(env = process.env) {
  const candidates = [
    env.FIREBASE_GOOGLE_CLIENT_ID,
    env.VITE_GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_ID,
  ].map(v => String(v || '').trim()).filter(Boolean);

  const matchingCanonicalProject = candidates.find(id => id.startsWith(`${CANONICAL_PROJECT_NUMBER}-`));
  return matchingCanonicalProject || CANONICAL_FIREBASE_GOOGLE_CLIENT_ID;
}

export default async function handler(req) {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || CANONICAL_PROJECT_ID;
  const apiKey = process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY || '';
  const appId = process.env.FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID || CANONICAL_WEB_APP_ID;
  const messagingSenderId = process.env.FIREBASE_MESSAGING_SENDER_ID || process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || CANONICAL_PROJECT_NUMBER;
  const authDomain = process.env.FIREBASE_AUTH_DOMAIN || process.env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`;
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`;
  const firestoreDatabaseId = process.env.FIRESTORE_DATABASE_ID || process.env.VITE_FIRESTORE_DATABASE_ID || CANONICAL_DATABASE_ID;

  // Separate Firebase Google Sign-In Web OAuth client ID (must belong to project 691762959980)
  // from server/workspace Google Drive & Calendar OAuth client ID.
  const firebaseGoogleClientId = resolveFirebaseGoogleClientId(process.env);
  const googleClientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || firebaseGoogleClientId;

  const missing = [];
  if (!apiKey || /^(dev|test)-api-key$|^YOUR_/i.test(apiKey)) missing.push('FIREBASE_WEB_API_KEY');
  if (projectId !== CANONICAL_PROJECT_ID) missing.push('FIREBASE_PROJECT_ID');
  if (appId !== CANONICAL_WEB_APP_ID) missing.push('FIREBASE_APP_ID');
  if (messagingSenderId !== CANONICAL_PROJECT_NUMBER) missing.push('FIREBASE_MESSAGING_SENDER_ID');
  if (firestoreDatabaseId !== CANONICAL_DATABASE_ID) missing.push('FIRESTORE_DATABASE_ID');
  if (missing.length) {
    return json({ error: `Hub-Mind Firebase runtime configuration is invalid: ${missing.join(', ')}.` }, 503);
  }

  // These values are Firebase/Google browser configuration, not authorization
  // credentials. They are fetched at runtime so their values are never embedded
  // in the static build artifacts scanned by Netlify.
  return json({
    firebase: {
      apiKey,
      projectId,
      appId,
      messagingSenderId,
      authDomain,
      storageBucket,
      firestoreDatabaseId,
    },
    googleClientId,
    firebaseGoogleClientId,
  });
}

export const config = { path: '/api/config' };
