/**
 * --------------------------------------------------------------------
 * File:
 * repositories/results/resultsRepository.ts
 *
 * Purpose:
 * The only place that talks to Firestore for
 * schools/{schoolId}/results.
 *
 * Document ID convention:
 * `${termId}_${studentId}` — deterministic, so saving marks is always
 * a single upsert. No "does a result already exist for this student
 * in this term" lookup is ever needed before writing.
 *
 * Responsibilities:
 * ✅ Subscribe to results by exam term (class performance views)
 * ✅ Subscribe to results by student (student lookup / report card)
 * ✅ Upsert a single result document
 * ✅ Delete a result document
 *
 * Does NOT:
 * ❌ Compute totals, percentage, or grade (that's the service)
 * ❌ Validate marks against a subject's max marks (that's the service)
 * --------------------------------------------------------------------
 */

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { StudentResult } from "@/types/results";

export type ResultDocumentUpsert = Omit<StudentResult, "id" | "createdAt" | "updatedAt">;

export function resultId(termId: string, studentId: string): string {
  return `${termId}_${studentId}`;
}

export class ResultsRepository {
  /**
   * ----------------------------------------------------
   * Live subscription to every result recorded for one exam term
   * (used by Enter Marks and Class Performance).
   * ----------------------------------------------------
   */
  subscribeToResultsByTerm(
    schoolId: string,
    termId: string,
    callback: (docs: { id: string; data: Record<string, unknown> }[]) => void
  ): () => void {
    const q = query(
      collection(db, "schools", schoolId, "results"),
      where("termId", "==", termId)
    );

    return onSnapshot(q, (snapshot) => {
      callback(snapshot.docs.map((d) => ({ id: d.id, data: d.data() })));
    });
  }

  /**
   * ----------------------------------------------------
   * Live subscription to every result recorded for one student,
   * across all exam terms (used by Student Lookup).
   * ----------------------------------------------------
   */
  subscribeToResultsByStudent(
    schoolId: string,
    studentId: string,
    callback: (docs: { id: string; data: Record<string, unknown> }[]) => void
  ): () => void {
    const q = query(
      collection(db, "schools", schoolId, "results"),
      where("studentId", "==", studentId)
    );

    return onSnapshot(q, (snapshot) => {
      callback(snapshot.docs.map((d) => ({ id: d.id, data: d.data() })));
    });
  }

  /**
   * ----------------------------------------------------
   * Create or overwrite a student's result for a term.
   *
   * One extra read (getDoc) to know whether this is the first time
   * marks are being entered for this student+term, so createdAt is
   * stamped once and never touched again on later edits. Marks are
   * saved per-row on an explicit action (not per keystroke), so this
   * doesn't run often enough to be a real cost.
   * ----------------------------------------------------
   */
  async saveResult(
    schoolId: string,
    id: string,
    data: ResultDocumentUpsert
  ): Promise<void> {
    const ref = doc(db, "schools", schoolId, "results", id);
    const existing = await getDoc(ref);

    await setDoc(
      ref,
      {
        ...data,
        updatedAt: serverTimestamp(),
        ...(existing.exists() ? {} : { createdAt: serverTimestamp() }),
      },
      { merge: true }
    );
  }

  async deleteResult(schoolId: string, id: string): Promise<void> {
    await deleteDoc(doc(db, "schools", schoolId, "results", id));
  }
}

export const resultsRepository = new ResultsRepository();