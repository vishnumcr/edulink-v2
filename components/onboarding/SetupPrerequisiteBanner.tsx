/**
 * --------------------------------------------------------------------
 * File:
 * components/onboarding/SetupPrerequisiteBanner.tsx
 *
 * Purpose:
 * Drop-in banner for a feature page whose usefulness depends on
 * OPTIONAL setup steps (e.g. Results needs Exam Terms + Subjects
 * configured to be meaningful, but neither is part of the hard gate
 * in app/(dashboard)/layout.tsx — a school shouldn't be locked out of
 * the whole dashboard just because exams aren't set up yet).
 *
 * This is the "context-aware guidance" half of the Setup Center:
 * instead of a page silently rendering empty/broken, it names exactly
 * what's missing and links straight to /setup.
 *
 * Renders nothing once every listed step is complete, and nothing
 * while the check is still loading — never a layout-shifting flash
 * of "checking..." on every page load.
 * --------------------------------------------------------------------
 */

"use client";

import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { useSetupStatus } from "@/context/SetupStatusContext";
import { SetupStepId } from "@/types/onboarding";

interface SetupPrerequisiteBannerProps {
  /** Which setup steps this specific page depends on, e.g. ["subjects", "exams"]. */
  stepIds: SetupStepId[];
}

export function SetupPrerequisiteBanner({ stepIds }: SetupPrerequisiteBannerProps) {
  const router = useRouter();
  const { status } = useSetupStatus();

  if (!status) return null;

  const incompleteLabels = status.steps
    .filter((s) => stepIds.includes(s.id) && !s.complete)
    .map((s) => s.label);

  if (incompleteLabels.length === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <p className="text-xs text-amber-800">
          <span className="font-semibold">You need to complete:</span> {incompleteLabels.join(", ")}
        </p>
      </div>
      <button
        onClick={() => router.push("/setup")}
        className="flex shrink-0 items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800"
      >
        Go to Setup <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}