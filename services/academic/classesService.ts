/**
 * --------------------------------------------------------------------
 * File:
 * services/academic/classesService.ts
 *
 * Purpose:
 * Thin pass-through over classesRepository for most methods — no
 * normalization needed for a plain string label list. subscribeToClasses
 * is the one place this file does real work: shaping raw docs into
 * ClassSummary for the subject-assignment picker.
 * --------------------------------------------------------------------
 */

import { classesRepository } from "@/repositories/academic/classesRepository";
import { ClassSummary } from "@/types/academic";

function normalizeClass(id: string, data: Record<string, unknown>): ClassSummary {
  return {
    id,
    className: (data.className as string) || "",
    subjectIds: Array.isArray(data.subjectIds) ? (data.subjectIds as string[]) : [],
  };
}

export class ClassesService {
  subscribeToClassLabels(
    schoolId: string,
    callback: (labels: string[]) => void
  ): () => void {
    return classesRepository.subscribeToClassLabels(schoolId, callback);
  }

  /**
   * ----------------------------------------------------
   * Live subscription to classes with their subject links,
   * normalized. Used by the Class Assignments tab of the
   * Subjects settings page.
   * ----------------------------------------------------
   */
  subscribeToClasses(
    schoolId: string,
    callback: (classes: ClassSummary[]) => void
  ): () => void {
    return classesRepository.subscribeToClasses(schoolId, (docs) => {
      callback(docs.map((d) => normalizeClass(d.id, d.data)));
    });
  }

  async updateClassSubjects(
    schoolId: string,
    classId: string,
    subjectIds: string[]
  ): Promise<void> {
    await classesRepository.updateClassSubjects(schoolId, classId, subjectIds);
  }
}

export const classesService = new ClassesService();