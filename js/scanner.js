// Strekkodeskanner: kamera i fullskjerm som leser EAN/UPC og lignende koder.
// Bruker nettleserens innebygde BarcodeDetector (Chrome på Android). Mangler den
// (f.eks. iPhone), lastes et reservebibliotek (ZXing i WebAssembly) første gang.
import { esc, icon, openOverlay, closeTop, $ } from './util.js';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];
const PONYFILL = 'https://cdn.jsdelivr.net/npm/barcode-detector@3.2.5/dist/es/ponyfill.js';

let detectorPromise = null;
function getDetector() {
  detectorPromise ||= (async () => {
    if ('BarcodeDetector' in window) {
      try {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        const formats = FORMATS.filter((f) => supported.includes(f));
        if (formats.includes('ean_13')) return new window.BarcodeDetector({ formats });
      } catch { /* bruk reserve */ }
    }
    const { BarcodeDetector } = await import(PONYFILL);
    return new BarcodeDetector({ formats: FORMATS });
  })();
  detectorPromise.catch(() => { detectorPromise = null; });
  return detectorPromise;
}

// Kontrollsiffer for EAN-8/EAN-13/UPC-A, så feillesninger forkastes.
function validGtin(code) {
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return false;
  const d = [...code].map(Number);
  const check = d.pop();
  const sum = d.reverse().reduce((a, n, i) => a + n * (i % 2 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === check;
}

// Åpner kameraet og returnerer strekkoden som tekst, eller null om man lukker.
export function scanBarcode({ title = 'Skann strekkode' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    let stream = null;
    let stopped = false;
    let timer = 0;
    let last = '';
    let torchOn = false;

    const wrap = document.createElement('div');
    wrap.className = 'overlay scanner';
    wrap.innerHTML = `
      <video playsinline muted autoplay></video>
      <div class="scan-frame"><span></span></div>
      <div class="scan-top">
        <button type="button" class="icon-btn" data-close aria-label="Lukk">${icon('x')}</button>
        <h2>${esc(title)}</h2>
        <button type="button" class="icon-btn invisible" data-torch aria-label="Lommelykt">${icon('flash')}</button>
      </div>
      <div class="scan-bottom">
        <p class="scan-msg" data-msg>Starter kamera…</p>
        <form class="scan-manual" hidden>
          <input name="code" inputmode="numeric" placeholder="Strekkodenummer" autocomplete="off" enterkeyhint="go">
          <button type="submit" class="btn primary">OK</button>
        </form>
        <button type="button" class="btn ghost sm" data-manual>Skriv inn nummeret</button>
      </div>`;

    const video = $('video', wrap);
    const form = $('.scan-manual', wrap);
    const setMsg = (t) => { $('[data-msg]', wrap).textContent = t; };
    const stop = () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    const finish = (code) => {
      if (stopped) return;
      result = code;
      if (navigator.vibrate) navigator.vibrate(40);
      closeTop();
    };
    const showManual = () => {
      form.hidden = false;
      $('[data-manual]', wrap).hidden = true;
      form.code.focus();
    };

    wrap.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) closeTop();
      else if (e.target.closest('[data-manual]')) showManual();
      else if (e.target.closest('[data-torch]')) toggleTorch();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const c = form.code.value.replace(/\s+/g, '');
      if (c) finish(c);
    });

    async function toggleTorch() {
      const track = stream?.getVideoTracks()[0];
      if (!track) return;
      try {
        await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
        torchOn = !torchOn;
        $('[data-torch]', wrap).classList.toggle('on', torchOn);
      } catch { /* ikke støttet */ }
    }

    async function loop(detector) {
      if (stopped) return;
      if (video.readyState >= 2) {
        try {
          for (const c of await detector.detect(video)) {
            const v = String(c.rawValue || '').trim();
            if (!v) continue;
            // EAN/UPC med gyldig kontrollsiffer godtas straks, andre koder må leses likt to ganger.
            if ((/^(ean_13|ean_8|upc_a)$/.test(c.format) && validGtin(v)) || v === last) { finish(v); return; }
            last = v;
          }
        } catch { /* enkeltbilder kan feile */ }
      }
      timer = setTimeout(() => loop(detector), 120);
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMsg('Kameraet er ikke tilgjengelig her. Skriv inn nummeret under strekkoden i stedet.');
        showManual();
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (e) {
        if (stopped) return;
        setMsg(e?.name === 'NotAllowedError'
          ? 'Appen fikk ikke bruke kameraet. Gi tilgang i nettleserens innstillinger, eller skriv inn nummeret.'
          : 'Fant ikke noe kamera. Skriv inn nummeret under strekkoden i stedet.');
        showManual();
        return;
      }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream;
      try { await video.play(); } catch { /* autoplay */ }
      const track = stream.getVideoTracks()[0];
      if (track?.getCapabilities?.().torch) $('[data-torch]', wrap).classList.remove('invisible');
      setMsg('Hold strekkoden inne i rammen');

      let detector;
      try {
        detector = await getDetector();
      } catch {
        if (stopped) return;
        setMsg('Kunne ikke laste strekkodeleseren. Sjekk nettet, eller skriv inn nummeret.');
        showManual();
        return;
      }
      loop(detector);
    }

    openOverlay(wrap, { onClose: () => { stop(); resolve(result); } });
    start();
  });
}
