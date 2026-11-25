// Næringsinnhold: lagres på varen i varedatabasen (products) og brukes i oppskrifter.
// Kilder: Open Food Facts (strekkode), Matvaretabellen (Mattilsynet) eller egne tall.
//
// product.nutrition = { per: 'g'|'ml', kcal, fat, satFat, carbs, sugars, fiber, protein, salt,
//                       source: 'off'|'mvt'|'manual', ref, refName }   – verdier per 100 g / 100 ml
// product.portions  = { dl, stk, ss, ts, pk, ... } – hvor mye én enhet er, i g (eller ml når per = 'ml')
import { state, db } from './state.js';
import { norm, productId, fmtNum } from './util.js';
import { wordIn } from './logic.js';

export const NUTRIENTS = [
  { key: 'kcal', label: 'Energi', unit: 'kcal' },
  { key: 'fat', label: 'Fett', unit: 'g' },
  { key: 'satFat', label: 'hvorav mettede fettsyrer', unit: 'g', sub: true },
  { key: 'carbs', label: 'Karbohydrater', unit: 'g' },
  { key: 'sugars', label: 'hvorav sukkerarter', unit: 'g', sub: true },
  { key: 'fiber', label: 'Kostfiber', unit: 'g' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'salt', label: 'Salt', unit: 'g' },
];
const KEYS = NUTRIENTS.map((n) => n.key);
export const PORTION_KEYS = ['dl', 'stk', 'ss', 'ts', 'pk', 'boks', 'pose', 'glass', 'beger', 'skive', 'fedd', 'neve', 'bunt', 'kopp'];
export const SOURCE_LABEL = { off: 'Open Food Facts', mvt: 'Matvaretabellen', manual: 'Egne tall' };

const toNum = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

// Alle nøkler skrives alltid (null når ukjent), så en lagring erstatter gamle verdier helt.
export function makeNutrition(src) {
  const n = { per: src.per === 'ml' ? 'ml' : 'g', source: src.source || 'manual', ref: src.ref ?? null, refName: src.refName ?? null };
  for (const k of KEYS) n[k] = toNum(src[k]);
  return n;
}
export function makePortions(src = {}) {
  const p = {};
  for (const k of PORTION_KEYS) { const v = toNum(src[k]); p[k] = v && v > 0 ? v : null; }
  return p;
}

export const hasNutrition = (p) => p?.nutrition?.kcal != null;

export function saveNutrition(name, nutrition, portions) {
  if (!name?.trim()) return;
  const data = { name: name.trim(), nameLower: norm(name), nutrition: makeNutrition(nutrition), updatedAt: Date.now() };
  if (portions) data.portions = makePortions(portions);
  db.set('products', productId(name), data, true);
}
export function removeNutrition(name) {
  db.set('products', productId(name), { name: name.trim(), nameLower: norm(name), nutrition: null, updatedAt: Date.now() }, true);
}

// Varen som gir næring for en ingrediens: eksakt navn først, ellers en vare med næring som ligner (melk ⇒ Lettmelk).
export function nutritionProduct(name) {
  const n = norm(name);
  if (!n) return { product: null, exact: false };
  const exact = state.products.find((p) => p.nameLower === n) || null;
  if (hasNutrition(exact)) return { product: exact, exact: true };
  const fuzzy = state.products.filter(hasNutrition).find((p) =>
    wordIn(p.nameLower, n) || wordIn(n, p.nameLower) || (n.length >= 3 && p.nameLower.endsWith(n)));
  return fuzzy ? { product: fuzzy, exact: false } : { product: exact, exact: false };
}

// ---------- Mengder ----------
const MASS = { mg: 0.001, g: 1, gr: 1, gram: 1, kg: 1000, kilo: 1000 };
const VOL = { ml: 1, cl: 10, dl: 100, l: 1000, liter: 1000, ss: 15, ts: 5, krm: 1 };
const PIECE = {
  '': 'stk', stk: 'stk', stykk: 'stk', hode: 'stk', pk: 'pk', pakke: 'pk', pakker: 'pk', boks: 'boks', bokser: 'boks',
  fedd: 'fedd', skive: 'skive', skiver: 'skive', glass: 'glass', beger: 'beger', neve: 'neve', never: 'neve',
  bunt: 'bunt', pose: 'pose', poser: 'pose', kopp: 'kopp', kopper: 'kopp',
  stor: 'stk', store: 'stk', liten: 'stk', små: 'stk', lita: 'stk', middels: 'stk',
};
const FRAC = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };
export const PIECE_LABEL = { stk: 'stk', pk: 'pakke', boks: 'boks', fedd: 'fedd', skive: 'skive', glass: 'glass', beger: 'beger', neve: 'neve', bunt: 'bunt', pose: 'pose', kopp: 'kopp' };

// "2-3 dl", "1/2 ts", "1,5 kg", "½ boks", "ca. 400 g" -> { value, unit }
export function parseQty(str) {
  let s = String(str || '').toLowerCase().trim().replace(/^(ca\.?|cirka|omtrent)\s*/, '');
  const m = s.match(/^(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?|[½¼¾⅓⅔])(?:\s*-\s*(\d+(?:[.,]\d+)?))?\s*([a-zæøå]*)\.?/);
  if (!m) return null;
  let v;
  if (FRAC[m[1]]) v = FRAC[m[1]];
  else if (m[1].includes('/')) { const [a, b] = m[1].split('/').map(Number); v = b ? a / b : NaN; }
  else v = parseFloat(m[1].replace(',', '.'));
  if (m[2]) v = (v + parseFloat(m[2].replace(',', '.'))) / 2;
  return Number.isFinite(v) && v > 0 ? { value: v, unit: m[3] } : null;
}

// Mengde -> antall g (eller ml) i varens enhet. { amount, assumed } eller { error }
export function toBase(qty, product) {
  const per = product.nutrition.per;
  const pr = product.portions || {};
  const u = qty.unit;
  const density = pr.dl ? pr.dl / 100 : null; // g per ml
  if (MASS[u]) {
    const g = qty.value * MASS[u];
    if (per === 'g') return { amount: g };
    return density ? { amount: g / density } : { amount: g, assumed: '1 g ≈ 1 ml' };
  }
  if (VOL[u]) {
    if ((u === 'ss' || u === 'ts') && pr[u]) return { amount: qty.value * pr[u] };
    const ml = qty.value * VOL[u];
    if (per === 'ml') return { amount: ml };
    return density ? { amount: ml * density } : { amount: ml, assumed: '1 dl ≈ 100 g' };
  }
  if (u === 'klype') return { amount: qty.value * 0.5 };
  const key = PIECE[u];
  if (key === undefined) return { error: 'unit' };
  let w = pr[key];
  if (!w && key === 'pk' && product.packWeight) w = product.packWeight * (product.packUnit === 'kg' || product.packUnit === 'l' ? 1000 : 1);
  return w ? { amount: qty.value * w } : { error: 'piece', piece: key };
}

// Næring for én ingrediens i en oppskrift.
// status: ok | none (ingen næring registrert) | noamount (mangler mengde) | piece/unit (kan ikke regne om)
export function ingredientNutrition(ing) {
  const { product, exact } = nutritionProduct(ing.name);
  if (!hasNutrition(product)) return { status: 'none', product };
  const qty = parseQty(ing.amount);
  if (!qty) return { status: 'noamount', product, exact };
  const base = toBase(qty, product);
  if (base.error) return { status: base.error, piece: base.piece, product, exact };
  const f = base.amount / 100;
  const values = {};
  for (const k of KEYS) values[k] = product.nutrition[k] == null ? null : product.nutrition[k] * f;
  return { status: 'ok', product, exact, amount: base.amount, assumed: base.assumed, values };
}

export function recipeNutrition(recipe) {
  const ings = (recipe.ingredients || []).filter((i) => i.name?.trim());
  const totals = Object.fromEntries(KEYS.map((k) => [k, 0]));
  const res = { totals, total: ings.length, counted: 0, rows: [], missing: [], unconvertible: [], noAmount: [], assumed: [] };
  for (const ing of ings) {
    const r = ingredientNutrition(ing);
    res.rows.push({ ing, ...r });
    if (r.status === 'ok') {
      res.counted++;
      for (const k of KEYS) totals[k] += r.values[k] || 0;
      if (r.assumed) res.assumed.push(ing.name);
    } else if (r.status === 'none') res.missing.push(ing.name);
    else if (r.status === 'noamount') res.noAmount.push(ing.name);
    else res.unconvertible.push(ing.name);
  }
  return res;
}

export function fmtNutrient(v, unit) {
  if (v == null) return '–';
  if (unit === 'kcal') return `${Math.round(v)} kcal`;
  const r = v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
  return `${fmtNum(r)} g`;
}

// ---------- Open Food Facts ----------
export const OFF_FIELDS = 'nutriments,nutrition_data_per,product_quantity,product_quantity_unit';
export function nutritionFromOff(p, code) {
  const n = p?.nutriments || {};
  const v = (k) => toNum(n[`${k}_100g`]);
  let kcal = v('energy-kcal');
  if (kcal == null && v('energy') != null) kcal = Math.round(v('energy') / 4.184);
  if (kcal == null) return null;
  const per = /^(ml|cl|dl|l)$/i.test(p.product_quantity_unit || '') ? 'ml' : 'g';
  const nutrition = makeNutrition({
    per, kcal, fat: v('fat'), satFat: v('saturated-fat'), carbs: v('carbohydrates'), sugars: v('sugars'),
    fiber: v('fiber'), protein: v('proteins'), salt: v('salt'), source: 'off', ref: code, refName: p.product_name || null,
  });
  const q = toNum(p.product_quantity);
  const unitMul = { g: 1, kg: 1000, ml: 1, cl: 10, dl: 100, l: 1000 }[String(p.product_quantity_unit || '').toLowerCase()];
  return { nutrition, portions: q && unitMul ? { pk: q * unitMul } : null };
}

export async function fetchOffNutrition(code) {
  if (!navigator.onLine) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 7000);
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,${OFF_FIELDS}`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const j = await res.json();
    return j.status === 1 ? nutritionFromOff(j.product, code) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ---------- Matvaretabellen ----------
let mvtPromise = null;
export function loadMvt() {
  mvtPromise ||= fetch('data/matvaretabellen.json')
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((d) => d.foods.map(([id, name, keywords, kcal, fat, satFat, carbs, sugars, fiber, protein, salt, portions]) => ({
      id, name, keywords, portions, n: { kcal, fat, satFat, carbs, sugars, fiber, protein, salt },
      lower: norm(name), first: norm(name.split(',')[0]), kw: keywords.map(norm),
    })));
  mvtPromise.catch(() => { mvtPromise = null; });
  return mvtPromise;
}

// Søk: «løk» gir «Løk, gul, norsk, rå» først, «egg» gir «Egg, rå».
export function searchMvt(foods, q, limit = 8) {
  const n = norm(q);
  if (!n) return [];
  const words = n.split(' ').filter(Boolean);
  const squashed = n.replace(/[^a-zæøå]/g, '');
  const scored = [];
  for (const f of foods) {
    let s = 0;
    if (f.first === n) s += 100;
    else if (f.kw.includes(n)) s += 50;
    else if (wordIn(n, f.lower)) s += 45;
    else if (f.lower.replace(/[^a-zæøå]/g, '').startsWith(squashed)) s += 40; // «kyllingfilet» ⇒ «Kylling, filet, …»
    else if (f.lower.startsWith(n)) s += 30;
    else if (words.every((w) => f.lower.includes(w))) s += 15;
    else if (f.first.length >= 3 && n.endsWith(f.first)) s += 20; // «hvetemel» ⇒ «Mel, …»
    else continue;
    if (/, (rå|tørr)(?![a-zæøå])/.test(f.lower)) s += 10;
    if (/(kokt|stekt|bakt|grillet)(?![a-zæøå])/.test(f.lower)) s -= 4;
    if (/uspesifisert/.test(f.lower)) s += 6;
    if (/norsk/.test(f.lower)) s += 2;
    s -= f.name.length / 12;
    scored.push([s, f]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map(([, f]) => f);
}

export function nutritionFromMvt(f) {
  return {
    nutrition: makeNutrition({ ...f.n, per: 'g', source: 'mvt', ref: f.id, refName: f.name }),
    portions: f.portions,
  };
}
