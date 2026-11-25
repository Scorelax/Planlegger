// Lager-fanen: lager (kjøleskap, fryser …), varer og middagsrester.
import { state, db, onChange } from '../state.js';
import {
  esc, norm, icon, toast, openSheet, closeTop, confirmDialog, attachSuggest, pushBack, topIsBackStep,
  daysSince, daysUntil, ageLabel, shortDate, toDateInput, parseDate, $,
} from '../util.js';
import {
  sortedStorages, storageById, storageLabel, storageOptions, isFreezer, defaultFridgeId,
  updateItem, setCount, usedUp, refill, upsertProduct, productSuggestions, syncAuto,
  fmtWeight, WEIGHT_UNITS,
} from '../logic.js';
import { startScan } from './scan.js';
import { openNutritionSheet } from './nutrition.js';
import { hasNutrition, nutritionProduct, SOURCE_LABEL } from '../nutrition.js';

// current: null = oversikt over alle lager, 'leftovers' = middagsrester, ellers et lager-ID.
let current = null;
let query = '';

function openStorage(id) {
  if (current) return;
  current = id;
  query = '';
  pushBack(() => { current = null; query = ''; inventoryView.mount(document.getElementById('view')); });
  inventoryView.mount(document.getElementById('view'));
  document.getElementById('view').scrollTop = 0;
}
const backToOverview = () => { if (current && topIsBackStep()) closeTop(); };

export const inventoryView = {
  title: 'Lager',
  mount(el) {
    const placeholder = current === 'leftovers' ? 'Søk i rester…'
      : current ? `Søk i ${storageById(current)?.name || 'lageret'}…` : 'Søk etter vare i alle lager…';
    el.innerHTML = `
      <div class="toolbar">
        <div id="inv-head"></div>
        <label class="search">${icon('search')}
          <input id="inv-search" type="search" placeholder="${esc(placeholder)}" value="${esc(query)}" autocomplete="off" enterkeyhint="search">
        </label>
      </div>
      <div id="inv-body"></div>`;
    $('#inv-search', el).addEventListener('input', (e) => { query = e.target.value; this.update(); });
    this.update();
  },
  update() {
    const head = document.getElementById('inv-head');
    const body = document.getElementById('inv-body');
    if (head) head.innerHTML = renderHead();
    if (body) body.innerHTML = renderBody();
  },
  // Kalles når man bytter bort fra fanen, eller trykker på Lager-fanen igjen
  leave() { backToOverview(); },
  reselect() { backToOverview(); },
  fab() {
    if (current === 'leftovers') openLeftoverSheet(null);
    else openItemSheet(null, { storageId: storageById(current) ? current : undefined, allowLeftover: !current });
  },
  scan() { startScan({ mode: 'inventory', storageId: current }); },
  actions: {
    'open-storage': (el) => openStorage(el.dataset.id),
    'inv-back': () => backToOverview(),
    'manage-storages': () => document.getElementById('settings-btn').click(),
    'edit-item': (el) => openItemSheet(getItem(el)),
    'inc': (el) => { const it = getItem(el); if (it) setCount(it, (it.count || 0) + 1); },
    'dec': (el) => { const it = getItem(el); if (it) setCount(it, (it.count || 0) - 1); },
    'used-up': (el) => { const it = getItem(el); if (it) usedUp(it); },
    'refill': (el) => { const it = getItem(el); if (it) { refill(it); toast(`${it.name} er fylt på`); } },
    'edit-leftover': (el) => openLeftoverSheet(getLeftover(el)),
    'lo-inc': (el) => { const l = getLeftover(el); if (l) db.update('leftovers', l.id, { portions: (l.portions || 0) + 1 }); },
    'lo-dec': (el) => {
      const l = getLeftover(el);
      if (!l) return;
      if ((l.portions || 0) <= 1) leftoverDone(l);
      else db.update('leftovers', l.id, { portions: l.portions - 1 });
    },
    'lo-done': (el) => { const l = getLeftover(el); if (l) leftoverDone(l); },
    'add-leftover': () => openLeftoverSheet(null),
  },
  changes: {
    'set-count': (el) => { const it = getItem(el); if (it) setCount(it, el.value); },
    'toggle-low': (el) => {
      const it = getItem(el);
      if (!it) return;
      updateItem(it, { lowWeight: el.checked });
      if (el.checked) toast(`${it.name} lagt på handlelisten`);
    },
  },
};

const getItem = (el) => state.items.find((i) => i.id === el.dataset.id);
const getLeftover = (el) => state.leftovers.find((l) => l.id === el.dataset.id);

function leftoverDone(l) {
  const { id, ...data } = l;
  db.remove('leftovers', id);
  toast(`${l.name} er spist opp`, [{ label: 'Angre', run: () => db.set('leftovers', id, data, false) }]);
}

// ---------- Rendering ----------
function renderHead() {
  if (!current) return '';
  const s = storageById(current);
  if (current !== 'leftovers' && !s) { setTimeout(backToOverview, 0); return ''; }
  const title = current === 'leftovers' ? '🍲 Middagsrester' : `${s.icon || ''} ${s.name}`;
  const n = current === 'leftovers'
    ? `${state.leftovers.reduce((a, l) => a + (Number(l.portions) || 0), 0)} porsj.`
    : `${state.items.filter((i) => i.storageId === current).length} varer`;
  return `<div class="storage-head">
    <button class="icon-btn" data-action="inv-back" aria-label="Tilbake til alle lager">${icon('back')}</button>
    <h2>${esc(title)}</h2><span class="storage-head-n">${esc(n)}</span>
  </div>`;
}

function renderBody() {
  if (!state.loaded.items || !state.loaded.storages) return skeleton();
  const q = norm(query);

  if (current === 'leftovers') {
    const lefts = state.leftovers.filter((l) => !q || norm(l.name).includes(q));
    return lefts.length
      ? `<div class="list">${sortLeftovers(lefts).map(leftoverCard).join('')}</div>`
      : empty('bowl', q ? 'Ingen treff' : 'Ingen middagsrester', q ? '' : 'Trykk + for å legge inn rester og antall porsjoner.');
  }
  if (current) {
    const its = state.items.filter((i) => i.storageId === current && (!q || norm(i.name).includes(q)));
    return its.length
      ? `<div class="list">${sortItems(its).map((it) => itemCard(it)).join('')}</div>`
      : empty('box', q ? 'Ingen treff' : 'Tomt her', q ? '' : 'Trykk + for å legge til varer i dette lageret.');
  }

  // Oversikt: søk viser treff på tvers av alle lager
  if (q) {
    const its = state.items.filter((i) => norm(i.name).includes(q));
    const lefts = state.leftovers.filter((l) => norm(l.name).includes(q));
    if (!its.length && !lefts.length) return empty('search', 'Ingen treff', `Fant ingenting som matcher «${query}».`);
    return `<div class="list">${sortLeftovers(lefts).map(leftoverCard).join('')}${sortItems(its).map((it) => itemCard(it, true)).join('')}</div>`;
  }
  return storageGrid();
}

function storageGrid() {
  const tiles = sortedStorages().map((s) => {
    const its = state.items.filter((i) => i.storageId === s.id);
    const emptyN = its.filter((i) => i.empty).length;
    const lowN = its.filter((i) => !i.empty && i.lowWeight).length;
    const soon = its.filter((i) => !i.empty && i.bestBefore && daysUntil(i.bestBefore) <= 2).length;
    const flags = [
      emptyN ? `<span class="tag warn">${emptyN} tom${emptyN > 1 ? 'me' : ''}</span>` : '',
      lowN ? `<span class="tag warn">${lowN} under ½</span>` : '',
      soon ? `<span class="tag bad">${soon} best før</span>` : '',
    ].join('');
    const n = its.length - emptyN;
    return tile(s.id, s.icon || '📦', s.name, `${n} ${n === 1 ? 'vare' : 'varer'}`, flags);
  });

  const portions = state.leftovers.reduce((a, l) => a + (Number(l.portions) || 0), 0);
  const oldFridge = state.leftovers.filter((l) => !isFreezer(l.storageId) && daysSince(l.addedAt || Date.now()) >= 3).length;
  const loFlag = oldFridge ? `<span class="tag warn">${oldFridge} bør spises</span>` : '';
  tiles.unshift(tile('leftovers', '🍲', 'Middagsrester', portions ? `${portions} porsj.` : 'Ingen rester', loFlag, 'leftover-tile'));

  const orphans = state.items.filter((i) => !storageById(i.storageId));
  let html = `<div class="storage-grid">${tiles.join('')}
    <button class="storage-tile add" data-action="manage-storages">${icon('plus')}<span>Nytt lager</span></button>
  </div>`;
  if (orphans.length) html += section('Uten lager', orphans.length, sortItems(orphans).map((it) => itemCard(it)).join(''));
  if (!state.items.length && !state.leftovers.length) {
    html += `<p class="hint center">Trykk på et lager for å se innholdet, eller <b>+</b> for å legge inn en vare.</p>`;
  }
  return html;
}

const tile = (id, emoji, name, sub, flags, cls = '') => `
  <button class="storage-tile ${cls}" data-action="open-storage" data-id="${esc(id)}">
    <span class="tile-emoji">${esc(emoji)}</span>
    <span class="tile-name">${esc(name)}</span>
    <span class="tile-sub">${esc(sub)}</span>
    ${flags ? `<span class="tile-flags">${flags}</span>` : ''}
  </button>`;

const sortItems = (its) => [...its].sort((a, b) =>
  (a.empty ? 1 : 0) - (b.empty ? 1 : 0) || a.name.localeCompare(b.name, 'no'));
const sortLeftovers = (ls) => [...ls].sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));

const section = (title, count, inner) => `
  <section class="group">
    <div class="group-head"><span>${esc(title)}</span><span class="group-count">${esc(count)}</span></div>
    <div class="list">${inner}</div>
  </section>`;

export const empty = (ic, title, text = '') => `
  <div class="empty">
    <div class="empty-ic">${icon(ic)}</div>
    <h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}
  </div>`;

const skeleton = () => `<div class="list">${'<div class="card skel"></div>'.repeat(4)}</div>`;

function bestBeforeChip(bb) {
  const d = daysUntil(bb);
  if (d < 0) return `<span class="tag bad">Gått ut ${shortDate(bb)}</span>`;
  if (d === 0) return `<span class="tag warn">Best før i dag</span>`;
  if (d <= 2) return `<span class="tag warn">Best før om ${d} d</span>`;
  return `<span class="tag soft">Best før ${shortDate(bb)}</span>`;
}

// Varen er skannet når varedatabasen har en strekkode lagret på navnet.
const isScanned = (it) => !!state.products.find((p) => p.nameLower === norm(it.name))?.barcodes?.length;

function itemCard(it, showStorage = false) {
  const id = esc(it.id);
  let ctrl = '';
  if (it.empty) {
    ctrl = `<button class="pill accent" data-action="refill" data-id="${id}">Fyll på</button>`;
  } else if (it.qtyType === 'count') {
    ctrl = `<div class="stepper">
      <button data-action="dec" data-id="${id}" aria-label="Færre">${icon('minus')}</button>
      <input class="defer-render" type="number" inputmode="numeric" min="0" value="${Number(it.count) || 0}" data-change="set-count" data-id="${id}" aria-label="Antall">
      <button data-action="inc" data-id="${id}" aria-label="Flere">${icon('plus')}</button></div>`;
  } else if (it.qtyType === 'weight') {
    ctrl = `<div class="weight-ctrl">
      ${fmtWeight(it) ? `<span class="weight-val">${esc(fmtWeight(it))}</span>` : ''}
      <label class="check-chip ${it.lowWeight ? 'on' : ''}">
        <input type="checkbox" data-change="toggle-low" data-id="${id}" ${it.lowWeight ? 'checked' : ''}>
        <span class="box">${icon('check')}</span><span>&lt; ½ igjen</span></label></div>`;
  }

  const tags = [];
  if (showStorage && it.storageId) tags.push(`<span class="tag soft">${esc(storageLabel(it.storageId))}</span>`);
  if (it.staple) tags.push(`<span class="tag staple">${icon('star')}Basis</span>`);
  if (it.empty) tags.push(`<span class="tag warn">Tom · på handlelisten</span>`);
  else if (it.lowWeight) tags.push(`<span class="tag warn">På handlelisten</span>`);
  if (it.bestBefore && !it.empty) tags.push(bestBeforeChip(it.bestBefore));
  if (it.addedAt && !it.empty) tags.push(`<span class="meta-age">${icon('clock')}${ageLabel(daysSince(it.addedAt))}</span>`);

  return `
    <article class="card item ${it.empty ? 'is-empty' : ''} ${it.staple ? 'is-staple' : ''}">
      <div class="item-top">
        <button class="item-name" data-action="edit-item" data-id="${id}">${esc(it.name)}</button>
        ${ctrl}
      </div>
      <div class="item-bottom">
        <div class="item-meta">${tags.join('')}</div>
        <div class="item-actions">
          ${isScanned(it) ? `<span class="scanned-mark" title="Skannet – strekkoden er lagret" aria-label="Skannet">${icon('barcode')}</span>` : ''}
          ${it.empty ? '' : `<button class="pill ghost small" data-action="used-up" data-id="${id}">Brukt opp</button>`}
        </div>
      </div>
    </article>`;
}

function leftoverAge(l) {
  const d = daysSince(l.addedAt || Date.now());
  const [warn, bad] = isFreezer(l.storageId) ? [60, 90] : [3, 5];
  const cls = d >= bad ? 'bad' : d >= warn ? 'warn' : 'ok';
  return `<span class="tag ${cls}">${icon('clock')}${ageLabel(d)}</span>`;
}

function leftoverCard(l) {
  const id = esc(l.id);
  return `
    <article class="card item leftover">
      <div class="item-top">
        <button class="item-name" data-action="edit-leftover" data-id="${id}">${esc(l.name)}</button>
        <div class="stepper with-label">
          <button data-action="lo-dec" data-id="${id}" aria-label="Færre porsjoner">${icon('minus')}</button>
          <span class="stepper-val">${Number(l.portions) || 0}<small>porsj.</small></span>
          <button data-action="lo-inc" data-id="${id}" aria-label="Flere porsjoner">${icon('plus')}</button>
        </div>
      </div>
      <div class="item-bottom">
        <div class="item-meta">${leftoverAge(l)}${l.storageId ? `<span class="meta-age">${esc(storageLabel(l.storageId))}</span>` : ''}</div>
        <button class="pill ghost small" data-action="lo-done" data-id="${id}">Spist opp</button>
      </div>
    </article>`;
}

// ---------- Skjema: vare ----------
export function openItemSheet(item, { storageId, allowLeftover = false, name = '' } = {}) {
  const isNew = !item;
  const it = item || {
    name, storageId: storageId || sortedStorages()[0]?.id || '', qtyType: 'none', count: 1,
    weight: '', unit: 'g', staple: false, bestBefore: '',
  };
  const seg = (v, label) =>
    `<button type="button" class="seg-btn ${it.qtyType === v || (!it.qtyType && v === 'none') ? 'active' : ''}" data-q="${v}">${label}</button>`;

  const body = `
    ${isNew && allowLeftover ? `<div class="seg kind-seg"><button type="button" class="seg-btn active">Vare</button><button type="button" class="seg-btn" data-kind="leftover">🍲 Middagsrest</button></div>` : ''}
    <form class="form" autocomplete="off">
      <label class="field"><span>Navn</span>
        <input name="name" required value="${esc(it.name)}" placeholder="F.eks. Kyllingfilet" enterkeyhint="next">
        <div class="suggest-box" hidden></div>
      </label>
      <label class="field"><span>Lager</span>
        <select name="storageId">${storageOptions(it.storageId)}</select>
      </label>
      <div class="field"><span>Vekt / antall <em>(valgfritt)</em></span>
        <div class="seg qty-seg">${seg('none', 'Ingen')}${seg('count', 'Antall')}${seg('weight', 'Vekt')}</div>
      </div>
      <div class="qty-pane" data-pane="count" ${it.qtyType === 'count' ? '' : 'hidden'}>
        <div class="stepper big">
          <button type="button" data-step="-1">${icon('minus')}</button>
          <input name="count" type="number" inputmode="numeric" min="0" value="${Number(it.count ?? 1)}">
          <button type="button" data-step="1">${icon('plus')}</button>
        </div>
      </div>
      <div class="qty-pane row" data-pane="weight" ${it.qtyType === 'weight' ? '' : 'hidden'}>
        <input name="weight" type="number" inputmode="decimal" step="any" min="0" placeholder="600" value="${esc(it.weight ?? '')}">
        <select name="unit">${WEIGHT_UNITS.map((u) => `<option ${u === (it.unit || 'g') ? 'selected' : ''}>${u}</option>`).join('')}</select>
      </div>
      <label class="switch-row">
        <div><b>${icon('star')} Basisvare (staple)</b><small>Noe dere alltid skal ha. Når den er tom, havner den automatisk på handlelisten.</small></div>
        <input type="checkbox" class="switch" name="staple" ${it.staple ? 'checked' : ''}>
      </label>
      <label class="field"><span>Best før <em>(valgfritt)</em></span>
        <input name="bestBefore" type="date" value="${esc(it.bestBefore || '')}">
      </label>
      <button type="button" class="nutri-row" data-nutri>${icon('leaf')}<span class="grow">Næringsinnhold</span><small data-nutri-state></small>${icon('chevron')}</button>
      <div class="form-actions">
        ${isNew ? '' : `<button type="button" class="btn ghost danger-text" data-del>${icon('trash')}Slett</button>`}
        <button type="submit" class="btn primary grow">${isNew ? 'Legg til' : 'Lagre'}</button>
      </div>
    </form>`;

  let unsubNutri = null;
  const sheet = openSheet({ title: isNew ? 'Ny vare' : 'Rediger vare', body, onClose: () => unsubNutri?.() });
  const form = $('form', sheet);
  let qtyType = it.qtyType || 'none';

  const setQty = (v) => {
    qtyType = v;
    sheet.querySelectorAll('.qty-seg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.q === v));
    sheet.querySelectorAll('.qty-pane').forEach((p) => { p.hidden = p.dataset.pane !== v; });
  };
  $('.qty-seg', sheet).addEventListener('click', (e) => { const b = e.target.closest('[data-q]'); if (b) setQty(b.dataset.q); });
  sheet.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
    form.count.value = Math.max(0, (Number(form.count.value) || 0) + Number(b.dataset.step));
  }));
  $('[data-kind="leftover"]', sheet)?.addEventListener('click', () => {
    const nm = form.name.value;
    closeTop();
    setTimeout(() => openLeftoverSheet(null, { name: nm }), 50);
  });

  attachSuggest(form.name, $('.suggest-box', sheet), productSuggestions, (s) => {
    const p = s.data;
    if (p.storageId && storageById(p.storageId)) form.storageId.value = p.storageId;
    if (p.qtyType) setQty(p.qtyType);
    if (p.unit) form.unit.value = p.unit;
    form.staple.checked = !!p.staple;
  });

  const nutriState = () => {
    const nm = form.name.value.trim();
    const { product, exact } = nutritionProduct(nm);
    const el = $('[data-nutri-state]', sheet);
    const ok = nm && hasNutrition(product);
    el.textContent = !nm ? '' : ok ? (exact ? SOURCE_LABEL[product.nutrition.source] : `fra ${product.name}`) : 'Ikke registrert';
    el.classList.toggle('ok', !!ok);
  };
  nutriState();
  form.name.addEventListener('input', nutriState);
  form.name.addEventListener('change', nutriState);
  unsubNutri = onChange(nutriState);
  $('[data-nutri]', sheet).addEventListener('click', () => {
    const nm = form.name.value.trim();
    if (!nm) { form.name.focus(); toast('Skriv inn navnet på varen først'); return; }
    openNutritionSheet(nm);
  });

  $('[data-del]', sheet)?.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: `Slette ${it.name}?`, ok: 'Slett', danger: true }))) return;
    closeTop();
    usedUpDelete(it);
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = form.name.value.trim();
    if (!name) return;
    const count = Math.max(0, Math.round(Number(form.count.value) || 0));
    const weight = form.weight.value === '' ? null : Number(form.weight.value);
    const staple = form.staple.checked;
    const data = {
      name, storageId: form.storageId.value || null, qtyType, staple,
      count: qtyType === 'count' ? count : (it.count ?? 0),
      weight: qtyType === 'weight' ? weight : (it.weight ?? null),
      unit: form.unit.value, bestBefore: form.bestBefore.value || null,
    };
    if (qtyType !== 'weight') data.lowWeight = false;

    if (isNew) {
      const dup = state.items.find((i) => norm(i.name) === norm(name) && i.storageId === data.storageId);
      if (dup) {
        const patch = { ...data, empty: false, lowWeight: false };
        if (qtyType === 'count' && dup.qtyType === 'count') patch.count = (dup.empty ? 0 : dup.count || 0) + count;
        updateItem(dup, patch);
        toast(`Oppdaterte ${dup.name} som allerede fantes`);
      } else {
        const id = db.newId('items');
        const doc = { ...data, empty: staple && qtyType === 'count' && count === 0, lowWeight: false, addedAt: Date.now(), updatedAt: Date.now() };
        db.set('items', id, doc, false);
        syncAuto({ ...doc, id });
      }
    } else {
      if (qtyType === 'count') data.empty = staple ? count === 0 : false;
      else if (!staple) data.empty = false;
      if (!staple && qtyType === 'count' && count === 0) {
        closeTop();
        usedUp({ ...it, ...data });
        return;
      }
      updateItem(it, data);
    }
    upsertProduct({ name, storageId: data.storageId, qtyType, unit: data.unit, staple });
    closeTop();
  });

  if (isNew && !name) setTimeout(() => form.name.focus(), 280);
}

function usedUpDelete(it) {
  const { id, ...data } = it;
  db.remove('items', id);
  const linked = state.shopping.find((s) => s.itemId === id && !s.checked && (s.reason === 'staple' || s.reason === 'low'));
  if (linked) db.remove('shopping', linked.id);
  toast(`${it.name} er slettet`, [{ label: 'Angre', run: () => { db.set('items', id, data, false); syncAuto(it); } }]);
}

// ---------- Skjema: middagsrest ----------
export function openLeftoverSheet(lo, { name = '' } = {}) {
  const isNew = !lo;
  const l = lo || { name, portions: 2, storageId: defaultFridgeId(), addedAt: Date.now() };
  const body = `
    <form class="form" autocomplete="off">
      <label class="field"><span>Hva slags rester?</span>
        <input name="name" required value="${esc(l.name)}" placeholder="F.eks. Lasagne" enterkeyhint="next">
        <div class="suggest-box" hidden></div>
      </label>
      <div class="field"><span>Porsjoner</span>
        <div class="stepper big">
          <button type="button" data-step="-1">${icon('minus')}</button>
          <input name="portions" type="number" inputmode="numeric" min="1" value="${Number(l.portions) || 1}">
          <button type="button" data-step="1">${icon('plus')}</button>
        </div>
      </div>
      <label class="field"><span>Hvor er restene?</span>
        <select name="storageId">${storageOptions(l.storageId, { allowNone: true })}</select>
      </label>
      <label class="field"><span>Laget dato</span>
        <input name="date" type="date" value="${toDateInput(l.addedAt || Date.now())}" max="${toDateInput(Date.now())}">
      </label>
      <div class="form-actions">
        ${isNew ? '' : `<button type="button" class="btn ghost danger-text" data-del>${icon('trash')}Slett</button>`}
        <button type="submit" class="btn primary grow">${isNew ? 'Legg til' : 'Lagre'}</button>
      </div>
    </form>`;
  const sheet = openSheet({ title: isNew ? 'Middagsrester' : 'Rediger rester', body });
  const form = $('form', sheet);
  sheet.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
    form.portions.value = Math.max(1, (Number(form.portions.value) || 0) + Number(b.dataset.step));
  }));
  attachSuggest(form.name, $('.suggest-box', sheet), (q) => {
    const n = norm(q);
    const names = new Map();
    for (const r of state.recipes) if (r.title) names.set(norm(r.title), r.title);
    for (const x of state.leftovers) names.set(norm(x.name), x.name);
    return [...names].filter(([k]) => k.includes(n) && k !== n).map(([, v]) => ({ value: v, label: v }));
  });
  $('[data-del]', sheet)?.addEventListener('click', () => { closeTop(); leftoverDone(l); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = form.name.value.trim();
    if (!name) return;
    const chosen = parseDate(form.date.value);
    const sameDay = l.addedAt && toDateInput(l.addedAt) === form.date.value;
    const data = {
      name, portions: Math.max(1, Math.round(Number(form.portions.value) || 1)),
      storageId: form.storageId.value || null,
      addedAt: sameDay ? l.addedAt : (chosen ? chosen + 12 * 3600e3 : Date.now()),
    };
    if (isNew) db.set('leftovers', db.newId('leftovers'), data, false);
    else db.update('leftovers', l.id, data);
    closeTop();
  });
  if (isNew && !name) setTimeout(() => form.name.focus(), 280);
}
