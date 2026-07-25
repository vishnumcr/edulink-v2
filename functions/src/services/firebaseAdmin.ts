/**
 * ---------------------------------------------------------
 * File:
 * services/firebaseAdmin.ts
 *
 * Purpose:
 * Initializes the Firebase Admin SDK exactly once.
 *
 * Why?
 * Every backend module (Firestore, Auth, Storage, etc.)
 * needs access to the Admin SDK. Initializing it here
 * avoids duplicate initialization and keeps the code clean.
 *
 * Used by:
 * - requireRole.ts
 * - paymentGateway/connect.ts
 * - repositories/*
 * ---------------------------------------------------------
 */

import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

if (!getApps().length) {
  initializeApp();
}

// Firestore Admin instance
export const db = getFirestore();

// Firebase Authentication Admin instance
export const auth = getAuth();