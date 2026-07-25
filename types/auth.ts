/**
 * --------------------------------------------------------------------
 * File:
 * types/auth.ts
 *
 * Purpose:
 * Shared TypeScript types for authentication and the user profile
 * stored at users/{uid}.
 *
 * Does NOT:
 * ❌ Read Firestore
 * ❌ Call Firebase Auth
 * ❌ Contain business logic
 * --------------------------------------------------------------------
 */

/**
 * -------------------------------------------------------
 * Account status, stored on users/{uid}.status.
 *
 * active    Normal login allowed.
 * disabled  Login blocked; active sessions are signed out
 *           the next time their profile is read.
 * -------------------------------------------------------
 */
export type UserStatus = "active" | "disabled";

/**
 * -------------------------------------------------------
 * users/{uid} Firestore document.
 *
 * This shape is for STAFF accounts only (users/{uid}.type === "staff",
 * implied/absent here since this project's AuthContext only ever
 * constructs/reads staff docs). A sibling shape exists at the same
 * path for parent accounts (users/{uid}.type === "parent") — see
 * types/parent.ts's ParentAccount. The two are deliberately NOT
 * unioned into one type here: this project never signs a parent in,
 * so nothing in this app needs to narrow between them. Firestore
 * security rules are the one place both shapes get reasoned about
 * together.
 * -------------------------------------------------------
 */
export interface UserProfile {
  uid: string;
  name?: string;
  email?: string;
  role: string;
  schoolId: string;
  status: UserStatus;
}

export interface LoginCredentials {
  email: string;
  password: string;
  rememberMe: boolean;
}

/**
 * -------------------------------------------------------
 * Friendly, UI-safe error codes.
 *
 * Never leak raw Firebase error codes (e.g. "auth/wrong-password")
 * past the service layer — pages only ever see one of these.
 * -------------------------------------------------------
 */
export type AuthErrorCode =
  | "invalid-email"
  | "invalid-credentials"
  | "account-disabled"
  | "profile-not-found"
  | "too-many-requests"
  | "network-error"
  | "unknown";

export class AuthError extends Error {
  code: AuthErrorCode;

  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}