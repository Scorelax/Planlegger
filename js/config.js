// Firebase-oppsett.
// Fyll inn verdiene fra Firebase-konsollen: Prosjektinnstillinger → Dine apper → Web-app (</>).
// Disse verdiene er IKKE hemmelige – tilgangen styres av sikkerhetsreglene i firestore.rules.
// Så lenge apiKey er tom, kjører appen i lokal demo-modus (data lagres kun på denne enheten).
export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};
