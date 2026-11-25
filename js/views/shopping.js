// Handleliste-fanen.
import { state, db } from '../state.js';
import { esc, norm, icon, toast, openSheet, closeTop, confirmDialog, attachSuggest, $ } from '../util.js';
import {
  sortedStorages, storageById, storageLabel, storageOptions, addToShopping, finishShopping,
  productSuggestions, upsertProduct, findProduct,
} from '../logic.js';
import { empty } from './inventory.js';
import { startScan } from './scan.js';

export const shoppingView = {
  title: 'Handleliste',
  mount(el) {
    el.innerHTML = `<div id="shop-body"></div>`;
    this.update();
  },
  update() {
    const body = document.getElementById('shop-body');
    if (body) body.innerHTML = renderBody();
  },
  fab() { openShopSheet(null); },
  scan() { startScan({ mode: 'shopping' }); },
  actions: {
    'toggle-check': (el) => {
      const s = state.shopping.find((x) => x.id === el.dataset.id);
      if (!s) return;
      if (navigator.vibrate) navigator.vibrate(8);
      db.update('shopping', s.id, { checked: !s.checked });
    },
    'remove-shop': (el) => {
      const s = state.shopping.find((x) => x.id === el.dataset.id);
      if (!s) return;
      const { id, ...data } = s;
      db.remove('shopping', id);
      toast(`${s.name} fjernet`, [{ label: 'Angre', run: () => db.set('shopping', id, data, false) }]);
    },
    'finish-shop': async () => {
      const checked = state.shopping.filter((s) => s.checked);
      if (!checked.length) return;
      const withStorage = checked.filter((s) => s.storageId).length;
      const ok = await confirmDialog({
        title: 'Avslutte handleturen?',
        text: `${checked.length} varer i kurven. ${withStorage} legges inn på lager${checked.length - withStorage ? `, ${checked.length - withStorage} uten lager fjernes bare fra lista` : ''}.`,
        ok: 'Avslutt',
      });
      if (!ok) return;
      const res = finishShopping();
      toast(`Handletur fullført! ${res.stocked} ${res.stocked === 1 ? 'vare' : 'varer'} lagt på lager 🎉`);
    },
    'uncheck-all': () => {
      const ops = state.shopping.filter((s) => s.checked).map((s) => ({ type: 'update', col: 'shopping', id: s.id, data: { checked: false } }));
      db.batch(ops);
    },
  },
  contextmenu(el) {
    const s = state.shopping.find((x) => x.id === el.dataset.id);
    if (s) openShopSheet(s);
  },
};

function sortKey(s) {
  const order = sortedStorages().findIndex((x) => x.id === s.storageId);
  return [s.staple ? 0 : 1, order < 0 ? 99 : order, norm(s.name)];
}
function cmp(a, b) {
  const ka = sortKey(a), kb = sortKey(b);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] < kb[i]) return -1;
    if (ka[i] > kb[i]) return 1;
  }
  return 0;
}

function renderBody() {
  if (!state.loaded.shopping) return `<div class="list">${'<div class="card skel short"></div>'.repeat(5)}</div>`;
  const list = state.shopping;
  if (!list.length) {
    return empty('cart', 'Handlelisten er tom', 'Trykk + for å legge til varer. Tomme basisvarer og varer med under halvparten igjen havner her automatisk.');
  }
  const open = list.filter((s) => !s.checked).sort(cmp);
  const done = list.filter((s) => s.checked).sort(cmp);
  const pct = Math.round((done.length / list.length) * 100);

  let html = `
    <div class="shop-summary card">
      <div class="shop-summary-text"><b>${open.length}</b> igjen <span class="dot">·</span> ${done.length} i kurven</div>
      <div class="progress"><span style="width:${pct}%"></span></div>
    </div>
    <div class="list shop-list">${open.map(row).join('')}</div>`;
  if (!open.length) html += `<p class="hint center">Alt er i kurven! Trykk «Avslutt handletur» når du er ferdig.</p>`;
  if (done.length) {
    html += `<div class="group-head sub"><span>I kurven</span><button class="link-btn" data-action="uncheck-all">Fjern alle haker</button></div>
      <div class="list shop-list">${done.map(row).join('')}</div>
      <div class="finish-bar">
        <button class="btn primary block lg" data-action="finish-shop">${icon('check')}Avslutt handletur (${done.length})</button>
      </div>`;
  }
  html += `<p class="hint center small">Trykk for å huke av · hold inne for å redigere</p>`;
  return html;
}

function row(s) {
  const id = esc(s.id);
  const reason = s.reason === 'low' ? 'under halvparten igjen' : s.reason === 'staple' ? 'tom på lager' : s.reason === 'recipe' ? 'fra oppskrift' : '';
  const meta = [
    s.storageId && storageById(s.storageId) ? `<span>${esc(storageLabel(s.storageId))}</span>` : `<span class="faint">Ingen lager</span>`,
    reason ? `<span class="faint">· ${reason}</span>` : '',
  ].join('');
  return `
    <div class="shop-row ${s.staple ? 'staple' : ''} ${s.checked ? 'checked' : ''}" data-action="toggle-check" data-ctx="shop" data-id="${id}" role="checkbox" aria-checked="${!!s.checked}">
      <span class="checkbox">${icon('check')}</span>
      <div class="shop-text">
        <div class="shop-name">${s.staple ? `<span class="star">${icon('star')}</span>` : ''}${esc(s.name)}${s.amount ? ` <span class="amount">${esc(s.amount)}</span>` : ''}</div>
        <div class="shop-meta">${meta}</div>
      </div>
      <button class="icon-btn remove" data-action="remove-shop" data-id="${id}" aria-label="Fjern ${esc(s.name)}">${icon('x')}</button>
    </div>`;
}

// ---------- Legg til / rediger ----------
export function openShopSheet(entry) {
  const isNew = !entry;
  const e0 = entry || { name: '', amount: '', storageId: '' };
  const body = `
    <form class="form" autocomplete="off">
      <label class="field"><span>Vare</span>
        <input name="name" required value="${esc(e0.name)}" placeholder="F.eks. Melk" enterkeyhint="done">
        <div class="suggest-box" hidden></div>
      </label>
      <div class="row">
        <label class="field grow"><span>Mengde <em>(valgfritt)</em></span>
          <input name="amount" value="${esc(e0.amount || '')}" placeholder="F.eks. 2 stk, 1 kg">
        </label>
      </div>
      <label class="field"><span>Legges i lager</span>
        <select name="storageId">${storageOptions(e0.storageId, { allowNone: true })}</select>
        <small class="field-note" data-note hidden></small>
      </label>
      <div class="form-actions">
        <button type="submit" class="btn primary grow">${isNew ? `${icon('plus')}Legg til` : 'Lagre'}</button>
      </div>
      ${isNew ? '<p class="hint center small">Skjemaet holdes åpent så du kan legge til flere varer.</p>' : ''}
    </form>`;
  const sheet = openSheet({ title: isNew ? 'Legg til i handlelisten' : 'Rediger vare', body });
  const form = $('form', sheet);
  const note = $('[data-note]', sheet);
  let userPickedStorage = !isNew;

  const refreshStaple = () => {
    const n = norm(form.name.value);
    const stapleItem = n && state.items.find((i) => i.staple && norm(i.name) === n);
    const prod = n && findProduct(n);
    if (stapleItem) {
      form.storageId.value = stapleItem.storageId || '';
      form.storageId.disabled = true;
      note.hidden = false;
      note.innerHTML = `${icon('star')} Basisvare – lagres automatisk i ${esc(storageLabel(stapleItem.storageId) || 'samme lager')}`;
    } else {
      form.storageId.disabled = false;
      note.hidden = true;
      if (!userPickedStorage && prod?.storageId && storageById(prod.storageId)) form.storageId.value = prod.storageId;
    }
  };
  form.storageId.addEventListener('change', () => { userPickedStorage = true; });
  form.name.addEventListener('input', refreshStaple);
  form.name.addEventListener('change', refreshStaple);
  attachSuggest(form.name, $('.suggest-box', sheet), productSuggestions, (s) => {
    if (s.data.storageId && storageById(s.data.storageId)) { form.storageId.value = s.data.storageId; userPickedStorage = false; }
    refreshStaple();
    form.amount.focus();
  });
  refreshStaple();

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = form.name.value.trim();
    if (!name) return;
    const storageId = form.storageId.value || null;
    const amount = form.amount.value.trim();
    if (isNew) {
      const res = addToShopping({ name, amount, storageId });
      if (!res.ok) toast(`${name} står allerede på lista`);
      else toast(`${name} lagt til`);
      form.reset();
      userPickedStorage = false;
      form.storageId.value = '';
      refreshStaple();
      form.name.focus();
    } else {
      const patch = { name, amount };
      if (!form.storageId.disabled) patch.storageId = storageId;
      db.update('shopping', entry.id, patch);
      upsertProduct({ name, storageId: patch.storageId });
      closeTop();
    }
  });
  if (isNew) setTimeout(() => form.name.focus(), 280);
}
