import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Placeholder config - will be replaced by AI Studio once terms are accepted
const firebaseConfig = {
  apiKey: "PLACEHOLDER",
  authDomain: "PLACEHOLDER",
  projectId: "PLACEHOLDER",
  storageBucket: "PLACEHOLDER",
  messagingSenderId: "PLACEHOLDER",
  appId: "PLACEHOLDER"
};

let app;
let auth: any;
let db: any;
let googleProvider: any;

try {
  // Try to load real config if it exists (injected by platform)
  // Since we can't easily check file existence in runtime code without a server,
  // we'll just use the placeholders for now and let the user know.
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  googleProvider = new GoogleAuthProvider();
} catch (e) {
  console.error("Firebase initialization failed", e);
}

export { auth, db, googleProvider, signInWithPopup, signOut };
