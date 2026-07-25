/**
 * --------------------------------------------------------------------
 * File:
 * app/(dashboard)/attendance/page.tsx
 *
 * Purpose:
 * Admin-side attendance monitoring. This is READ-ONLY — class teachers
 * mark daily attendance in the separate teacher app, one class at a
 * time. Marking 1,500–3,000 students a day from the admin panel isn't
 * a workflow, it's a bottleneck, so this page only ever summarizes
 * what teachers have already recorded:
 *
 *   1. Snapshot  — today (or any date): which classes are marked,
 *      which aren't, and each class's present/absent/late counts.
 *   2. Defaulters — students below an attendance threshold over the
 *      selected date range, sorted worst-first.
 *   3. Trends    — school-wide attendance % over that same range, and
 *      how each class compares over it.
 *
 * Data comes from attendanceService, which reads:
 *   - schools/{schoolId}/attendanceRegister/{classId}_{sectionId}_{date}
 *     (source of truth, written only by the not-yet-built teacher app)
 *   - schools/{schoolId}/parentAttendance/{studentId}/{summary,months/*}
 *     (the aggregate read model, built by a Cloud Function reacting to
 *     register writes — see functions/src/attendance/onRegisterWrite.ts)
 *
 * Until the teacher app exists and that Cloud Function is deployed,
 * neither collection has real data — every state below already
 * renders correctly against an empty result set (that's not a bug to
 * work around, it's the expected state of a feature whose write side
 * hasn't shipped yet).
 * --------------------------------------------------------------------
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { classesRepository } from "@/repositories/academic/classesRepository";
import { studentsService } from "@/services/students/studentsService";
import { attendanceService, ClassMeta, StudentMeta } from "@/services/attendance/attendanceService";
import { ClassAverage, ClassSnapshot, DefaulterEntry, TrendPoint } from "@/types/attendance";
import {
  CalendarDays,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  LayoutGrid,
  Loader2,
  Users,
  RefreshCw,
  Clock,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Tab = "snapshot" | "defaulters" | "trends";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function pctColor(pct: number): string {
  if (pct >= 90) return "text-emerald-600";
  if (pct >= 75) return "text-amber-600";
  return "text-red-600";
}

export default function AttendancePage() {
  const { profile, loading: authLoading } = useAuth();
  const schoolId = profile?.schoolId ?? "";

  const [tab, setTab] = useState<Tab>("snapshot");
  const [classes, setClasses] = useState<ClassMeta[]>([]);
  const [studentMetas, setStudentMetas] = useState<StudentMeta[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(true);

  // ---- Snapshot state ----
  const [snapshotDate, setSnapshotDate] = useState(todayIso());
  const [snapshots, setSnapshots] = useState<ClassSnapshot[]>([]);
  const [snapshotLoading, setSnapshotLoading] = useState(true);

  // ---- Shared range state for Defaulters + Trends ----
  const [rangeStart, setRangeStart] = useState(daysAgoIso(30));
  const [rangeEnd, setRangeEnd] = useState(todayIso());
  const [threshold, setThreshold] = useState(75);

  const [defaulters, setDefaulters] = useState<DefaulterEntry[] | null>(null);
  const [dailyTrend, setDailyTrend] = useState<TrendPoint[] | null>(null);
  const [classAverages, setClassAverages] = useState<ClassAverage[] | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState("");

  // Class + section list — same source and shape Timetable already uses.
  useEffect(() => {
    if (!schoolId) return;
    const unsub = classesRepository.subscribeToClasses(schoolId, (docs) => {
      setClasses(
        docs.map((d) => ({
          id: d.id,
          className: (d.data.className as string) || "",
          sections: ((d.data.sections as { id: string; name: string }[]) || []).map((s) => ({
            id: s.id,
            name: s.name,
          })),
        }))
      );
    });
    return () => unsub();
  }, [schoolId]);

  // Student roster (needed for Defaulters — name/roll/class lookup).
  // Adapted to StudentMeta here rather than passing the full Student
  // shape into the service, so attendanceService doesn't need to know
  // about StudentProfile/StudentContact/etc. — only the handful of
  // fields Defaulters actually displays.
  useEffect(() => {
    if (!schoolId) return;
    const unsub = studentsService.subscribeToStudents(schoolId, (list) => {
      setStudentMetas(
        list.map((s) => ({
          id: s.id,
          name: s.profile.name,
          rollNo: s.profile.rollNo,
          className: s.className,
          section: s.section,
        }))
      );
      setStudentsLoading(false);
    });
    return () => unsub();
  }, [schoolId]);

  // Live snapshot for the selected date.
  useEffect(() => {
    if (!schoolId || classes.length === 0) return;
    setSnapshotLoading(true);
    const unsub = attendanceService.subscribeToSnapshot(schoolId, classes, snapshotDate, (data) => {
      setSnapshots(data);
      setSnapshotLoading(false);
    });
    return () => unsub();
  }, [schoolId, snapshotDate, classes]);

  async function runAnalytics() {
    if (!schoolId) return;
    setAnalyticsLoading(true);
    setAnalyticsError("");
    try {
      const result = await attendanceService.getAnalytics(
        schoolId,
        studentMetas,
        classes,
        rangeStart,
        rangeEnd,
        threshold
      );
      setDefaulters(result.defaulters);
      setDailyTrend(result.daily);
      setClassAverages(result.byClass);
    } catch (error) {
      setAnalyticsError(error instanceof Error ? error.message : "Failed to load attendance analytics.");
    } finally {
      setAnalyticsLoading(false);
    }
  }

  // Auto-load analytics the first time either tab is opened.
  useEffect(() => {
    if ((tab === "defaulters" || tab === "trends") && defaulters === null && !studentsLoading && schoolId) {
      runAnalytics();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, studentsLoading, schoolId]);

  const schoolWidePct = useMemo(() => {
    const marked = snapshots.filter((s) => s.marked);
    const total = marked.reduce((sum, s) => sum + s.total, 0);
    const present = marked.reduce((sum, s) => sum + s.present + s.late, 0);
    return total ? Math.round((present / total) * 100) : 0;
  }, [snapshots]);

  const unmarkedClasses = snapshots.filter((s) => !s.marked);
  const loading = authLoading || studentsLoading;

  return (
    <div className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header + tabs */}
        <div className="rounded-3xl bg-white p-6 shadow-sm">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Attendance</h1>
          <p className="mt-1 text-sm text-zinc-500">
            A read-only view of what class teachers have recorded. Marking happens in the teacher app.
          </p>

          <div className="mt-5 flex gap-2 border-b border-zinc-100">
            {[
              { id: "snapshot" as Tab, label: "Today's Snapshot", icon: LayoutGrid },
              { id: "defaulters" as Tab, label: "Defaulters", icon: AlertTriangle },
              { id: "trends" as Tab, label: "Trends", icon: TrendingUp },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-semibold transition ${
                  tab === id
                    ? "border-zinc-900 text-zinc-900"
                    : "border-transparent text-zinc-400 hover:text-zinc-600"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ---------------- SNAPSHOT TAB ---------------- */}
        {tab === "snapshot" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-white p-5 shadow-sm">
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
                <input
                  type="date"
                  value={snapshotDate}
                  max={todayIso()}
                  onChange={(e) => setSnapshotDate(e.target.value)}
                  className="rounded-xl border border-zinc-200 bg-zinc-50 py-2 pl-9 pr-3 text-sm outline-none"
                />
              </div>
              <div className="flex items-center gap-6 text-sm">
                <span className="text-zinc-500">
                  <span className="font-bold text-zinc-900">{snapshots.length - unmarkedClasses.length}</span> /{" "}
                  {snapshots.length} classes marked
                </span>
                <span className="text-zinc-500">
                  School-wide:{" "}
                  <span className={`font-bold ${pctColor(schoolWidePct)}`}>{schoolWidePct}% present</span>
                </span>
              </div>
            </div>

            {unmarkedClasses.length > 0 && (
              <div className="flex items-start gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  <span className="font-semibold">{unmarkedClasses.length} class(es)</span> haven&apos;t marked
                  attendance for this date yet: {unmarkedClasses.map((c) => `${c.className}${c.sectionName ? `-${c.sectionName}` : ""}`).join(", ")}
                </p>
              </div>
            )}

            <div className="rounded-3xl bg-white shadow-sm">
              {loading || snapshotLoading ? (
                <div className="flex items-center gap-2 p-10 text-sm font-medium text-zinc-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading snapshot...
                </div>
              ) : snapshots.length === 0 ? (
                <div className="p-12 text-center">
                  <Users className="mx-auto h-8 w-8 text-zinc-200" />
                  <p className="mt-3 text-sm text-zinc-500">No classes configured yet.</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-100 text-left text-xs font-semibold uppercase tracking-wide text-zinc-400">
                      <th className="px-5 py-3">Class</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3">Present</th>
                      <th className="px-5 py-3">Absent</th>
                      <th className="px-5 py-3">Late</th>
                      <th className="px-5 py-3">% Present</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {snapshots.map((s) => (
                      <tr key={`${s.classId}_${s.sectionId}`}>
                        <td className="px-5 py-3 font-semibold text-zinc-900">
                          Class {s.className}{s.sectionName ? ` - ${s.sectionName}` : ""}
                        </td>
                        <td className="px-5 py-3">
                          {s.marked ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                              <CheckCircle2 className="h-3 w-3" /> Marked
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-500">
                              <Clock className="h-3 w-3" /> Not marked
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-zinc-600">{s.marked ? s.present : "—"}</td>
                        <td className="px-5 py-3 text-zinc-600">{s.marked ? s.absent : "—"}</td>
                        <td className="px-5 py-3 text-zinc-600">{s.marked ? s.late : "—"}</td>
                        <td className={`px-5 py-3 font-bold ${s.marked ? pctColor(s.pctPresent) : "text-zinc-300"}`}>
                          {s.marked ? `${s.pctPresent}%` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {/* ---------------- SHARED RANGE CONTROLS ---------------- */}
        {(tab === "defaulters" || tab === "trends") && (
          <div className="flex flex-wrap items-end gap-3 rounded-3xl bg-white p-5 shadow-sm">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500">From</label>
              <input
                type="date"
                value={rangeStart}
                max={rangeEnd}
                onChange={(e) => setRangeStart(e.target.value)}
                className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500">To</label>
              <input
                type="date"
                value={rangeEnd}
                max={todayIso()}
                onChange={(e) => setRangeEnd(e.target.value)}
                className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none"
              />
            </div>
            {tab === "defaulters" && (
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Below (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className="w-24 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none"
                />
              </div>
            )}
            <button
              onClick={runAnalytics}
              disabled={analyticsLoading}
              className="flex items-center gap-2 rounded-xl bg-zinc-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-50"
            >
              {analyticsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Apply
            </button>
          </div>
        )}

        {analyticsError && (
          <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">{analyticsError}</div>
        )}

        {/* ---------------- DEFAULTERS TAB ---------------- */}
        {tab === "defaulters" && (
          <div className="rounded-3xl bg-white shadow-sm">
            {analyticsLoading ? (
              <div className="flex items-center gap-2 p-10 text-sm font-medium text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Crunching attendance...
              </div>
            ) : !defaulters || defaulters.length === 0 ? (
              <div className="p-12 text-center">
                <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-300" />
                <p className="mt-3 text-sm text-zinc-500">
                  No students below {threshold}% in this range — nice.
                </p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left text-xs font-semibold uppercase tracking-wide text-zinc-400">
                    <th className="px-5 py-3">Student</th>
                    <th className="px-5 py-3">Class</th>
                    <th className="px-5 py-3">Days Present</th>
                    <th className="px-5 py-3">Days Marked</th>
                    <th className="px-5 py-3">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {defaulters.map((d) => (
                    <tr key={d.studentId}>
                      <td className="px-5 py-3">
                        <p className="font-semibold text-zinc-900">{d.name}</p>
                        <p className="text-xs text-zinc-500">Roll #{d.rollNo}</p>
                      </td>
                      <td className="px-5 py-3 text-zinc-600">
                        {d.className}{d.section ? `-${d.section}` : ''}
                      </td>
                      <td className="px-5 py-3 text-zinc-600">{d.daysPresent}</td>
                      <td className="px-5 py-3 text-zinc-600">{d.daysMarked}</td>
                      <td className={`px-5 py-3 font-bold ${pctColor(d.pctPresent)}`}>{d.pctPresent}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ---------------- TRENDS TAB ---------------- */}
        {tab === "trends" && (
          <div className="space-y-6">
            <div className="rounded-3xl bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold text-zinc-700">School-wide attendance %</h2>
              {analyticsLoading ? (
                <div className="flex items-center gap-2 py-10 text-sm font-medium text-zinc-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading trend...
                </div>
              ) : !dailyTrend || dailyTrend.length === 0 ? (
                <p className="py-10 text-center text-sm text-zinc-500">No registers found in this range.</p>
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dailyTrend} margin={{ left: -20, right: 10, top: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#a1a1aa" />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="#a1a1aa" />
                      <Tooltip formatter={(v: number) => `${v}%`} />
                      <ReferenceLine y={75} stroke="#f59e0b" strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="pctPresent" stroke="#18181b" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="rounded-3xl bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold text-zinc-700">Average % by class, this range</h2>
              {analyticsLoading ? (
                <div className="flex items-center gap-2 py-10 text-sm font-medium text-zinc-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading comparison...
                </div>
              ) : !classAverages || classAverages.length === 0 ? (
                <p className="py-10 text-center text-sm text-zinc-500">No registers found in this range.</p>
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={classAverages.map((c) => ({
                        ...c,
                        label: c.sectionName ? `${c.className}-${c.sectionName}` : c.className,
                      }))}
                      margin={{ left: -20, right: 10, top: 10 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#a1a1aa" />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="#a1a1aa" />
                      <Tooltip formatter={(v: number) => `${v}%`} />
                      <ReferenceLine y={75} stroke="#f59e0b" strokeDasharray="4 4" />
                      <Bar dataKey="pctPresent" fill="#18181b" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}