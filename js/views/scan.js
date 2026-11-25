// Skann en vare og legg den i lageret eller handlelisten – med antall eller vekt.
// Strekkoden huskes i varedatabasen, så neste skanning kjennes igjen med en gang.
// Ukjente koder slås opp i Open Food Facts (åpen, gratis varedatabase).
import { state, db } from '../state.js';
import { esc, norm, icon, toast, openSheet, closeTop, attachSuggest, fmtNum, $ } from '../util.js';
import { scanBarcode } from '../scanner.js';
import {
  sortedStorages, storageById, storageLabel, storageOptions, findProduct, productByBarcode, linkBarcode,
  stockItem, addToShopping, upsertProduct, productSuggestions, parseAmount, fmtWeight, WEIGHT_UNITS,
} from '../logic.js';

// Vent til forrige overlay er lukket før neste åpnes (nettleserhistorikken må rekke å gå tilbake).
const settle = () => new Promise((r) => setTimeout(r, 80));
let lastStorage = null; // sist valgte lager i denne økten, brukt for ukjente varer

// mode: 'inventory' | 'shopping'. storageId: lageret man står i (inventory).
export async function startScan({ mode, storageId = null }) {
  const code = await scanBarcode({ title: mode === 'shopping' ? 'Skann til handlelisten' : 'Skann til lager' });
  if (!code) return;
  await settle();
  openScanSheet({ mode, ctxStorage: storageById(storageId) ? storageId : null, code });
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

async function lookupOnline(code) {
  if (!navigator.onLine) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 7000);
  try {
    const fields = 'product_name,product_name_nb,product_name_no,product_name_en,generic_name,brands,quantity';
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${fields}`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const j = await res.json();
    if (j.status !== 1 || !j.product) return null;
    const p = j.product;
    const brand = String(p.brands || '').split(',')[0].trim();
    const name = String(p.product_name_nb || p.product_name_no || p.product_name || p.generic_name || p.product_name_en || brand)
      .replace(/\s+/g, ' ').trim();
    if (!name) return null;
    return { name: cap(name), quantity: parseAmount(p.quantity) };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const qtyText = (it) => (it.empty ? 'tom' : it.qtyType === 'count' ? `${Number(it.count) || 0} stk` : it.qtyType === 'weight' ? fmtWeight(it) : '');

function openScanSheet({ mode, ctxStorage, code }) {
  const shop = mode === 'shopping';
  const known = productByBarcode(code);
  const openEntry = (name) => { const n = norm(name); return n && state.shopping.find((s) => !s.checked && norm(s.name) === n); };
  const validStorage = (id) => (id && storageById(id) ? id : null);

  const name0 = known?.name || '';
  const entry0 = shop ? openEntry(name0) : null;
  const storage0 = shop
    ? validStorage(entry0?.storageId) || validStorage(known?.storageId) || ''
    : ctxStorage || validStorage(known?.storageId) || validStorage(lastStorage) || sortedStorages()[0]?.id || '';
  const amt0 = shop ? parseAmount(entry0?.amount) : null;
  const q0 = amt0?.type || (['count', 'weight'].includes(known?.qtyType) ? known.qtyType : 'count');

  const seg = (v, label) => `<button type="button" class="seg-btn ${q0 === v ? 'active' : ''}" data-q="${v}">${label}</button>`;
  const body = `
    <div class="scan-code">${icon('barcode')}<b>${esc(code)}</b><span class="tag soft" data-status></span></div>
    <form class="form" autocomplete="off">
      <label class="field"><span>Vare</span>
        <input name="name" required value="${esc(name0)}" placeholder="F.eks. Lettmelk" enterkeyhint="done">
        <div class="suggest-box" hidden></div>
      </label>
      <label class="field"><span>${shop ? 'Legges i lager' : 'Lager'}</span>
        <select name="storageId">${storageOptions(storage0, { allowNone: shop })}</select>
      </label>
      <p class="scan-note" data-note hidden></p>
      <div class="field"><span>${shop ? 'Mengde' : 'Mengde som legges til'}</span>
        <div class="seg qty-seg">${seg('count', 'Antall')}${seg('weight', 'Vekt')}${seg('none', 'Ingen')}</div>
      </div>
      <div class="qty-pane" data-pane="count" ${q0 === 'count' ? '' : 'hidden'}>
        <div class="stepper big">
          <button type="button" data-step="-1" aria-label="Færre">${icon('minus')}</button>
          <input name="count" type="number" inputmode="numeric" min="1" value="${amt0?.type === 'count' ? amt0.value : 1}">
          <button type="button" data-step="1" aria-label="Flere">${icon('plus')}</button>
        </div>
      </div>
      <div class="qty-pane row" data-pane="weight" ${q0 === 'weight' ? '' : 'hidden'}>
        <input name="weight" type="number" inputmode="decimal" step="any" min="0" placeholder="500" value="${amt0?.type === 'weight' ? amt0.value : (known?.packWeight ?? '')}">
        <select name="unit">${WEIGHT_UNITS.map((u) => `<option ${u === (amt0?.unit || known?.packUnit || known?.unit || 'g') ? 'selected' : ''}>${u}</option>`).join('')}</select>
      </div>
      <div class="form-actions">
        <button type="button" class="btn ghost" data-next aria-label="Lagre og skann neste">${icon('barcode')}Neste</button>
        <button type="submit" class="btn primary grow" data-submit></button>
      </div>
    </form>`;

  const sheet = openSheet({ title: shop ? 'Skannet vare' : 'Legg på lager', body });
  const form = $('form', sheet);
  const status = $('[data-status]', sheet);
  const note = $('[data-note]', sheet);
  let qtyType = q0;
  let qtyTouched = !!amt0;
  let storageTouched = false;
  let nameTouched = false;

  const setStatus = (t) => { status.textContent = t; status.hidden = !t; };
  const setQty = (v) => {
    qtyType = v;
    sheet.querySelectorAll('.qty-seg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.q === v));
    sheet.querySelectorAll('.qty-pane').forEach((p) => { p.hidden = p.dataset.pane !== v; });
  };

  // Oppdaterer forslag og hint ut fra navn og lager: "har fra før", "står på lista".
  const refresh = () => {
    const name = form.name.value.trim();
    const prod = name && findProduct(name);
    if (prod && !storageTouched && !ctxStorage && validStorage(prod.storageId)) form.storageId.value = prod.storageId;
    let label;
    if (shop) {
      const entry = openEntry(name);
      note.hidden = !entry;
      const amt = entry && !qtyTouched && parseAmount(entry.amount);
      if (amt) {
        setQty(amt.type);
        if (amt.type === 'count') form.count.value = amt.value;
        else { form.weight.value = amt.value; form.unit.value = amt.unit; }
      }
      if (entry) note.textContent = `Står på handlelisten${entry.amount ? ` (${entry.amount})` : ''} – legges i kurven.`;
      label = entry ? `${icon('check')}Legg i kurven` : `${icon('plus')}Legg til i lista`;
    } else {
      const dup = name && state.items.find((i) => norm(i.name) === norm(name) && i.storageId === form.storageId.value);
      note.hidden = !dup;
      if (dup) {
        const have = qtyText(dup);
        note.textContent = have && !dup.empty ? `Har fra før: ${have}. Mengden legges til.` : 'Finnes fra før i dette lageret – fylles på.';
        if (!qtyTouched && ['count', 'weight'].includes(dup.qtyType)) {
          setQty(dup.qtyType);
          if (dup.qtyType === 'weight' && dup.unit && !form.weight.value) form.unit.value = dup.unit;
        }
      } else if (!qtyTouched && prod && ['count', 'weight'].includes(prod.qtyType)) {
        setQty(prod.qtyType);
      }
      label = dup ? `${icon('plus')}Legg til` : `${icon('plus')}Legg på lager`;
    }
    $('[data-submit]', sheet).innerHTML = label;
  };

  $('.qty-seg', sheet).addEventListener('click', (e) => {
    const b = e.target.closest('[data-q]');
    if (!b) return;
    qtyTouched = true;
    setQty(b.dataset.q);
    if (b.dataset.q === 'weight' && !form.weight.value) form.weight.focus();
  });
  sheet.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
    qtyTouched = true;
    form.count.value = Math.max(1, (Number(form.count.value) || 0) + Number(b.dataset.step));
  }));
  form.count.addEventListener('input', () => { qtyTouched = true; });
  form.weight.addEventListener('input', () => { qtyTouched = true; });
  form.storageId.addEventListener('change', () => { storageTouched = true; refresh(); });
  form.name.addEventListener('input', () => { nameTouched = true; refresh(); });
  form.name.addEventListener('change', refresh);
  attachSuggest(form.name, $('.suggest-box', sheet), productSuggestions, refresh);

  // Kjent strekkode: alt er klart. Ukjent: slå opp på nettet.
  if (known) {
    setStatus('Kjent vare');
  } else {
    setStatus('Søker etter varen…');
    form.name.placeholder = 'Søker…';
    lookupOnline(code).then((info) => {
      if (!sheet.isConnected) return;
      form.name.placeholder = 'F.eks. Lettmelk';
      if (!info) {
        setStatus('Ukjent strekkode');
        note.hidden = false;
        note.textContent = 'Fant ikke varen. Skriv inn navnet, så husker appen strekkoden neste gang.';
        if (!form.name.value) form.name.focus();
        return;
      }
      setStatus('Funnet i Open Food Facts');
      if (!nameTouched && !form.name.value) form.name.value = info.name;
      // Pakningsstørrelse (f.eks. 500 g) fylles inn som forslag til vekt.
      if (info.quantity?.type === 'weight' && !form.weight.value) {
        form.weight.value = info.quantity.value;
        form.unit.value = info.quantity.unit;
      }
      refresh();
    });
  }
  refresh();

  const submit = (next) => {
    const name = form.name.value.trim();
    if (!name) { form.name.focus(); return; }
    const storageId = form.storageId.value || null;
    const count = Math.max(1, Math.round(Number(form.count.value) || 1));
    const weight = form.weight.value === '' ? null : Number(form.weight.value);
    const unit = form.unit.value;
    if (qtyType === 'weight' && !weight) { form.weight.focus(); return; }

    if (shop) {
      const amount = qtyType === 'count' ? `${count} stk` : qtyType === 'weight' ? `${fmtNum(weight)} ${unit}` : '';
      const entry = openEntry(name);
      if (entry) {
        const patch = { checked: true };
        if (amount) patch.amount = amount;
        if (!entry.itemId && storageId) patch.storageId = storageId;
        db.update('shopping', entry.id, patch);
        upsertProduct({ name, storageId: patch.storageId || entry.storageId });
        toast(`${entry.name} lagt i kurven`);
      } else {
        addToShopping({ name, amount, storageId });
        toast(`${name}${amount ? ` (${amount})` : ''} lagt på handlelisten`);
      }
    } else {
      if (!storageId) { form.storageId.focus(); return; }
      const { item, added } = stockItem({ name, storageId, qtyType, count, weight, unit });
      upsertProduct({ name, storageId, qtyType, unit: qtyType === 'weight' ? unit : undefined });
      lastStorage = storageId;
      const have = qtyText(item);
      toast(added
        ? `${name} lagt i ${storageLabel(storageId)}`
        : `${item.name}: ${have ? `nå ${have}` : 'fylt på'} i ${storageLabel(storageId)}`);
    }
    // Husk strekkoden (og pakningsvekten) til neste gang.
    linkBarcode(name, code, qtyType === 'weight' ? { packWeight: weight, packUnit: unit } : {});
    closeTop();
    if (next) settle().then(() => startScan({ mode, storageId: ctxStorage }));
  };

  form.addEventListener('submit', (e) => { e.preventDefault(); submit(false); });
  $('[data-next]', sheet).addEventListener('click', () => submit(true));
}
