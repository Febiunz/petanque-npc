// Replace the below config with your Firebase project config
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAU7DI8Ttut_pSYWD0Z7i2dl9tjRb8-_jg",
  authDomain: "petanque-npc.firebaseapp.com",
  projectId: "petanque-npc",
  storageBucket: "petanque-npc.firebasestorage.app",
  messagingSenderId: "455917834537",
  appId: "1:455917834537:web:0bf09f5d85f9be8b38e738"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const googleProvider = new GoogleAuthProvider();

export { auth, googleProvider };
