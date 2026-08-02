/**
 * --------------------------------------------------------------------
 * File:
 * repositories/timetable/timetableRepository.ts
 *
 * Purpose:
 * The only place that talks to Firestore for
 * schools/{schoolId}/timetables/{classId}_{sectionId} — one document
 * per class-section, containing that section's entire week. Config
 * data scoped to a school the caller already has permission to touch
 * — plain CRUD, fine directly through the client SDK, same reasoning
 * as timingsRepository/routesRepository/etc.
 *
 * This replaces the previous per-slot design (one document per
 * (section, day, slot), fanned out across every class via a
 * collectionGroup listener). See WeeklyTimetable's doc comment in
 * types/timetable.ts for the full reasoning behind the move.
 *
 * Responsibilities:
 * ✅ One-time read of a single class-section's timetable document
 * ✅ One-time read of every timetable document in a school (used to
 *    build the teacher-conflict map — see timetableService)
 * ✅ Save the whole `days` map for one class-section, enforcing
 *    optimistic concurrency via a transaction
 *
 * Does NOT:
 * ❌ Validate form input, or know what "conflict" means (that's the
 *    service)
 * ❌ Know about master timings, subjects, or teachers as concepts —
 *    it only stores the IDs the service hands it
 * ❌ Use onSnapshot anywhere. Timetables are read constantly and
 *    written rarely, so this feature deliberately does one-time reads
 *    plus local caching (see timetableCache.ts / timetableService's
 *    delta sync) instead of a live listener — a school with a hundred
 *    open dashboard tabs shouldn't hold a hundred idle listeners open
 *    against config data that's edited a handful of times a term.
 * --------------------------------------------------------------------
 */

import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { TeacherSchedulePatch } from "@/types/timetable";

export interface RawTimetableDoc {
  id: string;
  data: Record<string, unknown>;
}

/** Firestore rejects a save whose expected version is stale — the caller should reload and retry. */
export interface SaveConflictResult {
  ok: false;
  reason: "conflict";
}

export interface SaveSuccessResult {
  ok: true;
  doc: RawTimetableDoc;
}

export type SaveTimetableResult = SaveSuccessResult | SaveConflictResult;

export class TimetableRepository {
  /**
   * ----------------------------------------------------
   * Deterministic document ID for one class-section — every class's
   * whole week lives at this one ID, not one ID per slot.
   * ----------------------------------------------------
   */
  docId(classId: string, sectionId: string): string {
    return `${classId}_${sectionId}`;
  }

  private docRef(schoolId: string, classId: string, sectionId: string) {
    return doc(db, "schools", schoolId, "timetables", this.docId(classId, sectionId));
  }

  /**
   * ----------------------------------------------------
   * One-time read of a single class-section's timetable. Returns null
   * if that class-section has never been saved — a brand-new class,
   * or one whose timetable hasn't been built yet.
   * ----------------------------------------------------
   */
  async getTimetable(
    schoolId: string,
    classId: string,
    sectionId: string
  ): Promise<RawTimetableDoc | null> {
    const snapshot = await getDoc(this.docRef(schoolId, classId, sectionId));
    return snapshot.exists() ? { id: snapshot.id, data: snapshot.data() } : null;
  }

  /**
   * ----------------------------------------------------
   * One-time read of a single teacher's schedule — schools/{schoolId}/
   * teacherSchedules/{teacherId}. This is the whole point of the
   * teacherSchedules model: the teacher app's login flow gets a
   * complete, ready-to-render schedule in exactly one document read,
   * by an ID it already has (the signed-in teacher's own uid), no
   * query across every class-section's timetable required. Returns
   * null for a teacher with no assignments yet, not an error.
   * ----------------------------------------------------
   */
  async getSchedule(schoolId: string, teacherId: string): Promise<RawTimetableDoc | null> {
    const snapshot = await getDoc(doc(db, "schools", schoolId, "teacherSchedules", teacherId));
    return snapshot.exists() ? { id: snapshot.id, data: snapshot.data() } : null;
  }

  /**
   * ----------------------------------------------------
   * One-time read of EVERY timetable document in a school — replaces
   * the old collectionGroup listener as the source for the
   * teacher-conflict map. There's no live subscription behind this;
   * callers re-fetch explicitly when they need fresh conflict data
   * (page open, after a save that could introduce/resolve a
   * conflict) — see timetableService.buildConflictMap.
   * ----------------------------------------------------
   */
  async getAllTimetables(schoolId: string): Promise<RawTimetableDoc[]> {
    const snapshot = await getDocs(collection(db, "schools", schoolId, "timetables"));
    return snapshot.docs.map((d) => ({ id: d.id, data: d.data() }));
  }

  /**
   * ----------------------------------------------------
   * Overwrites one class-section's entire `days` map inside a
   * transaction, enforcing optimistic concurrency:
   *
   *   1. Read the document's CURRENT version inside the transaction
   *      (0 if it doesn't exist yet).
   *   2. If that doesn't match `expectedVersion` — someone else saved
   *      in between the caller loading their copy and calling this —
   *      abort and report a conflict instead of overwriting their
   *      change.
   *   3. Otherwise write, incrementing version by exactly 1.
   *
   * The service is responsible for turning `{ ok: false }` into the
   * friendly "modified by another user" message; this layer only
   * reports the fact of the conflict.
   *
   * After a successful transaction this does one extra `getDoc` to
   * hand back the doc with its resolved `updatedAt` — `serverTimestamp()`
   * inside the transaction write is a sentinel until it lands, and
   * the caller (the service's cache-updating code) needs a real,
   * comparable timestamp immediately, not after the fact.
   * ----------------------------------------------------
   */
  /**
   * ----------------------------------------------------
   * Overwrites one class-section's entire `days` map inside a
   * transaction, enforcing optimistic concurrency:
   *
   *   1. Read the document's CURRENT version inside the transaction
   *      (0 if it doesn't exist yet).
   *   2. If that doesn't match `expectedVersion` — someone else saved
   *      in between the caller loading their copy and calling this —
   *      abort and report a conflict instead of overwriting their
   *      change.
   *   3. Otherwise write, incrementing version by exactly 1.
   *
   * `teacherSchedulePatches` (computed by timetableService.diffTeacherSchedulePatches
   * — this layer doesn't compute the diff, only applies it) is written
   * in the SAME transaction as the main save, not a follow-up call —
   * a page reload between the two would otherwise leave a teacher's
   * schedule silently stale relative to the timetable that just changed.
   * Patches are grouped by teacherId into ONE `set(..., {merge:true})`
   * per affected teacher, using dotted field paths as the payload's own
   * keys (e.g. "bySection.class6_A.days.Monday.slot_1") — this merges
   * ONLY those exact nested keys, leaving every other class-section
   * already on that teacher's schedule doc untouched. Firestore
   * transactions support up to 500 document writes; a single
   * timetable save touching more than a handful of distinct teachers
   * is not a realistic case.
   *
   * The service is responsible for turning `{ ok: false }` into the
   * friendly "modified by another user" message; this layer only
   * reports the fact of the conflict.
   *
   * After a successful transaction this does one extra `getDoc` to
   * hand back the doc with its resolved `updatedAt` — `serverTimestamp()`
   * inside the transaction write is a sentinel until it lands, and
   * the caller (the service's cache-updating code) needs a real,
   * comparable timestamp immediately, not after the fact.
   * ----------------------------------------------------
   */
  async saveTimetable(
    schoolId: string,
    classId: string,
    sectionId: string,
    days: Record<string, Record<string, { subjectId: string; teacherId: string }>>,
    academicYear: string,
    expectedVersion: number,
    updatedBy: string,
    teacherSchedulePatches: TeacherSchedulePatch[] = []
  ): Promise<SaveTimetableResult> {
    const ref = this.docRef(schoolId, classId, sectionId);

    const outcome = await runTransaction(db, async (tx) => {
      const snapshot = await tx.get(ref);
      const currentVersion = snapshot.exists() ? ((snapshot.data().version as number) ?? 0) : 0;

      if (currentVersion !== expectedVersion) {
        return { ok: false as const };
      }

      tx.set(ref, {
        schoolId,
        classId,
        sectionId,
        academicYear,
        version: currentVersion + 1,
        updatedAt: serverTimestamp(),
        updatedBy,
        days,
      });

      // One combined dotted-path payload per teacher, so a save
      // touching this teacher at several (day, slot) pairs at once
      // (e.g. copyDay affecting six target days) doesn't call set()
      // on their doc more than once within this transaction — the
      // second call would just overwrite the first, not merge with it.
      const byTeacher = new Map<string, Record<string, unknown>>();
      for (const patch of teacherSchedulePatches) {
        const payload = byTeacher.get(patch.teacherId) ?? {};
        payload[`bySection.${patch.sectionKey}.className`] = patch.className;
        payload[`bySection.${patch.sectionKey}.sectionName`] = patch.sectionName;
        payload[`bySection.${patch.sectionKey}.days.${patch.day}.${patch.slotId}`] =
          patch.entry ?? deleteField();
        payload.updatedAt = serverTimestamp();
        byTeacher.set(patch.teacherId, payload);
      }
      for (const [teacherId, payload] of byTeacher) {
        tx.set(doc(db, "schools", schoolId, "teacherSchedules", teacherId), payload, { merge: true });
      }

      return { ok: true as const };
    });

    if (!outcome.ok) {
      return { ok: false, reason: "conflict" };
    }

    const saved = await this.getTimetable(schoolId, classId, sectionId);
    // saved can't actually be null here — the transaction above just
    // wrote it — but TypeScript doesn't know that across the await.
    return { ok: true, doc: saved! };
  }
}

export const timetableRepository = new TimetableRepository();