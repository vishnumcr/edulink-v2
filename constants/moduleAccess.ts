/**
 * --------------------------------------------------------------------
 * File:
 * constants/moduleAccess.ts
 *
 * Purpose:
 * Which REQUIRED setup steps (see types/onboarding.ts) a given nav
 * route/module depends on. Deliberately only ever lists steps where
 * `required: true` in setupService — OPTIONAL steps (Subjects, Exams,
 * Staff, Transport, Payment Gateway) never lock a module. A school
 * that hasn't set up Transport yet can still run Admissions; that's
 * the whole point of the required/optional split.
 *
 * Used by:
 *   - components/layout/Sidebar.tsx — dims a nav item + shows which
 *     prerequisites are missing on hover
 *   - components/onboarding/SetupGate.tsx — replaces a locked page's
 *     content with a "here's what's missing" card instead of letting
 *     it render against data that doesn't exist yet
 *
 * Not derived automatically from route params — this is a genuine
 * product decision (which modules truly can't function yet) and
 * reads better as an explicit, reviewable table than inferred magic.
 * --------------------------------------------------------------------
 */

import { SetupStepId } from "@/types/onboarding";

export const MODULE_REQUIREMENTS: Record<string, SetupStepId[]> = {
  "/students": ["profile", "classes"],
  "/admission": ["profile", "classes"],
  "/attendance": ["profile", "classes"],
  "/timetable": ["profile", "classes"],
  "/results": ["profile", "classes"],
  "/finance": ["profile", "classes", "feeStructure"],
  "/finance/collect": ["profile", "classes", "feeStructure"],
  "/finance/payments": ["profile", "classes", "feeStructure"],
};

/** Human label used in the Sidebar tooltip / SetupGate card. */
export const MODULE_LABELS: Record<string, string> = {
  "/students": "Students",
  "/admission": "Admission",
  "/attendance": "Attendance",
  "/timetable": "Timetable",
  "/results": "Results",
  "/finance": "Fee Records",
  "/finance/collect": "Collect Fee",
  "/finance/payments": "Payment History",
};