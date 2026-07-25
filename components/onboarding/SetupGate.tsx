/**
 * --------------------------------------------------------------------
 * File:
 * components/onboarding/SetupGate.tsx
 *
 * Purpose:
 * Wraps a dashboard page's content. If the page's required setup
 * steps (see constants/moduleAccess.ts) aren't all complete yet, this
 * renders a "here's exactly what's missing" card instead of the page
 * — never an empty table, never a confusing Firestore error from
 * querying against config that doesn't exist.
 *
 * Deliberately does NOT redirect anywhere. The sidebar link that got
 * the user here stays exactly where it was; this is what makes a
 * locked module feel like "not yet available" rather than "you did
 * something wrong" — same reasoning as not hiding the sidebar at all.
 * --------------------------------------------------------------------
 */

"use client";

import Link from "next/link";
import { Lock, CheckCircle2, Circle, Loader2 } from "lucide-react";
import { useSetupStatus } from "@/context/SetupStatusContext";
import { SetupStepId } from "@/types/onboarding";

export function SetupGate({
  requires,
  moduleLabel,
  children,
}: {
  requires: SetupStepId[];
  moduleLabel: string;
  children: React.ReactNode;
}) {
  const { status, loading } = useSetupStatus();

  if (loading || !status) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  const relevantSteps = requires
    .map((id) => status.steps.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s));

  const allDone = relevantSteps.every((s) => s.complete);
  if (allDone) return <>{children}</>;

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100">
          <Lock className="h-5 w-5 text-slate-500" />
        </div>
        <h2 className="text-lg font-semibold text-slate-900">{moduleLabel} isn't unlocked yet</h2>
        <p className="mt-1 text-sm text-slate-500">
          Before you can use {moduleLabel.toLowerCase()}, finish setting up:
        </p>

        <ul className="mt-4 space-y-2">
          {relevantSteps.map((step) => (
            <li key={step.id} className="flex items-center gap-2 text-sm">
              {step.complete ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-slate-300" />
              )}
              <span className={step.complete ? "text-slate-400 line-through" : "text-slate-700"}>
                {step.label}
              </span>
            </li>
          ))}
        </ul>

        <Link
          href="/setup"
          className="mt-5 flex w-full items-center justify-center rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          Go to Setup
        </Link>
      </div>
    </div>
  );
}