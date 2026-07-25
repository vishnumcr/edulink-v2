/**
 * --------------------------------------------------------------------
 * File:
 * app/(dashboard)/setup/page.tsx
 *
 * Purpose:
 * The "Setup Center" — a hub, not a wizard. Grouped by category
 * (School / Academic / Finance / People), each step auto-detected
 * from real data via setupService, each linking to the real settings
 * page that owns it (no config is created here).
 *
 * Deliberately lives INSIDE (dashboard), not as a sibling route group
 * anymore. It used to be a sibling specifically to dodge a circular
 * redirect (the dashboard layout used to bounce here whenever setup
 * was incomplete — putting this page inside that same guard would
 * make it redirect to itself). That hard redirect is gone now (see
 * app/(dashboard)/layout.tsx) — nothing gates the dashboard shell
 * anymore, only individual modules via SetupGate — so there's no more
 * circularity to avoid, and this page gets the sidebar/topbar like
 * every other dashboard page. Reachable via the "Setup Center" link
 * (always visible, not a fading task) or the dashboard's
 * SetupProgressCard.
 *
 * Required vs optional (see types/onboarding.ts):
 * - Required steps (Profile, Classes, Fee Structure) are what
 *   individual modules gate on via SetupGate/constants/moduleAccess.ts
 *   — e.g. Students stays locked until Profile + Classes are done.
 * - Optional steps stay visible below for progress/visibility, but
 *   never lock anything. A school that skips Transport today can come
 *   back to it later without hunting through settings menus.
 * --------------------------------------------------------------------
 */

"use client";

import { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSetupStatus } from "@/context/SetupStatusContext";
import { SetupCategoryId, SetupStep } from "@/types/onboarding";
import {
  CheckCircle2,
  Circle,
  ArrowRight,
  Loader2,
  RefreshCw,
  School,
  BookOpen,
  Wallet,
  Users,
  PartyPopper,
} from "lucide-react";

const CATEGORY_ORDER: SetupCategoryId[] = ["school", "academic", "finance", "people"];

const CATEGORY_META: Record<SetupCategoryId, { label: string; icon: typeof School }> = {
  school: { label: "School", icon: School },
  academic: { label: "Academic", icon: BookOpen },
  finance: { label: "Finance", icon: Wallet },
  people: { label: "People", icon: Users },
};

export default function SetupPage() {
  const router = useRouter();
  const { status, loading, refresh } = useSetupStatus();
  const [refreshing, setRefreshing] = useState(false);

  async function handleManualRefresh() {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }

  const requiredSteps = useMemo(() => status?.steps.filter((s) => s.required) ?? [], [status]);
  const requiredDone = requiredSteps.filter((s) => s.complete).length;
  const allComplete = status?.steps.every((s) => s.complete) ?? false;

  const overallPercent = status
    ? Math.round((status.steps.filter((s) => s.complete).length / status.steps.length) * 100)
    : 0;

  // The progress bar's rendered width starts at 0 and is bumped to the
  // real percent one frame after mount/update, so the existing
  // `transition-all` on the bar actually has something to animate FROM
  // — without this, React would just paint the final width directly
  // and nothing would visibly fill.
  const [barWidth, setBarWidth] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setBarWidth(overallPercent));
    return () => cancelAnimationFrame(frame);
  }, [overallPercent]);

  const stepsByCategory = useMemo(() => {
    const map = new Map<SetupCategoryId, SetupStep[]>();
    if (!status) return map;
    for (const step of status.steps) {
      const list = map.get(step.category) ?? [];
      list.push(step);
      map.set(step.category, list);
    }
    return map;
  }, [status]);

  if (loading || !status) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:py-10">
      <div className="animate-fade-slide-up">
        <h1 className="text-2xl font-bold text-slate-900">School Setup</h1>
        <p className="mt-2 text-sm text-slate-500">
          Configure your school at your own pace. Required steps unlock their matching modules
          (Students, Attendance, Results, Finance) — everything else can be finished any time.
        </p>
      </div>

      {/* ── Progress ─────────────────────────────────────────────────── */}
      <div
        className="mt-6 animate-fade-slide-up rounded-2xl border border-slate-200 bg-white p-5"
        style={{ animationDelay: "60ms" }}
      >
        <div className="flex items-center justify-between text-xs font-medium text-slate-500">
          <span>
            {requiredDone} of {requiredSteps.length} required steps complete
          </span>
          <span>{overallPercent}% overall</span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-slate-900 transition-[width] duration-700 ease-out"
            style={{ width: `${barWidth}%` }}
          />
        </div>
      </div>

      {/* ── Big finish ───────────────────────────────────────────────── */}
      {allComplete && (
        <div className="mt-6 flex animate-party-pop flex-col items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <PartyPopper className="h-6 w-6 text-emerald-600" />
          <p className="text-sm font-semibold text-emerald-900">Your school is fully set up!</p>
          <button
            onClick={() => router.push("/dashboard")}
            className="mt-1 flex items-center gap-1 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 hover:scale-[1.03] active:scale-[0.98]"
          >
            Go to Dashboard <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ── Categories ───────────────────────────────────────────────── */}
      <div className="mt-8 space-y-6">
        {CATEGORY_ORDER.map((categoryId, categoryIndex) => {
          const steps = stepsByCategory.get(categoryId);
          if (!steps || steps.length === 0) return null;
          const meta = CATEGORY_META[categoryId];
          const Icon = meta.icon;

          return (
            <div
              key={categoryId}
              className="animate-fade-slide-up"
              style={{ animationDelay: `${120 + categoryIndex * 60}ms` }}
            >
              <div className="mb-2 flex items-center gap-1.5 px-1">
                <Icon className="h-3.5 w-3.5 text-slate-400" />
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {meta.label}
                </h2>
              </div>

              <div className="space-y-2">
                {steps.map((step, stepIndex) => {
                  // Within a category, a required step's "Go to settings" only
                  // enables once every earlier REQUIRED step (overall, not just
                  // in this category) is done — reflects the real dependency
                  // (Fee Structure can't be meaningfully configured without
                  // classes to attach tuition to), not an arbitrary order.
                  // Optional steps have no such dependency and are always enabled.
                  const earlierRequiredIncomplete =
                    step.required &&
                    requiredSteps.slice(0, requiredSteps.findIndex((s) => s.id === step.id)).some(
                      (s) => !s.complete
                    );

                  return (
                    <div
                      key={step.id}
                      className={`flex animate-fade-slide-up items-center justify-between gap-3 rounded-2xl border p-4 transition-colors duration-300 ${
                        step.complete
                          ? "border-emerald-200 bg-emerald-50"
                          : "border-slate-200 bg-white"
                      }`}
                      style={{ animationDelay: `${150 + categoryIndex * 60 + stepIndex * 40}ms` }}
                    >
                      <div className="flex items-center gap-3">
                        {step.complete ? (
                          <CheckCircle2
                            key={`${step.id}-complete`}
                            className="h-5 w-5 shrink-0 animate-check-pop text-emerald-500"
                          />
                        ) : (
                          <Circle className="h-5 w-5 shrink-0 text-slate-300" />
                        )}
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-semibold text-slate-900">{step.label}</p>
                            {step.required && !step.complete && (
                              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
                                Required
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500">{step.description}</p>
                        </div>
                      </div>

                      {!step.complete && (
                        <button
                          onClick={() => router.push(step.settingsPath)}
                          disabled={earlierRequiredIncomplete}
                          className="flex shrink-0 items-center gap-1 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800 hover:scale-[1.03] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
                        >
                          Configure <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={handleManualRefresh}
        disabled={refreshing}
        className="mt-6 flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 disabled:opacity-60"
      >
        <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
        I&apos;ve made changes — check again
      </button>
    </div>
  );
}