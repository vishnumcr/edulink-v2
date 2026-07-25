/**
 * --------------------------------------------------------------------
 * File:
 * repositories/attendance/attendanceRepository.ts
 *
 * Purpose:
 * The only place that talks to Firestore for attendance. Read-only —
 * this project never writes a register (the not-yet-built teacher app
 * does); the parentAttendance rollup is written entirely by a Cloud
 * Function (functions/src/attendance/onRegisterWrite.ts) reacting to
 * those writes, not by anything here.
 *
 * Two collections, two access patterns — see types/attendance.ts's
 * file header for the full reasoning on why each view reads what it
 * reads:
 *   schools/{schoolId}/attendanceRegister/{classId}_{sectionId}_{date}
 *   schools/{schoolId}/parentAttendance/{studentId}
 *   schools/{schoolId}/parentAttendance/{studentId}/months/{month}
 *
 * Returns RawDoc ({ id, data }) rather than typed AttendanceRegister/
 * ParentAttendanceMonth objects — the service does its own field
 * extraction (it needs individual fields like data.classId, data.summary,
 * data.days off documents from genuinely different shapes), so handing
 * back a single loosely-typed shape here is more honest than forcing
 * a typed cast this layer can't actually guarantee.
 *
 * Does NOT:
 * ❌ Aggregate, tally, or compute percentages (that's the service)
 * ❌ Write anything, ever
 * --------------------------------------------------------------------
 */

import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface RawDoc {
  id: string;
  data: Record<string, unknown>;
}

function toRawDocs(docs: { id: string; data: () => Record<string, unknown> | undefined }[]): RawDoc[] {
  return docs.map((d) => ({ id: d.id, data: d.data() ?? {} }));
}

export class AttendanceRepository {
  /**
   * ----------------------------------------------------
   * Live subscription to EVERY class-section's register for a single
   * date — what class teachers have saved from the teacher app so far
   * today. Class-sections with no doc yet simply don't appear; the
   * service cross-references this against the full class-section list
   * to know what's still unmarked.
   * ----------------------------------------------------
   */
  subscribeToRegistersForDate(
    schoolId: string,
    date: string,
    callback: (docs: RawDoc[]) => void
  ): () => void {
    const q = query(collection(db, "schools", schoolId, "attendanceRegister"), where("date", "==", date));

    return onSnapshot(q, (snapshot) => {
      callback(toRawDocs(snapshot.docs));
    });
  }

  /**
   * ----------------------------------------------------
   * One-time fetch of every register saved in [startDate, endDate]
   * (inclusive), across all class-sections — backs the per-class-
   * section trend averages, which read the source of truth directly
   * rather than the per-student rollup (see ClassAverage's doc
   * comment in types/attendance.ts for why).
   *
   * "YYYY-MM-DD" strings sort lexicographically the same as
   * chronologically, so a plain string range query works without a
   * separate timestamp field.
   * ----------------------------------------------------
   */
  async getRegistersInRange(schoolId: string, startDate: string, endDate: string): Promise<RawDoc[]> {
    const q = query(
      collection(db, "schools", schoolId, "attendanceRegister"),
      where("date", ">=", startDate),
      where("date", "<=", endDate)
    );

    const snapshot = await getDocs(q);
    return toRawDocs(snapshot.docs);
  }

  /**
   * ----------------------------------------------------
   * Every student's month doc, across the whole school, for the given
   * months — a single collectionGroup("months") query rather than
   * reading each student's subcollection individually, made possible
   * by schoolId/month being denormalized onto every month doc (see
   * ParentAttendanceMonth's doc comment in types/attendance.ts).
   *
   * Firestore's "in" operator caps at 30 values, so a range spanning
   * more than 30 months is chunked — not a realistic case for this
   * page's date pickers, but cheap to guard against regardless.
   * ----------------------------------------------------
   */
  async getMonthsForSchool(schoolId: string, months: string[]): Promise<RawDoc[]> {
    if (months.length === 0) return [];

    const chunks: string[][] = [];
    for (let i = 0; i < months.length; i += 30) chunks.push(months.slice(i, i + 30));

    const results = await Promise.all(
      chunks.map((chunk) =>
        getDocs(
          query(
            collectionGroup(db, "months"),
            where("schoolId", "==", schoolId),
            where("month", "in", chunk)
          )
        )
      )
    );

    return results.flatMap((snapshot) => toRawDocs(snapshot.docs));
  }

  /**
   * ----------------------------------------------------
   * One parentAttendance summary doc per studentId, read directly by
   * id (not a query) since the caller already knows exactly which
   * students it wants — e.g. getCurrentStanding's single-student
   * lookup. Missing docs (a student with no attendance history yet)
   * are silently skipped, not treated as an error.
   * ----------------------------------------------------
   */
  async getSummaries(schoolId: string, studentIds: string[]): Promise<RawDoc[]> {
    const snapshots = await Promise.all(
      studentIds.map((studentId) => getDoc(doc(db, "schools", schoolId, "parentAttendance", studentId)))
    );

    return snapshots
      .filter((snap) => snap.exists())
      .map((snap) => ({ id: snap.id, data: snap.data() ?? {} }));
  }
}

export const attendanceRepository = new AttendanceRepository();