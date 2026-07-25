/**
 * --------------------------------------------------------------------
 * File:
 * services/attendance/attendanceService.ts
 *
 * Purpose:
 * Business logic for Attendance. This project only ever READS —
 * marking happens in the teacher app (not yet built); the Cloud
 * Function in functions/src/attendance/onRegisterWrite.ts is what
 * turns those marks into the parentAttendance rollup this service
 * reads for Defaulters and the daily trend line. Until both of those
 * exist, this service works correctly against an empty result set —
 * every method here already handles "no data" as a real, expected
 * state, not an error.
 *
 * Responsibilities:
 * ✅ Normalize raw Firestore docs into the admin-facing analytics
 *    types (ClassSnapshot, DefaulterEntry, TrendPoint, ClassAverage)
 * ✅ Decide, per view, which source to read — see each method's doc
 *    comment; this isn't uniform on purpose (see types/attendance.ts's
 *    file header for the per-view reasoning)
 *
 * Does NOT:
 * ❌ Call Firestore directly (that's the repository's job)
 * ❌ Write anything, ever
 * --------------------------------------------------------------------
 */

import { attendanceRepository, RawDoc } from "@/repositories/attendance/attendanceRepository";
import {
  AttendanceStatus,
  ClassAverage,
  ClassSnapshot,
  DefaulterEntry,
  PRESENT_STATUSES,
  TrendPoint,
} from "@/types/attendance";

export interface ClassSectionMeta {
  id: string;
  name: string;
}
export interface ClassMeta {
  id: string;
  className: string;
  sections: ClassSectionMeta[];
}

export interface StudentMeta {
  id: string;
  name: string;
  rollNo: string;
  className: string;
  section: string | null;
}

function isPresentLike(status: AttendanceStatus | undefined): boolean {
  return !!status && PRESENT_STATUSES.includes(status);
}

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

/** "2026-07-24" -> "2026-07" */
function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** Every "YYYY-MM" between two "YYYY-MM-DD" dates, inclusive. */
function monthsInRange(startDate: string, endDate: string): string[] {
  const months: string[] = [];
  const [sy, sm] = startDate.slice(0, 7).split("-").map(Number);
  const [ey, em] = endDate.slice(0, 7).split("-").map(Number);
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

export class AttendanceService {
  /**
   * ----------------------------------------------------
   * Today's (or any single date's) per-class-section register status.
   * Reads attendanceRegister directly — see this feature's file-header
   * reasoning for why Snapshot stays on the source-of-truth path
   * (single date, so the cost is already small; the aggregate model
   * doesn't even have a class dimension to serve this from).
   *
   * `classes` is the caller's already-loaded class+section list (same
   * shape the Timetable page already builds) — this service doesn't
   * fetch it itself, to avoid a second, redundant subscription.
   * ----------------------------------------------------
   */
  subscribeToSnapshot(
    schoolId: string,
    classes: ClassMeta[],
    date: string,
    callback: (snapshots: ClassSnapshot[]) => void
  ): () => void {
    return attendanceRepository.subscribeToRegistersForDate(schoolId, date, (docs) => {
      const byKey = new Map<string, RawDoc>();
      for (const d of docs) {
        const data = d.data;
        byKey.set(`${data.classId}_${data.sectionId}`, d);
      }

      const snapshots: ClassSnapshot[] = [];
      for (const cls of classes) {
        const sections = cls.sections.length > 0 ? cls.sections : [{ id: "_no_section", name: "" }];
        for (const sec of sections) {
          const key = `${cls.id}_${sec.id}`;
          const raw = byKey.get(key);
          const summary = raw?.data.summary as Record<string, number> | undefined;

          snapshots.push({
            classId: cls.id,
            sectionId: sec.id,
            className: cls.className,
            sectionName: cls.sections.length > 0 ? sec.name : null,
            marked: !!raw,
            total: summary?.total ?? 0,
            present: summary?.present ?? 0,
            absent: summary?.absent ?? 0,
            late: summary?.late ?? 0,
            pctPresent: summary?.pctPresent ?? 0,
          });
        }
      }
      callback(snapshots);
    });
  }

  /**
   * ----------------------------------------------------
   * Defaulters (below thresholdPct) + the daily trend line + per-class
   * averages, all over the SAME date range — one shared
   * getMonthsForSchool fetch (collectionGroup query, months touched by
   * the range) instead of reading it once per view. Range-scoped, not
   * all-time, to match the admin page's single shared date picker for
   * both Defaulters and Trends — "defaulters in the last 30 days," not
   * "defaulters ever." The cumulative all-time percentage lives on
   * parentAttendance's summary doc instead (see getCurrentStanding),
   * for a future "current standing" view that isn't range-scoped.
   * ----------------------------------------------------
   */
  async getAnalytics(
    schoolId: string,
    students: StudentMeta[],
    classes: ClassMeta[],
    startDate: string,
    endDate: string,
    thresholdPct: number
  ): Promise<{ defaulters: DefaulterEntry[]; daily: TrendPoint[]; byClass: ClassAverage[] }> {
    const studentById = new Map(students.map((s) => [s.id, s]));
    const classNameById = new Map(classes.map((c) => [c.id, c.className]));
    const sectionNameByKey = new Map<string, string>();
    for (const cls of classes) {
      for (const sec of cls.sections) {
        sectionNameByKey.set(`${cls.id}_${sec.id}`, sec.name);
      }
    }
    const months = monthsInRange(startDate, endDate);

    const [monthDocs, registerDocs] = await Promise.all([
      attendanceRepository.getMonthsForSchool(schoolId, months),
      attendanceRepository.getRegistersInRange(schoolId, startDate, endDate),
    ]);

    // ── Per-student range-scoped tally (feeds both Defaulters and the
    //    daily line) + the daily line's date-level tally, built in the
    //    same pass over the same month docs. ──────────────────────────
    const perStudent = new Map<string, { present: number; total: number }>();
    const tallyByDate = new Map<string, { present: number; total: number }>();

    for (const monthDoc of monthDocs) {
      const data = monthDoc.data;
      const studentId = data.studentId as string;
      if (!studentById.has(studentId)) continue; // e.g. an inactive/deleted student's leftover data

      const month = data.month as string;
      const days = (data.days as Record<string, AttendanceStatus>) ?? {};
      const studentTally = perStudent.get(studentId) ?? { present: 0, total: 0 };

      for (const [dayNum, status] of Object.entries(days)) {
        const date = `${month}-${dayNum.padStart(2, "0")}`;
        if (date < startDate || date > endDate) continue;
        if (status === "leave" || status === "medical_leave" || status === "holiday") continue;

        const present = isPresentLike(status);

        studentTally.total += 1;
        if (present) studentTally.present += 1;

        const dateTally = tallyByDate.get(date) ?? { present: 0, total: 0 };
        dateTally.total += 1;
        if (present) dateTally.present += 1;
        tallyByDate.set(date, dateTally);
      }

      perStudent.set(studentId, studentTally);
    }

    const defaulters: DefaulterEntry[] = [];
    for (const [studentId, tally] of perStudent) {
      if (tally.total === 0) continue;
      const pctPresent = pct(tally.present, tally.total);
      if (pctPresent >= thresholdPct) continue;

      const student = studentById.get(studentId)!;
      defaulters.push({
        studentId,
        name: student.name,
        rollNo: student.rollNo,
        className: student.className,
        section: student.section,
        daysMarked: tally.total,
        daysPresent: tally.present,
        pctPresent,
      });
    }
    defaulters.sort((a, b) => a.pctPresent - b.pctPresent);

    const daily: TrendPoint[] = Array.from(tallyByDate.entries())
      .map(([date, { present, total }]) => ({ date, pctPresent: pct(present, total) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // ── Per-class averages (weighted by headcount per register, not a
    //    plain average-of-percentages, so a section with more students
    //    marked on a given day counts proportionally more). Sourced
    //    from attendanceRegister directly — see ClassAverage's doc
    //    comment in types/attendance.ts for why. ───────────────────────
    const classTally = new Map<string, { className: string; sectionName: string | null; present: number; total: number }>();
    for (const raw of registerDocs) {
      const data = raw.data;
      const classId = data.classId as string;
      const sectionId = data.sectionId as string;
      const summary = (data.summary as Record<string, number>) ?? {};
      const key = `${classId}_${sectionId}`;
      const className = classNameById.get(classId) ?? classId;
      const sectionName = sectionNameByKey.get(key) ?? null;

      const entry = classTally.get(key) ?? { className, sectionName, present: 0, total: 0 };
      entry.present += (summary.present ?? 0) + (summary.late ?? 0);
      entry.total += summary.total ?? 0;
      classTally.set(key, entry);
    }
    const byClass: ClassAverage[] = Array.from(classTally.entries()).map(([key, v]) => {
      const [classId, sectionId] = key.split("_");
      return {
        classId, sectionId, className: v.className, sectionName: v.sectionName,
        pctPresent: pct(v.present, v.total),
      };
    });

    return { defaulters, daily, byClass };
  }

  /**
   * ----------------------------------------------------
   * A single student's all-time cumulative standing — reads the
   * parentAttendance summary doc directly (one read). Not used by
   * this admin page today (which is range-scoped throughout — see
   * getAnalytics), but kept here since it's the natural fit for a
   * future per-student detail panel or the parent app's own dashboard,
   * both of which want "how am I doing overall," not "in this range."
   * ----------------------------------------------------
   */
  async getCurrentStanding(schoolId: string, studentId: string): Promise<DefaulterEntry | null> {
    const [summary] = await attendanceRepository.getSummaries(schoolId, [studentId]);
    if (!summary) return null;

    const data = summary.data;
    const workingDays = (data.workingDays as number) ?? 0;
    const present = (data.present as number) ?? 0;
    const late = (data.late as number) ?? 0;

    return {
      studentId,
      name: "",
      rollNo: "",
      className: "",
      section: null,
      daysMarked: workingDays,
      daysPresent: present + late,
      pctPresent: (data.attendancePercent as number) ?? pct(present + late, workingDays),
    };
  }
}

export const attendanceService = new AttendanceService();