/**
 * --------------------------------------------------------------------
 * File:
 * services/auth/authService.ts
 *
 * Purpose:
 * Owns the authentication workflow and every business rule around it.
 * The only file allowed to know that "status must equal active" or
 * that a missing profile means "sign the user back out."
 *
 * This is also the only path AuthContext is allowed to reach
 * AuthRepository through — AuthContext never imports the repository
 * directly.
 *
 * Responsibilities:
 * ✅ Orchestrate login: sign in → load profile → validate → return
 * ✅ Validate account status (continuous, via subscribeToUserProfile)
 * ✅ Map raw Firebase error codes to friendly AuthError instances
 * ✅ Expose subscriptions AuthContext consumes
 *
 * Does NOT:
 * ❌ Call the Firebase SDK directly (that's the repository's job)
 * ❌ Contain UI logic
 * --------------------------------------------------------------------
 */

import { FirebaseError } from "firebase/app";
import { User } from "firebase/auth";
import { authRepository } from "@/repositories/auth/authRepository";
import { AuthError, LoginCredentials, UserProfile } from "@/types/auth";

/**
 * ----------------------------------------------------
 * Maps a raw Firebase error into a friendly, typed AuthError.
 * Nothing outside this function should ever see a Firebase
 * error code.
 * ----------------------------------------------------
 */
function mapFirebaseError(error: unknown): AuthError {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case "auth/invalid-email":
        return new AuthError("invalid-email", "Invalid email address.");

      // Modern Firebase versions return "auth/invalid-credential" for both
      // a wrong password and a non-existent account (to avoid leaking
      // which one it was). We intentionally use one combined message.
      case "auth/invalid-credential":
      case "auth/wrong-password":
      case "auth/user-not-found":
        return new AuthError(
          "invalid-credentials",
          "Invalid email or password."
        );

      case "auth/user-disabled":
        return new AuthError("account-disabled", "Account disabled.");

      case "auth/too-many-requests":
        return new AuthError(
          "too-many-requests",
          "Too many attempts. Please try again later."
        );

      case "auth/network-request-failed":
        return new AuthError(
          "network-error",
          "Network error. Check your connection and try again."
        );

      default:
        return new AuthError("unknown", "Something went wrong. Please try again.");
    }
  }

  if (error instanceof AuthError) {
    return error;
  }

  return new AuthError("unknown", "Something went wrong. Please try again.");
}

export class AuthService {
  /**
   * ----------------------------------------------------
   * Login workflow.
   *
   * Firebase Login → users/{uid} → missing/disabled → sign out
   *                                                  → throw
   *                              → ok → return profile
   * ----------------------------------------------------
   */
  async login(credentials: LoginCredentials): Promise<UserProfile> {
    let firebaseUser: User;

    try {
      firebaseUser = await authRepository.signIn(
        credentials.email,
        credentials.password,
        credentials.rememberMe
      );
    } catch (error) {
      throw mapFirebaseError(error);
    }

    const profile = await authRepository.getUserProfile(firebaseUser.uid);

    if (!profile) {
      await authRepository.signOut();
      throw new AuthError(
        "profile-not-found",
        "Profile not found. Contact your administrator."
      );
    }

    if (profile.status !== "active") {
      await authRepository.signOut();
      throw new AuthError("account-disabled", "Account disabled.");
    }

    return profile;
  }

  /**
   * ----------------------------------------------------
   * Logout.
   * ----------------------------------------------------
   */
  async logout(): Promise<void> {
    await authRepository.signOut();
  }

  /**
   * ----------------------------------------------------
   * Password reset.
   * ----------------------------------------------------
   */
  async resetPassword(email: string): Promise<void> {
    try {
      await authRepository.sendPasswordReset(email);
    } catch (error) {
      throw mapFirebaseError(error);
    }
  }

  /**
   * ----------------------------------------------------
   * Subscribe to raw Firebase Auth state.
   *
   * AuthContext uses this to know whether *any* user is
   * signed in. It does not by itself imply a valid profile.
   * ----------------------------------------------------
   */
  subscribeToAuthState(callback: (user: User | null) => void): () => void {
    return authRepository.onAuthStateChange(callback);
  }

  /**
   * ----------------------------------------------------
   * Subscribe to the current user's profile, with continuous
   * status enforcement baked in.
   *
   * If the profile disappears or status flips away from
   * "active" at any point, this signs the user out and reports
   * null — callers never have to duplicate that check.
   * ----------------------------------------------------
   */
  subscribeToUserProfile(
    uid: string,
    callback: (profile: UserProfile | null) => void
  ): () => void {
    return authRepository.onUserProfileChange(uid, (profile) => {
      if (!profile || profile.status !== "active") {
        authRepository.signOut().catch((error) => {
          console.error("Failed to sign out disabled/missing account:", error);
        });
        callback(null);
        return;
      }

      callback(profile);
    });
  }
}

export const authService = new AuthService();
