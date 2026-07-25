/**
 * --------------------------------------------------------------------
 * File:
 * services/academic/subjectsService.ts
 *
 * Purpose:
 * Business logic for a school's subject catalog.
 *
 * Responsibilities:
 * ✅ Normalize raw Firestore data into a well-formed Subject
 * ✅ Validate the subject form (name required, no duplicate names)
 * ✅ Assign orderIndex for new subjects (append to end of the list)
 *
 * Does NOT:
 * ❌ Call Firestore directly (that's the repository's job)
 * ❌ Know anything about classes, results, or teachers — this only
 *    owns the catalog itself, not who references it
 * --------------------------------------------------------------------
 */

import {
  subjectsRepository,
  NewSubjectDocument,
  SubjectDocumentUpdate,
} from "@/repositories/academic/subjectsRepository";
import { Subject, SubjectFormValues } from "@/types/academic";

function normalizeSubject(id: string, data: Record<string, unknown>): Subject {
  return {
    id,
    name: (data.name as string) || "",
    category: (data.category as Subject["category"]) || "Core",
    orderIndex: (data.orderIndex as number) ?? 0,
    isActive: (data.isActive as boolean) ?? true,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

function validateForm(values: SubjectFormValues, existing: Subject[], editingId?: string): void {
  const name = values.name.trim();
  if (!name) {
    throw new Error("Subject name is required.");
  }

  const isDuplicate = existing.some(
    (s) => s.id !== editingId && s.name.trim().toLowerCase() === name.toLowerCase()
  );
  if (isDuplicate) {
    throw new Error(`"${name}" already exists in the subject catalog.`);
  }
}

export class SubjectsService {
  /**
   * ----------------------------------------------------
   * Live subscription to a school's subjects, normalized.
   * ----------------------------------------------------
   */
  subscribeToSubjects(
    schoolId: string,
    callback: (subjects: Subject[]) => void
  ): () => void {
    return subjectsRepository.subscribeToSubjects(schoolId, (docs) => {
      callback(docs.map((d) => normalizeSubject(d.id, d.data)));
    });
  }

  /**
   * ----------------------------------------------------
   * Validate and create a new subject, appended to the end
   * of the existing catalog's order.
   *
   * `existing` is the caller's current in-memory subject list
   * (from the subscription above) — passed in rather than
   * re-fetched, since the caller already has it live.
   * ----------------------------------------------------
   */
  async createSubject(
    schoolId: string,
    values: SubjectFormValues,
    existing: Subject[]
  ): Promise<void> {
    validateForm(values, existing);

    const nextOrderIndex = existing.reduce((max, s) => Math.max(max, s.orderIndex), -1) + 1;

    const data: NewSubjectDocument = {
      name: values.name.trim(),
      category: values.category,
      isActive: values.isActive,
      orderIndex: nextOrderIndex,
    };

    await subjectsRepository.createSubject(schoolId, data);
  }

  async updateSubject(
    schoolId: string,
    subjectId: string,
    values: SubjectFormValues,
    existing: Subject[]
  ): Promise<void> {
    validateForm(values, existing, subjectId);

    const data: SubjectDocumentUpdate = {
      name: values.name.trim(),
      category: values.category,
      isActive: values.isActive,
    };

    await subjectsRepository.updateSubject(schoolId, subjectId, data);
  }

  /**
   * ----------------------------------------------------
   * Toggle active/inactive without opening the full edit form —
   * mirrors the quick-toggle affordance already on the
   * Subjects settings page.
   * ----------------------------------------------------
   */
  async toggleActive(schoolId: string, subjectId: string, isActive: boolean): Promise<void> {
    await subjectsRepository.updateSubject(schoolId, subjectId, { isActive });
  }

  /**
   * ----------------------------------------------------
   * Imports a board template's recommended subjects into the
   * catalog. Skips any name that already exists (case-insensitive)
   * instead of erroring — importing is meant to be safe to run
   * against a catalog that already has some subjects in it.
   *
   * Returns counts so the caller can toast something like
   * "4 subjects added, 2 already existed."
   * ----------------------------------------------------
   */
  async importTemplate(
    schoolId: string,
    templateSubjects: { name: string; category: Subject["category"] }[],
    existing: Subject[]
  ): Promise<{ added: number; skipped: number }> {
    const existingNames = new Set(existing.map((s) => s.name.trim().toLowerCase()));
    let nextOrderIndex = existing.reduce((max, s) => Math.max(max, s.orderIndex), -1) + 1;

    let added = 0;
    let skipped = 0;

    for (const template of templateSubjects) {
      const name = template.name.trim();
      if (!name || existingNames.has(name.toLowerCase())) {
        skipped += 1;
        continue;
      }

      await subjectsRepository.createSubject(schoolId, {
        name,
        category: template.category,
        isActive: true,
        orderIndex: nextOrderIndex,
      });

      existingNames.add(name.toLowerCase());
      nextOrderIndex += 1;
      added += 1;
    }

    return { added, skipped };
  }

  async deleteSubject(schoolId: string, subjectId: string): Promise<void> {
    await subjectsRepository.deleteSubject(schoolId, subjectId);
  }
}

export const subjectsService = new SubjectsService();