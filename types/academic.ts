/**
 * --------------------------------------------------------------------
 * File:
 * types/academic.ts
 *
 * Purpose:
 * Shared types for school-wide academic masters — data that other
 * features (classes, results, teachers, timetable) reference by ID
 * rather than duplicate.
 *
 * Firestore document:
 * schools/{schoolId}/subjects/{subjectId}
 *
 * Design note:
 * A subject is defined ONCE per school and referenced everywhere else
 * by its id. Classes hold a `subjectIds: string[]` field (see
 * repositories/academic/classesRepository.ts) rather than embedding
 * subject objects — so renaming "Maths" to "Mathematics" happens in
 * one place instead of every class document.
 *
 * This is deliberately NOT the same shape as `ExamSubject` in
 * types/results.ts. A school's Subjects catalog answers "what subjects
 * exist"; an exam term's subjects answer "which of those apply to
 * this exam, worth how many marks" — that's term-specific and stays
 * denormalized on the exam term (see types/results.ts for why).
 * --------------------------------------------------------------------
 */

export type SubjectCategory = "Core" | "Elective" | "Language";

export interface Subject {
  id: string;
  name: string;
  category: SubjectCategory;
  /** Display order within pickers/lists. */
  orderIndex: number;
  /** Inactive subjects stay in the catalog (for historical records) but drop out of new pickers. */
  isActive: boolean;
  createdAt: unknown;
  updatedAt?: unknown;
}

/** Shape submitted from the add/edit-subject form. */
export interface SubjectFormValues {
  name: string;
  category: SubjectCategory;
  isActive: boolean;
}

/**
 * ------------------------------------------------------------------
 * schools/{schoolId}/classes/{classId} — the narrow slice this
 * feature cares about. The Academic config page owns the full class
 * shape (sections, teacher, room, etc.); this is just enough for the
 * subject-assignment picker to list classes and read/write the link.
 * ------------------------------------------------------------------
 */
export interface ClassSummary {
  id: string;
  className: string;
  /** IDs into the Subjects catalog this class currently offers. */
  subjectIds: string[];
}