/**
 * --------------------------------------------------------------------
 * File:
 * repositories/students/studentsRepository.ts
 *
 * Purpose:
 * The only place that talks to Firestore for schools/{schoolId}/students.
 *
 * Responsibilities:
 * ✅ Subscribe to the live student list (used by other pages' roster
 *    pickers — attendance, finance/collect, results)
 * ✅ Fetch students updated since a given time (delta-sync — used by
 *    the Students page's local cache, see StudentsService.syncStudents)
 * ✅ Create / update / (soft) delete a student document
 *
 * Does NOT:
 * ❌ Validate form input
 * ❌ Apply default values for missing fields (that's the service)
 * ❌ Map form values to the Student document shape
 * ❌ Touch IndexedDB or any other browser cache (that's studentsCache.ts)
 * --------------------------------------------------------------------
 */

import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Student } from "@/types/students";

export type NewStudentDocument = Omit<Student, "id" | "createdAt" | "updatedAt">;
export type StudentDocumentUpdate = Partial<Omit<Student, "id" | "createdAt">>;

export class StudentsRepository {
  /**
   * ----------------------------------------------------
   * Live subscription to every student in a school. Used by other
   * pages' roster pickers (attendance, finance/collect, results) —
   * NOT by the Students admin page itself, which reads from the local
   * cache instead (see StudentsService.syncStudents).
   *
   * Returns an unsubscribe function. Callback receives raw Firestore
   * data (loosely typed) — the service is responsible for
   * defaulting/normalizing it into a well-formed Student.
   * ----------------------------------------------------
   */
  subscribeToStudents(
    schoolId: string,
    callback: (docs: { id: string; data: Record<string, unknown> }[]) => void
  ): () => void {
    const q = query(
      collection(db, "schools", schoolId, "students"),
      orderBy("className", "asc")
    );

    return onSnapshot(q, (snapshot) => {
      callback(
        snapshot.docs.map((d) => ({
          id: d.id,
          data: d.data(),
        }))
      );
    });
  }

  /**
   * ----------------------------------------------------
   * One-time fetch of every student updated after `sinceMs` (epoch
   * milliseconds). This is the delta-sync primitive the Students
   * page's local cache is built on: instead of re-reading all 5,000
   * students, a cached client asks "what changed since my last sync"
   * and Firestore returns only the matching docs — billed per match,
   * not per collection size.
   *
   * sinceMs = 0 naturally becomes "fetch everything" (every real
   * document has updatedAt > epoch 0), which is exactly what a
   * cold-start (never-synced) client needs — no separate "fetch all"
   * method required.
   * ----------------------------------------------------
   */
  async getStudentsUpdatedSince(
    schoolId: string,
    sinceMs: number
  ): Promise<{ id: string; data: Record<string, unknown> }[]> {
    const q = query(
      collection(db, "schools", schoolId, "students"),
      where("updatedAt", ">", Timestamp.fromMillis(sinceMs))
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({ id: d.id, data: d.data() }));
  }

  /**
   * ----------------------------------------------------
   * Create a new student document.
   *
   * Sets BOTH createdAt and updatedAt on creation (not just
   * createdAt) — a Firestore inequality query like
   * where("updatedAt", ">", x) silently excludes documents where the
   * field doesn't exist at all, so a student that's only ever been
   * created and never edited would otherwise be permanently invisible
   * to delta-sync.
   * ----------------------------------------------------
   */
  async createStudent(
    schoolId: string,
    data: NewStudentDocument
  ): Promise<void> {
    await addDoc(collection(db, "schools", schoolId, "students"), {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  /**
   * ----------------------------------------------------
   * Update an existing student document.
   * ----------------------------------------------------
   */
  async updateStudent(
    schoolId: string,
    studentId: string,
    data: StudentDocumentUpdate
  ): Promise<void> {
    await updateDoc(doc(db, "schools", schoolId, "students", studentId), {
      ...data,
      updatedAt: serverTimestamp(),
    });
  }

  /**
   * ----------------------------------------------------
   * Soft-delete a student: sets deleted = true rather than removing
   * the document. See the `deleted` field's doc comment in
   * types/students.ts for why — the short version is that a hard
   * delete is invisible to delta-sync, so cached clients would never
   * find out the student was removed.
   * ----------------------------------------------------
   */
  async deleteStudent(schoolId: string, studentId: string): Promise<void> {
    await updateDoc(doc(db, "schools", schoolId, "students", studentId), {
      deleted: true,
      updatedAt: serverTimestamp(),
    });
  }
}

export const studentsRepository = new StudentsRepository();