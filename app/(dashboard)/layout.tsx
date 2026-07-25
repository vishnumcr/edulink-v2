/**
 * --------------------------------------------------------------------
 * File:
 * app/(dashboard)/layout.tsx
 *
 * Purpose:
 * Shell for every authenticated route.
 *
 * Layout → AuthContext → Profile → Allowed? → Dashboard (always)
 *
 * Gates on `profile`, not just `user` — a Firebase Auth session can
 * exist without a valid, active profile (e.g. right after AuthService
 * has signed the user out for a disabled account but before the auth
 * listener has caught up), and that should never be treated as
 * "allowed."
 *
 * Deliberately does NOT redirect to /setup anymore. A school missing
 * its academic year, classes, or fee structure used to hard-block the
 * entire dashboard — sidebar and all — behind a separate full-screen
 * route. That's the "trapped in a wizard" failure mode: no nav, no way
 * to peek at other modules, no way to leave and come back. Instead,
 * setup completeness is exposed via SetupStatusProvider to whatever
 * wants to react to it:
 *   - Sidebar dims/locks individual nav items with a tooltip
 *   - SetupGate replaces a locked page's own content
 *   - SetupProgressCard nudges from the dashboard itself
 * The user always lands on /dashboard after login, sidebar fully
 * visible, and unlocks modules as real config gets added — never
 * trapped anywhere.
 * --------------------------------------------------------------------
 */

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { SetupStatusProvider } from "@/context/SetupStatusContext";
import Sidebar from "@/components/layout/Sidebar";
import Topbar from "@/components/layout/Topbar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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

  return (
    <SetupStatusProvider>
      <DashboardShell>{children}</DashboardShell>
    </SetupStatusProvider>
  );
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen w-full bg-slate-50 overflow-hidden">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0">
        <Topbar onMenuClick={() => setSidebarOpen(true)} />

        <main className="flex-1 overflow-y-auto px-3 py-4 sm:px-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}