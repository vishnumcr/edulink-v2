/**
 * --------------------------------------------------------------------
 * File:
 * types/teachers.ts
 *
 * Purpose:
 * Shared types for the Teachers feature.
 *
 * Firestore document:
 * schools/{schoolId}/teachers/{teacherId}
 * --------------------------------------------------------------------
 */

export interface ClassTeacherAssignment {
  schoolId: string;
  classId: string;
  className: string;
  sectionId: string;
  sectionName: string;
}

export interface Teacher {
  id: string;
  name: string;
  email: string;
  phone: string;
  subject: string;
  photoUrl?: string;
  createdAt?: unknown;
  /**
   * The reverse side of Section.classTeacherId (see
   * app/(dashboard)/settings/academic/page.tsx). A teacher can be
   * class-teacher of at most ONE section at a time — this is a single
   * nullable object, not an array — so this teacher's own profile can
   * show "you're the class teacher of Grade 5-A" without having to
   * scan every class's every section looking for a name match, which
   * is exactly the gap this field was added to close.
   */
  classTeacherOf?: ClassTeacherAssignment | null;
}

/**
 * Shape submitted from the add-teacher form.
 */
export interface TeacherFormValues {
  name: string;
  email: string;
  phone: string;
  subject: string;
}