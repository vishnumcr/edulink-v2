/**
 * --------------------------------------------------------------------
 * File:
 * services/teachers/teachersService.ts
 *
 * Purpose:
 * Business logic for the Teachers feature.
 *
 * Responsibilities:
 * ✅ Normalize raw Firestore data into a well-formed Teacher
 * ✅ Validate form input
 * ✅ Orchestrate create: call the createTeacher Cloud Function (which
 *    creates the Firebase Auth account + both Firestore docs), then
 *    upload the photo (if any) keyed by the uid it returns, then
 *    trigger a password-reset email so the teacher can set their
 *    first password
 *
 * Does NOT:
 * ❌ Call Firestore/Storage directly (that's the repository's job)
 * ❌ Create the Auth account or the teacher/users documents itself —
 *    that's the createTeacher Cloud Function's job specifically,
 *    since it needs the Admin SDK (see that function's header)
 * ❌ Compress images (see utils/image.ts)
 * --------------------------------------------------------------------
 */

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { teachersRepository } from "@/repositories/teachers/teachersRepository";
import { authRepository } from "@/repositories/auth/authRepository";
import { compressToWebP } from "@/utils/image";
import { Teacher, TeacherFormValues } from "@/types/teachers";

interface CreateTeacherRequest {
  schoolId: string;
  name: string;
  email: string;
  phone: string;
  subject: string;
}

interface CreateTeacherResponse {
  uid: string;
  email: string;
}

/** What the caller (the Teachers page) needs to know beyond "it succeeded." */
export interface CreateTeacherOutcome {
  uid: string;
  /** False if the teacher account/profile were created successfully but the reset email failed to send — the admin should know to resend it, not just assume everything worked silently. */
  passwordResetSent: boolean;
}

function normalizeTeacher(id: string, data: Record<string, unknown>): Teacher {
  return {
    id,
    uid: data.uid as string | undefined,
    name: (data.name as string) || "",
    email: (data.email as string) || "",
    phone: (data.phone as string) || "",
    subject: (data.subject as string) || "",
    photoUrl: data.photoUrl as string | undefined,
    createdAt: data.createdAt,
    classTeacherOf: (data.classTeacherOf as Teacher["classTeacherOf"]) ?? null,
  };
}

function validateForm(values: TeacherFormValues): void {
  if (!values.name.trim()) {
    throw new Error("Full name is required.");
  }
  if (!values.email.trim()) {
    throw new Error("Email is required — it's how this teacher logs into the app.");
  }
}

export class TeachersService {
  /**
   * ----------------------------------------------------
   * Live subscription to a school's teachers, normalized.
   * ----------------------------------------------------
   */
  subscribeToTeachers(
    schoolId: string,
    callback: (teachers: Teacher[]) => void
  ): () => void {
    return teachersRepository.subscribeToTeachers(schoolId, (docs) => {
      callback(docs.map((d) => normalizeTeacher(d.id, d.data)));
    });
  }

  /**
   * ----------------------------------------------------
   * Validate and create a new teacher, optionally with a photo.
   *
   * Order matters here, and it's a real dependency chain, not just
   * convention: the Auth account has to exist before there's a uid to
   * key a photo upload by, and the teacher document has to exist
   * before a photo URL can be attached to it — so this is
   * inherently three sequential steps now, not the single write the
   * old (Auth-less) version did:
   *
   *   1. createTeacher Cloud Function → Auth account + both Firestore
   *      docs, keyed by the new uid
   *   2. (if a photo was given) upload it keyed by that uid, then
   *      attach its URL to the just-created teacher document
   *   3. trigger a password-reset email to that address
   *
   * Step 3 failing does NOT undo steps 1–2 or throw from this method
   * — the teacher and their login already exist at that point; losing
   * the welcome email isn't a reason to pretend the whole thing
   * failed. The caller finds out via passwordResetSent instead.
   * ----------------------------------------------------
   */
  async createTeacher(
    schoolId: string,
    values: TeacherFormValues,
    photoFile: File | null
  ): Promise<CreateTeacherOutcome> {
    validateForm(values);

    const callable = httpsCallable<CreateTeacherRequest, CreateTeacherResponse>(
      functions,
      "createTeacher"
    );

    const { data } = await callable({
      schoolId,
      name: values.name,
      email: values.email,
      phone: values.phone,
      subject: values.subject,
    });

    if (photoFile) {
      const compressed = await compressToWebP(photoFile);
      const photoUrl = await teachersRepository.uploadPhoto(schoolId, data.uid, compressed);
      await teachersRepository.updatePhotoUrl(schoolId, data.uid, photoUrl);
    }

    let passwordResetSent = true;
    try {
      await authRepository.sendPasswordReset(data.email);
    } catch {
      passwordResetSent = false;
    }

    return { uid: data.uid, passwordResetSent };
  }

  /**
   * ----------------------------------------------------
   * Delete a teacher.
   *
   * See teachersRepository.deleteTeacher's own note: this only
   * removes the teacher from this school's roster, not their Auth
   * account or login.
   * ----------------------------------------------------
   */
  async deleteTeacher(schoolId: string, teacherId: string): Promise<void> {
    await teachersRepository.deleteTeacher(schoolId, teacherId);
  }

  /**
   * ----------------------------------------------------
   * Re-sends the password-setup email. Exists for two real cases,
   * not just a convenience: createTeacher's own passwordResetSent
   * flag coming back false (the account exists but the email never
   * went out), and a teacher who simply never received or lost the
   * original email long after creation. Thin wrapper over
   * authRepository.sendPasswordReset — kept here, not called
   * directly from the page, so the Teachers feature doesn't reach
   * into the Auth feature's repository itself.
   * ----------------------------------------------------
   */
  async resendSetupEmail(email: string): Promise<void> {
    await authRepository.sendPasswordReset(email);
  }
}

export const teachersService = new TeachersService();