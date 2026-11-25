# Planlegger

En mobilvennlig app (PWA) for husstanden med tre faner:

| Handleliste | Lager | Oppskrifter |
|---|---|---|
| Trykk for å huke av, basisvarer markert i egen farge, «Avslutt handletur» legger varene rett inn i riktig lager | Egne lager (kjøleskap, fryser, krydderhylle …), antall med +/-, vekt med «under halvparten igjen», basisvarer, middagsrester med porsjoner og alder | Ingredienser markeres grønne når de er på lager, tidsbruk, favoritter, bilde, «Hva kan jeg lage?», legg manglende i handlelisten, hold skjermen våken |

Appen kjører rett fra GitHub Pages, fungerer offline og kan installeres på hjemskjermen.

**Adresse:** https://scorelax.github.io/Planlegger/

---

## Slik henger ting sammen

- **Basisvare (staple)**: Når en basisvare går tom (antall 0 eller «Brukt opp»), blir den liggende i lageret som «Tom» og havner automatisk på handlelisten – med riktig lager.
- **Vekt + «< ½ igjen»**: Huk av, så legges varen på handlelisten.
- **Handletur**: Avhukede varer blir stående (gjennomstreket) til du trykker **Avslutt handletur**. Da legges de inn i lageret de er knyttet til. Finnes varen fra før, oppdateres den (antall legges til, tom/lav nullstilles). Mengde som «2 stk» eller «500 g» blir med inn.
- **Varedatabase**: Alle varer du legger inn huskes (navn, lager, type, basisvare) og brukes til autofullføring i handlelisten, lageret og oppskrifter.
- **Ingrediens-matching**: «mel» matcher «Hvetemel», «ost» matcher «Revet ost» osv.
- **Lager-fanen** viser først en oversikt over alle lager. Trykk på et lager for å se varene i det.
- **Skann strekkode** (knappen over +, i Lager og Handleliste): velg antall eller vekt før varen legges inn.
  - *I lageret*: varen legges i lageret du står i (ellers lageret den hører til). Finnes den fra før, legges mengden til (2 stk + 3 stk = 5 stk, 1 kg + 500 g = 1,5 kg).
  - *I handlelisten*: står varen på lista, legges den i kurven med mengden du velger. Ellers legges den til på lista.
  - Ukjente strekkoder slås opp i [Open Food Facts](https://world.openfoodfacts.org). Strekkoden lagres i varedatabasen, så neste skanning kjennes igjen med en gang – også uten nett.
  - «Neste» lagrer og åpner kameraet igjen, fint når handleposene skal pakkes ut.
- **Næringsinnhold** lagres på varen i varedatabasen og kan hentes tre steder fra:
  - *Strekkode*: hentes automatisk fra Open Food Facts når du skanner en vare.
  - *Matvaretabellen* (Mattilsynet): søk opp f.eks. «løk» eller «egg» – fint for råvarer uten strekkode. Gir også vekt per stk, dl og ss.
  - *Egne tall*: skriv inn fra næringsdeklarasjonen på pakken (per 100 g eller 100 ml), f.eks. for varer kjøpt i utlandet.
  - Åpnes fra «Næringsinnhold» når du redigerer en vare i lageret, eller fra merket ved hver ingrediens i en oppskrift.
- **Næring i oppskrifter**: hver ingrediens viser et merke (kcal, «? kcal» om mengden ikke kan regnes om, eller «Næring» om det mangler). Bryteren «Næringsinnhold» viser sum per porsjon eller for hele oppskriften, og hvor mange ingredienser som er regnet med. «Finn i Matvaretabellen» foreslår tall for alle som mangler på en gang.
  - Mengder regnes om til gram: g/kg direkte, dl/ss/ts via vekt per dl (1 dl ≈ 100 g antas om den mangler), stk/pakke/boks via vekt per enhet.
- **Hold inne** en vare i handlelisten for å redigere den. Android tilbake-knappen lukker skjemaer.

---

## Oppsett av Firebase (felles data for husstanden)

Uten Firebase kjører appen i **lokal demo-modus** (data lagres kun på enheten). For å dele data mellom flere telefoner med Google-innlogging:

1. Gå til <https://console.firebase.google.com> → **Opprett prosjekt** (f.eks. «Planlegger»). Google Analytics kan slås av.
2. **Authentication** → *Kom i gang* → **Sign-in method** → **Google** → *Aktiver* → velg support-e-post → *Lagre*.
3. **Authentication → Settings → Authorized domains** → *Legg til domene* → `scorelax.github.io`
4. **Firestore Database** → *Opprett database* → velg en lokasjon i Europa (f.eks. `eur3`) → *Start in production mode*.
5. **Firestore → Rules**: lim inn innholdet fra [`firestore.rules`](firestore.rules), bytt ut e-postadressene med Google-kontoene i husstanden, og trykk **Publiser**.
6. **Prosjektinnstillinger** (tannhjulet) → *Dine apper* → **Web** (`</>`) → registrer appen (Hosting trengs ikke) → kopier `firebaseConfig`.
7. Lim verdiene inn i [`js/config.js`](js/config.js), commit og push. (Verdiene er ikke hemmelige – tilgangen styres av reglene i steg 5.)

Gratisplanen (Spark) holder godt for en husstand.

**Legge til flere personer senere:** legg e-posten deres inn i listen i Firestore-reglene og publiser.

---

## Installere på Android

1. Åpne https://scorelax.github.io/Planlegger/ i **Chrome**.
2. Trykk **Installer** i meldingen som dukker opp, eller åpne menyen **⋮ → Legg til på startskjermen / Installer app**.

Hold inne app-ikonet for snarveier rett til Handleliste eller Oppskrifter.

---

## Teknisk

- Ren HTML/CSS/JavaScript (ES-moduler), ingen byggesteg.
- Firebase Auth (Google) + Cloud Firestore med offline-cache og sanntidssynk.
- Service worker (`sw.js`) for offline-støtte. Øk `VERSION` i `sw.js` ved nye utgivelser.
- Strekkoder leses med nettleserens innebygde `BarcodeDetector` (Chrome på Android). Der den mangler (f.eks. iPhone), lastes en ZXing-basert reserve fra jsDelivr første gang.
- Næringstall fra [Matvaretabellen](https://www.matvaretabellen.no) (Mattilsynet) ligger i `data/matvaretabellen.json`. Tabellen oppdateres hver høst – kjør `python tools/matvaretabellen.py` for å hente nye tall.
- Bilder komprimeres i nettleseren (maks ~1000 px JPEG) og lagres sammen med oppskriften.
- Eksport til CSV (åpnes i Excel) og sikkerhetskopi/gjenoppretting som JSON under Innstillinger.

### Kjøre lokalt

```bash
python -m http.server 8000
# åpne http://localhost:8000
```

### Struktur

```
index.html            App-skall og fanelinje
css/app.css           Design (mørkt tema)
js/app.js             Oppstart, innlogging, faner, hendelser
js/store.js           Datalag: Firebase eller lokal lagring
js/logic.js           Regler: lager ↔ handleliste ↔ oppskrifter
js/scanner.js         Kamera og strekkodelesing
js/nutrition.js       Næringsinnhold: omregning av mengder, beregning, Matvaretabellen og Open Food Facts
data/matvaretabellen.json  Utdrag av Matvaretabellen (lages med tools/matvaretabellen.py)
js/views/*.js         Fanene + innstillinger (scan.js: skjemaet etter skanning, nutrition.js: næringsark)
sw.js                 Service worker (offline)
firestore.rules       Sikkerhetsregler for Firestore
```
