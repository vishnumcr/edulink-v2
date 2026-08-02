/**
 * --------------------------------------------------------------------
 * File:
 * types/timetable.ts
 *
 * Purpose:
 * Shared types for the Timetable feature. Two distinct pieces of data
 * live under this feature, and they're deliberately NOT the same
 * document:
 *
 * 1. schools/{schoolId}/config/timings — ONE shared clock (list of
 *    TimingSlots) used by every class and section. Editing it is the
 *    only place this data is writable — see settings/timings/page.tsx.
 *    Period ORDER for the whole school comes from a slot's position
 *    in this array; nothing else defines order (see note on
 *    WeeklyTimetable below). Still a live-subscribed config doc —
 *    that part of the feature is unaffected by the migration below.
 *
 * 2. schools/{schoolId}/timetables/{classId}_{sectionId} — the
 *    per-class/section WEEKLY schedule: which subject + teacher
 *    occupies every class-type slot, for every day, for one
 *    class+section. See WeeklyTimetable's doc comment for the full
 *    reasoning behind this shape.
 * --------------------------------------------------------------------
 */

export type TimingSlotType = "class" | "break" | "lunch";

export interface TimingSlot {
  id: string;
  label: string;
  /** Free-text, e.g. "09:00 AM" — not parsed/validated as a real time value; see timingsService for why. */
  start: string;
  end: string;
  type: TimingSlotType;
}

/**
 * ------------------------------------------------------------------
 * One class-type slot's assignment within a day. Break/lunch slots
 * never appear here — they're pure display, rendered straight from
 * TimingSlot wherever they fall in the master clock's order. Storing
 * them would just be dead weight in a document that's identical for
 * every class in the school.
 * ------------------------------------------------------------------
 */
export interface TimetablePeriod {
  /** References schools/{schoolId}/subjects/{subjectId}. */
  subjectId: string;
  /** References schools/{schoolId}/teachers/{teacherId}. */
  teacherId: string;
}

/**
 * One day's periods, keyed by slotId (a TimingSlot.id whose type is
 * "class"). A day with nothing scheduled yet is `{}`, not a missing
 * key — every WeeklyTimetable always has all six day keys present
 * (see emptyTimetable in timetableService), so callers never need to
 * guard against a day being undefined.
 */
export type TimetableDay = Record<string, TimetablePeriod>;

/**
 * ------------------------------------------------------------------
 * schools/{schoolId}/timetables/{classId}_{sectionId}
 *
 * ONE document = one class+section's ENTIRE week. This replaces the
 * previous architecture, where every (section, day, slot) triple was
 * its own document in a schools/{schoolId}/classes/{classId}/timetable
 * subcollection with a deterministic `${sectionId}__${day}__${slotId}`
 * ID. That design optimized for write granularity — two staff editing
 * different periods of the same class couldn't clobber each other.
 *
 * This is an intentional move to the opposite tradeoff, because a
 * timetable's actual access pattern doesn't match what that design
 * optimized for: timetables are created once, rarely edited, and read
 * constantly (every dashboard load, every attendance/period lookup).
 * One document per class-section means:
 *   - Opening a class's timetable is exactly one read, not a
 *     collectionGroup fan-out.
 *   - The UI's local cache (see timetableCache.ts) is a single
 *     object per class-section, not dozens of loose rows to
 *     reassemble client-side.
 *   - There's exactly one place "has this class-section's timetable
 *     changed?" can be answered from — this doc's own `updatedAt` —
 *     which is what makes the delta-sync in timetableService possible
 *     (see getTimetableIfChanged).
 * The tradeoff this accepts: two staff editing the SAME class-section
 * at once can race. `version` (below) exists specifically to detect
 * that race and fail loudly instead of silently dropping a write —
 * see timetableRepository.saveTimetable.
 *
 * No separate "order" field anywhere in `days`, and no drag-to-reorder
 * in the UI: a period's position was always meant to come from where
 * its slotId sits in the master clock (see TimingSlot above), never
 * from an independently chosen order.
 *
 * `schoolId`/`classId`/`sectionId` are denormalized onto the document
 * (not just implied by its path/ID) so conflict detection — "is this
 * teacher already teaching somewhere else at this day+slot" — can
 * identify which class-section a booking belongs to after a plain
 * `getDocs` over the whole `timetables` collection, with no per-class
 * lookup needed. See timetableService.buildConflictMap.
 * ------------------------------------------------------------------
 */
export interface TeacherScheduleEntry {
  subjectId: string;
  /** Denormalized so the teacher app's login → schedule read never needs
   * a second lookup into subjects just to render "Maths, Period 3". */
  subjectName: string;
}

export type TeacherScheduleDay = Record<string, TeacherScheduleEntry>; // slotId -> entry

export interface TeacherSectionSchedule {
  className: string;
  sectionName: string;
  days: Record<string, TeacherScheduleDay>;
}

/**
 * ------------------------------------------------------------------
 * schools/{schoolId}/teacherSchedules/{teacherId}
 *
 * The teacher-facing read model for "what's my schedule" — one read,
 * by the teacher's own id, on login. Deliberately its OWN document,
 * not a field on teachers/{teacherId}: that profile document is core
 * HR data (name/email/phone/subject), edited rarely by an admin. This
 * is derived schedule data, rewritten every time ANY class-section's
 * timetable that this teacher appears in gets saved — mixing a
 * frequently-rewritten derived field into an otherwise-stable profile
 * doc is the same bounded-context problem parentAttendance was kept
 * separate from students/{studentId} to avoid.
 *
 * Keyed by `${classId}_${sectionId}` under bySection so that saving
 * one class-section's timetable only ever touches that ONE key (a
 * scoped nested-field merge — see timetableRepository.saveTimetable) —
 * a teacher who teaches five different sections doesn't get a
 * read-modify-write race between two admins independently editing two
 * different classes at overlapping times.
 * ------------------------------------------------------------------
 */
export interface TeacherSchedule {
  teacherId: string;
  bySection: Record<string, TeacherSectionSchedule>;
  updatedAt: number;
}

/**
 * One (day, slot) change for one teacher, produced by diffing a
 * timetable save's old `days` against its new `days` — see
 * timetableService's diffTeacherSchedulePatches. `entry: null` means
 * this teacher LOST this slot (either removed outright, or reassigned
 * to a different teacher) and their schedule doc's corresponding key
 * must be cleared, not just left stale.
 */
export interface TeacherSchedulePatch {
  teacherId: string;
  sectionKey: string;
  className: string;
  sectionName: string;
  day: string;
  slotId: string;
  entry: TeacherScheduleEntry | null;
}

export interface WeeklyTimetable {

  schoolId: string;
  classId: string;
  /** NO_SECTION_ID for a class with no sections — see timetableService. */
  sectionId: string;
  /** The academic year this schedule belongs to (school's currentAcademicYear at save time). */
  academicYear: string;
  /**
   * Optimistic-concurrency counter. Starts at 0 for a class-section
   * that has never been saved (see emptyTimetable) and is
   * incremented by exactly 1 on every successful save. A save whose
   * expected version doesn't match what's actually in Firestore is
   * rejected — see timetableRepository.saveTimetable.
   */
  version: number;
  /**
   * Normalized to epoch millis by the service (see toMillis) —
   * nothing past that normalization boundary should ever see a raw
   * Firestore Timestamp. This is also the field the delta-sync
   * compares against the local cache to decide whether a fresh
   * download is even needed — see getTimetableIfChanged.
   */
  updatedAt: number;
  /** uid of whoever performed the last successful save. */
  updatedBy: string;
  /** Every day of the week is always present, even if empty — see emptyTimetable. */
  days: Record<string, TimetableDay>;
}

/** Shape submitted from the add/edit-period dialog. */
export interface TimetablePeriodFormValues {
  slotId: string;
  subjectId: string;
  teacherId: string;
}

/**
 * teacherId -> day -> slotId -> class-section doc IDs
 * (`${classId}_${sectionId}`) currently booking that teacher at that
 * day+slot, anywhere in the school. Built once per page-open from a
 * one-time read over every WeeklyTimetable document (see
 * timetableService.buildConflictMap) — there's no live listener
 * backing this, per the delta-sync design; it's refreshed explicitly
 * after saves that could change it.
 *
 * A slot with more than one doc ID in its list means that teacher is
 * double-booked; which one is "the current class-section being
 * edited" is for the caller to exclude — see isTeacherConflicted.
 */
export type TeacherConflictMap = Record<string, Record<string, Record<string, string[]>>>;