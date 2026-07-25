/**
 * --------------------------------------------------------------------
 * File:
 * services/results/resultsService.ts
 *
 * Purpose:
 * Business logic for student exam results — the actual marks entered
 * against a school's exam terms.
 *
 * Responsibilities:
 * ✅ Normalize raw Firestore data into a well-formed StudentResult
 * ✅ Compute totals / percentage / grade from marks + the term's
 *    subject list
 * ✅ Validate marks before they're saved (bounds-checked against each
 *    subject's max marks)
 * ✅ Compute class-wide rank and summary stats — client-side, from
 *    documents already being read for the Class Performance view.
 *    This is read-time computation, not a stored/coordinated write,
 *    so it doesn't need a Cloud Function: per the CRUD-vs-Cloud-
 *    Function rule, nothing here writes anything the user doesn't
 *    already have permission to write directly.
 *
 * Does NOT:
 * ❌ Call Firestore directly (that's the repository's job)
 * ❌ Know anything about how exam terms are configured (that's
 *    examTermsService) — this only consumes an ExamTerm it's given
 * --------------------------------------------------------------------
 */

import {
  resultId,
  resultsRepository,
  ResultDocumentUpsert,
} from "@/repositories/results/resultsRepository";
import { GRADE_BANDS, PASS_PERCENTAGE_THRESHOLD } from "@/constants/results";
import {
  ClassPerformanceSummary,
  ExamSubject,
  ExamTerm,
  StudentResult,
  StudentResultRow,
  SubjectMark,
} from "@/types/results";
import { Student } from "@/types/students";

function normalizeMark(raw: Record<string, unknown>): SubjectMark {
  return {
    subjectId: (raw.subjectId as string) || "",
    marksObtained: (raw.marksObtained as number | null) ?? null,
    isAbsent: (raw.isAbsent as boolean) ?? false,
  };
}

function normalizeResult(id: string, data: Record<string, unknown>): StudentResult {
  const rawMarks = (data.marks as Record<string, unknown>[] | undefined) ?? [];

  return {
    id,
    termId: (data.termId as string) || "",
    studentId: (data.studentId as string) || "",
    className: (data.className as string) || "",
    section: (data.section as string) || null,
    marks: rawMarks.map(normalizeMark),
    totalObtained: (data.totalObtained as number) ?? 0,
    totalMax: (data.totalMax as number) ?? 0,
    percentage: (data.percentage as number) ?? 0,
    grade: (data.grade as string) || "",
    remarks: (data.remarks as string) || "",
    enteredBy: data.enteredBy as string | undefined,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

/**
 * ----------------------------------------------------
 * Grade lookup. GRADE_BANDS is ordered highest-first, so the first
 * band the percentage clears is the answer.
 * ----------------------------------------------------
 */
export function gradeFor(percentage: number): string {
  const band = GRADE_BANDS.find((b) => percentage >= b.minPercentage);
  return band?.grade ?? "E";
}

/**
 * ----------------------------------------------------
 * Totals for one student, from their marks + the subject list that
 * applies to them — the exam term's subjects intersected with
 * whatever subjects their specific class offers (see ClassSummary
 * in types/academic.ts). This is deliberately NOT always the full
 * term.subjects list: a class that doesn't offer a given subject
 * shouldn't have that subject's max marks counted against it, or
 * its percentage would be quietly deflated for a subject it never
 * took in the first place.
 *
 * Absent subjects count 0 toward the total but the subject's max
 * marks still count toward totalMax — an absence should hurt the
 * percentage, not be silently excluded from it.
 * ----------------------------------------------------
 */
export function computeTotals(
  marks: SubjectMark[],
  subjects: ExamSubject[]
): { totalObtained: number; totalMax: number; percentage: number } {
  let totalObtained = 0;
  let totalMax = 0;

  for (const subject of subjects) {
    const mark = marks.find((m) => m.subjectId === subject.id);
    totalMax += subject.maxMarks;
    if (mark && !mark.isAbsent && mark.marksObtained !== null) {
      totalObtained += mark.marksObtained;
    }
  }

  const percentage = totalMax > 0 ? Math.round((totalObtained / totalMax) * 10000) / 100 : 0;
  return { totalObtained, totalMax, percentage };
}

/**
 * ----------------------------------------------------
 * Validates one subject's mark against that subject's max marks.
 * Throws with a subject-specific message so the UI can show exactly
 * which cell is wrong. Takes the same class-scoped subject list as
 * computeTotals, for the same reason.
 * ----------------------------------------------------
 */
function validateMarks(marks: SubjectMark[], subjects: ExamSubject[]): void {
  for (const subject of subjects) {
    const mark = marks.find((m) => m.subjectId === subject.id);
    if (!mark || mark.isAbsent) continue;
    if (mark.marksObtained === null) continue;
    if (mark.marksObtained < 0) {
      throw new Error(`"${subject.name}" marks can't be negative.`);
    }
    if (mark.marksObtained > subject.maxMarks) {
      throw new Error(`"${subject.name}" marks can't exceed ${subject.maxMarks}.`);
    }
  }
}

export class ResultsService {
  subscribeToResultsByTerm(
    schoolId: string,
    termId: string,
    callback: (results: StudentResult[]) => void
  ): () => void {
    return resultsRepository.subscribeToResultsByTerm(schoolId, termId, (docs) => {
      callback(docs.map((d) => normalizeResult(d.id, d.data)));
    });
  }

  subscribeToResultsByStudent(
    schoolId: string,
    studentId: string,
    callback: (results: StudentResult[]) => void
  ): () => void {
    return resultsRepository.subscribeToResultsByStudent(schoolId, studentId, (docs) => {
      callback(docs.map((d) => normalizeResult(d.id, d.data)));
    });
  }

  /**
   * ----------------------------------------------------
   * Validate, compute totals/grade, and save one student's marks
   * for one exam term. Deterministic doc ID means this is always
   * safe to call whether marks already exist or not.
   * ----------------------------------------------------
   */
  async saveMarks(
    schoolId: string,
    term: ExamTerm,
    subjects: ExamSubject[],
    student: Pick<Student, "id" | "className" | "section">,
    marks: SubjectMark[],
    remarks: string,
    enteredBy?: string
  ): Promise<void> {
    validateMarks(marks, subjects);
    const { totalObtained, totalMax, percentage } = computeTotals(marks, subjects);

    const document: ResultDocumentUpsert = {
      termId: term.id,
      studentId: student.id,
      className: student.className,
      section: student.section,
      marks,
      totalObtained,
      totalMax,
      percentage,
      grade: gradeFor(percentage),
      remarks: remarks.trim(),
      enteredBy,
    };

    await resultsRepository.saveResult(schoolId, resultId(term.id, student.id), document);
  }

  async deleteResult(schoolId: string, termId: string, studentId: string): Promise<void> {
    await resultsRepository.deleteResult(schoolId, resultId(termId, studentId));
  }

  /**
   * ----------------------------------------------------
   * Joins results with the student roster, ranks by totalObtained
   * (ties share a rank; the next distinct total skips ahead, i.e.
   * standard competition ranking), and returns rows sorted best
   * first. Purely a read-time view — nothing here is persisted.
   * ----------------------------------------------------
   */
  buildClassPerformance(results: StudentResult[], students: Student[]): StudentResultRow[] {
    const studentById = new Map(students.map((s) => [s.id, s]));

    const rows: Omit<StudentResultRow, "rank">[] = results
      .map((result) => {
        const student = studentById.get(result.studentId);
        return {
          ...result,
          studentName: student?.profile.name ?? "Unknown student",
          rollNo: student?.profile.rollNo ?? "—",
        };
      })
      .sort((a, b) => b.totalObtained - a.totalObtained);

    let rank = 0;
    let lastTotal: number | null = null;
    let seen = 0;

    return rows.map((row) => {
      seen += 1;
      if (row.totalObtained !== lastTotal) {
        rank = seen;
        lastTotal = row.totalObtained;
      }
      return { ...row, rank };
    });
  }

  summarize(rows: StudentResultRow[]): ClassPerformanceSummary {
    if (rows.length === 0) {
      return {
        studentsAppeared: 0,
        classAverage: 0,
        highestPercentage: 0,
        lowestPercentage: 0,
        passPercentage: 0,
      };
    }

    const percentages = rows.map((r) => r.percentage);
    const passed = rows.filter((r) => r.percentage >= PASS_PERCENTAGE_THRESHOLD).length;

    return {
      studentsAppeared: rows.length,
      classAverage: Math.round((percentages.reduce((s, p) => s + p, 0) / rows.length) * 100) / 100,
      highestPercentage: Math.max(...percentages),
      lowestPercentage: Math.min(...percentages),
      passPercentage: Math.round((passed / rows.length) * 10000) / 100,
    };
  }
}

export const resultsService = new ResultsService();