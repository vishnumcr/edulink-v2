/**
 * --------------------------------------------------------------------
 * File:
 * app/(dashboard)/finance/payments/page.tsx
 *
 * Purpose:
 * Full, filterable history of every payment recorded at this school —
 * an audit/reporting view, distinct from Collect Fee's "Today's
 * Collections" panel (live, today-only, built for the person actively
 * taking payments) and from Fee Records' per-invoice snapshot view.
 *
 * Not a live listener — see FinanceRepository.getPayments for why.
 * Refetches on filter change and via the manual Refresh button.
 * --------------------------------------------------------------------
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { studentsService } from "@/services/students/studentsService";
import { financeService } from "@/services/finance/financeService";
import { Student } from "@/types/students";
import { PaymentMode, PaymentRecord } from "@/types/finance";
import { Receipt, Search, RefreshCw, IndianRupee, Users, Calendar } from "lucide-react";

const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  cheque: "Cheque",
  bank_transfer: "Bank Transfer",
};

export default function PaymentHistoryPage() {
  const { profile } = useAuth();
  const schoolId = profile?.schoolId ?? "";

  const [students, setStudents] = useState<Student[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState("");
  const [modeFilter, setModeFilter] = useState<"all" | PaymentMode>("all");
  const [startDate, setStartDate] = useState(""); // yyyy-mm-dd
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    if (!schoolId) return;
    studentsService.syncStudents(schoolId).then(setStudents);
  }, [schoolId]);

  const studentsById = useMemo(() => {
    const map = new Map<string, Student>();
    students.forEach((s) => map.set(s.id, s));
    return map;
  }, [students]);

  async function loadPayments() {
    if (!schoolId) return;
    setRefreshing(true);
    try {
      const startMs = startDate ? new Date(`${startDate}T00:00:00`).getTime() : undefined;
      // Inclusive end-of-day, not midnight — a filter for "up to
      // today" should include payments recorded any time today.
      const endMs = endDate ? new Date(`${endDate}T23:59:59.999`).getTime() : undefined;

      const result = await financeService.getPayments(schoolId, { startMs, endMs });
      setPayments(result);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId, startDate, endDate]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return payments.filter((p) => {
      if (modeFilter !== "all" && p.mode !== modeFilter) return false;
      if (!q) return true;
      const student = studentsById.get(p.studentId);
      return (
        student?.profile.name.toLowerCase().includes(q) ||
        student?.profile.rollNo.toLowerCase().includes(q) ||
        p.referenceNumber?.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q)
      );
    });
  }, [payments, search, modeFilter, studentsById]);

  const totalAmount = useMemo(() => filtered.reduce((sum, p) => sum + p.amount, 0), [filtered]);

  const currency = (n: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(n);

  return (
    <div className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between rounded-3xl bg-white p-6 shadow-sm">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Payment History</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Every payment recorded at this school — search, filter, and review.
            </p>
          </div>
          <button
            onClick={loadPayments}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-xl border border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-600 transition hover:border-zinc-300 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {/* ── Stats ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard title="Payments" value={filtered.length.toString()} icon={<Receipt className="h-5 w-5" />} />
          <StatCard title="Total Collected" value={currency(totalAmount)} icon={<IndianRupee className="h-5 w-5" />} />
          <StatCard
            title="Unique Students"
            value={new Set(filtered.map((p) => p.studentId)).size.toString()}
            icon={<Users className="h-5 w-5" />}
          />
        </div>

        {/* ── Filters ───────────────────────────────────────────────── */}
        <div className="rounded-3xl bg-white p-5 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="relative sm:col-span-2">
              <Search className="absolute left-3.5 top-3 h-4 w-4 text-zinc-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search student, roll no, or reference no."
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-zinc-400"
              />
            </div>

            <select
              value={modeFilter}
              onChange={(e) => setModeFilter(e.target.value as "all" | PaymentMode)}
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm outline-none"
            >
              <option value="all">All modes</option>
              {Object.entries(PAYMENT_MODE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>

            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 shrink-0 text-zinc-400" />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 py-2.5 text-xs outline-none"
              />
              <span className="text-xs text-zinc-400">to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 py-2.5 text-xs outline-none"
              />
            </div>
          </div>
        </div>

        {/* ── Table ─────────────────────────────────────────────────── */}
        <div className="overflow-hidden rounded-3xl bg-white shadow-sm">
          {loading ? (
            <div className="p-12 text-center text-sm text-zinc-500">Loading payments…</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-sm text-zinc-500">
              No payments found for these filters.
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-100 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-5 py-3">Student</th>
                  <th className="px-5 py-3">Amount</th>
                  <th className="px-5 py-3">Mode</th>
                  <th className="px-5 py-3">Reference</th>
                  <th className="px-5 py-3">Recorded</th>
                  <th className="px-5 py-3">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filtered.map((p) => {
                  const student = studentsById.get(p.studentId);
                  return (
                    <tr key={p.id} className="hover:bg-zinc-50">
                      <td className="px-5 py-3">
                        <p className="font-medium text-zinc-900">{student?.profile.name ?? "Unknown student"}</p>
                        {student && (
                          <p className="text-xs text-zinc-500">
                            Class {student.className}{student.section ? ` / ${student.section}` : ""}
                          </p>
                        )}
                      </td>
                      <td className="px-5 py-3 font-semibold text-emerald-700">{currency(p.amount)}</td>
                      <td className="px-5 py-3 capitalize text-zinc-600">{p.mode.replace("_", " ")}</td>
                      <td className="px-5 py-3 text-zinc-500">{p.referenceNumber || "—"}</td>
                      <td className="px-5 py-3 text-zinc-500">
                        {new Date(p.recordedAt).toLocaleString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-zinc-400">{p.id.slice(0, 8)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-zinc-500">{title}</p>
          <h3 className="mt-2 text-2xl font-bold text-zinc-900">{value}</h3>
        </div>
        <div className="rounded-2xl bg-zinc-100 p-3 text-zinc-700">{icon}</div>
      </div>
    </div>
  );
}