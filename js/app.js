// Oppstart, innlogging, faner og hendelseshåndtering.
import { state, setDb, COLLECTIONS, emitChange } from './state.js';
import { createStore } from './store.js';
import { $, $$, esc, icon, toast } from './util.js';
import { seedDefaultStorages } from './logic.js';
import { inventoryView } from './views/inventory.js';
import { shoppingView } from './views/shopping.js';
import { recipesView } from './views/recipes.js';
import { openSettings, canInstall, promptInstall } from './views/settings.js';

const views = { shopping: shoppingView, inventory: inventoryView, recipes: recipesView };
let tab = new URLSearchParams(location.search).get('tab') || localStorage.getItem('tab') || 'inventory';
if (!views[tab]) tab = 'inventory';

let store = null;
let unsubs = [];
let pendingRender = false;
let rafId = 0;

// ---------- Oppstart ----------
async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW', e));
  }
  try {
    store = await createStore();
  } catch (e) {
    console.error(e);
    showScreen(`<div class="screen-card">${icon('cloudOff', 'big')}<h2>Kunne ikke starte</h2>
      <p>Sjekk internettforbindelsen og prøv igjen.</p><button class="btn primary" onclick="location.reload()">Prøv igjen</button></div>`);
    return;
  }
  setDb(store);
  store.onAuth((user) => {
    if (user) startApp(user);
    else showLogin();
  });
}

function showScreen(html) {
  const s = $('#screen');
  s.innerHTML = html;
  s.hidden = false;
  $('#app').hidden = true;
}
function hideScreen() {
  $('#screen').hidden = true;
  $('#screen').innerHTML = '';
  $('#app').hidden = false;
}

function showLogin() {
  stopApp();
  showScreen(`
    <div class="screen-card login">
      <img src="icons/icon-192.png" alt="" class="login-logo">
      <h1>Planlegger</h1>
      <p>Lager, handleliste og oppskrifter – felles for hele husstanden.</p>
      <button class="btn google" id="login-btn">
        <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
        Logg inn med Google</button>
      <p class="hint small" id="login-err"></p>
    </div>`);
  $('#login-btn').addEventListener('click', async () => {
    try { await store.signIn(); } catch (e) {
      console.error(e);
      $('#login-err').textContent = `Innlogging feilet: ${e.code || e.message}`;
    }
  });
}

function showNoAccess() {
  stopApp();
  showScreen(`
    <div class="screen-card">
      <div class="empty-ic">${icon('users')}</div>
      <h2>Ingen tilgang ennå</h2>
      <p>Kontoen <b>${esc(state.user?.email || '')}</b> har ikke tilgang til denne husstanden.</p>
      <p class="hint">Be den som satte opp appen legge til e-postadressen din i tilgangslisten (firestore.rules).</p>
      <button class="btn ghost" id="logout-btn">${icon('logout')}Logg ut</button>
    </div>`);
  $('#logout-btn').addEventListener('click', () => store.signOut());
}

function stopApp() {
  unsubs.forEach((u) => u?.());
  unsubs = [];
  for (const c of COLLECTIONS) state[c] = [];
  state.loaded = {};
}

function startApp(user) {
  stopApp();
  state.user = user;
  hideScreen();
  let seeded = false;
  for (const col of COLLECTIONS) {
    unsubs.push(store.subscribe(col, (docs, meta) => {
      state[col] = docs;
      state.loaded[col] = true;
      if (col === 'storages' && !docs.length && !meta.fromCache && !seeded) {
        seeded = true;
        seedDefaultStorages();
      }
      scheduleRender();
    }));
  }
  switchTab(tab, true);
}

// ---------- Rendering ----------
function scheduleRender() {
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active?.classList?.contains('defer-render') && $('#view').contains(active)) {
      pendingRender = true;
      return;
    }
    pendingRender = false;
    const open = state.shopping.filter((s) => !s.checked).length;
    const badge = $('#shop-badge');
    badge.hidden = !open;
    badge.textContent = open > 99 ? '99+' : open;
    views[tab].update();
    emitChange();
  });
}
document.addEventListener('focusout', () => { if (pendingRender) setTimeout(scheduleRender, 0); });

function switchTab(name, force = false) {
  if (!views[name]) return;
  if (name === tab && !force) {
    $('#view').scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  tab = name;
  localStorage.setItem('tab', name);
  $$('.tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === name);
    b.setAttribute('aria-selected', b.dataset.tab === name);
  });
  $('#title').textContent = views[name].title;
  const view = $('#view');
  view.scrollTop = 0;
  view.dataset.tab = name;
  views[name].mount(view);
}

// ---------- Hendelser ----------
function findHandler(kind, name) {
  return views[tab][kind]?.[name] || Object.values(views).map((v) => v[kind]?.[name]).find(Boolean);
}

document.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('.tab');
  if (tabBtn) { switchTab(tabBtn.dataset.tab); return; }
  if (e.target.closest('#fab')) { views[tab].fab(); return; }
  if (e.target.closest('#settings-btn')) {
    openSettings({ mode: store.mode, user: state.user, signOut: () => store.signOut() });
    return;
  }
  const el = e.target.closest('#view [data-action]');
  if (!el) return;
  const fn = findHandler('actions', el.dataset.action);
  if (fn) { e.preventDefault(); fn(el, e); }
});

document.addEventListener('change', (e) => {
  const el = e.target.closest('#view [data-change]');
  if (!el) return;
  const fn = findHandler('changes', el.dataset.change);
  if (fn) fn(el, e);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('#view input.defer-render')) e.target.blur();
});

// Langt trykk (Android gir "contextmenu") for å redigere handlelistevarer
document.addEventListener('contextmenu', (e) => {
  const el = e.target.closest('#view [data-ctx]');
  if (!el) return;
  e.preventDefault();
  if (navigator.vibrate) navigator.vibrate(15);
  views[tab].contextmenu?.(el);
});

// Feil fra databasen
window.addEventListener('store-error', (e) => {
  const err = e.detail;
  if (err?.code === 'permission-denied' && store?.mode === 'firebase') { showNoAccess(); return; }
  if (err?.name === 'QuotaExceededError') { toast('Lagringsplassen er full – prøv å fjerne noen bilder'); return; }
  toast(`Noe gikk galt: ${err?.code || err?.message || err}`);
});

// Offline-indikator
const updateOnline = () => { $('#offline').hidden = navigator.onLine; };
window.addEventListener('online', updateOnline);
window.addEventListener('offline', updateOnline);
updateOnline();

// Installeringstilbud (Android/Chrome) – vises én gang per økt
window.addEventListener('install-available', () => {
  if (sessionStorage.getItem('install-asked') || matchMedia('(display-mode: standalone)').matches) return;
  sessionStorage.setItem('install-asked', '1');
  setTimeout(() => {
    if (canInstall()) toast('Legg Planlegger på hjemskjermen?', [{ label: 'Installer', run: promptInstall }], 9000);
  }, 2500);
});

boot();
