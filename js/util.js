// Små hjelpefunksjoner: escaping, datoer, ikoner, toasts, sheets og dialoger.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const norm = (s) => String(s ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
export const productId = (name) => 'p_' + norm(name).replace(/[\/#?\[\]*.]/g, '-').slice(0, 120);
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
export const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------- Datoer ----------
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const daysSince = (ts) => Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 86400000);
export function parseDate(str) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}
export const daysUntil = (str) => Math.round((parseDate(str) - startOfDay(Date.now())) / 86400000);
export const toDateInput = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const shortDate = (str) => { const [, m, d] = str.split('-'); return `${Number(d)}.${Number(m)}`; };

export function ageLabel(days) {
  if (days <= 0) return 'i dag';
  if (days === 1) return 'i går';
  if (days < 14) return `${days} dager`;
  if (days < 60) return `${Math.floor(days / 7)} uker`;
  return `${Math.floor(days / 30)} mnd`;
}
export function formatMinutes(m) {
  m = Number(m);
  if (!m) return '';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} t ${r} min` : `${h} t`;
}
export const fmtNum = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100).replace('.', ','));

// ---------- Ikoner (lucide-inspirert) ----------
const ICONS = {
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  box: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="m7.5 4.27 9 5.15"/>',
  book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  settings: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  edit: '<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  bowl: '<path d="M12 21a9 9 0 0 0 9-9H3a9 9 0 0 0 9 9Z"/><path d="M7 21h10"/><path d="M19.5 12 22 6"/><path d="M16.25 3c.27.1.8.53.75 1.36-.06.83-.93 1.2-1 2.02-.05.78.34 1.24.73 1.62"/><path d="M11.25 3c.27.1.8.53.74 1.36-.05.83-.93 1.2-.98 2.02-.06.78.33 1.24.72 1.62"/><path d="M6.25 3c.27.1.8.53.75 1.36-.06.83-.93 1.2-1 2.02-.05.78.34 1.24.74 1.62"/>',
  sparkle: '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.13a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.13 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  phone: '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
  list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  cloudOff: '<path d="m2 2 20 20"/><path d="M5.78 5.78A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.31-.2"/><path d="M21.53 16.05A4.5 4.5 0 0 0 17.5 10h-1.79A7.01 7.01 0 0 0 10 5.07"/>',
};
export const icon = (name, cls = '') =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

// ---------- Toasts ----------
export function toast(msg, actions = [], ms = 3200) {
  const host = document.getElementById('toasts');
  if (!host) return;
  while (host.children.length >= 2) host.firstChild.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(msg)}</span>` +
    actions.map((a, i) => `<button type="button" data-i="${i}">${esc(a.label)}</button>`).join('');
  let timer;
  const close = () => { clearTimeout(timer); el.classList.remove('show'); setTimeout(() => el.remove(), 250); };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    actions[b.dataset.i].run();
    close();
  });
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  timer = setTimeout(close, actions.length ? Math.max(ms, 6000) : ms);
}

// ---------- Overlays (sheets, sider, dialoger) med støtte for Android tilbake-knapp ----------
const stack = [];
let ignorePops = 0;

export function openOverlay(el, { onClose } = {}) {
  document.body.appendChild(el);
  stack.push({ el, onClose });
  history.pushState({ overlay: stack.length }, '');
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('open')));
  return el;
}
function teardown({ el, onClose }) {
  el.classList.remove('open');
  setTimeout(() => el.remove(), 260);
  try { onClose?.(); } catch (e) { console.error(e); }
}
export function closeTop(n = 1) {
  n = Math.min(n, stack.length);
  if (!n) return;
  for (let i = 0; i < n; i++) teardown(stack.pop());
  ignorePops++;
  history.go(-n);
}
export const overlayCount = () => stack.length;
window.addEventListener('popstate', () => {
  if (ignorePops > 0) { ignorePops--; return; }
  const top = stack.pop();
  if (top) teardown(top);
});

export function openSheet({ title, body, className = '', onClose }) {
  const wrap = document.createElement('div');
  wrap.className = `overlay sheet-wrap ${className}`;
  wrap.innerHTML = `
    <div class="backdrop" data-close></div>
    <div class="sheet" role="dialog" aria-label="${esc(title)}">
      <div class="sheet-handle"></div>
      <div class="sheet-head"><h2>${esc(title)}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Lukk">${icon('x')}</button></div>
      <div class="sheet-body">${body}</div>
    </div>`;
  wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeTop(); });
  return openOverlay(wrap, { onClose });
}

export function openPage({ html, className = '', onClose }) {
  const wrap = document.createElement('div');
  wrap.className = `overlay page ${className}`;
  wrap.innerHTML = html;
  return openOverlay(wrap, { onClose });
}

export function confirmDialog({ title, text = '', ok = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'overlay dialog-wrap';
    wrap.innerHTML = `
      <div class="backdrop" data-r="0"></div>
      <div class="dialog" role="alertdialog">
        <h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}
        <div class="dialog-actions">
          <button type="button" class="btn ghost" data-r="0">Avbryt</button>
          <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(ok)}</button>
        </div>
      </div>`;
    let result = false;
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      result = b.dataset.r === '1';
      closeTop();
    });
    openOverlay(wrap, { onClose: () => resolve(result) });
  });
}

// ---------- Forslag (autofullføring) ----------
// getItems(q) -> [{ value, label, sub, data }]
export function attachSuggest(input, box, getItems, onPick) {
  let items = [];
  const show = () => {
    const q = input.value;
    items = q.trim() ? getItems(q).slice(0, 6) : [];
    box.innerHTML = items.map((it, i) =>
      `<button type="button" class="suggest" data-i="${i}"><span>${esc(it.label)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</button>`
    ).join('');
    box.hidden = !items.length;
  };
  input.addEventListener('input', show);
  input.addEventListener('focus', show);
  input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 180));
  box.addEventListener('pointerdown', (e) => e.preventDefault());
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    const it = items[b.dataset.i];
    input.value = it.value;
    box.hidden = true;
    onPick?.(it);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

// ---------- Filer ----------
export function download(filename, content, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export async function compressImage(file, maxSide = 1000, quality = 0.72) {
  let src;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    src = await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
  }
  const encode = (side, q) => {
    const w = src.width, h = src.height;
    const scale = Math.min(1, side / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q);
  };
  let out = encode(maxSide, quality);
  if (out.length > 600_000) out = encode(800, 0.62);
  if (out.length > 600_000) out = encode(600, 0.55);
  return out;
}
