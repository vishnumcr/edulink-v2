/**
 * --------------------------------------------------------------------
 * File:
 * functions/src/recordPayment.ts
 *
 * Purpose:
 * Records a payment against one term of a student's invoice.
 *
 * This is a money operation, so — per the CRUD-vs-Cloud-Function rule
 * used throughout this codebase — it does NOT run as a direct
 * Firestore write from the client. Instead:
 *
 *   1. The amount and every input are validated here, server-side,
 *      where a user can't tamper with them via browser devtools.
 *   2. The invoice's term status, cumulative paidAmount/balanceAmount,
 *      and overall status are all recomputed and written together in
 *      a single Firestore transaction — so the dashboard/cache never
 *      sees a half-updated invoice (e.g. term marked paid but the
 *      invoice-level total not yet updated).
 *   3. A separate, immutable `payments` document is created as an
 *      audit record of the transaction itself (who recorded it, when,
 *      how much, by what method) — the invoice only ever holds
 *      current totals, not history; this collection is that history.
 *   4. updatedAt is set via serverTimestamp() on the invoice write —
 *      REQUIRED for the Finance dashboard's delta-sync to ever see
 *      this change (see the ⚠️ note on Invoice.updatedAt in
 *      types/finance.ts on the client side).
 *
 * Authorization implemented here:
 * ✅ Caller must be signed in (Firebase Auth)
 * ✅ Caller's users/{uid} profile must exist, be "active", and belong
 *    to the SAME schoolId as the payment being recorded
 *
 * Authorization intentionally NOT implemented here yet:
 * ❌ Role-based restriction (e.g. only "accountant"/"admin" roles) —
 *    users/{uid}.role is currently a free-form string with no defined
 *    taxonomy anywhere in this codebase (see types/auth.ts). Add a
 *    role check here once roles are formalized; until then this only
 *    enforces "same school", not "correct job title" — any active
 *    user of a school can record payments for that school.
 * --------------------------------------------------------------------
 */

import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";

const PAYMENT_MODES = ["cash", "upi", "card", "cheque", "bank_transfer"] as const;
type PaymentMode = (typeof PAYMENT_MODES)[number];

interface RecordPaymentRequest {
  schoolId: string;
  invoiceId: string;
  studentId: string;
  termId: string;
  amount: number;
  mode: PaymentMode;
  referenceNumber?: string;
  note?: string;
}

interface InvoiceTerm {
  id: string;
  name: string;
  amount: number;
  paidAmount: number;
  status: "paid" | "partial" | "unpaid";
}

// Amounts are whole rupees throughout this app (see the currency
// formatter's maximumFractionDigits: 0 on the client) — this epsilon
// only guards against stray floating-point drift, not real paise.
const EPSILON = 0.5;

function statusFromAmounts(paid: number, total: number): "paid" | "partial" | "unpaid" {
  if (paid >= total - EPSILON) return "paid";
  if (paid > 0) return "partial";
  return "unpaid";
}

export const recordPayment = onCall(
  { region: "asia-south1" },
  async (request) => {
    // ── Authentication ──────────────────────────────────────────────
    const auth = request.auth;
    if (!auth) {
      throw new HttpsError("unauthenticated", "You must be signed in to record a payment.");
    }

    // ── Input validation ────────────────────────────────────────────
    const data = (request.data ?? {}) as Partial<RecordPaymentRequest>;

    if (!data.schoolId || typeof data.schoolId !== "string") {
      throw new HttpsError("invalid-argument", "schoolId is required.");
    }
    if (!data.invoiceId || typeof data.invoiceId !== "string") {
      throw new HttpsError("invalid-argument", "invoiceId is required.");
    }
    if (!data.studentId || typeof data.studentId !== "string") {
      throw new HttpsError("invalid-argument", "studentId is required.");
    }
    if (!data.termId || typeof data.termId !== "string") {
      throw new HttpsError("invalid-argument", "termId is required.");
    }
    if (typeof data.amount !== "number" || !Number.isFinite(data.amount) || data.amount <= 0) {
      throw new HttpsError("invalid-argument", "amount must be a positive number.");
    }
    if (!data.mode || !PAYMENT_MODES.includes(data.mode)) {
      throw new HttpsError(
        "invalid-argument",
        `mode must be one of: ${PAYMENT_MODES.join(", ")}`
      );
    }

    const schoolId = data.schoolId;
    const invoiceId = data.invoiceId;
    const studentId = data.studentId;
    const termId = data.termId;
    const amount = data.amount;
    const mode = data.mode;
    const referenceNumber = typeof data.referenceNumber === "string" ? data.referenceNumber : null;
    const note = typeof data.note === "string" ? data.note : null;

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
      throw new HttpsError(
        "permission-denied",
        "You do not have access to this school's finance data."
      );
    }

    const invoiceRef = db.collection("schools").doc(schoolId).collection("invoices").doc(invoiceId);
    const paymentRef = db.collection("schools").doc(schoolId).collection("payments").doc();

    // ── Transaction: read invoice, validate, write invoice + payment ─
    const result = await db.runTransaction(async (tx) => {
      const invoiceSnap = await tx.get(invoiceRef);
      if (!invoiceSnap.exists) {
        throw new HttpsError("not-found", "Invoice not found.");
      }
      const invoice = invoiceSnap.data()!;

      if (invoice.studentId !== studentId) {
        throw new HttpsError(
          "failed-precondition",
          "This invoice does not belong to the given student."
        );
      }

      const terms: InvoiceTerm[] = Array.isArray(invoice.terms) ? invoice.terms : [];
      const termIndex = terms.findIndex((t) => t.id === termId);
      if (termIndex === -1) {
        throw new HttpsError("not-found", "Term not found on this invoice.");
      }

      const term = terms[termIndex];
      const termAmount = Number(term.amount) || 0;
      const termPaidSoFar = Number(term.paidAmount) || 0;
      const termRemaining = termAmount - termPaidSoFar;

      if (amount > termRemaining + EPSILON) {
        throw new HttpsError(
          "failed-precondition",
          `Amount (${amount}) exceeds this term's remaining balance (${termRemaining}).`
        );
      }

      const newTermPaid = termPaidSoFar + amount;
      const newTermStatus = statusFromAmounts(newTermPaid, termAmount);

      const updatedTerms = [...terms];
      updatedTerms[termIndex] = {
        ...term,
        paidAmount: newTermPaid,
        status: newTermStatus,
      };

      const summary = (invoice.summary ?? {}) as { total?: number };
      const invoiceTotal = Number(summary.total) || 0;
      const newInvoicePaid = updatedTerms.reduce(
        (sum, t) => sum + (Number(t.paidAmount) || 0),
        0
      );
      const newInvoiceBalance = invoiceTotal - newInvoicePaid;
      const newInvoiceStatus = statusFromAmounts(newInvoicePaid, invoiceTotal);

      tx.update(invoiceRef, {
        terms: updatedTerms,
        paidAmount: newInvoicePaid,
        balanceAmount: newInvoiceBalance,
        status: newInvoiceStatus,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      tx.set(paymentRef, {
        invoiceId,
        studentId,
        termId,
        amount,
        mode,
        referenceNumber,
        note,
        recordedBy: auth.uid,
        recordedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        newTermStatus,
        newInvoiceStatus,
        newInvoicePaid,
        newInvoiceBalance,
      };
    });

    return {
      success: true,
      receiptId: paymentRef.id,
      ...result,
    };
  }
);