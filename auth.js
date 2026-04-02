import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  createUserWithEmailAndPassword 
} from "firebase/auth";
import firebaseConfig from "./firebase-config.js";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

/**
 * Handle user login
 */
export async function login(email, password) {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return { success: true, user: userCredential.user };
  } catch (error) {
    console.error("Login Error:", error.code, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Handle user logout
 */
export async function logout() {
  try {
    await signOut(auth);
    window.location.href = "/login.html";
  } catch (error) {
    console.error("Logout Error:", error.message);
  }
}

/**
 * Check if user is logged in
 */
export function checkAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

/**
 * Register a new user (for initial setup script)
 */
export async function registerUser(email, password) {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    return { success: true, user: userCredential.user };
  } catch (error) {
    console.error("Registration Error:", error.code, error.message);
    return { success: false, error: error.message };
  }
}

export { auth };
