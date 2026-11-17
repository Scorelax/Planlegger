// Datalag med to varianter:
//  - Firebase (Firestore + Google-innlogging) når js/config.js er fylt ut
//  - Lokal lagring (localStorage) som demo-modus ellers
// Begge har samme API: subscribe, set, update, remove, batch, newId, onAuth, signIn, signOut.
import { firebaseConfig } from './config.js';
import { uid } from './util.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.12.0';

export const isFirebaseConfigured = () => !!(firebaseConfig?.apiKey && firebaseConfig?.projectId);

export function createStore() {
  return isFirebaseConfigured() ? createFirebaseStore() : createLocalStore();
}

const reportError = (e) => {
  console.error(e);
  window.dispatchEvent(new CustomEvent('store-error', { detail: e }));
};
const clean = (v) => JSON.parse(JSON.stringify(v ?? {}));

// ---------------- Lokal ----------------
function createLocalStore() {
  const KEY = 'planlegger-local-v1';
  let data = {};
  try { data = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { data = {}; }
  const subs = {};
  const dirty = new Set();
  let scheduled = false;

  const list = (col) => Object.entries(data[col] || {}).map(([id, d]) => ({ ...d, id }));
  const flush = () => {
    scheduled = false;
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { reportError(e); }
    for (const col of dirty) (subs[col] || []).forEach((cb) => cb(list(col), { fromCache: false }));
    dirty.clear();
  };
  const touch = (col) => {
    dirty.add(col);
    if (!scheduled) { scheduled = true; queueMicrotask(flush); }
  };

  const api = {
    mode: 'local',
    subscribe(col, cb) {
      (subs[col] ||= new Set()).add(cb);
      queueMicrotask(() => cb(list(col), { fromCache: false }));
      return () => subs[col].delete(cb);
    },
    newId: () => uid(),
    set(col, id, val, merge = true) {
      data[col] ||= {};
      data[col][id] = merge ? { ...(data[col][id] || {}), ...clean(val) } : clean(val);
      touch(col);
    },
    update(col, id, patch) {
      if (!data[col]?.[id]) return;
      Object.assign(data[col][id], clean(patch));
      touch(col);
    },
    remove(col, id) {
      if (data[col]?.[id]) { delete data[col][id]; touch(col); }
    },
    batch(ops) {
      for (const o of ops) {
        if (o.type === 'delete') api.remove(o.col, o.id);
        else if (o.type === 'update') api.update(o.col, o.id, o.data);
        else api.set(o.col, o.id, o.data, o.merge !== false);
      }
    },
    onAuth(cb) { cb({ local: true, email: null, name: 'Lokal bruker' }); },
    async signIn() {},
    async signOut() {},
  };
  return Promise.resolve(api);
}

// ---------------- Firebase ----------------
async function createFirebaseStore() {
  const [appMod, authMod, fs] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const app = appMod.initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  auth.languageCode = 'no';

  let firestore;
  try {
    firestore = fs.initializeFirestore(app, {
      ignoreUndefinedProperties: true,
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    });
  } catch (e) {
    console.warn('Offline-cache utilgjengelig, bruker minne-cache', e);
    firestore = fs.initializeFirestore(app, { ignoreUndefinedProperties: true });
  }

  const ref = (col, id) => fs.doc(firestore, col, id);

  return {
    mode: 'firebase',
    subscribe(col, cb) {
      return fs.onSnapshot(
        fs.collection(firestore, col),
        (snap) => cb(snap.docs.map((d) => ({ ...d.data(), id: d.id })), { fromCache: snap.metadata.fromCache }),
        reportError,
      );
    },
    newId: (col) => fs.doc(fs.collection(firestore, col)).id,
    set(col, id, val, merge = true) {
      fs.setDoc(ref(col, id), val, { merge }).catch(reportError);
    },
    update(col, id, patch) {
      fs.updateDoc(ref(col, id), patch).catch((e) => { if (e.code !== 'not-found') reportError(e); });
    },
    remove(col, id) {
      fs.deleteDoc(ref(col, id)).catch(reportError);
    },
    batch(ops) {
      const b = fs.writeBatch(firestore);
      for (const o of ops) {
        if (o.type === 'delete') b.delete(ref(o.col, o.id));
        else if (o.type === 'update') b.update(ref(o.col, o.id), o.data);
        else b.set(ref(o.col, o.id), o.data, { merge: o.merge !== false });
      }
      b.commit().catch(reportError);
    },
    onAuth(cb) {
      authMod.onAuthStateChanged(auth, (u) =>
        cb(u ? { uid: u.uid, email: u.email, name: u.displayName, photo: u.photoURL } : null));
    },
    async signIn() {
      const provider = new authMod.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await authMod.signInWithPopup(auth, provider);
      } catch (e) {
        if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
        if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
          return authMod.signInWithRedirect(auth, provider);
        }
        throw e;
      }
    },
    signOut: () => authMod.signOut(auth),
  };
}
