/**
 * --------------------------------------------------------------------
 * File:
 * app/(dashboard)/finance/collect/page.tsx
 *
 * Purpose:
 * Search for a student, view their invoice and term-by-term balance,
 * and record a payment against a term.
 *
 * Status:
 * Fully wired. Search + invoice display are live Firestore data (via
 * studentsService / financeService). "Record Payment" calls the
 * recordPayment Cloud Function (functions/src/recordPayment.ts) —
 * amount validation and every derived total (term status, invoice
 * paidAmount/balanceAmount/status) happen server-side in a
 * transaction, not from this page directly.
 * --------------------------------------------------------------------
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { studentsService } from "@/services/students/studentsService";
import { financeService } from "@/services/finance/financeService";
import { Student } from "@/types/students";
import { Invoice, InvoiceTerm, PaymentMode, PaymentRecord } from "@/types/finance";
import { AlertCircle, Search, User, IndianRupee, CheckCircle2, Clock } from "lucide-react";
import Link from "next/link";

const PAYMENT_MODES: { value: PaymentMode; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "cheque", label: "Cheque" },
  { value: "bank_transfer", label: "Bank Transfer" },
];

export default function FeeCollectionPage() {
  const { profile } = useAuth();
  const schoolId = profile?.schoolId ?? "";

  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);

  const [selectedTermId, setSelectedTermId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<PaymentMode>("cash");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [successReceiptId, setSuccessReceiptId] = useState("");

  const [todaysPayments, setTodaysPayments] = useState<PaymentRecord[]>([]);

  // Live, not synced/cached — this is the whole point of the panel:
  // seeing a colleague's payment land in real time. Scoped to today
  // and capped at 50 by the service, so this stays cheap regardless
  // of how long the page is left open.
  useEffect(() => {
    if (!schoolId) return;
    const unsub = financeService.subscribeToTodaysPayments(schoolId, setTodaysPayments);
    return () => unsub();
  }, [schoolId]);

  const studentsById = useMemo(() => {
    const map = new Map<string, Student>();
    students.forEach((s) => map.set(s.id, s));
    return map;
  }, [students]);

  const todaysTotal = useMemo(
    () => todaysPayments.reduce((sum, p) => sum + p.amount, 0),
    [todaysPayments]
  );

  // Students come from the same local cache the Students admin page
  // uses (see studentsService.syncStudents) — a delta-sync, not a
  // live full-collection listener. If the cache is already warm
  // (e.g. someone opened the Students page earlier), this is near
  // instant; on a cold cache it downloads once, same as there.
  useEffect(() => {
    if (!schoolId) return;
    setLoading(true);
    studentsService
      .syncStudents(schoolId)
      .then(setStudents)
      .finally(() => setLoading(false));
  }, [schoolId]);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return students
      .filter(
        (s) =>
          s.profile.name.toLowerCase().includes(q) ||
          s.profile.rollNo.toLowerCase().includes(q) ||
          s.parent.fatherPhone.includes(q)
      )
      .slice(0, 8);
  }, [students, search]);

  const nextUnpaidTerm = useMemo(
    () => invoice?.terms.find((t) => t.status !== "paid") ?? invoice?.terms[0] ?? null,
    [invoice]
  );

  function selectStudent(student: Student) {
    setSelectedStudent(student);
    setSearch("");
    setSubmitError("");
    setSuccessReceiptId("");
    setAmount("");
    setReferenceNumber("");
    setInvoice(null);
  }

  // A single targeted document fetch for just this student's invoice —
  // not a live listener on every invoice in the school. See
  // FinanceRepository.getInvoiceForStudent for the full rationale.
  useEffect(() => {
    if (!schoolId || !selectedStudent) return;
    setInvoiceLoading(true);
    financeService
      .getInvoiceForStudent(schoolId, selectedStudent.id)
      .then(setInvoice)
      .finally(() => setInvoiceLoading(false));
  }, [schoolId, selectedStudent]);

  // Default the term selector to the next unpaid term whenever the
  // selected student's invoice changes.
  useEffect(() => {
    setSelectedTermId(nextUnpaidTerm?.id ?? "");
  }, [nextUnpaidTerm]);

  const currency = (n: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(n);

  async function handleRecordPayment() {
    if (!schoolId || !selectedStudent || !invoice || !selectedTermId) return;

    const numericAmount = Number(amount);
    if (!numericAmount || numericAmount <= 0) {
      setSubmitError("Enter a valid amount.");
      return;
    }

    setSubmitting(true);
    setSubmitError("");
    setSuccessReceiptId("");
    try {
      const result = await financeService.recordPayment(schoolId, {
        invoiceId: invoice.id,
        studentId: selectedStudent.id,
        termId: selectedTermId,
        amount: numericAmount,
        mode,
        referenceNumber: referenceNumber || undefined,
      });

      // Patch the already-known new totals in locally instead of
      // re-fetching — the Cloud Function already computed and
      // returned exactly what changed, so a second read would just
      // be paying to re-learn numbers we already have.
      setInvoice((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          paidAmount: result.newInvoicePaid,
          balanceAmount: result.newInvoiceBalance,
          status: result.newInvoiceStatus,
          terms: prev.terms.map((t) =>
            t.id === selectedTermId
              ? { ...t, paidAmount: t.paidAmount + numericAmount, status: result.newTermStatus }
              : t
          ),
        };
      });

      setSuccessReceiptId(result.receiptId);
      setAmount("");
      setReferenceNumber("");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to record payment.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="rounded-3xl bg-white p-6 shadow-sm">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Collect Fee</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Search a student to view their invoice and record a payment.
          </p>
        </div>

        {/* ── Today's Collections ──────────────────────────────────── */}
        <div className="rounded-3xl bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-zinc-400" />
              <p className="text-sm font-semibold text-zinc-900">Today's Collections</p>
            </div>
            <Link
              href="/finance/payments"
              className="text-xs font-semibold text-zinc-500 hover:text-zinc-700"
            >
              View full history →
            </Link>
          </div>

          <div className="mt-4 flex items-baseline gap-3">
            <p className="text-2xl font-bold text-zinc-900">{currency(todaysTotal)}</p>
            <p className="text-xs text-zinc-500">
              {todaysPayments.length} payment{todaysPayments.length === 1 ? "" : "s"} today
            </p>
          </div>

          {todaysPayments.length > 0 && (
            <div className="mt-4 divide-y divide-zinc-100 border-t border-zinc-100">
              {todaysPayments.slice(0, 5).map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-900">
                      {studentsById.get(p.studentId)?.profile.name ?? "Unknown student"}
                    </p>
                    <p className="text-xs capitalize text-zinc-500">
                      {p.mode.replace("_", " ")} ·{" "}
                      {new Date(p.recordedAt).toLocaleTimeString("en-IN", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold text-emerald-700">
                    {currency(p.amount)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Search ────────────────────────────────────────────────── */}
        <div className="relative rounded-3xl bg-white p-5 shadow-sm">
          <div className="relative">
            <Search className="absolute left-4 top-3.5 h-4 w-4 text-zinc-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by student name, roll no, or parent phone"
              className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 py-3 pl-11 pr-4 text-sm outline-none transition focus:border-zinc-400"
            />
          </div>

          {searchResults.length > 0 && (
            <div className="absolute left-5 right-5 top-full z-10 mt-2 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-lg">
              {searchResults.map((s) => (
                <button
                  key={s.id}
                  onClick={() => selectStudent(s)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-zinc-50"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500">
                    <User className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-900">{s.profile.name}</p>
                    <p className="truncate text-xs text-zinc-500">
                      Class {s.className}{s.section ? ` / ${s.section}` : ''} · {s.parent.fatherPhone || "No phone"}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Selected student / invoice ───────────────────────────── */}
        {!selectedStudent && !loading && (
          <div className="rounded-3xl bg-white p-12 text-center shadow-sm">
            <p className="text-sm text-zinc-500">Search for a student above to get started.</p>
          </div>
        )}

        {selectedStudent && (
          <div className="rounded-3xl bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-zinc-900">{selectedStudent.profile.name}</h2>
                <p className="text-sm text-zinc-500">
                  Class {selectedStudent.className}{selectedStudent.section ? ` / ${selectedStudent.section}` : ''} ·{" "}
                  {selectedStudent.profile.rollNo ? `Roll #${selectedStudent.profile.rollNo}` : "No roll no"}
                </p>
              </div>
              <button
                onClick={() => setSelectedStudent(null)}
                className="rounded-xl border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:border-zinc-300"
              >
                Change student
              </button>
            </div>

            {invoiceLoading ? (
              <div className="mt-6 flex items-center gap-2 rounded-2xl bg-zinc-50 px-4 py-3 text-sm text-zinc-500">
                Loading invoice…
              </div>
            ) : !invoice ? (
              <div className="mt-6 flex items-center gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
                <AlertCircle className="h-4 w-4 shrink-0" />
                No invoice found for this student yet.
              </div>
            ) : (
              <>
                {/* Summary */}
                <div className="mt-6 grid grid-cols-3 gap-3">
                  <div className="rounded-2xl bg-zinc-50 p-4">
                    <p className="text-xs text-zinc-500">Total</p>
                    <p className="mt-1 text-lg font-bold text-zinc-900">{currency(invoice.summary.total)}</p>
                  </div>
                  <div className="rounded-2xl bg-emerald-50 p-4">
                    <p className="text-xs text-emerald-700">Paid</p>
                    <p className="mt-1 text-lg font-bold text-emerald-700">{currency(invoice.paidAmount)}</p>
                  </div>
                  <div className="rounded-2xl bg-red-50 p-4">
                    <p className="text-xs text-red-600">Balance</p>
                    <p className="mt-1 text-lg font-bold text-red-600">{currency(invoice.balanceAmount)}</p>
                  </div>
                </div>

                {/* Terms breakdown */}
                <div className="mt-6">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Terms</p>
                  <div className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-100">
                    {invoice.terms.map((term) => (
                      <TermRow key={term.id} term={term} currency={currency} />
                    ))}
                  </div>
                </div>

                {/* Record payment form */}
                <div className="mt-6 rounded-2xl border border-zinc-200 p-5">
                  <p className="mb-4 text-sm font-semibold text-zinc-900">Record Payment</p>

                  {submitError && (
                    <div className="mb-4 flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-600">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      {submitError}
                    </div>
                  )}

                  {successReceiptId && (
                    <div className="mb-4 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      Payment recorded — receipt #{successReceiptId.slice(0, 8)}
                    </div>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        Term
                      </label>
                      <select
                        value={selectedTermId}
                        onChange={(e) => setSelectedTermId(e.target.value)}
                        className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm outline-none"
                      >
                        {invoice.terms.map((term) => (
                          <option key={term.id} value={term.id}>
                            {term.name} — Balance {currency(term.amount - term.paidAmount)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        Amount
                      </label>
                      <div className="relative">
                        <IndianRupee className="absolute left-3 top-3 h-3.5 w-3.5 text-zinc-400" />
                        <input
                          type="number"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          placeholder="0"
                          className="w-full rounded-xl border border-zinc-200 bg-zinc-50 py-2.5 pl-8 pr-3 text-sm outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        Mode
                      </label>
                      <select
                        value={mode}
                        onChange={(e) => setMode(e.target.value as PaymentMode)}
                        className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm outline-none"
                      >
                        {PAYMENT_MODES.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        Reference No. (optional)
                      </label>
                      <input
                        value={referenceNumber}
                        onChange={(e) => setReferenceNumber(e.target.value)}
                        placeholder="Transaction / cheque no."
                        className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm outline-none"
                      />
                    </div>
                  </div>

                  <button
                    onClick={handleRecordPayment}
                    disabled={submitting}
                    className="mt-4 w-full rounded-xl bg-zinc-900 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-50"
                  >
                    {submitting ? "Recording..." : "Record Payment"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TermRow({
  term,
  currency,
}: {
  term: InvoiceTerm;
  currency: (n: number) => string;
}) {
  const styles: Record<InvoiceTerm["status"], string> = {
    paid: "bg-emerald-100 text-emerald-700",
    partial: "bg-amber-100 text-amber-700",
    unpaid: "bg-red-100 text-red-700",
  };

  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div>
        <p className="text-sm font-medium text-zinc-900">{term.name}</p>
        <p className="text-xs text-zinc-500">
          {currency(term.paidAmount)} of {currency(term.amount)} paid
        </p>
      </div>
      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${styles[term.status]}`}>
        {term.status}
      </span>
    </div>
  );
}