/**
 * ------------------------------------------------------------------
 * File:
 * auth/requireRole.ts
 *
 * Purpose:
 * Protect Cloud Functions by ensuring:
 * 1. User is authenticated.
 * 2. User exists.
 * 3. User has the required role.
 *
 * Returns:
 * uid, schoolId and role for the authenticated user.
 * ------------------------------------------------------------------
 */

import { CallableRequest, HttpsError } from "firebase-functions/v2/https";
import { db } from "../services/firebaseAdmin";

export interface SchoolUser {
  uid: string;
  schoolId: string;
  role: string;
}

export async function requireRole(
  request: CallableRequest,
  requiredRole: string
): Promise<SchoolUser> {

  // 1. Check if the user is authenticated.
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "Authentication required."
    );
  }

  const uid = request.auth.uid;

  // 2. Load the user's Firestore document.
  const userDoc = await db
    .collection("users")
    .doc(uid)
    .get();

  if (!userDoc.exists) {
    throw new HttpsError(
      "permission-denied",
      "User not found."
    );
  }

  const user = userDoc.data();

  if (!user) {
    throw new HttpsError(
      "permission-denied",
      "Invalid user."
    );
  }

  // 3. Check the user's role.
  if (user.role !== requiredRole) {
    throw new HttpsError(
      "permission-denied",
      "Permission denied."
    );
  }

  // 4. Return user information.
  return {
    uid,
    schoolId: user.schoolId,
    role: user.role,
  };
}