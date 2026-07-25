/**
 * --------------------------------------------------------------------
 * File:
 * repositories/school/schoolRepository.ts
 *
 * Purpose:
 * Firestore/Storage access for the school document (schools/{schoolId}).
 *
 * Responsibilities:
 * ✅ Read schools/{schoolId} — both the lightweight branding subset
 *    (getSchoolMeta) and the full settings profile (getSchoolProfile)
 * ✅ Update the editable school profile fields
 * ✅ Upload the school logo to Storage, with progress reporting
 *
 * Does NOT:
 * ❌ Apply default values (that's the service's job)
 * ❌ Decide which fields are editable (that's the service's job)
 * ❌ Cache results
 * ❌ Contain UI logic
 * --------------------------------------------------------------------
 */

import { doc, getDoc, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import { EditableSchoolFields, SchoolMeta, SchoolProfile } from "@/types/school";

export class SchoolRepository {
  /**
   * ----------------------------------------------------
   * Returns raw school branding fields.
   *
   * Returns null if the school document doesn't exist.
   * ----------------------------------------------------
   */
  async getSchoolMeta(schoolId: string): Promise<Partial<SchoolMeta> | null> {
    const snapshot = await getDoc(doc(db, "schools", schoolId));

    if (!snapshot.exists()) {
      return null;
    }

    const data = snapshot.data();

    return {
      name: data.name,
      logoUrl: data.logoUrl,
    };
  }

  /**
   * ----------------------------------------------------
   * One-time read of the full school profile, for the settings
   * form. Deliberately not a live subscription — an edit form
   * shouldn't have its in-progress edits overwritten by a remote
   * change while the user is typing.
   *
   * Returns null if the school document doesn't exist.
   * ----------------------------------------------------
   */
  async getSchoolProfile(schoolId: string): Promise<Partial<SchoolProfile> | null> {
    const snapshot = await getDoc(doc(db, "schools", schoolId));
    return snapshot.exists() ? (snapshot.data() as Partial<SchoolProfile>) : null;
  }

  /**
   * ----------------------------------------------------
   * Update the school profile. Takes only editable fields —
   * the service is responsible for stripping plan/status/joined
   * before calling this.
   * ----------------------------------------------------
   */
  async updateSchoolProfile(
    schoolId: string,
    data: EditableSchoolFields
  ): Promise<void> {
    await updateDoc(doc(db, "schools", schoolId), { ...data });
  }

  /**
   * ----------------------------------------------------
   * Uploads the school logo to Storage at a fixed path
   * (schools/{schoolId}/logo.webp), reporting progress, and
   * resolves with the public download URL.
   * ----------------------------------------------------
   */
  uploadLogo(
    schoolId: string,
    blob: Blob,
    onProgress: (percent: number) => void
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const storageRef = ref(storage, `schools/${schoolId}/logo.webp`);
      const task = uploadBytesResumable(storageRef, blob, { contentType: "image/webp" });

      task.on(
        "state_changed",
        (snapshot) => {
          onProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100));
        },
        (error) => reject(error),
        async () => {
          try {
            resolve(await getDownloadURL(task.snapshot.ref));
          } catch (error) {
            reject(error);
          }
        }
      );
    });
  }
}

export const schoolRepository = new SchoolRepository();