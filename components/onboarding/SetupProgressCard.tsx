/**
 * --------------------------------------------------------------------
 * File:
 * components/onboarding/SetupProgressCard.tsx
 *
 * Purpose:
 * Compact "finish setting up" card for the dashboard — the reachable
 * path to /setup for a school that's already past the required gate
 * but still has optional steps left (Subjects, Exams, Staff,
 * Transport, Payment Gateway).
 *
 * Deliberately NOT a permanent sidebar nav item: setup is a task that
 * fades away once done, not something worth the same permanent nav
 * real estate as Students/Admission/Finance. This card simply stops
 * rendering once every step (required + optional) is complete — no
 * dismiss button needed, because there's nothing left to dismiss.
 * --------------------------------------------------------------------
 */

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Settings2 } from "lucide-react";
import { useSetupStatus } from "@/context/SetupStatusContext";

export function SetupProgressCard() {
  const router = useRouter();
  const { status } = useSetupStatus();

  const [barWidth, setBarWidth] = useState(0);
  const [navigating, setNavigating] = useState(false);

  const percent = status
    ? Math.round((status.steps.filter((s) => s.complete).length / status.steps.length) * 100)
    : 0;

  // Same "animate the fill in, don't just paint it" trick as the
  // Setup Center page itself — see that page's barWidth comment.
  useEffect(() => {
    if (!status) return;
    const frame = requestAnimationFrame(() => setBarWidth(percent));
    return () => cancelAnimationFrame(frame);
  }, [status, percent]);

  if (!status) return null;

  const allComplete = status.steps.every((s) => s.complete);
  if (allComplete) return null;

  const nextStep = status.steps.find((s) => !s.complete);

  function handleContinue() {
    // A brief press/scale feedback before navigating, so this reads as
    // "opening something" rather than an instant page swap.
    setNavigating(true);
    setTimeout(() => router.push("/setup"), 120);
  }

  return (
    <button
      onClick={handleContinue}
      className={`flex w-full animate-fade-slide-up items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all duration-150 hover:border-slate-300 hover:shadow-md ${
        navigating ? "scale-[0.98] opacity-70" : "scale-100"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900">
          <Settings2 className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">Finish setting up your school</p>
          <p className="text-xs text-slate-500">
            {percent}% complete
            {nextStep && <> — next: {nextStep.label}</>}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <div className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-slate-100 sm:block">
          <div
            className="h-full rounded-full bg-slate-900 transition-[width] duration-700 ease-out"
            style={{ width: `${barWidth}%` }}
          />
        </div>
        <span className="flex items-center gap-1 text-xs font-semibold text-slate-700">
          Continue <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </button>
  );
}