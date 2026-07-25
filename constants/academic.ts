/**
 * --------------------------------------------------------------------
 * File:
 * constants/academic.ts
 *
 * Purpose:
 * Static reference data for the Academic / Subjects settings feature.
 *
 * Board templates are recommended subject NAMES only — deliberately
 * no marks, no class mapping. Importing a template just adds missing
 * subjects to the school's catalog (see subjectsService); the school
 * edits or removes them freely afterwards. Marks are never templated
 * here because they belong to exam terms, not subjects (see
 * types/results.ts).
 * --------------------------------------------------------------------
 */

import { SubjectCategory } from "@/types/academic";

export type BoardType =
  | "CBSE"
  | "ICSE"
  | "Andhra Pradesh State Board"
  | "Telangana State Board"
  | "Custom";

export const BOARDS: BoardType[] = [
  "CBSE",
  "ICSE",
  "Andhra Pradesh State Board",
  "Telangana State Board",
  "Custom",
];

export interface BoardTemplateSubject {
  name: string;
  category: SubjectCategory;
}

/**
 * Recommended subject sets by board. "Custom" has no template — it
 * exists as a selectable option so schools that already keep to their
 * own catalog aren't nudged toward importing anything.
 */
export const BOARD_TEMPLATES: Partial<Record<BoardType, BoardTemplateSubject[]>> = {
  CBSE: [
    { name: "English", category: "Language" },
    { name: "Hindi", category: "Language" },
    { name: "Mathematics", category: "Core" },
    { name: "Science", category: "Core" },
    { name: "Social Science", category: "Core" },
  ],
  ICSE: [
    { name: "English", category: "Language" },
    { name: "Second Language", category: "Language" },
    { name: "Mathematics", category: "Core" },
    { name: "Physics", category: "Core" },
    { name: "Chemistry", category: "Core" },
    { name: "Biology", category: "Core" },
    { name: "History & Civics", category: "Core" },
    { name: "Geography", category: "Core" },
  ],
  "Andhra Pradesh State Board": [
    { name: "English", category: "Language" },
    { name: "Telugu", category: "Language" },
    { name: "Hindi", category: "Language" },
    { name: "Mathematics", category: "Core" },
    { name: "General Science", category: "Core" },
    { name: "Social Studies", category: "Core" },
  ],
  "Telangana State Board": [
    { name: "English", category: "Language" },
    { name: "Telugu", category: "Language" },
    { name: "Hindi", category: "Language" },
    { name: "Mathematics", category: "Core" },
    { name: "General Science", category: "Core" },
    { name: "Social Studies", category: "Core" },
  ],
};