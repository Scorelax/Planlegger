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
js/views/*.js         Fanene + innstillinger
sw.js                 Service worker (offline)
firestore.rules       Sikkerhetsregler for Firestore
```
