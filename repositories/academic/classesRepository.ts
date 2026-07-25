/**
 * --------------------------------------------------------------------
 * File:
 * repositories/academic/classesRepository.ts
 *
 * Purpose:
 * Access to schools/{schoolId}/classes — class labels for other
 * features to reference (fee structure config), plus the
 * class ↔ subject link.
 *
 * The Academic config page still writes className/sections directly
 * (see app/(dashboard)/settings/academic/page.tsx) rather than through
 * this repository — that's a pre-existing inconsistency, not something
 * introduced here. `updateClassSubjects` is added narrowly for the
 * subject-catalog link; it doesn't take on the rest of that page's
 * writes.
 * --------------------------------------------------------------------
 */

import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export class ClassesRepository {
  /**
   * ----------------------------------------------------
   * Live subscription to class labels, ordered the same way the
   * Academic config page orders them (orderIndex).
   * ----------------------------------------------------
   */
  subscribeToClassLabels(
    schoolId: string,
    callback: (labels: string[]) => void
  ): () => void {
    const q = query(
      collection(db, "schools", schoolId, "classes"),
      orderBy("orderIndex", "asc")
    );

    return onSnapshot(q, (snapshot) => {
      const labels = snapshot.docs
        .map((d) => d.data().className as string)
        .filter(Boolean);
      callback(labels);
    });
  }

  /**
   * ----------------------------------------------------
   * Live subscription to full class documents (id + raw data),
   * for callers that need more than just the label — e.g. the
   * subject-assignment picker, which needs each class's id and
   * current subjectIds.
   * ----------------------------------------------------
   */
  subscribeToClasses(
    schoolId: string,
    callback: (docs: { id: string; data: Record<string, unknown> }[]) => void
  ): () => void {
    const q = query(
      collection(db, "schools", schoolId, "classes"),
      orderBy("orderIndex", "asc")
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
   * Sets the list of subject IDs a class offers. Stored as a
   * plain array field on the class document — not a separate
   * join collection — so "what subjects does Grade 6 have" is
   * a single document read, not a query across a link table.
   * ----------------------------------------------------
   */
  async updateClassSubjects(
    schoolId: string,
    classId: string,
    subjectIds: string[]
  ): Promise<void> {
    await updateDoc(doc(db, "schools", schoolId, "classes", classId), {
      subjectIds,
    });
  }
}

export const classesRepository = new ClassesRepository();