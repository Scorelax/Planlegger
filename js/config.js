// Firebase-oppsett.
// Verdiene kommer fra Firebase-konsollen: Prosjektinnstillinger → Dine apper → Web-app (</>).
// Disse verdiene er IKKE hemmelige – tilgangen styres av sikkerhetsreglene i firestore.rules.
// Hvis apiKey er tom, kjører appen i lokal demo-modus (data lagres kun på denne enheten).
export const firebaseConfig = {
  apiKey: "AIzaSyCmtfaCGAC0lLTsvJwAZxQC9ii-Sn0vE4E",
  authDomain: "planlegger-a92c8.firebaseapp.com",
  projectId: "planlegger-a92c8",
  storageBucket: "planlegger-a92c8.firebasestorage.app",
  messagingSenderId: "1046221331279",
  appId: "1:1046221331279:web:fa540ad6401fa7396a433a",
};
