// Replace the below config with your Firebase project config
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBJWZMxmcdjAJucefesf8OuXImQD9_hlvo",
  authDomain: "npc-standen.firebaseapp.com",
  projectId: "npc-standen",
  storageBucket: "npc-standen.firebasestorage.app",
  messagingSenderId: "886687471306",
  appId: "1:886687471306:web:076966ee3eb333fa468633"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const googleProvider = new GoogleAuthProvider();

export { auth, googleProvider };
