/**
 * --------------------------------------------------------------------
 * File:
 * services/onboarding/setupService.ts
 *
 * Purpose:
 * Determines whether a school has the minimum config needed for the
 * rest of the app to function correctly — and if not, which specific
 * step is missing.
 *
 * Deliberately does NOT read a stored "setupComplete" flag. A flag
 * set once at "onboarding complete" would stay true forever even if
 * someone later deleted every class — silently breaking the app again
 * with nothing left to catch it. Instead, every check here reads the
 * SAME real data the rest of the app depends on (via the existing
 * schoolService/classesService/feeStructureService), so the answer is
 * always current, not a stale snapshot of "was this ever done once."
 *
 * Dependency order this reflects (see the conversation this was
 * designed from): Profile → Classes → Fee Structure. Fee Structure
 * genuinely can't be meaningfully configured without classes to
 * attach tuition amounts to (settings/fees/page.tsx blocks itself on
 * an empty class list for exactly this reason).
 *
 * Required vs optional:
 * Only profile/classes/feeStructure are REQUIRED — they gate individual
 * modules (Students, Admission, Attendance, Results, Finance) via
 * SetupGate/constants/moduleAccess.ts, NOT the dashboard shell itself
 * (see app/(dashboard)/layout.tsx — it no longer redirects anywhere).
 * Everything else below
 * (subjects, exams, staff, transport, paymentGateway) is OPTIONAL —
 * surfaced on the Setup Center for visibility, never blocking. A
 * school that hasn't configured transport yet should still be able
 * to run admissions; making every settings page a hard gate is the
 * "forced wizard" failure mode this design deliberately avoids.
 *
 * Communication (SMS/WhatsApp/Email) is deliberately NOT included as
 * a step here — there's no backing service/config for it yet in this
 * codebase, and fabricating a "complete" check against data that
 * doesn't exist would just be a fake progress indicator.
 *
 * Responsibilities:
 * ✅ Check each step's real current state via the existing services
 * ✅ Report which steps are incomplete, not just a single boolean
 *
 * Does NOT:
 * ❌ Call Firestore directly for anything that already has a
 *    repository/service (goes through school/classes/feeStructure/
 *    subjects/examTerms/teachers/routes services, not around them)
 * ❌ Create or modify any config itself (that's still the real
 *    settings pages' job — see app/(dashboard)/setup/page.tsx)
 * --------------------------------------------------------------------
 */

import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { schoolService } from "@/services/school/schoolService";
import { classesService } from "@/services/academic/classesService";
import { subjectsService } from "@/services/academic/subjectsService";
import { feeStructureService } from "@/services/finance/feeStructureService";
import { examTermsService } from "@/services/results/examTermsService";
import { teachersService } from "@/services/teachers/teachersService";
import { routesService } from "@/services/transport/routesService";
import { FeeStructureDoc } from "@/types/finance";
import { Subject } from "@/types/academic";
import { ExamTerm } from "@/types/results";
import { Teacher } from "@/types/teachers";
import { Route } from "@/types/transport";
import { SetupStatus, SetupStep } from "@/types/onboarding";

/**
 * classesService/feeStructureService/subjectsService/examTermsService/
 * teachersService/routesService only expose live subscriptions, not
 * one-time getters. This resolves on the first emission and
 * unsubscribes immediately — a one-time read built on top of a
 * subscription, without needing to add a new method to each service
 * just for this gate check.
 */
function firstEmission<T>(subscribe: (callback: (value: T) => void) => () => void): Promise<T> {
  return new Promise((resolve) => {
    const unsubscribe = subscribe((value) => {
      unsubscribe();
      resolve(value);
    });
  });
}

/**
 * Payment gateway has no repository/service layer yet (settings/payment
 * writes Firestore directly — see that page's own comments). This is a
 * narrow, read-only exception mirroring that page's own doc path,
 * not a precedent for skipping the service layer elsewhere.
 */
async function getPaymentGatewayStatus(
  schoolId: string
): Promise<{ connected: boolean; provider?: string }> {
  const snap = await getDoc(doc(db, "schools", schoolId, "config", "paymentGateway"));
  if (!snap.exists()) return { connected: false };
  const data = snap.data();
  return { connected: data?.connected === true, provider: data?.provider as string | undefined };
}

export class SetupService {
  async getSetupStatus(schoolId: string): Promise<SetupStatus> {
    const [profile, classLabels, subjects, examTerms, teachers, routes, paymentStatus] =
      await Promise.all([
        schoolService.getSchoolProfile(schoolId),
        firstEmission<string[]>((cb) => classesService.subscribeToClassLabels(schoolId, cb)),
        firstEmission<Subject[]>((cb) => subjectsService.subscribeToSubjects(schoolId, cb)),
        firstEmission<ExamTerm[]>((cb) => examTermsService.subscribeToExamTerms(schoolId, cb)),
        firstEmission<Teacher[]>((cb) => teachersService.subscribeToTeachers(schoolId, cb)),
        firstEmission<Route[]>((cb) => routesService.subscribeToRoutes(schoolId, cb)),
        getPaymentGatewayStatus(schoolId),
      ]);

    // Fee structure normalization needs the class list to shape
    // itself against (see FeeStructureService) — must be fetched
    // after classLabels resolves, not in parallel with it.
    // A school mid-onboarding may not have set currentAcademicYear yet
    // (schoolService defaults it to ""). An empty string isn't a valid
    // Firestore doc id, so skip the fetch entirely and fall back to a
    // blank structure rather than letting doc() throw.
    const feeStructure = profile.currentAcademicYear
      ? await firstEmission<FeeStructureDoc>((cb) =>
          feeStructureService.subscribeToFeeStructure(schoolId, profile.currentAcademicYear, classLabels, (data) => cb(data))
        )
      : feeStructureService.emptyFeeStructure(classLabels);

    const classesWithTuition = feeStructure.tuition.filter((t) => t.amount > 0);
    const hasRealTuition = classesWithTuition.length > 0;

    const steps: SetupStep[] = [
      // ── Required (gates individual modules, see moduleAccess.ts) ────
      {
        id: "profile",
        label: "School Profile",
        description: "Set your school's current academic year.",
        category: "school",
        required: true,
        requiredReason: "Required to unlock Students, Attendance, Results & Finance",
        actionLabel: "Set Academic Year",
        settingsPath: "/settings/general",
        complete: profile.currentAcademicYear !== "",
        detail: profile.currentAcademicYear ? `AY ${profile.currentAcademicYear}` : undefined,
      },
      {
        id: "classes",
        label: "Classes",
        description: "Add at least one class before fees can be configured.",
        category: "academic",
        required: true,
        requiredReason: "Required before fee structure can be set up",
        actionLabel: "Create Classes",
        settingsPath: "/settings/academic",
        complete: classLabels.length > 0,
        detail: classLabels.length > 0 ? `${classLabels.length} classes` : undefined,
      },
      {
        id: "feeStructure",
        label: "Fee Structure",
        description: "Set tuition amounts so invoices can be generated correctly.",
        category: "finance",
        required: true,
        requiredReason: "Required to unlock Finance",
        actionLabel: "Configure Fees",
        settingsPath: "/settings/fees",
        complete: hasRealTuition,
        detail: hasRealTuition ? `${classesWithTuition.length} classes priced` : undefined,
      },
      // ── Optional (recommended, never blocks the dashboard) ────────
      {
        id: "subjects",
        label: "Subjects",
        description: "Build your subject catalog and assign subjects to classes.",
        category: "academic",
        required: false,
        actionLabel: "Manage Subjects",
        settingsPath: "/settings/subjects",
        complete: subjects.length > 0,
        detail: subjects.length > 0 ? `${subjects.length} subjects` : undefined,
      },
      {
        id: "exams",
        label: "Exams",
        description: "Define exam terms so marks entry and report cards work.",
        category: "academic",
        required: false,
        actionLabel: "Setup Exams",
        settingsPath: "/results",
        complete: examTerms.length > 0,
        detail: examTerms.length > 0 ? `${examTerms.length} exam terms` : undefined,
      },
      {
        id: "staff",
        label: "Staff",
        description: "Add teachers so classes and attendance can be assigned.",
        category: "people",
        required: false,
        actionLabel: "Add Teachers",
        settingsPath: "/teachers",
        complete: teachers.length > 0,
        detail: teachers.length > 0 ? `${teachers.length} teachers` : undefined,
      },
      {
        id: "transport",
        label: "Transport",
        description: "Set up routes and stops if your school offers transport.",
        category: "school",
        required: false,
        actionLabel: "Setup Transport",
        settingsPath: "/settings/transport",
        complete: routes.length > 0,
        detail: routes.length > 0 ? `${routes.length} routes` : undefined,
      },
      {
        id: "paymentGateway",
        label: "Payment Gateway",
        description: "Connect a payment gateway so parents can pay fees online.",
        category: "finance",
        required: false,
        actionLabel: "Connect Payments",
        settingsPath: "/settings/payment",
        complete: paymentStatus.connected,
        detail: paymentStatus.connected
          ? paymentStatus.provider
            ? `Connected · ${paymentStatus.provider}`
            : "Connected"
          : undefined,
      },
    ];

    return {
      complete: steps.filter((s) => s.required).every((s) => s.complete),
      steps,
    };
  }
}

export const setupService = new SetupService();