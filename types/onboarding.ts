/**
 * --------------------------------------------------------------------
 * File:
 * types/onboarding.ts
 *
 * Purpose:
 * Types for the school setup gate — see services/onboarding/setupService.ts.
 *
 * Two tiers, deliberately not one flat list:
 *
 * - REQUIRED steps (profile, classes, feeStructure) are the hard gate —
 *   the dashboard layout redirects to /setup until every one of these
 *   is complete, because other features silently misbehave without
 *   them (invoices, admission).
 * - OPTIONAL steps (subjects, exams, staff, transport, paymentGateway)
 *   are recommended configuration surfaced on the Setup Center for
 *   visibility and progress, but never block the dashboard. A school
 *   that hasn't set up transport yet should still be able to run
 *   admissions.
 *
 * Keeping this distinction explicit in the type (not just convention
 * in setupService) is what stops a future "just add it as a step"
 * change from accidentally turning an optional item into a blocker.
 * --------------------------------------------------------------------
 */

export type SetupStepId =
  | "profile"
  | "classes"
  | "feeStructure"
  | "subjects"
  | "exams"
  | "staff"
  | "transport"
  | "paymentGateway";

export type SetupCategoryId = "school" | "academic" | "finance" | "people";

export interface SetupStep {
  id: SetupStepId;
  label: string;
  description: string;
  category: SetupCategoryId;
  /** Hard gate (blocks the dashboard) vs recommended (shown, never blocks). */
  required: boolean;
  /** Why a required step matters, shown in place of a bare "Required" badge. */
  requiredReason?: string;
  /** Verb-led button label ("Create Classes") instead of a generic "Configure". */
  actionLabel: string;
  /** Where the "Go to ..." button sends the user. */
  settingsPath: string;
  complete: boolean;
  /**
   * A real, already-fetched summary shown once complete (e.g. "14 classes").
   * Always derived from the same data used to compute `complete` — never
   * a fabricated/estimated value.
   */
  detail?: string;
}

export interface SetupStatus {
  /** True once every REQUIRED step is complete. Optional steps never affect this. */
  complete: boolean;
  steps: SetupStep[];
}