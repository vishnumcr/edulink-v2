/**
 * --------------------------------------------------------------------
 * File:
 * repositories/academic/subjectsRepository.ts
 *
 * Purpose:
 * The only place that talks to Firestore for
 * schools/{schoolId}/subjects — the school-wide subject catalog.
 *
 * Responsibilities:
 * ✅ Subscribe to the live subject list
 * ✅ Create / update / delete a subject document
 *
 * Does NOT:
 * ❌ Validate form input
 * ❌ Assign order/IDs (that's the service)
 * ❌ Know which classes a subject is assigned to — that link lives on
 *    the class document (see classesRepository.updateClassSubjects),
 *    not here. Subjects don't know their consumers.
 * --------------------------------------------------------------------
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Subject } from "@/types/academic";

export type NewSubjectDocument = Omit<Subject, "id" | "createdAt" | "updatedAt">;
export type SubjectDocumentUpdate = Partial<Omit<Subject, "id" | "createdAt">>;

export class SubjectsRepository {
  /**
   * ----------------------------------------------------
   * Live subscription to every subject in a school,
   * ordered the way the school sequenced its catalog.
   * ----------------------------------------------------
   */
  subscribeToSubjects(
    schoolId: string,
    callback: (docs: { id: string; data: Record<string, unknown> }[]) => void
  ): () => void {
    const q = query(
      collection(db, "schools", schoolId, "subjects"),
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

  async createSubject(schoolId: string, data: NewSubjectDocument): Promise<string> {
    const ref = await addDoc(collection(db, "schools", schoolId, "subjects"), {
      ...data,
      createdAt: serverTimestamp(),
    });
    return ref.id;
  }

  async updateSubject(
    schoolId: string,
    subjectId: string,
    data: SubjectDocumentUpdate
  ): Promise<void> {
    await updateDoc(doc(db, "schools", schoolId, "subjects", subjectId), {
      ...data,
      updatedAt: serverTimestamp(),
    });
  }

  async deleteSubject(schoolId: string, subjectId: string): Promise<void> {
    await deleteDoc(doc(db, "schools", schoolId, "subjects", subjectId));
  }
}

export const subjectsRepository = new SubjectsRepository();