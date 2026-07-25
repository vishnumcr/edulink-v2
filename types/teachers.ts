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
  /**
   * Absent means this teacher is class teacher of the WHOLE class
   * directly (a class with no sections at all — e.g. a school that
   * doesn't split Class 2 into sections). Present means the usual
   * per-section assignment. See settings/academic/page.tsx: a class
   * can be assigned a teacher either way, never both at once.
   */
  sectionId?: string;
  sectionName?: string;
}

export interface Teacher {
  id: string;
  /**
   * The Firebase Auth uid this teacher can sign into the Android app
   * with — set by the createTeacher Cloud Function, which mints the
   * Auth account FIRST and uses that same uid as this document's own
   * ID (see that function's header for why there's no separate id to
   * keep in sync). Optional because it's only present on teachers
   * created through that flow: a teacher added before this feature
   * existed has an arbitrary legacy doc ID here instead, and no Auth
   * account at all. Treat the FIELD's absence — not just checking
   * `id` — as the real signal for "this teacher has no login yet";
   * don't assume `id` doubles as a uid for older documents.
   */
  uid?: string;
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