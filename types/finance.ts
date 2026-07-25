/**
 * --------------------------------------------------------------------
 * File:
 * types/finance.ts
 *
 * Purpose:
 * Shared types for the Finance feature (invoices).
 *
 * Firestore document:
 * schools/{schoolId}/invoices/{invoiceId}
 *
 * Terminology: "term" is used throughout instead of "milestone" or
 * "schedule" — matches how Indian schools actually talk about fee
 * periods (Term 1, Term 2, ...), rather than a more generic/technical
 * word.
 * --------------------------------------------------------------------
 */

export type InvoiceStatus = "paid" | "partial" | "unpaid";
export type TermStatus = "paid" | "partial" | "unpaid";

/**
 * A single term's dues within an invoice (e.g. "Term 1").
 */
export interface InvoiceTerm {
  id: string;
  name: string;
  amount: number;
  paidAmount: number;
  status: TermStatus;
}

export interface InvoiceSummary {
  total: number;
  tuition: number;
  books: number;
  misc: number;
  transport: number;
}

export interface InvoiceStudentSnapshot {
  name?: string;
  section?: string;
  fatherPhone?: string;
}

export interface Invoice {
  id: string;
  studentId: string;
  academicYear: string;
  className: string;
  status: InvoiceStatus;
  paidAmount: number;
  balanceAmount: number;
  summary: InvoiceSummary;
  studentSnapshot?: InvoiceStudentSnapshot;
  terms: InvoiceTerm[];
  /**
   * Plain epoch-millisecond number, not a Firestore Timestamp — same
   * normalization-boundary conversion as Student.updatedAt (see
   * types/students.ts for why).
   *
   * ⚠️ REQUIREMENT FOR WHOEVER BUILDS THE INVOICE-WRITING CLOUD
   * FUNCTION: this field must be set via serverTimestamp() on every
   * write, INCLUDING invoice creation/generation, not just payment
   * updates. The Finance dashboard's local cache (financeCache.ts)
   * does delta-sync via `where("updatedAt", ">", lastSync)` — a
   * Firestore inequality query silently excludes documents where the
   * field doesn't exist at all, so an invoice missing this field
   * would be permanently invisible to sync and never show up on the
   * dashboard. This bit the Students feature for exactly this reason
   * (see StudentsRepository.createStudent) — don't repeat it here.
   */
  updatedAt: number;
}

/**
 * How many rows the Finance table renders per page — a pure
 * UI/rendering concern, not a Firestore query param. The full
 * invoice set is cached and filtered/sorted in memory; this just
 * slices the already-filtered array so the table doesn't render
 * thousands of DOM rows at once.
 */
export const INVOICES_PAGE_SIZE = 100;

/**
 * -------------------------------------------------------
 * Payment collection.
 *
 * Recording a payment is a money operation — per the
 * CRUD-vs-Cloud-Function rule, this must be written by a Cloud
 * Function (validating the amount server-side, then atomically
 * updating the payment, invoice, term status, and receipt), never
 * directly from the client. These types describe the request/response
 * shape that function will eventually expose; FinanceService.recordPayment
 * is currently a stub until that function exists.
 * -------------------------------------------------------
 */
export type PaymentMode = "cash" | "upi" | "card" | "cheque" | "bank_transfer";

export interface PaymentInput {
  invoiceId: string;
  studentId: string;
  termId: string;
  amount: number;
  mode: PaymentMode;
  referenceNumber?: string;
  note?: string;
}

/** What the recordPayment Cloud Function returns on success. */
export interface RecordPaymentResult {
  success: true;
  receiptId: string;
  newTermStatus: TermStatus;
  newInvoiceStatus: InvoiceStatus;
  newInvoicePaid: number;
  newInvoiceBalance: number;
}

/**
 * schools/{schoolId}/payments/{paymentId} — an immutable audit record
 * of one payment transaction, written by the recordPayment Cloud
 * Function alongside the invoice update. The invoice document only
 * ever holds current totals; this collection is the history (receipts,
 * "who recorded what, when"). Never written to directly by the client
 * — see functions/src/recordPayment.ts.
 */
export interface PaymentRecord {
  id: string;
  invoiceId: string;
  studentId: string;
  termId: string;
  amount: number;
  mode: PaymentMode;
  referenceNumber: string | null;
  note: string | null;
  recordedBy: string;
  recordedAt: number;
}/**
 * -------------------------------------------------------------------
 * Fee structure (settings/fees).
 *
 * Firestore document:
 * schools/{schoolId}/feeStructure/current
 *
 * This is school configuration data, not a money movement — CRUD
 * rather than a business transaction, so unlike payments it's fine to
 * read/write directly through the client SDK per the CRUD-vs-Cloud-
 * Function rule. Firestore rules should still restrict writes to
 * admin/finance-staff roles.
 *
 * "Term" terminology matches InvoiceTerm above, not "milestone" or
 * "schedule".
 * -------------------------------------------------------------------
 */

export type FeeCategory = "tuition" | "transport" | "books" | "misc";
export type FeeScheduleMode = "scheduled" | "flexible";

/**
 * Annual tuition amount for one class. One entry per class label,
 * kept in sync with the Academic feature's class list.
 */
export interface TuitionEntry {
  classLabel: string;
  amount: number;
}

/**
 * One-time annual book charge for one class.
 */
export interface BooksEntry {
  classLabel: string;
  amount: number;
  note: string;
}

/**
 * A single ad-hoc fee item (exam, sports, lab, etc.).
 */
export interface MiscFee {
  id: string;
  name: string;
  amount: number;
  applicableTo: "all" | "class" | "optional";
  /** Only set when applicableTo === "class". */
  classLabel?: string;
  frequency: "once" | "monthly" | "annual";
  isActive: boolean;
}

/**
 * A single installment within a "scheduled" fee schedule.
 * Uses deterministic ids (term_1, term_2, ...) rather than random
 * ones, matching the term ids invoices already reference.
 */
export interface FeeTerm {
  id: string;
  name: string;
  dueDate: string;
}

/**
 * How fees are collected for the academic year — either as fixed
 * installments ("scheduled") or a single open balance due by a date
 * ("flexible").
 */
export interface FeeSchedule {
  mode: FeeScheduleMode;
  /** Only meaningful when mode === "scheduled". */
  termCount: number;
  terms: FeeTerm[];
  /** Only meaningful when mode === "flexible". */
  flexibleDueDate: string;
  finalDueDate: string;
}

/**
 * A one-time, school-wide fee collected to confirm a seat — paid
 * BEFORE a student record (and therefore any invoice) exists, as the
 * gate in the admission-approval flow. Deliberately NOT a MiscFee:
 * misc fees are additional line items billed to students who already
 * have an invoice; this is the thing that creates that invoice in the
 * first place. Flat school-wide amount (not per-class) for now — see
 * the admission-flow planning conversation this was designed from.
 */
export interface AdmissionFeeConfig {
  amount: number;
  /** Many schools don't charge one at all — must be explicitly toggleable off, not forced to a positive value. */
  isActive: boolean;
}

/**
 * The full fee structure document for a school.
 *
 * Note: changing this document only affects future invoice
 * generation. Existing invoices under schools/{schoolId}/invoices are
 * immutable point-in-time snapshots and are never retroactively
 * updated when the structure changes.
 */
export interface FeeStructureDoc {
  tuition: TuitionEntry[];
  books: BooksEntry[];
  misc: MiscFee[];
  schedule: FeeSchedule;
  admissionFee: AdmissionFeeConfig;
}