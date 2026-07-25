/**
 * --------------------------------------------------------------------
 * File:
 * app/(setup)/layout.tsx
 *
 * Purpose:
 * Shell for /setup. Deliberately its OWN route group, sibling to
 * (dashboard) and (auth) — not nested inside (dashboard).
 *
 * Why it can't live inside (dashboard): that layout redirects to
 * /setup whenever setup is incomplete. If /setup were also wrapped by
 * that same guard, the guard would run on /setup itself, see setup is
 * still incomplete, and redirect to /setup — the page the user is
 * already on. Being a sibling route group avoids that entirely.
 *
 * This layout only requires auth (user + profile), NOT setup
 * completeness — checking completeness here too would recreate the
 * same circularity one level down.
 * --------------------------------------------------------------------
 */

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, profile, loading } = useAuth();

  const allowed = Boolean(user && profile);

  useEffect(() => {
    if (!loading && !allowed) {
      router.replace("/login");
    }
  }, [loading, allowed, router]);

  if (loading || !allowed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-500">Checking authentication...</p>
      </div>
    );
  }

  return <div className="min-h-screen bg-slate-50">{children}</div>;
}