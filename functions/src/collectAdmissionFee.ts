/**
 * --------------------------------------------------------------------
 * File:
 * functions/src/collectAdmissionFee.ts
 *
 * Purpose:
 * Stage 3a of the admission flow (cash/manual payment methods —
 * cash/upi-reference/card/cheque/bank_transfer, i.e. staff confirming
 * money already changed hands, same modes as recordPayment.ts). Live
 * gateway collection — QR / payment link / webhook confirmation — is
 * a separate, later piece (stage 3b) that will call into the same
 * enrollment transaction here once a payment is confirmed.
 *
 * This is a money operation AND a multi-document write (Student +
 * Invoice + Admission, plus a Payment record when a fee is charged),
 * so — per the CRUD-vs-Cloud-Function rule used throughout this
 * codebase — none of it runs as direct Firestore writes from the
 * client:
 *
 *   1. Only admissions with status "approved" can be enrolled — this
 *      is re-checked INSIDE the transaction (not just before it) to
 *      close the race where two staff click "Collect Fee" on the same
 *      approved application at once.
 *   2. If the school has an active admission fee configured, the
 *      payment amount must match it exactly (server-side — a client
 *      can't submit a different amount) and a Payment record is
 *      created as an audit trail, same shape recordPayment.ts uses.
 *      If the school has NO admission fee configured (admissionFee.isActive
 *      === false), no payment is required or recorded — enrollment
 *      proceeds directly.
 *   3. The Student document and their first Invoice (generated from
 *      the school's real Fee Structure — tuition + transport (if the
 *      family requested it) + books + one-time/annual misc fees for
 *      their class; NOT monthly misc fees, which belong to later
 *      billing, not the enrollment invoice) are created together
 *      with the Admission update (status → "enrolled", studentId
 *      set) in one transaction, so nothing can end up half-created.
 *   4. updatedAt is set via serverTimestamp() on every write —
 *      REQUIRED for the Students/Finance local caches' delta-sync to
 *      ever see these documents (see the ⚠️ notes on this in
 *      types/students.ts and types/finance.ts on the client side —
 *      this bit the Students feature once already; not repeating it).
 *
 * Authorization implemented here:
 * ✅ Caller must be signed in (Firebase Auth)
 * ✅ Caller's users/{uid} profile must exist, be "active", and belong
 *    to the SAME schoolId as the admission being enrolled
 *
 * Authorization intentionally NOT implemented here yet:
 * ❌ Role-based restriction — same gap as recordPayment.ts; add once
 *    users/{uid}.role has a defined taxonomy.
 * --------------------------------------------------------------------
 */

import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { createOrLinkParent } from "./parent/createOrLinkParent";
import type { ParentLinkRequest, ParentLinkResult } from "./parent/types";

const PAYMENT_MODES = ["cash", "upi", "card", "cheque", "bank_transfer"] as const;
type PaymentMode = (typeof PAYMENT_MODES)[number];

interface CollectAdmissionFeeRequest {
  schoolId: string;
  admissionId: string;
  /** Required only when the school's admissionFee.isActive === true. */
  payment?: {
    amount: number;
    mode: PaymentMode;
    referenceNumber?: string;
    note?: string;
  };
}

interface FeeTerm {
  id: string;
  name: string;
  dueDate: string;
}

interface FeeSchedule {
  mode: "scheduled" | "flexible";
  termCount: number;
  terms: FeeTerm[];
  flexibleDueDate: string;
  finalDueDate: string;
}

interface MiscFee {
  id: string;
  name: string;
  amount: number;
  applicableTo: "all" | "class" | "optional";
  classLabel?: string;
  frequency: "once" | "monthly" | "annual";
  isActive: boolean;
}

interface FeeStructureDoc {
  tuition: { classLabel: string; amount: number }[];
  books: { classLabel: string; amount: number; note: string }[];
  misc: MiscFee[];
  schedule: FeeSchedule;
  admissionFee: { amount: number; isActive: boolean };
}

interface InvoiceTerm {
  id: string;
  name: string;
  amount: number;
  paidAmount: number;
  status: "paid" | "partial" | "unpaid";
}

interface RouteStop {
  name: string;
  order: number;
  transportFee: number;
}

interface RouteDoc {
  routeName: string;
  isActive: boolean;
  stops: RouteStop[];
}

/**
 * ----------------------------------------------------
 * Splits recurringTotal (tuition + transport, if any) evenly across
 * the schedule's terms (remainder on the last term, so the sum always
 * equals the input exactly — avoids the classic "3 terms of ₹333.33"
 * rounding drift). Transport is combined with tuition here because
 * both are annual, recurring costs that make sense to spread across
 * the year the same way — unlike books/misc, which are billed
 * entirely on the first term as due-at-enrollment charges.
 *
 * "flexible" schedules aren't split at all — a single term for the
 * full balance, due on the school's configured finalDueDate.
 * ----------------------------------------------------
 */
function buildInvoiceTerms(
  schedule: FeeSchedule,
  recurringTotal: number,
  upfrontTotal: number
): InvoiceTerm[] {
  if (schedule.mode === "flexible" || schedule.terms.length === 0) {
    return [
      {
        id: "term_1",
        name: "Full Payment",
        amount: recurringTotal + upfrontTotal,
        paidAmount: 0,
        status: "unpaid",
      },
    ];
  }

  const count = schedule.terms.length;
  const base = Math.floor(recurringTotal / count);
  const remainder = recurringTotal - base * count;

  return schedule.terms.map((term, i) => {
    const recurringShare = base + (i === count - 1 ? remainder : 0);
    return {
      id: term.id,
      name: term.name,
      amount: recurringShare + (i === 0 ? upfrontTotal : 0),
      paidAmount: 0,
      status: "unpaid",
    };
  });
}

export const collectAdmissionFee = onCall(
  { region: "asia-south1" },
  async (request) => {
    // ── Authentication ──────────────────────────────────────────────
    const auth = request.auth;
    if (!auth) {
      throw new HttpsError("unauthenticated", "You must be signed in to enroll a student.");
    }

    // ── Input validation ────────────────────────────────────────────
    const data = (request.data ?? {}) as Partial<CollectAdmissionFeeRequest>;

    if (!data.schoolId || typeof data.schoolId !== "string") {
      throw new HttpsError("invalid-argument", "schoolId is required.");
    }
    if (!data.admissionId || typeof data.admissionId !== "string") {
      throw new HttpsError("invalid-argument", "admissionId is required.");
    }
    if (data.payment !== undefined) {
      const p = data.payment;
      if (typeof p.amount !== "number" || !Number.isFinite(p.amount) || p.amount <= 0) {
        throw new HttpsError("invalid-argument", "payment.amount must be a positive number.");
      }
      if (!p.mode || !PAYMENT_MODES.includes(p.mode)) {
        throw new HttpsError("invalid-argument", `payment.mode must be one of: ${PAYMENT_MODES.join(", ")}`);
      }
    }

    const schoolId = data.schoolId;
    const admissionId = data.admissionId;
    const payment = data.payment;

    const db = admin.firestore();

    // ── Authorization: caller must belong to this school ────────────
    const callerSnap = await db.collection("users").doc(auth.uid).get();
    if (!callerSnap.exists) {
      throw new HttpsError("permission-denied", "No user profile found for this account.");
    }
    const caller = callerSnap.data() as { schoolId?: string; status?: string };
    if (caller.status !== "active") {
      throw new HttpsError("permission-denied", "This account is disabled.");
    }
    if (caller.schoolId !== schoolId) {
      throw new HttpsError("permission-denied", "You do not have access to this school's admissions.");
    }

    // ── School lookup first — feeStructure is now scoped per academic
    //    year (schools/{schoolId}/feeStructure/{academicYear}, not a
    //    fixed "current" doc), so we need to know which year is
    //    current for this school before we know which fee structure
    //    doc to read. This makes the two reads sequential where they
    //    used to be parallel — the dependency is real, not avoidable. ─
    const schoolSnap = await db.collection("schools").doc(schoolId).get();

    // NOTE: the school doc's field is currentAcademicYear, not
    // academicYear — this previously read the wrong field name and
    // silently wrote an empty academicYear onto every invoice.
    const academicYear = (schoolSnap.exists ? (schoolSnap.data()?.currentAcademicYear as string) : "") || "";
    const schoolName = (schoolSnap.exists ? (schoolSnap.data()?.name as string) : "") || "";

    if (!academicYear) {
      throw new HttpsError(
        "failed-precondition",
        "This school hasn't set a current academic year yet — set one in School Profile before enrolling students."
      );
    }

    const feeStructureSnap = await db
      .collection("schools").doc(schoolId)
      .collection("feeStructure").doc(academicYear)
      .get();

    const feeStructure = (feeStructureSnap.exists ? feeStructureSnap.data() : null) as FeeStructureDoc | null;
    const admissionFeeConfig = feeStructure?.admissionFee ?? { amount: 0, isActive: false };

    // ── Payment requirement check ────────────────────────────────────
    if (admissionFeeConfig.isActive) {
      if (!payment) {
        throw new HttpsError(
          "failed-precondition",
          "This school charges an admission fee — payment details are required to enroll."
        );
      }
      if (Math.abs(payment.amount - admissionFeeConfig.amount) > 0.5) {
        throw new HttpsError(
          "failed-precondition",
          `Admission fee is ₹${admissionFeeConfig.amount}. Submitted amount (₹${payment.amount}) does not match.`
        );
      }
    }

    const admissionRef = db.collection("schools").doc(schoolId).collection("admissions").doc(admissionId);
    const studentRef = db.collection("schools").doc(schoolId).collection("students").doc();
    const invoiceRef = db.collection("schools").doc(schoolId).collection("invoices").doc();
    const paymentRef = payment
      ? db.collection("schools").doc(schoolId).collection("payments").doc()
      : null;

    const counterRef = db.collection("schools").doc(schoolId).collection("meta").doc("counters");

    const result = await db.runTransaction(async (tx) => {
      const admissionSnap = await tx.get(admissionRef);
      if (!admissionSnap.exists) {
        throw new HttpsError("not-found", "Admission not found.");
      }
      const admission = admissionSnap.data()!;

      if (admission.status !== "approved") {
        throw new HttpsError(
          "failed-precondition",
          `Admission must be "approved" to enroll — current status is "${admission.status}".`
        );
      }

      const admissionDetails = (admission.admission ?? {}) as {
        applyingForClass?: string;
        sectionPreference?: string;
        rollNo?: string;
        transportRequired?: boolean;
        transportRouteId?: string;
        transportStopName?: string;
      };
      const className = admissionDetails.applyingForClass || "";

      // ── Transport lookup (read-only, must happen before any writes
      //    below — Firestore transactions require all reads first,
      //    which is also why this sits above the counter read/write
      //    block rather than after it). Only fetched when the family
      //    actually requested transport; an admission with no route
      //    selected never touches this.
      let transportFee = 0;
      let transportInfo: { routeId: string; stopName: string } | null = null;
      if (admissionDetails.transportRequired && admissionDetails.transportRouteId) {
        const routeRef = db
          .collection("schools")
          .doc(schoolId)
          .collection("routes")
          .doc(admissionDetails.transportRouteId);
        const routeSnap = await tx.get(routeRef);
        if (routeSnap.exists) {
          const route = routeSnap.data() as RouteDoc;
          const stop = route.stops.find((s) => s.name === admissionDetails.transportStopName);
          if (stop) {
            transportFee = stop.transportFee || 0;
            transportInfo = {
              routeId: admissionDetails.transportRouteId,
              stopName: admissionDetails.transportStopName!,
            };
          }
          // If the route exists but the stop doesn't match (e.g. the
          // route's stops were edited after the application was
          // submitted), transportFee stays 0 and transportInfo stays
          // null — enrollment still proceeds, just without a
          // transport charge, rather than failing outright over stale
          // stop data from before this application was reviewed.
        }
      }

      // All reads before any writes — Firestore transaction requirement.
      const counterSnap = await tx.get(counterRef);
      const currentAdmissionNumber = (counterSnap.exists ? (counterSnap.data()?.lastAdmissionNumber as number) : 0) || 0;
      const nextAdmissionNumber = currentAdmissionNumber + 1;
      const admissionNumber = `ADM-${String(nextAdmissionNumber).padStart(6, "0")}`;
      tx.set(counterRef, { lastAdmissionNumber: nextAdmissionNumber }, { merge: true });

      const student = (admission.student ?? {}) as Record<string, unknown>;
      const parent = (admission.parent ?? {}) as {
        father?: { name?: string; phone?: string; email?: string };
        mother?: { name?: string; phone?: string; email?: string };
      };
      const address = (admission.address ?? {}) as {
        current?: { line1?: string; line2?: string; city?: string; state?: string; pin?: string };
      };

      // ── Build the Student document (NewStudentDocument shape) ─────
      // Parent email/phone now actually flow into contact — the
      // original (pre-review-workflow) admission page hardcoded these
      // to empty strings despite collecting them; fixed here.
      tx.set(studentRef, {
        admissionNumber,
        profile: {
          name: (student.name as string) || "",
          rollNo: admissionDetails.rollNo || "",
          gender: (student.gender as string) || "Male",
          dob: (student.dob as string) || "",
          bloodGroup: (student.bloodGroup as string) || "",
          apaarId: (student.apaarId as string) || "",
          penId: (student.penId as string) || "",
          photoUrl: null,
        },
        className,
        section: admissionDetails.sectionPreference || null,
        parent: {
          fatherName: parent.father?.name || "",
          fatherPhone: parent.father?.phone || "",
          motherName: parent.mother?.name || "",
          motherPhone: parent.mother?.phone || "",
        },
        contact: {
          email: parent.father?.email || parent.mother?.email || "",
          phone: parent.father?.phone || parent.mother?.phone || "",
          address: [address.current?.line1, address.current?.line2, address.current?.city, address.current?.state, address.current?.pin]
            .filter(Boolean)
            .join(", "),
        },
        status: "active",
        avatarColor: (admission.avatarColor as string) || "#2563EB",
        deleted: false,
        transport: transportInfo,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // ── Build the first Invoice from the real Fee Structure ───────
      const tuitionAmount = feeStructure?.tuition.find((t) => t.classLabel === className)?.amount ?? 0;
      const booksAmount = feeStructure?.books.find((b) => b.classLabel === className)?.amount ?? 0;
      const miscForClass = (feeStructure?.misc ?? []).filter(
        (m) =>
          m.isActive &&
          m.frequency !== "monthly" &&
          (m.applicableTo === "all" || (m.applicableTo === "class" && m.classLabel === className))
      );
      const miscAmount = miscForClass.reduce((sum, m) => sum + (m.amount || 0), 0);
      const upfrontTotal = booksAmount + miscAmount;

      const schedule = feeStructure?.schedule ?? {
        mode: "flexible" as const,
        termCount: 0,
        terms: [],
        flexibleDueDate: "",
        finalDueDate: "",
      };
      // tuition + transport are both annual, recurring costs — split
      // across terms together (see buildInvoiceTerms). books/misc are
      // one-time, due-at-enrollment charges — billed upfront instead.
      const terms = buildInvoiceTerms(schedule, tuitionAmount + transportFee, upfrontTotal);
      const invoiceTotal = tuitionAmount + transportFee + upfrontTotal;

      tx.set(invoiceRef, {
        studentId: studentRef.id,
        academicYear,
        className,
        status: invoiceTotal > 0 ? "unpaid" : "paid",
        paidAmount: 0,
        balanceAmount: invoiceTotal,
        summary: {
          total: invoiceTotal,
          tuition: tuitionAmount,
          books: booksAmount,
          misc: miscAmount,
          transport: transportFee,
        },
        studentSnapshot: {
          name: (student.name as string) || "",
          ...(admissionDetails.sectionPreference
            ? { section: admissionDetails.sectionPreference }
            : {}),
          fatherPhone: parent.father?.phone || "",
        },
        terms,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // ── Admission fee payment record (only if one was charged) ────
      if (payment && paymentRef) {
        tx.set(paymentRef, {
          invoiceId: null, // admission fee isn't tied to the tuition invoice/terms above
          studentId: studentRef.id,
          termId: null,
          amount: payment.amount,
          mode: payment.mode,
          referenceNumber: payment.referenceNumber ?? null,
          note: payment.note ?? "Admission fee",
          recordedBy: auth.uid,
          recordedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // ── Flip the admission to enrolled ─────────────────────────────
      tx.update(admissionRef, {
        status: "enrolled",
        studentId: studentRef.id,
        admissionNumber,
        feeStatus: "paid", // either the required fee was just paid, or none was configured — either way nothing is owed
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        studentId: studentRef.id,
        invoiceId: invoiceRef.id,
        admissionNumber,
        className,
        // Needed after the transaction resolves, for parent linking —
        // `parent`/`student` are scoped to this closure and wouldn't
        // otherwise survive past runTransaction().
        studentName: (student.name as string) || "",
        section: (admissionDetails.sectionPreference as string) || null,
        father: { name: parent.father?.name || "", phone: parent.father?.phone || "" },
        mother: { name: parent.mother?.name || "", phone: parent.mother?.phone || "" },
      };
    });

    // ── Parent account creation/linking — deliberately OUTSIDE the
    // transaction above (see createOrLinkParent.ts's file header for
    // why combining it with a Firestore transaction would be unsafe).
    // Enrollment has already fully succeeded by this point; a failure
    // here is reported per-parent, not allowed to undo it.
    const parentLinks: { relationship: "father" | "mother"; result: ParentLinkResult | null; error: string | null }[] = [];

    for (const [relationship, contact] of [
      ["father", result.father],
      ["mother", result.mother],
    ] as const) {
      if (!contact.phone) continue; // no phone on file for this parent — nothing to link
      try {
        const linkResult = await createOrLinkParent({
          schoolId,
          schoolName,
          studentId: result.studentId,
          studentName: result.studentName,
          className: result.className,
          section: result.section,
          parent: { name: contact.name, phone: contact.phone, relationship } as ParentLinkRequest,
        });
        parentLinks.push({ relationship, result: linkResult, error: null });
      } catch (err) {
        parentLinks.push({
          relationship,
          result: null,
          error: err instanceof Error ? err.message : "Failed to create or link parent account.",
        });
      }
    }

    return {
      success: true,
      studentId: result.studentId,
      invoiceId: result.invoiceId,
      receiptId: paymentRef?.id ?? null,
      admissionNumber: result.admissionNumber,
      parentLinks,
    };
  }
);