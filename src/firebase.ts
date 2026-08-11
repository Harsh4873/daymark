import { getApps, initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getAuth,
  setPersistence,
} from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

// Daymark shares the pickledgerpro Firebase project with the other harsh.bet
// tools and keeps its data under `daymark_users`. The app instance is NAMED,
// like every sibling: auth sessions and the persistent Firestore cache are
// keyed by app name, so an unnamed app would collide with the next tool that
// forgets to name itself on the shared harsh.bet origin.
const APP_NAME = 'daymark';

// The unnamed app Daymark used to occupy; its session and cache are migrated
// below rather than abandoned.
const LEGACY_APP_NAME = '[DEFAULT]';

const firebaseConfig = {
  apiKey: 'AIzaSyATQK7NHNXIshlJIy7xT17z8Kr8fUWatLs',
  authDomain: 'pickledgerpro.firebaseapp.com',
  projectId: 'pickledgerpro',
  storageBucket: 'pickledgerpro.firebasestorage.app',
  messagingSenderId: '285462656063',
  appId: '1:285462656063:web:caa084d1daf04e04eab48a',
};

const AUTH_USER_KEY_PREFIX = `firebase:authUser:${firebaseConfig.apiKey}`;
const LEGACY_CACHE_RELEASED_KEY = 'daymark-default-app-cache-released';

/**
 * Auth persistence is keyed by app name, so renaming the app would sign the
 * owner out. Daymark pins auth to `browserLocalPersistence` before every
 * sign-in (see `authPersistenceReady`), which means the signed-in record lives
 * in localStorage under the old `[DEFAULT]` key: move it onto the named key
 * before `getAuth` looks for it, and the session carries over untouched.
 */
function adoptDefaultAppSession() {
  try {
    const namedKey = `${AUTH_USER_KEY_PREFIX}:${APP_NAME}`;
    const legacyKey = `${AUTH_USER_KEY_PREFIX}:${LEGACY_APP_NAME}`;
    const legacySession = localStorage.getItem(legacyKey);
    if (!legacySession) return;
    if (!localStorage.getItem(namedKey)) localStorage.setItem(namedKey, legacySession);
    // Nothing reads the unnamed app any more, and leaving the record behind
    // would hand a stale session to the next app that forgets to name itself.
    localStorage.removeItem(legacyKey);
  } catch {
    // A blocked localStorage costs one extra sign-in, never any tracker data.
  }
}

/**
 * The Firestore offline cache is keyed by app name too, so the old
 * `[DEFAULT]` database is now unreachable. It is only a cache: the device's
 * record lives in Daymark's own IndexedDB store and localStorage copy, and
 * sync re-uploads anything the cloud is missing on the next bootstrap. Release
 * the storage once instead of stranding it.
 */
function releaseDefaultAppCache() {
  try {
    if (localStorage.getItem(LEGACY_CACHE_RELEASED_KEY)) return;
    const request = indexedDB.deleteDatabase(
      `firestore/${LEGACY_APP_NAME}/${firebaseConfig.projectId}/main`,
    );
    request.onsuccess = () => {
      try {
        localStorage.setItem(LEGACY_CACHE_RELEASED_KEY, new Date().toISOString());
      } catch {
        // Retrying on the next load is harmless.
      }
    };
  } catch {
    // An orphaned cache costs disk space only; it is never read again.
  }
}

adoptDefaultAppSession();

export const firebaseApp = getApps().find((app) => app.name === APP_NAME)
  ?? initializeApp(firebaseConfig, APP_NAME);

export const firebaseAuth = getAuth(firebaseApp);
export const authPersistenceReady = setPersistence(firebaseAuth, browserLocalPersistence);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

export const daymarkFirestore = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

releaseDefaultAppCache();
