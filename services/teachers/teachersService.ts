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
 * ✅ Orchestrate create: generate an ID, upload the photo (if any)
 *    against that ID, then write the teacher document once with
 *    photoUrl already set — one write instead of create-then-update
 *
 * Does NOT:
 * ❌ Call Firestore/Storage directly (that's the repository's job)
 * ❌ Compress images (see utils/image.ts)
 * --------------------------------------------------------------------
 */

import { teachersRepository } from "@/repositories/teachers/teachersRepository";
import { compressToWebP } from "@/utils/image";
import { Teacher, TeacherFormValues } from "@/types/teachers";

function normalizeTeacher(id: string, data: Record<string, unknown>): Teacher {
  return {
    id,
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
   * If a photo is provided: generate the doc ID first, compress
   * and upload the photo keyed by that ID, then write the teacher
   * document once with photoUrl already populated.
   *
   * If no photo: a single addDoc, same as before.
   * ----------------------------------------------------
   */
  async createTeacher(
    schoolId: string,
    values: TeacherFormValues,
    photoFile: File | null
  ): Promise<void> {
    validateForm(values);

    const baseData = {
      name: values.name,
      email: values.email,
      phone: values.phone,
      subject: values.subject,
    };

    if (!photoFile) {
      await teachersRepository.createTeacher(schoolId, baseData);
      return;
    }

    const ref = teachersRepository.newTeacherRef(schoolId);
    const compressed = await compressToWebP(photoFile);
    const photoUrl = await teachersRepository.uploadPhoto(schoolId, ref.id, compressed);

    await teachersRepository.createTeacherAt(ref, { ...baseData, photoUrl });
  }

  /**
   * ----------------------------------------------------
   * Delete a teacher.
   * ----------------------------------------------------
   */
  async deleteTeacher(schoolId: string, teacherId: string): Promise<void> {
    await teachersRepository.deleteTeacher(schoolId, teacherId);
  }
}

export const teachersService = new TeachersService();