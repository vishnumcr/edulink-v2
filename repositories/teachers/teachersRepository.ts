/**
 * --------------------------------------------------------------------
 * File:
 * repositories/teachers/teachersRepository.ts
 *
 * Purpose:
 * The only place that talks to Firestore/Storage for a school's
 * teachers. Photo upload lives here rather than in a generic "storage"
 * module — it's intrinsic to the teacher entity (schools/{schoolId}/
 * teachers/{teacherId}.webp), not a shared concern yet.
 *
 * Responsibilities:
 * ✅ Subscribe to the live teacher list
 * ✅ Create / delete a teacher document
 * ✅ Upload a teacher's photo to Storage
 *
 * Does NOT:
 * ❌ Validate form input
 * ❌ Compress/process images (see utils/image.ts)
 * ❌ Decide the create/upload/write ordering (that's the service)
 * --------------------------------------------------------------------
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  DocumentReference,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import { Teacher } from "@/types/teachers";

export type NewTeacherDocument = Omit<Teacher, "id" | "createdAt">;

export class TeachersRepository {
  /**
   * ----------------------------------------------------
   * Live subscription to every teacher in a school.
   * ----------------------------------------------------
   */
  subscribeToTeachers(
    schoolId: string,
    callback: (docs: { id: string; data: Record<string, unknown> }[]) => void
  ): () => void {
    const teachersRef = collection(db, "schools", schoolId, "teachers");

    return onSnapshot(teachersRef, (snapshot) => {
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
   * Generates a Firestore document reference with an ID,
   * without writing anything yet. Lets the service upload a
   * photo keyed by this ID before the teacher document exists,
   * so the doc can be written once with photoUrl already set.
   * ----------------------------------------------------
   */
  newTeacherRef(schoolId: string): DocumentReference {
    return doc(collection(db, "schools", schoolId, "teachers"));
  }

  /**
   * ----------------------------------------------------
   * Uploads a teacher's photo to Storage and returns its
   * public download URL.
   * ----------------------------------------------------
   */
  async uploadPhoto(schoolId: string, teacherId: string, blob: Blob): Promise<string> {
    const storageRef = ref(storage, `schools/${schoolId}/teachers/${teacherId}.webp`);
    await uploadBytes(storageRef, blob);
    return getDownloadURL(storageRef);
  }

  /**
   * ----------------------------------------------------
   * Writes a teacher document at a pre-generated reference
   * (see newTeacherRef). Single write, whether or not a
   * photo was uploaded first.
   * ----------------------------------------------------
   */
  async createTeacherAt(ref: DocumentReference, data: NewTeacherDocument): Promise<void> {
    await setDoc(ref, {
      ...data,
      createdAt: serverTimestamp(),
    });
  }

  /**
   * ----------------------------------------------------
   * Fallback path for creating a teacher without a
   * pre-generated ref (no photo to upload first).
   * ----------------------------------------------------
   */
  async createTeacher(schoolId: string, data: NewTeacherDocument): Promise<void> {
    await addDoc(collection(db, "schools", schoolId, "teachers"), {
      ...data,
      createdAt: serverTimestamp(),
    });
  }

  /**
   * ----------------------------------------------------
   * Delete a teacher document.
   *
   * Note: does not delete the Storage photo — orphaned Storage
   * objects don't affect Firestore/UI correctness, and cleaning
   * them up is a separate concern (e.g. a scheduled Cloud Function)
   * rather than something the client should be responsible for.
   * ----------------------------------------------------
   */
  async deleteTeacher(schoolId: string, teacherId: string): Promise<void> {
    await deleteDoc(doc(db, "schools", schoolId, "teachers", teacherId));
  }
}

export const teachersRepository = new TeachersRepository();