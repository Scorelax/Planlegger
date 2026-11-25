// Forretningslogikk: lager ↔ handleliste ↔ oppskrifter.
import { state, db } from './state.js';
import { norm, productId, escRe, toast, fmtNum } from './util.js';

export const DEFAULT_STORAGES = [
  { id: 'kjoleskap', name: 'Kjøleskap', icon: '🥛', order: 0 },
  { id: 'fryser', name: 'Fryser', icon: '❄️', order: 1 },
  { id: 'torrvarer', name: 'Tørrvarer', icon: '🥫', order: 2 },
  { id: 'krydder', name: 'Krydderhylle', icon: '🌶️', order: 3 },
];
export const STORAGE_ICONS = ['🥛', '❄️', '🥫', '🌶️', '🍞', '🥔', '🍎', '🧀', '🍷', '🧺', '🏠', '📦'];
export const WEIGHT_UNITS = ['g', 'kg', 'ml', 'dl', 'l'];

// ---------- Lager ----------
export const sortedStorages = () =>
  [...state.storages].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'no'));
export const storageById = (id) => state.storages.find((s) => s.id === id);
export const storageLabel = (id) => {
  const s = storageById(id);
  return s ? `${s.icon || ''} ${s.name}`.trim() : '';
};
export const isFreezer = (id) => /frys|frost/i.test(storageById(id)?.name || '');
export const defaultFridgeId = () => {
  const list = sortedStorages();
  return (list.find((s) => /kjøl/i.test(s.name)) || list.find((s) => !isFreezer(s.id)) || list[0])?.id || null;
};

export function seedDefaultStorages() {
  db.batch(DEFAULT_STORAGES.map(({ id, ...data }) => ({ type: 'set', col: 'storages', id, data, merge: true })));
}

export function storageOptions(selected, { allowNone = false } = {}) {
  const opts = sortedStorages().map((s) =>
    `<option value="${s.id}" ${s.id === selected ? 'selected' : ''}>${s.icon || ''} ${s.name}</option>`);
  if (allowNone) opts.unshift(`<option value="" ${!selected ? 'selected' : ''}>Ingen lager</option>`);
  return opts.join('');
}

// ---------- Varedatabase ----------
export const findProduct = (name) => {
  const n = norm(name);
  return state.products.find((p) => p.nameLower === n) || null;
};

export function upsertProduct(p) {
  if (!p?.name?.trim()) return;
  const data = { name: p.name.trim(), nameLower: norm(p.name), updatedAt: Date.now() };
  for (const k of ['storageId', 'qtyType', 'unit', 'staple']) {
    if (p[k] !== undefined && p[k] !== null && p[k] !== '') data[k] = p[k];
  }
  db.set('products', productId(p.name), data, true);
}

// ---------- Strekkoder ----------
export const productByBarcode = (code) => state.products.find((p) => p.barcodes?.includes(code)) || null;

// Knytter en strekkode til en vare i varedatabasen (og tar den bort fra andre varer).
// extra: f.eks. { packWeight, packUnit } – pakningsvekt som foreslås neste gang.
export function linkBarcode(name, code, extra = {}) {
  if (!code || !name?.trim()) return;
  const id = productId(name);
  for (const p of state.products) {
    if (p.id !== id && p.barcodes?.includes(code)) {
      db.update('products', p.id, { barcodes: p.barcodes.filter((c) => c !== code) });
    }
  }
  const own = state.products.find((p) => p.id === id);
  const barcodes = [...new Set([...(own?.barcodes || []), code])];
  db.set('products', id, { ...extra, name: name.trim(), nameLower: norm(name), barcodes, updatedAt: Date.now() }, true);
}

// Summerer to vekter/volum med ulik enhet. Svaret er i enheten til den første, eller null om de ikke passer sammen.
const UNIT_BASE = { g: ['m', 1], kg: ['m', 1000], ml: ['v', 1], cl: ['v', 10], dl: ['v', 100], l: ['v', 1000] };
export function addWeight(a, aUnit, b, bUnit) {
  const ua = UNIT_BASE[aUnit || 'g'], ub = UNIT_BASE[bUnit || 'g'];
  if (a == null || a === '' || !ua || !ub || ua[0] !== ub[0]) return null;
  const sum = Number(a) * ua[1] + Number(b) * ub[1];
  return Math.round((sum / ua[1]) * 1000) / 1000;
}

// Legger en vare på lager med valgt mengde. Finnes den fra før i samme lager, legges mengden til.
export function stockItem({ name, storageId, qtyType = 'none', count = 1, weight = null, unit = 'g' }) {
  name = name.trim();
  if (qtyType === 'weight' && !weight) qtyType = 'none';
  const now = Date.now();
  const dup = state.items.find((i) => norm(i.name) === norm(name) && i.storageId === storageId);
  if (dup) {
    const patch = { empty: false, lowWeight: false };
    if (qtyType === 'count') {
      Object.assign(patch, { qtyType, count: (dup.qtyType === 'count' && !dup.empty ? Number(dup.count) || 0 : 0) + count });
    } else if (qtyType === 'weight') {
      const fresh = dup.qtyType === 'weight' && !dup.empty && !dup.lowWeight;
      const sum = fresh ? addWeight(dup.weight, dup.unit, weight, unit) : null;
      Object.assign(patch, sum != null ? { qtyType, weight: sum, unit: dup.unit || 'g' } : { qtyType, weight, unit });
    }
    return { item: updateItem(dup, patch), added: false };
  }
  const prod = findProduct(name);
  const id = db.newId('items');
  const doc = {
    name, storageId, qtyType, staple: !!prod?.staple,
    count: qtyType === 'count' ? count : 0,
    weight: qtyType === 'weight' ? weight : null,
    unit, bestBefore: null, empty: false, lowWeight: false, addedAt: now, updatedAt: now,
  };
  db.set('items', id, doc, false);
  syncAuto({ ...doc, id });
  return { item: { ...doc, id }, added: true };
}

// Forslag til autofullføring fra varedatabasen + lager.
export function productSuggestions(q) {
  const n = norm(q);
  if (!n) return [];
  const map = new Map();
  for (const p of state.products) map.set(p.nameLower, { name: p.name, storageId: p.storageId, staple: p.staple, qtyType: p.qtyType, unit: p.unit });
  for (const i of state.items) {
    const k = norm(i.name);
    map.set(k, { ...(map.get(k) || {}), name: i.name, storageId: i.storageId, staple: !!i.staple, qtyType: i.qtyType, unit: i.unit });
  }
  const res = [];
  for (const [k, p] of map) {
    if (k === n || !k.includes(n)) continue;
    const rank = k.startsWith(n) ? 0 : 1;
    const sub = [storageLabel(p.storageId), p.staple ? 'Basisvare' : ''].filter(Boolean).join(' · ');
    res.push({ rank, value: p.name, label: p.name, sub, data: p });
  }
  return res.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, 'no'));
}

// ---------- Lager ↔ handleliste ----------
// En vare skal på handlelisten når den er en tom basisvare, eller når "under halvparten igjen" er huket av.
export const needsRestock = (it) => !!((it.staple && it.empty) || (it.qtyType === 'weight' && it.lowWeight));

export function syncAuto(item) {
  const autoId = 'auto_' + item.id;
  const linked = state.shopping.find((s) => s.id === autoId || s.itemId === item.id);
  if (needsRestock(item)) {
    const base = {
      name: item.name, storageId: item.storageId || null, staple: !!item.staple,
      itemId: item.id, reason: item.staple && item.empty ? 'staple' : 'low',
    };
    if (linked) { db.update('shopping', linked.id, base); return; }
    const manual = state.shopping.find((s) => !s.checked && !s.itemId && norm(s.name) === norm(item.name));
    if (manual) { db.update('shopping', manual.id, base); return; }
    db.set('shopping', autoId, { ...base, amount: '', checked: false, addedAt: Date.now() }, false);
  } else if (linked && !linked.checked && (linked.reason === 'staple' || linked.reason === 'low')) {
    db.remove('shopping', linked.id);
  }
}

export function updateItem(item, patch) {
  const updatedAt = Date.now();
  const merged = { ...item, ...patch, updatedAt };
  db.update('items', item.id, { ...patch, updatedAt });
  syncAuto(merged);
  return merged;
}

const withoutId = ({ id, ...rest }) => rest;

export function setCount(item, n) {
  n = Math.max(0, Math.round(Number(n) || 0));
  if (n === 0 && !item.staple) return usedUp(item);
  updateItem(item, { count: n, empty: item.staple ? n === 0 : false });
  if (n === 0 && item.staple) toast(`${item.name} er tom – lagt på handlelisten`);
}

export function usedUp(item) {
  if (item.staple) {
    updateItem(item, { empty: true, lowWeight: false, count: 0 });
    toast(`${item.name} er tom – lagt på handlelisten`, [
      { label: 'Angre', run: () => updateItem({ ...item, empty: true }, { empty: !!item.empty, lowWeight: !!item.lowWeight, count: item.count ?? 0 }) },
    ]);
    return;
  }
  db.remove('items', item.id);
  toast(`${item.name} er fjernet`, [
    { label: 'Angre', run: () => db.set('items', item.id, withoutId(item), false) },
    { label: '+ Handleliste', run: () => { addToShopping({ name: item.name, storageId: item.storageId }); toast(`${item.name} lagt på handlelisten`); } },
  ]);
}

export function refill(item) {
  const patch = { empty: false, lowWeight: false };
  if (item.qtyType === 'count') patch.count = Math.max(1, item.count || 0);
  updateItem(item, patch);
}

export function addToShopping({ name, amount = '', storageId = null, reason = 'manual' }) {
  name = (name || '').trim();
  if (!name) return { ok: false };
  const n = norm(name);
  const existing = state.shopping.find((s) => !s.checked && norm(s.name) === n);
  if (existing) {
    if (amount && !existing.amount) db.update('shopping', existing.id, { amount });
    return { ok: false, existing };
  }
  const stapleItem = state.items.find((i) => i.staple && norm(i.name) === n);
  const prod = findProduct(name);
  const entry = {
    name, amount: amount || '', checked: false, addedAt: Date.now(), reason,
    staple: !!(stapleItem || prod?.staple),
    storageId: stapleItem?.storageId || storageId || prod?.storageId || null,
    itemId: stapleItem?.id || null,
  };
  const autoFree = stapleItem && !state.shopping.some((s) => s.id === 'auto_' + stapleItem.id);
  const id = autoFree ? 'auto_' + stapleItem.id : db.newId('shopping');
  db.set('shopping', id, entry, false);
  upsertProduct({ name, storageId: entry.storageId });
  return { ok: true, id };
}

// "2 stk", "500 g", "1,5 l" -> { type, value, unit }
const W_UNITS = { g: 'g', gr: 'g', gram: 'g', kg: 'kg', kilo: 'kg', ml: 'ml', cl: 'cl', dl: 'dl', l: 'l', liter: 'l' };
const C_UNITS = ['', 'x', 'stk', 'stykk', 'pk', 'pakke', 'pakker', 'boks', 'bokser', 'flaske', 'flasker', 'pose', 'poser', 'glass', 'beger', 'brett', 'hode', 'fedd', 'bunt', 'nett'];
export function parseAmount(str) {
  const m = String(str || '').trim().toLowerCase().match(/^(\d+(?:[.,]\d+)?)\s*([a-zæøå]*)\.?/);
  if (!m) return null;
  const value = parseFloat(m[1].replace(',', '.'));
  if (!value) return null;
  if (W_UNITS[m[2]]) return { type: 'weight', value, unit: W_UNITS[m[2]] };
  if (C_UNITS.includes(m[2])) return { type: 'count', value: Math.max(1, Math.round(value)) };
  return null;
}

export function finishShopping() {
  const checked = state.shopping.filter((s) => s.checked);
  const ops = [];
  const touched = new Map();
  let stocked = 0, noStorage = 0;
  const now = Date.now();

  for (const s of checked) {
    ops.push({ type: 'delete', col: 'shopping', id: s.id });
    const amt = parseAmount(s.amount);
    const pool = [...touched.values(), ...state.items.filter((i) => !touched.has(i.id))];
    let item = (s.itemId && pool.find((i) => i.id === s.itemId)) ||
      pool.find((i) => norm(i.name) === norm(s.name) && (!s.storageId || i.storageId === s.storageId));

    if (item) {
      const patch = { empty: false, lowWeight: false, updatedAt: now };
      if (item.qtyType === 'count') {
        patch.count = (item.empty ? 0 : (item.count || 0)) + (amt?.type === 'count' ? amt.value : 1);
      } else if (item.qtyType === 'weight') {
        if (amt?.type === 'weight') { patch.weight = amt.value; patch.unit = amt.unit; }
      } else if (amt) {
        Object.assign(patch, amt.type === 'count'
          ? { qtyType: 'count', count: amt.value }
          : { qtyType: 'weight', weight: amt.value, unit: amt.unit });
      }
      if (s.storageId && !item.storageId) patch.storageId = s.storageId;
      touched.set(item.id, { ...item, ...patch, _patch: { ...(touched.get(item.id)?._patch || {}), ...patch } });
      stocked++;
    } else if (s.storageId) {
      const prod = findProduct(s.name);
      const id = db.newId('items');
      const qtyType = amt?.type || prod?.qtyType || 'none';
      const it = {
        id, _new: true, name: s.name, storageId: s.storageId, staple: !!(s.staple || prod?.staple),
        empty: false, lowWeight: false, addedAt: now, updatedAt: now, qtyType,
        count: amt?.type === 'count' ? amt.value : (qtyType === 'count' ? 1 : 0),
        weight: amt?.type === 'weight' ? amt.value : null,
        unit: amt?.type === 'weight' ? amt.unit : (prod?.unit || 'g'),
      };
      touched.set(id, it);
      stocked++;
    } else {
      noStorage++;
    }
  }

  for (const [id, it] of touched) {
    if (it._new) {
      const { _new, id: _id, _patch, ...data } = it;
      ops.push({ type: 'set', col: 'items', id, data, merge: false });
      upsertProduct({ name: data.name, storageId: data.storageId, qtyType: data.qtyType, unit: data.unit, staple: data.staple });
    } else {
      ops.push({ type: 'update', col: 'items', id, data: it._patch });
    }
  }
  db.batch(ops);
  return { stocked, noStorage, total: checked.length };
}

// ---------- Oppskrifter ----------
const wordIn = (needle, hay) =>
  needle.length >= 3 && new RegExp(`(^|[^a-zæøå])${escRe(needle)}[a-zæøå]{0,3}($|[^a-zæøå])`).test(hay);

// Finner en vare på lager som matcher en ingrediens (eksakt navn, helt ord, eller sammensatt ord: "hvetemel" ⇒ "mel").
export function matchItem(ingName) {
  const n = norm(ingName);
  if (!n) return null;
  const avail = state.items.filter((i) => !i.empty);
  return avail.find((i) => norm(i.name) === n) ||
    avail.find((i) => {
      const m = norm(i.name);
      return wordIn(m, n) || wordIn(n, m) || (n.length >= 3 && m.endsWith(n));
    }) || null;
}

export const onShoppingList = (name) => {
  const n = norm(name);
  return state.shopping.some((s) => !s.checked && norm(s.name) === n);
};

export function coverage(recipe) {
  const ings = (recipe.ingredients || []).filter((i) => i.name?.trim());
  const missing = ings.filter((i) => !matchItem(i.name));
  return { total: ings.length, have: ings.length - missing.length, missing };
}

export function addMissingToShopping(recipe) {
  const { missing } = coverage(recipe);
  let added = 0;
  for (const ing of missing) {
    if (addToShopping({ name: ing.name, amount: ing.amount || '', reason: 'recipe' }).ok) added++;
  }
  return added;
}

export const fmtWeight = (it) => (it.weight != null && it.weight !== '' ? `${fmtNum(Number(it.weight))} ${it.unit || 'g'}` : '');
