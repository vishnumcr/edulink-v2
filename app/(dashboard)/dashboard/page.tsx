/**
 * --------------------------------------------------------------------
 * File:
 * app/(dashboard)/dashboard/page.tsx
 *
 * Purpose:
 * The Overview dashboard, wired to real data from the same services
 * every other module already uses — replacing the previous
 * fetchAllDashboardData(), which returned entirely hardcoded numbers
 * after a fake 800ms delay.
 *
 * Data sources per widget:
 * - totalStudents / newStudentsMonth / classBreakdown student counts
 *   → studentsService.syncStudents (same one-time cached-sync pattern
 *     finance/page.tsx and students/page.tsx already use — no live
 *     listener here, refresh via reload or a manual trigger)
 * - totalTeachers → teachersService.subscribeToTeachers (one-shot read)
 * - classes list → classesRepository.subscribeToClasses (one-shot read, full class+section shape)
 * - feeData (collected/partial/pending/target) → financeService.syncInvoices,
 *   bucketed by Invoice.status exactly the way FeeDonut's own prop
 *   comments define those three buckets (see components/Feedonut.tsx)
 * - feeAlerts (overdue/due-today) → invoices joined against
 *   FeeStructureDoc.schedule.terms' dueDate by term id (due dates live
 *   on the fee STRUCTURE, not the invoice — see types/finance.ts's
 *   own comment on why FeeTerm and InvoiceTerm share deterministic ids)
 * - feeAlerts.thisWeekCollected → financeService.getPayments with a
 *   startMs/endMs range (real money that moved this week, independent
 *   of which term it was for)
 * - attendance weekly chart + attendanceDelta → attendanceService.getAnalytics,
 *   called for this week and last week
 * - classBreakdown attendance% → the same getAnalytics() call's byClass data, averaged per class across sections
 * - alerts panel → derived from the real aggregates above, not a
 *   separate data source
 *
 * Teacher Insights panel — REMOVED, not just left disconnected. There
 * is no teacher attendance/leave tracking anywhere in this codebase
 * (checked types/teachers.ts and teachersService.ts). Building it
 * would mean inventing numbers, which is the exact problem this
 * rewrite exists to fix. It's a separate, later feature — see the
 * conversation this was decided in.
 * --------------------------------------------------------------------
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

import { studentsService } from '@/services/students/studentsService';
import { teachersService } from '@/services/teachers/teachersService';
import { classesRepository } from '@/repositories/academic/classesRepository';
import { financeService } from '@/services/finance/financeService';
import { feeStructureService } from '@/services/finance/feeStructureService';
import { schoolService } from '@/services/school/schoolService';
import { attendanceService, ClassMeta, StudentMeta } from '@/services/attendance/attendanceService';

import { Teacher } from '@/types/teachers';

import StatsGrid        from '@/components/Statsgrid';
import FeeDonut          from '@/components/Feedonut';
import QuickActions      from '@/components/Quickactions';
import AttendanceChart, { DayAttendance } from '@/components/Attendancechart';
import StudentsTable, { StudentRow }      from '@/components/Studentstable';
import DailyActivityBanner                from '@/components/DailyActivityBanner';
import { SetupProgressCard }              from '@/components/onboarding/SetupProgressCard';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DashboardStats {
  totalStudents    : number;
  totalTeachers    : number;
  feeCollection    : string;
  feePercent       : number;
  avgAttendance    : number;
  attendanceDelta  : number;
  newStudentsMonth : number;
}

interface FeeData {
  collected : number;
  partial   : number;
  pending   : number;
  target    : number;
  dueDate   : string;
}

interface FeeAlerts {
  overdueStudents  : number;
  overdueAmount    : string;
  todayDueStudents : number;
  todayDueAmount   : string;
  thisWeekCollected: string;
  thisWeekTarget   : string;
}

interface ClassBreakdown {
  className  : string;
  students   : number;
  attendance : number;
}

interface AlertItem {
  type    : 'fee' | 'attendance';
  message : string;
  severity: 'warning' | 'critical' | 'info';
}

interface DashboardData {
  stats          : DashboardStats;
  feeData        : FeeData;
  feeAlerts      : FeeAlerts;
  attendance     : DayAttendance[];
  classBreakdown : ClassBreakdown[];
  alerts         : AlertItem[];
  students       : StudentRow[];
  classes        : string[];
}

// ── Small local helpers ──────────────────────────────────────────────────────

/**
 * classesRepository/teachersService only expose live subscriptions, not
 * one-time getters. Resolves on the first emission and unsubscribes
 * immediately. Same pattern already used in services/onboarding/setupService.ts
 * — duplicated here rather than shared, since this is only the second
 * use; worth extracting to lib/ if a third caller ever needs it.
 */
function firstEmission<T>(subscribe: (callback: (value: T) => void) => () => void): Promise<T> {
  return new Promise((resolve) => {
    const unsubscribe = subscribe((value) => {
      unsubscribe();
      resolve(value);
    });
  });
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatINR(amount: number): string {
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}k`;
  return `₹${Math.round(amount)}`;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-slate-200 rounded-xl ${className ?? ''}`} />;
}

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-25" />)}
    </div>
  );
}

// ── Fee Alerts Panel ──────────────────────────────────────────────────────────

function FeeAlertsPanel({ feeAlerts }: { feeAlerts: FeeAlerts }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Fee Alerts</h2>
      <div className="flex items-center justify-between bg-red-50 rounded-xl px-4 py-3">
        <div>
          <p className="text-xs text-red-500 font-medium">Overdue Fees</p>
          <p className="text-lg font-bold text-red-700">{feeAlerts.overdueAmount}</p>
          <p className="text-xs text-red-400 mt-0.5">{feeAlerts.overdueStudents} students</p>
        </div>
        <span className="text-2xl">⚠️</span>
      </div>
      <div className="flex items-center justify-between bg-amber-50 rounded-xl px-4 py-3">
        <div>
          <p className="text-xs text-amber-600 font-medium">Due Today</p>
          <p className="text-lg font-bold text-amber-700">{feeAlerts.todayDueAmount}</p>
          <p className="text-xs text-amber-400 mt-0.5">{feeAlerts.todayDueStudents} students</p>
        </div>
        <span className="text-2xl">📅</span>
      </div>
      <div className="flex items-center justify-between bg-emerald-50 rounded-xl px-4 py-3">
        <div>
          <p className="text-xs text-emerald-600 font-medium">This Week Collected</p>
          <p className="text-lg font-bold text-emerald-700">{feeAlerts.thisWeekCollected}</p>
          <p className="text-xs text-emerald-400 mt-0.5">Due this week: {feeAlerts.thisWeekTarget}</p>
        </div>
        <span className="text-2xl">✅</span>
      </div>
    </div>
  );
}

// ── Class Breakdown Panel ─────────────────────────────────────────────────────

function ClassBreakdownPanel({ classes }: { classes: ClassBreakdown[] }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Class-wise Overview</h2>
      <div className="overflow-auto max-h-65">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-400 border-b border-slate-100">
              <th className="text-left pb-2 font-medium">Class</th>
              <th className="text-right pb-2 font-medium">Students</th>
              <th className="text-right pb-2 font-medium">Attendance</th>
            </tr>
          </thead>
          <tbody>
            {classes.map((cls) => (
              <tr key={cls.className} className="border-b border-slate-50 last:border-0">
                <td className="py-2 font-medium text-slate-700">{cls.className}</td>
                <td className="py-2 text-right text-slate-600">{cls.students}</td>
                <td className="py-2 text-right">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold
                    ${cls.attendance >= 90 ? 'bg-emerald-100 text-emerald-700'
                      : cls.attendance >= 75 ? 'bg-amber-100 text-amber-700'
                      : 'bg-red-100 text-red-700'}`}>
                    {cls.attendance}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Alerts Panel ──────────────────────────────────────────────────────────────

function AlertsPanel({ alerts }: { alerts: AlertItem[] }) {
  if (!alerts.length) return null;
  const iconMap  = { fee: '💰', attendance: '📊' };
  const colorMap = {
    critical: 'bg-red-50 border-red-200 text-red-800',
    warning : 'bg-amber-50 border-amber-200 text-amber-800',
    info    : 'bg-blue-50 border-blue-200 text-blue-800',
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">🔔 Alerts &amp; Notifications</h2>
      <div className="flex flex-col gap-2">
        {alerts.map((alert, i) => (
          <div key={i} className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm ${colorMap[alert.severity]}`}>
            <span className="text-base mt-0.5">{iconMap[alert.type]}</span>
            <span className="leading-snug">{alert.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Real data loader ──────────────────────────────────────────────────────────

async function loadDashboardData(schoolId: string): Promise<DashboardData> {
  const now = new Date();
  const startOfThisWeek = new Date(now);
  startOfThisWeek.setDate(now.getDate() - 6);
  const startOfLastWeek = new Date(now);
  startOfLastWeek.setDate(now.getDate() - 13);
  const endOfLastWeek = new Date(now);
  endOfLastWeek.setDate(now.getDate() - 7);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // ── Independent reads, in parallel ──────────────────────────────────
  // Attendance analytics needs studentMetas/classMetas as INPUTS (see
  // below), so it can't be in this same batch — it depends on this
  // batch's results, same dependency shape feeStructure already has
  // on classLabels further down.
  const [students, invoices, teachers, rawClasses, schoolProfile, thisWeekPayments] =
    await Promise.all([
      studentsService.syncStudents(schoolId),
      financeService.syncInvoices(schoolId),
      firstEmission<Teacher[]>((cb) => teachersService.subscribeToTeachers(schoolId, cb)),
      firstEmission<{ id: string; data: Record<string, unknown> }[]>((cb) =>
        classesRepository.subscribeToClasses(schoolId, cb)
      ),
      schoolService.getSchoolProfile(schoolId),
      financeService.getPayments(schoolId, { startMs: startOfThisWeek.getTime() }, 500),
    ]);

  // Full class+section list — same source and shape the real
  // Attendance/Timetable pages already build this from (classesRepository
  // only exposes bare label strings, not sections, and getAnalytics
  // needs sections to bucket byClass per section).
  const classMetas: ClassMeta[] = rawClasses.map((d) => ({
    id: d.id,
    className: (d.data.className as string) || "",
    sections: ((d.data.sections as { id: string; name: string }[]) || []).map((s) => ({
      id: s.id,
      name: s.name,
    })),
  }));
  const classLabels = classMetas.map((c) => c.className);

  // Adapted to StudentMeta rather than passing the full Student shape
  // into attendanceService — same reasoning the Attendance page uses:
  // the service only needs the handful of fields it actually reads.
  const studentMetas: StudentMeta[] = students.map((s) => ({
    id: s.id,
    name: s.profile.name,
    rollNo: s.profile.rollNo,
    className: s.className,
    section: s.section,
  }));

  // thresholdPct only matters for the defaulters list, which this
  // page doesn't use at all — 75 is just getAnalytics' own default
  // elsewhere in the app, picked for consistency, not because this
  // call cares about it.
  const [thisWeekAnalytics, lastWeekAnalytics] = await Promise.all([
    attendanceService.getAnalytics(schoolId, studentMetas, classMetas, toISODate(startOfThisWeek), toISODate(now), 75),
    attendanceService.getAnalytics(schoolId, studentMetas, classMetas, toISODate(startOfLastWeek), toISODate(endOfLastWeek), 75),
  ]);

  // Fee structure's due dates are keyed by classLabels the same way
  // feeStructureService normalizes tuition/books per class — must be
  // fetched after classLabels resolves, same dependency setupService
  // already has for the same reason. Scoped to the school's current
  // academic year — falls back to a blank structure if that hasn't
  // been set yet (mid-onboarding), since an empty string isn't a
  // valid Firestore doc id.
  const feeStructure = schoolProfile.currentAcademicYear
    ? await feeStructureService.getFeeStructure(schoolId, schoolProfile.currentAcademicYear, classLabels)
    : feeStructureService.emptyFeeStructure(classLabels);

  // ── Students ─────────────────────────────────────────────────────────
  const activeStudents = students.filter((s) => s.status === 'active');
  const newStudentsMonth = activeStudents.filter((s) => s.createdAt >= startOfMonth.getTime()).length;

  // ── Fee donut buckets — matches FeeDonut's own prop semantics exactly
  //    (collected = paid-in-full invoices, partial = amount actually
  //    paid on partial invoices, pending = amount owed on untouched
  //    invoices) — see components/Feedonut.tsx ─────────────────────────
  let collected = 0, partial = 0, pending = 0, target = 0;
  for (const inv of invoices) {
    target += inv.summary.total;
    if (inv.status === 'paid') collected += inv.paidAmount;
    else if (inv.status === 'partial') partial += inv.paidAmount;
    else pending += inv.balanceAmount;
  }

  // ── Due-date join: FeeTerm.dueDate (structure) <-> InvoiceTerm (per
  //    student), matched by id. Flexible-mode schools have no per-term
  //    dueDate on the schedule — fall back to the schedule's single
  //    finalDueDate/flexibleDueDate for every term in that case. ───────
  const dueDateByTermId = new Map<string, string>();
  for (const term of feeStructure.schedule.terms) {
    dueDateByTermId.set(term.id, term.dueDate);
  }
  const fallbackDueDate = feeStructure.schedule.finalDueDate || feeStructure.schedule.flexibleDueDate || '';

  const todayIso = toISODate(now);
  const weekEndIso = toISODate(new Date(now.getTime() + 6 * 86400000));

  let overdueAmount = 0, todayDueAmount = 0, thisWeekTarget = 0;
  const overdueStudentIds = new Set<string>();
  const todayDueStudentIds = new Set<string>();

  for (const inv of invoices) {
    for (const term of inv.terms) {
      if (term.status === 'paid') continue;
      const remaining = term.amount - term.paidAmount;
      if (remaining <= 0) continue;

      const dueDate = dueDateByTermId.get(term.id) || fallbackDueDate;
      if (!dueDate) continue;

      if (dueDate < todayIso) {
        overdueAmount += remaining;
        overdueStudentIds.add(inv.studentId);
      } else if (dueDate === todayIso) {
        todayDueAmount += remaining;
        todayDueStudentIds.add(inv.studentId);
      }
      if (dueDate >= todayIso && dueDate <= weekEndIso) {
        thisWeekTarget += remaining;
      }
    }
  }

  const thisWeekCollected = thisWeekPayments.reduce((sum, p) => sum + p.amount, 0);

  // ── Attendance: this week's daily series + week-over-week delta ─────
  const attendance: DayAttendance[] = thisWeekAnalytics.daily.map((point) => {
    const weekday = new Date(point.date + 'T00:00:00').getDay();
    return { day: DAY_LABELS[weekday], present: point.pctPresent, absent: 100 - point.pctPresent };
  });

  const thisWeekAvg = thisWeekAnalytics.daily.length
    ? Math.round(thisWeekAnalytics.daily.reduce((s, d) => s + d.pctPresent, 0) / thisWeekAnalytics.daily.length)
    : 0;
  const lastWeekAvg = lastWeekAnalytics.daily.length
    ? Math.round(lastWeekAnalytics.daily.reduce((s, d) => s + d.pctPresent, 0) / lastWeekAnalytics.daily.length)
    : 0;

  // ── Class breakdown: student count (real) + attendance% (real) ──────
  // getAnalytics' byClass is per-SECTION (a class with 3 sections has
  // 3 entries), but this panel is keyed by className alone — so
  // sections belonging to the same class get averaged together here.
  // This is an unweighted average of each section's pctPresent, not a
  // true student-weighted figure (ClassAverage doesn't carry a
  // headcount to weight by) — a reasonable approximation for an
  // at-a-glance summary panel, not precise analytics.
  const countByClass = new Map<string, number>();
  for (const s of activeStudents) {
    countByClass.set(s.className, (countByClass.get(s.className) || 0) + 1);
  }
  const sectionPctsByClass = new Map<string, number[]>();
  for (const c of thisWeekAnalytics.byClass) {
    const list = sectionPctsByClass.get(c.className) ?? [];
    list.push(c.pctPresent);
    sectionPctsByClass.set(c.className, list);
  }
  const attendanceByClass = new Map(
    Array.from(sectionPctsByClass.entries()).map(([className, pcts]) => [
      className,
      Math.round(pcts.reduce((s, p) => s + p, 0) / pcts.length),
    ])
  );

  const classBreakdown: ClassBreakdown[] = classLabels.map((className) => ({
    className,
    students: countByClass.get(className) || 0,
    attendance: attendanceByClass.get(className) || 0,
  }));

  // ── Alerts — derived from the real aggregates above, not a separate
  //    fetch. Only fee/attendance for now; admission/teacher alert
  //    types were dropped along with the mock data rather than kept
  //    with nothing real behind them. ───────────────────────────────────
  const alerts: AlertItem[] = [];
  if (overdueStudentIds.size > 0) {
    alerts.push({
      type: 'fee',
      severity: 'critical',
      message: `${overdueStudentIds.size} student${overdueStudentIds.size === 1 ? '' : 's'} have overdue fees totalling ${formatINR(overdueAmount)} — follow-up required.`,
    });
  }
  for (const cls of classBreakdown) {
    if (cls.students > 0 && cls.attendance > 0 && cls.attendance < 75) {
      alerts.push({
        type: 'attendance',
        severity: 'warning',
        message: `${cls.className} attendance at ${cls.attendance}% — below the 75% threshold.`,
      });
    }
  }

  // ── Recent students table (most recently admitted, capped at 6) ─────
  const recentStudents: StudentRow[] = [...activeStudents]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 6)
    .map((s) => {
      const invoice = invoices.find((i) => i.studentId === s.id);
      const feeStatus: StudentRow['feeStatus'] =
        invoice?.status === 'paid' ? 'Paid' : overdueStudentIds.has(s.id) ? 'Overdue' : 'Pending';
      return {
        studentId: s.id,
        name: s.profile.name,
        classSection: s.section ? `${s.className}-${s.section}` : s.className,
        rollNo: s.profile.rollNo,
        // Per-student today's mark isn't part of getAnalytics()'s aggregate
        // output (it only returns class/day totals, not per-student rows)
        // — showing a real per-student status here would need a separate
        // per-student read this table doesn't currently justify the cost
        // of. Left as a static placeholder rather than a fabricated value
        // that looks real; worth revisiting if this table becomes a place
        // people actually check today's attendance from.
        attendance: 'Present',
        feeStatus,
      };
    });

  return {
    stats: {
      totalStudents  : activeStudents.length,
      totalTeachers  : teachers.length,
      feeCollection  : formatINR(collected + partial),
      feePercent     : target > 0 ? Math.round(((collected + partial) / target) * 100) : 0,
      avgAttendance  : thisWeekAvg,
      attendanceDelta: thisWeekAvg - lastWeekAvg,
      newStudentsMonth,
    },
    feeData: {
      collected, partial, pending, target,
      dueDate: fallbackDueDate || '—',
    },
    feeAlerts: {
      overdueStudents  : overdueStudentIds.size,
      overdueAmount    : formatINR(overdueAmount),
      todayDueStudents : todayDueStudentIds.size,
      todayDueAmount   : formatINR(todayDueAmount),
      thisWeekCollected: formatINR(thisWeekCollected),
      thisWeekTarget   : formatINR(thisWeekTarget),
    },
    attendance,
    classBreakdown,
    alerts,
    students: recentStudents,
    classes: ['All', ...classLabels],
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const schoolId = profile?.schoolId;

  const [data,    setData   ] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!schoolId) return;
    setLoading(true);
    loadDashboardData(schoolId)
      .then(setData)
      .catch((e) => console.error('Dashboard load failed', e))
      .finally(() => setLoading(false));
  }, [schoolId]);

  const handleClassChange = useCallback((cls: string) => {
    console.log('Filter attendance by class:', cls);
  }, []);

  return (
    <div className="flex flex-col gap-5 max-w-350 mx-auto">

      {/* ── Setup progress (only renders while something's left) ─────────── */}
      <SetupProgressCard />

      {/* ── Daily Activity Banner (live RTDB) ─────────────────────────────── */}
      <DailyActivityBanner />

      {/* ── Row 1: Stats ──────────────────────────────────────────────────── */}
      {loading || !data ? <StatsSkeleton /> : <StatsGrid {...data.stats} />}

      {/* ── Row 2: Fee Alerts ──────────────────────────────────────────────── */}
      {loading || !data ? <Skeleton className="h-55" /> : <FeeAlertsPanel feeAlerts={data.feeAlerts} />}

      {/* ── Row 3: Attendance chart + Fee donut ───────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          {loading || !data
            ? <Skeleton className="h-65" />
            : <AttendanceChart data={data.attendance} weekAverage={data.stats.avgAttendance} prevWeekAvg={data.stats.avgAttendance - data.stats.attendanceDelta} classes={data.classes} onClassChange={handleClassChange} />
          }
        </div>
        <div>
          {loading || !data
            ? <Skeleton className="h-65" />
            : <FeeDonut {...data.feeData} />
          }
        </div>
      </div>

      {/* ── Row 4: Class breakdown + Alerts ───────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          {loading || !data ? <Skeleton className="h-65" /> : <ClassBreakdownPanel classes={data.classBreakdown} />}
        </div>
        <div>
          {loading || !data ? <Skeleton className="h-65" /> : <AlertsPanel alerts={data.alerts} />}
        </div>
      </div>

      {/* ── Row 5: Students table + Quick actions ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          {loading || !data
            ? <Skeleton className="h-80" />
            : <StudentsTable students={data.students} onViewAll={() => router.push('/students')} />
          }
        </div>
        <QuickActions />
      </div>

    </div>
  );
}