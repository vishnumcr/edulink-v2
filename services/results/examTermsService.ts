/**
 * --------------------------------------------------------------------
 * File:
 * services/results/examTermsService.ts
 *
 * Purpose:
 * Business logic for a school's exam model (FA1/FA2/SA1/SA2, Unit
 * Tests, Finals — whatever the school itself defines).
 *
 * Responsibilities:
 * ✅ Normalize raw Firestore data into a well-formed ExamTerm
 * ✅ Validate the exam term form (name, at least one subject, sane
 *    marks) before it ever reaches Firestore
 * ✅ Assign subject IDs
 *
 * Does NOT:
 * ❌ Call Firestore directly (that's the repository's job)
 * ❌ Know anything about student results — this only owns the
 *    *shape* of an exam term, not marks entered against it
 * --------------------------------------------------------------------
 */

import {
  examTermsRepository,
  NewExamTermDocument,
  ExamTermDocumentUpdate,
} from "@/repositories/results/examTermsRepository";
import { ExamSubject, ExamTerm, ExamTermFormValues } from "@/types/results";
import { Subject } from "@/types/academic";

function normalizeSubject(raw: Record<string, unknown>): ExamSubject {
  return {
    id: (raw.id as string) || "",
    name: (raw.name as string) || "",
    maxMarks: (raw.maxMarks as number) ?? 0,
    passMarks: (raw.passMarks as number) ?? 0,
  };
}

function normalizeExamTerm(id: string, data: Record<string, unknown>): ExamTerm {
  const rawSubjects = (data.subjects as Record<string, unknown>[] | undefined) ?? [];

  return {
    id,
    name: (data.name as string) || "",
    academicYear: (data.academicYear as string) || "",
    order: (data.order as number) ?? 0,
    subjects: rawSubjects.map(normalizeSubject),
    isActive: (data.isActive as boolean) ?? true,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

function validateForm(values: ExamTermFormValues): void {
  if (!values.name.trim()) {
    throw new Error("Exam term name is required.");
  }
  if (values.subjects.length === 0) {
    throw new Error("Add at least one subject.");
  }

  const seenIds = new Set<string>();
  for (const subject of values.subjects) {
    if (!subject.id || !subject.name.trim()) {
      throw new Error("Every subject must be picked from your subject catalog.");
    }
    if (seenIds.has(subject.id)) {
      throw new Error(`"${subject.name}" is already added to this exam term.`);
    }
    seenIds.add(subject.id);

    if (subject.maxMarks <= 0) {
      throw new Error(`"${subject.name}" needs max marks greater than 0.`);
    }
    if (subject.passMarks < 0 || subject.passMarks > subject.maxMarks) {
      throw new Error(`"${subject.name}"'s pass marks must be between 0 and its max marks.`);
    }
  }
}

function toDocument(values: ExamTermFormValues): NewExamTermDocument {
  return {
    name: values.name.trim(),
    academicYear: values.academicYear.trim(),
    order: values.order,
    isActive: values.isActive,
    subjects: values.subjects.map((s) => ({
      id: s.id,
      name: s.name.trim(),
      maxMarks: s.maxMarks,
      passMarks: s.passMarks,
    })),
  };
}

export class ExamTermsService {
  subscribeToExamTerms(
    schoolId: string,
    callback: (terms: ExamTerm[]) => void
  ): () => void {
    return examTermsRepository.subscribeToExamTerms(schoolId, (docs) => {
      callback(docs.map((d) => normalizeExamTerm(d.id, d.data)));
    });
  }

  async createExamTerm(schoolId: string, values: ExamTermFormValues): Promise<void> {
    validateForm(values);
    await examTermsRepository.createExamTerm(schoolId, toDocument(values));
  }

  async updateExamTerm(
    schoolId: string,
    termId: string,
    values: ExamTermFormValues
  ): Promise<void> {
    validateForm(values);
    await examTermsRepository.updateExamTerm(
      schoolId,
      termId,
      toDocument(values) as ExamTermDocumentUpdate
    );
  }

  async deleteExamTerm(schoolId: string, termId: string): Promise<void> {
    await examTermsRepository.deleteExamTerm(schoolId, termId);
  }

  /**
   * ----------------------------------------------------
   * Builds a new term-subject row from a real catalog Subject —
   * the only way an ExamSubject is created. `id`/`name` are
   * taken straight from the catalog entry so the relational
   * link is correct from the moment the row exists; only
   * max/pass marks are term-specific and default to the
   * school's common 100/33 pass convention.
   * ----------------------------------------------------
   */
  addSubjectFromCatalog(subject: Subject): ExamSubject {
    return { id: subject.id, name: subject.name, maxMarks: 100, passMarks: 33 };
  }
}

export const examTermsService = new ExamTermsService();