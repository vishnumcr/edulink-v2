/**
 * --------------------------------------------------------------------
 * File:
 * repositories/auth/authRepository.ts
 *
 * Purpose:
 * The only place in the frontend that talks to the Firebase Auth SDK
 * and reads/writes the users/{uid} Firestore document.
 *
 * Responsibilities:
 * ✅ Sign in / sign out via Firebase Auth
 * ✅ Set auth persistence (Remember Me)
 * ✅ Send password reset emails
 * ✅ Read users/{uid} (one-time and live subscription)
 * ✅ Wrap onAuthStateChanged
 *
 * Does NOT:
 * ❌ Validate input
 * ❌ Map errors to friendly messages
 * ❌ Know about "login flow" business rules (e.g. status checks)
 * ❌ Contain any UI logic
 * --------------------------------------------------------------------
 */

import {
  browserLocalPersistence,
  browserSessionPersistence,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  User,
} from "firebase/auth";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { UserProfile } from "@/types/auth";

export class AuthRepository {
  /**
   * ----------------------------------------------------
   * Sign in with email/password.
   *
   * rememberMe controls Firebase Auth persistence:
   * - true  → browserLocalPersistence (survives browser close)
   * - false → browserSessionPersistence (cleared on tab close)
   * ----------------------------------------------------
   */
  async signIn(
    email: string,
    password: string,
    rememberMe: boolean
  ): Promise<User> {
    await setPersistence(
      auth,
      rememberMe ? browserLocalPersistence : browserSessionPersistence
    );

    const credential = await signInWithEmailAndPassword(auth, email, password);
    return credential.user;
  }

  /**
   * ----------------------------------------------------
   * Sign out the current user.
   * ----------------------------------------------------
   */
  async signOut(): Promise<void> {
    await signOut(auth);
  }

  /**
   * ----------------------------------------------------
   * Send a password reset email.
   * ----------------------------------------------------
   */
  async sendPasswordReset(email: string): Promise<void> {
    await sendPasswordResetEmail(auth, email);
  }

  /**
   * ----------------------------------------------------
   * One-time read of users/{uid}.
   *
   * Returns null if the document doesn't exist.
   * ----------------------------------------------------
   */
  async getUserProfile(uid: string): Promise<UserProfile | null> {
    const snapshot = await getDoc(doc(db, "users", uid));

    if (!snapshot.exists()) {
      return null;
    }

    return { uid, ...(snapshot.data() as Omit<UserProfile, "uid">) };
  }

  /**
   * ----------------------------------------------------
   * Live subscription to users/{uid}.
   *
   * Used for continuous status enforcement — if an admin
   * disables the account, or deletes the profile, callers
   * find out on the next Firestore push rather than only
   * at next login.
   *
   * Returns an unsubscribe function.
   * ----------------------------------------------------
   */
  onUserProfileChange(
    uid: string,
    callback: (profile: UserProfile | null) => void
  ): () => void {
    return onSnapshot(doc(db, "users", uid), (snapshot) => {
      if (!snapshot.exists()) {
        callback(null);
        return;
      }
      callback({ uid, ...(snapshot.data() as Omit<UserProfile, "uid">) });
    });
  }

  /**
   * ----------------------------------------------------
   * Wraps Firebase's onAuthStateChanged so nothing outside
   * this repository imports `auth` directly.
   *
   * Returns an unsubscribe function.
   * ----------------------------------------------------
   */
  onAuthStateChange(callback: (user: User | null) => void): () => void {
    return onAuthStateChanged(auth, callback);
  }
}

export const authRepository = new AuthRepository();
