// Skjermbilder for næringsinnhold: se, hente fra Matvaretabellen / strekkode, eller skrive inn selv.
import { state, onChange } from '../state.js';
import { esc, norm, icon, toast, openSheet, closeTop, fmtNum, $ } from '../util.js';
import { scanBarcode } from '../scanner.js';
import {
  NUTRIENTS, SOURCE_LABEL, PIECE_LABEL, hasNutrition, nutritionProduct, ingredientNutrition, recipeNutrition,
  saveNutrition, removeNutrition, fmtNutrient, fetchOffNutrition, loadMvt, searchMvt, nutritionFromMvt,
} from '../nutrition.js';

// Rekkefølge i skjemaet (to kolonner): «hvorav»-feltene står ved siden av sitt hovedfelt.
const FORM_ORDER = ['kcal', 'protein', 'fat', 'satFat', 'carbs', 'sugars', 'fiber', 'salt'];
const MVT_NOTE = 'Tall fra Matvaretabellen, Mattilsynet (matvaretabellen.no)';
const exactProduct = (name) => state.products.find((p) => p.nameLower === norm(name)) || null;

// ---------- Små byggeklosser ----------
export function nutritionTable(values, { head = '' } = {}) {
  return `<table class="nutri-table">
    ${head ? `<thead><tr><th></th><th>${esc(head)}</th></tr></thead>` : ''}
    <tbody>${NUTRIENTS.map((n) => `<tr class="${n.sub ? 'sub' : ''}${n.key === 'kcal' ? ' kcal' : ''}">
      <td>${esc(n.label)}</td><td>${esc(fmtNutrient(values[n.key], n.unit))}</td></tr>`).join('')}</tbody>
  </table>`;
}

const portionsText = (p) => {
  const per = p.nutrition?.per === 'ml' ? 'ml' : 'g';
  const parts = [];
  if (p.portions?.dl && per === 'g') parts.push(`1 dl ≈ ${fmtNum(p.portions.dl)} g`);
  for (const [k, label] of Object.entries(PIECE_LABEL)) {
    if (p.portions?.[k]) parts.push(`1 ${label} ≈ ${fmtNum(p.portions[k])} ${per}`);
  }
  if (p.portions?.ss) parts.push(`1 ss ≈ ${fmtNum(p.portions.ss)} ${per}`);
  return parts.join(' · ');
};

const sourceText = (n) => {
  if (!n) return '';
  const label = SOURCE_LABEL[n.source] || 'Ukjent kilde';
  if (n.source === 'mvt') return `${label} – «${n.refName}»`;
  if (n.source === 'off') return `${label}${n.refName ? ` – ${n.refName}` : ''} (strekkode ${n.ref})`;
  return label;
};

// Merke ved hver ingrediens: kcal når alt er på plass, ellers hva som mangler.
export function ingredientBadge(ing, idx) {
  const r = ingredientNutrition(ing);
  let cls, text;
  if (r.status === 'ok') { cls = 'ok'; text = `${r.assumed ? '≈ ' : ''}${Math.round(r.values.kcal || 0)} kcal`; }
  else if (r.status === 'none') { cls = 'none'; text = 'Næring'; }
  else { cls = 'warn'; text = '? kcal'; }
  const title = r.status === 'none' ? 'Legg inn næringsinnhold' : 'Vis næringsinnhold';
  return `<button type="button" class="nutri-badge ${cls}" data-act="nutri" data-idx="${idx}" aria-label="${title}">
    ${r.status === 'none' ? icon('plus') : icon('leaf')}<span>${esc(text)}</span></button>`;
}

// Panelet i oppskriften: totalt eller per porsjon, og hva som mangler.
export function recipeNutritionPanel(recipe, mode) {
  const res = recipeNutrition(recipe);
  const servings = Number(recipe.servings) || 0;
  const perPortion = mode !== 'total' && servings > 1;
  const div = perPortion ? servings : 1;
  const values = Object.fromEntries(Object.entries(res.totals).map(([k, v]) => [k, v / div]));
  const list = (names) => esc(names.join(', '));
  const notes = [];
  if (res.missing.length) {
    notes.push(`<div class="nutri-missing"><span>Mangler næringsinnhold: <b>${list(res.missing)}</b></span>
      <button type="button" class="btn secondary sm" data-act="nutri-auto">${icon('search')}Finn i Matvaretabellen</button></div>`);
  }
  if (res.unconvertible.length) notes.push(`<p>Vet ikke hvor mye mengden veier for: <b>${list(res.unconvertible)}</b>. Trykk på ingrediensen for å legge inn vekt per stk.</p>`);
  if (res.noAmount.length) notes.push(`<p>Uten mengde (ikke regnet med): ${list(res.noAmount)}</p>`);
  if (res.assumed.length) notes.push(`<p>Antatt 1 dl ≈ 100 g for: ${list(res.assumed)}</p>`);
  return `
    <div class="nutri-panel card">
      ${servings > 1 ? `<div class="seg nutri-seg">
        <button type="button" class="seg-btn ${perPortion ? 'active' : ''}" data-act="nutri-mode" data-mode="portion">Per porsjon</button>
        <button type="button" class="seg-btn ${perPortion ? '' : 'active'}" data-act="nutri-mode" data-mode="total">Hele oppskriften</button>
      </div>` : ''}
      ${res.counted ? nutritionTable(values, { head: perPortion ? `1 av ${servings} porsjoner` : 'Hele oppskriften' })
        : '<p class="hint">Ingen ingredienser har næringsinnhold ennå. Trykk på «Næring» ved en ingrediens for å legge det inn.</p>'}
      <p class="nutri-count ${res.counted === res.total ? 'full' : ''}">${icon(res.counted === res.total ? 'check' : 'leaf')}Beregnet for ${res.counted} av ${res.total} ingredienser</p>
      ${notes.length ? `<div class="nutri-notes">${notes.join('')}</div>` : ''}
      <p class="hint small">Omtrentlige verdier. Kilder: Open Food Facts, Matvaretabellen (Mattilsynet) og egne tall.</p>
    </div>`;
}

// ---------- Ark: næringsinnhold for én vare/ingrediens ----------
// name: varens/ingrediensens navn. amount: mengde i oppskriften (valgfritt), for å vise hva den utgjør.
export function openNutritionSheet(name, { amount = '' } = {}) {
  name = name.trim();
  let mode = hasNutrition(nutritionProduct(name).product) ? 'view' : 'pick';
  let unsub = null;
  const sheet = openSheet({
    title: 'Næringsinnhold',
    body: `<div class="nutri-head"><b>${esc(name)}</b>${amount ? `<span class="tag soft">${esc(amount)}</span>` : ''}</div><div data-nbody></div>`,
    onClose: () => unsub?.(),
  });
  const bodyEl = $('[data-nbody]', sheet);
  const go = (m) => { mode = m; render(); };
  // Etter lagring: vent litt så databasen rekker å oppdatere tilstanden.
  const savedThen = (msg) => { toast(msg); setTimeout(() => go('view'), 60); };
  unsub = onChange(() => { if (mode === 'view') render(); });

  function render() {
    if (mode === 'view') renderView();
    else if (mode === 'edit') renderEdit();
    else renderPick();
  }

  function renderView() {
    const { product: p, exact } = nutritionProduct(name);
    if (!hasNutrition(p)) { go('pick'); return; }
    const n = p.nutrition;
    let used = '';
    if (amount) {
      const r = ingredientNutrition({ name, amount });
      if (r.status === 'ok') {
        used = `<div class="nutri-used">${icon('leaf')}<div><b>${esc(amount)} ≈ ${fmtNum(Math.round(r.amount))} ${n.per}</b>
          <small>${Math.round(r.values.kcal || 0)} kcal · ${esc(fmtNutrient(r.values.protein, 'g'))} protein${r.assumed ? ` · antatt ${esc(r.assumed)}` : ''}</small></div></div>`;
      } else if (r.status === 'piece' || r.status === 'unit') {
        const what = r.piece ? `1 ${PIECE_LABEL[r.piece] || r.piece}` : `«${amount}»`;
        used = `<div class="nutri-used warn">${icon('leaf')}<div><b>Vet ikke hvor mye ${esc(what)} veier</b><small>Trykk «Endre» og fyll inn vekt per stk/pakke.</small></div></div>`;
      } else if (r.status === 'noamount') {
        used = `<div class="nutri-used warn">${icon('leaf')}<div><b>Mangler mengde i oppskriften</b><small>Skriv f.eks. «3 dl» eller «2 stk» på ingrediensen.</small></div></div>`;
      }
    }
    const pt = portionsText(p);
    bodyEl.innerHTML = `
      ${exact ? '' : `<p class="hint">Bruker næringsinnholdet til «${esc(p.name)}».</p>`}
      <p class="nutri-src">Kilde: ${esc(sourceText(n))}</p>
      ${used}
      ${nutritionTable(n, { head: `Per 100 ${n.per}` })}
      ${pt ? `<p class="hint small">${esc(pt)}</p>` : ''}
      <div class="form-actions">
        <button type="button" class="btn ghost grow" data-a="pick">${icon('search')}${exact ? 'Bytt kilde' : 'Velg egen'}</button>
        <button type="button" class="btn ghost grow" data-a="edit">${icon('edit')}Endre</button>
      </div>`;
  }

  async function renderPick() {
    const own = exactProduct(name);
    bodyEl.innerHTML = `
      ${hasNutrition(nutritionProduct(name).product) ? '' : '<p class="hint">Ingen næringsinnhold registrert ennå. Velg en matvare fra Matvaretabellen, skann strekkoden eller skriv inn tallene selv.</p>'}
      <label class="search">${icon('search')}<input data-q type="search" value="${esc(name)}" placeholder="Søk i Matvaretabellen…" autocomplete="off" enterkeyhint="search"></label>
      <div class="nutri-results" data-res><p class="hint">Laster Matvaretabellen…</p></div>
      <p class="hint small">${MVT_NOTE}</p>
      <div class="form-actions">
        <button type="button" class="btn ghost grow" data-a="scan">${icon('barcode')}Skann</button>
        ${own?.barcodes?.length ? `<button type="button" class="btn ghost grow" data-a="off">${icon('download')}Fra strekkode</button>` : ''}
        <button type="button" class="btn ghost grow" data-a="edit">${icon('edit')}Skriv inn</button>
      </div>
      ${hasNutrition(nutritionProduct(name).product) ? `<button type="button" class="link-btn center-btn" data-a="view">Avbryt</button>` : ''}`;
    const input = $('[data-q]', bodyEl);
    const resEl = $('[data-res]', bodyEl);
    let foods;
    try { foods = await loadMvt(); } catch { resEl.innerHTML = '<p class="hint">Kunne ikke laste Matvaretabellen. Sjekk nettet.</p>'; return; }
    let hits = [];
    const show = () => {
      hits = searchMvt(foods, input.value, 8);
      resEl.innerHTML = hits.length ? hits.map((f, i) => {
        const pt = Object.entries(f.portions).filter(([k]) => ['stk', 'dl'].includes(k)).map(([k, v]) => `1 ${k} ≈ ${fmtNum(v)} g`).join(' · ');
        return `<button type="button" class="nutri-hit" data-i="${i}"><span>${esc(f.name)}</span>
          <small>${Math.round(f.n.kcal)} kcal · ${esc(fmtNutrient(f.n.protein, 'g'))} protein per 100 g${pt ? ` · ${esc(pt)}` : ''}</small></button>`;
      }).join('') : '<p class="hint">Ingen treff. Prøv et annet ord, f.eks. «løk» eller «hvetemel».</p>';
    };
    input.addEventListener('input', show);
    resEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      const f = hits[b.dataset.i];
      const { nutrition, portions } = nutritionFromMvt(f);
      saveNutrition(name, nutrition, portions);
      savedThen(`Næringsinnhold fra «${f.name}» lagt til`);
    });
    show();
  }

  function renderEdit() {
    const { product: p } = nutritionProduct(name);
    const n = p?.nutrition || { per: 'g' };
    const pr = p?.portions || {};
    let per = n.per || 'g';
    const val = (v) => (v == null ? '' : String(v).replace('.', ','));
    bodyEl.innerHTML = `
      <form class="form nutri-form" autocomplete="off">
        <p class="hint">Tallene står i næringsdeklarasjonen på pakken.</p>
        <div class="seg per-seg">
          <button type="button" class="seg-btn ${per === 'g' ? 'active' : ''}" data-per="g">Per 100 g</button>
          <button type="button" class="seg-btn ${per === 'ml' ? 'active' : ''}" data-per="ml">Per 100 ml</button>
        </div>
        <div class="nutri-grid">
          ${FORM_ORDER.map((k) => NUTRIENTS.find((x) => x.key === k)).map((x) => `<label class="field ${x.sub ? 'sub' : ''}"><span>${esc(x.label)} <em>(${x.unit})</em></span>
            <input name="${x.key}" inputmode="decimal" value="${esc(val(n[x.key]))}" placeholder="0" ${x.key === 'kcal' ? 'required' : ''}></label>`).join('')}
        </div>
        <div class="field"><span>Omregning <em>(valgfritt – for mengder i dl og stk)</em></span>
          <div class="nutri-grid">
            <label class="field" data-dl ${per === 'ml' ? 'hidden' : ''}><span>1 dl veier ca. <em>(g)</em></span><input name="dl" inputmode="decimal" value="${esc(val(pr.dl))}" placeholder="100"></label>
            <label class="field"><span>1 stk veier ca. <em data-unit>(${per})</em></span><input name="stk" inputmode="decimal" value="${esc(val(pr.stk))}" placeholder="—"></label>
          </div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn ghost" data-a="${hasNutrition(p) ? 'view' : 'pick'}">Avbryt</button>
          <button type="submit" class="btn primary grow">Lagre</button>
        </div>
        ${hasNutrition(exactProduct(name)) ? `<button type="button" class="link-btn danger-text center-btn" data-a="remove">${icon('trash')}Fjern næringsinnhold</button>` : ''}
      </form>`;
    const form = $('form', bodyEl);
    $('.per-seg', bodyEl).addEventListener('click', (e) => {
      const b = e.target.closest('[data-per]');
      if (!b) return;
      per = b.dataset.per;
      bodyEl.querySelectorAll('[data-per]').forEach((x) => x.classList.toggle('active', x === b));
      $('[data-dl]', bodyEl).hidden = per === 'ml';
      $('[data-unit]', bodyEl).textContent = `(${per})`;
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const num = (k) => { const v = form[k].value.trim().replace(',', '.'); return v === '' ? null : Number(v); };
      const values = Object.fromEntries(NUTRIENTS.map((x) => [x.key, num(x.key)]));
      if (values.kcal == null || Number.isNaN(values.kcal)) { form.kcal.focus(); toast('Fyll inn energi (kcal)'); return; }
      if (Object.values(values).some((v) => Number.isNaN(v))) { toast('Bruk bare tall, f.eks. 3,5'); return; }
      saveNutrition(name, { ...values, per, source: 'manual' }, { ...pr, dl: per === 'ml' ? null : num('dl'), stk: num('stk') });
      savedThen('Næringsinnhold lagret');
    });
  }

  async function fromBarcode(code) {
    toast('Henter næringsinnhold…');
    const r = await fetchOffNutrition(code);
    if (!sheet.isConnected) return;
    if (!r) { toast('Fant ikke næringsinnhold for strekkoden – skriv inn selv'); go('edit'); return; }
    saveNutrition(name, r.nutrition, r.portions ? { ...(exactProduct(name)?.portions || {}), ...r.portions } : null);
    savedThen('Næringsinnhold hentet fra Open Food Facts');
  }

  bodyEl.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'scan') {
      const code = await scanBarcode({ title: `Skann ${name}` });
      if (code) fromBarcode(code);
    } else if (a === 'off') {
      fromBarcode(exactProduct(name).barcodes.at(-1));
    } else if (a === 'remove') {
      removeNutrition(name);
      toast('Næringsinnholdet er fjernet');
      setTimeout(() => go(hasNutrition(nutritionProduct(name).product) ? 'view' : 'pick'), 60);
    } else {
      go(a);
    }
  });
  render();
}

// ---------- Ark: finn mange ingredienser i Matvaretabellen på en gang ----------
export async function openAutoMatchSheet(names) {
  const sheet = openSheet({
    title: 'Finn i Matvaretabellen',
    body: `<div data-auto class="form"><p class="hint">Laster Matvaretabellen…</p></div>`,
  });
  const el = $('[data-auto]', sheet);
  let foods;
  try { foods = await loadMvt(); } catch { el.innerHTML = '<p class="hint">Kunne ikke laste Matvaretabellen. Sjekk nettet.</p>'; return; }
  const rows = names.map((name) => ({ name, hits: searchMvt(foods, name, 6) }));
  el.innerHTML = `
    <p class="hint">Forslag til hver ingrediens. Velg riktig matvare, eller «Ikke bruk».</p>
    <div class="auto-rows">${rows.map((r, i) => `
      <label class="field"><span>${esc(r.name)}</span>
        <select data-row="${i}">
          ${r.hits.map((f, j) => `<option value="${j}" ${j === 0 ? 'selected' : ''}>${esc(f.name)} (${Math.round(f.n.kcal)} kcal)</option>`).join('')}
          <option value="" ${r.hits.length ? '' : 'selected'}>Ikke bruk</option>
        </select></label>`).join('')}</div>
    <p class="hint small">${MVT_NOTE}</p>
    <div class="form-actions"><button type="button" class="btn primary grow" data-ok>${icon('check')}Bruk valgte</button></div>`;
  $('[data-ok]', el).addEventListener('click', () => {
    let n = 0;
    el.querySelectorAll('select[data-row]').forEach((s) => {
      if (s.value === '') return;
      const r = rows[s.dataset.row];
      const { nutrition, portions } = nutritionFromMvt(r.hits[s.value]);
      saveNutrition(r.name, nutrition, portions);
      n++;
    });
    closeTop();
    toast(n ? `Næringsinnhold lagt til for ${n} ${n === 1 ? 'ingrediens' : 'ingredienser'}` : 'Ingenting ble endret');
  });
}
