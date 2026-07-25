/**
 * --------------------------------------------------------------------
 * File:
 * context/AuthContext.tsx
 *
 * Purpose:
 * Single source of truth for the current Firebase Auth user and their
 * Firestore profile, exposed to the whole app.
 *
 * Architecture:
 * AuthContext → AuthService → AuthRepository → Firebase
 *
 * This file never imports Firebase or AuthRepository directly — only
 * AuthService. Continuous status enforcement (signing a user out if
 * their account is disabled or their profile disappears) lives in
 * AuthService, not here; this file just reacts to whatever AuthService
 * reports.
 *
 * Responsibilities:
 * ✅ Subscribe to auth state via AuthService
 * ✅ Subscribe to the live user profile via AuthService
 * ✅ Expose { user, profile, loading, logout } to the rest of the app
 *
 * Does NOT:
 * ❌ Redirect or guard routes (that's the dashboard layout's job)
 * ❌ Decide whether an account is allowed to be signed in
 * --------------------------------------------------------------------
 */

"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { User } from "firebase/auth";
import { authService } from "@/services/auth/authService";
import { UserProfile } from "@/types/auth";

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Track raw Firebase Auth state.
  useEffect(() => {
    const unsubscribe = authService.subscribeToAuthState((firebaseUser) => {
      setUser(firebaseUser);

      if (!firebaseUser) {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  // Track the live profile for whichever user is currently signed in.
  // AuthService applies status enforcement internally — if the account
  // gets disabled or the profile disappears, this callback receives
  // null and AuthService has already signed the user out.
  useEffect(() => {
    if (!user) {
      return;
    }

    setLoading(true);

    const unsubscribe = authService.subscribeToUserProfile(
      user.uid,
      (nextProfile) => {
        setProfile(nextProfile);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  const logout = async () => {
    await authService.logout();
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
