/**
 * --------------------------------------------------------------------
 * File:
 * services/finance/financeService.ts
 *
 * Purpose:
 * Business logic for the Finance feature's invoice dashboard.
 *
 * Responsibilities:
 * ✅ Normalize raw Firestore data into a well-formed Invoice
 *    (defaulting missing/legacy fields defensively)
 * ✅ Orchestrate the Finance dashboard's local cache: sync invoices
 *    from Firestore into IndexedDB (financeCache.ts) via delta-sync,
 *    and read them back
 * ✅ Record a payment, via the recordPayment Cloud Function — never a
 *    direct Firestore write (see recordPayment below for why)
 *
 * Does NOT:
 * ❌ Call Firestore directly for invoice writes (that's the
 *    recordPayment Cloud Function's job — see functions/src/recordPayment.ts)
 * --------------------------------------------------------------------
 */

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { financeRepository, PaymentFilters } from "@/repositories/finance/financeRepository";
import { financeCache } from "@/services/finance/financeCache";
import {
  Invoice,
  InvoiceStatus,
  InvoiceTerm,
  PaymentInput,
  PaymentRecord,
  RecordPaymentResult,
  TermStatus,
} from "@/types/finance";

/**
 * ----------------------------------------------------
 * Safely coerces a raw Firestore timestamp field into a plain
 * epoch-millisecond number. Same rationale as the identical helper
 * in services/students/studentsService.ts — see there for the full
 * explanation of why this conversion happens here rather than
 * trusting a `Timestamp` object to survive being cached/rendered.
 * ----------------------------------------------------
 */
function toMillis(value: unknown): number {
  if (typeof value === "number") return value;
  if (
    value &&
    typeof value === "object" &&
    "seconds" in value &&
    typeof (value as { seconds: unknown }).seconds === "number"
  ) {
    const seconds = (value as { seconds: number }).seconds;
    const nanoseconds =
      "nanoseconds" in value && typeof (value as { nanoseconds: unknown }).nanoseconds === "number"
        ? (value as { nanoseconds: number }).nanoseconds
        : 0;
    return seconds * 1000 + Math.round(nanoseconds / 1e6);
  }
  return 0;
}

function normalizeTerm(raw: Record<string, unknown>): InvoiceTerm {
  return {
    id: (raw.id as string) || "",
    name: (raw.name as string) || (raw.id as string) || "Term",
    amount: (raw.amount as number) ?? 0,
    paidAmount: (raw.paidAmount as number) ?? 0,
    status: (raw.status as TermStatus) || "unpaid",
  };
}

function normalizeInvoice(id: string, data: Record<string, unknown>): Invoice {
  const summary = (data.summary as Record<string, unknown>) || {};
  const snapshot = (data.studentSnapshot as Record<string, unknown>) || undefined;

  // Accept legacy documents that still use the old "schedules" field
  // name — new documents should always write "terms".
  const rawTerms =
    (data.terms as Record<string, unknown>[] | undefined) ??
    (data.schedules as Record<string, unknown>[] | undefined) ??
    [];

  return {
    id,
    studentId: (data.studentId as string) || "",
    academicYear: (data.academicYear as string) || "",
    className: (data.className as string) || "",
    status: (data.status as InvoiceStatus) || "unpaid",
    paidAmount: (data.paidAmount as number) ?? 0,
    balanceAmount: (data.balanceAmount as number) ?? 0,
    summary: {
      total: (summary.total as number) ?? 0,
      tuition: (summary.tuition as number) ?? 0,
      books: (summary.books as number) ?? 0,
      misc: (summary.misc as number) ?? 0,
      transport: (summary.transport as number) ?? 0,
    },
    studentSnapshot: snapshot
      ? {
          name: snapshot.name as string | undefined,
          section: snapshot.section as string | undefined,
          fatherPhone: snapshot.fatherPhone as string | undefined,
        }
      : undefined,
    terms: rawTerms.map(normalizeTerm),
    updatedAt: toMillis(data.updatedAt),
  };
}

/**
 * Normalizes a raw payments/{id} document — same field names
 * recordPayment.ts writes (see that file's tx.set call): invoiceId,
 * studentId, termId, amount, mode, referenceNumber, note, recordedBy,
 * recordedAt. This is an audit record, never edited after creation,
 * so normalization here is defensive against missing/legacy fields
 * only, not against anything actively changing shape over time.
 */
function normalizePayment(id: string, data: Record<string, unknown>): PaymentRecord {
  return {
    id,
    invoiceId: (data.invoiceId as string) || "",
    studentId: (data.studentId as string) || "",
    termId: (data.termId as string) || "",
    amount: (data.amount as number) ?? 0,
    mode: (data.mode as PaymentRecord["mode"]) || "cash",
    referenceNumber: (data.referenceNumber as string | null) ?? null,
    note: (data.note as string | null) ?? null,
    recordedBy: (data.recordedBy as string) || "",
    recordedAt: toMillis(data.recordedAt),
  };
}

export class FinanceService {
  /**
   * ----------------------------------------------------
   * Live subscription to a school's invoices, normalized.
   *
   * Used by the payment-collection flow (finance/collect) — NOT by
   * the Finance dashboard page, which uses syncInvoices below
   * instead. Kept as a live listener here specifically because
   * finance/collect needs to see other staff's payments in real time.
   * ----------------------------------------------------
   */
  subscribeToInvoices(
    schoolId: string,
    callback: (invoices: Invoice[]) => void
  ): () => void {
    return financeRepository.subscribeToInvoices(schoolId, (docs) => {
      callback(docs.map((d) => normalizeInvoice(d.id, d.data)));
    });
  }

  /**
   * ----------------------------------------------------
   * Live subscription to today's payments (local midnight to now),
   * normalized, newest first. Powers the Collect Fee page's "Today's
   * Collections" panel. "Today" is computed from the browser's local
   * time — fine for a single-country (India) product; see
   * repositories/finance/financeRepository.ts if this ever needs to
   * be timezone-aware server-side instead.
   * ----------------------------------------------------
   */
  subscribeToTodaysPayments(
    schoolId: string,
    callback: (payments: PaymentRecord[]) => void
  ): () => void {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    return financeRepository.subscribeToPaymentsSince(
      schoolId,
      startOfToday.getTime(),
      50,
      (docs) => callback(docs.map((d) => normalizePayment(d.id, d.data)))
    );
  }

  /**
   * ----------------------------------------------------
   * One-time, filtered fetch of payments, normalized, newest first.
   * Powers the Payment History page. Not live — see
   * FinanceRepository.getPayments for why.
   * ----------------------------------------------------
   */
  async getPayments(
    schoolId: string,
    filters: PaymentFilters,
    limitCount = 200
  ): Promise<PaymentRecord[]> {
    const docs = await financeRepository.getPayments(schoolId, filters, limitCount);
    return docs.map((d) => normalizePayment(d.id, d.data));
  }

  /**
   * ----------------------------------------------------
   * The Finance dashboard's data source. Syncs the local IndexedDB
   * cache with Firestore via delta-sync (only fetches invoices
   * updated since the last sync — everything, on a cold cache),
   * then returns the full cached invoice set.
   *
   * Same model as StudentsService.syncStudents — see there for the
   * full rationale. Call this on page open, and on a manual
   * "Refresh" click; there's no live listener backing the dashboard
   * page, so a colleague's payment won't appear until the next sync.
   * ----------------------------------------------------
   */
  async syncInvoices(schoolId: string): Promise<Invoice[]> {
    const lastSyncedAt = await financeCache.getLastSyncedAt(schoolId);
    const updatedDocs = await financeRepository.getInvoicesUpdatedSince(schoolId, lastSyncedAt);
    const updatedInvoices = updatedDocs.map((d) => normalizeInvoice(d.id, d.data));

    if (updatedInvoices.length > 0) {
      await financeCache.upsertMany(schoolId, updatedInvoices);
      const newWatermark = Math.max(lastSyncedAt, ...updatedInvoices.map((i) => i.updatedAt));
      await financeCache.setLastSyncedAt(schoolId, newWatermark);
    }

    return financeCache.getAll(schoolId);
  }

  /**
   * ----------------------------------------------------
   * A single student's invoice, normalized — one targeted document
   * read. Used by the payment-collection flow when a student is
   * selected, instead of subscribing to every invoice in the school.
   * ----------------------------------------------------
   */
  async getInvoiceForStudent(schoolId: string, studentId: string): Promise<Invoice | null> {
    const doc = await financeRepository.getInvoiceForStudent(schoolId, studentId);
    return doc ? normalizeInvoice(doc.id, doc.data) : null;
  }

  /**
   * ----------------------------------------------------
   * Record a payment against a term.
   *
   * Calls the recordPayment Cloud Function (functions/src/recordPayment.ts)
   * rather than writing to Firestore directly — see that file for why:
   * short version, this is a money operation, the amount and every
   * derived total must be validated and computed server-side, not
   * trusted from the client.
   *
   * The caller (finance/collect page) should re-sync afterward — this
   * doesn't update the local cache itself, since finance/collect uses
   * a live listener (subscribeToInvoices), not the cache, so it'll see
   * the change automatically once the transaction commits.
   * ----------------------------------------------------
   */
  async recordPayment(schoolId: string, input: PaymentInput): Promise<RecordPaymentResult> {
    const callable = httpsCallable<
      PaymentInput & { schoolId: string },
      RecordPaymentResult
    >(functions, "recordPayment");

    const response = await callable({ schoolId, ...input });
    return response.data;
  }
}

export const financeService = new FinanceService();