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
 * ✅ Upload a teacher's photo to Storage, and attach its URL to an
 *    already-created teacher document
 * ✅ Delete a teacher document
 *
 * Does NOT:
 * ❌ Create a teacher document — that now happens exclusively via the
 *    createTeacher Cloud Function (see functions/src/teacher/
 *    createTeacher.ts), because it also has to create the teacher's
 *    Firebase Auth account, which the client SDK cannot do. This
 *    repository used to have newTeacherRef/createTeacherAt/
 *    createTeacher methods doing this as plain client-side writes;
 *    they're gone, not deprecated-in-place, since keeping them around
 *    would just be an unused path to a teacher document with no login.
 * ❌ Validate form input
 * ❌ Compress/process images (see utils/image.ts)
 * ❌ Decide the upload/write ordering (that's the service)
 * --------------------------------------------------------------------
 */

import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "@/lib/firebase";

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
   * Uploads a teacher's photo to Storage and returns its
   * public download URL. Called with the uid the
   * createTeacher Cloud Function returned — the teacher
   * document already exists (created server-side with
   * photoUrl: null) by the time this ever runs; see
   * updatePhotoUrl below for attaching the result.
   * ----------------------------------------------------
   */
  async uploadPhoto(schoolId: string, teacherId: string, blob: Blob): Promise<string> {
    const storageRef = ref(storage, `schools/${schoolId}/teachers/${teacherId}.webp`);
    await uploadBytes(storageRef, blob);
    return getDownloadURL(storageRef);
  }

  /**
   * ----------------------------------------------------
   * Attaches an uploaded photo's URL to an already-created
   * teacher document. A plain client-side update is fine here —
   * unlike creating the document itself, this doesn't touch Auth
   * or any other identity concern, just a display field on a
   * document the client already has full read/write access to.
   * ----------------------------------------------------
   */
  async updatePhotoUrl(schoolId: string, teacherId: string, photoUrl: string): Promise<void> {
    await updateDoc(doc(db, "schools", schoolId, "teachers", teacherId), { photoUrl });
  }

  /**
   * ----------------------------------------------------
   * Delete a teacher document.
   *
   * Note: does not delete the Storage photo — orphaned Storage
   * objects don't affect Firestore/UI correctness, and cleaning
   * them up is a separate concern (e.g. a scheduled Cloud Function)
   * rather than something the client should be responsible for.
   *
   * Also does not delete the teacher's Firebase Auth account or
   * users/{uid} profile — deleting a teacher here only removes them
   * from this school's roster. Leaving their login intact is the
   * safer default until there's an explicit decision about whether
   * "delete a teacher" should also revoke their account entirely.
   * ----------------------------------------------------
   */
  async deleteTeacher(schoolId: string, teacherId: string): Promise<void> {
    await deleteDoc(doc(db, "schools", schoolId, "teachers", teacherId));
  }
}

export const teachersRepository = new TeachersRepository();