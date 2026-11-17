// Oppskrifter-fanen: liste, detaljvisning (med «hold skjermen våken») og redigering.
import { state, db, onChange } from '../state.js';
import {
  esc, norm, icon, toast, openPage, openSheet, closeTop, confirmDialog, attachSuggest, formatMinutes,
  compressImage, $,
} from '../util.js';
import {
  coverage, matchItem, onShoppingList, addMissingToShopping, storageLabel, productSuggestions, upsertProduct,
} from '../logic.js';
import { empty } from './inventory.js';

let query = '';
let favOnly = false;
let cookMode = false;

export const recipesView = {
  title: 'Oppskrifter',
  mount(el) {
    el.innerHTML = `
      <div class="toolbar">
        <label class="search">${icon('search')}
          <input id="rec-search" type="search" placeholder="Søk i oppskrifter…" value="${esc(query)}" autocomplete="off" enterkeyhint="search">
        </label>
      </div>
      <div id="rec-body"></div>`;
    $('#rec-search', el).addEventListener('input', (e) => { query = e.target.value; this.update(); });
    this.update();
  },
  update() {
    const body = document.getElementById('rec-body');
    if (body) body.innerHTML = renderBody();
  },
  fab() { openEditor(null); },
  actions: {
    'rec-fav-filter': () => { favOnly = !favOnly; recipesView.update(); },
    'rec-cook': () => { cookMode = !cookMode; recipesView.update(); },
    'open-recipe': (el) => openDetail(el.dataset.id),
    'toggle-fav': (el) => {
      const r = state.recipes.find((x) => x.id === el.dataset.id);
      if (r) db.update('recipes', r.id, { favorite: !r.favorite });
    },
  },
};

function timeClass(m) {
  m = Number(m) || 0;
  if (!m) return '';
  return m <= 30 ? 'quick' : m <= 60 ? 'medium' : 'long';
}

function renderBody() {
  const q = norm(query);
  let list = state.recipes.filter((r) => !q || norm(r.title).includes(q) ||
    (r.ingredients || []).some((i) => norm(i.name).includes(q)));
  if (favOnly) list = list.filter((r) => r.favorite);
  const withCov = list.map((r) => ({ r, cov: coverage(r) }));
  if (cookMode) {
    withCov.sort((a, b) => ratio(b.cov) - ratio(a.cov) || a.cov.missing.length - b.cov.missing.length || a.r.title.localeCompare(b.r.title, 'no'));
  } else {
    withCov.sort((a, b) => (b.r.favorite ? 1 : 0) - (a.r.favorite ? 1 : 0) || (a.r.title || '').localeCompare(b.r.title || '', 'no'));
  }

  let html = `<div class="chips">
    <button class="chip ${favOnly ? 'active fav' : ''}" data-action="rec-fav-filter">${icon('heart')}Favoritter</button>
    <button class="chip ${cookMode ? 'active' : ''}" data-action="rec-cook">${icon('sparkle')}Hva kan jeg lage?</button>
  </div>`;
  if (!state.loaded.recipes) return html + `<div class="list">${'<div class="card skel tall"></div>'.repeat(3)}</div>`;
  if (!state.recipes.length) return html + empty('book', 'Ingen oppskrifter ennå', 'Trykk + for å legge inn din første oppskrift.');
  if (!withCov.length) return html + empty('search', 'Ingen treff', favOnly ? 'Ingen favoritter matcher.' : '');
  if (cookMode) html += `<p class="hint">Sortert etter hvor mye av ingrediensene dere har på lager.</p>`;
  return html + `<div class="recipe-list">${withCov.map(({ r, cov }) => card(r, cov)).join('')}</div>`;
}

const ratio = (c) => (c.total ? c.have / c.total : 0);

function card(r, cov) {
  const id = esc(r.id);
  const full = cov.total && cov.have === cov.total;
  const pct = Math.round(ratio(cov) * 100);
  const missingText = cookMode && cov.missing.length
    ? `<div class="rc-missing">Mangler: ${esc(cov.missing.slice(0, 4).map((m) => m.name).join(', '))}${cov.missing.length > 4 ? ' …' : ''}</div>` : '';
  return `
    <article class="recipe-card" data-action="open-recipe" data-id="${id}">
      <div class="thumb">${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy">` : `<span class="thumb-ph">${esc((r.title || '?').trim()[0]?.toUpperCase() || '?')}</span>`}</div>
      <div class="rc-body">
        <h3>${esc(r.title || 'Uten navn')}</h3>
        <div class="rc-meta">
          ${r.minutes ? `<span class="time ${timeClass(r.minutes)}">${icon('clock')}${esc(formatMinutes(r.minutes))}</span>` : ''}
          ${cov.total ? `<span class="cov ${full ? 'full' : ''}">${icon(full ? 'check' : 'box')}${cov.have}/${cov.total} på lager</span>` : ''}
        </div>
        ${cov.total ? `<div class="progress thin ${full ? 'full' : ''}"><span style="width:${pct}%"></span></div>` : ''}
        ${missingText}
      </div>
      <button class="icon-btn fav ${r.favorite ? 'on' : ''}" data-action="toggle-fav" data-id="${id}" aria-label="Favoritt">${icon('heart')}</button>
    </article>`;
}

// ---------- Hold skjermen våken ----------
let wakeLock = null;
let wantWake = false;
async function requestWake() {
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (e) {
    console.warn(e);
  }
}
function setWake(on) {
  wantWake = on;
  if (on) requestWake();
  else { wakeLock?.release(); wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (wantWake && document.visibilityState === 'visible' && !wakeLock) requestWake();
});

// ---------- Detaljvisning ----------
function openDetail(id) {
  let unsub = null;
  const page = openPage({
    className: 'recipe-page',
    html: `
      <header class="page-head">
        <button class="icon-btn" data-act="back" aria-label="Tilbake">${icon('back')}</button>
        <div class="grow"></div>
        <button class="icon-btn fav" data-act="fav" aria-label="Favoritt">${icon('heart')}</button>
        <button class="icon-btn" data-act="edit" aria-label="Rediger">${icon('edit')}</button>
      </header>
      <div class="page-scroll"><div class="page-body"></div></div>`,
    onClose: () => { unsub?.(); setWake(false); },
  });
  const bodyEl = $('.page-body', page);

  const render = () => {
    const r = state.recipes.find((x) => x.id === id);
    if (!r) { bodyEl.innerHTML = empty('book', 'Oppskriften finnes ikke lenger'); return; }
    $('[data-act="fav"]', page).classList.toggle('on', !!r.favorite);
    const ings = (r.ingredients || []).filter((i) => i.name?.trim());
    const missing = ings.filter((i) => !matchItem(i.name));
    const notListed = missing.filter((i) => !onShoppingList(i.name));
    const wakeSupported = 'wakeLock' in navigator;

    bodyEl.innerHTML = `
      ${r.image ? `<img class="hero" src="${esc(r.image)}" alt="">` : ''}
      <h1 class="recipe-title">${esc(r.title || 'Uten navn')}</h1>
      <div class="rc-meta big">
        ${r.minutes ? `<span class="time ${timeClass(r.minutes)}">${icon('clock')}${esc(formatMinutes(r.minutes))}</span>` : ''}
        ${r.servings ? `<span class="soft-pill">${icon('users')}${esc(r.servings)} porsjoner</span>` : ''}
        ${ings.length ? `<span class="cov ${missing.length ? '' : 'full'}">${icon('box')}${ings.length - missing.length}/${ings.length} på lager</span>` : ''}
      </div>
      <label class="switch-row wake ${wakeSupported ? '' : 'disabled'}">
        <div><b>${icon('sun')} Hold skjermen våken</b><small>${wakeSupported ? 'Skjermen går ikke i hvilemodus mens du lager mat' : 'Ikke støttet i denne nettleseren'}</small></div>
        <input type="checkbox" class="switch" data-act-change="wake" ${wantWake ? 'checked' : ''} ${wakeSupported ? '' : 'disabled'}>
      </label>
      <h2 class="sec-title">Ingredienser</h2>
      ${ings.length ? `<ul class="ingredients">${ings.map((i) => {
        const m = matchItem(i.name);
        const listed = !m && onShoppingList(i.name);
        return `<li class="${m ? 'in-stock' : ''}">
          <span class="ing-dot">${m ? icon('check') : ''}</span>
          <span class="ing-text"><span class="ing-line"><span class="ing-name">${esc(i.name)}</span>${i.amount ? `<span class="ing-amount">${esc(i.amount)}</span>` : ''}</span>
            ${m ? `<small>${esc(m.name)}${m.storageId ? ' · ' + esc(storageLabel(m.storageId)) : ''}</small>` : ''}
            ${listed ? `<small class="listed">${icon('cart')}På handlelisten</small>` : ''}</span>
        </li>`;
      }).join('')}</ul>` : '<p class="hint">Ingen ingredienser lagt inn.</p>'}
      ${notListed.length ? `<button class="btn secondary block" data-act="add-missing">${icon('cart')}Legg ${notListed.length} manglende i handlelisten</button>`
        : ings.length && !missing.length ? `<div class="all-good">${icon('check')}Dere har alt på lager!</div>` : ''}
      <h2 class="sec-title">Fremgangsmåte</h2>
      ${r.steps?.trim() ? `<div class="steps">${esc(r.steps)}</div>` : '<p class="hint">Ingen fremgangsmåte lagt inn.</p>'}`;
  };
  render();
  unsub = onChange(render);

  page.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const r = state.recipes.find((x) => x.id === id);
    const act = b.dataset.act;
    if (act === 'back') closeTop();
    else if (act === 'fav' && r) db.update('recipes', id, { favorite: !r.favorite });
    else if (act === 'edit' && r) openEditor(r);
    else if (act === 'add-missing' && r) {
      const n = addMissingToShopping(r);
      toast(n ? `${n} ${n === 1 ? 'vare' : 'varer'} lagt i handlelisten` : 'Alt sto allerede på lista');
    }
  });
  page.addEventListener('change', (e) => {
    if (e.target.matches('[data-act-change="wake"]')) {
      setWake(e.target.checked);
      if (e.target.checked) toast('Skjermen holdes våken mens oppskriften er åpen');
    }
  });
}

// ---------- Redigering ----------
const TIME_PRESETS = [15, 30, 45, 60, 90];
const AMOUNT_RE = /^((?:\d+[.,/]?\d*|[½¼¾⅓])(?:\s*-\s*\d+)?\s*(?:g|gr|kg|ml|cl|dl|l|ss|ts|krm|stk|pk|pakke|pakker|boks|bokser|fedd|klype|neve|never|glass|beger|bunt|skive|skiver|hode|liter|gram)?\.?)\s+(.+)$/i;

export function parseIngredientLine(line) {
  const t = line.replace(/^[-•*\s]+/, '').trim();
  if (!t) return null;
  const m = t.match(AMOUNT_RE);
  return m ? { amount: m[1].trim(), name: m[2].trim() } : { amount: '', name: t };
}

function openEditor(recipe) {
  const isNew = !recipe;
  const r = recipe ? structuredClone(recipe) : { title: '', minutes: '', servings: '', favorite: false, image: '', ingredients: [], steps: '' };
  let ings = (r.ingredients || []).map((i) => ({ ...i }));
  if (!ings.length) ings = [{ name: '', amount: '' }, { name: '', amount: '' }, { name: '', amount: '' }];
  let image = r.image || '';

  const page = openPage({
    className: 'editor-page',
    html: `
      <header class="page-head">
        <button class="icon-btn" data-act="cancel" aria-label="Avbryt">${icon('x')}</button>
        <h2 class="page-title">${isNew ? 'Ny oppskrift' : 'Rediger oppskrift'}</h2>
        <button class="btn primary sm" data-act="save">Lagre</button>
      </header>
      <div class="page-scroll"><form class="page-body form" autocomplete="off">
        <div class="image-pick" data-act="pick-image"></div>
        <input type="file" accept="image/*" name="file" hidden>
        <label class="field"><span>Tittel</span><input name="title" required value="${esc(r.title)}" placeholder="F.eks. Kylling i karri"></label>
        <div class="field"><span>Tidsbruk</span>
          <div class="row wrap">
            ${TIME_PRESETS.map((m) => `<button type="button" class="chip small" data-min="${m}">${formatMinutes(m)}</button>`).join('')}
          </div>
          <div class="row"><input name="minutes" type="number" inputmode="numeric" min="0" value="${esc(r.minutes || '')}" placeholder="Minutter"><span class="unit-label">min</span>
            <input name="servings" type="number" inputmode="numeric" min="0" value="${esc(r.servings || '')}" placeholder="Porsjoner"><span class="unit-label">pors.</span></div>
        </div>
        <label class="switch-row"><div><b>${icon('heart')} Favoritt</b></div><input type="checkbox" class="switch" name="favorite" ${r.favorite ? 'checked' : ''}></label>
        <div class="field"><span>Ingredienser</span>
          <div class="ing-rows"></div>
          <div class="row">
            <button type="button" class="btn ghost grow" data-act="add-ing">${icon('plus')}Ingrediens</button>
            <button type="button" class="btn ghost grow" data-act="paste">${icon('list')}Lim inn liste</button>
          </div>
        </div>
        <label class="field"><span>Fremgangsmåte</span>
          <textarea name="steps" rows="8" placeholder="Skriv fritt…">${esc(r.steps || '')}</textarea></label>
        ${isNew ? '' : `<button type="button" class="btn ghost danger-text block" data-act="delete">${icon('trash')}Slett oppskrift</button>`}
      </form></div>`,
  });
  const form = $('form', page);
  const rowsEl = $('.ing-rows', page);
  const imgEl = $('.image-pick', page);

  const renderImage = () => {
    imgEl.innerHTML = image
      ? `<img src="${esc(image)}" alt=""><button type="button" class="icon-btn img-remove" data-act="remove-image" aria-label="Fjern bilde">${icon('trash')}</button>`
      : `<div class="image-ph">${icon('image')}<span>Legg til bilde <em>(valgfritt)</em></span></div>`;
  };
  const syncIngs = () => {
    ings = [...rowsEl.querySelectorAll('.ing-row')].map((row) => ({
      name: row.querySelector('[data-f="name"]').value,
      amount: row.querySelector('[data-f="amount"]').value,
    }));
  };
  const renderIngs = (focusIndex) => {
    rowsEl.innerHTML = ings.map((i, idx) => `
      <div class="ing-row" data-idx="${idx}">
        <div class="ing-inputs">
          <input data-f="amount" value="${esc(i.amount)}" placeholder="Mengde" class="amount-in">
          <div class="grow rel"><input data-f="name" value="${esc(i.name)}" placeholder="Ingrediens" enterkeyhint="next"></div>
          <button type="button" class="icon-btn" data-act="del-ing" data-idx="${idx}" aria-label="Fjern">${icon('x')}</button>
        </div>
        <div class="suggest-box" hidden></div>
      </div>`).join('');
    rowsEl.querySelectorAll('.ing-row').forEach((row) => {
      const input = row.querySelector('[data-f="name"]');
      attachSuggest(input, row.querySelector('.suggest-box'), productSuggestions);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const idx = Number(row.dataset.idx);
          syncIngs();
          if (idx === ings.length - 1) { ings.push({ name: '', amount: '' }); renderIngs(idx + 1); }
          else rowsEl.querySelectorAll('[data-f="amount"]')[idx + 1]?.focus();
        }
      });
    });
    if (focusIndex != null) rowsEl.querySelectorAll('[data-f="amount"]')[focusIndex]?.focus();
  };
  renderImage();
  renderIngs();

  // Auto-høyde på fremgangsmåte
  const ta = form.steps;
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.max(160, ta.scrollHeight + 2) + 'px'; };
  ta.addEventListener('input', grow);
  setTimeout(grow, 50);

  page.addEventListener('click', async (e) => {
    const minBtn = e.target.closest('[data-min]');
    if (minBtn) { form.minutes.value = minBtn.dataset.min; return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'cancel': closeTop(); break;
      case 'save': save(); break;
      case 'pick-image': if (!e.target.closest('[data-act="remove-image"]')) form.file.click(); break;
      case 'remove-image': e.stopPropagation(); image = ''; renderImage(); break;
      case 'add-ing': syncIngs(); ings.push({ name: '', amount: '' }); renderIngs(ings.length - 1); break;
      case 'del-ing': syncIngs(); ings.splice(Number(b.dataset.idx), 1); if (!ings.length) ings.push({ name: '', amount: '' }); renderIngs(); break;
      case 'paste': openPasteDialog(); break;
      case 'delete':
        if (await confirmDialog({ title: `Slette «${r.title}»?`, text: 'Dette kan ikke angres.', ok: 'Slett', danger: true })) {
          db.remove('recipes', recipe.id);
          closeTop(2);
          toast('Oppskriften er slettet');
        }
        break;
    }
  });

  form.file.addEventListener('change', async () => {
    const f = form.file.files[0];
    if (!f) return;
    imgEl.classList.add('loading');
    try { image = await compressImage(f); renderImage(); } catch (err) { console.error(err); toast('Kunne ikke lese bildet'); }
    imgEl.classList.remove('loading');
    form.file.value = '';
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); save(); });

  function openPasteDialog() {
    const sheet = openSheet({
      title: 'Lim inn ingredienser',
      body: `
        <p class="hint">Én ingrediens per linje, f.eks. «400 g kyllingfilet» eller «1 boks kokosmelk».</p>
        <textarea rows="8" class="paste-area" placeholder="400 g kyllingfilet&#10;1 løk&#10;2 fedd hvitløk"></textarea>
        <div class="form-actions"><button type="button" class="btn primary grow" data-ok>Legg til</button></div>`,
    });
    const area = $('.paste-area', sheet);
    setTimeout(() => area.focus(), 280);
    $('[data-ok]', sheet).addEventListener('click', () => {
      const parsed = area.value.split(/\r?\n/).map(parseIngredientLine).filter(Boolean);
      syncIngs();
      ings = ings.filter((i) => i.name.trim() || i.amount.trim()).concat(parsed);
      if (!ings.length) ings.push({ name: '', amount: '' });
      renderIngs();
      closeTop();
    });
  }

  function save() {
    syncIngs();
    const title = form.title.value.trim();
    if (!title) { form.title.focus(); toast('Oppskriften må ha en tittel'); return; }
    const data = {
      title,
      minutes: Number(form.minutes.value) || null,
      servings: Number(form.servings.value) || null,
      favorite: form.favorite.checked,
      image: image || null,
      ingredients: ings.map((i) => ({ name: i.name.trim(), amount: i.amount.trim() })).filter((i) => i.name),
      steps: form.steps.value,
      updatedAt: Date.now(),
    };
    for (const i of data.ingredients) if (!state.products.some((p) => p.nameLower === norm(i.name))) upsertProduct({ name: i.name });
    if (isNew) {
      const id = db.newId('recipes');
      db.set('recipes', id, { ...data, createdAt: Date.now() }, false);
      closeTop();
      setTimeout(() => openDetail(id), 300);
    } else {
      db.set('recipes', recipe.id, data, true);
      closeTop();
    }
    toast('Oppskriften er lagret');
  }

  if (isNew) setTimeout(() => form.title.focus(), 300);
}
