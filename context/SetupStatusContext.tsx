/**
 * --------------------------------------------------------------------
 * File:
 * context/SetupStatusContext.tsx
 *
 * Purpose:
 * Single shared source of truth for the school's setup status
 * (see services/onboarding/setupService.ts), consumed by:
 *   - components/layout/Sidebar.tsx (lock icons + tooltips)
 *   - components/onboarding/SetupGate.tsx (per-page locked state)
 *   - components/onboarding/SetupProgressCard.tsx (dashboard card)
 *
 * Why a context instead of each consumer calling setupService itself:
 * getSetupStatus() reads school profile + classes + subjects + exam
 * terms + teachers + routes + fee structure + payment config — seven
 * reads. Three separate consumers each calling it independently would
 * triple that cost on every dashboard page load for no benefit, since
 * they all want the same answer at the same moment.
 *
 * Deliberately NOT the hard gate itself — this context only reports
 * status. Whether an incomplete status blocks anything is entirely up
 * to the consumer (Sidebar just dims a link; SetupGate replaces page
 * content; the dashboard layout no longer redirects at all — see that
 * file's own comments for why).
 * --------------------------------------------------------------------
 */

"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { setupService } from "@/services/onboarding/setupService";
import { SetupStatus } from "@/types/onboarding";

interface SetupStatusContextValue {
  status: SetupStatus | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const SetupStatusContext = createContext<SetupStatusContextValue>({
  status: null,
  loading: true,
  refresh: async () => {},
});

export function SetupStatusProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const schoolId = profile?.schoolId;

  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!schoolId) return;
    const result = await setupService.getSetupStatus(schoolId);
    setStatus(result);
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId) return;
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [schoolId, refresh]);

  // Re-check on focus — covers finishing a step on a settings page and
  // tabbing back, same as the old standalone Setup Center page did.
  useEffect(() => {
    function onFocus() {
      refresh();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  return (
    <SetupStatusContext.Provider value={{ status, loading, refresh }}>
      {children}
    </SetupStatusContext.Provider>
  );
}

export function useSetupStatus() {
  return useContext(SetupStatusContext);
}