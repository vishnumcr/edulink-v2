/**
 * --------------------------------------------------------------------
 * File:
 * repositories/results/examTermsRepository.ts
 *
 * Purpose:
 * The only place that talks to Firestore for
 * schools/{schoolId}/examTerms.
 *
 * Responsibilities:
 * ✅ Subscribe to the live exam term list
 * ✅ Create / update / delete an exam term document
 *
 * Does NOT:
 * ❌ Validate form input
 * ❌ Decide subject IDs or default values (that's the service)
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
import { ExamTerm } from "@/types/results";

export type NewExamTermDocument = Omit<ExamTerm, "id" | "createdAt" | "updatedAt">;
export type ExamTermDocumentUpdate = Partial<Omit<ExamTerm, "id" | "createdAt">>;

export class ExamTermsRepository {
  /**
   * ----------------------------------------------------
   * Live subscription to every exam term in a school,
   * ordered the way the school sequenced their academic year.
   * ----------------------------------------------------
   */
  subscribeToExamTerms(
    schoolId: string,
    callback: (docs: { id: string; data: Record<string, unknown> }[]) => void
  ): () => void {
    const q = query(
      collection(db, "schools", schoolId, "examTerms"),
      orderBy("order", "asc")
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

  async createExamTerm(schoolId: string, data: NewExamTermDocument): Promise<string> {
    const ref = await addDoc(collection(db, "schools", schoolId, "examTerms"), {
      ...data,
      createdAt: serverTimestamp(),
    });
    return ref.id;
  }

  async updateExamTerm(
    schoolId: string,
    termId: string,
    data: ExamTermDocumentUpdate
  ): Promise<void> {
    await updateDoc(doc(db, "schools", schoolId, "examTerms", termId), {
      ...data,
      updatedAt: serverTimestamp(),
    });
  }

  async deleteExamTerm(schoolId: string, termId: string): Promise<void> {
    await deleteDoc(doc(db, "schools", schoolId, "examTerms", termId));
  }
}

export const examTermsRepository = new ExamTermsRepository();