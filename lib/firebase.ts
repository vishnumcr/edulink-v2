/**
 * --------------------------------------------------------------------
 * File:
 * lib/firebase.ts
 *
 * Purpose:
 * Initializes the Firebase client SDK for use throughout EduLink.
 *
 * Responsibilities:
 * ✅ Initialize Firebase App
 * ✅ Export Authentication
 * ✅ Export Firestore
 * ✅ Export Cloud Storage
 * ✅ Export Cloud Functions
 *
 * Does NOT:
 * ❌ Contain business logic
 * ❌ Read or write Firestore
 * ❌ Call Cloud Functions
 * --------------------------------------------------------------------
 */

import { getApp, getApps, initializeApp } from "firebase/app";

import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Prevent duplicate initialization during hot reload.
const app =
  getApps().length > 0
    ? getApp()
    : initializeApp(firebaseConfig);

export const auth = getAuth(app);

export const db = getFirestore(app);

export const storage = getStorage(app);

/**
 * Asia South (Mumbai)
 *
 * All EduLink callable functions are deployed here.
 */
export const functions = getFunctions(
  app,
  "asia-south1"
);

export default app;
