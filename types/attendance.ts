/**
 * --------------------------------------------------------------------
 * File:
 * types/attendance.ts
 *
 * Purpose:
 * Shared types for the Attendance feature.
 *
 * Two Firestore collections, two different jobs:
 *
 *   schools/{schoolId}/attendanceRegister/{classId}_{sectionId}_{date}
 *     The source of truth. One document per class-section per day,
 *     written ONLY by the (not-yet-built) teacher app — this project
 *     never writes here, only reads. Keyed by classId/sectionId (the
 *     real Academic class document's ID — see the classId-vs-label
 *     conversation this was built in), not the class label string, so
 *     a class rename never orphans historical registers the way it
 *     would if this were keyed by className.
 *
 *   schools/{schoolId}/parentAttendance/{studentId}/{summary, months/*}
 *     The read model — a per-STUDENT rollup, built and owned entirely
 *     by a Cloud Function (functions/src/attendance/onRegisterWrite.ts)
 *     reacting to attendanceRegister writes. This project reads it for
 *     Defaulters and the school-wide Trends line — the whole point is
 *     to stop scanning every daily register in a date range just to
 *     answer "is this student below 75% this month" (see the
 *     dashboard-aggregation conversation this was designed to fix).
 *     Per-CLASS trend comparison is NOT served from here — see
 *     ClassAverage's doc comment for why.
 * --------------------------------------------------------------------
 */

export const ATTENDANCE_STATUSES = [
  "present",
  "absent",
  "late",
  "half_day",
  "leave",
  "medical_leave",
  "holiday",
] as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** Which statuses count toward "present" for a percentage — half_day counts as half, handled separately; leave/medical_leave/holiday don't count as present OR absent (they're excluded from the working-day denominator entirely). */
export const PRESENT_STATUSES: AttendanceStatus[] = ["present", "late"];
/** Statuses that don't count against a student's attendance at all — a declared holiday or approved leave isn't the student's absence. */
export const EXCLUDED_STATUSES: AttendanceStatus[] = ["leave", "medical_leave", "holiday"];

/**
 * studentId -> status for every student marked in a given register.
 * A student with no entry is treated as "not yet marked", not absent.
 */
export type AttendanceRecords = Record<string, AttendanceStatus>;

/** Tallies recomputed fresh from `records` on every write — see the Cloud Function for why this is a recompute, not an increment. Lets the Snapshot/per-class-trend views read a small summary instead of the full records map. */
export interface AttendanceRegisterSummary {
  total: number;
  present: number;
  absent: number;
  late: number;
  halfDay: number;
  leave: number;
  medicalLeave: number;
  holiday: number;
  pctPresent: number; // 0 if there's no countable working day in this register
}

export interface AttendanceRegister {
  classId: string;
  sectionId: string;
  date: string; // "YYYY-MM-DD"
  records: AttendanceRecords;
  summary: AttendanceRegisterSummary;
  createdBy: string;
  lastModifiedBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

/**
 * ----------------------------------------------------------------------
 * Parent read model — schools/{schoolId}/parentAttendance/{studentId}
 * ----------------------------------------------------------------------
 */

/**
 * One calendar month's day-by-day record for one student.
 * Deliberately does NOT store a percentage — trivial to derive from
 * the counts already here (present + late) / workingDays, and storing
 * it would just be a second field that has to stay in sync with the
 * first. See the summary doc below for where a stored percentage
 * actually earns its keep (read far more often than any one month).
 *
 * schoolId/studentId are denormalized onto every month doc (not just
 * implied by its Firestore path) specifically so the school-wide
 * Trends line can be served by ONE collectionGroup("months") query
 * scoped to this school + the relevant month(s), instead of reading
 * every student's month doc individually — the same "aggregate
 * instead of reading everything" reasoning this whole feature exists
 * for, applied one level deeper.
 */
export interface ParentAttendanceMonth {
  schoolId: string;
  studentId: string;
  month: string; // "YYYY-MM"
  days: Record<string, AttendanceStatus>; // day-of-month ("1".."31") -> status
  workingDays: number; // days with a countable status (excludes leave/medical_leave/holiday)
  present: number;
  absent: number;
  late: number;
  halfDay: number;
  updatedAt: unknown;
}

/**
 * Cumulative rollup across every month doc that exists for this
 * student — genuinely all-time, not scoped to "the current academic
 * year," because currentAcademicYear is currently just a free-text
 * label (e.g. "2025-26") with no stored start/end date anywhere in
 * this codebase to bound a real date range against. Scoping this to
 * an academic year is a reasonable future improvement once that
 * becomes a real date range instead of a label.
 *
 * attendancePercent IS stored here (unlike the month doc) because
 * this is the value the admin Defaulters view and any future parent-
 * app dashboard reads constantly — computing it fresh from N month
 * docs on every read would defeat the point of having this rollup.
 */
export interface ParentAttendanceSummary {
  schoolId: string;
  studentId: string;
  workingDays: number;
  present: number;
  absent: number;
  late: number;
  halfDay: number;
  attendancePercent: number;
  updatedAt: unknown;
}

/**
 * ----------------------------------------------------------------------
 * Admin-side read/analytics types.
 * ----------------------------------------------------------------------
 */

/** One class-section's register status for a single date, or "not marked yet". */
export interface ClassSnapshot {
  classId: string;
  sectionId: string;
  className: string; // display label only — never used as a lookup key
  sectionName: string | null;
  marked: boolean;
  total: number;
  present: number;
  absent: number;
  late: number;
  pctPresent: number;
}

/** A student whose attendance falls below a threshold, sourced from parentAttendance — see ATTENDANCE_STATUSES's doc comment on why this no longer scans raw registers. */
export interface DefaulterEntry {
  studentId: string;
  name: string;
  rollNo: string;
  className: string;
  section: string | null;
  daysMarked: number;
  daysPresent: number;
  pctPresent: number;
}

/** School-wide attendance % for a single date, for the trend line — summed across every student's parentAttendance month doc for that date. */
export interface TrendPoint {
  date: string;
  pctPresent: number;
}

/**
 * A class-section's average attendance % over a date range.
 *
 * Deliberately sourced from attendanceRegister directly, NOT
 * parentAttendance — parentAttendance is a per-STUDENT rollup with no
 * class dimension in it at all (a student's month doc doesn't record
 * which class they were in on any given day). Reconstructing that
 * would mean joining through each student's CURRENT className, which
 * is unreliable if they've since changed class/section — whereas each
 * attendanceRegister document already carries its own classId/
 * sectionId directly, no join needed. This is the one view that stays
 * on the "read the source of truth" path rather than the aggregate.
 */
export interface ClassAverage {
  classId: string;
  sectionId: string;
  className: string;
  sectionName: string | null;
  pctPresent: number;
}