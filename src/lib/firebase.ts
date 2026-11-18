import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  UserCredential,
} from 'firebase/auth';
import {
  Firestore,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDocFromServer,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

export function isEmbeddedFrame(): boolean {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    return true;
  }
}

export function isCapacitorNative(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
  };
  if (typeof win.Capacitor?.isNativePlatform === 'function') {
    return win.Capacitor.isNativePlatform();
  }
  const proto = window.location?.protocol || '';
  return proto === 'capacitor:' || proto === 'ionic:';
}

export function isElectronDesktop(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as unknown as {
    __SCHOOLARIA_DESKTOP__?: boolean;
    process?: { versions?: { electron?: string } };
  };
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return (
    Boolean(win.__SCHOOLARIA_DESKTOP__) ||
    Boolean(win.process?.versions?.electron) ||
    /Electron/i.test(ua) ||
    window.location?.protocol === 'file:' ||
    window.location?.protocol === 'app:'
  );
}

export function isCompiledShell(): boolean {
  const buildTarget = (import.meta.env.VITE_APP_TARGET || '').toLowerCase();
  return (
    buildTarget === 'native' ||
    buildTarget === 'desktop' ||
    isCapacitorNative() ||
    isElectronDesktop()
  );
}

function createConfiguredDb(): Firestore {
  try {
    // Embedded preview iframes can clash on IndexedDB primary leases with an open PWA window;
    // keep persistent IndexedDB offline cache for standalone/top-level PC & Mobile app sessions.
    if (isEmbeddedFrame()) {
      return initializeFirestore(
        app,
        { localCache: memoryLocalCache() },
        firebaseConfig.firestoreDatabaseId
      );
    }
    return initializeFirestore(
      app,
      {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      },
      firebaseConfig.firestoreDatabaseId
    );
  } catch {
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
}

export const db = createConfiguredDb();
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Ensure auth persistence works across PWA, Electron, and mobile WebViews
void setPersistence(auth, indexedDBLocalPersistence).catch(() =>
  setPersistence(auth, browserLocalPersistence).catch(() => {
    // Default persistence retained
  })
);

export async function processAuthRedirectResult(): Promise<UserCredential | null> {
  try {
    return await getRedirectResult(auth);
  } catch (err) {
    console.warn('Redirect auth result notice:', err);
    return null;
  }
}

export function formatFirebaseAuthError(error: unknown): string {
  const errObj = error as { code?: string; message?: string } | null;
  const code = errObj?.code || '';
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  switch (code) {
    case 'auth/popup-closed-by-user':
      return 'Fenêtre de connexion Google fermée avant validation. Réessayez.';
    case 'auth/cancelled-popup-request':
      return 'Une demande de connexion est déjà en cours.';
    case 'auth/network-request-failed':
      return 'Erreur réseau pendant la connexion Google. Vérifiez votre accès Internet.';
    case 'auth/unauthorized-domain':
      return `Domaine non autorisé dans Firebase Auth (${origin || 'inconnu'}). Ajoutez ce domaine dans Console Firebase → Authentication → Settings → Authorized domains.`;
    case 'auth/operation-not-supported-in-this-environment':
      return 'Cet environnement bloque les fenêtres popup : bascule en mode redirection en cours...';
    default:
      return errObj?.message || 'Échec de la connexion Google.';
  }
}

/**
 * While online, awaits server confirmation.
 * While offline (délestage / coupure réseau), lets Firestore persist into IndexedDB immediately
 * and resolves after a short local flush so the UI remains responsive and syncs later.
 */
export async function awaitWithOfflineQueue<T>(opPromise: Promise<T>): Promise<T | void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    opPromise.catch((err) => {
      console.warn('Écriture hors-ligne différée en erreur lors de la synchro :', err);
    });
    await Promise.race([
      opPromise,
      new Promise<void>((resolve) => setTimeout(resolve, 260)),
    ]);
    return;
  }
  return opPromise;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Veuillez vérifier votre configuration Firebase (client hors ligne).');
      return false;
    }
    return true;
  }
}

export async function signInWithGoogle() {
  // Native Capacitor WebViews and local file:// Electron shells often reject popups;
  // prefer popup in standard web/iframes and fall back automatically to redirect when blocked/unsupported.
  const shouldPreferRedirect =
    isCapacitorNative() ||
    (typeof window !== 'undefined' && window.location.protocol === 'file:');

  if (shouldPreferRedirect) {
    await signInWithRedirect(auth, googleProvider);
    return null;
  }

  try {
    return await signInWithPopup(auth, googleProvider);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code || '';
    if (
      !isEmbeddedFrame() &&
      (code === 'auth/popup-blocked' ||
        code === 'auth/operation-not-supported-in-this-environment' ||
        code === 'auth/web-storage-unsupported')
    ) {
      await signInWithRedirect(auth, googleProvider);
      return null;
    }
    throw new Error(formatFirebaseAuthError(err));
  }
}

export async function signOutUser() {
  return signOut(auth);
}

export async function getAuthHeaders(forceRefresh = false): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const currentUser = auth.currentUser;
  if (currentUser) {
    try {
      const token = await currentUser.getIdToken(forceRefresh);
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    } catch (err) {
      console.warn('Impossible de récupérer le jeton d’authentification :', err);
    }
  }
  return headers;
}
