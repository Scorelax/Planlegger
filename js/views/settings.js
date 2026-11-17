// Innstillinger: konto, lager-administrasjon, eksport/import og installering.
import { state, db, COLLECTIONS } from '../state.js';
import { esc, icon, toast, openSheet, closeTop, confirmDialog, download, toDateInput, $ } from '../util.js';
import { sortedStorages, STORAGE_ICONS, fmtWeight } from '../logic.js';

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  window.dispatchEvent(new Event('install-available'));
});
export const canInstall = () => !!installPrompt;
export async function promptInstall() {
  if (!installPrompt) return;
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  if (outcome === 'accepted') installPrompt = null;
}

export function openSettings({ mode, user, signOut }) {
  const sheet = openSheet({ title: 'Innstillinger', body: '<div class="settings"></div>', className: 'tall' });
  const root = $('.settings', sheet);
  const isStandalone = matchMedia('(display-mode: standalone)').matches;

  const render = () => {
    const storages = sortedStorages();
    root.innerHTML = `
      <section class="set-section">
        <h3>Konto</h3>
        ${mode === 'firebase' ? `
          <div class="account card">
            ${user?.photo ? `<img src="${esc(user.photo)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar">${icon('users')}</span>`}
            <div class="grow"><b>${esc(user?.name || '')}</b><small>${esc(user?.email || '')}</small></div>
            <button class="btn ghost sm" data-act="logout">${icon('logout')}Logg ut</button>
          </div>
          <p class="hint small">Data synkroniseres i sanntid mellom alle som er logget inn.</p>` : `
          <div class="card notice">${icon('cloudOff')}<div><b>Lokal demo-modus</b><small>Data lagres kun på denne enheten. Sett opp Firebase (se README) for å dele med hele husstanden.</small></div></div>`}
      </section>

      <section class="set-section">
        <h3>Lager</h3>
        <div class="storage-list">
          ${storages.map((s, i) => `
            <div class="storage-row card" data-id="${esc(s.id)}">
              <select class="emoji-select" data-f="icon" aria-label="Ikon">${STORAGE_ICONS.concat(STORAGE_ICONS.includes(s.icon) ? [] : [s.icon || '📦'])
                .map((e) => `<option ${e === s.icon ? 'selected' : ''}>${e}</option>`).join('')}</select>
              <input data-f="name" value="${esc(s.name)}" aria-label="Navn">
              <span class="storage-n">${state.items.filter((it) => it.storageId === s.id).length}</span>
              <button class="icon-btn sm" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Flytt opp">${icon('up')}</button>
              <button class="icon-btn sm" data-act="down" ${i === storages.length - 1 ? 'disabled' : ''} aria-label="Flytt ned">${icon('down')}</button>
              <button class="icon-btn sm danger-text" data-act="del" aria-label="Slett">${icon('trash')}</button>
            </div>`).join('')}
        </div>
        <form class="storage-row card add" data-add>
          <select class="emoji-select" name="icon">${STORAGE_ICONS.map((e) => `<option>${e}</option>`).join('')}</select>
          <input name="name" placeholder="Nytt lager, f.eks. Kjeller" required>
          <button class="btn primary sm" type="submit">${icon('plus')}Legg til</button>
        </form>
      </section>

      <section class="set-section">
        <h3>Data</h3>
        <div class="btn-list">
          <button class="btn ghost block" data-act="csv">${icon('download')}Eksporter lager og handleliste (Excel/CSV)</button>
          <button class="btn ghost block" data-act="json">${icon('download')}Ta sikkerhetskopi (JSON)</button>
          <button class="btn ghost block" data-act="import">${icon('upload')}Gjenopprett fra sikkerhetskopi</button>
          <input type="file" accept="application/json,.json" hidden data-import>
        </div>
        <p class="hint small">${state.items.length} varer · ${state.products.length} i varedatabasen · ${state.recipes.length} oppskrifter</p>
      </section>

      <section class="set-section">
        <h3>App</h3>
        ${isStandalone ? `<p class="hint small">${icon('check')} Appen er installert.</p>`
          : canInstall() ? `<button class="btn primary block" data-act="install">${icon('phone')}Installer på hjemskjermen</button>`
          : `<p class="hint small">Installer: åpne Chrome-menyen (⋮) og velg «Legg til på startskjermen» / «Installer app».</p>`}
        <p class="hint small">Planlegger · versjon 1.0</p>
      </section>`;
  };
  render();

  root.addEventListener('change', (e) => {
    const row = e.target.closest('.storage-row[data-id]');
    if (!row) return;
    const f = e.target.dataset.f;
    if (f === 'name' && e.target.value.trim()) db.update('storages', row.dataset.id, { name: e.target.value.trim() });
    if (f === 'icon') db.update('storages', row.dataset.id, { icon: e.target.value });
  });

  root.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const name = form.name.value.trim();
    if (!name) return;
    const order = Math.max(-1, ...state.storages.map((s) => s.order ?? 0)) + 1;
    db.set('storages', db.newId('storages'), { name, icon: form.icon.value, order }, false);
    toast(`Lageret «${name}» er opprettet`);
    setTimeout(render, 50);
  });

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const row = b.closest('.storage-row[data-id]');
    const act = b.dataset.act;
    if ((act === 'up' || act === 'down') && row) {
      const list = sortedStorages();
      const i = list.findIndex((s) => s.id === row.dataset.id);
      const j = act === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      db.batch(list.map((s, idx) => ({ type: 'update', col: 'storages', id: s.id, data: { order: idx } })));
      setTimeout(render, 50);
    } else if (act === 'del' && row) {
      const s = state.storages.find((x) => x.id === row.dataset.id);
      const n = state.items.filter((it) => it.storageId === s.id).length;
      const ok = await confirmDialog({
        title: `Slette «${s.name}»?`,
        text: n ? `${n} varer i dette lageret blir også slettet.` : '',
        ok: 'Slett', danger: true,
      });
      if (!ok) return;
      db.batch([
        { type: 'delete', col: 'storages', id: s.id },
        ...state.items.filter((it) => it.storageId === s.id).map((it) => ({ type: 'delete', col: 'items', id: it.id })),
      ]);
      setTimeout(render, 50);
    } else if (act === 'logout') {
      closeTop();
      signOut();
    } else if (act === 'csv') exportCsv();
    else if (act === 'json') exportJson();
    else if (act === 'import') $('[data-import]', root).click();
    else if (act === 'install') { await promptInstall(); render(); }
  });

  root.addEventListener('change', async (e) => {
    if (!e.target.matches('[data-import]')) return;
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const ok = await confirmDialog({
        title: 'Gjenopprette sikkerhetskopi?',
        text: 'Dataene i kopien legges til / overskriver eksisterende med samme ID.',
        ok: 'Gjenopprett',
      });
      if (!ok) return;
      const ops = [];
      for (const col of COLLECTIONS) {
        for (const doc of data[col] || []) {
          const { id, ...rest } = doc;
          if (id) ops.push({ type: 'set', col, id, data: rest, merge: false });
        }
      }
      for (let i = 0; i < ops.length; i += 400) db.batch(ops.slice(i, i + 400));
      toast(`Gjenopprettet ${ops.length} elementer`);
    } catch (err) {
      console.error(err);
      toast('Kunne ikke lese filen');
    }
    e.target.value = '';
  });
}

function exportJson() {
  const out = { exportedAt: new Date().toISOString(), app: 'Planlegger' };
  for (const col of COLLECTIONS) out[col] = state[col];
  download(`planlegger-backup-${toDateInput(Date.now())}.json`, JSON.stringify(out, null, 2), 'application/json');
}

function exportCsv() {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const sName = (id) => state.storages.find((s) => s.id === id)?.name || '';
  const rows = [['Type', 'Lager', 'Vare', 'Antall', 'Vekt', 'Basisvare', 'Tom', 'Under halvparten', 'Best før', 'Lagt inn']];
  for (const it of [...state.items].sort((a, b) => sName(a.storageId).localeCompare(sName(b.storageId)) || a.name.localeCompare(b.name))) {
    rows.push(['Lager', sName(it.storageId), it.name, it.qtyType === 'count' ? it.count : '', it.qtyType === 'weight' ? fmtWeight(it) : '',
      it.staple ? 'Ja' : '', it.empty ? 'Ja' : '', it.lowWeight ? 'Ja' : '', it.bestBefore || '', it.addedAt ? toDateInput(it.addedAt) : '']);
  }
  for (const l of state.leftovers) rows.push(['Rester', sName(l.storageId), l.name, `${l.portions} porsj.`, '', '', '', '', '', l.addedAt ? toDateInput(l.addedAt) : '']);
  for (const s of state.shopping) rows.push(['Handleliste', sName(s.storageId), s.name, s.amount || '', '', s.staple ? 'Ja' : '', '', '', '', s.addedAt ? toDateInput(s.addedAt) : '']);
  const csv = '﻿' + rows.map((r) => r.map(q).join(';')).join('\r\n');
  download(`planlegger-${toDateInput(Date.now())}.csv`, csv, 'text/csv;charset=utf-8');
}
