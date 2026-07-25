/**
 * --------------------------------------------------------------------
 * File:
 * types/results.ts
 *
 * Purpose:
 * Shared types for the Results (exam marks) feature.
 *
 * Firestore documents:
 * schools/{schoolId}/examTerms/{termId}   → school-defined exam model
 * schools/{schoolId}/results/{resultId}   → one student's marks for
 *                                            one exam term
 *
 * Why exam terms are school-defined data, not a hardcoded enum:
 * Exam structures vary by state/board (Andhra Pradesh: FA1, FA2, SA1,
 * SA2...; CBSE schools: Unit Test, Half-Yearly, Final; some schools
 * run their own custom cycles). EduLink doesn't assume a model — each
 * school creates its own ExamTerm documents, each with its own subject
 * list and max marks per subject (subjects can carry different max
 * marks across terms, e.g. a Formative Assessment worth 20 vs a
 * Summative worth 100).
 * --------------------------------------------------------------------
 */

/**
 * -------------------------------------------------------
 * A single subject within one exam term, with the max/pass
 * marks that apply for THAT term (not global — a subject's
 * weight can differ between FA1 and SA1, for example).
 *
 * Relational note:
 * `id` is NOT a randomly generated term-local id — it IS the
 * catalog Subject's id (schools/{schoolId}/subjects/{id}), so
 * every exam-term subject is a real reference into the Subjects
 * catalog rather than free-typed text. This is what lets the
 * Enter Marks / Class Performance tabs intersect an exam term's
 * subjects against a specific class's `subjectIds` (see
 * ClassSummary in types/academic.ts) to show only the subjects
 * that class actually offers.
 *
 * `name` stays denormalized (a snapshot at the time the subject
 * was added to this term) so a later rename in the catalog
 * doesn't rewrite historical exam terms/results out from under
 * anyone — same pattern as StudentResult's denormalized
 * className/section.
 * -------------------------------------------------------
 */
export interface ExamSubject {
  id: string;
  name: string;
  maxMarks: number;
  passMarks: number;
}

/**
 * -------------------------------------------------------
 * schools/{schoolId}/examTerms/{termId}
 *
 * A school-defined exam window (e.g. "FA1", "SA1", "Final Exam").
 * `order` controls display/sequence — schools add terms in the
 * order their academic calendar runs.
 * -------------------------------------------------------
 */
export interface ExamTerm {
  id: string;
  name: string;
  academicYear: string;
  order: number;
  subjects: ExamSubject[];
  isActive: boolean;
  createdAt: unknown;
  updatedAt?: unknown;
}

/** Shape submitted from the exam term create/edit form. */
export interface ExamTermFormValues {
  name: string;
  academicYear: string;
  order: number;
  subjects: ExamSubject[];
  isActive: boolean;
}

/** One subject's mark within a student's result. `isAbsent` wins over marksObtained. */
export interface SubjectMark {
  subjectId: string;
  marksObtained: number | null;
  isAbsent: boolean;
}

/**
 * -------------------------------------------------------
 * schools/{schoolId}/results/{resultId}
 *
 * resultId is `${termId}_${studentId}` — deterministic, so saving
 * marks is always an upsert (no duplicate-result risk, no need to
 * look up an existing doc ID first).
 *
 * className/section are denormalized at save time so class-wide
 * queries and rank calculations don't need a join against the
 * students collection.
 * -------------------------------------------------------
 */
export interface StudentResult {
  id: string;
  termId: string;
  studentId: string;
  className: string;
  section: string | null;
  marks: SubjectMark[];
  totalObtained: number;
  totalMax: number;
  percentage: number;
  grade: string;
  remarks: string;
  enteredBy?: string;
  createdAt: unknown;
  updatedAt?: unknown;
}

/** Result joined with the student roster info needed to display it. */
export interface StudentResultRow extends StudentResult {
  studentName: string;
  rollNo: string;
  rank: number | null;
}

/** A single editable cell in the Enter Marks grid, before it's saved. */
export interface MarksEntryRow {
  studentId: string;
  studentName: string;
  rollNo: string;
  marks: SubjectMark[];
  remarks: string;
  existingResultId: string | null;
  dirty: boolean;
  saving: boolean;
  error: string | null;
}

/** Aggregate stats for a class in a given exam term. */
export interface ClassPerformanceSummary {
  studentsAppeared: number;
  classAverage: number;
  highestPercentage: number;
  lowestPercentage: number;
  passPercentage: number;
}