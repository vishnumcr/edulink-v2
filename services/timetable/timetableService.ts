/**
 * --------------------------------------------------------------------
 * File:
 * services/timetable/timetableService.ts
 *
 * Purpose:
 * Business logic for the per-class weekly schedule (schools/{schoolId}/
 * timetables/{classId}_{sectionId}). Sibling to timingsService, which
 * owns the shared master clock this feature slots periods into.
 *
 * Responsibilities:
 * ✅ Normalize raw Firestore data into a well-formed WeeklyTimetable
 * ✅ Delta sync: only ask Firestore to actually hand back a document
 *    body when it's newer than what's already cached locally — see
 *    getTimetableIfChanged
 * ✅ Mutate a day's periods (save/delete/copy) with optimistic
 *    concurrency, surfacing a friendly error on a version conflict
 *    instead of silently overwriting another admin's change
 * ✅ Build the school-wide teacher-conflict map from a one-time read
 *    over every timetable document (see repository doc comment for
 *    why this is no longer a collectionGroup listener)
 * ✅ Validate a period before saving (slot must exist and be a
 *    "class" slot; subject + teacher required)
 *
 * Does NOT:
 * ❌ Call Firestore directly (that's the repository's job)
 * ❌ Touch IndexedDB directly (that's timetableCache.ts's job — this
 *    file coordinates the two, it doesn't replace either)
 * ❌ Know about classes, sections, subjects, or teachers as their own
 *    features — it only stores/compares the IDs it's given
 * --------------------------------------------------------------------
 */

import {
  timetableRepository,
  RawTimetableDoc,
} from "@/repositories/timetable/timetableRepository";
import { timetableCache } from "@/services/timetable/timetableCache";
import {
  TeacherConflictMap,
  TimetableDay,
  TimingSlot,
  WeeklyTimetable,
} from "@/types/timetable";

/** Sentinel sectionId for a class that has no sections — matches the
 *  pattern used elsewhere in this feature for "treat the whole class
 *  as one section." */
export const NO_SECTION_ID = "_no_section";

/** Every WeeklyTimetable always carries all six keys in `days`, scheduled or not — see emptyTimetable. */
export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const CONFLICT_MESSAGE = "This timetable was modified by another user. Please reload before saving.";

/**
 * ----------------------------------------------------
 * Safely coerces a raw Firestore timestamp field into a plain
 * epoch-millisecond number. Nothing past this normalization boundary
 * should ever touch a raw Firestore Timestamp directly — it collapses
 * into a bare {seconds, nanoseconds} object the moment it's cloned
 * into IndexedDB, which is exactly the shape the delta-sync needs to
 * compare as a plain number, not an object.
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

/** A brand-new class-section that has never been saved — version 0, every day present but empty. */
function emptyTimetable(
  schoolId: string,
  classId: string,
  sectionId: string,
  academicYear: string
): WeeklyTimetable {
  const days: Record<string, TimetableDay> = {};
  for (const day of DAYS) days[day] = {};
  return {
    schoolId,
    classId,
    sectionId,
    academicYear,
    version: 0,
    updatedAt: 0,
    updatedBy: "",
    days,
  };
}

/**
 * Normalizes a raw Firestore doc into a well-formed WeeklyTimetable.
 * Defensive against legacy/partial documents — every field falls back
 * to a safe default, and every day key is guaranteed present even if
 * the stored `days` map is missing one (e.g. hand-edited data).
 */
function normalizeTimetable(raw: RawTimetableDoc, fallback: {
  schoolId: string;
  classId: string;
  sectionId: string;
  academicYear: string;
}): WeeklyTimetable {
  const d = raw.data;
  const rawDays = (d.days as Record<string, Record<string, Record<string, unknown>>>) || {};

  const days: Record<string, TimetableDay> = {};
  for (const day of DAYS) {
    const rawDay = rawDays[day] || {};
    const normalizedDay: TimetableDay = {};
    for (const slotId of Object.keys(rawDay)) {
      const period = rawDay[slotId] || {};
      normalizedDay[slotId] = {
        subjectId: (period.subjectId as string) || "",
        teacherId: (period.teacherId as string) || "",
      };
    }
    days[day] = normalizedDay;
  }

  return {
    schoolId: (d.schoolId as string) || fallback.schoolId,
    classId: (d.classId as string) || fallback.classId,
    sectionId: (d.sectionId as string) || fallback.sectionId,
    academicYear: (d.academicYear as string) || fallback.academicYear,
    version: (d.version as number) ?? 0,
    updatedAt: toMillis(d.updatedAt),
    updatedBy: (d.updatedBy as string) || "",
    days,
  };
}

export class TimetableService {
  /**
   * ----------------------------------------------------
   * The Timetable page's main data source. Delta sync:
   *
   *   Open Timetable
   *        ↓
   *   Read local cache + Firestore's copy of this ONE doc
   *        ↓
   *   Compare cached updatedAt with Firestore's updatedAt
   *        ↓
   *   If unchanged → use cached timetable (no re-normalizing needed)
   *   Else         → normalize Firestore's copy, replace the cache
   *
   * This is still exactly one Firestore read per call — timetables
   * are single, self-contained documents, so there's no cheaper way
   * to know "has this changed" than reading it; the delta sync's
   * payoff is on the CPU/render side (skip renormalizing + skip an
   * IndexedDB write when nothing changed), not in read count. A
   * class-section that has never been saved anywhere returns (and
   * caches) an empty, version-0 timetable rather than null, so
   * callers never need a separate "not found" branch.
   * ----------------------------------------------------
   */
  async getTimetableIfChanged(
    schoolId: string,
    classId: string,
    sectionId: string,
    academicYear: string
  ): Promise<WeeklyTimetable> {
    const fallback = { schoolId, classId, sectionId, academicYear };
    const [cached, raw] = await Promise.all([
      timetableCache.get(schoolId, classId, sectionId),
      timetableRepository.getTimetable(schoolId, classId, sectionId),
    ]);

    if (!raw) {
      const empty = emptyTimetable(schoolId, classId, sectionId, academicYear);
      await timetableCache.set(schoolId, classId, sectionId, empty);
      return empty;
    }

    const remoteUpdatedAt = toMillis(raw.data.updatedAt);
    if (cached && cached.updatedAt === remoteUpdatedAt) {
      return cached;
    }

    const timetable = normalizeTimetable(raw, fallback);
    await timetableCache.set(schoolId, classId, sectionId, timetable);
    return timetable;
  }

  /**
   * Forces a fresh read + cache replace, bypassing the "unchanged"
   * short-circuit above. Used after a save conflict — the caller was
   * just told their local copy is stale, so there's no point checking
   * whether it's "still" unchanged; it's known to be wrong.
   */
  async getTimetable(
    schoolId: string,
    classId: string,
    sectionId: string,
    academicYear: string
  ): Promise<WeeklyTimetable> {
    const raw = await timetableRepository.getTimetable(schoolId, classId, sectionId);
    const timetable = raw
      ? normalizeTimetable(raw, { schoolId, classId, sectionId, academicYear })
      : emptyTimetable(schoolId, classId, sectionId, academicYear);
    await timetableCache.set(schoolId, classId, sectionId, timetable);
    return timetable;
  }

  /**
   * ----------------------------------------------------
   * One-time read of every timetable document in the school,
   * normalized and reduced into a conflict map. There's no live
   * subscription behind this — call it when the page opens and again
   * after any save/delete/copy that could change which teacher is
   * booked where (own class-section's edits can newly conflict with,
   * or newly clear a conflict with, another class-section's).
   * ----------------------------------------------------
   */
  async buildConflictMap(schoolId: string): Promise<TeacherConflictMap> {
    const rawDocs = await timetableRepository.getAllTimetables(schoolId);
    const map: TeacherConflictMap = {};

    for (const raw of rawDocs) {
      const classId = (raw.data.classId as string) || "";
      const sectionId = (raw.data.sectionId as string) || "";
      const docId = timetableRepository.docId(classId, sectionId);
      const timetable = normalizeTimetable(raw, { schoolId, classId, sectionId, academicYear: "" });

      for (const day of DAYS) {
        for (const [slotId, period] of Object.entries(timetable.days[day])) {
          if (!period.teacherId) continue;
          const byDay = (map[period.teacherId] ??= {});
          const bySlot = (byDay[day] ??= {});
          (bySlot[slotId] ??= []).push(docId);
        }
      }
    }

    return map;
  }

  /**
   * True if teacherId is booked at day+slotId by some class-section
   * OTHER than the one currently being edited — e.g. editing Class
   * 6-A's Monday Period 2 shouldn't warn about the teacher already
   * assigned to THAT exact slot; it should only warn if they're
   * double-booked elsewhere.
   */
  isTeacherConflicted(
    conflictMap: TeacherConflictMap,
    teacherId: string,
    day: string,
    slotId: string,
    classId: string,
    sectionId: string
  ): boolean {
    if (!teacherId) return false;
    const bookedBy = conflictMap[teacherId]?.[day]?.[slotId];
    if (!bookedBy) return false;
    const thisDocId = timetableRepository.docId(classId, sectionId);
    return bookedBy.some((docId) => docId !== thisDocId);
  }

  private validatePeriod(
    slot: TimingSlot | undefined,
    values: { subjectId: string; teacherId: string }
  ): string | null {
    if (!slot) return "That slot no longer exists in the master clock.";
    if (slot.type !== "class") return "Only class periods can have a subject and teacher assigned.";
    if (!values.subjectId) return "Choose a subject.";
    if (!values.teacherId) return "Choose a teacher.";
    return null;
  }

  /**
   * Assigns a subject+teacher to one slot on one day, saving the
   * class-section's whole `days` map with optimistic concurrency.
   * `current` must be the caller's most recently loaded copy — its
   * `version` is what guards against overwriting a concurrent edit.
   */
  async saveDay(
    schoolId: string,
    classId: string,
    sectionId: string,
    academicYear: string,
    updatedBy: string,
    current: WeeklyTimetable,
    day: string,
    slot: TimingSlot | undefined,
    values: { subjectId: string; teacherId: string }
  ): Promise<{ ok: true; timetable: WeeklyTimetable } | { ok: false; error: string }> {
    const error = this.validatePeriod(slot, values);
    if (error) return { ok: false, error };

    const nextDays = {
      ...current.days,
      [day]: {
        ...current.days[day],
        [slot!.id]: { subjectId: values.subjectId, teacherId: values.teacherId },
      },
    };

    return this.persist(schoolId, classId, sectionId, academicYear, updatedBy, current, nextDays);
  }

  /** Clears one slot's subject+teacher assignment on one day. The slot itself stays in the master clock. */
  async deleteDay(
    schoolId: string,
    classId: string,
    sectionId: string,
    academicYear: string,
    updatedBy: string,
    current: WeeklyTimetable,
    day: string,
    slotId: string
  ): Promise<{ ok: true; timetable: WeeklyTimetable } | { ok: false; error: string }> {
    const nextDay = { ...current.days[day] };
    delete nextDay[slotId];
    const nextDays = { ...current.days, [day]: nextDay };

    return this.persist(schoolId, classId, sectionId, academicYear, updatedBy, current, nextDays);
  }

  /**
   * Copies every scheduled period from one day onto one or more
   * target days, for one class+section. Matches the previous
   * behavior: a target day's periods that share a slotId with the
   * source day are overwritten; periods in the target day at OTHER
   * slotIds are left alone (this is a merge per target day, not a
   * wholesale replace of the target day).
   */
  async copyDay(
    schoolId: string,
    classId: string,
    sectionId: string,
    academicYear: string,
    updatedBy: string,
    current: WeeklyTimetable,
    sourceDay: string,
    targetDays: string[]
  ): Promise<{ ok: true; timetable: WeeklyTimetable } | { ok: false; error: string }> {
    const sourcePeriods = current.days[sourceDay] || {};
    const nextDays = { ...current.days };
    for (const targetDay of targetDays) {
      nextDays[targetDay] = { ...(nextDays[targetDay] || {}), ...sourcePeriods };
    }

    return this.persist(schoolId, classId, sectionId, academicYear, updatedBy, current, nextDays);
  }

  /**
   * ----------------------------------------------------
   * Shared save path for saveDay/deleteDay/copyDay: write the given
   * `days` map with the current copy's version as the expected
   * version, update the local cache on success, and translate a
   * version conflict into the friendly error the UI shows.
   * ----------------------------------------------------
   */
  private async persist(
    schoolId: string,
    classId: string,
    sectionId: string,
    academicYear: string,
    updatedBy: string,
    current: WeeklyTimetable,
    nextDays: Record<string, TimetableDay>
  ): Promise<{ ok: true; timetable: WeeklyTimetable } | { ok: false; error: string }> {
    const result = await timetableRepository.saveTimetable(
      schoolId,
      classId,
      sectionId,
      nextDays,
      academicYear,
      current.version,
      updatedBy
    );

    if (!result.ok) {
      return { ok: false, error: CONFLICT_MESSAGE };
    }

    const timetable = normalizeTimetable(result.doc, { schoolId, classId, sectionId, academicYear });
    await timetableCache.set(schoolId, classId, sectionId, timetable);
    return { ok: true, timetable };
  }
}

export const timetableService = new TimetableService();
