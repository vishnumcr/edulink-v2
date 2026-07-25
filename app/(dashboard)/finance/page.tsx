/**
 * --------------------------------------------------------------------
 * File:
 * app/(dashboard)/finance/page.tsx
 *
 * Changes from the original:
 * - No direct Firestore calls — routes through financeService.
 * - "schedules"/"milestone" renamed to "terms" throughout, matching
 *   how Indian schools actually refer to fee periods.
 * - Term filter options are now derived from whatever terms actually
 *   exist across the loaded invoices, instead of being hardcoded to
 *   exactly term_1/term_2/term_3 — schools with 2 or 4 terms would
 *   otherwise have been unfilterable.
 * --------------------------------------------------------------------
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { financeService } from "@/services/finance/financeService";
import { studentsService } from "@/services/students/studentsService";
import { Invoice, InvoiceStatus, INVOICES_PAGE_SIZE } from "@/types/finance";
import { Student } from "@/types/students";
import { Search, IndianRupee, Users, AlertCircle, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";

export default function FinanceDashboardPage() {
  const { profile } = useAuth();
  const schoolId = profile?.schoolId ?? "";

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [studentsById, setStudentsById] = useState<Map<string, Student>>(new Map());
  const [lastSynced, setLastSynced] = useState<number | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | InvoiceStatus>("all");
  const [classFilter, setClassFilter] = useState("all");
  const [termFilter, setTermFilter] = useState("all");
  const [percentageFilter, setPercentageFilter] = useState("");
  const [percentageMode, setPercentageMode] = useState<"less" | "greater">("less");
  const [mode, setMode] = useState<"term" | "annual">("term");
  const [pageNum, setPageNum] = useState(0);

  // ── Sync the local cache on open, and expose a manual refresh ──────────
  // No live listener here — see financeCache.ts for why. A colleague's
  // payment won't show up until the next sync (page open or Refresh).
  //
  // Also syncs Students in parallel — invoices store studentId, not a
  // duplicated copy of the student's name/phone, so this page needs
  // fresh student data to display against. Both syncs are cheap delta
  // queries (see the students/finance caching conversation), so doing
  // both here doesn't meaningfully change the cost of opening this page.
  async function refreshInvoices() {
    if (!schoolId) return;
    try {
      const [invoiceResult] = await Promise.all([
        financeService.syncInvoices(schoolId),
        studentsService.syncStudents(schoolId),
      ]);
      const studentsMap = await studentsService.getCachedStudentsMap(schoolId);
      setInvoices(invoiceResult);
      setStudentsById(studentsMap);
      setLastSynced(Date.now());
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    if (!schoolId) return;
    setLoading(true);
    refreshInvoices().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  async function handleManualRefresh() {
    setRefreshing(true);
    await refreshInvoices();
    setRefreshing(false);
  }

  /**
   * Prefers the live cached student record over the invoice's stored
   * studentSnapshot — falls back to the snapshot only if that student
   * isn't in the cache at all (cold cache, or a cross-device visit
   * that hasn't synced students yet). See the file-level rationale
   * above for why this isn't a pure live join.
   */
  function getStudentDisplay(invoice: Invoice) {
    const student = studentsById.get(invoice.studentId);
    return {
      name: student?.profile.name || invoice.studentSnapshot?.name || invoice.studentId,
      phone: student?.parent.fatherPhone || invoice.studentSnapshot?.fatherPhone || "No Phone",
    };
  }

  const classes = useMemo(() => {
    return [...new Set(invoices.map((i) => i.className))];
  }, [invoices]);

  // Term filter options, derived from whatever terms are actually
  // present across the loaded invoices — not a hardcoded term count.
  const termOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const invoice of invoices) {
      for (const term of invoice.terms) {
        if (term.id && !seen.has(term.id)) {
          seen.set(term.id, term.name);
        }
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [invoices]);

  const filtered = useMemo(() => {
    return invoices.filter((invoice) => {
      const { name, phone } = getStudentDisplay(invoice);

      const searchMatch =
        name.toLowerCase().includes(search.toLowerCase()) ||
        phone.includes(search) ||
        invoice.studentId.toLowerCase().includes(search.toLowerCase());

      const statusMatch = statusFilter === "all" || invoice.status === statusFilter;

      const classMatch = classFilter === "all" || invoice.className === classFilter;

      let termMatch = true;
      if (mode === "term" && termFilter !== "all") {
        const term = invoice.terms.find((t) => t.id === termFilter);
        termMatch = !!term && term.status !== "paid";
      }

      let percentageMatch = true;
      if (mode === "annual" && percentageFilter) {
        const percent =
          invoice.summary.total > 0
            ? (invoice.paidAmount / invoice.summary.total) * 100
            : 0;
        const target = Number(percentageFilter);
        percentageMatch = percentageMode === "less" ? percent < target : percent > target;
      }

      return searchMatch && statusMatch && classMatch && termMatch && percentageMatch;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, studentsById, search, statusFilter, classFilter, termFilter, percentageFilter, percentageMode, mode]);

  // Reset to page 1 whenever the filtered result set changes shape.
  useEffect(() => { setPageNum(0); }, [search, statusFilter, classFilter, termFilter, percentageFilter, percentageMode, mode]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / INVOICES_PAGE_SIZE));
  const pageInvoices = filtered.slice(pageNum * INVOICES_PAGE_SIZE, (pageNum + 1) * INVOICES_PAGE_SIZE);

  const stats = useMemo(() => {
    const totalStudents = filtered.length;
    const totalCollectable = filtered.reduce((sum, i) => sum + i.summary.total, 0);
    const totalCollected = filtered.reduce((sum, i) => sum + i.paidAmount, 0);
    const outstanding = filtered.reduce((sum, i) => sum + i.balanceAmount, 0);
    const collectionPct =
      totalCollectable > 0 ? ((totalCollected / totalCollectable) * 100).toFixed(1) : "0";

    return { totalStudents, totalCollectable, totalCollected, outstanding, collectionPct };
  }, [filtered]);

  const currency = (n: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(n);

  return (
    <div className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 rounded-3xl bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Fee Collections</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Track dues, collections, unpaid invoices and term progress.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleManualRefresh}
              disabled={refreshing || loading}
              className="flex items-center gap-1.5 rounded-2xl bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-200 disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>

            {lastSynced && (
              <span className="hidden text-xs text-zinc-400 md:inline">
                Synced {new Date(lastSynced).toLocaleTimeString()}
              </span>
            )}

            <button
              onClick={() => setMode("term")}
              className={`rounded-2xl px-5 py-2 text-sm font-semibold transition ${
                mode === "term" ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700"
              }`}
            >
              Term Mode
            </button>

            <button
              onClick={() => setMode("annual")}
              className={`rounded-2xl px-5 py-2 text-sm font-semibold transition ${
                mode === "annual" ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700"
              }`}
            >
              Annual Mode
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatCard title="Students" value={stats.totalStudents.toString()} icon={<Users className="h-5 w-5" />} />
          <StatCard title="Collectable" value={currency(stats.totalCollectable)} icon={<IndianRupee className="h-5 w-5" />} />
          <StatCard title="Collected" value={currency(stats.totalCollected)} icon={<IndianRupee className="h-5 w-5" />} />
          <StatCard title="Outstanding" value={currency(stats.outstanding)} icon={<AlertCircle className="h-5 w-5" />} />
          <StatCard title="Collection %" value={`${stats.collectionPct}%`} icon={<IndianRupee className="h-5 w-5" />} />
        </div>

        <div className="rounded-3xl bg-white p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <div className="relative xl:col-span-2">
              <Search className="absolute left-4 top-3.5 h-4 w-4 text-zinc-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search student, phone, ID"
                className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 py-3 pl-11 pr-4 text-sm outline-none transition focus:border-zinc-400"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "all" | InvoiceStatus)}
              className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none"
            >
              <option value="all">All Status</option>
              <option value="paid">Paid</option>
              <option value="partial">Partial</option>
              <option value="unpaid">Unpaid</option>
            </select>

            <select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none"
            >
              <option value="all">All Classes</option>
              {classes.map((cls) => (
                <option key={cls} value={cls}>
                  Class {cls}
                </option>
              ))}
            </select>

            {mode === "term" ? (
              <select
                value={termFilter}
                onChange={(e) => setTermFilter(e.target.value)}
                className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none"
              >
                <option value="all">All Terms</option>
                {termOptions.map((term) => (
                  <option key={term.id} value={term.id}>
                    {term.name} Pending
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex gap-3">
                <select
                  value={percentageMode}
                  onChange={(e) => setPercentageMode(e.target.value as "less" | "greater")}
                  className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none"
                >
                  <option value="less">Less Than</option>
                  <option value="greater">Greater Than</option>
                </select>

                <input
                  type="number"
                  value={percentageFilter}
                  onChange={(e) => setPercentageFilter(e.target.value)}
                  placeholder="%"
                  className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none"
                />
              </div>
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-3xl bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-100">
              <thead className="bg-zinc-50">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">Student</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">Class</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">Total</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">Paid</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">Balance</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">Collection</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">Status</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">Next Due</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-zinc-100 bg-white">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-16 text-center text-sm text-zinc-500">
                      Loading invoices...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-16 text-center text-sm text-zinc-500">
                      No invoices found.
                    </td>
                  </tr>
                ) : (
                  pageInvoices.map((invoice) => {
                    const pct =
                      invoice.summary.total > 0
                        ? Math.round((invoice.paidAmount / invoice.summary.total) * 100)
                        : 0;

                    const nextDue = invoice.terms.find((t) => t.status !== "paid");
                    const studentDisplay = getStudentDisplay(invoice);

                    return (
                      <tr key={invoice.id} className="transition hover:bg-zinc-50">
                        <td className="px-6 py-5">
                          <div>
                            <p className="font-semibold text-zinc-900">
                              {studentDisplay.name}
                            </p>
                            <p className="mt-1 text-xs text-zinc-500">
                              {studentDisplay.phone}
                            </p>
                          </div>
                        </td>

                        <td className="px-6 py-5 text-sm text-zinc-700">Class {invoice.className}</td>

                        <td className="px-6 py-5 text-sm font-semibold text-zinc-900">
                          {currency(invoice.summary.total)}
                        </td>

                        <td className="px-6 py-5 text-sm text-emerald-600">{currency(invoice.paidAmount)}</td>

                        <td className="px-6 py-5 text-sm font-semibold text-red-500">
                          {currency(invoice.balanceAmount)}
                        </td>

                        <td className="px-6 py-5">
                          <div className="flex items-center gap-3">
                            <div className="h-2 w-28 overflow-hidden rounded-full bg-zinc-200">
                              <div style={{ width: `${pct}%` }} className="h-full rounded-full bg-zinc-900" />
                            </div>
                            <span className="text-sm font-medium text-zinc-700">{pct}%</span>
                          </div>
                        </td>

                        <td className="px-6 py-5">
                          <StatusBadge status={invoice.status} />
                        </td>

                        <td className="px-6 py-5 text-sm text-zinc-700">
                          {nextDue?.name || "Completed"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-zinc-100 px-6 py-4">
            <span className="text-xs text-zinc-400">
              Page {pageNum + 1} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPageNum((p) => Math.max(0, p - 1))}
                disabled={pageNum === 0 || loading}
                className="flex items-center gap-1 rounded-xl border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Prev
              </button>
              <button
                onClick={() => setPageNum((p) => Math.min(totalPages - 1, p + 1))}
                disabled={pageNum >= totalPages - 1 || loading}
                className="flex items-center gap-1 rounded-xl border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 disabled:opacity-40"
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
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

function StatusBadge({ status }: { status: InvoiceStatus }) {
  const styles: Record<InvoiceStatus, string> = {
    paid: "bg-emerald-100 text-emerald-700",
    partial: "bg-amber-100 text-amber-700",
    unpaid: "bg-red-100 text-red-700",
  };

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${styles[status]}`}>
      {status}
    </span>
  );
}